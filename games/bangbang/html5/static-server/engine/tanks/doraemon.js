/* Doraemon (tank 10000080): non-stacking traps, paired reactions and one-use
 * portals. Port of server/doraemon_actions.py.
 *
 * Stubs: presentation/skin only. Target visibility uses the batch-C check.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, circleContact, pointAt } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, packII, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 354100, 1: 354201, 2: 354301, 10: 354401 };

export class DoraemonActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = null;
    this.portals = new Map();
    this.marks = new Map();
    this.reactions = new Set();
    this.passive_ready_at = 0;
  }

  _cooldown(slot, changed = false) {
    const info = {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.ready = null;
    return this._buff(354101, now);
  }

  isUntargetable() {
    const now = this.arena.eventNow || this.clock();
    return this.hasBuff(354121, now) || super.isUntargetable();
  }

  is_untargetable() { return this.isUntargetable(); }

  isAreaTargetable() { return !super.isUntargetable(); }

  is_area_targetable() { return this.isAreaTargetable(); }

  on_damage(source, hit, now, school, reflected, attacker_ap) {
    if (!this.alive || hit.hp_loss.le(0)) return [];
    const packets = this._buff(354111, now);
    if (this.hp.lt(this.maxHp.mul(D('.3'))) && now >= this.passive_ready_at) {
      this.passive_ready_at = now + 30000;
      for (let template = 354121; template < 354127; template += 1) {
        packets.push(...this._buff(template, now));
      }
    }
    return packets;
  }

  _end_flight(now) {
    const packets = [];
    if (this.hasBuff(354121, now)) {
      for (const template of [354121, 354122, 354124, 354125, 354126]) {
        packets.push(...this.removeBuff(template, now));
      }
      packets.push(...this._buff(354131, now));
    }
    return packets;
  }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      packets.push([1583, packII(this.id, 354301)]);
      this.ready = null;
    }
    if (!this.alive) {
      for (const ident of [...this.portals.keys()]) packets.push(...this.removeObject(ident));
      this.portals.clear();
    }
    return packets.concat(this.syncSpeed(now));
  }

  on_control(source, template, now) {
    if (!this.ready) return [];
    const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
    const mask = Number(row.get('fEffectValB', 0));
    return ['35', '66'].includes(row.get('nEffectType')) && (!mask || (mask & 4))
      ? this.interrupt(now) : [];
  }

  update(now) {
    for (const [key, value] of [...this.marks]) if (!(value.end > now)) this.marks.delete(key);
    const active = new Set([...this.marks.values()].map(value => value.cast));
    this.reactions = new Set([...this.reactions].filter(key => {
      const parts = key.split(',');
      return active.has(Number(parts[0])) || active.has(Number(parts[1]));
    }));
    return (this.ready && this.skillSealed(2, now) ? this.interrupt(now) : [])
      .concat(super.update(now));
  }

  _mark(target, cast, kind, now) {
    const template = kind === 'e' ? 354208 : 354303;
    const packets = this._buff(template, now, target.id);
    if (!target.alive || !target.hasBuff(template, now)) return packets;
    const key = `${target.id},${target.generation},${kind}`;
    this.marks.set(key, {
      cast: cast.token, end: now + 3000, version: target.buffVersions.get(template),
    });
    const otherKind = kind === 'e' ? 'space' : 'e';
    const other = this.marks.get(`${target.id},${target.generation},${otherKind}`);
    const otherTemplate = kind === 'e' ? 354303 : 354208;
    if (other && other.end > now && target.hasBuff(otherTemplate, now)
      && target.buffVersions.get(otherTemplate) === other.version) {
      const pair = kind === 'e' ? [cast.token, other.cast] : [other.cast, cast.token];
      const identity = `${pair[0]},${pair[1]},${target.id},${target.generation}`;
      if (!this.reactions.has(identity)) {
        this.reactions.add(identity);
        packets.push(...this.damage(target.maxHp.mul(D('.1')), now, { target, school: 'true' })[0]);
        packets.push(...this._buff(354304, now, target.id));
      }
    }
    return packets;
  }

  _trap_tick(cast, now, index) {
    const packets = [];
    for (const target of [...this.arena.actors.values()]) {
      const tpos = target.positionAt(now);
      if (!target.alive || !target.isAreaTargetable()
        || Math.hypot(tpos[0] - cast.pos[0], tpos[1] - cast.pos[1]) > 84) continue;
      if (target.camp === this.camp) {
        if (target === this && cast.generation !== this.generation) continue;
        if (target.hasBuff(354209, now) || target.effectBlocked()) continue;
        packets.push(...target.cleanse(now), ...target.restoreHp(cast.power.mul(D('2.09')), now));
        if (typeof target._resource === 'function') packets.push(...target._resource(30));
        packets.push(...this._buff(354209, now, target.id, { duration: 3500 }),
          ...this._buff(354210, now, target.id, { duration: 3500 }));
      } else {
        packets.push(...this._buff(354203, now, target.id), ...this._buff(354204, now, target.id));
        if (index > 0 && index % 2 === 0 && (target.dora_next_tick ?? 0) <= now) {
          target.dora_next_tick = now + 500;
          const [hit, lost] = this.damage(cast.power.mul(D('.5')), now, {
            target, school: 'energy', periodic: true,
          });
          packets.push(...hit);
          if (lost) packets.push(...this._mark(target, cast, 'e', now));
        }
      }
    }
    if (index === 12) {
      for (const ident of cast.objects) packets.push(...this.removeObject(ident));
    } else {
      this._queue(now + 250, 'dora_trap_tick', cast, index + 1);
    }
    return packets;
  }

  _portal_enter(portal, target, now) {
    const packets = this.removeObject(portal.id, { destroyed: true });
    this.portals.delete(portal.id);
    const [, stopped] = prepareDisplacement(target, now, { interrupt: false });
    packets.push(...target.interrupt(now));
    target.position = target.positionAt(now);
    target.motion = null;
    const travel = {
      owner: this.id, generation: this.generation, target: target.id,
      target_generation: target.generation, pos: target.position,
      power: portal.power, end: now + 1000,
    };
    packets.push(...this._buff(354404, now, target.id));
    target.dora_travel = travel;
    this._queue(now + 1000, 'dora_exit', travel);
    return packets.concat(stopped,
      [scene({ moves: [target._moveEvent(target.position, 0, 5)] })], target.syncSpeed(now));
  }

  _flight(flight, now) {
    if (flight.template === 354100) return super._flight(flight, now);
    if (flight.template === 354301) {
      const a = pointAt(flight.start, flight.end,
        (flight.previous - flight.begin) / (flight.finish - flight.begin));
      const b = pointAt(flight.start, flight.end,
        Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
      for (const target of this.arena.actors.values()) {
        if (target.alive && target.camp !== this.camp && !target.isUntargetable()
          && actorContact(a, b, target, flight.previous, now) !== null
          && this.projectileBlocked(target, now)) {
          return this.removeObject(flight.context.warning)
            .concat([scene({ expiredBullets: [flight.id] })]);
        }
      }
    }
    if (now < flight.finish) {
      flight.previous = now;
      this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
      return [];
    }
    const packets = [scene({ blownBullets: [flight.id] })];
    if (flight.template === 354401) {
      if (!this.alive || this.generation !== flight.source_generation) return packets;
      const [ident, packet] = this.addObject(354401, flight.end);
      packets.push(packet);
      const portal = {
        id: ident, pos: flight.end, power: flight.power, end: now + 4000,
        previous: now, generation: this.generation,
      };
      this.portals.set(ident, portal);
      this._queue(now + 50, 'dora_portal', portal);
      return packets;
    }
    const cast = flight.context;
    packets.push(...this.removeObject(cast.warning));
    for (const target of enemies(this, { area: true })) {
      const tpos = target.positionAt(now);
      if (Math.hypot(flight.end[0] - tpos[0], flight.end[1] - tpos[1]) > 168) continue;
      packets.push(...this.damage(cast.power.mul(D('3.35')), now, { target, school: 'energy' })[0]);
      if (this.arena.pk && this.arena.pk.finished) return packets;
      if (target.alive && !target.ccImmune(now)) {
        const [origin, stopped] = prepareDisplacement(target, now, { interrupt: false });
        packets.push(...stopped);
        const dest = target.moveDestination(origin, flight.end);
        target.position = dest;
        target.motion = null;
        packets.push(scene({ moves: [target._moveEvent(dest, 0, 5)] }));
      }
      packets.push(...this._mark(target, cast, 'space', now));
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'dora_trap_open') {
      const [cast] = data;
      const packets = this.removeObject(cast.warning);
      const [ident, packet] = this.addObject(354203, cast.pos);
      packets.push(packet);
      cast.objects.push(ident);
      return packets.concat(this._trap_tick(cast, now, 0));
    }
    if (kind === 'dora_trap_tick') return this._trap_tick(data[0], now, data[1]);
    if (kind === 'dora_space') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.generation !== cast.generation) return [];
      this.ready = null;
      return this.syncSpeed(now).concat(this.shoot(354301, this.positionAt(now), cast.dest,
        now, D(0), {
          school: 'energy', power: cast.power, fixed_destination: true,
          through_walls: true, context: cast,
        }));
    }
    if (kind === 'dora_portal') {
      const [portal] = data;
      if (this.portals.get(portal.id) !== portal) return [];
      const targets = [];
      for (const target of this.arena.actors.values()) {
        if (!target.alive || target.camp !== this.camp || target.info.npc_template
          || target.isUntargetable()) continue;
        const hit = circleContact(target.positionAt(portal.previous),
          target.positionAt(now), portal.pos, portal.pos, 72);
        if (hit !== null) targets.push([hit, target.id, target]);
      }
      if (targets.length) {
        targets.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        return this._portal_enter(portal, targets[0][2], now);
      }
      if (now >= portal.end) {
        this.portals.delete(portal.id);
        return this.removeObject(portal.id);
      }
      portal.previous = now;
      this._queue(Math.min(now + 50, portal.end), kind, portal);
      return [];
    }
    if (kind === 'dora_exit') {
      const [travel] = data;
      const target = this.arena.actors.get(travel.target);
      if (!target || !target.alive || target.generation !== travel.target_generation
        || target.dora_travel !== travel) return [];
      target.dora_travel = null;
      let dest = this.alive && this.generation === travel.generation
        ? this.positionAt(now) : travel.pos;
      dest = target.blinkDestination(target.positionAt(now), dest);
      target.position = dest;
      target.motion = null;
      target.portal_safe_until = now + 500;
      return target.removeBuff(354404, now).concat(
        [scene({ moves: [target._moveEvent(dest, 0, 5)] })],
        target.restoreHp(travel.power.mul(D('2.13')), now), target.syncSpeed(now));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (slot === 0 && start[0] === dest[0] && start[1] === dest[1]) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 8000, 2: 25000, 10: 8000 }[slot], slot);
    const packets = slot === 0 ? [] : this._end_flight(now);
    if (slot === 0) {
      return this.shoot(354100, start, dest, now, power, {
        school: 'energy', basic: true,
      }).concat([this._cooldown(slot)]);
    }
    dest = aimed(start, dest, slot === 10 ? 600 : 480);
    if (slot === 10) {
      dest = this.arena.freePosition(dest, now) || start;
      return packets.concat(this.shoot(354401, start, dest, now, D(0), {
        school: 'energy', power, fixed_destination: true, through_walls: true,
      }), [this._cooldown(slot)]);
    }
    const cast = {
      slot, skill: SLOTS[slot], pos: dest, dest, power,
      generation: this.generation, token: this._newId(2), objects: [],
    };
    let stopped = [];
    if (slot === 1) {
      const [ident, packet] = this.addObject(354201, dest);
      packets.push(packet);
      cast.objects.push(ident);
      const [warning, warningPacket] = this.addObject(354202, dest);
      packets.push(warningPacket);
      cast.warning = warning;
      this._queue(now + 500, 'dora_trap_open', cast);
    } else {
      const [body, stoppedPackets] = prepareDisplacement(this, now, { interrupt: false });
      stopped = stoppedPackets;
      this.ready = cast;
      this.position = stopped.length ? body : start;
      this.motion = null;
      const [warning, packet] = this.addObject(354305, dest);
      packets.push(packet);
      cast.warning = warning;
      this._queue(now + 700, 'object_expire', warning);
      packets.push(scene({ skills: [this._skillEvent(354301, start, dest, 0, { ready: 1 })] }));
      this._queue(now + 50, 'dora_space', cast);
    }
    return packets.concat([this._cooldown(slot)], this.syncSpeed(now), stopped);
  }
}

export { SLOTS as DORAEMON_SLOTS };
