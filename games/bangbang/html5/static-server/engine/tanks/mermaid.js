/* Mermaid (tank 10000065): delayed geyser, mark procs, piercing wave.
 * Port of server/mermaid_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. The mark's raw upper rate is not guessed; the
 * approved V1 10% true-damage proc is kept.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';
import { packII, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 340100, 1: 340201, 2: 340301, 10: 340401 };

export class MermaidActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = null;
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    })];
  }

  on_spawn(now) { return this._buff(340101, now); }

  blocked(action, now) { return super.blocked(action, now) || this.ready !== null; }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  update(now) {
    const packets = this.ready && this.skillSealed(2, now) ? this.interrupt(now) : [];
    return packets.concat(super.update(now));
  }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      this.ready = null;
      packets.push([1583, packII(this.id, 340301)]);
    }
    return packets.concat(this.syncSpeed(now));
  }

  _enemies(center, radius, now) {
    return [...this.arena.actors.values()].filter(a => a.alive && a.camp !== this.camp
      && a.isAreaTargetable()
      && Math.hypot(center[0] - a.positionAt(now)[0], center[1] - a.positionAt(now)[1]) <= radius);
  }

  _hit(target, raw, now) {
    const marked = target.hasBuff(340103, now) && target.buffSources.get(340103) === this.id;
    const [packets, lost] = this.damage(raw, now, { target, school: 'energy' });
    if (!lost) return packets;
    if (marked && target.alive) {
      packets.push(...this.damage(target.maxHp.mul(D('.1')), now,
        { target, school: 'true' })[0]);
    }
    for (const buff of [340102, 340103, 340104]) packets.push(...this._buff(buff, now, target.id));
    return packets;
  }

  _burst(flight, center, now) {
    const targets = this._enemies(center, 120, now);
    const packets = [];
    for (const target of targets) packets.push(...this._hit(target, flight.raw, now));
    // User: one refund/shield per cast, independent of victim count.
    if (targets.length && this.alive && flight.source_generation === this.generation) {
      this.cooldowns[10] = Math.max(now, this.cooldowns[10] - 3000);
      packets.push(...this.addShield(340403, flight.power.mul(D('1.5')), now));
      packets.push(this._cooldown(10));
    }
    return packets;
  }

  _flight(flight, now) {
    if (flight.template === 340100) return super._flight(flight, now);
    const start = pointAt(flight.start, flight.end,
      (flight.previous - flight.begin) / (flight.finish - flight.begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
    const wave = flight.template === 340301;
    const contacts = [];
    for (const target of this.arena.actors.values()) {
      if (!target.alive || target.camp === this.camp || target.isUntargetable()
        || flight.hits.has(`${target.id},${target.generation}`)) continue;
      const hit = actorContact(start, end, target, flight.previous, now, wave ? 156 : 84);
      if (hit !== null) contacts.push([hit, target.id]);
    }
    const packets = [];
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [contact, ident] of contacts) {
      const target = this.arena.actors.get(ident);
      if (this.projectileBlocked(target, now)) {
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
      if (!wave) {
        const center = pointAt(start, end, contact).map(pyRound);
        return this._burst(flight, center, now)
          .concat([scene({ blownBullets: [flight.id] })]);
      }
      flight.hits.add(`${target.id},${target.generation}`);
      packets.push(...this._hit(target, flight.raw, now));
      packets.push(...this._buff(340302, now, target.id));
    }
    if (now >= flight.finish) {
      if (!wave) packets.push(...this._burst(flight, flight.end, now));
      return packets.concat([scene(wave
        ? { expiredBullets: [flight.id] } : { blownBullets: [flight.id] })]);
    }
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'mermaid_geyser') {
      const [cast] = data;
      const packets = this.removeObject(cast.object);
      const [ident, packet] = this.addObject(340202, cast.pos);
      packets.push(packet);
      // Native 340202 has only a REMOVE exhibit/sound, no live cover.
      packets.push(...this.removeObject(ident, { destroyed: true }));
      // User: an already placed E survives the caster's death.
      for (const target of this._enemies(cast.pos, 120, now)) {
        packets.push(...this._hit(target, cast.power.mul(D('2.16')), now));
        packets.push(...this._buff(340212, now, target.id));
      }
      return packets;
    }
    if (kind === 'mermaid_wave') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.generation !== cast.generation) return [];
      if (this.skillSealed(2, now)) return this.interrupt(now);
      this.ready = null;
      return this.syncSpeed(now).concat(this.shoot(340301, this.positionAt(now), cast.dest, now,
        cast.power.mul(D('4.44')), { school: 'energy', power: cast.power, through_walls: true }));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now || !this._inside(dest)
      || (start[0] === dest[0] && start[1] === dest[1])) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 8000, 2: 25000, 10: 6000 }[slot], slot);
    let packets;
    if (slot === 0 || slot === 10) {
      packets = this.shoot(SLOTS[slot], start, dest, now,
        slot ? power.mul(D('2.05')) : power, {
          school: 'energy', basic: slot === 0, power, through_walls: slot === 10,
        });
    } else if (slot === 1) {
      const span = Math.hypot(start[0] - dest[0], start[1] - dest[1]);
      if (span > 600) dest = pointAt(start, dest, 600 / span).map(pyRound);
      const [ident, packet] = this.addObject(340201, dest);
      this._queue(now + 800, 'mermaid_geyser', { pos: dest, power, object: ident });
      packets = [packet, scene({ skills: [this._skillEvent(340201, start, dest)] })];
    } else {
      this.ready = { slot: 2, dest, power, generation: this.generation };
      let [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      this.position = stopped.length ? body : start;
      this.motion = null;
      this._queue(now + 500, 'mermaid_wave', this.ready);
      packets = [scene({ skills: [this._skillEvent(340301, start, dest, 0, { ready: 1 })] })]
        .concat(this.syncSpeed(now), stopped);
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as MERMAID_SLOTS };
