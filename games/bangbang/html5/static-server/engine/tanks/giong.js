/* Thanh Giong (tank 10000043): shot-cycle bamboo, radial blast, homing spear.
 * Port of server/giong_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. The unresolved Effect317302 cap is not guessed
 * (the kit keeps the approved V1 flat missing-HP rider).
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1562, encodeS1572 } from '../protocol.js';
import { packII, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 317100, 1: 317201, 2: 317301, 10: 317401 };
const HIT_TEMPLATES = new Set([317100, 317102, 317201, 317301, 317401]);

export class GiongActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.shot_count = 0;
    this.enhanced_count = 0;
    this.ready = null;
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    })];
  }

  on_spawn(now) {
    this.shot_count = this.enhanced_count = 0;
    return this._buff(317101, now);
  }

  blocked(action, now) { return super.blocked(action, now) || this.ready !== null; }

  interrupt(now) {
    const cast = this.ready;
    this.ready = null;
    if (cast === null) return [];
    const packets = [[1583, packII(this.id, SLOTS[cast.slot])]];
    if (cast.slot === 2) {
      this.cooldowns[2] = now + this.skillCooldown(6000, 2);
      packets.push(this._cooldown(2));
    }
    return packets;
  }

  _bamboo(pos, power, now, primary) {
    const packets = [];
    for (const target of [...this.arena.actors.values()]) {
      if (!target.alive || target.camp === this.camp) continue;
      const span = Math.hypot(pos[0] - target.positionAt(now)[0], pos[1] - target.positionAt(now)[1]);
      if (span <= 144) {
        const ratio = D('2.5').sub(D('1.25').mul(D(String(span))).div(D('144')));
        packets.push(...this.damage(power.mul(ratio), now, { target, school: 'physical', basic: true })[0]);
      }
    }
    if (primary !== null) packets.push(...this._buff(317103, now, primary.id));
    return packets;
  }

  _space_blast(flight, pos, now) {
    const packets = [];
    // Each victim's missing HP is captured before either damage component.
    const targets = [...this.arena.actors.values()]
      .filter(a => a.alive && a.camp !== this.camp
        && Math.hypot(pos[0] - a.positionAt(now)[0], pos[1] - a.positionAt(now)[1]) <= 168)
      .map(a => [a, a.maxHp.sub(a.hp)]);
    for (const [target, missing] of targets) {
      const locked = target.id === flight.target && target.generation === flight.target_generation;
      packets.push(...this.damage(flight.power.mul(D(locked ? '3' : '2')), now,
        { target, school: 'physical' })[0]);
      packets.push(...this.damage(missing.mul(D('.2')), now, { target, school: 'true' })[0]);
      packets.push(...this._buff(317304, now, target.id));
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'bamboo_ready') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.generation !== cast.generation) return [];
      const target = cast.target === null || cast.target === undefined
        ? null : this.arena.actors.get(cast.target);
      if (cast.slot === 2 && (target === null || !target.alive
        || target.generation !== cast.target_generation)) {
        return this.interrupt(now);
      }
      this.ready = null;
      return this.shoot(SLOTS[cast.slot], this.positionAt(now),
        target ? target.positionAt(now) : cast.dest, now, cast.power, {
          school: 'physical', basic: cast.slot === 10, target,
          speed_multiplier: cast.slot === 10 ? 1.5 : 1, power: cast.power, through_walls: true,
        });
    }
    return super._event(now, kind, data);
  }

  on_target_death(target, now) {
    return this.ready && this.ready.target === target.id ? this.interrupt(now) : [];
  }

  _flight(flight, now) {
    if (!HIT_TEMPLATES.has(flight.template)) return super._flight(flight, now);
    const previous = flight.previous;
    const packets = [];
    const homing = flight.template === 317301;
    let start, end;
    if (homing) {
      const target = this.arena.actors.get(flight.target);
      if (target === null || !target.alive || target.generation !== flight.target_generation) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      start = flight.pos;
      const dest = target.positionAt(now);
      end = pointAt(start, dest, Math.min(1, flight.speed * (now - previous) / 1000
        / Math.max(1, Math.hypot(start[0] - dest[0], start[1] - dest[1]))));
      if (dest[0] !== flight.end[0] || dest[1] !== flight.end[1]) {
        packets.push([1562, encodeS1562(flight.id, start, dest)]);
        flight.end = dest;
      }
    } else {
      start = pointAt(flight.start, flight.end, (previous - flight.begin) / (flight.finish - flight.begin));
      end = pointAt(flight.start, flight.end,
        Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
    }
    const contacts = [];
    for (const target of this.arena.actors.values()) {
      const key = `${target.id},${target.generation}`;
      if (target.alive && target.camp !== this.camp && !flight.hits.has(key)) {
        const hit = actorContact(start, end, target, previous, now, flight.template === 317201 ? 72 : 36);
        if (hit !== null) contacts.push([hit, target.id]);
      }
    }
    const wall = flight.through_walls ? null : this.arena.geometry.wallContact(start, end);
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [contact, ident] of contacts) {
      if (wall !== null && contact >= wall) break;
      const target = this.arena.actors.get(ident);
      if (this.projectileBlocked(target, now)) {
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
      flight.hits.add(`${target.id},${target.generation}`);
      if (flight.template === 317100) {
        packets.push(...this.damage(flight.raw, now, { target, school: 'physical', basic: true })[0]);
        return packets.concat([scene({ blownBullets: [flight.id] })]);
      }
      if (flight.template === 317201) {
        packets.push(...this.damage(flight.power.mul(D('2.15')), now, { target, school: 'physical' })[0]);
        packets.push(...this._buff(317211, now, target.id));
      } else {
        const pos = target.positionAt(now);
        packets.push(...(homing ? this._space_blast(flight, pos, now)
          : this._bamboo(pos, flight.power, now, target)));
        return packets.concat([scene({ blownBullets: [flight.id] })]);
      }
    }
    if (wall !== null) return packets.concat([scene({ blownBullets: [flight.id] })]);
    if (now >= flight.finish) return packets.concat([scene({ expiredBullets: [flight.id] })]);
    flight.pos = end;
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return packets;
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1])) return [];
    const target = slot === 2 ? this.arena.actors.get(target_id) : null;
    if (slot === 2 && (!target || !target.alive || target.camp === this.camp
      || target.isUntargetable()
      || Math.hypot(start[0] - target.positionAt(now)[0], start[1] - target.positionAt(now)[1]) > 960)) {
      return [];
    }
    const power = this.combatStat('iAttack', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 8000, 2: 25000, 10: 6000 }[slot], slot);
    let packets;
    if (slot === 0) {
      this.shot_count = (this.shot_count + 1) % 3; // casts count, even misses; R does not.
      const template = this.shot_count === 0 ? 317102 : 317100;
      const enhanced = this.enhanced_count > 0 && this.hasBuff(317402, now);
      packets = this.shoot(template, start, dest, now, power.mul(D('1.5')), {
        school: 'physical', basic: true, speed_multiplier: 1.5, power,
        range_multiplier: enhanced ? 1.25 : 1,
      });
      if (enhanced) {
        this.enhanced_count -= 1;
        if (this.enhanced_count === 0) {
          for (const buff of [317402, 317403]) packets.push(...this.removeBuff(buff, now));
        }
      }
    } else if (slot === 1) {
      packets = this.shoot(317201, start, dest, now, power.mul(D('2.15')),
        { school: 'physical', power, through_walls: true });
    } else {
      packets = [];
      let [origin, stopped] = prepareDisplacement(this, now, { interrupt: false, cancelMotion: true });
      if (slot === 10) {
        packets.push(...this.cleanse(now));
        for (const template of [317401, 317402, 317403]) packets.push(...this._buff(template, now));
        this.enhanced_count = 3;
      } else {
        packets.push(...this._buff(317311, now, target.id));
      }
      this.ready = {
        slot, dest, power, generation: this.generation,
        target: target ? target.id : null,
        target_generation: target ? target.generation : null,
      };
      this.position = stopped.length ? origin : start;
      this.motion = null;
      this._queue(now + (slot === 2 ? 1000 : 50), 'bamboo_ready', this.ready);
      packets.push(scene({ skills: [this._skillEvent(SLOTS[slot], start,
        target ? target.positionAt(now) : dest, target ? target_id : 0, { ready: 1 })] }));
      packets.push(...stopped);
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as GIONG_SLOTS };
