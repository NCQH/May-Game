/* Phoenix (tank 10000059): burn clock, dash trails, shield-gated rebirth.
 * Port of server/phoenix_actions.py onto the JS battle core.
 *
 * Stubs: presentation only.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { prepareDisplacement } from './melee.js';

const SLOTS = { 0: 334010, 1: 334021, 2: 334031, 10: 334041 };

export class PhoenixActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.dash = this.egg = null;
    this.e_second_until = 0;
    this.burns = new Map();
    this.trail_hits = new Map();
  }

  _cooldown(slot, changed = false) {
    const second = slot === 1 && this.e_second_until > this.clock();
    const info = {
      skillId: second ? 334023 : SLOTS[slot], slot, count: -1,
      end: second ? 0 : this.cooldowns[slot], nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) { return this._buff(334101, now).concat([this._cooldown(1, true)]); }

  _speed(now) { return this.egg || this.dash ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.egg || this.dash) || super.blocked(action, now); }

  _burn(target, now) {
    if (!target.alive || target.rejectBuff({ nEffectType: '201' }, this, now)) return [];
    const key = `${target.id},${target.generation}`;
    const mark = this.burns.get(key);
    const fresh = !mark || mark.end < now || target.buffVersions.get(334111) !== mark.version;
    const packets = this._buff(334111, now, target.id).concat(this._buff(334112, now, target.id));
    if (!target.hasBuff(334111, now)) return packets;
    if (fresh) {
      const created = {
        target: target.id, target_generation: target.generation, end: now + 2000,
        version: target.buffVersions.get(334111),
      };
      this.burns.set(key, created);
      this._queue(now + 1000, 'phoenix_burn', created);
    } else {
      mark.end = now + 2000;
      mark.version = target.buffVersions.get(334111);
    }
    return packets;
  }

  _hurt(target, raw, now, { periodic = false } = {}) {
    const packets = this.damage(raw, now, { target, school: 'energy', periodic })[0];
    if (target.alive) packets.push(...this._burn(target, now));
    return packets;
  }

  _end_dash(now) {
    if (!this.dash) return [];
    this.dash = null;
    this.position = this.positionAt(now);
    this.motion = null;
    this.forcedUntil = now;
    const packets = [scene({ moves: [this._moveEvent(this.position, 0, 5)] })];
    for (const t of [334210, 334211, 334212, 334252, 334261]) packets.push(...this.removeBuff(t, now));
    return packets.concat(this.syncSpeed(now));
  }

  _end_egg(now, { success = false } = {}) {
    const cast = this.egg;
    this.egg = null;
    if (!cast) return [];
    const packets = this.removeObject(cast.id);
    for (const t of [334301, 334303, 334304, 334305, 334307]) packets.push(...this.removeBuff(t, now));
    packets.push(this.shieldPacket(now));
    if (success && this.alive) {
      packets.push(...this.restoreHp(this.maxHp.mul(D(5)), now), ...this._buff(334333, now));
      this.cooldowns[1] = this.cooldowns[10] = now;
      packets.push(this._cooldown(1), this._cooldown(10));
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(cast.pos[0] - target.positionAt(now)[0],
            cast.pos[1] - target.positionAt(now)[1]) <= 288) {
          packets.push(...this._buff(334332, now, target.id));
        }
      }
    } else {
      packets.push(...this._buff(334321, now));
    }
    return packets.concat(this.syncSpeed(now));
  }

  on_shield_break(template, now) { return template === 334304 ? this._end_egg(now) : []; }

  interrupt(now) {
    const packets = this._end_dash(now);
    if (!this.alive) {
      packets.push(...this._end_egg(now));
      this.e_second_until = 0;
    }
    return packets;
  }

  update(now) {
    const packets = [];
    if (this.e_second_until && now >= this.e_second_until) {
      this.e_second_until = 0;
      packets.push(...this.removeBuff(334232, now), this._cooldown(1, true), this._cooldown(1));
    }
    for (const [key, value] of [...this.trail_hits]) {
      if (!(value.end > now)) this.trail_hits.delete(key);
    }
    return packets.concat(super.update(now));
  }

  _event(now, kind, data) {
    if (kind === 'phoenix_burn') {
      const [mark] = data;
      const target = this.arena.actors.get(mark.target);
      if (!target || !target.alive || target.generation !== mark.target_generation
        || target.buffVersions.get(334111) !== mark.version) return [];
      const packets = this.damage(target.maxHp.mul(D('.03')), now,
        { target, school: 'energy', periodic: true })[0];
      if (now + 1000 <= mark.end) this._queue(now + 1000, kind, mark);
      return packets;
    }
    if (kind === 'phoenix_dash') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive) return [];
      if (!this.motion) return this._end_dash(now);
      const start = this.positionAt(cast.previous), end = this.positionAt(now);
      const packets = [];
      for (const target of [...this.arena.actors.values()]) {
        const key = `${target.id},${target.generation}`;
        if (target.alive && target.camp !== this.camp && !cast.hits.has(key)
          && !target.isUntargetable()
          && actorContact(start, end, target, cast.previous, now, 60) !== null) {
          cast.hits.add(key);
          packets.push(...this._hurt(target, cast.power.mul(D('1.38')), now));
          if (!cast.second && !cast.recast_granted) {
            cast.recast_granted = true;
            this.e_second_until = now + 3000;
            packets.push(...this._buff(334232, now), this._cooldown(1, true), this._cooldown(1));
          }
        }
      }
      if (now >= cast.end) return packets.concat(this._end_dash(now));
      cast.previous = now;
      this._queue(Math.min(now + 20, cast.end), kind, cast);
      return packets;
    }
    if (kind === 'phoenix_trail_create') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive) return [];
      const pos = this.positionAt(now);
      const [ident, packet] = this.addObject(334241, pos);
      const area = { id: ident, pos, power: cast.power, end: now + 3000 };
      this._queue(now + 1000, 'phoenix_trail', area);
      return [packet, scene({ skills: [this._skillEvent(334022, pos, pos, this.id)] })];
    }
    if (kind === 'phoenix_trail') {
      const [cast] = data;
      const packets = [];
      for (const target of [...this.arena.actors.values()]) {
        const key = `${target.id},${target.generation}`;
        if (target.alive && target.camp !== this.camp
          && Math.hypot(cast.pos[0] - target.positionAt(now)[0],
            cast.pos[1] - target.positionAt(now)[1]) <= 72) {
          if ((this.trail_hits.get(key)?.end ?? 0) > now) continue;
          this.trail_hits.set(key, { end: now + 1000 });
          packets.push(...this._buff(334251, now, target.id));
          packets.push(...this._hurt(target, cast.power.mul(D('.91')), now, { periodic: true }));
        }
      }
      if (now < cast.end) this._queue(now + 1000, kind, cast);
      else packets.push(...this.removeObject(cast.id));
      return packets;
    }
    if (kind === 'phoenix_egg') {
      const [cast, index] = data;
      if (this.egg !== cast || !this.alive) return [];
      const packets = [];
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(cast.pos[0] - target.positionAt(now)[0],
            cast.pos[1] - target.positionAt(now)[1]) <= 288) {
          packets.push(...this._hurt(target, cast.power.mul(D('.88')), now, { periodic: true }));
          packets.push(...this._buff(334312, now, target.id), ...this._buff(334313, now, target.id));
        }
      }
      if (index === 5) {
        const survived = this.shields.some(s => s.shield_id === '334304' && s.remaining.gt(0));
        return packets.concat(this._end_egg(now, { success: survived }));
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || !this.alive || this.skillSealed(slot, now) || this.egg) return [];
    if (slot !== 2 && this.blocked('attack', now)) return [];
    const second = slot === 1 && this.e_second_until > now;
    if (!second && this.cooldowns[slot] > now) return [];
    if ((slot === 0 || slot === 1)
      && (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1]))) return [];
    const power = this.combatStat('iEgAtk', now);
    if (!second) {
      this.cooldowns[slot] = now + this.skillCooldown({
        0: this.fireInterval(now), 1: 6000, 2: 25000, 10: 8000,
      }[slot], slot);
    }
    if (slot === 0) {
      return this.shoot(334010, start, dest, now, power,
        { school: 'energy', basic: true }).concat([this._cooldown(0)]);
    }
    const packets = [];
    if (slot === 1) {
      if (second) {
        this.e_second_until = 0;
        packets.push(...this.removeBuff(334232, now), this._cooldown(1, true));
      }
      const span = Math.hypot(dest[0] - start[0], dest[1] - start[1]);
      dest = pointAt(start, dest, 432 / span);
      let origin;
      let stopped;
      [origin, stopped] = prepareDisplacement(this, now, { interrupt: false });
      origin = stopped.length ? origin : start;
      const duration = this._setMotion(origin, dest, 600, now, 3);
      this.forcedUntil = now + duration;
      this.dash = {
        previous: now, end: now + duration, power, hits: new Set(),
        second, recast_granted: false,
      };
      for (let offset = 144; offset <= duration; offset += 144) {
        this._queue(now + offset, 'phoenix_trail_create', this.dash);
      }
      this._queue(now + Math.min(20, duration), 'phoenix_dash', this.dash);
      for (const t of [334210, second ? 334261 : 334211, 334212, 334252]) {
        packets.push(...this._buff(t, now, null, { duration }));
      }
      packets.push(...stopped);
      packets.push(scene({
        skills: [this._skillEvent(second ? 334023 : 334021, start, this.motion[1])],
        moves: [this._moveEvent(this.motion[1], 600, 3)],
      }));
    } else if (slot === 10) {
      packets.push(scene({ skills: [this._skillEvent(334041, start, start, this.id)] }));
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(start[0] - target.positionAt(now)[0],
            start[1] - target.positionAt(now)[1]) <= 192) {
          packets.push(...this._hurt(target, power.mul(D('2.14')), now));
          packets.push(...this._buff(334411, now, target.id), ...this._buff(334412, now, target.id));
        }
      }
    } else {
      packets.push(...this._end_dash(now), ...this._buff(334301, now));
      packets.push(...this.commitHp(D(1).max(this.hp.sub(this.maxHp.mul(D('.5')))), now));
      const [ident, packet] = this.addObject(334306, start);
      this.egg = { id: ident, pos: start, power, end: now + 2500 };
      for (let index = 1; index <= 5; index += 1) {
        this._queue(now + index * 500, 'phoenix_egg', this.egg, index);
      }
      for (const t of [334303, 334305, 334307]) packets.push(...this._buff(t, now));
      packets.push(...this.addShield(334304, this.maxHp.mul(D('.5')), now, { duration: 2500 }));
      packets.push(packet, scene({ skills: [this._skillEvent(334031, start, start, this.id)] }));
    }
    return packets.concat([this._cooldown(slot)], this.syncSpeed(now));
  }
}

export { SLOTS as PHOENIX_SLOTS };
