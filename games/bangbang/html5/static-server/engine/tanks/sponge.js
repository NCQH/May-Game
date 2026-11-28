/* Sponge (tank 10000045): placed bubbles, lobbed soap and a soap pickup.
 * Port of server/sponge_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. The passive landing rule is the approved
 * temporary 72..168 clockwise ring scan with the arena RNG.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, circleContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';

const SLOTS = { 0: 319100, 1: 319201, 2: 319301 };

export class SpongeActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.cooldowns = { 0: 0, 1: 0, 2: 0 };
    this.soaps = new Map();
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    })];
  }

  on_spawn(now) { return this._buff(319101, now); }

  _lob(template, start, dest, now, power) {
    const ident = this._newId(2);
    dest = dest.map(pyRound);
    // Soap is a thrown pickup, not a normal/skill projectile.
    const factor = template !== 319102 && this.hasBuff(10400233, now) ? 1.15 : 1;
    const speed = Math.max(1, pyRound(Math.hypot(start[0] - dest[0], start[1] - dest[1]) * factor));
    const flight = {
      kind: 'bullet', id: ident, template, start, end: dest, speed,
      begin: now, previous: now, finish: now + pyRound(1000 / factor),
      power, source_generation: this.generation,
    };
    this._queue(now + 20, 'flight', flight);
    return [scene({ fires: [{ bulletId: ident, ownerId: this.id, start, dest, speed, templateId: template }] })];
  }

  _passive(now, generation) {
    if (!this.alive || this.generation !== generation) return [];
    const start = this.positionAt(now);
    // Approved temporary landing rule: an open point 72..168 from owner.
    const candidates = [];
    for (const radius of [72, 120, 168]) {
      for (let index = 0; index < 16; index += 1) {
        const angle = 2 * Math.PI * index / 16;
        const pos = [pyRound(start[0] + radius * Math.cos(angle)),
          pyRound(start[1] + radius * Math.sin(angle))];
        const clamp = this.arena.geometry.clampTankPosition(pos);
        if (pos[0] === clamp[0] && pos[1] === clamp[1]
          && this.arena.geometry.wallContact(pos, pos) === null) candidates.push(pos);
      }
    }
    if (!candidates.length) throw new Error('No legal soap landing point on the supported map');
    const pick = candidates[Math.floor(this.arena.rng() * candidates.length)];
    return this.restoreHp(this.maxHp.mul(D('.1')), now)
      .concat(this._lob(319102, start, pick, now, D(0)));
  }

  _area(center, radius, raw, buff, now, generation) {
    const packets = [];
    let lost = false;
    for (const target of [...this.arena.actors.values()]) {
      if (target.alive && target.camp !== this.camp
        && Math.hypot(center[0] - target.positionAt(now)[0],
          center[1] - target.positionAt(now)[1]) <= radius) {
        const [hit, damaged] = this.damage(raw, now, { target, school: 'energy' });
        packets.push(...hit, ...this._buff(buff, now, target.id));
        lost = lost || damaged;
      }
    }
    if (lost) packets.push(...this._passive(now, generation));
    return packets;
  }

  _flight(flight, now) {
    if (flight.template === 319100) return super._flight(flight, now);
    // E and passive soap are point-targeted lobs, not contact detonations.
    if (flight.template === 319201) {
      const duration = flight.finish - flight.begin;
      const start = pointAt(flight.start, flight.end, (flight.previous - flight.begin) / duration);
      const end = pointAt(flight.start, flight.end,
        Math.min(1, (now - flight.begin) / duration));
      for (const target of this.arena.actors.values()) {
        if (target.alive && target.camp !== this.camp && this.projectileBlocked(target, now)
          && actorContact(start, end, target, flight.previous, now) !== null) {
          return [scene({ expiredBullets: [flight.id] })];
        }
      }
    }
    if (now < flight.finish) {
      flight.previous = now;
      this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
      return [];
    }
    const packets = [scene({ blownBullets: [flight.id] })];
    if (flight.template === 319201) {
      return packets.concat(this._area(flight.end, 96, flight.power.mul(D('1.7')),
        319211, now, flight.source_generation));
    }
    const [ident, packet] = this.addObject(319102, flight.end);
    const soap = { id: ident, pos: flight.end, previous: now, end: now + 8000 };
    this.soaps.set(ident, soap);
    this._queue(now + 50, 'sponge_pickup', soap);
    return packets.concat([packet]);
  }

  _event(now, kind, data) {
    if (kind === 'sponge_pickup') {
      const [soap] = data;
      if (this.soaps.get(soap.id) !== soap) return [];
      const candidates = [];
      for (const actor of this.arena.actors.values()) {
        if (!actor.alive || actor.isUntargetable()) continue;
        const hit = circleContact(actor.positionAt(soap.previous), actor.positionAt(now),
          soap.pos, soap.pos, 36);
        if (hit !== null) candidates.push([hit, actor.id]);
      }
      candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (candidates.length || now >= soap.end) {
        this.soaps.delete(soap.id);
        const packets = this.removeObject(soap.id, { destroyed: candidates.length > 0 });
        if (candidates.length) {
          const target = this.arena.actors.get(candidates[0][1]);
          packets.push(...(target.camp === this.camp
            ? target.restoreHp(target.maxHp.mul(D('.1')), now)
            : this._buff(319104, now, target.id)));
        }
        return packets;
      }
      soap.previous = now;
      this._queue(Math.min(now + 50, soap.end), kind, soap);
      return [];
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (slot !== 2 && (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1]))) return [];
    if (slot === 1 && Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 360) {
      dest = pointAt(start, dest, 360 / Math.hypot(start[0] - dest[0], start[1] - dest[1]))
        .map(pyRound);
    }
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 8000, 2: 20000 }[slot], slot);
    const power = this.combatStat('iEgAtk', now);
    let packets;
    if (slot === 0) {
      packets = this.shoot(319100, start, dest, now, power,
        { school: 'energy', basic: true, power });
    } else if (slot === 1) {
      packets = this._lob(319201, start, dest, now, power);
    } else {
      packets = [scene({ skills: [this._skillEvent(319301, start, start, this.id)] })];
      packets.push(...this._area(start, 288, power.mul(D('3.8')), 319311, now, this.generation));
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as SPONGE_SLOTS };
