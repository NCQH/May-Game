/* Baymax (tank 10000073): tether heal, intercept flight, guardian form.
 * Port of server/baymax_actions.py onto the JS battle core.
 *
 * Stubs: skin/presentation only. `_emergency` keeps the core's 10000073 hook;
 * shadow spells are absent because this map has no shadow NPC records.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt } from '../math.js';
import { scene, stop_move, encodeS1572, encodeS1579 } from '../protocol.js';
import { packII } from './melee.js';

const SLOTS = { 0: 347100, 1: 347201, 2: 347301, 10: 347401 };

export class BaymaxActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = Number(this.stats.iMp);
    this.e_count = 3;
    this.e_next_charge = 0;
    this.passive_ready_at = 0;
    this.ready = this.dash = this.link = this.form = null;
  }

  _resource(delta) {
    if (this.noel_box) return [];
    const old = this.mp;
    this.mp = Math.max(0, Math.min(Number(this.stats.iMp), this.mp + delta));
    return old !== this.mp ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  _cooldown(slot, changed = false) {
    const info = {
      skillId: slot === 10 && this.link ? 347421 : SLOTS[slot], slot,
      count: slot === 1 ? this.e_count : -1,
      end: this.cooldowns[slot], nextCharge: slot === 1 ? this.e_next_charge : 0,
    };
    return changed ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _link_slot() {
    return (this.id === 1 ? [this._cooldown(10, true)] : []).concat([this._cooldown(10)]);
  }

  on_spawn(now) {
    this.mp = Number(this.stats.iMp);
    this.ready = this.dash = this.link = this.form = null;
    this._queue(now + 1000, 'bay_mp', this.generation);
    const packets = this._buff(347101, now).concat([scene({ mp: [{ objectId: this.id, mp: this.mp }] })]);
    if (this.passive_ready_at > now) {
      packets.push(...this._buff(347103, now, null, { duration: this.passive_ready_at - now }));
    }
    return packets.concat(this._link_slot());
  }

  _emergency(now) {
    if (!this.alive || this.passive_ready_at > now) return [];
    const allies = [...this.arena.actors.values()].filter(a => a.alive && a.camp === this.camp
      && !a.info.map_object && a.hp.le(a.maxHp.mul(D('.3')))
      && Math.hypot(this.positionAt(now)[0] - a.positionAt(now)[0],
        this.positionAt(now)[1] - a.positionAt(now)[1]) <= 360);
    if (!allies.length) return [];
    allies.sort((a, b) => (a.hp.div(a.maxHp).toNumber() - b.hp.div(b.maxHp).toNumber())
      || (a.id - b.id));
    const target = allies[0];
    this.passive_ready_at = now + 30000;
    return this._buff(347103, now).concat(this._buff(347102, now, target.id),
      this._buff(347104, now, target.id),
      target.restoreHp(this.combatStat('iAttack', now).mul(D('4.5')), now));
  }

  _valid_link(now) {
    const cast = this.link;
    const target = cast ? this.arena.actors.get(cast.target) : null;
    return Boolean(cast && this.alive && this.mp > 0 && target && target.alive
      && target.generation === cast.target_generation && target.hasBuff(347401, now)
      && target.buffVersions.get(347401) === cast.version
      && Math.hypot(this.positionAt(now)[0] - target.positionAt(now)[0],
        this.positionAt(now)[1] - target.positionAt(now)[1]) <= 360);
  }

  _end_link(now) {
    const cast = this.link;
    this.link = null;
    if (!cast) return [];
    const packets = this.removeBuff(347402, now);
    const target = this.arena.actors.get(cast.target);
    if (target && target.buffVersions.get(347401) === cast.version) {
      packets.push(...target.removeBuff(347401, now));
    }
    return packets.concat(this._link_slot());
  }

  _clear_guard(cast, now) {
    const target = this.arena.actors.get(cast.target);
    return target && target.buffVersions.get(347303) === cast.guard_version
      ? target.removeBuff(347303, now) : [];
  }

  interrupt(now) {
    const packets = [];
    const cast = this.ready || this.dash;
    if (cast) {
      const was_dash = this.dash !== null;
      this.ready = this.dash = null;
      if (was_dash) {
        this.position = this.stopPosition(now);
        this.motion = null;
        this.forcedUntil = 0;
        packets.push(scene({ moves: [this._moveEvent(this.position, 0, 5)] }));
      }
      packets.push(...this._clear_guard(cast, now), ...this.removeBuff(347302, now));
      packets.push([1583, packII(this.id, 347301)]);
    }
    if (!this.alive) {
      packets.push(...this._end_link(now));
      this.form = null;
    }
    return packets.concat(this.syncSpeed(now));
  }

  on_target_death(target, now) {
    const packets = this.link && this.link.target === target.id ? this._end_link(now) : [];
    const cast = this.ready || this.dash;
    return cast && cast.target === target.id ? packets.concat(this.interrupt(now)) : packets;
  }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready || this.dash) || super.blocked(action, now); }

  update(now) {
    const packets = [];
    if ((this.ready || this.dash) && (this.skillSealed(2, now) || (this.dash && !this.motion))) {
      packets.push(...this.interrupt(now));
    }
    if (this.link && !this._valid_link(now)) packets.push(...this._end_link(now));
    while (this.e_next_charge && this.e_next_charge <= now) {
      this.e_count = Math.min(3, this.e_count + 1);
      this.e_next_charge = this.e_count < 3 ? this.e_next_charge + this.skillCooldown(6000) : 0;
      packets.push(this._cooldown(1));
    }
    return packets.concat(this._emergency(now), super.update(now));
  }

  _push(target, origin, distance, speed, now) {
    if (!target.alive || target.ccImmune(now)) return [];
    const current = target.positionAt(now);
    const start = target.stopPosition(now);
    const length = Math.hypot(origin[0] - start[0], origin[1] - start[1]);
    const dest = length ? pointAt(origin, start, 1 + distance / length)
      : [start[0] + distance, start[1]];
    const moved = start[0] !== current[0] || start[1] !== current[1];
    if (moved) { target.position = start; target.motion = null; }
    const packets = target.interrupt(now);
    if (moved) packets.push(stop_move(this.sceneId, target.id, start));
    target.forcedUntil = now + target._setMotion(start, dest, speed, now, 1);
    return packets.concat([scene({ moves: [this._moveEvent(target.motion[1], speed, 1, target.id)] })]);
  }

  _arrive(cast, target, now) {
    this.dash = null;
    this.position = this.positionAt(now);
    this.motion = null;
    this.forcedUntil = 0;
    const packets = this._clear_guard(cast, now).concat(this.removeBuff(347302, now));
    packets.push(...this.addShield(347321, cast.max_hp.mul(D('.5')), now));
    packets.push(...target.addShield(347331, cast.max_hp.mul(D('.5')), now, { caster: this }));
    packets.push(...this._buff(347322, now, target.id));
    for (const enemy of [...this.arena.actors.values()]) {
      if (enemy.alive && enemy.camp !== this.camp
        && Math.hypot(this.position[0] - enemy.positionAt(now)[0],
          this.position[1] - enemy.positionAt(now)[1]) <= 216) {
        packets.push(...this._push(enemy, this.position, 240, 480, now));
      }
    }
    this.form = { generation: this.generation, power: cast.power, end: now + 10000 };
    for (const buff of [347324, 347325, 347326, 347327]) packets.push(...this._buff(buff, now));
    this._queue(now + 500, 'bay_form', this.form);
    return packets.concat(this.syncSpeed(now));
  }

  _flight(flight, now) {
    if (flight.template !== 347201) return super._flight(flight, now);
    if (now < flight.finish) {
      this._queue(flight.finish, 'flight', flight);
      return [];
    }
    const pos = flight.end;
    const [ident, packet] = this.addObject(347201, pos);
    this._queue(now + 100, 'object_expire', ident);
    const packets = [scene({ blownBullets: [flight.id] }), packet];
    let hit = false;
    for (const target of [...this.arena.actors.values()]) {
      if (target.alive && target.camp !== this.camp
        && Math.hypot(pos[0] - target.positionAt(now)[0], pos[1] - target.positionAt(now)[1]) <= 120) {
        hit = true;
        packets.push(...this.damage(flight.raw, now, { target })[0]);
        if (this.arena.pk && this.arena.pk.finished) return packets;
        packets.push(...this._push(target, pos, 120, 360, now), ...this._buff(347213, now, target.id));
      }
    }
    if (hit && this.alive && this.generation === flight.source_generation) {
      const previous = this.buffVersions.get(347214);
      packets.push(...this._buff(347214, now));
      const version = this.buffVersions.get(347214);
      if (version !== previous && this.hasBuff(347214, now) && this.buffSources.get(347214) === this.id) {
        for (let i = 1; i <= 5; i += 1) this._queue(now + 200 * i, 'bay_refund', this.generation, version);
      }
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'bay_mp') {
      if (!this.alive || data[0] !== this.generation) return [];
      this._queue(now + 1000, kind, ...data);
      return this._resource(5);
    }
    if (kind === 'bay_refund') {
      return this.alive && this.generation === data[0] && this.buffVersions.get(347214) === data[1]
        ? this._resource(5) : [];
    }
    if (kind === 'bay_link') {
      const [cast] = data;
      if (this.link !== cast) return [];
      if (!this._valid_link(now) || this.mp < 10) return this._end_link(now);
      const target = this.arena.actors.get(cast.target);
      const packets = this._resource(-10);
      packets.push(...this.restoreHp(cast.power, now), ...target.restoreHp(cast.power, now));
      if (this.mp === 0) return packets.concat(this._end_link(now));
      this._queue(now + 1000, kind, cast);
      return packets;
    }
    if (kind === 'bay_ready') {
      const [cast] = data;
      if (this.ready !== cast) return [];
      const target = this.arena.actors.get(cast.target);
      if (!this.alive || !target || !target.alive || target.generation !== cast.target_generation
        || this.skillSealed(2, now) || super.blocked('attack', now)) return this.interrupt(now);
      this.ready = null;
      this.dash = cast;
      const start = this.positionAt(now), dest = target.positionAt(now);
      this.forcedUntil = now + this._setMotion(start, dest, 720, now, 3);
      cast.previous = now;
      this._queue(Math.min(now + 20, this.forcedUntil), 'bay_dash', cast);
      return this._buff(347302, now).concat([
        scene({
          skills: [this._skillEvent(347301, start, dest, target.id)],
          moves: [this._moveEvent(this.motion[1], 720, 3)],
        }),
      ], this.syncSpeed(now));
    }
    if (kind === 'bay_dash') {
      const [cast] = data;
      if (this.dash !== cast) return [];
      if (!this.motion) return this.interrupt(now);
      const target = this.arena.actors.get(cast.target);
      if (!this.alive || !target || !target.alive || target.generation !== cast.target_generation
        || this.skillSealed(2, now) || super.blocked('attack', now)) return this.interrupt(now);
      const start = this.positionAt(cast.previous), end = this.positionAt(now);
      const packets = [];
      for (const enemy of [...this.arena.actors.values()]) {
        const key = `${enemy.id},${enemy.generation}`;
        if (enemy.alive && enemy.camp !== this.camp && !cast.hits.has(key)
          && actorContact(start, end, enemy, cast.previous, now) !== null) {
          cast.hits.add(key);
          packets.push(...this.damage(cast.power.mul(D('2.66')), now, { target: enemy })[0]);
          packets.push(...this._buff(347312, now, enemy.id));
          if (this.dash !== cast || !this.alive) return packets;
          if (!this.motion) return packets.concat(this.interrupt(now));
        }
      }
      const dest = target.positionAt(now);
      if (Math.hypot(end[0] - dest[0], end[1] - dest[1]) <= 1) {
        return packets.concat(this._arrive(cast, target, now));
      }
      if (this.motion[1][0] !== dest[0] || this.motion[1][1] !== dest[1]) {
        this.forcedUntil = now + this._setMotion(end, dest, 720, now, 3);
        packets.push(scene({ moves: [this._moveEvent(this.motion[1], 720, 3)] }));
      }
      cast.previous = now;
      this._queue(Math.min(now + 20, Math.max(now + 1, this.forcedUntil)), 'bay_dash', cast);
      return packets;
    }
    if (kind === 'bay_form') {
      const [cast] = data;
      if (this.form !== cast || !this.alive || this.generation !== cast.generation) return [];
      const pos = this.positionAt(now);
      const packets = [scene({ skills: [this._skillEvent(347321, pos, pos, this.id)] })];
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(pos[0] - target.positionAt(now)[0], pos[1] - target.positionAt(now)[1]) <= 144) {
          packets.push(...this.damage(cast.power.mul(D('.5')), now, { target })[0]);
          if (this.arena.pk && this.arena.pk.finished) break;
          packets.push(...this._push(target, pos, 72, 480, now));
        }
      }
      if (now < cast.end) this._queue(now + 500, kind, cast);
      else this.form = null;
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (slot === 10 && this.link && this.alive && this.cooldowns[10] <= now) return this._end_link(now);
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    const target = this.arena.actors.get(target_id);
    if (slot === 2 || slot === 10) {
      if (!target || !target.alive || target.camp !== this.camp || target === this
        || (slot === 2 && (target.id >>> 26) !== 0)
        || Math.hypot(start[0] - target.positionAt(now)[0], start[1] - target.positionAt(now)[1])
        > (slot === 2 ? 1200 : 336)) return [];
    } else if (!this._inside(dest) || (slot === 0 && start[0] === dest[0] && start[1] === dest[1])) {
      return [];
    }
    if (slot === 1 && (!this.e_count
      || Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 600)
      || (slot === 10 && this.mp < 20)) return [];
    const power = this.combatStat('iAttack', now);
    this.cooldowns[slot] = now + {
      0: this.fireInterval(now), 1: this.skillCooldown(1250, 1),
      2: this.skillCooldown(25000, 2), 10: 1000,
    }[slot];
    if (slot === 0) {
      return this.shoot(347100, start, dest, now, power, { school: 'physical', basic: true })
        .concat([this._cooldown(0)]);
    }
    if (slot === 1) {
      this.e_count -= 1;
      if (!this.e_next_charge) this.e_next_charge = now + this.skillCooldown(6000);
      const ident = this._newId(2);
      const factor = this.hasBuff(10400233, now) ? 1.15 : 1;
      const span = Math.hypot(dest[0] - start[0], dest[1] - start[1]);
      const flight = {
        kind: 'bullet', id: ident, template: 347201, start, end: dest, begin: now,
        finish: now + Math.round(500 / factor), speed: Math.max(1, Math.round(span * 2 * factor)),
        previous: now, raw: power.mul(D(2)), source_generation: this.generation,
      };
      this._queue(flight.finish, 'flight', flight);
      return [scene({ fires: [{ bulletId: ident, ownerId: this.id, start, dest,
        speed: flight.speed, templateId: 347201 }] }), this._cooldown(1)];
    }
    const cast = {
      slot, target: target.id, target_generation: target.generation, generation: this.generation,
      power, max_hp: this.maxHp, dest: target.positionAt(now), hits: new Set(),
    };
    const packets = [this._cooldown(slot)];
    if (slot === 2) {
      this.position = start;
      this.motion = null;
      this.ready = cast;
      packets.push(...this._buff(347303, now, target.id));
      cast.guard_version = target.buffVersions.get(347303);
      this._queue(now + 500, 'bay_ready', cast);
      packets.push(scene({ skills: [this._skillEvent(347301, start, cast.dest, target.id, { ready: 1 })] }));
      return packets.concat(this.syncSpeed(now));
    }
    packets.push(...this._resource(-20), ...this._buff(347401, now, target.id), ...this._buff(347402, now));
    cast.version = target.buffVersions.get(347401);
    this.link = cast;
    this._queue(now + 1000, 'bay_link', cast);
    return packets.concat(this._link_slot());
  }
}

export { SLOTS as BAYMAX_SLOTS };
