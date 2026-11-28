/* Scorpion (tank 10000069): one poison clock per target, Space consumes it.
 * Port of server/scorpion_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. V1 poison scaling and the ten-stack explosion
 * are kept; the geometric raw table is intentionally not guessed.
 */
import { TankActions } from '../arena.js';
import { TableRow } from '../data.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';

const SLOTS = { 0: 343100, 1: 343201, 2: 343301, 10: 343401 };
const POISON = Array.from({ length: 10 }, (_, i) => 343111 + i);
const DOT = ['.10', '.13', '.16', '.20', '.24', '.31', '.38', '.48', '.60', '.75'].map(v => D(v));

export class ScorpionActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.marks = new Map();
    this.spray = null;
    this.space_count = 2;
    this.space_next_charge = 0;
  }

  _cooldown(slot, changed = false) {
    const skill = slot === 0 && this.hasBuff(343201, this.clock()) ? 343211 : SLOTS[slot];
    const info = {
      skillId: skill, slot, count: slot === 2 ? this.space_count : -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: slot === 2 ? this.space_next_charge : 0,
    };
    return changed ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _basic_slot() {
    return (this.id === 1 ? [this._cooldown(0, true)] : []).concat([this._cooldown(0)]);
  }

  on_spawn(now) {
    return this._buff(343101, now).concat(this._buff(343102, now), this._basic_slot());
  }

  removeBuff(template, now, { expired = false } = {}) {
    const existed = this.activeBuffs.has(`${this.id},${template}`);
    const packets = super.removeBuff(template, now, { expired });
    if (template === 343201 && existed) packets.push(...this._basic_slot());
    return packets;
  }

  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  update(now) {
    const packets = super.update(now);
    if (this.space_next_charge && now >= this.space_next_charge) {
      while (this.space_count < 2 && now >= this.space_next_charge) {
        this.space_count += 1;
        this.space_next_charge += this.skillCooldown(15000);
      }
      if (this.space_count === 2) this.space_next_charge = 0;
      packets.push(this._cooldown(2));
    }
    return packets;
  }

  interrupt() { this.spray = null; return []; }

  on_target_death(target) { this.marks.delete(target.id); return []; }

  _mark_valid(target, mark, now, { finalTick = false } = {}) {
    return this.marks.get(target.id) === mark && target.alive
      && target.generation === mark.target_generation
      && target.buffVersions.get(mark.template) === mark.version
      && (finalTick ? now <= mark.end : now < mark.end)
      && (finalTick || target.hasBuff(mark.template, now));
  }

  _poison(target, power, generation, now) {
    if (!target.alive || target.rejectBuff(new TableRow({ nEffectType: '201' }), this, now)) return [];
    const old = this.marks.get(target.id);
    const valid = old && old.source_generation === generation && this._mark_valid(target, old, now);
    const count = Math.min(10, valid ? old.stacks + 1 : 1);
    const packets = [];
    for (const template of POISON) {
      if (target.hasBuff(template, now)) packets.push(...target.removeBuff(template, now));
    }
    const template = POISON[count - 1];
    packets.push(...this._buff(template, now, target.id));
    const mark = valid ? old : {};
    Object.assign(mark, {
      stacks: count, template, version: target.buffVersions.get(template), end: now + 5000,
      power, source_generation: generation, target_generation: target.generation,
    });
    this.marks.set(target.id, mark);
    if (!valid) this._queue(now + 1000, 'scorpion_dot', target.id, mark);
    // Refresh duration/power but retain the existing 1 s clock.
    return packets;
  }

  _consume(target, now) {
    const mark = this.marks.get(target.id);
    this.marks.delete(target.id);
    const packets = [];
    if (mark && target.hasBuff(mark.template, now)
      && target.buffSources.get(mark.template) === this.id) {
      packets.push(...target.removeBuff(mark.template, now));
    }
    return packets;
  }

  _flight(flight, now) {
    const start = pointAt(flight.start, flight.end,
      (flight.previous - flight.begin) / (flight.finish - flight.begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
    const enhanced = flight.template === 343211;
    const contacts = [];
    for (const target of this.arena.actors.values()) {
      if (target.alive && target.camp !== this.camp && !target.isUntargetable()
        && !flight.hits.has(`${target.id},${target.generation}`)) {
        const hit = actorContact(start, end, target, flight.previous, now, enhanced ? 60 : 36);
        if (hit !== null) contacts.push([hit, target.id]);
      }
    }
    const wall = enhanced ? null : this.arena.geometry.wallContact(start, end);
    const packets = [];
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [contact, ident] of contacts) {
      if (wall !== null && contact >= wall) break;
      const target = this.arena.actors.get(ident);
      flight.hits.add(`${ident},${target.generation}`);
      if (this.projectileBlocked(target, now)) {
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
      packets.push(...this.damage(flight.raw, now, { target, school: 'energy', basic: true })[0]);
      packets.push(...this._poison(target, flight.power, flight.source_generation, now));
      if (!enhanced) return packets.concat([scene({ blownBullets: [flight.id] })]);
    }
    if (now >= flight.finish || wall !== null) {
      return packets.concat([scene(wall !== null
        ? { blownBullets: [flight.id] } : { expiredBullets: [flight.id] })]);
    }
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return packets;
  }

  _explode(target, center, stacks, power, now) {
    const packets = [];
    const raw = power.mul(D(1).add(D('.5').mul(Math.floor((stacks - 1) / 3))));
    for (const victim of [...this.arena.actors.values()]) {
      if (victim.alive && victim.camp !== this.camp
        && Math.hypot(center[0] - victim.positionAt(now)[0],
          center[1] - victim.positionAt(now)[1]) <= 120) {
        packets.push(...this.damage(raw, now,
          { target: victim, school: 'energy', lifesteal: D('.25') })[0]);
      }
    }
    if (stacks === 10) {
      packets.push(...this._buff(343321, now, target.id), ...this._buff(343322, now, target.id));
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'scorpion_dot') {
      const [ident, mark] = data;
      const target = this.arena.actors.get(ident);
      if (!this._mark_valid(target, mark, now, { finalTick: true })) {
        if (this.marks.get(ident) === mark) this.marks.delete(ident);
        return [];
      }
      const steal = this.generation === mark.source_generation && this.alive ? D('.5') : 0;
      const packets = this.damage(mark.power.mul(DOT[mark.stacks - 1]), now, {
        target, school: 'energy', lifesteal: steal, periodic: true,
      })[0];
      if (this.marks.get(ident) === mark) {
        if (now < mark.end) this._queue(now + 1000, kind, ident, mark);
        else this.marks.delete(ident); // no natural-expiry explosion
      }
      return packets;
    }
    if (kind === 'scorpion_spray') {
      const [cast, index] = data;
      if (this.spray !== cast || !this.alive || this.generation !== cast.generation) return [];
      const center = this.positionAt(now);
      const dest = [pyRound(center[0] + cast.direction[0] * 480),
        pyRound(center[1] + cast.direction[1] * 480)];
      const packets = [scene({ skills: [this._skillEvent(343401, center, dest)] })];
      for (const target of [...this.arena.actors.values()]) {
        if (!target.alive || target.camp === this.camp || target.isUntargetable()) continue;
        const pos = target.positionAt(now);
        const span = Math.hypot(center[0] - pos[0], center[1] - pos[1]);
        const dot = (pos[0] - center[0]) * cast.direction[0] + (pos[1] - center[1]) * cast.direction[1];
        if (span <= 480 && (span === 0 || dot >= span * Math.cos(15 * Math.PI / 180))) {
          packets.push(...this.damage(cast.power.mul(D('.58')), now,
            { target, school: 'energy' })[0]);
          packets.push(...this._poison(target, cast.power, cast.generation, now));
        }
      }
      if (index < 4 && this.spray === cast) this._queue(now + 300, kind, cast, index + 1);
      else if (this.spray === cast) this.spray = null;
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (slot === 2 && !this.space_count) return [];
    if ((slot === 0 || slot === 10) && (!this._inside(dest)
      || (start[0] === dest[0] && start[1] === dest[1]))) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 6000, 2: 5000, 10: 8000 }[slot], slot);
    const packets = [];
    if (slot === 0) {
      const template = this.hasBuff(343201, now) ? 343211 : 343100;
      packets.push(...this.shoot(template, start, dest, now, power,
        { school: 'energy', basic: true, power }));
    } else if (slot === 1) {
      for (const template of [343201, 343202, 343203]) packets.push(...this._buff(template, now));
      packets.push(...this._basic_slot());
    } else if (slot === 10) {
      const span = Math.hypot(start[0] - dest[0], start[1] - dest[1]);
      const cast = this.spray = {
        generation: this.generation, power,
        direction: [(dest[0] - start[0]) / span, (dest[1] - start[1]) / span],
      };
      packets.push(...this._event(now, 'scorpion_spray', [cast, 0]));
    } else {
      if (this.space_count === 2) this.space_next_charge = now + this.skillCooldown(15000);
      this.space_count -= 1;
      const targets = [...this.arena.actors.values()].filter(a => a.alive && a.camp !== this.camp
        && !a.isUntargetable()
        && Math.hypot(start[0] - a.positionAt(now)[0], start[1] - a.positionAt(now)[1]) <= 600);
      const explosions = [];
      // Snapshot/consume every pre-cast mark before any damage or proc.
      for (const target of targets) {
        const mark = this.marks.get(target.id);
        if (mark && this._mark_valid(target, mark, now)) {
          explosions.push([target, target.positionAt(now), mark.stacks]);
          packets.push(...this._consume(target, now));
        }
      }
      packets.push(scene({ skills: [this._skillEvent(343301, start, start, this.id)] }));
      const [ident, packet] = this.addObject(343303, start);
      packets.push(packet);
      this._queue(now + 300, 'object_expire', ident);
      for (const target of targets) {
        packets.push(...this.damage(power.mul(D('2.37')), now,
          { target, school: 'energy', lifesteal: D('.5') })[0]);
        for (const template of [343302, 343304, 343305]) {
          packets.push(...this._buff(template, now, target.id));
        }
      }
      for (const [target, center, stacks] of explosions) {
        packets.push(...this._explode(target, center, stacks, power, now));
      }
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as SCORPION_SLOTS, POISON as SCORPION_POISON, DOT as SCORPION_DOT };
