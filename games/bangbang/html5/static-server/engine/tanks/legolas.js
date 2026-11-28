/* Legolas (tank 10000041): consumable marks, piercing arrows, rain/roots.
 * Port of server/legolas_actions.py onto the JS battle core.
 *
 * Stubs: presentation only. Marks are consumed by basic hits, E detonates the
 * current stage, and R triggers marks before its delayed rain field.
 */
import { TankActions, TANK_CONTACT_RADIUS } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, stop_move, encodeS1572 } from '../protocol.js';
import { packII, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 315100, 1: 315201, 2: 315301, 10: 315401 };
const MARKS = [315101, 315102, 315103];

export class LegolasActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.e_count = 3;
    this.e_next_charge = 0;
    this.ready = null;
    this.fields = new Map();
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: slot === 1 ? this.e_count : -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: slot === 1 ? this.e_next_charge : 0,
    })];
  }

  update(now) {
    const packets = super.update(now);
    if (this.e_next_charge && now >= this.e_next_charge) {
      while (this.e_count < 3 && now >= this.e_next_charge) {
        this.e_count += 1;
        this.e_next_charge += this.skillCooldown(6000);
      }
      if (this.e_count === 3) this.e_next_charge = 0;
      packets.push(this._cooldown(1));
    }
    return packets;
  }

  blocked(action, now) { return super.blocked(action, now) || this.ready !== null; }

  interrupt(now) {
    if (this.ready === null) return [];
    this.ready = null;
    return [[1583, packII(this.id, 315401)]];
  }

  _stage(target, now) {
    let stage = 0;
    for (let i = 0; i < MARKS.length; i += 1) {
      if (target.hasBuff(MARKS[i], now) && target.buffSources.get(MARKS[i]) === this.id) {
        stage = i + 1;
      }
    }
    return stage;
  }

  onBulletHit(flight, target, now) {
    if (flight.template !== 315100 || flight.source_generation !== this.generation
      || !this.alive || !target.alive) return [];
    const stage = Math.min(3, this._stage(target, now) + 1);
    const packets = [];
    for (const template of MARKS) {
      if (target.hasBuff(template, now)) packets.push(...target.removeBuff(template, now));
    }
    return packets.concat(this._buff(MARKS[stage - 1], now, target.id),
      this._buff(315121, now));
  }

  _field(template, pos, power, now, duration, kind, generation) {
    const [ident, packet] = this.addObject(template, pos);
    this.fields.set(ident, { id: ident, pos, power, end: now + duration, kind, generation });
    this._queue(now + duration, kind, ident);
    return [packet];
  }

  _detonate(target, power, generation, now) {
    const stage = this._stage(target, now);
    if (!stage || !target.alive) return [];
    const packets = [];
    for (const template of MARKS) {
      if (target.hasBuff(template, now)) packets.push(...target.removeBuff(template, now));
    }
    packets.push(...this._buff(315112, now, target.id));
    if (stage === 3) {
      return packets.concat(this._field(315104, target.positionAt(now), power, now, 400,
        'mark_blast', generation));
    }
    const vamp = this.alive && this.generation === generation ? D('.5') : D(0);
    return packets.concat(this.damage(power.mul(stage === 1 ? D('.5') : D(1)), now,
      { target, lifesteal: vamp, school: 'physical' })[0]);
  }

  _push(target, start, now) {
    if (target.ccImmune(now)) return [];
    const current = target.positionAt(now);
    const span = Math.hypot(start[0] - current[0], start[1] - current[1]);
    if (!span) return [];
    const origin = target.stopPosition(now);
    const safeDistance = Math.hypot(start[0] - origin[0], start[1] - origin[1]);
    let dest = safeDistance
      ? pointAt(start, origin, 1 + 72 / safeDistance)
      : pointAt(start, current, 72 / span);
    dest = this.arena.geometry.clampTankPosition(dest);
    const wall = this.arena.geometry.wallContact(origin, dest, TANK_CONTACT_RADIUS);
    if (wall !== null) dest = pointAt(origin, dest, Math.max(0, wall - 0.001));
    dest = dest.map(pyRound);
    const moved = origin[0] !== current[0] || origin[1] !== current[1];
    if (moved) { target.position = origin; target.motion = null; }
    const packets = target.interrupt(now);
    if (moved) packets.push(stop_move(target.sceneId, target.id, origin));
    target.forcedUntil = now + target._setMotion(origin, dest, 720, now, 3);
    dest = target.motion[1];
    return packets.concat([scene({ moves: [this._moveEvent(dest, 720, 3, target.id)] })]);
  }

  _event(now, kind, data) {
    if (kind === 'rain_cast') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.generation !== cast.generation) return [];
      this.ready = null;
      const packets = [];
      // Effect315401 triggers existing marks before the delayed rain.
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(cast.dest[0] - target.positionAt(now)[0],
            cast.dest[1] - target.positionAt(now)[1]) <= 144) {
          packets.push(...this._detonate(target, cast.power, cast.generation, now));
        }
      }
      return packets.concat(this._field(315402, cast.dest, cast.power, now, 500,
        'rain_start', cast.generation));
    }
    if (['mark_blast', 'root_start', 'rain_start', 'root_tick', 'rain_tick'].includes(kind)) {
      const field = this.fields.get(data[0]);
      if (field === undefined) return [];
      const packets = [];
      if (kind === 'root_start' || kind === 'rain_start') {
        this.fields.delete(field.id);
        packets.push(...this.removeObject(field.id, { destroyed: true }));
        const root = kind === 'root_start';
        const [ident, packet] = this.addObject(root ? 315304 : 315403, field.pos);
        field.id = ident;
        field.end = now + (root ? 2000 : 3000);
        field.kind = root ? 'root_tick' : 'rain_tick';
        this.fields.set(ident, field);
        this._queue(root ? now : now + 750, field.kind, ident);
        return packets.concat([packet]);
      }
      for (const target of [...this.arena.actors.values()]) {
        if (!target.alive || target.camp === this.camp
          || Math.hypot(field.pos[0] - target.positionAt(now)[0],
            field.pos[1] - target.positionAt(now)[1]) > 144) continue;
        if (kind === 'root_tick') {
          if (now < field.end) {
            packets.push(...this._buff(315305, now, target.id,
              { duration: Math.min(750, field.end - now) }));
          }
        } else {
          const vamp = kind === 'mark_blast' && this.alive
            && this.generation === field.generation ? D('.5') : D(0);
          packets.push(...this.damage(field.power.mul(kind === 'mark_blast'
            ? D(2) : D('.75')), now, { target, school: 'physical', lifesteal: vamp,
            periodic: kind === 'rain_tick' })[0]);
          if (kind === 'rain_tick') {
            packets.push(...this._buff(315405, now, target.id));
            packets.push(...this._detonate(target, field.power, field.generation, now));
          }
        }
      }
      if (kind === 'mark_blast' || now >= field.end) {
        this.fields.delete(field.id);
        packets.push(...this.removeObject(field.id, { destroyed: true }));
      } else {
        this._queue(Math.min(now + 750, field.end), kind, field.id);
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  _flight(flight, now) {
    if (![315100, 315201, 315301].includes(flight.template)) return super._flight(flight, now);
    const { previous, begin, finish } = flight;
    const start = pointAt(flight.start, flight.end, (previous - begin) / (finish - begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - begin) / (finish - begin)));
    const contacts = [];
    for (const target of this.arena.actors.values()) {
      const key = `${target.id},${target.generation}`;
      if (target.alive && target.camp !== this.camp && !flight.hits.has(key)) {
        const hit = actorContact(start, end, target, previous, now, flight.basic ? 36 : 84);
        if (hit !== null) contacts.push([hit, target.id]);
      }
    }
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const packets = [];
    for (const [, ident] of contacts) {
      const target = this.arena.actors.get(ident);
      if (this.projectileBlocked(target, now)) {
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
      flight.hits.add(`${target.id},${target.generation}`);
      const pos = target.positionAt(now);
      packets.push(...this.damage(flight.raw, now,
        { target, school: 'physical', basic: flight.basic })[0]);
      if (flight.basic) {
        packets.push(...this.onBulletHit(flight, target, now));
        return packets.concat([scene({ blownBullets: [flight.id] })]);
      }
      // Damage may finish the match and freeze all surviving actors.
      if (this.arena.pk && this.arena.pk.finished) break;
      packets.push(...this._detonate(target, flight.power, flight.source_generation, now));
      if (this.arena.pk && this.arena.pk.finished) break;
      if (flight.template === 315301) {
        packets.push(...this._field(315303, pos, flight.power, now, 200,
          'root_start', flight.source_generation));
        return packets.concat([scene({ blownBullets: [flight.id] })]);
      }
      if (target.alive) {
        if (target.hasBuff(315203, now) && target.buffSources.get(315203) === this.id) {
          packets.push(...target.removeBuff(315203, now));
          packets.push(...this._push(target, flight.start, now));
        } else {
          packets.push(...this._buff(315203, now, target.id));
        }
      }
    }
    if (now >= finish) return packets.concat([scene({ expiredBullets: [flight.id] })]);
    flight.previous = now;
    this._queue(Math.min(now + 20, finish), 'flight', flight);
    return packets;
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (!this._inside(dest) || (slot !== 10 && start[0] === dest[0] && start[1] === dest[1])
      || (slot === 1 && !this.e_count)) return [];
    if (slot === 10 && Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 600) return [];
    const power = this.combatStat('iAttack', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 1000, 2: 25000, 10: 10000 }[slot], slot);
    let packets;
    if (slot === 10) {
      this.ready = { slot, dest, power, generation: this.generation };
      let body, stopped;
      [body, stopped] = prepareDisplacement(this, now, {
        interrupt: false, cancelMotion: true,
      });
      this.position = stopped.length ? body : start;
      this.motion = null;
      this._queue(now + 200, 'rain_cast', this.ready);
      packets = [scene({
        skills: [this._skillEvent(315401, start, dest, 0, { ready: 1 })],
      })].concat(this._buff(315411, now), stopped);
    } else {
      if (slot === 1) {
        this.e_count -= 1;
        if (!this.e_next_charge) this.e_next_charge = now + this.skillCooldown(6000);
      }
      const ratio = { 0: D('1.5'), 1: D('2.01'), 2: D('4.37') }[slot];
      packets = this.shoot(SLOTS[slot], start, dest, now, power.mul(ratio), {
        school: 'physical', basic: slot === 0,
        speed_multiplier: slot === 0 ? 1.5 : 1, power, through_walls: true,
      });
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as LEGOLAS_SLOTS, MARKS };
