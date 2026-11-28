/* Diao Chan (tank 10000074): nonrecursive marks, charm, returning fans.
 * Port of server/diaochan_actions.py onto the JS battle core.
 *
 * Stubs: presentation only; team visibility uses batch-c-common.teamVisible.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1562, encodeS1572 } from '../protocol.js';
import { packII, prepareDisplacement } from './melee.js';
import { teamVisible } from './batch-c-common.js';

const SLOTS = { 0: 348100, 1: 348201, 2: 348301, 10: 348401 };
const MARKS = [348111, 348112, 348113, 348114];

export class DiaoChanActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = this.dash = null;
    this.space_count = 3;
    this.space_next_charge = 0;
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: slot === 2 ? this.space_count : -1,
      end: this.cooldowns[slot], nextCharge: slot === 2 ? this.space_next_charge : 0,
    })];
  }

  on_spawn(now) { return this._buff(348101, now).concat(this._buff(348102, now)); }

  _speed(now) { return this.ready || this.dash ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready || this.dash) || super.blocked(action, now); }

  interrupt(now) {
    const packets = [];
    if (this.ready) packets.push([1583, packII(this.id, SLOTS[this.ready.slot])]);
    this.ready = this.dash = null;
    if (this.motion) {
      this.position = this.positionAt(now);
      this.motion = null;
      this.forcedUntil = now;
      packets.push(scene({ moves: [this._moveEvent(this.position, 0, 5)] }));
    }
    return packets.concat(this.syncSpeed(now));
  }

  update(now) {
    const packets = this.ready && this.skillSealed(this.ready.slot, now) ? this.interrupt(now) : [];
    while (this.space_next_charge && this.space_next_charge <= now) {
      this.space_count = Math.min(3, this.space_count + 1);
      this.space_next_charge = this.space_count < 3
        ? this.space_next_charge + this.skillCooldown(8000) : 0;
      packets.push(this._cooldown(2));
    }
    return packets.concat(super.update(now));
  }

  _mark(target, power, generation, now) {
    if (!target.alive || target.rejectBuff({ nEffectType: '49' }, this, now)) return [];
    let count = 0;
    for (let i = 0; i < MARKS.length; i += 1) if (target.hasBuff(MARKS[i], now)) count = i + 1;
    const packets = [];
    for (const t of MARKS) if (target.hasBuff(t, now)) packets.push(...target.removeBuff(t, now));
    if (count < 4) return packets.concat(this._buff(MARKS[count], now, target.id));
    const pos = target.positionAt(now);
    packets.push(...this._buff(348122, now, target.id));
    for (const victim of [...this.arena.actors.values()]) {
      if (victim.alive && victim.camp !== this.camp
        && Math.hypot(pos[0] - victim.positionAt(now)[0], pos[1] - victim.positionAt(now)[1]) <= 192) {
        packets.push(...this.damage(power, now, {
          target: victim, school: 'true',
          lifesteal: this.alive && generation === this.generation ? D('.25') : 0,
        })[0]);
        packets.push(...this._buff(348123, now, victim.id));
      }
    }
    return packets;
  }

  _impact(flight, target, now) {
    const packets = this.damage(flight.raw, now, {
      target, school: 'energy',
      lifesteal: this.alive && flight.source_generation === this.generation ? D('.25') : 0,
    })[0];
    packets.push(...this._mark(target, flight.power, flight.source_generation, now));
    if ([348211, 348301, 348311].includes(flight.template)) {
      packets.push(...this._buff(348313, now, target.id));
    }
    if ([348301, 348311].includes(flight.template)
      && this.alive && flight.source_generation === this.generation) {
      for (const slot of [1, 10]) {
        this.cooldowns[slot] = now + Math.round(Math.max(0, this.cooldowns[slot] - now) * 0.7);
        packets.push(this._cooldown(slot));
      }
    }
    if (flight.template === 348401 && target.alive) {
      if (this.arena.pk && this.arena.pk.finished) return packets;
      for (const t of [348402, 348403, 348404]) packets.push(...this._buff(t, now, target.id));
      if (target.hasBuff(348402, now) && target.buffSources.get(348402) === this.id) {
        const charm = {
          target: target.id, target_generation: target.generation,
          version: target.buffVersions.get(348402), end: now + 1000,
        };
        const [, stopped] = prepareDisplacement(target, now);
        packets.push(...stopped);
        packets.push(...this._charm(charm, now));
      }
    }
    return packets;
  }

  _charm(cast, now) {
    const target = this.arena.actors.get(cast.target);
    if (!target || !target.alive || target.generation !== cast.target_generation
      || !target.hasBuff(348402, now) || target.buffVersions.get(348402) !== cast.version) return [];
    const start = target.positionAt(now), center = this.positionAt(now);
    const span = Math.hypot(start[0] - center[0], start[1] - center[1]);
    const speed = Math.max(1, pyRound(Number(target.stats.iSpeed) * 0.5));
    const step = Math.min(100, cast.end - now);
    const packets = [];
    if (span > 72) {
      const [origin, stopped] = prepareDisplacement(target, now, { interrupt: false });
      packets.push(...stopped);
      const remaining = Math.hypot(origin[0] - center[0], origin[1] - center[1]);
      const dest = pointAt(origin, center,
        Math.min(speed * step / 1000, Math.max(0, remaining - 72)) / Math.max(1, remaining));
      const duration = target._setMotion(origin, dest, speed, now, 1);
      target.forcedUntil = now + duration;
      packets.push(scene({ moves: [target._moveEvent(target.motion[1], speed, 1)] }));
    }
    if (now + step < cast.end) this._queue(now + step, 'diao_charm', cast);
    return packets;
  }

  _flight(flight, now) {
    if (flight.template === 348100) return super._flight(flight, now);
    const returning = flight.template === 348311;
    const fan = flight.template === 348301 || flight.template === 348311;
    if (fan && (!this.alive || this.generation !== flight.source_generation)) {
      return [scene({ expiredBullets: [flight.id] })];
    }
    const previous = flight.previous;
    const homing = returning ? this : this.arena.actors.get(flight.target);
    const packets = [];
    let reached;
    let start;
    let end;
    if (homing) {
      if (!homing.alive || homing.generation !== flight.target_generation
        || (!returning && homing.isUntargetable())) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      start = flight.pos;
      const dest = homing.positionAt(now);
      end = pointAt(start, dest, Math.min(1,
        flight.speed * (now - previous) / 1000 / Math.max(1,
          Math.hypot(dest[0] - start[0], dest[1] - start[1]))));
      if (dest[0] !== flight.end[0] || dest[1] !== flight.end[1]) {
        packets.push([1562, encodeS1562(flight.id, start, dest)]);
        flight.end = dest;
      }
      reached = Math.hypot(end[0] - dest[0], end[1] - dest[1]) < 1;
    } else {
      start = pointAt(flight.start, flight.end,
        (previous - flight.begin) / (flight.finish - flight.begin));
      end = pointAt(flight.start, flight.end,
        Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
      reached = now >= flight.finish;
    }
    const candidates = homing && !returning ? [homing] : [...this.arena.actors.values()];
    const contacts = [];
    for (const target of candidates) {
      const key = `${target.id},${target.generation}`;
      if (target.alive && target.camp !== this.camp && !target.isUntargetable()
        && !flight.hits.has(key)) {
        const hit = actorContact(start, end, target, previous, now,
          fan ? 84 : flight.template === 348401 ? 72 : 36);
        if (hit !== null) contacts.push([hit, target.id]);
      }
    }
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [, ident] of contacts) {
      const target = this.arena.actors.get(ident);
      if (this.projectileBlocked(target, now)) {
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
      flight.hits.add(`${target.id},${target.generation}`);
      packets.push(...this._impact(flight, target, now));
      if (!fan) return packets.concat([scene({ blownBullets: [flight.id] })]);
    }
    flight.pos = end;
    if (reached || now >= flight.begin + 5000) {
      packets.push(scene({ expiredBullets: [flight.id] }));
      if (fan && !returning) {
        const pos = end.map(pyRound);
        const dest = this.positionAt(now);
        const speed = Math.max(1, pyRound(240 * (1 + this.attrBonus([37], now).toNumber())));
        const duration = Math.max(1, Math.ceil(
          Math.hypot(dest[0] - pos[0], dest[1] - pos[1]) * 1000 / speed));
        const ret = {
          ...flight, id: this._newId(2), template: 348311, start: pos, end: dest, pos,
          begin: now, previous: now, finish: now + duration, speed,
          target: this.id, target_generation: this.generation,
          raw: flight.power.mul(D('1.8')), hits: new Set(),
        };
        packets.push(scene({ fires: [{ bulletId: ret.id, ownerId: this.id, start: pos, dest,
          speed, templateId: 348311 }] }));
        this._queue(now + Math.min(20, duration), 'flight', ret);
      }
      return packets;
    }
    flight.previous = now;
    if (homing) {
      flight.finish = Math.min(flight.begin + 5000,
        now + Math.max(1, Math.ceil(Math.hypot(
          end[0] - homing.positionAt(now)[0], end[1] - homing.positionAt(now)[1]) * 1000 / flight.speed)));
    }
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'diao_flowers') {
      const [cast, index] = data;
      if (!this.alive || cast.generation !== this.generation) return [];
      const start = this.positionAt(now);
      const candidates = [...this.arena.actors.values()].filter(a => a.alive && a.camp !== this.camp
        && !a.isUntargetable()
        && Math.hypot(start[0] - a.positionAt(now)[0], start[1] - a.positionAt(now)[1])
        <= (index === 0 ? 336 : 480)
        && teamVisible(this, a, now));
      if (index === 0 && !candidates.length) return [];
      const packets = [];
      if (candidates.length) {
        candidates.sort((a, b) => (Number(Boolean(a.info.npc_template)) - Number(Boolean(b.info.npc_template)))
          || (Math.hypot(start[0] - a.positionAt(now)[0], start[1] - a.positionAt(now)[1])
            - Math.hypot(start[0] - b.positionAt(now)[0], start[1] - b.positionAt(now)[1]))
          || (a.id - b.id));
        const target = candidates[0];
        packets.push(...this.shoot(348211, start, target.positionAt(now), now,
          cast.power.mul(D('.5')), {
            school: 'energy', target, power: cast.power, through_walls: true,
          }));
      }
      if (index < 3) this._queue(now + 150, kind, cast, index + 1);
      return packets;
    }
    if (kind === 'diao_charm') return this._charm(data[0], now);
    if (kind === 'diao_dash_end') {
      const [cast] = data;
      if (this.dash !== cast) return [];
      const [origin, stopped] = prepareDisplacement(this, now, { interrupt: false });
      this.dash = null;
      this.position = origin;
      this.motion = null;
      this.forcedUntil = now;
      return stopped.concat(this.syncSpeed(now));
    }
    if (kind === 'diao_cast') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.skillSealed(cast.slot, now)) {
        return this.ready === cast ? this.interrupt(now) : [];
      }
      this.ready = null;
      const start = this.positionAt(now), slot = cast.slot;
      const packets = [scene({ skills: [this._skillEvent(SLOTS[slot], start, cast.dest)] })];
      if (slot === 1) {
        const duration = this._setMotion(start, cast.dest, 960, now, 3);
        this.forcedUntil = now + duration;
        this.dash = cast;
        this._queue(now + duration, 'diao_dash_end', cast);
        this._queue(now + 200, 'diao_flowers', cast, 0);
        for (const t of [348202, 348203, 348204, 348205, 348211]) {
          packets.push(...this._buff(t, now, null, { duration: t === 348202 ? 1000 : null }));
        }
        packets.push(scene({ moves: [this._moveEvent(this.motion[1], 960, 3)] }));
      } else if (slot === 10) {
        packets.push(...this.shoot(348401, start, cast.dest, now, cast.power.mul(D('1.52')), {
          school: 'energy', power: cast.power, through_walls: true,
        }));
      } else {
        const theta = Math.atan2(cast.dest[1] - start[1], cast.dest[0] - start[0]);
        for (const offset of [-15, 0, 15]) {
          const angle = theta + offset * Math.PI / 180;
          const dest = [start[0] + pyRound(480 * Math.cos(angle)),
            start[1] + pyRound(480 * Math.sin(angle))];
          packets.push(...this.shoot(348301, start, dest, now, cast.power.mul(D('.6')), {
            school: 'energy', power: cast.power, through_walls: true,
          }));
        }
      }
      return packets.concat(this.syncSpeed(now));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1])
      || (slot === 2 && !this.space_count)) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown({
      0: this.fireInterval(now), 1: 6000, 2: 3000, 10: 8000,
    }[slot], slot);
    if (slot === 0) {
      return this.shoot(348100, start, dest, now, power,
        { school: 'energy', basic: true }).concat([this._cooldown(0)]);
    }
    if (slot === 1) {
      const span = Math.hypot(dest[0] - start[0], dest[1] - start[1]);
      dest = this.moveDestination(start, pointAt(start, dest, 360 / span));
    }
    this.ready = { slot, dest, power, generation: this.generation };
    const [origin, stopped] = prepareDisplacement(this, now, { interrupt: false });
    this.position = stopped.length ? origin : start;
    this.motion = null;
    this._queue(now + 100, 'diao_cast', this.ready);
    const packets = [];
    if (slot === 2) {
      this.space_count -= 1;
      if (!this.space_next_charge) this.space_next_charge = now + this.skillCooldown(8000);
      packets.push(...this._buff(348321, now));
    }
    return packets.concat([this._cooldown(slot),
      scene({ skills: [this._skillEvent(SLOTS[slot], start, dest, 0, { ready: 1 })] })],
    this.syncSpeed(now), stopped);
  }
}

export { SLOTS as DIAOCHAN_SLOTS, MARKS as DIAOCHAN_MARKS };
