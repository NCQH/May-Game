/* Captain (tank 10000031): command aura, returning shield toss, courage shields.
 * Port of server/captain_actions.py onto the JS battle core.
 *
 * Stubs: presentation only. Charge refund and R duration keep the user-approved
 * values from the Python kit. Both toss legs pass through walls (user choice).
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound, quantize } from '../math.js';
import { scene, encodeS1562, encodeS1572 } from '../protocol.js';
import { packII } from './melee.js';

const SLOTS = { 0: 323100, 1: 323201, 2: 323301, 10: 323401 };

export class CaptainActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.e_count = 2;
    this.e_next_charge = 0;
    this.ready = null;
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: slot === 1 ? this.e_count : -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: slot === 1 ? this.e_next_charge : 0,
    })];
  }

  on_spawn(now) {
    this._queue(now, 'command_aura', this.generation);
    return this._buff(323101, now);
  }

  _allies(now, radius) {
    const pos = this.positionAt(now);
    return [...this.arena.actors.values()].filter(a => a.alive && a.camp === this.camp
      && !a.info.map_object && !a.info.cow_object && !a.info.totem
      && Math.hypot(pos[0] - a.positionAt(now)[0], pos[1] - a.positionAt(now)[1]) <= radius);
  }

  _inspire(now) {
    const packets = [];
    for (const target of this._allies(now, 480)) {
      for (const template of [323121, 323122]) {
        packets.push(...this._buff(template, now, target.id, { refresh: true }));
      }
    }
    return packets;
  }

  blocked(action, now) { return super.blocked(action, now) || this.ready !== null; }

  interrupt(now) {
    if (this.ready === null) return [];
    this.ready = null;
    this.cooldowns[2] = now + this.skillCooldown(10000, 2);
    return [[1583, packII(this.id, 323301)], this._cooldown(2)];
  }

  update(now) {
    const packets = super.update(now);
    if (this.e_next_charge && now >= this.e_next_charge) {
      while (this.e_count < 2 && now >= this.e_next_charge) {
        this.e_count += 1;
        this.e_next_charge += this.skillCooldown(8000);
      }
      if (this.e_count === 2) this.e_next_charge = 0;
      packets.push(this._cooldown(1));
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'command_aura') {
      if (!this.alive || this.generation !== data[0]) return [];
      this._queue(now + 1000, kind, ...data);
      const packets = [];
      for (const target of this._allies(now, 480)) {
        for (const template of [323102, 323103, 323104]) {
          packets.push(...this._buff(template, now, target.id, { refresh: true }));
        }
      }
      return packets;
    }
    if (kind === 'courage') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || cast.generation !== this.generation) return [];
      this.ready = null;
      const start = this.positionAt(now);
      const packets = [scene({ skills: [this._skillEvent(323301, start, start, this.id)] })];
      for (const target of this._allies(now, 360)) {
        const previousVersion = target.buffVersions.get(323301);
        packets.push(...target.addShield(323301, cast.power.mul(D('7.2')), now));
        const version = target.buffVersions.get(323301);
        if (version === previousVersion) continue;
        for (const template of [323302, 323303]) {
          packets.push(...this._buff(template, now, target.id));
        }
        for (let offset = 500; offset <= 5000; offset += 500) {
          this._queue(now + offset, 'shield_decay', target.id, target.generation,
            version, cast.power.mul(D('.72')));
        }
      }
      return packets;
    }
    if (kind === 'shield_decay') {
      const [targetId, generation, version, amount] = data;
      const target = this.arena.actors.get(targetId);
      if (!target?.alive || target.generation !== generation
        || target.buffVersions.get(323301) !== version) return [];
      const shield = target.shields.find(s => s.shield_id === '323301');
      if (shield === undefined) return [];
      const remaining = quantize(D(0).max(D(shield.remaining).sub(amount)));
      if (remaining.isZero()) {
        return target.removeBuff(323301, now).concat([target.shieldPacket(now)]);
      }
      target.shields = target.shields.map(s => s === shield ? { ...s, remaining } : s);
      return [target.shieldPacket(now)].concat(target.syncSpeed(now));
    }
    return super._event(now, kind, data);
  }

  _flight(flight, now) {
    if (![323201, 323211].includes(flight.template)) return super._flight(flight, now);
    const previous = flight.previous;
    const returning = flight.template === 323211;
    const packets = [];
    let start, end, reached;
    if (returning) {
      if (!this.alive || this.generation !== flight.source_generation) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      start = flight.pos;
      const dest = this.positionAt(now);
      const span = Math.hypot(dest[0] - start[0], dest[1] - start[1]);
      end = pointAt(start, dest, Math.min(1,
        flight.speed * (now - previous) / 1000 / Math.max(1, span)));
      if (dest[0] !== flight.end[0] || dest[1] !== flight.end[1]) {
        packets.push([1562, encodeS1562(flight.id, start, dest)]);
        flight.end = dest;
      }
      reached = Math.hypot(end[0] - dest[0], end[1] - dest[1]) < 1;
    } else {
      const f0 = (previous - flight.begin) / (flight.finish - flight.begin);
      const f1 = Math.min(1, (now - flight.begin) / (flight.finish - flight.begin));
      start = pointAt(flight.start, flight.end, f0);
      end = pointAt(flight.start, flight.end, f1);
      reached = now >= flight.finish;
    }
    const hits = flight.hits ?? new Set();
    flight.hits = hits;
    for (const target of [...this.arena.actors.values()]) {
      if (!target.alive || target.camp === this.camp
        || hits.has(`${target.id},${target.generation}`)) continue;
      const hit = actorContact(start, end, target, previous, now, 72);
      if (hit === null) continue;
      if (this.projectileBlocked(target, now)) {
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
      hits.add(`${target.id},${target.generation}`);
      packets.push(...this.damage(flight.raw, now, { target })[0]);
      packets.push(...this._buff(returning ? 323212 : 323202, now, target.id));
      if (returning && this.e_next_charge) {
        this.e_next_charge = Math.max(now, this.e_next_charge - 1200);
        packets.push(...this.update(now));
        packets.push(this._cooldown(1));
      }
    }
    flight.pos = end;
    if (reached) {
      packets.push(scene({ expiredBullets: [flight.id] }));
      if (!returning && this.alive && this.generation === flight.source_generation) {
        const position = end.map(pyRound);
        const speed = pyRound(800 * (1 + this.attrBonus([37], now).toNumber()));
        const dest = this.positionAt(now);
        const duration = Math.max(1,
          Math.ceil(Math.hypot(dest[0] - position[0], dest[1] - position[1]) * 1000 / speed));
        const ret = {
          ...flight, id: this._newId(2), template: 323211, start: position, end: dest,
          pos: position, begin: now, previous: now, finish: now + duration, speed,
          target: this.id, target_generation: this.generation,
          raw: flight.power.mul(D('1.59')), hits: new Set(),
        };
        packets.push(scene({ fires: [{
          bulletId: ret.id, ownerId: this.id, start: position, dest, speed, templateId: 323211,
        }] }));
        this._queue(now + Math.min(20, duration), 'flight', ret);
      }
      return packets;
    }
    flight.previous = now;
    if (returning) {
      const p = this.positionAt(now);
      flight.finish = now + Math.max(1,
        Math.ceil(Math.hypot(p[0] - end[0], p[1] - end[1]) * 1000 / flight.speed));
    }
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return packets;
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (slot in [0, 1] && (start[0] === dest[0] && start[1] === dest[1]
      || !this._inside(dest)) || slot === 1 && !this.e_count) return [];
    const target = this.arena.actors.get(targetId);
    if (slot === 10 && (target === null || target === undefined || !target.alive
      || target.camp !== this.camp
      || Math.hypot(start[0] - target.positionAt(now)[0],
        start[1] - target.positionAt(now)[1]) > 600)) return [];
    const power = this.combatStat('iAttack', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 4000, 2: 30000, 10: 6000 }[slot], slot);
    const packets = slot ? this._inspire(now) : [];
    if (slot in [0, 1]) {
      if (slot === 1) {
        this.e_count -= 1;
        if (!this.e_next_charge) this.e_next_charge = now + this.skillCooldown(8000);
      }
      packets.push(...this.shoot(SLOTS[slot], start, dest, now,
        power.mul(slot ? D('.76') : D(1)),
        { school: 'physical', basic: slot === 0, power }));
    } else if (slot === 10) {
      packets.push(scene({
        skills: [this._skillEvent(323401, start, target.positionAt(now), target.id)],
      }));
      for (const allyId of new Set([this.id, target.id])) {
        for (const template of [323401, 323402]) {
          packets.push(...this._buff(template, now, allyId, { duration: 1250 }));
        }
      }
    } else {
      this.ready = { slot: 2, dest: start, power, generation: this.generation };
      this._queue(now + 500, 'courage', this.ready);
      packets.push(scene({
        skills: [this._skillEvent(323301, start, start, this.id, { ready: 1 })],
      }));
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as CAPTAIN_SLOTS };
