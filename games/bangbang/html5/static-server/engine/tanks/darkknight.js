/* Dark Knight (tank 10000030): ending stealth cooldown, five darts, poison.
 * Port of server/darkknight_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. Poison versions are read from buffVersions.
 */
import { TankActions, bkey } from '../arena.js';
import { D } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';
import { aimed, enemies, inCone, packII, piercingStep, prepareDisplacement } from './melee.js';
import { powD } from './batch-c-common.js';

const SLOTS = { 0: 305100, 1: 305201, 2: 305301, 10: 305401 };

export class DarkKnightActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.channel = null;
    this.poisons = new Map();
    this.impact_pen = null;
  }

  attrBonus(attributes, now) {
    let value = super.attrBonus(attributes, now);
    if (attributes.includes(34)) {
      value = value.add(this.impact_pen !== null ? this.impact_pen
        : this.hasBuff(305201, now) ? D('.25') : D(0));
    }
    return value;
  }

  _deal(raw, target, now, pen, options = {}) {
    this.impact_pen = pen;
    try { return this.damage(raw, now, { target, ...options })[0]; }
    finally { this.impact_pen = null; }
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    })];
  }

  is_untargetable() { return this.isUntargetable(); }

  isUntargetable() {
    const now = this.arena.eventNow || this.clock();
    return super.isUntargetable()
      || (this.hasBuff(305202, now) && !this.buffTypes(now).has(32));
  }

  removeBuff(template, now, { expired = false } = {}) {
    const existed = this.activeBuffs.has(bkey(this.id, template));
    const packets = super.removeBuff(template, now, { expired });
    if (template === 305202 && existed) {
      for (const other of [305201, 305203, 305204, 305205]) {
        packets.push(...super.removeBuff(other, now));
      }
      this.cooldowns[1] = now + this.skillCooldown(8000, 1);
      packets.push(this._cooldown(1));
    }
    return packets;
  }

  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  onDamage(source, hit, now) {
    return hit.hp_loss.gt(0) ? this.removeBuff(305202, now) : [];
  }

  interrupt(now) {
    const packets = [];
    if (this.channel) {
      this.channel = null;
      packets.push([1583, packII(this.id, 305401)]);
      for (const template of [305401, 305402, 305403, 305404]) {
        packets.push(...this.removeBuff(template, now));
      }
    }
    if (!this.alive) packets.push(...this.removeBuff(305202, now));
    return packets;
  }

  onControl(source, template, now) {
    const kind = Number(this.arena.data.tableRow('BuffTemplate_table.xml',
      { nBuffId: template }).get('nEffectType'));
    return [30, 35, 66].includes(kind) ? this.interrupt(now) : [];
  }

  _poison(target, now, generation, pen = 0) {
    if (!target.alive || target.rejectBuff({ nEffectType: '60' }, this, now)) return [];
    const key = `${target.id},${target.generation}`;
    const dot = this.poisons.get(key);
    const valid = Boolean(dot && dot.end > now
      && target.buffVersions.get(dot.buff) === dot.version);
    const count = valid ? Math.min(3, dot.count + 1) : 1;
    const packets = [];
    for (const template of [305100, 305101, 305102]) {
      if (target.buffSources.get(template) === this.id) packets.push(...target.removeBuff(template, now));
    }
    const template = 305099 + count;
    packets.push(...this._buff(template, now, target.id));
    if (!target.hasBuff(template, now)) return packets;
    let record = dot;
    if (!valid) {
      record = { target: target.id, target_generation: target.generation, generation };
      this.poisons.set(key, record);
      this._queue(now + 1000, 'dark_poison', record);
    }
    Object.assign(record, {
      end: now + 3000, count, buff: template,
      version: target.buffVersions.get(template), pen,
    });
    packets.push(...this._buff(305112, now, target.id));
    return packets;
  }

  _dartHit(flight, target, now) {
    const raw = flight.raw.mul(powD(D('.5'), flight.hits.size - 1));
    const pen = flight.context.pen;
    const packets = this._deal(raw, target, now, pen, { basic: true });
    return packets.concat(this._poison(target, now, flight.source_generation, pen));
  }

  _flight(flight, now) {
    if (flight.template === 305411) {
      return piercingStep(this, flight, now, (f, t, n) => this._dartHit(f, t, n));
    }
    if (flight.template === 305100) {
      return piercingStep(this, flight, now, (f, t, n) => this._dartHit(f, t, n),
        { pierce: false });
    }
    return super._flight(flight, now);
  }

  _event(now, kind, data) {
    if (kind === 'dark_poison') {
      const [dot] = data;
      const key = `${dot.target},${dot.target_generation}`;
      const target = this.arena.actors.get(dot.target);
      if (this.poisons.get(key) !== dot || !target || !target.alive
        || target.generation !== dot.target_generation
        || target.buffVersions.get(dot.buff) !== dot.version || now > dot.end) {
        if (this.poisons.get(key) === dot) this.poisons.delete(key);
        return [];
      }
      const packets = this._deal(target.maxHp.mul(D('.01')).mul(D(dot.count)), target, now,
        dot.pen, { periodic: true });
      if (now < dot.end) this._queue(now + 1000, kind, dot);
      else this.poisons.delete(key);
      return packets;
    }
    if (kind === 'dark_space_tick') {
      const [cast, index] = data;
      const target = this.arena.actors.get(cast.target);
      if (!target || !target.alive || target.generation !== cast.target_generation
        || target.buffVersions.get(305301) !== cast.version) return [];
      const packets = this._deal(cast.power.mul(D('.9')), target, now, cast.pen, { periodic: true });
      if (index < 5) this._queue(now + 1000, kind, cast, index + 1);
      return packets;
    }
    if (kind === 'dark_dart') {
      const [cast, index] = data;
      if (this.channel !== cast || !this.alive) return [];
      const pos = this.positionAt(now);
      const dest = [pos[0] + cast.vector[0], pos[1] + cast.vector[1]];
      const packets = this.shoot(305411, pos, dest, now, cast.power, {
        school: 'physical', basic: true, through_walls: true, context: { pen: cast.pen },
      });
      if (index < 5) this._queue(now + 200, kind, cast, index + 1);
      return packets;
    }
    if (kind === 'dark_channel_end') {
      return this.channel === data[0] ? this.interrupt(now) : [];
    }
    if (kind === 'dark_warning') {
      const [generation, index] = data;
      const nowPos = this.positionAt(now);
      if (this.generation !== generation || !this.hasBuff(305202, now)) return [];
      const packets = [scene({ skills: [this._skillEvent(305221, nowPos, nowPos)] })];
      for (const target of enemies(this)) {
        if (Math.hypot(nowPos[0] - target.positionAt(now)[0],
          nowPos[1] - target.positionAt(now)[1]) <= 480) {
          packets.push(...this._buff(305221, now, target.id));
        }
      }
      if (index < 4) this._queue(now + 1000, kind, generation, index + 1);
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if ((this.channel && [0, 2, 10].includes(slot))
      || ([0, 2, 10].includes(slot) && start[0] === dest[0] && start[1] === dest[1])) return [];
    const pen = this.hasBuff(305201, now) ? D('.25') : D(0);
    const packets = slot !== 1 ? this.removeBuff(305202, now) : [];
    const power = this.combatStat('iAttack', now);
    if (slot === 1) {
      this.cooldowns[1] = Number.MAX_SAFE_INTEGER;
      for (const template of [305201, 305202, 305203, 305204, 305205]) {
        packets.push(...this._buff(template, now));
      }
      this._queue(now + 1000, 'dark_warning', this.generation, 1);
    } else {
      this.cooldowns[slot] = now + this.skillCooldown(
        { 0: this.fireInterval(now), 2: 25000, 10: 6000 }[slot], slot);
    }
    if (slot === 0) {
      packets.push(...this.shoot(305100, start, dest, now, power.mul(D('1.5')), {
        school: 'physical', basic: true, speed_multiplier: 1.5, context: { pen },
      }));
    } else if (slot === 10) {
      this.channel = {
        vector: [dest[0] - start[0], dest[1] - start[1]], power, pen, end: now + 1000,
      };
      for (const template of [305401, 305402, 305403, 305404]) {
        packets.push(...this._buff(template, now));
      }
      this._queue(now + 50, 'dark_dart', this.channel, 1);
      this._queue(now + 1000, 'dark_channel_end', this.channel);
    } else if (slot === 2) {
      for (const target of enemies(this, { area: true })) {
        if ([20006, 20017].includes(Number(target.info.npc_template))
          || !inCone(target.positionAt(now), start, dest, 240, 90)) continue;
        packets.push(...this._buff(305301, now, target.id));
        if (!target.hasBuff(305301, now)) continue;
        for (const template of [305313, 305314]) packets.push(...this._buff(template, now, target.id));
        const cast = {
          target: target.id, target_generation: target.generation,
          generation: this.generation, power, pen,
          version: target.buffVersions.get(305301),
        };
        this._queue(now + 1000, 'dark_space_tick', cast, 1);
        packets.push(...this._poison(target, now, this.generation, pen));
      }
      const end = aimed(start, [2 * start[0] - dest[0], 2 * start[1] - dest[1]], 192,
        { fixed: true });
      let origin, stopped;
      [origin, stopped] = prepareDisplacement(this, now, { interrupt: false });
      if (!stopped.length) origin = start;
      const duration = this._setMotion(origin, end, 960, now, 4);
      this.forcedUntil = now + duration;
      packets.push(...stopped);
      packets.push(scene({ moves: [this._moveEvent(this.motion[1], 960, 4)] }));
    }
    if (slot !== 0) packets.push(scene({ skills: [this._skillEvent(SLOTS[slot], start, dest)] }));
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as DARKKNIGHT_SLOTS };
