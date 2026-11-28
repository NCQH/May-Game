/* Chopper (tank 10000029): passive shield, heal wave, healing aura, energy wave.
 * Port of server/chopper_actions.py onto the JS battle core.
 *
 * Stubs: presentation only. The wave keeps the approved wall stop and 240/480
 * push; the aura is mobile, not an interruptible channel.
 */
import { TankActions, TANK_CONTACT_RADIUS } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';
import { prepareDisplacement } from './melee.js';

const SLOTS = { 0: 304100, 1: 304201, 2: 304301, 10: 304401 };

export class ChopperActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.skills = Object.fromEntries(Object.values(SLOTS)
      .map(id => [id, arena.data.tableRow('SkillTemplate_table.xml', { nId: id })]));
    this.r_count = 2;
    this.r_next_charge = 0;
    this.shield_epoch = 0;
    this.aura = null;
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: slot === 10 ? this.r_count : -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: slot === 10 ? this.r_next_charge : 0,
    })];
  }

  on_spawn(now) {
    this.shield_epoch += 1;
    return this.addShield(304111, this.maxHp.mul(D('.25')), now);
  }

  onShieldBreak(template, now) {
    if (template !== 304111 || !this.alive) return [];
    this.shield_epoch += 1;
    this._queue(now + 15000, 'shield_return', this.generation, this.shield_epoch);
    return this._buff(304121, now);
  }

  interrupt(now) {
    if (!this.alive && this.aura) {
      this.aura = null;
      this.cooldowns[2] = now + this.skillCooldown(25000, 2);
      return [this._cooldown(2)];
    }
    return []; // A mobile aura, not an interruptible beam.
  }

  on_death() {
    this.aura = null;
    this.shield_epoch += 1;
  }

  update(now) {
    const packets = super.update(now);
    if (this.r_next_charge && now >= this.r_next_charge) {
      while (this.r_count < 2 && now >= this.r_next_charge) {
        this.r_count += 1;
        this.r_next_charge += this.skillCooldown(8000);
      }
      if (this.r_count === 2) this.r_next_charge = 0;
      packets.push(this._cooldown(10));
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'shield_return') {
      const [generation, epoch] = data;
      return this.alive && this.generation === generation && this.shield_epoch === epoch
        ? this.on_spawn(now) : [];
    }
    if (kind === 'heal_aura') {
      const [cast] = data;
      if (this.aura !== cast || !this.alive || this.generation !== cast.generation) return [];
      const packets = [];
      const pos = this.positionAt(now);
      for (const target of this.arena.actors.values()) {
        if (target.alive && target.camp === this.camp
          && Math.hypot(pos[0] - target.positionAt(now)[0],
            pos[1] - target.positionAt(now)[1]) <= 300) {
          packets.push(...target.restoreHp(cast.power.mul(D('.7')), now));
          packets.push(...this._buff(304312, now, target.id));
        }
      }
      if (now === cast.end) {
        this.aura = null;
        this.cooldowns[2] = now + this.skillCooldown(25000, 2);
        packets.push(this._cooldown(2));
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  _flight(flight, now) {
    if (flight.template !== 304401) return super._flight(flight, now);
    const { previous, begin, finish } = flight;
    const start = pointAt(flight.start, flight.end, (previous - begin) / (finish - begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - begin) / (finish - begin)));
    const wall = this.arena.geometry.wallContact(start, end);
    const packets = [];
    const hits = flight.hits ?? new Set();
    flight.hits = hits;
    for (const target of [...this.arena.actors.values()]) {
      if (!target.alive || target.camp === this.camp || hits.has(target.id)) continue;
      const hit = actorContact(start, end, target, previous, now, 98 + TANK_CONTACT_RADIUS);
      if (hit === null || (wall !== null && hit >= wall)) continue;
      if (this.projectileBlocked(target, now)) {
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
      hits.add(target.id);
      packets.push(...this._buff(304401, now, target.id));
      if (!target.ccImmune(now)) {
        const generation = target.generation;
        let origin, stopped;
        [origin, stopped] = prepareDisplacement(target, now);
        packets.push(...stopped);
        if (this.arena.pk && this.arena.pk.finished) break;
        if (!target.alive || target.generation !== generation) continue;
        const dx = flight.end[0] - flight.start[0], dy = flight.end[1] - flight.start[1];
        const span = Math.hypot(dx, dy);
        let dest = this.arena.geometry.clampTankPosition(
          [origin[0] + dx / span * 240, origin[1] + dy / span * 240]);
        const contact = this.arena.geometry.wallContact(origin, dest, TANK_CONTACT_RADIUS);
        if (contact !== null) dest = pointAt(origin, dest, Math.max(0, contact - 0.001));
        dest = dest.map(pyRound);
        target.forcedUntil = now + target._setMotion(origin, dest, 480, now, 3);
        dest = target.motion[1];
        packets.push(scene({ moves: [this._moveEvent(dest, 480, 3, target.id)] }));
      }
      packets.push(...this.damage(flight.raw, now, { target, school: 'energy' })[0]);
      if (this.arena.pk && this.arena.pk.finished) break;
    }
    if (wall !== null || now >= finish) {
      packets.push(scene({ expiredBullets: [flight.id] }));
    } else {
      flight.previous = now;
      this._queue(Math.min(now + 20, finish), 'flight', flight);
    }
    return packets;
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (slot === 2 && this.aura || slot === 10 && !this.r_count) return [];
    if ((slot === 0 || slot === 10)
      && (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1]))) return [];
    const target = this.arena.actors.get(targetId);
    if (slot === 1 && (!target || !target.alive || target.camp !== this.camp
      || Math.hypot(start[0] - target.positionAt(now)[0],
        start[1] - target.positionAt(now)[1]) > 480)) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + {
      0: this.fireInterval(now), 1: this.skillCooldown(6000, 1),
      2: 6000, 10: this.skillCooldown(4000, 10),
    }[slot];
    if (slot === 0 || slot === 10) {
      if (slot === 10) {
        this.r_count -= 1;
        if (!this.r_next_charge) this.r_next_charge = now + this.skillCooldown(8000);
      }
      return this.shoot(SLOTS[slot], start, dest, now,
        power.mul(slot === 10 ? D('2.26') : D(1)),
        { school: 'energy', basic: slot === 0 }).concat([this._cooldown(slot)]);
    }
    let packets;
    if (slot === 1) {
      packets = [scene({
        skills: [this._skillEvent(304201, start, target.positionAt(now), target.id)],
      })];
      packets.push(...target.restoreHp(power.mul(D('2.6')), now));
      packets.push(...this._buff(304202, now, target.id));
    } else {
      this.aura = { generation: this.generation, end: now + 6000, power };
      packets = [scene({ skills: [this._skillEvent(304301, start, start, this.id)] })];
      for (const template of [304301, 304302, 304303, 304304]) {
        packets.push(...this._buff(template, now));
      }
      for (let offset = 500; offset <= 6000; offset += 500) {
        this._queue(now + offset, 'heal_aura', this.aura);
      }
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as CHOPPER_SLOTS };
