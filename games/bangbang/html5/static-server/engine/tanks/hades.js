/* Hades (tank 10000092): independent E banks, melee slots, fear domain.
 * Port of server/hades_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin; teamVisible uses the core line-of-sight stub.
 */
import { TankActions } from '../arena.js';
import { D } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, inCone, prepareDisplacement } from './melee.js';
import { teamVisible } from './batch-c-common.js';

const SLOTS = { 0: 367100, 1: 367201, 2: 367301, 10: 367401 };

export class HadesActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.melee = false;
    this.e_banks = { false: { end: 0 }, true: { end: 0 } };
    this.ready = this.vanish = null;
    this.domains = new Map();
  }

  _skill(slot, now) {
    if (!this.melee) return SLOTS[slot];
    if (slot === 0) {
      const enhanced = this.hasBuff(367602, now);
      const alternate = this.hasBuff(enhanced ? 367124 : 367113, now);
      if (enhanced) return alternate ? 367140 : 367120;
      return alternate ? 367130 : 367110;
    }
    return { 1: 367601, 2: 367301, 10: 367501 }[slot];
  }

  _cooldown(slot, changed = false) {
    const info = {
      skillId: this._skill(slot, this.clock()), slot, count: -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  attrBonus(attributes, now) {
    let value = super.attrBonus(attributes, now);
    if (!this.melee && attributes.includes(10) && this.hasBuff(367603, now)) {
      value = value.sub(D('1.5'));
    }
    return value;
  }

  on_spawn(now) {
    this.melee = false;
    this.ready = this.vanish = null;
    delete this.info.untargetable;
    delete this.info.damage_immune;
    this.cooldowns[1] = this.e_banks.false.end;
    return Object.keys(SLOTS).map(Number).map(slot => this._cooldown(slot, true));
  }

  blocked(action, now) {
    return Boolean(this.ready || this.vanish) || super.blocked(action, now);
  }

  cc_immune(now, options) { return this.ccImmune(now, options); }

  ccImmune(now, options) { return Boolean(this.vanish) || super.ccImmune(now, options); }

  rejectBuff(row, source, now) { return Boolean(this.vanish && source.camp !== this.camp); }

  _speed(now) { return this.ready || this.vanish ? 0 : super._speed(now); }

  removeBuff(template, now, { expired = false } = {}) {
    const packets = super.removeBuff(template, now, { expired });
    if ([367113, 367124, 367602].includes(template) && this.alive) {
      packets.push(this._cooldown(0, true));
    }
    return packets;
  }

  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  _switch(now) {
    this.e_banks[this.melee].end = this.cooldowns[1];
    this.melee = !this.melee;
    this.cooldowns[1] = this.e_banks[this.melee].end;
    const packets = [];
    for (const template of [367401, 367402, 367403, 367404, 367504, 367113, 367124]) {
      packets.push(...this.removeBuff(template, now));
    }
    const added = this.melee ? [367401, 367402, 367403, 367404] : [367501, 367504];
    for (const template of added) packets.push(...this._buff(template, now));
    for (const template of [367405, 367406, 367407]) packets.push(...this._buff(template, now));
    for (const slot of [0, 1, 10]) packets.push(this._cooldown(slot, true));
    return packets;
  }

  onBulletHit(flight, target, now) {
    if (flight.template !== 367100) return [];
    const packets = this._buff(367102, now, target.id);
    if (this.alive && this.generation === flight.source_generation) {
      this.cooldowns[10] = now + Math.round(Math.max(0, this.cooldowns[10] - now) * 0.85);
      packets.push(this._cooldown(10));
    }
    return packets;
  }

  _return(now) {
    this.ready = this.vanish = null;
    delete this.info.untargetable;
    delete this.info.damage_immune;
    return this.removeBuff(367303, now).concat(this.syncSpeed(now));
  }

  interrupt(now) { return this.alive ? [] : this._return(now); }

  _domain(cast, now) {
    const packets = [];
    const remaining = cast.end - now;
    if (remaining <= 0) {
      this.domains.delete(cast.id);
      return this.removeObject(cast.id);
    }
    const duration = Math.min(300, remaining);
    for (const target of enemies(this, { area: true })) {
      const pos = target.positionAt(now);
      const span = Math.hypot(pos[0] - cast.pos[0], pos[1] - cast.pos[1]);
      const locked = target.id === cast.target && target.generation === cast.target_generation;
      if (locked) {
        if (span > 264) cast.escaped = true;
        if (cast.escaped) {
          packets.push(...this._buff(367321, now, target.id, { duration }));
        }
      } else if (span <= 264 && !target.ccImmune(now)) {
        for (const template of [367308, 367309, 367313]) {
          packets.push(...this._buff(template, now, target.id, { duration }));
        }
        let [body, stopped] = prepareDisplacement(target, now);
        packets.push(...stopped);
        const distance = Math.hypot(body[0] - cast.pos[0], body[1] - cast.pos[1]);
        const speed = Math.round(Number(target.stats.iSpeed) * 1.5);
        const direction = distance ? body : [body[0] + 1, body[1]];
        const end = aimed(cast.pos, direction,
          distance + speed * Math.min(250, remaining) / 1000, { fixed: true });
        const elapsed = target._setMotion(body, end, Math.max(1, speed), now, 1);
        target.forcedUntil = now + elapsed;
        packets.push(scene({
          moves: [this._moveEvent(target.motion[1], Math.max(1, speed), 1, target.id)],
        }));
      }
    }
    if (this.alive && this.generation === cast.generation
      && Math.hypot(this.positionAt(now)[0] - cast.pos[0],
        this.positionAt(now)[1] - cast.pos[1]) <= 264) {
      packets.push(...this._buff(367310, now, null, { duration }));
    }
    this._queue(Math.min(now + 250, cast.end), 'hades_domain', cast);
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'hades_vanish') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      this.vanish = cast;
      this.info.untargetable = this.info.damage_immune = true;
      const [ident, packet] = this.addObject(367302, cast.start);
      this._queue(now + 1000, 'object_expire', ident);
      this._queue(now + 1000, 'hades_arrive', cast);
      return [packet].concat(this._buff(367303, now), this.syncSpeed(now));
    }
    if (kind === 'hades_arrive') {
      const [cast] = data;
      if (this.vanish !== cast || !this.alive) return [];
      const packets = this._return(now);
      const target = this.arena.actors.get(cast.target);
      if (!target || !target.alive || target.generation !== cast.target_generation) return packets;
      const pos = this.blinkDestination(cast.start, target.positionAt(now));
      this.position = pos;
      this.motion = null;
      this.forcedUntil = now;
      packets.push(scene({ moves: [this._moveEvent(pos, 0, 5)] }));
      packets.push(...this._buff(367311, now, target.id));
      for (const enemy of enemies(this, { area: true })) {
        if (Math.hypot(pos[0] - enemy.positionAt(now)[0],
          pos[1] - enemy.positionAt(now)[1]) <= 264) {
          packets.push(...this.damage(cast.power.mul(D('2.23')), now,
            { target: enemy, school: 'energy' })[0]);
          if (this.arena.pk && this.arena.pk.finished) return packets;
        }
      }
      const [ident, packet] = this.addObject(367312, pos);
      packets.push(packet);
      Object.assign(cast, { id: ident, pos, end: now + 4000 });
      this.domains.set(ident, cast);
      return packets.concat(this._domain(cast, now));
    }
    if (kind === 'hades_domain') return this._domain(data[0], now);
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if ([0, 1].includes(slot) && start[0] === dest[0] && start[1] === dest[1]) return [];
    const target = this.arena.actors.get(targetId);
    if (slot === 2) {
      if (!target || !enemies(this).includes(target)
        || Math.hypot(start[0] - target.positionAt(now)[0],
          start[1] - target.positionAt(now)[1]) > 480) return [];
      if (!teamVisible(this, target, now)) return [];
    }
    const skill = this._skill(slot, now), power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 6000, 2: 25000, 10: 6000 }[slot], slot);
    if (slot === 0 && !this.melee) {
      return this.shoot(skill, start, dest, now, power,
        { school: 'energy', basic: true }).concat([this._cooldown(0)]);
    }
    const packets = [scene({ skills: [this._skillEvent(skill, start, dest)] })];
    if (slot === 10) return packets.concat(this._switch(now), [this._cooldown(10)]);
    if (slot === 2) {
      this.position = start;
      this.motion = null;
      this.ready = {
        slot: 2, skill, start, power, generation: this.generation,
        target: target.id, target_generation: target.generation, end: now + 10,
      };
      for (const template of [367301, 367306, 367307]) {
        packets.push(...this._buff(template, now, target.id));
      }
      this._queue(now + 10, 'hades_vanish', this.ready);
      return packets.concat(this.syncSpeed(now), [this._cooldown(2)]);
    }
    const enhanced = this.melee && this.hasBuff(367602, now);
    let lostAny = false;
    for (const enemy of enemies(this, { area: true })) {
      const pos = enemy.positionAt(now);
      if (slot === 0) {
        if (!inCone(pos, start, dest, 168, 180)) continue;
        const marked = [367203, 367204, 367205, 367206].some(template =>
          enemy.hasBuff(template, now) && enemy.buffSources.get(template) === this.id);
        const [hit] = this.damage(power.mul(marked ? D('1.5') : D(1)), now, {
          target: enemy, school: 'energy', basic: true,
          lifesteal: enhanced ? D('1.8') : D('.3'),
        });
        packets.push(...hit, ...this._buff(367120, now, enemy.id));
      } else {
        if (this.melee) {
          if (Math.hypot(pos[0] - start[0], pos[1] - start[1]) > 192) continue;
        } else if (!inCone(pos, start, dest, 480, 45)) continue;
        const [hit, lost] = this.damage(power.mul(this.melee ? D('1.67') : D('1.32')),
          now, { target: enemy, school: 'energy' });
        packets.push(...hit);
        lostAny = lostAny || lost;
        if (!this.melee) {
          packets.push(...this._buff(367202, now, enemy.id, { duration: 2000 }));
          for (let template = 367203; template < 367207; template += 1) {
            packets.push(...this._buff(template, now, enemy.id));
          }
        }
      }
    }
    if (slot === 0) {
      const template = enhanced ? 367124 : 367113;
      packets.push(...(this.hasBuff(template, now)
        ? this.removeBuff(template, now) : this._buff(template, now)));
      packets.push(this._cooldown(0, true));
    } else {
      this.e_banks[this.melee].end = this.cooldowns[1];
      if (this.melee && lostAny) {
        packets.push(...this._buff(367602, now), ...this._buff(367603, now));
        packets.push(this._cooldown(0, true));
      }
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as HADES_SLOTS };
