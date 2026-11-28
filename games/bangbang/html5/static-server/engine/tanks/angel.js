/* Angel (tank 10000061): native form slots, shared cooldowns, holy bounce.
 * Port of server/angel_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. The bounce uses the core 36px contact radius.
 */
import { TankActions } from '../arena.js';
import { D, circleContact, pointAt } from '../math.js';
import { scene, encodeS1562, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, inCone, packII, prepareDisplacement } from './melee.js';
import { choose } from './batch-e-common.js';
import { teamVisible } from './batch-c-common.js';

const SLOTS = { 0: 336100, 1: 336201, 2: 336301, 10: 336101 };
const FALLEN = { 0: 336500, 1: 336601, 2: 336701, 10: 336501 };

export class AngelActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.fallen = false;
    this.ready = null;
    this.sanctuary = null;
  }

  _skill(slot) { return (this.fallen ? FALLEN : SLOTS)[slot]; }

  _cooldown(slot, changed = false) {
    const info = {
      skillId: this._skill(slot), slot, count: -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.fallen = false;
    this.ready = this.sanctuary = null;
    return this._buff(336401, now)
      .concat(Object.keys(SLOTS).map(Number).map(slot => this._cooldown(slot, true)));
  }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  blocked(action, now) {
    return Boolean(this.ready || (action === 'attack' && this.sanctuary))
      || super.blocked(action, now);
  }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      this.ready = null;
      packets.push([1583, packII(this.id, 336601)]);
    }
    if (!this.alive) this.sanctuary = null;
    return packets.concat(this.syncSpeed(now));
  }

  update(now) {
    const packets = this.ready && this.skillSealed(1, now) ? this.interrupt(now) : [];
    return packets.concat(super.update(now));
  }

  onControl(source, template, now) {
    if (!this.ready) return [];
    const kind = Number(this.arena.data.tableRow('BuffTemplate_table.xml',
      { nBuffId: template }).get('nEffectType'));
    return [30, 35, 66].includes(kind) ? this.interrupt(now) : [];
  }

  _switch(start, dest, now) {
    let origin, stopped;
    [origin, stopped] = prepareDisplacement(this, now, { interrupt: false });
    if (!stopped.length) origin = start;
    const old = this.fallen;
    this.fallen = !old;
    const packets = [];
    const removed = old ? Array.from({ length: 6 }, (_, i) => 336101 + i)
      : [336401, 336501, 336503];
    for (const template of removed) packets.push(...this.removeBuff(template, now));
    const added = old ? [336501, 336502, 336503, 336507]
      : Array.from({ length: 8 }, (_, i) => 336101 + i);
    for (const template of added) packets.push(...this._buff(template, now));
    packets.push(...this._buff(336109, now));
    packets.push(...stopped);
    const end = aimed(start, dest, 360, { fixed: true });
    const duration = this._setMotion(origin, end, 720, now, 4);
    this.forcedUntil = now + duration;
    this.cooldowns[1] = 0;
    packets.push(scene({ moves: [this._moveEvent(this.motion[1], 720, 4)] }));
    for (const slot of Object.keys(SLOTS).map(Number)) packets.push(this._cooldown(slot, true));
    return packets;
  }

  _nextBounce(cast, pos, now) {
    if (cast.index >= 4) return [];
    const choices = [...this.arena.actors.values()].filter(actor => actor.alive
      && !actor.isUntargetable()
      && (actor.camp === this.camp || teamVisible(this, actor, now))
      && !cast.visited.has(actor.id)
      && Math.hypot(pos[0] - actor.positionAt(now)[0], pos[1] - actor.positionAt(now)[1]) <= 336);
    if (!choices.length) return [];
    const target = choose(this.arena.rng, choices);
    cast.visited.add(target.id);
    let factor = D(1);
    for (let i = 0; i < cast.index; i += 1) factor = factor.mul(D('.8'));
    const raw = cast.power.mul(D('1.78')).mul(factor);
    cast.index += 1;
    return this.shoot(336211, pos, target.positionAt(now), now, raw, {
      school: 'energy', target, through_walls: true, context: cast,
    });
  }

  _flight(flight, now) {
    if (flight.template !== 336211) return super._flight(flight, now);
    const target = this.arena.actors.get(flight.target);
    if (!target || !target.alive || target.generation !== flight.target_generation
      || target.isUntargetable()) {
      return [scene({ expiredBullets: [flight.id] })];
    }
    const start = flight.pos, dest = target.positionAt(now);
    const end = pointAt(start, dest, Math.min(1, flight.speed * (now - flight.previous)
      / 1000 / Math.max(1, Math.hypot(start[0] - dest[0], start[1] - dest[1]))));
    const packets = [];
    if (dest[0] !== flight.end[0] || dest[1] !== flight.end[1]) {
      packets.push([1562, encodeS1562(flight.id, start, dest)]);
      flight.end = dest;
    }
    const hit = circleContact(start, end, target.positionAt(flight.previous), dest);
    if (hit !== null) {
      if (target.camp !== this.camp && this.projectileBlocked(target, now)) {
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
      packets.push(scene({ blownBullets: [flight.id] }));
      packets.push(...(target.camp === this.camp
        ? target.restoreHp(flight.raw, now)
        : this.damage(flight.raw, now, { target, school: 'energy' })[0]));
      return packets.concat(this._nextBounce(flight.context, dest, now));
    }
    if (now >= flight.finish) return packets.concat([scene({ expiredBullets: [flight.id] })]);
    flight.pos = end;
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'angel_pull') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      const start = this.positionAt(now);
      const packets = [scene({
        skills: [this._skillEvent(336601, start, cast.dest)],
      })].concat(this.syncSpeed(now));
      for (const target of enemies(this, { area: true })) {
        if (!inCone(target.positionAt(now), start, cast.dest, 408, 20)) continue;
        packets.push(...this.damage(cast.power.mul(D('1.95')), now, { target })[0]);
        if (this.arena.pk && this.arena.pk.finished) break;
        if (!target.alive || target.ccImmune(now)) continue;
        const pos = target.positionAt(now);
        const span = Math.hypot(start[0] - pos[0], start[1] - pos[1]);
        if (span <= 72) continue;
        const desired = pointAt(start, pos, 72 / span);
        const [body, stopped] = prepareDisplacement(target, now);
        packets.push(...stopped);
        const dest = target.moveDestination(body, desired);
        target.position = dest;
        target.motion = null;
        target.forcedUntil = now;
        packets.push(scene({ moves: [this._moveEvent(dest, 0, 5, target.id)] }));
      }
      return packets;
    }
    if (kind === 'angel_sanctuary') {
      const [cast] = data;
      if (this.sanctuary !== cast || !this.alive) return [];
      this.sanctuary = null;
      const pos = this.positionAt(now);
      const packets = [];
      for (const target of this.arena.actors.values()) {
        if (!target.alive || Math.hypot(pos[0] - target.positionAt(now)[0],
          pos[1] - target.positionAt(now)[1]) > 240) continue;
        if (target.camp === this.camp) {
          packets.push(...this._buff(336311, now, target.id));
          packets.push(...target.restoreHp(cast.power.mul(D('2.96')), now));
          packets.push(...target.cleanse(now));
        } else if (!target.isUntargetable() && !target.ccImmune(now)) {
          const [start, stopped] = prepareDisplacement(target, now);
          packets.push(...stopped);
          const span = Math.hypot(pos[0] - start[0], pos[1] - start[1]);
          const dest = aimed(pos, start, span + 240, { fixed: true });
          const duration = target._setMotion(start, dest, 480, now, 1);
          target.forcedUntil = now + duration;
          packets.push(scene({
            moves: [this._moveEvent(target.motion[1], 480, 1, target.id)],
          }));
        }
      }
      return packets.concat(this._buff(336314, now));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (([0, 10].includes(slot) || (slot === 1 && this.fallen))
      && start[0] === dest[0] && start[1] === dest[1]) return [];
    const skill = this._skill(slot), fallen = this.fallen;
    const power = this.combatStat(fallen ? 'iAttack' : 'iEgAtk', now)
      .mul(fallen ? D('1.25') : D(1));
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 6000, 2: 25000, 10: 8000 }[slot], slot);
    const packets = [];
    if (slot === 0) {
      packets.push(...this.shoot(skill, start, dest, now, power, {
        school: fallen ? 'physical' : 'energy', basic: true,
      }));
    } else if (slot === 10) {
      packets.push(scene({ skills: [this._skillEvent(skill, start, dest)] }));
      packets.push(...this._switch(start, dest, now));
    } else if (slot === 1 && !fallen) {
      packets.push(...this.restoreHp(power.mul(D('2.23')), now));
      const ident = this._newId(2);
      packets.push(scene({ fires: [{
        bulletId: ident, ownerId: this.id, start, dest: start, speed: 408, templateId: 336201,
      }] }), scene({ blownBullets: [ident] }));
      packets.push(...this._nextBounce({
        power, generation: this.generation, index: 0, visited: new Set([this.id]),
      }, start, now));
    } else if (slot === 1) {
      this.position = start;
      this.motion = null;
      this.ready = { slot: 1, skill, dest, power, end: now + 500 };
      this._queue(now + 500, 'angel_pull', this.ready);
      packets.push(scene({ skills: [this._skillEvent(skill, start, dest, 0, { ready: 1 })] }));
    } else if (!fallen) {
      this.sanctuary = { power, end: now + 1000 };
      this._queue(now + 1000, 'angel_sanctuary', this.sanctuary);
      packets.push(...this._buff(336301, now), ...this._buff(336302, now));
      packets.push(scene({ skills: [this._skillEvent(skill, start, dest)] }));
    } else {
      packets.push(scene({ skills: [this._skillEvent(skill, start, dest)] }));
      for (const target of enemies(this, { area: true })) {
        if (Math.hypot(start[0] - target.positionAt(now)[0],
          start[1] - target.positionAt(now)[1]) <= 216) {
          packets.push(...this.damage(power.mul(D('4.55')), now, { target })[0]);
          packets.push(...this._buff(336702, now, target.id));
        }
      }
    }
    return packets.concat([this._cooldown(slot)], this.syncSpeed(now));
  }
}

export { SLOTS as ANGEL_SLOTS, FALLEN as ANGEL_FALLEN_SLOTS };
