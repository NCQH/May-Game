/* Pegasus (tank 10000035): counted wards, timed vanish, meteor decay.
 * Port of server/pegasus_actions.py onto the JS battle core.
 *
 * Stubs: presentation only. Damage-identity keys are stringified; the pending
 * flight scan reads the JS arena's (kind, data) event args.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { packII, prepareDisplacement } from './melee.js';
import { flightKey, powD } from './batch-c-common.js';

const SLOTS = { 0: 309100, 1: 309201, 2: 309301, 10: 309401 };
const VANISH = Array.from({ length: 10 }, (_, i) => 309201 + i);

export class PegasusActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.vanish = this.ready = this.combat = null;
    this.ward_count = 0;
    this.shield_blocked = new Set();
    this.r_count = 2;
    this.r_next_charge = 0;
    this.assists = new Map();
    this.rewarded = new Set();
  }

  _cooldown(slot, changed = false) {
    const vanish = slot === 1 && this.vanish;
    const info = {
      skillId: vanish ? 309211 : SLOTS[slot], slot,
      count: slot === 10 ? this.r_count : -1,
      end: vanish ? this.vanish.begin + 1000 : this.cooldowns[slot],
      nextCharge: slot === 10 ? this.r_next_charge : 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _ward(now, { skill = false } = {}) {
    this.ward_count = 3;
    const packets = this.removeBuff(309111, now).concat(this.removeBuff(309131, now));
    return packets.concat(this._buff(skill ? 309131 : 309111, now));
  }

  // The core calls camelCase removeBuff; keep the Python override there.
  removeBuff(template, now, { expired = false } = {}) {
    const packets = super.removeBuff(template, now, { expired });
    if (template === 309131 && expired && this.alive && this.combat === null) {
      packets.push(...this._ward(now));
    }
    return packets;
  }

  on_spawn(now) {
    this.assists.clear();
    this.rewarded.clear();
    this.shield_blocked.clear();
    this.combat = null;
    const packets = [];
    for (let t = 309101; t <= 309105; t += 1) packets.push(...this._buff(t, now));
    return packets.concat(this._ward(now), [this._cooldown(1, true)]);
  }

  _engage(now) {
    this.combat = { end: now + 5000, generation: this.generation };
    this._queue(now + 5000, 'pegasus_idle', this.combat);
  }

  on_combat(now) {
    const context = this.arena.damageContext;
    if (this.alive && (!context || context.length !== 4 || context[0] !== this.id
      || context[1] === this.generation)) this._engage(now);
  }

  block_hit(key, amount, now, { basic = false, periodic = false, source = null } = {}) {
    if (amount.le(0)) return [false, []];
    this._engage(now);
    const ident = flightKey(key);
    if (this.shield_blocked.has(ident)) return [true, []];
    if (this.ward_count && (this.hasBuff(309111, now) || this.hasBuff(309131, now))) {
      this.ward_count -= 1;
      this.shield_blocked.add(ident);
      let packets = [];
      if (!this.ward_count) {
        packets = this.removeBuff(309111, now).concat(this.removeBuff(309131, now));
      }
      return [true, packets];
    }
    return [false, []];
  }

  damage(raw, now, options = {}) {
    const target = options.target || this.enemy;
    const before = target.alive;
    const [result, lost] = super.damage(raw, now, options);
    const context = this.arena.damageContext;
    const current = !context || context.length !== 4 || context[0] !== this.id
      || context[1] === this.generation;
    if (current && this.alive && before && !target.alive) result.push(...this._ward(now));
    return [result, lost];
  }

  reject_buff(row, source, now) { return Boolean(this.vanish && source.camp !== this.camp); }

  cc_immune(now, options = {}) { return Boolean(this.vanish) || super.ccImmune(now, options); }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  _appear(now, { dead = false } = {}) {
    const cast = this.vanish;
    this.vanish = null;
    if (!cast) return [];
    delete this.info.untargetable;
    delete this.info.damage_immune;
    this.cooldowns[1] = now + this.skillCooldown(8000, 1);
    const packets = [];
    for (const t of VANISH) packets.push(...this.removeBuff(t, now));
    if (!dead) {
      cast.pos = this.positionAt(now);
      this._queue(now + 200, 'pegasus_impact', cast);
      for (const t of [309211, 309214, 309215]) packets.push(...this._buff(t, now));
      packets.push(...this._ward(now, { skill: true }));
      packets.push(scene({ skills: [this._skillEvent(309211, cast.pos, cast.pos, this.id)] }));
    }
    return packets.concat([this._cooldown(1, true), this._cooldown(1)], this.syncSpeed(now));
  }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      this.ready = null;
      packets.push([1583, packII(this.id, 309301)]);
    }
    if (!this.alive) packets.push(...this._appear(now, { dead: true }));
    return packets.concat(this.syncSpeed(now));
  }

  update(now) {
    const packets = this.ready && this.skillSealed(2, now) ? this.interrupt(now) : [];
    while (this.r_next_charge && this.r_next_charge <= now) {
      this.r_count = Math.min(2, this.r_count + 1);
      this.r_next_charge = this.r_count < 2 ? this.r_next_charge + this.skillCooldown(6000) : 0;
      packets.push(this._cooldown(10));
    }
    const live = new Set();
    for (const entry of this.arena.pending) {
      if (entry.args?.[0] !== 'flight') continue;
      const flight = entry.args[1]?.[0];
      if (flight?.attack_key) live.add(flightKey(flight.attack_key));
    }
    for (const key of [...this.shield_blocked]) if (!live.has(key)) this.shield_blocked.delete(key);
    return packets.concat(super.update(now));
  }

  on_target_death(target, now) {
    const key = `${target.id},${target.generation}`;
    const mark = this.assists.get(key) ?? null;
    this.assists.delete(key);
    if (!this.alive || !mark || mark.generation !== this.generation || mark.end < now
      || this.rewarded.has(key)) return [];
    this.rewarded.add(key);
    this.cooldowns[1] = now;
    return [this._cooldown(1)];
  }

  _event(now, kind, data) {
    if (kind === 'pegasus_idle') {
      const [cast] = data;
      if (this.combat === cast && this.alive && this.generation === cast.generation) {
        this.combat = null;
        return this._ward(now);
      }
      return [];
    }
    if (kind === 'pegasus_appear') {
      return this.vanish === data[0] && this.alive ? this._appear(now) : [];
    }
    if (kind === 'pegasus_impact') {
      const [cast] = data;
      if (!this.alive || this.generation !== cast.generation) return [];
      const packets = [];
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(cast.pos[0] - target.positionAt(now)[0],
            cast.pos[1] - target.positionAt(now)[1]) <= 144) {
          packets.push(...this.damage(cast.power.mul(D('2.17')), now,
            { target, school: 'energy' })[0]);
          packets.push(...this._buff(309222, now, target.id));
        }
      }
      return packets;
    }
    if (kind === 'pegasus_meteors') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.skillSealed(2, now)) {
        return this.ready === cast ? this.interrupt(now) : [];
      }
      this.ready = null;
      const start = this.positionAt(now);
      const theta = Math.atan2(cast.dest[1] - start[1], cast.dest[0] - start[0]);
      const packets = [scene({ skills: [this._skillEvent(309301, start, cast.dest)] })];
      for (let index = 0; index < 12; index += 1) {
        const angle = theta + (index * 30) * Math.PI / 180;
        const dest = [start[0] + pyRound(480 * Math.cos(angle)),
          start[1] + pyRound(480 * Math.sin(angle))];
        packets.push(...this.shoot(309301, start, dest, now, cast.power.mul(D('2.1')), {
          school: 'energy', through_walls: true, context: cast,
          attack_key: [this.id, this.generation, 309301, [cast.attack_id, index]],
        }));
      }
      return packets.concat(this.syncSpeed(now));
    }
    return super._event(now, kind, data);
  }

  _flight(flight, now) {
    if (flight.template === 309100) return super._flight(flight, now);
    const start = pointAt(flight.start, flight.end,
      (flight.previous - flight.begin) / (flight.finish - flight.begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
    const packets = [];
    for (const target of [...this.arena.actors.values()]) {
      const key = `${target.id},${target.generation}`;
      if (!target.alive || target.camp === this.camp || flight.hits.has(key)
        || target.isUntargetable()) continue;
      const hit = actorContact(start, end, target, flight.previous, now,
        flight.template === 309401 ? 84 : 36);
      if (hit === null) continue;
      if (this.projectileBlocked(target, now)) {
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
      flight.hits.add(key);
      let raw = flight.raw;
      if (flight.template === 309301) {
        const counts = flight.context.counts;
        raw = raw.mul(powD(D('.95'), counts.get(key) ?? 0));
        counts.set(key, (counts.get(key) ?? 0) + 1);
        if (flight.source_generation === this.generation && this.alive) {
          this.assists.set(key, { end: now + 5000, generation: this.generation });
        }
      }
      packets.push(...this.damage(raw, now, { target, school: 'energy' })[0]);
      if (flight.template === 309401) packets.push(...this._buff(309402, now, target.id));
    }
    if (now >= flight.finish) {
      return packets.concat([scene({ expiredBullets: [flight.id] })]);
    }
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return packets;
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)) return [];
    if (slot === 1 && this.vanish) {
      return now >= this.vanish.begin + 1000 ? this._appear(now) : [];
    }
    if (this.vanish || this.cooldowns[slot] > now || (slot === 10 && !this.r_count)) return [];
    if ((slot === 0 || slot === 2 || slot === 10)
      && ((start[0] === dest[0] && start[1] === dest[1]) || !this._inside(dest))) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown({
      0: this.fireInterval(now), 1: 0, 2: 20000, 10: 3000,
    }[slot], slot);
    if (slot === 0) {
      return this.shoot(309100, start, dest, now, power,
        { school: 'energy', basic: true }).concat([this._cooldown(0)]);
    }
    let packets = this._ward(now, { skill: true });
    let stopped = [];
    if (slot === 1) {
      this.vanish = { begin: now, power, generation: this.generation };
      this.info.untargetable = this.info.damage_immune = true;
      this._queue(now + 3000, 'pegasus_appear', this.vanish);
      for (const t of VANISH) packets.push(...this._buff(t, now));
      packets.push(scene({ skills: [this._skillEvent(309201, start, start, this.id)] }),
        this._cooldown(1, true));
    } else if (slot === 10) {
      this.r_count -= 1;
      if (!this.r_next_charge) this.r_next_charge = now + this.skillCooldown(6000);
      packets.push(...this.shoot(309401, start, dest, now, power.mul(D('2.26')),
        { school: 'energy', through_walls: true }));
    } else {
      let prepared;
      [prepared, stopped] = prepareDisplacement(this, now, { interrupt: false });
      this.ready = {
        slot: 2, dest, power, generation: this.generation,
        counts: new Map(), attack_id: this._newId(2),
      };
      this._queue(now + 150, 'pegasus_meteors', this.ready);
      packets.push(scene({ skills: [this._skillEvent(309301, start, dest, 0, { ready: 1 })] }));
    }
    return packets.concat([this._cooldown(slot)], this.syncSpeed(now), stopped);
  }
}

export { SLOTS as PEGASUS_SLOTS, VANISH as PEGASUS_VANISH };
