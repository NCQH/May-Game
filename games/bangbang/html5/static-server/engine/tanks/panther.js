/* Black Panther (tank 10000100): E carry, R suffocating strike, Space finale.
 * Port of server/panther_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin and no bush visibility (teamVisible always true).
 * The two-stage E, held victims, bombs and Space schedule are faithful.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, circleContact, pointAt, pyRound } from '../math.js';
import { scene, stop_move, encodeS1562, encodeS1572, encodeS1579 } from '../protocol.js';
import { prepareDisplacement } from './melee.js';

const SLOTS = { 0: 375100, 1: 375201, 2: 375301, 10: 375401 };
const OWN_BUFFS = [375202, 375211, 375220, 375404, 375405, 375406, 375407,
  375302, 375305, 375306, 375313, 375321, 375330];
const teamVisible = () => true; // stub: no bush/fog visibility on the JS core

export class PantherActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.combo = null;
  }

  _cooldown(slot, changed = false) {
    const info = { skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0 };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) { return this._buff(375101, now).concat(this._buff(375102, now)); }

  blocked(action, now) { return super.blocked(action, now) || this.combo !== null; }

  _speed(now) { return this.combo ? 0 : super._speed(now); }

  cc_immune(now, { slow = false } = {}) {
    return Boolean(this.combo && this.combo.kind === 'space') || super.cc_immune(now, { slow });
  }

  _valid(cast) {
    return this.combo === cast && this.alive && this.generation === cast.generation;
  }

  _enemies(position, radius, now) {
    return [...this.arena.actors.values()].filter(a => a.alive && a.camp !== this.camp
      && !a.isUntargetable()
      && Math.hypot(position[0] - a.positionAt(now)[0], position[1] - a.positionAt(now)[1]) <= radius
      && teamVisible(this.arena, this, a, now));
  }

  _object(template, position, duration, now) {
    const [ident, packet] = this.addObject(template, position);
    const kind = template === 375326 ? 'panther_visual_remove' : 'object_expire';
    this._queue(now + duration, kind, ident);
    return [packet];
  }

  _finish(now) {
    const cast = this.combo;
    this.combo = null;
    if (cast === null) return [];
    this.position = this.positionAt(now);
    this.motion = null;
    this.forcedUntil = now;
    if (cast.kind === 'space') {
      this.info.untargetable = cast.was_untargetable;
      this.info.damage_immune = cast.was_immune;
    }
    const packets = [scene({ moves: [this._moveEvent(this.position, 0, 5)] })];
    const finished = this.arena.pk && this.arena.pk.finished;
    for (const [ident, held] of Object.entries(cast.held || {})) {
      const target = this.arena.actors.get(Number(ident));
      if (target.generation === held.generation
        && (target.motion === held.motion || (finished && target.motion === null))) {
        target.position = target.positionAt(now);
        target.motion = null;
        target.forcedUntil = now;
        packets.push(scene({ moves: [target._moveEvent(target.position, 0, 5)] }));
      }
    }
    for (const template of OWN_BUFFS) {
      if (this.activeBuffs.has(`${this.id},${template}`)) packets.push(...this.removeBuff(template, now));
    }
    return finished ? packets : packets.concat(this.syncSpeed(now));
  }

  interrupt(now) { return this._finish(now); }

  _motion(cast, start, dest, speed, now, kind) {
    this._setMotion(start, dest, speed, now, kind);
    this.forcedUntil = this.motion[3];
    cast.previous = now;
    this._queue(Math.min(now + 20, this.motion[3]), 'panther_dash', cast);
    return [scene({ moves: [this._moveEvent(this.motion[1], speed, kind)] })];
  }

  _dash(cast, now) {
    if (!this._valid(cast)) return [];
    if (!this.motion) return this._finish(now);
    const start = this.positionAt(cast.previous);
    const end = this.positionAt(now);
    const packets = [];
    if (cast.phase === 'e_first' || cast.phase === 'e_second') {
      const contacts = [];
      for (const target of this.arena.actors.values()) {
        if (target.alive && target.camp !== this.camp && !target.isUntargetable()
          && !cast.hits.has(`${target.id},${target.generation}`)) {
          const hit = actorContact(start, end, target, cast.previous, now);
          if (hit !== null) contacts.push([hit, target.id]);
        }
      }
      contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [hit, ident] of contacts) {
        const target = this.arena.actors.get(ident);
        cast.hits.add(`${ident},${target.generation}`);
        if (cast.phase === 'e_first') {
          const impact = pointAt(start, end, hit).map(pyRound);
          this.position = this.stopPosition(now, impact);
          this.motion = null;
          this.forcedUntil = now;
          cast.phase = 'e_wait';
          cast.target = ident;
          cast.target_generation = target.generation;
          packets.push(...this.removeBuff(375202, now));
          packets.push(stop_move(this.sceneId, this.id, this.position));
          packets.push(scene({
            moves: [this._moveEvent(this.position, 0, 5)],
            skills: [this._skillEvent(375210, impact, target.positionAt(now), ident)],
          }));
          packets.push(...this.damage(cast.power.mul(D('1.25')), now, { target })[0]);
          if (this.arena.pk && this.arena.pk.finished) return packets.concat(this._finish(now));
          if (!this._valid(cast)) return packets;
          packets.push(...this._buff(375211, now));
          this._queue(now + 200, 'panther_e_second', cast);
          return packets;
        }
        // Carry along the remaining dash; one impact per victim/life.
        if (!target.ccImmune(now)) {
          packets.push(...target.interrupt(now));
          target._setMotion(target.positionAt(now), this.motion[1], 792, now, 1);
          target.forcedUntil = target.motion[3];
          cast.held[ident] = { generation: target.generation, motion: target.motion };
          packets.push(scene({ moves: [target._moveEvent(target.motion[1], 792, 1)] }));
        }
        packets.push(...this.damage(cast.power.mul(D('1.65')), now, { target })[0]);
        if (this.arena.pk && this.arena.pk.finished) return packets.concat(this._finish(now));
        if (!this._valid(cast)) return packets;
      }
    }
    if (now >= this.motion[3]) {
      if (cast.phase === 'r_jump') {
        this.position = this.positionAt(now);
        this.motion = null;
        this.forcedUntil = now;
        cast.phase = 'r_wait_bombs';
        return packets.concat([scene({ moves: [this._moveEvent(this.position, 0, 5)] })]);
      }
      return packets.concat(this._finish(now));
    }
    cast.previous = now;
    this._queue(Math.min(now + 20, this.motion[3]), 'panther_dash', cast);
    return packets;
  }

  _e_second(cast, now) {
    if (!this._valid(cast)) return [];
    let target = this.arena.actors.get(cast.target);
    const start = this.positionAt(now);
    if (!target.alive || target.generation !== cast.target_generation || target.isUntargetable()) {
      const candidates = this._enemies(start, 336, now);
      if (!candidates.length) return this._finish(now);
      candidates.sort((a, b) => (Math.hypot(start[0] - a.positionAt(now)[0],
        start[1] - a.positionAt(now)[1]) - Math.hypot(start[0] - b.positionAt(now)[0],
        start[1] - b.positionAt(now)[1])) || a.id - b.id);
      target = candidates[0];
    }
    let direction = target.positionAt(now);
    if (direction[0] === start[0] && direction[1] === start[1]) direction = cast.aim;
    const span = Math.max(1, Math.hypot(start[0] - direction[0], start[1] - direction[1]));
    const dest = pointAt(start, direction, 240 / span);
    cast.phase = 'e_second';
    cast.hits = new Set();
    cast.held = {};
    const packets = this.removeBuff(375211, now).concat(this._buff(375220, now));
    return packets.concat(this._motion(cast, start, dest, 792, now, 3));
  }

  _r_hit(cast, target, now) {
    if (!this._valid(cast)) return [];
    const start = this.positionAt(now);
    this.position = this.moveDestination(start, target.positionAt(now));
    this.motion = null;
    const packets = [scene({ moves: [this._moveEvent(this.position, 0, 5)] })];
    packets.push(...this.damage(cast.power.mul(D('1.45')), now, { target })[0]);
    if (this.arena.pk && this.arena.pk.finished) return packets.concat(this._finish(now));
    if (!this._valid(cast)) return packets;
    packets.push(...this._buff(375430, now, target.id));
    for (const template of [375404, 375405, 375407]) {
      // Keep the auto-move marker until _finish; bombs follow the jump by 100 ms.
      packets.push(...this._buff(template, now, null, template === 375407 ? { duration: -1 } : {}));
    }
    cast.phase = 'r_jump';
    const dx = cast.start[0] - this.position[0], dy = cast.start[1] - this.position[1];
    const span = Math.max(1, Math.hypot(dx, dy));
    const dest = this.moveDestination(this.position,
      [this.position[0] + 336 * dx / span, this.position[1] + 336 * dy / span]);
    const speed = Math.max(1, pyRound(
      Math.hypot(this.position[0] - dest[0], this.position[1] - dest[1]) * 1000 / 700));
    packets.push(...this._motion(cast, this.position, dest, speed, now, 4));
    this._queue(now + 300, 'panther_r_aim', cast);
    this._queue(now + 800, 'panther_bombs', cast);
    return packets;
  }

  _bombs(cast, now) {
    if (!this._valid(cast)) return [];
    const start = this.positionAt(now);
    let dest = cast.aim;
    if (dest[0] === start[0] && dest[1] === start[1]) dest = [start[0] + 1, start[1]];
    const angle = Math.atan2(dest[1] - start[1], dest[0] - start[0]);
    const packets = [];
    for (const offset of [-45, -22.5, 0, 22.5, 45]) {
      const rad = angle + offset * Math.PI / 180;
      const aim = [pyRound(start[0] + 336 * Math.cos(rad)), pyRound(start[1] + 336 * Math.sin(rad))];
      packets.push(...this.shoot(375420, start, aim, now, cast.power.mul(D('1.94')),
        { school: 'physical', power: cast.power }));
    }
    return packets.concat(this._finish(now));
  }

  _flight(flight, now) {
    if (flight.template === 375100) return super._flight(flight, now);
    if (flight.template === 375310) {
      if (now >= flight.finish) return [scene({ expiredBullets: [flight.id] })];
      this._queue(flight.finish, 'flight', flight);
      return []; // presentation only; the Space schedule owns the hit
    }
    if (flight.template === 375401) {
      const cast = flight.context;
      const target = this.arena.actors.get(flight.target);
      if (!this._valid(cast) || !target.alive || target.isUntargetable()
        || target.generation !== flight.target_generation) {
        const packets = this.combo === cast ? this._finish(now) : [];
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
      const start = flight.pos, dest = target.positionAt(now);
      const end = pointAt(start, dest, Math.min(1, flight.speed * (now - flight.previous) / 1000
        / Math.max(1, Math.hypot(start[0] - dest[0], start[1] - dest[1]))));
      const packets = [];
      if (dest[0] !== flight.end[0] || dest[1] !== flight.end[1]) {
        packets.push([1562, encodeS1562(flight.id, start, dest)]);
        flight.end = dest;
      }
      flight.pos = end;
      if (circleContact(start, end, target.positionAt(flight.previous), dest) !== null) {
        packets.push(...(this.projectileBlocked(target, now) ? this._finish(now) : this._r_hit(cast, target, now)));
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
      if (now >= flight.finish) {
        return packets.concat(this._finish(now), [scene({ expiredBullets: [flight.id] })]);
      }
    } else {
      const start = pointAt(flight.start, flight.end,
        (flight.previous - flight.begin) / (flight.finish - flight.begin));
      const end = pointAt(flight.start, flight.end,
        Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
      const contacts = [];
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp) {
          const hit = actorContact(start, end, target, flight.previous, now);
          if (hit !== null) contacts.push([hit, target.id]);
        }
      }
      contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const wall = this.arena.geometry.wallContact(start, end);
      const contact = contacts.length ? contacts[0] : null;
      const at_target = contact && (wall === null || contact[0] < wall);
      if (at_target && this.projectileBlocked(this.arena.actors.get(contact[1]), now)) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      if (at_target || wall !== null || now >= flight.finish) {
        const pos = pointAt(start, end, at_target ? contact[0] : wall !== null ? wall : 1).map(pyRound);
        const packets = this._object(375420, pos, 100, now);
        for (const target of [...this.arena.actors.values()]) {
          if (target.alive && target.camp !== this.camp
            && Math.hypot(pos[0] - target.positionAt(now)[0], pos[1] - target.positionAt(now)[1]) <= 96) {
            packets.push(...this.damage(flight.raw, now, { target })[0]);
            packets.push(...this._buff(375421, now, target.id));
          }
        }
        return packets.concat([scene({ blownBullets: [flight.id] })]);
      }
    }
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return [];
  }

  _space_final(cast, now) {
    if (!this._valid(cast) || cast.final) return [];
    cast.final = true;
    const center = this.positionAt(now);
    const packets = this._finish(now);
    packets.push(...this._object(375323, center, 300, now), ...this._object(375326, center, 100, now));
    for (const target of [...this.arena.actors.values()]) {
      if (!target.alive || target.camp === this.camp
        || Math.hypot(center[0] - target.positionAt(now)[0],
          center[1] - target.positionAt(now)[1]) > 144) continue;
      const raw = cast.power.mul(D('3.5')).add(target.maxHp.sub(target.hp).mul(D('.15')));
      packets.push(...this.damage(raw, now, { target })[0]);
      if (this.arena.pk && this.arena.pk.finished) return packets;
      if (target.alive && !target.ccImmune(now)) {
        packets.push(...target.interrupt(now));
        const pos = target.positionAt(now);
        let aim = pos[0] === center[0] && pos[1] === center[1] ? cast.aim : pos;
        if (aim[0] === center[0] && aim[1] === center[1]) aim = [center[0] + 1, center[1]];
        const dx = aim[0] - center[0], dy = aim[1] - center[1];
        const span = Math.hypot(dx, dy);
        target._setMotion(pos, [pos[0] + 144 * dx / span, pos[1] + 144 * dy / span], 720, now, 1);
        target.forcedUntil = target.motion[3];
        packets.push(scene({ moves: [target._moveEvent(target.motion[1], 720, 1)] }));
      }
      packets.push(...this._buff(375309, now, target.id));
    }
    return packets;
  }

  _space_hit(cast, index, now) {
    if (!this._valid(cast)) return [];
    const center = this.positionAt(now);
    let target = this.arena.actors.get(cast.target);
    if (index || !target.alive || target.generation !== cast.target_generation) {
      const candidates = this._enemies(center, 408, now);
      if (!candidates.length) return this._space_final(cast, now);
      target = candidates[Math.floor(this.arena.rng() * candidates.length)];
    }
    if (target.isUntargetable()) return this._space_final(cast, now);
    const pos = target.positionAt(now);
    this.position = this.blinkDestination(center, pos);
    this.motion = null;
    cast.target = target.id;
    cast.target_generation = target.generation;
    cast.resolving = true;
    const packets = [scene({ moves: [this._moveEvent(this.position, 0, 5)] })];
    if (index === 0) {
      packets.push(...this.removeBuff(375302, now));
      packets.push(...this._buff(375305, now), ...this._buff(375306, now, null, { duration: 3800 }));
    } else {
      // Follow-up slash is a visual event; the scheduled strike owns the damage.
      packets.push(...this.shoot(375310, center, pos, now, D(0), { school: 'physical', target }));
    }
    packets.push(...this._buff(index === 0 ? 375304 : 375312, now, target.id));
    for (const victim of [...this.arena.actors.values()]) {
      if (victim.alive && victim.camp !== this.camp
        && Math.hypot(pos[0] - victim.positionAt(now)[0], pos[1] - victim.positionAt(now)[1]) <= 72) {
        packets.push(...this.damage(cast.power.mul(D('2.22')), now, { target: victim })[0]);
        packets.push(...this._buff(375309, now, victim.id));
      }
    }
    cast.resolving = false;
    if (this._valid(cast) && !this._enemies(pos, 408, now).length) {
      packets.push(...this._space_final(cast, now));
    }
    return packets;
  }

  on_target_death(target, now) {
    const cast = this.combo;
    if (cast && cast.kind === 'space' && !cast.resolving && target.id === cast.target
      && !this._enemies(this.positionAt(now), 408, now).length) {
      return this._space_final(cast, now);
    }
    return [];
  }

  _event(now, kind, data) {
    if (kind === 'panther_visual_remove') return this.removeObject(data[0], { destroyed: true });
    if (kind.startsWith('panther_')) {
      const cast = data[0];
      if (!this._valid(cast)) return [];
      if (kind === 'panther_dash') return this._dash(cast, now);
      if (kind === 'panther_e_second') return this._e_second(cast, now);
      if (kind === 'panther_r_aim') return this._buff(375406, now);
      if (kind === 'panther_bombs') return this._bombs(cast, now);
      if (kind === 'panther_space_hit') return this._space_hit(cast, data[1], now);
      if (kind === 'panther_space_final_ready') return this._buff(375313, now);
      if (kind === 'panther_space_final') return this._space_final(cast, now);
    }
    return super._event(now, kind, data);
  }

  handle(message, payload) {
    if (message === 514) {
      const now = this.clock();
      const packets = this.arena.tick(now);
      if (!this.arena.inputOpen(now, this)) return packets;
      if (payload.length === 8 && this.combo && this.combo.kind === 'r' && this.alive) {
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        const sceneId = view.getUint32(0, true);
        const x = view.getInt16(4, true), y = view.getInt16(6, true);
        if (sceneId === this.sceneId && (x !== this.positionAt(now)[0] || y !== this.positionAt(now)[1])) {
          this.combo.aim = [x, y]; // original client projects 2000 units
        }
      }
      return packets;
    }
    return super.handle(message, payload);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    const target = this.arena.actors.get(target_id);
    if (slot === 2 || slot === 10) {
      if (!target || !target.alive || target.camp === this.camp || target.isUntargetable()
        || Math.hypot(start[0] - target.positionAt(now)[0], start[1] - target.positionAt(now)[1])
          > (slot === 2 ? 240 : 408)
        || !teamVisible(this.arena, this, target, now)) return [];
    } else if (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1])) {
      return [];
    }
    const power = this.combatStat('iAttack', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 1: 8000, 2: 25000, 10: 6000 }[slot] ?? this.fireInterval(now), slot);
    const packets = [this._cooldown(slot)];
    if (slot === 0) {
      return packets.concat(this.shoot(375100, start, dest, now, power,
        { school: 'physical', basic: true, power }));
    }
    let body = start;
    let handoff = [];
    if (slot === 1) {
      [body, handoff] = prepareDisplacement(this, now, { interrupt: false });
      if (!handoff.length) body = start;
    }
    const cast = this.combo = {
      kind: { 1: 'e', 2: 'space', 10: 'r' }[slot], generation: this.generation,
      start, aim: dest, power, begin: now,
    };
    this.position = body;
    this.motion = null;
    if (slot === 1) {
      cast.phase = 'e_first';
      cast.hits = new Set();
      dest = pointAt(start, dest, 408 / Math.max(1, Math.hypot(dest[0] - start[0], dest[1] - start[1])));
      packets.push(...this._buff(375202, now));
      packets.push(...handoff);
      packets.push(...this._motion(cast, body, dest, 840, now, 3));
    } else if (slot === 10) {
      cast.phase = 'r_flight';
      packets.push(...this.shoot(375401, start, target.positionAt(now), now, D(0), {
        school: 'physical', target, power, through_walls: true, context: cast,
      }));
    } else {
      cast.target = target.id;
      cast.target_generation = target.generation;
      cast.was_immune = this.info.damage_immune ?? false;
      cast.was_untargetable = this.info.untargetable ?? false;
      this.position = start;
      this.motion = null;
      this.info.damage_immune = this.info.untargetable = true;
      packets.push(...this._buff(375302, now), ...this._buff(375308, now, target.id));
      packets.push(...this._object(375307, start, 700, now));
      for (let index = 0; index < 6; index += 1) {
        this._queue(now + 600 + index * 500, 'panther_space_hit', cast, index);
      }
      this._queue(now + 3800, 'panther_space_final_ready', cast);
      this._queue(now + 4400, 'panther_space_final', cast);
    }
    return packets.concat(this.syncSpeed(now));
  }
}

export { SLOTS as PANTHER_SLOTS, OWN_BUFFS as PANTHER_OWN_BUFFS };
