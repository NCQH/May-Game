/* Tsubasa (tank 10000111): bounded bounces, one-shot reflection and catch-only
 * rewards. Port of server/tsubasa_actions.py.
 *
 * Stubs: presentation only; team_visible uses the batch-C check and the human
 * reflection prompt is an empty S1590.
 */
import { TankActions, human, privatePacket } from '../arena.js';
import { D, actorContact, circleContact, pointAt, pyRound } from '../math.js';
import { scene, stop_move, encodeS1562, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, packII, piercingStep, prepareDisplacement } from './melee.js';
import { teamVisible } from './batch-c-common.js';

const SLOTS = { 0: 386100, 1: 386201, 2: 386301, 10: 386401 };

export class TsubasaActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = 150;
    this.e_count = 2;
    this.e_next_charge = 0;
    this.ready = this.dash = null;
    this.reflections = [];
    this.reflect_used = 0;
  }

  _resource(delta) {
    if (this.noel_box) return [];
    const old = this.mp;
    this.mp = Math.max(0, Math.min(150, this.mp + delta));
    return old !== this.mp ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  _cooldown(slot, changed = false) {
    const info = {
      skillId: SLOTS[slot], slot, count: slot === 1 ? this.e_count : -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: slot === 1 ? this.e_next_charge : 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.ready = this.dash = null;
    this.reflections = [];
    this.reflect_used = 0;
    this.mp = 150;
    return [scene({ mp: [{ objectId: this.id, mp: 150 }] })].concat(this._buff(386101, now));
  }

  blocked(action, now) { return Boolean(this.ready || this.dash) || super.blocked(action, now); }

  _speed(now) { return this.ready || this.dash ? 0 : super._speed(now); }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      packets.push([1583, packII(this.id, 386301)]);
      this.ready = null;
      packets.push(...this.removeBuff(386311, now), ...this.removeBuff(386312, now));
    }
    if (this.dash) {
      this.position = this.stopPosition(now);
      this.motion = null;
      this.forcedUntil = now;
      this.dash = null;
      packets.push(scene({ moves: [this._moveEvent(this.position, 0, 5)] }));
      for (const template of [386202, 386221, 386231]) {
        packets.push(...this.removeBuff(template, now));
      }
    }
    return packets.concat(this.syncSpeed(now));
  }

  on_control(source, template, now) {
    const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
    const mask = Number(row.get('fEffectValB', 0));
    const sealed = (this.ready && (!mask || (mask & 4)))
      || (this.dash && (!mask || (mask & 2)));
    return row.get('nEffectType') === '30'
      || (['35', '66'].includes(row.get('nEffectType')) && sealed) ? this.interrupt(now) : [];
  }

  update(now) {
    const packets = [];
    while (this.e_next_charge && this.e_next_charge <= now) {
      this.e_count = Math.min(2, this.e_count + 1);
      this.e_next_charge = this.e_count < 2
        ? this.e_next_charge + this.skillCooldown(6000) : 0;
      packets.push(this._cooldown(1));
    }
    this.reflections = this.reflections.filter(r => r.end > now && r.generation === this.generation);
    return packets.concat(super.update(now));
  }

  reflect_projectile(flight, now) {
    const version = this.buffVersions.get(386111) ?? 0;
    if (!this.hasBuff(386111, now) || this.reflect_used === version) return false;
    this.reflect_used = version;
    this._queue(now, 'tsubasa_reflect', {
      generation: this.generation, power: flight.attacker_ap, end: now + 2000,
      reflected: flight.reflected ?? false, version,
    });
    return true;
  }

  _reflect_reply(dest, now) {
    if (!this.reflections.length) return [];
    const request = this.reflections.shift();
    const start = this.positionAt(now);
    if (!this.alive || request.generation !== this.generation || request.end < now
      || (start[0] === dest[0] && start[1] === dest[1])) return [];
    return this.shoot(386121, start, dest, now, request.power, {
      school: 'physical', reflected: true, through_walls: true,
    });
  }

  handle(message, payload) {
    if (message === 510) {
      const now = this.clock();
      const packets = this.arena.tick(now);
      if (!this.arena.inputOpen(now, this)) return packets;
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      if (payload.length >= 12 && view.getUint32(0, true) === this.sceneId) {
        packets.push(...this._reflect_reply([view.getInt16(8, true), view.getInt16(10, true)], now));
      }
      return packets;
    }
    if (message === 514 && payload.length >= 8 && this.dash) {
      const now = this.clock();
      const packets = this.arena.tick(now);
      if (!this.arena.inputOpen(now, this)) return packets;
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      if (view.getUint32(0, true) === this.sceneId) {
        this.dash.dest = [view.getInt16(4, true), view.getInt16(6, true)];
      }
      return packets;
    }
    return super.handle(message, payload);
  }

  _push(target, origin, distance, speed, now) {
    if (this.arena.pk && this.arena.pk.finished) return [];
    if (!target.alive || target.ccImmune(now)) return [];
    const current = target.positionAt(now);
    const pos = target.stopPosition(now);
    const end = aimed(origin, pos,
      Math.hypot(origin[0] - pos[0], origin[1] - pos[1]) + distance, { fixed: true });
    const packets = [];
    if (pos[0] !== current[0] || pos[1] !== current[1]) {
      target.position = pos;
      target.motion = null;
      packets.push(...target.interrupt(now));
      packets.push(stop_move(this.sceneId, target.id, pos));
    }
    target._setMotion(pos, end, speed, now, 1);
    target.forcedUntil = target.motion[3];
    return packets.concat([scene({ moves: [target._moveEvent(target.motion[1], speed, 1)] })]);
  }

  _hit(flight, target, now) {
    const current = this.alive
      && this.generation === (flight.context?.generation ?? flight.source_generation);
    const [packets, lost] = this.damage(flight.raw, now, {
      target, basic: flight.basic, reflected: flight.reflected,
    });
    const template = flight.template;
    if (flight.basic) {
      if (current) packets.push(...this._resource(5));
      const cast = flight.context;
      cast.visited.add(`${target.id},${target.generation}`);
      if (cast.count < 3) {
        const pos = target.positionAt(now);
        const choices = enemies(this).filter(t =>
          !cast.visited.has(`${t.id},${t.generation}`)
          && Math.hypot(pos[0] - t.positionAt(now)[0], pos[1] - t.positionAt(now)[1]) <= 300
          && teamVisible(this, t, now));
        if (choices.length) {
          choices.sort((a, b) => {
            const da = Math.hypot(pos[0] - a.positionAt(now)[0], pos[1] - a.positionAt(now)[1]);
            const db = Math.hypot(pos[0] - b.positionAt(now)[0], pos[1] - b.positionAt(now)[1]);
            return da - db || a.id - b.id;
          });
          const other = choices[0];
          cast.count += 1;
          packets.push(...this.shoot(386110, pos, other.positionAt(now), now,
            flight.raw.mul(D('.5')), {
              school: 'physical', basic: true, speed_multiplier: 1.5, target: other,
              context: cast, attack_key: flight.attack_key,
            }));
        }
      }
      return packets;
    }
    if (template === 386121) return packets.concat(this._push(target, flight.start, 72, 240, now));
    if (template === 386301) {
      if (current) packets.push(...this._resource(25));
      return packets.concat(this._push(target, flight.start, 240, 720, now));
    }
    if (template === 386401) {
      packets.push(...this._buff(386402, now, target.id),
        ...this._push(target, flight.start, 120, 480, now));
      if (current) {
        if (lost) packets.push(...this._buff(386403, now));
        const pos = target.positionAt(now);
        packets.push(...this.shoot(386411, pos, this.positionAt(now), now, 0, {
          school: 'physical', target: this, power: flight.attacker_ap,
          through_walls: true, context: { caught: false },
        }));
      }
    }
    return packets;
  }

  _flight(flight, now) {
    if (flight.template === 386411) {
      if (!this.alive || this.generation !== flight.source_generation) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      const start = flight.pos, dest = this.positionAt(now);
      const end = pointAt(start, dest,
        Math.min(1, flight.speed * (now - flight.previous) / 1000
          / Math.max(1, Math.hypot(start[0] - dest[0], start[1] - dest[1]))));
      const packets = [];
      if (dest[0] !== flight.end[0] || dest[1] !== flight.end[1]) {
        packets.push([1562, encodeS1562(flight.id, start, dest)]);
      }
      flight.pos = end;
      flight.end = dest;
      const caught = circleContact(start, end,
        this.positionAt(flight.previous), dest, 48) !== null;
      if (caught || now >= flight.finish) {
        packets.push(scene({ expiredBullets: [flight.id] }));
        if (caught && !flight.context.caught) {
          flight.context.caught = true;
          this.cooldowns[10] = now + pyRound(Math.max(0, this.cooldowns[10] - now) * 0.75);
          packets.push(...this.addShield(386413, flight.power.mul(D('1.5')), now),
            ...this._resource(50), ...this._buff(386111, now), this._cooldown(10));
        }
        return packets;
      }
      flight.previous = now;
      this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
      return packets;
    }
    if (flight.template === 386110) {
      // Native bounce follows a selected target; still allow interception.
      const target = this.arena.actors.get(flight.target);
      if (!target || !target.alive || target.generation !== flight.target_generation) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      const start = flight.pos, dest = target.positionAt(now);
      const end = pointAt(start, dest,
        Math.min(1, flight.speed * (now - flight.previous) / 1000
          / Math.max(1, Math.hypot(start[0] - dest[0], start[1] - dest[1]))));
      const packets = [];
      if (dest[0] !== flight.end[0] || dest[1] !== flight.end[1]) {
        packets.push([1562, encodeS1562(flight.id, start, dest)]);
      }
      flight.pos = end;
      flight.end = dest;
      const wall = this.arena.geometry.wallContact(start, end);
      const contacts = [];
      for (const other of enemies(this)) {
        if (flight.context.visited.has(`${other.id},${other.generation}`)) continue;
        const hit = actorContact(start, end, other, flight.previous, now);
        if (hit !== null && (wall === null || hit < wall)) {
          contacts.push([hit, other.id, other]);
        }
      }
      contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (contacts.length) {
        const other = contacts[0][2];
        const blocked = this.projectileBlocked(other, now);
        if (!blocked) packets.push(...this._hit(flight, other, now));
        return packets.concat([scene(blocked
          ? { expiredBullets: [flight.id] } : { blownBullets: [flight.id] })]);
      }
      if (wall !== null || now >= flight.finish) {
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
      flight.previous = now;
      this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
      return packets;
    }
    return piercingStep(this, flight, now, (f, t, n) => this._hit(f, t, n), {
      pierce: flight.template === 386301,
      contactRadius: flight.template === 386301 ? 132 : 36,
    });
  }

  _event(now, kind, data) {
    if (kind === 'tsubasa_reflect') {
      const [request] = data;
      const packets = [];
      if (this.buffVersions.get(386111) === request.version) {
        packets.push(...this.removeBuff(386111, now));
      }
      if (request.reflected || !this.alive || this.generation !== request.generation) {
        return packets;
      }
      this.reflections.push(request);
      if (human(this)) return packets.concat([privatePacket(this, [1590, new Uint8Array(0)])]);
      const dest = this.arena.botBrains.get(this.id)?.aim ?? this.positionAt(now);
      return packets.concat(this._reflect_reply(dest, now));
    }
    if (kind === 'tsubasa_space') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.generation !== cast.generation) return [];
      this.ready = null;
      const packets = this.removeBuff(386311, now).concat(this.removeBuff(386312, now),
        this.syncSpeed(now));
      return packets.concat(this.shoot(386301, this.positionAt(now), cast.dest, now,
        cast.power.mul(D('2.94')), { school: 'physical', through_walls: true }));
    }
    if (kind === 'tsubasa_dash') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive || this.generation !== cast.generation) return [];
      const start = this.positionAt(cast.previous), end = this.positionAt(now);
      const packets = [];
      if (!cast.bounced) {
        const contacts = [];
        for (const target of this.arena.actors.values()) {
          if (target.id === this.id || !target.alive || target.info.npc_template
            || target.isUntargetable()) continue;
          const hit = actorContact(start, end, target, cast.previous, now);
          if (hit !== null) contacts.push([hit, target.id, target]);
        }
        contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        if (contacts.length) {
          const target = contacts[0][2];
          cast.bounced = true;
          if (target.camp !== this.camp) packets.push(...this._buff(386211, now, target.id));
          packets.push(...this.removeBuff(386202, now), ...this._buff(386231, now));
          // A redirected bounce can begin before the body has cleared a wall.
          const bounce = this.stopPosition(now, end);
          if (bounce[0] !== end[0] || bounce[1] !== end[1]) {
            packets.push(stop_move(this.sceneId, this.id, bounce));
          }
          const duration = this._setMotion(bounce,
            aimed(bounce, cast.dest, 300, { fixed: true }), 720, now, 3);
          cast.finish = now + duration;
          packets.push(scene({ moves: [this._moveEvent(this.motion[1], 720, 3)] }));
        }
      }
      if (now >= cast.finish) {
        const [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
        this.position = stopped.length ? body : end;
        this.motion = null;
        this.dash = null;
        this.forcedUntil = now;
        return packets.concat(stopped, this.removeBuff(386202, now),
          this.removeBuff(386221, now), this.removeBuff(386231, now), this.syncSpeed(now));
      }
      cast.previous = now;
      this._queue(Math.min(now + 20, cast.finish), kind, cast);
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || now < this.cooldowns[slot]
      || (start[0] === dest[0] && start[1] === dest[1])) return [];
    const cost = { 0: 0, 1: 50, 2: 50, 10: 25 }[slot];
    if (this.mp < cost || (slot === 1 && !this.e_count)) return [];
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 3000, 2: 30000, 10: 8000 }[slot], slot);
    const power = this.combatStat('iAttack', now);
    const packets = this._resource(-cost).concat([this._cooldown(slot)]);
    if (slot === 0) {
      return packets.concat(this.shoot(386100, start, dest, now, power.mul(D('1.5')), {
        school: 'physical', basic: true, speed_multiplier: 1.5,
        context: { count: 0, visited: new Set(), generation: this.generation },
      }));
    }
    if (slot === 10) {
      return packets.concat(this.shoot(386401, start, dest, now, power.mul(D('1.58')), {
        school: 'physical', through_walls: true,
      }));
    }
    const cast = {
      slot, skill: SLOTS[slot], begin: now, generation: this.generation, dest, power,
    };
    let stopped = [];
    if (slot === 2) {
      let body;
      [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      this.position = stopped.length ? body : start;
      this.motion = null;
      this.ready = cast;
      packets.push(...this._buff(386311, now, null, { duration: 500 }),
        ...this._buff(386312, now, null, { duration: 500 }),
        scene({ skills: [this._skillEvent(386301, start, dest, 0, { ready: 1 })] }));
      this._queue(now + 500, 'tsubasa_space', cast);
    } else {
      this.e_count -= 1;
      if (!this.e_next_charge) this.e_next_charge = now + this.skillCooldown(6000);
      const intended = aimed(start, dest, 300, { fixed: true });
      let body, correction;
      [body, correction] = prepareDisplacement(this, now, { interrupt: false });
      if (!correction.length) body = start;
      const duration = this._setMotion(body, intended, 720, now, 3);
      cast.finish = now + duration;
      cast.previous = now;
      cast.bounced = false;
      this.dash = cast;
      this.forcedUntil = cast.finish;
      packets.push(...this._buff(386111, now), ...this._buff(386232, now),
        ...this._buff(386202, now),
        ...this._buff(386221, now, null, { duration: duration + 500 }));
      packets.push(...correction);
      packets.push(scene({
        moves: [this._moveEvent(this.motion[1], 720, 3)],
        skills: [this._skillEvent(386201, start, dest)],
      }));
      packets.push(this._cooldown(1));
      this._queue(now + Math.min(20, duration), 'tsubasa_dash', cast);
    }
    return packets.concat(this.syncSpeed(now), stopped);
  }
}

export { SLOTS as TSUBASA_SLOTS };
