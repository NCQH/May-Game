/* Hikari (tank 10000107): projectile wards, wind marks, three Space pulses.
 * Port of server/hikari_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. Pulses heal/pull allies and true-damage enemies
 * from missing HP, exactly as the Python kit.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, stop_move, encodeS1572 } from '../protocol.js';
import { packII, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 382100, 1: 382201, 2: 382301, 10: 382401 };

export class HikariActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.e_count = 2;
    this.e_next_charge = 0;
    this.ready = this.temple = null;
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: slot === 1 ? this.e_count : -1,
      end: slot === 2 && this.temple ? 0 : (this.cooldowns[slot] ?? 0),
      nextCharge: slot === 1 ? this.e_next_charge : 0,
    })];
  }

  on_spawn(now) { return this._buff(382101, now).concat(this._buff(382102, now)); }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  blocked(action, now) { return this.ready !== null || super.blocked(action, now); }

  _near(center, radius, now, { allied = false } = {}) {
    return [...this.arena.actors.values()].filter(a => a.alive
      && (a.camp === this.camp) === allied && (allied || a.isAreaTargetable())
      && Math.hypot(center[0] - a.positionAt(now)[0], center[1] - a.positionAt(now)[1]) <= radius);
  }

  _inspire(now) {
    const packets = this._buff(382122, now).concat(this._buff(382123, now));
    for (const target of this._near(this.positionAt(now), 432, now, { allied: true })) {
      packets.push(...this._buff(382121, now, target.id));
    }
    return packets;
  }

  _mark(target, now) {
    const packets = [];
    for (const template of [382111, 382112, 382113]) packets.push(...this._buff(template, now, target.id));
    return packets;
  }

  _impact(target, power, ratio, now) {
    const missing = target.maxHp.sub(target.hp);
    const [packets, lostIn] = this.damage(power, now, { target, school: 'energy' });
    let lost = lostIn;
    if (target.alive && ratio && !ratio.isZero()) {
      const [more, extra] = this.damage(missing.mul(ratio), now, { target, school: 'true' });
      packets.push(...more);
      lost = lost || extra;
    }
    if (lost) packets.push(...this._mark(target, now));
    return packets;
  }

  _object(template, pos, lifetime, now) {
    const [ident, packet] = this.addObject(template, pos);
    this._queue(now + lifetime, 'object_expire', ident);
    return [packet];
  }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      this.ready = null;
      this.cooldowns[2] = now + this.skillCooldown(8000, 2);
      packets.push([1583, packII(this.id, 382301)], this._cooldown(2));
      packets.push(...this.removeBuff(382322, now));
    }
    if (!this.alive && this.temple) packets.push(...this._end_temple(now));
    return packets.concat(this.syncSpeed(now));
  }

  update(now) {
    const packets = [];
    if (this.ready && this.skillSealed(2, now)) packets.push(...this.interrupt(now));
    while (this.e_next_charge && this.e_next_charge <= now) {
      this.e_count = Math.min(2, this.e_count + 1);
      this.e_next_charge = this.e_count < 2 ? this.e_next_charge + this.skillCooldown(6000) : 0;
      packets.push(this._cooldown(1));
    }
    return packets.concat(super.update(now));
  }

  _end_temple(now) {
    const cast = this.temple;
    this.temple = null;
    if (!cast) return [];
    this.cooldowns[2] = now + this.skillCooldown(30000, 2);
    const packets = [];
    for (const template of [382301, 382302, 382303, 382304]) packets.push(...this.removeBuff(template, now));
    packets.push(...this._buff(382331, now));
    return packets.concat([this._cooldown(2)]);
  }

  _pull(target, center, now) {
    const current = target.positionAt(now);
    if ((current[0] === center[0] && current[1] === center[1]) || target.ccImmune(now)) return [];
    const start = target.stopPosition(now);
    const span = Math.hypot(start[0] - center[0], start[1] - center[1]);
    const dest = span ? pointAt(start, center, Math.min(1, 120 / span)) : start;
    if (start[0] !== current[0] || start[1] !== current[1]) {
      target.position = start;
      target.motion = null;
    }
    const packets = target.interrupt(now);
    if (start[0] !== current[0] || start[1] !== current[1]) {
      packets.push(stop_move(target.sceneId, target.id, start));
    }
    const duration = target._setMotion(start, dest, 360, now, 1);
    target.forcedUntil = now + duration;
    return packets.concat([scene({ moves: [this._moveEvent(target.motion[1], 360, 1, target.id)] })]);
  }

  _pulse(cast, index, now) {
    const center = this.positionAt(now);
    const packets = [];
    for (const target of this._near(center, 432, now, { allied: true })) {
      packets.push(...target.cleanse(now));
      packets.push(...this._buff(382121, now, target.id));
      packets.push(...target.restoreHp(cast.max_hp.mul(D(index === 1 ? '.1' : '.05')), now));
    }
    for (const target of this._near(center, 432, now)) {
      const [more, lost] = this.damage(target.maxHp.sub(target.hp).mul(D(index === 1 ? '.1' : '.05')),
        now, { target, school: 'true' });
      packets.push(...more);
      if (this.arena.pk && this.arena.pk.finished) return packets;
      if (lost) packets.push(...this._mark(target, now));
      for (const template of [382605, 382606, 382607, 382608]) {
        packets.push(...this._buff(template, now, target.id));
      }
      if (target.alive) packets.push(...this._pull(target, center, now));
    }
    return packets;
  }

  _flight(flight, now) {
    if (flight.template === 382100) return super._flight(flight, now);
    const start = pointAt(flight.start, flight.end,
      (flight.previous - flight.begin) / (flight.finish - flight.begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
    const contacts = [];
    for (const target of this.arena.actors.values()) {
      if (target.alive && target.camp !== this.camp && !target.isUntargetable()) {
        const hit = actorContact(start, end, target, flight.previous, now, 72);
        if (hit !== null) contacts.push([hit, target.id]);
      }
    }
    if (contacts.length) {
      contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const [hit, ident] = contacts[0];
      if (this.projectileBlocked(this.arena.actors.get(ident), now)) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      const center = pointAt(start, end, hit).map(pyRound);
      const packets = this._object(382201, center, 380, now);
      for (const target of this._near(center, 168, now)) {
        packets.push(...this._impact(target, flight.power, D('.05'), now));
        packets.push(...this._buff(382213, now, target.id), ...this._buff(382214, now, target.id));
      }
      return packets.concat([scene({ blownBullets: [flight.id] })]);
    }
    if (now >= flight.finish) return [scene({ expiredBullets: [flight.id] })];
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return [];
  }

  _event(now, kind, data) {
    if (kind === 'hikari_eye') {
      const [cast] = data;
      const packets = this._object(382402, cast.pos, 550, now);
      for (const target of this._near(cast.pos, 168, now)) {
        packets.push(...this._impact(target, cast.power, D(0), now));
        packets.push(...this._buff(382412, now, target.id));
        if (target.alive && target.hasBuff(382412, now)) {
          const mark = { target: target.id, target_generation: target.generation,
            version: target.buffVersions.get(382412) };
          for (const index of [1, 2, 3]) {
            this._queue(now + 1500 * index, 'hikari_eye_tick', mark);
          }
        }
      }
      return packets;
    }
    if (kind === 'hikari_eye_tick') {
      const [mark] = data;
      const target = this.arena.actors.get(mark.target);
      if (!target.alive || target.generation !== mark.target_generation
        || !target.hasBuff(382412, now)
        || target.buffVersions.get(382412) !== mark.version) return [];
      const [packets, lost] = this.damage(target.maxHp.sub(target.hp).mul(D('.05')), now,
        { target, school: 'true', periodic: true });
      if (lost) packets.push(...this._mark(target, now));
      return packets.concat(this._buff(382422, now, target.id));
    }
    if (kind === 'hikari_ready') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.generation !== cast.generation) return [];
      if (this.skillSealed(2, now)) return this.interrupt(now);
      this.ready = null;
      this.temple = cast;
      const packets = this.syncSpeed(now);
      packets.push(scene({ skills: [this._skillEvent(382301, this.positionAt(now),
        this.positionAt(now), this.id)] }));
      for (const template of [382301, 382302, 382303, 382304]) packets.push(...this._buff(template, now));
      packets.push(...this._pulse(cast, 1, now));
      if (this.arena.pk && this.arena.pk.finished) return packets;
      this._queue(now + 1500, 'hikari_pulse', cast, 2);
      return packets;
    }
    if (kind === 'hikari_pulse') {
      const [cast, index] = data;
      if (this.temple !== cast || !this.alive || this.generation !== cast.generation) return [];
      const packets = this._pulse(cast, index, now);
      if (this.arena.pk && this.arena.pk.finished) return packets;
      if (index === 3) return packets.concat(this._end_temple(now));
      this._queue(now + 1500, 'hikari_pulse', cast, index + 1);
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now || (slot === 1 && !this.e_count)
      || (slot === 2 && this.temple)) return [];
    if (slot !== 2 && (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1]))) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 3000, 2: 30000, 10: 8000 }[slot], slot);
    const packets = slot ? [] : this._inspire(now);
    let handoff = [];
    if (slot === 0 || slot === 1) {
      if (slot === 1) {
        this.e_count -= 1;
        if (!this.e_next_charge) this.e_next_charge = now + this.skillCooldown(6000);
      }
      packets.push(...this.shoot(SLOTS[slot], start, dest, now, power, {
        school: 'energy', basic: slot === 0, power, through_walls: slot === 1,
      }));
    } else if (slot === 10) {
      const span = Math.hypot(start[0] - dest[0], start[1] - dest[1]);
      if (span > 600) dest = pointAt(start, dest, 600 / span).map(pyRound);
      packets.push(...this._object(382401, dest, 750, now));
      this._queue(now + 750, 'hikari_eye', { pos: dest, power });
    } else {
      let [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      if (!stopped.length) body = start;
      this.ready = { slot: 2, dest: start, generation: this.generation, max_hp: this.maxHp };
      this.position = body;
      this.motion = null;
      for (const target of this._near(start, 432, now)) packets.push(...this._buff(382321, now, target.id));
      packets.push(...this._buff(382322, now));
      packets.push(scene({ skills: [this._skillEvent(382301, start, start, this.id, { ready: 1 })] }));
      packets.push(...this.syncSpeed(now));
      this._queue(now + 1000, 'hikari_ready', this.ready);
      handoff = stopped;
    }
    return packets.concat([this._cooldown(slot)], handoff);
  }
}

export { SLOTS as HIKARI_SLOTS };
