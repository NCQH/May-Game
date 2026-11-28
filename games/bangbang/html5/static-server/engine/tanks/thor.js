/* Thor (tank 10000039): hammer chain, thunder field, delayed strike.
 * Port of server/thor_actions.py onto the JS battle core.
 *
 * Stubs: presentation only. The field survives its owner's death (user rule);
 * hammer E chains up to five targets with 25% falloff per hop.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1562, encodeS1572 } from '../protocol.js';
import { packII } from './melee.js';

const SLOTS = { 0: 313100, 1: 313201, 2: 313301, 10: 313401 };

export class ThorActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.e_count = 2;
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

  on_spawn(now) { return this._buff(313101, now); }

  update(now) {
    const packets = super.update(now);
    if (this.e_next_charge && now >= this.e_next_charge) {
      while (this.e_count < 2 && now >= this.e_next_charge) {
        this.e_count += 1;
        this.e_next_charge += this.skillCooldown(6000);
      }
      if (this.e_count === 2) this.e_next_charge = 0;
      packets.push(this._cooldown(1));
    }
    return packets;
  }

  blocked(action, now) { return super.blocked(action, now) || this.ready !== null; }

  interrupt(now) {
    if (this.ready === null) return [];
    this.ready = null;
    this.cooldowns[2] = now + this.skillCooldown(10000, 2);
    return [[1583, packII(this.id, 313301)], this._cooldown(2)];
  }

  _hit(target, raw, now, { periodic = false } = {}) {
    const generation = target.generation;
    const [packets, lost] = this.damage(raw, now,
      { target, school: 'energy', periodic });
    if (!lost || !target.alive || target.generation !== generation) return packets;
    // Separate true packet cannot recursively trigger this method.
    packets.push(...this.damage(target.maxHp.mul(D('.03')), now,
      { target, school: 'true', periodic })[0]);
    if (!target.alive || target.hasBuff(313121, now)) return packets;
    const stage = target.hasBuff(313132, now) ? 2
      : target.hasBuff(313131, now) ? 1 : 0;
    for (const template of [313131, 313132]) {
      if (target.hasBuff(template, now)) packets.push(...target.removeBuff(template, now));
    }
    if (stage === 2) {
      packets.push(...this._buff(313121, now, target.id));
      packets.push(...this._buff(313133, now, target.id));
    } else {
      packets.push(...this._buff(313131 + stage, now, target.id));
    }
    return packets;
  }

  _field(pos, power, now) {
    const [ident, packet] = this.addObject(313302, pos);
    this.fields.set(ident, { id: ident, pos, power, end: now + 4000 });
    for (const offset of [900, 1800, 2700, 3600]) {
      this._queue(now + offset, 'thunder_field', ident);
    }
    this._queue(now + 4000, 'thunder_end', ident);
    return [packet];
  }

  _event(now, kind, data) {
    if (kind === 'thor_visual_remove') {
      // Prop313401 is the native 500 ms presentation-only lightning cue.
      return this.removeObject(data[0], { destroyed: true });
    }
    if (kind === 'hammer_cast') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || cast.generation !== this.generation) return [];
      this.ready = null;
      return this.shoot(313301, this.positionAt(now), cast.dest, now,
        cast.power.mul(D('1.7')), { school: 'energy', power: cast.power });
    }
    if (kind === 'thunder_strike') {
      const [cast] = data;
      const packets = this.removeObject(cast.id, { destroyed: true });
      if (!this.alive || cast.generation !== this.generation) return packets;
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(cast.pos[0] - target.positionAt(now)[0],
            cast.pos[1] - target.positionAt(now)[1]) <= 120) {
          packets.push(...this._hit(target, cast.power.mul(D('2.29')), now));
          packets.push(...this._buff(313412, now, target.id));
        }
      }
      return packets;
    }
    if (kind === 'thunder_field') {
      const field = this.fields.get(data[0]);
      if (field === undefined) return [];
      const packets = [];
      // User: an already-created field survives its owner's death.
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(field.pos[0] - target.positionAt(now)[0],
            field.pos[1] - target.positionAt(now)[1]) <= 192) {
          packets.push(...this._hit(target, field.power.mul(D('.85')), now, { periodic: true }));
          packets.push(...this._buff(313312, now, target.id));
        }
      }
      return packets;
    }
    if (kind === 'thunder_end') {
      const field = this.fields.get(data[0]);
      this.fields.delete(data[0]);
      return field ? this.removeObject(field.id, { destroyed: true }) : [];
    }
    return super._event(now, kind, data);
  }

  _flight(flight, now) {
    if (![313201, 313211, 313301].includes(flight.template)) return super._flight(flight, now);
    const previous = flight.previous;
    const chain = flight.template !== 313301;
    const target = chain ? this.arena.actors.get(flight.target) : null;
    const packets = [];
    let start, end, candidates;
    if (chain) {
      if (!target || !target.alive || target.generation !== flight.target_generation) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      start = flight.pos;
      const dest = target.positionAt(now);
      const span = Math.hypot(dest[0] - start[0], dest[1] - start[1]);
      end = pointAt(start, dest, Math.min(1,
        flight.speed * (now - previous) / 1000 / Math.max(1, span)));
      if (dest[0] !== flight.end[0] || dest[1] !== flight.end[1]) {
        packets.push([1562, encodeS1562(flight.id, start, dest)]);
        flight.end = dest;
      }
      candidates = [target];
    } else {
      const f0 = (previous - flight.begin) / (flight.finish - flight.begin);
      const f1 = Math.min(1, (now - flight.begin) / (flight.finish - flight.begin));
      start = pointAt(flight.start, flight.end, f0);
      end = pointAt(flight.start, flight.end, f1);
      candidates = [...this.arena.actors.values()].filter(a => a.alive && a.camp !== this.camp);
    }
    const hits = [];
    for (const actor of candidates) {
      const contact = actorContact(start, end, actor, previous, now);
      if (contact !== null) hits.push([contact, actor.id]);
    }
    hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const contact = hits.length ? hits[0] : null;
    if (contact && this.projectileBlocked(this.arena.actors.get(contact[1]), now)) {
      return packets.concat([scene({ expiredBullets: [flight.id] })]);
    }
    if (contact || now >= flight.finish) {
      const pos = pointAt(start, end, contact ? contact[0] : 1).map(pyRound);
      packets.push(scene({ blownBullets: [flight.id] }));
      if (!chain) {
        for (const actor of [...this.arena.actors.values()]) {
          if (actor.alive && actor.camp !== this.camp
            && Math.hypot(pos[0] - actor.positionAt(now)[0],
              pos[1] - actor.positionAt(now)[1]) <= 192) {
            packets.push(...this._hit(actor, flight.raw, now));
          }
        }
        if (this.alive && this.generation === flight.source_generation) {
          packets.push(...this._field(pos, flight.power, now));
        }
      } else if (contact) {
        const victim = this.arena.actors.get(contact[1]);
        packets.push(...this._hit(victim, flight.raw, now));
        const visited = flight.hits ?? new Set();
        flight.hits = visited;
        visited.add(victim.id);
        const nextTargets = [...this.arena.actors.values()]
          .filter(a => a.alive && a.camp !== this.camp && !visited.has(a.id)
            && !a.isUntargetable()
            && Math.hypot(pos[0] - a.positionAt(now)[0],
              pos[1] - a.positionAt(now)[1]) <= 336)
          .map(a => [Math.hypot(pos[0] - a.positionAt(now)[0],
            pos[1] - a.positionAt(now)[1]), a.id])
          .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        if (visited.size < 5 && nextTargets.length && this.alive
          && this.generation === flight.source_generation) {
          const nxt = this.arena.actors.get(nextTargets[0][1]);
          packets.push(...this.shoot(313211, pos, nxt.positionAt(now), now,
            flight.raw.mul(D('.75')), {
              school: 'energy', target: nxt, power: flight.power, hit_ids: visited,
            }));
        }
      }
      return packets;
    }
    flight.pos = end;
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return packets;
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (!this._inside(dest)
      || ((slot === 0 || slot === 2) && start[0] === dest[0] && start[1] === dest[1])) {
      return [];
    }
    const target = this.arena.actors.get(targetId);
    if (slot === 1 && (!this.e_count || !target || !target.alive
      || target.camp === this.camp || target.isUntargetable()
      || Math.hypot(start[0] - target.positionAt(now)[0],
        start[1] - target.positionAt(now)[1]) > 600)) return [];
    if (slot === 10 && Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 600) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 3000, 2: 25000, 10: 8000 }[slot], slot);
    let packets;
    if (slot === 0) {
      packets = this.shoot(313100, start, dest, now, power,
        { school: 'energy', basic: true });
    } else if (slot === 1) {
      this.e_count -= 1;
      if (!this.e_next_charge) this.e_next_charge = now + this.skillCooldown(6000);
      packets = this.shoot(313201, start, target.positionAt(now), now,
        power.mul(D('1.93')), { school: 'energy', target, power });
    } else if (slot === 2) {
      this.ready = { slot: 2, dest, power, generation: this.generation };
      this._queue(now + 150, 'hammer_cast', this.ready);
      packets = [scene({
        skills: [this._skillEvent(313301, start, dest, 0, { ready: 1 })],
      })];
    } else {
      const [ident, packet] = this.addObject(313401, dest);
      const [other, otherPacket] = this.addObject(313402, dest);
      this._queue(now + 500, 'thor_visual_remove', ident);
      this._queue(now + 600, 'thunder_strike',
        { id: other, pos: dest, power, generation: this.generation });
      packets = [packet, otherPacket];
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as THOR_SLOTS };
