/* Zhao Yun (tank 10000067): separate charge clocks, real-HP rage and a
 * damage-free Space. Port of server/zhaoyun_actions.py.
 *
 * Stubs: no skin/presentation; water reclip is not recorded by the JS core.
 * Native S1590 aim prompts use privatePacket(0, 1590) with an empty body.
 */
import { TankActions, human, privatePacket } from '../arena.js';
import { D, actorContact } from '../math.js';
import { scene, stop_move, encodeS1572 } from '../protocol.js';
import { aimed, enemies, inCone, inStrip, packII, prepareDisplacement } from './melee.js';
import { samePosition } from './batch-d-common.js';

const SLOTS = { 0: 342100, 1: 342201, 2: 342301, 10: 342401 };

export class ZhaoYunActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.e_count = this.r_count = 2;
    this.e_next_charge = this.r_next_charge = 0;
    this.rage_damage = D(0);
    this.ready = this.channel = this.dash = null;
    this.r_visual = null;
  }

  _cooldown(slot) {
    if (!(slot in SLOTS)) {
      return [1572, encodeS1572(this.id, {
        skillId: this.skillForSlot(slot) ?? 0, slot, count: -1,
        end: this.cooldowns[slot] ?? 0, nextCharge: 0,
      })];
    }
    const count = slot === 1 ? this.e_count : slot === 10 ? this.r_count : -1;
    const nextCharge = slot === 1 ? this.e_next_charge : slot === 10 ? this.r_next_charge : 0;
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count, end: this.cooldowns[slot], nextCharge,
    })];
  }

  on_spawn(now) {
    this.rage_damage = D(0);
    return this._buff(342101, now);
  }

  attr_bonus(attributes, now) {
    let value = super.attrBonus(attributes, now);
    if (attributes.includes(2) && this.hasBuff(342102, now)) {
      value = value.add(D('.05').mul(D(this.buffStacks.get(342102) ?? 0)));
    }
    return value;
  }

  damage(raw, now, options = {}) {
    let current = this.alive;
    const flight = this.arena.currentFlight;
    if (flight) current = current && flight.source_generation === this.generation;
    if (current) {
      const count = this.hasBuff(342103, now) ? (this.buffStacks.get(342103) ?? 0) : 0;
      options.lifesteal = (options.basic ? D('.25') : D('.5'))
        .add(D('.15').mul(D(count)));
    }
    return super.damage(raw, now, options);
  }

  on_damage(source, hit, now, school, reflected, attacker_ap) {
    if (!this.alive || hit.hp_loss.le(0)) return [];
    const count = Math.min(10,
      (this.hasBuff(342102, now) ? (this.buffStacks.get(342102) ?? 0) : 0) + 1);
    const packets = this._buff(342102, now, null, { stacks: count })
      .concat(this._buff(342103, now, null, { stacks: count }));
    this.rage_damage = this.rage_damage.add(hit.hp_loss);
    const step = this.maxHp.mul(D('.05'));
    const ticks = this.rage_damage.div(step).floor();
    this.rage_damage = this.rage_damage.sub(step.mul(D(ticks)));
    for (const [slot, field] of [[1, 'e_next_charge'], [10, 'r_next_charge']]) {
      if (ticks && this[field]) {
        this[field] = Math.max(now, this[field] - 500 * ticks);
        packets.push(this._cooldown(slot));
      }
    }
    return packets;
  }

  _speed(now) { return this.ready || this.channel ? 0 : super._speed(now); }

  blocked(action, now) {
    return Boolean(this.ready || this.channel || this.dash) || super.blocked(action, now);
  }

  _stopPackets(packets, position, movement = []) {
    const attrs = packets.filter(p => p[0] === 1560);
    const stop = stop_move(this.sceneId, this.id, position);
    return packets.filter(p => p[0] !== 1560 && p !== stop && !movement.includes(p))
      .concat([stop], movement, attrs);
  }

  interrupt(now) {
    const packets = [];
    if (this.ready || this.channel || this.dash) {
      let pos = this.positionAt(now);
      if (this.dash) {
        const origin = this.motion ? this.motion[0] : (this.dash.start || pos);
        pos = this.moveDestination(origin, pos);
      }
      this.position = pos;
      this.motion = null;
      packets.push(stop_move(this.sceneId, this.id, pos));
    }
    if (this.ready) packets.push([1583, packII(this.id, 342301)]);
    if (this.channel || this.r_visual) packets.push([1583, packII(this.id, 342401)]);
    const controlled = Boolean(this.channel || this.dash);
    this.r_visual = null;
    this.ready = this.channel = this.dash = null;
    this.forcedUntil = now;
    if (controlled) {
      for (const template of [342211, 342402, 342403, 50353]) {
        packets.push(...this.removeBuff(template, now));
      }
    }
    return packets.concat(this.syncSpeed(now));
  }

  update(now) {
    const packets = [];
    for (const [slot, prefix] of [[1, 'e'], [10, 'r']]) {
      let count = this[`${prefix}_count`];
      let nextCharge = this[`${prefix}_next_charge`];
      while (nextCharge && nextCharge <= now) {
        count = Math.min(2, count + 1);
        nextCharge = count < 2 ? nextCharge + this.skillCooldown(8000) : 0;
        this[`${prefix}_count`] = count;
        this[`${prefix}_next_charge`] = nextCharge;
        packets.push(this._cooldown(slot));
      }
    }
    if (this.ready && this.skillSealed(2, now)) packets.push(...this.interrupt(now));
    return packets.concat(super.update(now));
  }

  _event(now, kind, data) {
    if (kind === 'zhao_visual_end') {
      const [cast] = data;
      if (this.r_visual !== cast) return [];
      this.r_visual = null;
      return [[1583, packII(this.id, 342401)]];
    }
    if (kind === 'zhao_dash') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive) return [];
      const start = this.positionAt(cast.previous), end = this.positionAt(now);
      const packets = [];
      for (const target of enemies(this)) {
        const key = `${target.id},${target.generation}`;
        if (cast.hits.has(key)
          || actorContact(start, end, target, cast.previous, now) === null) continue;
        cast.hits.add(key);
        packets.push(...this.damage(cast.power.mul(D('2.06')), now, { target })[0]);
        for (const template of [342205, 342206, 342208]) {
          packets.push(...this._buff(template, now, target.id));
        }
        packets.push(...this._buff(342207, now, null, { duration: 3000 }));
        if (target.alive && !target.ccImmune(now) && this.motion) {
          packets.push(...target.interrupt(now));
          const duration = target._setMotion(target.positionAt(now), this.motion[1], 600, now, 1);
          target.forcedUntil = now + duration;
          packets.push(scene({ moves: [this._moveEvent(target.motion[1], 600, 1, target.id)] }));
        }
      }
      if (!this.motion || now >= Math.min(cast.end, this.motion[3])) {
        this.position = end;
        this.motion = null;
        packets.push(stop_move(this.sceneId, this.id, end));
        this.dash = null;
        this.forcedUntil = now;
        packets.push(...this.removeBuff(342211, now), ...this.removeBuff(50353, now));
        return packets;
      }
      cast.previous = now;
      this._queue(Math.min(now + 20, this.motion[3]), kind, cast);
      return packets;
    }
    if (kind === 'zhao_stab') {
      const [cast, index] = data;
      if (this.channel !== cast || !this.alive) return [];
      const start = this.positionAt(now);
      const packets = this.r_visual ? [[1583, packII(this.id, 342401)]] : [];
      this.r_visual = cast;
      packets.push(scene({ skills: [this._skillEvent(342401, start, cast.dest)] }));
      for (const target of enemies(this, { area: true })) {
        if (inCone(target.positionAt(now), start, cast.dest, 240, 90)) {
          let raw = cast.power.mul(D('.5'));
          if (target.hasBuff(342208, now) && target.buffSources.get(342208) === this.id) {
            raw = raw.mul(D('1.25'));
          }
          packets.push(...this.damage(raw, now, { target })[0]);
        }
      }
      if (index === 5) {
        this.channel = null;
        this._queue(now + 200, 'zhao_visual_end', cast);
        packets.push(stop_move(this.sceneId, this.id, start));
        packets.push(...this.removeBuff(342402, now), ...this.removeBuff(342403, now),
          ...this.removeBuff(50353, now), ...this.syncSpeed(now));
      } else if (human(this) && !cast.aim_pending) {
        cast.aim_pending = true;
        packets.push(privatePacket(this, [1590, new Uint8Array(0)]));
      }
      return packets;
    }
    if (kind === 'zhao_field') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      const packets = [];
      cast.targets = [];
      for (const target of enemies(this, { area: true })) {
        if (inStrip(target.positionAt(now), cast.start, cast.dest, 480, 192)) {
          const version = target.buffVersions.get(342304) ?? 0;
          packets.push(...this._buff(342304, now, target.id));
          if ((target.buffVersions.get(342304) ?? 0) !== version) {
            cast.targets.push([target.id, target.generation]);
          }
        }
      }
      this._queue(now + 1000, 'zhao_pull', cast);
      return packets.concat(this.syncSpeed(now));
    }
    if (kind === 'zhao_pull') {
      const [cast] = data;
      const center = [cast.start[0] + (cast.dest[0] - cast.start[0]) / 2,
        cast.start[1] + (cast.dest[1] - cast.start[1]) / 2];
      const packets = [];
      for (const [ident, generation] of cast.targets) {
        const target = this.arena.actors.get(ident);
        if (!target || !target.alive || target.generation !== generation
          || !target.isAreaTargetable() || target.ccImmune(now)) continue;
        const version = target.buffVersions.get(342304) ?? 0;
        packets.push(...this._buff(342304, now, target.id));
        if ((target.buffVersions.get(342304) ?? 0) === version || !target.alive
          || !target.isAreaTargetable() || target.ccImmune(now)) continue;
        packets.push(...target.interrupt(now));
        const pos = target.stopPosition(now);
        target.position = target.moveDestination(pos, center);
        target.motion = null;
        packets.push(stop_move(this.sceneId, target.id, target.position));
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  handle(message, payload) {
    if (message === 510) {
      const now = this.clock();
      const packets = this.arena.tick(now);
      if (!this.arena.inputOpen(now, this)) return packets;
      if (this.channel && this.channel.aim_pending && payload.length >= 12) {
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        const sceneId = view.getUint32(0, true);
        const x = view.getInt16(8, true), y = view.getInt16(10, true);
        if (sceneId === this.sceneId) {
          this.channel.dest = [x, y];
          this.channel.aim_pending = false;
        }
      }
      return packets;
    }
    if (message === 514) {
      const now = this.clock();
      const packets = this.arena.tick(now);
      if (!this.arena.inputOpen(now, this)) return packets;
      if (this.channel && payload.length === 8) {
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        const sceneId = view.getUint32(0, true);
        const x = view.getInt16(4, true), y = view.getInt16(6, true);
        if (sceneId === this.sceneId) this.channel.dest = [x, y];
      }
      return packets;
    }
    return super.handle(message, payload);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (samePosition(start, dest) || !this._inside(dest) || (slot === 1 && !this.e_count)
      || (slot === 10 && !this.r_count)) return [];
    const power = this.combatStat('iAttack', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 1500, 2: 25000, 10: 1500 }[slot], slot);
    if (slot === 1 || slot === 10) {
      const prefix = slot === 1 ? 'e' : 'r';
      this[`${prefix}_count`] -= 1;
      if (!this[`${prefix}_next_charge`]) {
        this[`${prefix}_next_charge`] = now + this.skillCooldown(8000);
      }
    }
    const packets = [this._cooldown(slot)];
    if (slot === 0) {
      return packets.concat(this.shoot(342100, start, dest, now, power,
        { school: 'physical', basic: true }));
    }
    if (slot === 1) {
      const intended = aimed(start, dest, 360, { fixed: true });
      let body, stopped;
      [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      body = stopped.length ? body : start;
      const duration = this._setMotion(body, intended, 600, now, 3);
      this.forcedUntil = now + duration;
      this.dash = {
        start, previous: now, end: now + duration, power, hits: new Set(),
        generation: this.generation,
      };
      this._queue(now + Math.min(20, duration), 'zhao_dash', this.dash);
      packets.push(...this._buff(50353, now),
        ...this._buff(342211, now, null, { duration }));
      return this._stopPackets(packets, body,
        [scene({ moves: [this._moveEvent(this.motion[1], 600, 3)] })]);
    }
    let body, stopped;
    [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
    body = stopped.length ? body : start;
    this.position = body;
    this.motion = null;
    if (slot === 10) {
      this.channel = {
        dest, power, generation: this.generation, end: now + 1000, aim_pending: human(this),
      };
      for (let index = 1; index <= 5; index += 1) {
        this._queue(now + index * 200, 'zhao_stab', this.channel, index);
      }
      packets.push(...this._buff(50353, now),
        ...this._buff(342402, now, null, { duration: 1000 }),
        ...this._buff(342403, now, null, { duration: 1000 }));
      const priv = human(this) ? [privatePacket(this, [1590, new Uint8Array(0)])] : [];
      return this._stopPackets(packets.concat(priv, this.syncSpeed(now)), body);
    }
    this.ready = {
      slot: 2, start, dest: aimed(start, dest, 480, { fixed: true }),
      generation: this.generation,
    };
    this._queue(now + 100, 'zhao_field', this.ready);
    return this._stopPackets(packets.concat([
      scene({ skills: [this._skillEvent(342301, start, this.ready.dest, 0, { ready: 1 })] }),
    ], this.syncSpeed(now)), body);
  }
}

export { SLOTS as ZHAOYUN_SLOTS };
