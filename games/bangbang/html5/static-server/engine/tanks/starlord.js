/* Star Lord (tank 10000089): replaceable burns, mobile sweep and a jump.
 * Port of server/starlord_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. Q42 keeps four burn stages and the sweep is
 * not interrupted by crowd control (death ends it; old burns persist).
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, stop_move, encodeS1572 } from '../protocol.js';
import { packII } from './melee.js';

const SLOTS = { 0: 364100, 1: 364201, 2: 364301, 10: 364401 };
const BURNS = [364102, 364105, 364106, 364107]; // Q42: four stages
const SPACE_BUFFS = [364301, 364302, 364303, 364304, 364305];

export class StarLordActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.marks = new Map();
    this.ready = this.jump = this.sweep = null;
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    })];
  }

  on_spawn(now) { return this._buff(364101, now); }

  blocked(action, now) {
    return super.blocked(action, now) || this.ready !== null || this.jump !== null
      || (action === 'attack' && this.sweep !== null);
  }

  _speed(now) { return this.ready || this.jump ? 0 : super._speed(now); }

  cc_immune(now, { slow = false } = {}) {
    return this.jump !== null || super.cc_immune(now, { slow });
  }

  on_target_death(target) { this.marks.delete(target.id); return []; }

  _end_jump(now) {
    const cast = this.jump;
    this.jump = null;
    if (cast === null) return [];
    this.info.untargetable = cast.was_untargetable;
    this.info.damage_immune = cast.was_immune;
    this.position = this.positionAt(now);
    this.motion = null;
    this.forcedUntil = now;
    return this.removeBuff(364409, now).concat(this.syncSpeed(now));
  }

  _end_sweep(now) {
    this.sweep = null;
    const packets = [];
    for (const template of SPACE_BUFFS) {
      if (this.activeBuffs.has(`${this.id},${template}`)) packets.push(...this.removeBuff(template, now));
    }
    return packets;
  }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      this.ready = null;
      packets.push([1583, packII(this.id, 364401)]);
    }
    packets.push(...this._end_jump(now));
    // User: CC does not stop the sweep. Death does, while old burns persist.
    if (!this.alive) packets.push(...this._end_sweep(now));
    return packets.concat(this.syncSpeed(now));
  }

  _damage(target, raw, now, generation, { basic = false, periodic = false } = {}) {
    const was_alive = target.alive;
    const [packets, lost] = this.damage(raw, now, { target, school: 'energy', basic, periodic });
    if (was_alive && !target.alive && this.alive && generation === this.generation
      && this.sweep && now <= this.sweep.end) {
      packets.push(...this.restoreHp(this.maxHp.mul(D('.1')), now), ...this._buff(364307, now));
    }
    return [packets, lost];
  }

  _valid_mark(target, mark, now) {
    return target.alive && target.generation === mark.target_generation
      && this.marks.get(target.id) === mark && now < mark.end
      && target.hasBuff(mark.template, now)
      && target.buffVersions.get(mark.template) === mark.version;
  }

  _burn(target, power, generation, now) {
    if (!target.alive || target.rejectBuff({ nEffectType: '201' }, this, now)) return [];
    const old = this.marks.get(target.id);
    const valid = old && old.source_generation === generation && this._valid_mark(target, old, now);
    let stacks = valid ? old.stacks : 0;
    let next_stack = valid ? old.next_stack_at : 0;
    if (now >= next_stack) {
      stacks = Math.min(4, stacks + 1);
      next_stack = now + 500;
    }
    const packets = [];
    for (const template of BURNS) {
      if (target.hasBuff(template, now) && target.buffSources.get(template) === this.id) {
        packets.push(...target.removeBuff(template, now));
      }
    }
    const template = BURNS[stacks - 1];
    packets.push(...this._buff(template, now, target.id));
    packets.push(...this._buff(364103, now, target.id, { stacks }));
    const mark = {
      template, stacks, power, end: now + 2000, next_stack_at: next_stack,
      version: target.buffVersions.get(template), source_generation: generation,
      target_generation: target.generation,
    };
    this.marks.set(target.id, mark);
    // A refresh replaces the delayed tick's identity; never keep two clocks.
    packets.push(...this._damage(target, power.mul(D('.1')).mul(stacks), now, generation,
      { periodic: true })[0]);
    if (target.alive) {
      this._queue(now + 1000, 'star_burn', target.id, mark);
      this._queue(now + 2000, 'star_burn_end', target.id, mark);
    }
    return packets;
  }

  _hit(target, raw, power, generation, now, { basic = false } = {}) {
    const [packets, lost] = this._damage(target, raw, now, generation, { basic });
    if (lost) packets.push(...this._burn(target, power, generation, now));
    return packets;
  }

  _enemies(pos, radius, now) {
    return [...this.arena.actors.values()].filter(a => a.alive && a.camp !== this.camp
      && a.isAreaTargetable()
      && Math.hypot(pos[0] - a.positionAt(now)[0], pos[1] - a.positionAt(now)[1]) <= radius);
  }

  _push(target, center, now) {
    const current = target.positionAt(now);
    const span = Math.hypot(current[0] - center[0], current[1] - center[1]);
    if (!span || target.ccImmune(now)) return [];
    const start = target.stopPosition(now);
    const safe = Math.hypot(start[0] - center[0], start[1] - center[1]);
    let dest = safe ? pointAt(center, start, 1 + 144 / safe) : pointAt(center, current, 144 / span);
    const wall = this.arena.geometry.wallContact(start, dest, 36);
    if (wall !== null) dest = pointAt(start, dest, Math.max(0, wall - 0.001));
    if (start[0] !== current[0] || start[1] !== current[1]) {
      target.position = start;
      target.motion = null;
    }
    const packets = target.interrupt(now);
    if (start[0] !== current[0] || start[1] !== current[1]) {
      packets.push(stop_move(target.sceneId, target.id, start));
    }
    target.forcedUntil = now + target._setMotion(start, dest, 720, now, 1);
    return packets.concat([scene({ moves: [this._moveEvent(target.motion[1], 720, 1, target.id)] })]);
  }

  _object(template, pos, duration, now) {
    const [ident, packet] = this.addObject(template, pos);
    // Native takeoff/landing props play their movie on removal.
    const kind = [364404, 364402].includes(template) ? 'star_visual_remove' : 'object_expire';
    this._queue(now + duration, kind, ident);
    return [packet];
  }

  _flight(flight, now) {
    const start = pointAt(flight.start, flight.end,
      (flight.previous - flight.begin) / (flight.finish - flight.begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
    const contacts = [];
    const basic = flight.template === 364100;
    for (const target of this.arena.actors.values()) {
      if (target.alive && target.camp !== this.camp && !target.isUntargetable()) {
        const hit = actorContact(start, end, target, flight.previous, now, basic ? 36 : 66);
        if (hit !== null) contacts.push([hit, target.id]);
      }
    }
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const hit = contacts.length ? contacts[0] : null;
    const wall = this.arena.geometry.wallContact(start, end);
    if (hit && (wall === null || hit[0] < wall)) {
      const target = this.arena.actors.get(hit[1]);
      if (this.projectileBlocked(target, now)) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      const packets = [scene({ blownBullets: [flight.id] })];
      if (basic) {
        packets.push(...this._hit(target, flight.raw, flight.power, flight.source_generation,
          now, { basic: true }));
        if (this.alive && this.generation === flight.source_generation) {
          packets.push(...this._buff(364109, now));
        }
      } else {
        const center = pointAt(start, end, hit[0]).map(pyRound);
        const targets = this._enemies(center, 144, now);
        for (const victim of targets) {
          packets.push(...this._hit(victim, flight.raw, flight.power, flight.source_generation, now));
        }
        if (this.alive && this.generation === flight.source_generation) {
          for (const slot of [1, 2, 10]) {
            this.cooldowns[slot] = Math.max(now, this.cooldowns[slot] - 1000 * targets.length);
            packets.push(this._cooldown(slot));
          }
        }
      }
      return packets;
    }
    if (wall !== null || now >= flight.finish) {
      return [scene(wall !== null ? { blownBullets: [flight.id] } : { expiredBullets: [flight.id] })];
    }
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return [];
  }

  _event(now, kind, data) {
    if (kind === 'star_visual_remove') return this.removeObject(data[0], { destroyed: true });
    if (kind === 'star_burn' || kind === 'star_burn_end') {
      const [ident, mark] = data;
      const target = this.arena.actors.get(ident);
      if (kind === 'star_burn' && this._valid_mark(target, mark, now)) {
        return this._damage(target, mark.power.mul(D('.1')).mul(mark.stacks), now,
          mark.source_generation, { periodic: true })[0];
      }
      if (this.marks.get(ident) === mark) this.marks.delete(ident);
      return [];
    }
    if (kind === 'star_sweep') {
      const [cast, index] = data;
      if (this.sweep !== cast || !this.alive || this.generation !== cast.generation) return [];
      const center = this.positionAt(now);
      const packets = [scene({ skills: [this._skillEvent(364501, center, center, this.id)] })];
      for (const target of this._enemies(center, 288, now)) {
        packets.push(...this._hit(target, cast.power, cast.power, cast.generation, now));
      }
      if (index === 12) return packets.concat(this._end_sweep(now));
      this._queue(now + 250, kind, cast, index + 1);
      return packets;
    }
    if (kind === 'star_takeoff') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.generation !== cast.generation) return [];
      this.ready = null;
      this.jump = cast;
      this.info.untargetable = this.info.damage_immune = true;
      const start = this.positionAt(now);
      const dest = this.moveDestination(start, cast.dest);
      const speed = Math.max(1, Math.hypot(start[0] - dest[0], start[1] - dest[1]) * 2);
      const duration = this._setMotion(start, dest, speed, now, 4);
      this.forcedUntil = now + duration;
      this._queue(now + duration, 'star_land', cast);
      const packets = this._buff(364409, now, null, { duration });
      packets.push(...this._object(364404, start, 100, now), ...this._object(364402, dest, 400, now));
      packets.push(scene({ moves: [this._moveEvent(dest, pyRound(speed), 4)] }));
      for (const target of this._enemies(start, 144, now)) {
        packets.push(...this._hit(target, cast.power.mul(D('1.39')), cast.power,
          cast.generation, now));
        if (this.arena.pk && this.arena.pk.finished) break;
        if (target.alive) packets.push(...this._push(target, start, now));
      }
      return packets;
    }
    if (kind === 'star_land') {
      const [cast] = data;
      if (this.jump !== cast || !this.alive || this.generation !== cast.generation) return [];
      const center = this.positionAt(now);
      const packets = this._end_jump(now).concat(this._object(364408, center, 500, now));
      for (const target of this._enemies(center, 144, now)) {
        packets.push(...this._hit(target, cast.power.mul(D('1.68')), cast.power,
          cast.generation, now));
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (slot !== 2 && (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1]))) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 6000, 2: 30000, 10: 8000 }[slot], slot);
    let packets;
    if (slot === 0 || slot === 1) {
      packets = this.shoot(SLOTS[slot], start, dest, now,
        power.mul(slot === 0 ? D('1.5') : D('1.93')), {
          school: 'energy', basic: slot === 0, power, speed_multiplier: slot === 0 ? 1.5 : 1,
        });
    } else if (slot === 2) {
      this.sweep = { power, generation: this.generation, end: now + 3000 };
      packets = [];
      for (const template of SPACE_BUFFS.concat([364308])) packets.push(...this._buff(template, now));
      this._queue(now + 250, 'star_sweep', this.sweep, 1);
    } else {
      if (Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 408) {
        dest = pointAt(start, dest,
          408 / Math.hypot(start[0] - dest[0], start[1] - dest[1])).map(pyRound);
      }
      this.ready = {
        slot: 10, dest: dest.map(pyRound), power, generation: this.generation,
        was_immune: this.info.damage_immune ?? false,
        was_untargetable: this.info.untargetable ?? false,
      };
      this.position = start;
      this.motion = null;
      this._queue(now + 50, 'star_takeoff', this.ready);
      packets = this._buff(364403, now).concat([scene({
        skills: [this._skillEvent(364401, start, dest, 0, { ready: 1 })],
      })]);
      packets.push(...this.syncSpeed(now));
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as STARLORD_SLOTS, BURNS as STARLORD_BURNS };
