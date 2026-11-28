/* Pikachu (tank 10000047): four-stage marks, dash contact aura, discharge.
 * Port of server/pikachu_actions.py onto the JS battle core.
 *
 * Stubs: presentation only. Space is the approved five-second mobile
 * discharge; E and R share the 150 ms ready window.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';
import { packII } from './melee.js';

const SLOTS = { 0: 321100, 1: 321201, 2: 321301, 10: 321401 };
const MARKS = [321121, 321122, 321123, 321124];

export class PikachuActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.r_count = 2;
    this.r_next_charge = 0;
    this.ready = null;
    this.contact = null;
    this.discharge = null;
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: slot === 10 ? this.r_count : -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: slot === 10 ? this.r_next_charge : 0,
    })];
  }

  update(now) {
    const packets = super.update(now);
    if (this.r_next_charge && now >= this.r_next_charge) {
      while (this.r_count < 2 && now >= this.r_next_charge) {
        this.r_count += 1;
        this.r_next_charge += this.skillCooldown(6000);
      }
      if (this.r_count === 2) this.r_next_charge = 0;
      packets.push(this._cooldown(10));
    }
    return packets;
  }

  blocked(action, now) { return super.blocked(action, now) || this.ready !== null; }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      const { slot } = this.ready;
      this.ready = null;
      packets.push([1583, packII(this.id, SLOTS[slot])]);
    }
    if (!this.alive) this.contact = this.discharge = null;
    return packets;
  }

  _mark(target, count, now, { periodic = false } = {}) {
    const packets = [];
    for (let n = 0; n < count; n += 1) {
      if (!target.alive) break;
      let stage = 0;
      for (let i = 0; i < MARKS.length; i += 1) {
        if (target.hasBuff(MARKS[i], now)) stage = i + 1;
      }
      for (const template of MARKS) {
        if (target.hasBuff(template, now)) packets.push(...target.removeBuff(template, now));
      }
      if (stage < 4) {
        packets.push(...this._buff(MARKS[stage], now, target.id));
      } else {
        packets.push(...this._buff(321111, now, target.id));
        packets.push(...this.damage(target.maxHp.mul(D('.1')), now,
          { target, school: 'energy', periodic })[0]);
        for (const template of [321113, 321114, 321115]) {
          packets.push(...this._buff(template, now, target.id));
        }
      }
      packets.push(...this._buff(321102, now, target.id));
    }
    return packets;
  }

  onBulletHit(flight, target, now) {
    if (flight.source_generation !== this.generation || !this.alive) return [];
    return flight.template === 321100 ? this._mark(target, 1, now) : [];
  }

  _event(now, kind, data) {
    if (kind === 'electric_ready') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || cast.generation !== this.generation) return [];
      this.ready = null;
      const start = this.positionAt(now);
      if (cast.slot === 10) {
        return this.shoot(321401, start, cast.dest, now, cast.power.mul(D('1.55')),
          { school: 'energy', power: cast.power });
      }
      const span = Math.hypot(start[0] - cast.dest[0], start[1] - cast.dest[1]);
      if (!span) return [];
      const end = pointAt(start, cast.dest, 360 / span);
      // DASH3 is a timed forced move for self and remote clients alike.
      const duration = this._setMotion(start, end, 720, now, 3);
      const dest = this.motion[1];
      this.forcedUntil = now + duration;
      this.contact = { power: cast.power, previous: now, end: now + 4000, hits: new Set() };
      this._queue(now + 20, 'electric_contact', this.contact);
      const packets = [scene({
        moves: [this._moveEvent(dest, 720, 3)],
        skills: [this._skillEvent(321201, start, dest)],
      })];
      for (const template of [321202, 321203, 321204, 321205, 321221]) {
        packets.push(...this._buff(template, now));
      }
      return packets;
    }
    if (kind === 'electric_contact') {
      const [contact] = data;
      if (this.contact !== contact || !this.alive) return [];
      if (now > contact.end) { this.contact = null; return []; }
      const start = this.positionAt(contact.previous), end = this.positionAt(now);
      const packets = [];
      for (const target of [...this.arena.actors.values()]) {
        const key = `${target.id},${target.generation}`;
        if (!target.alive || target.camp === this.camp || contact.hits.has(key)) continue;
        if (actorContact(start, end, target, contact.previous, now, 73) === null) continue;
        contact.hits.add(key);
        packets.push(...this.damage(contact.power.mul(D('1.85')), now,
          { target, school: 'energy' })[0]);
        packets.push(...this._mark(target, 2, now));
        packets.push(...this._buff(321213, now, target.id));
      }
      contact.previous = now;
      if (now < contact.end) {
        this._queue(Math.min(now + 20, contact.end), kind, contact);
      } else {
        this.contact = null;
      }
      return packets;
    }
    if (kind === 'electric_discharge') {
      const [cast] = data;
      if (this.discharge !== cast || !this.alive) return [];
      const packets = [];
      const pos = this.positionAt(now);
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(pos[0] - target.positionAt(now)[0],
            pos[1] - target.positionAt(now)[1]) <= 240) {
          packets.push(...this.damage(cast.power.mul(D('.75')), now,
            { target, school: 'energy', lifesteal: D('.3'), periodic: true })[0]);
          packets.push(...this._mark(target, 1, now, { periodic: true }));
        }
      }
      if (now < cast.end) this._queue(now + 500, kind, cast);
      else this.discharge = null;
      return packets;
    }
    return super._event(now, kind, data);
  }

  _flight(flight, now) {
    if (flight.template !== 321401) return super._flight(flight, now);
    const { previous, begin, finish } = flight;
    const start = pointAt(flight.start, flight.end, (previous - begin) / (finish - begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - begin) / (finish - begin)));
    const contacts = [];
    for (const target of this.arena.actors.values()) {
      const key = `${target.id},${target.generation}`;
      if (target.alive && target.camp !== this.camp && !flight.hits.has(key)) {
        const hit = actorContact(start, end, target, previous, now, 36 + 48);
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
      packets.push(...this.damage(flight.raw, now, { target, school: 'energy' })[0]);
      packets.push(...this._buff(321402, now, target.id));
      if (this.alive && this.generation === flight.source_generation) {
        if (this.r_next_charge) {
          this.r_next_charge = Math.max(now, this.r_next_charge - 1000);
          packets.push(...this.update(now));
          packets.push(this._cooldown(10));
        }
        packets.push(...this._mark(target, 1, now));
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
    if ((slot !== 2 && (!this._inside(dest)
      || (start[0] === dest[0] && start[1] === dest[1]))) || (slot === 10 && !this.r_count)) {
      return [];
    }
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 8000, 2: 25000, 10: 1000 }[slot], slot);
    let packets;
    if (slot === 0) {
      packets = this.shoot(321100, start, dest, now, power,
        { school: 'energy', basic: true });
    } else if (slot === 1 || slot === 10) {
      if (slot === 10) {
        this.r_count -= 1;
        if (!this.r_next_charge) this.r_next_charge = now + this.skillCooldown(6000);
      }
      this.ready = { slot, dest, power, generation: this.generation };
      this._queue(now + 150, 'electric_ready', this.ready);
      packets = [scene({
        skills: [this._skillEvent(SLOTS[slot], start, dest, 0, { ready: 1 })],
      })];
    } else {
      this.discharge = { power, end: now + 5000 };
      this._queue(now + 500, 'electric_discharge', this.discharge);
      packets = [scene({ skills: [this._skillEvent(321301, start, start, this.id)] })];
      for (const template of [321301, 321302, 321303, 321304]) {
        packets.push(...this._buff(template, now, null, { duration: 5000 }));
      }
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as PIKACHU_SLOTS, MARKS as PIKACHU_MARKS };
