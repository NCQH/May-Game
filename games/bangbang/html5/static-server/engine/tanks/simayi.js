/* Sima Yi (tank 10000098): finite orb objects, bounded push contacts and
 * per-target volleys. Port of server/simayi_actions.py.
 *
 * Stubs: presentation/skin only. Orbs are real actors; their tombstones use the
 * shared retireSummon helper because the JS core has no owner_executor.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1556, encodeS1562, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, inCone, piercingStep, prepareDisplacement } from './melee.js';
import { retireSummon, teamVisible } from './batch-c-common.js';

const SLOTS = { 0: 373100, 1: 373201, 2: 373301, 10: 373401 };

export class SimayiActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.e_count = 3;
    this.e_next_charge = 0;
    this.r_count = 2;
    this.r_next_charge = 0;
    this.orb_count = 0;
  }

  _cooldown(slot, changed = false) {
    const skill = slot === 2 && this.orb_count ? 373310 + this.orb_count * 10 : SLOTS[slot];
    const info = {
      skillId: skill, slot,
      count: slot === 1 ? this.e_count : slot === 10 ? this.r_count : -1,
      end: this.cooldowns[slot] ?? 0,
      nextCharge: slot === 1 ? this.e_next_charge : slot === 10 ? this.r_next_charge : 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _orbs(count, now) {
    this.orb_count = Math.min(3, count);
    const packets = [];
    for (const template of [373102, 373103, 373104]) packets.push(...this.removeBuff(template, now));
    if (this.orb_count) packets.push(...this._buff(373101 + this.orb_count, now));
    return packets.concat([this._cooldown(2, true)]);
  }

  on_spawn(now) {
    this.orb_count = 0;
    this._queue(now + 5000, 'sima_passive', this.generation);
    return this._buff(373101, now).concat(this._buff(373111, now), [this._cooldown(2, true)]);
  }

  update(now) {
    const packets = [];
    for (const [field, maximum, period, slot] of
      [['e', 3, 6000, 1], ['r', 2, 8000, 10]]) {
      let end = this[`${field}_next_charge`];
      while (end && end <= now) {
        const count = Math.min(maximum, this[`${field}_count`] + 1);
        this[`${field}_count`] = count;
        end = count < maximum ? end + this.skillCooldown(period) : 0;
        this[`${field}_next_charge`] = end;
        packets.push(this._cooldown(slot));
      }
    }
    return packets.concat(super.update(now));
  }

  _hit(raw, target, now, generation) {
    const wasAlive = target.alive;
    const packets = this.damage(raw, now, { target, school: 'energy' })[0];
    if (wasAlive && !target.alive && !target.info.npc_template
      && this.alive && this.generation === generation) {
      packets.push(...this._orbs(3, now));
      this.cooldowns[2] = now;
      packets.push(this._cooldown(2));
    }
    return packets;
  }

  on_bullet_hit(flight, target, now) {
    if (flight.template === 373100) {
      const wasAlive = target.alive;
      const packets = this.damage(flight.raw, now, {
        target, school: 'energy', basic: true,
      })[0];
      if (wasAlive && !target.alive && !target.info.npc_template
        && this.alive && this.generation === flight.source_generation) {
        packets.push(...this._orbs(3, now));
        this.cooldowns[2] = now;
        packets.push(this._cooldown(2));
      }
      return packets;
    }
    return super.onBulletHit(flight, target, now);
  }

  _new_orb(pos, power, generation, now) {
    pos = this.arena.freePosition(pos, now);
    if (pos === null) return [];
    const info = {
      acct_id: this.info.acct_id, tank_id: this.info.tank_id,
      tank_level: this.info.tank_level, npc_template: 373201, owner: this.id,
      source_generation: generation, name: 'Orb', in_room: true,
      untargetable: true, damage_immune: true,
    };
    const orb = new SimaOrb(this.arena, this._newId(5), info, this.camp, pos);
    orb.power = power;
    orb.end = now + 8000;
    this.arena.actors.set(orb.id, orb);
    orb._queue(orb.end, 'sima_orb_expire');
    const packets = [orb.snapshot(now)];
    for (const template of [373202, 373203, 373204, 373440]) {
      packets.push(...orb._buff(template, now, null, { duration: 8000 }));
    }
    return packets;
  }

  _reduce(now, generation) {
    if (!this.alive || this.generation !== generation) return [];
    for (const attr of ['e_next_charge', 'r_next_charge']) {
      const value = this[attr];
      if (value > now) this[attr] = now + pyRound((value - now) * 0.9);
    }
    this.cooldowns[2] = now + pyRound(Math.max(0, this.cooldowns[2] - now) * 0.9);
    return [this._cooldown(1), this._cooldown(2), this._cooldown(10)];
  }

  _flight(flight, now) {
    if (flight.template === 373100) {
      return piercingStep(this, flight, now,
        (f, t, n) => this.onBulletHit(f, t, n), { pierce: false });
    }
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
    const contacts = [];
    for (const other of enemies(this)) {
      const hit = actorContact(start, end, other, flight.previous, now);
      if (hit !== null) contacts.push([hit, other.id, other]);
    }
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (contacts.length) {
      const other = contacts[0][2];
      const blocked = this.projectileBlocked(other, now);
      if (!blocked) {
        const cast = flight.context;
        const key = `${other.id},${other.generation}`;
        const mark = cast.hits.get(key);
        const count = mark && mark.end > now
          && other.buffVersions.get(373311) === mark.version ? mark.count : 0;
        packets.push(...this._hit(cast.power.mul(D(1).add(D('.5').mul(D(count)))),
          other, now, cast.generation));
        for (let template = 373311; template < 373315; template += 1) {
          packets.push(...this._buff(template, now, other.id, { stacks: Math.min(10, count + 1) }));
        }
        if (other.hasBuff(373311, now)) {
          cast.hits.set(key, {
            count: Math.min(10, count + 1), end: now + 1000,
            version: other.buffVersions.get(373311),
          });
        }
        if (this.alive && this.generation === cast.generation) {
          packets.push(...this.restoreHp(cast.power.mul(D('.5')), now));
        }
      }
      return packets.concat([scene(blocked
        ? { expiredBullets: [flight.id] } : { blownBullets: [flight.id] })]);
    }
    if (now >= flight.finish) return packets.concat([scene({ expiredBullets: [flight.id] })]);
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'sima_remaining') {
      return this.alive && this.generation === data[0] ? this._buff(373106, now) : [];
    }
    if (kind === 'sima_passive') {
      const [generation] = data;
      if (!this.alive || this.generation !== generation) return [];
      this._queue(now + 5000, kind, generation);
      return this.orb_count < 3 ? this._orbs(this.orb_count + 1, now) : [];
    }
    if (kind === 'sima_create') {
      const [cast] = data;
      const packets = this.removeObject(cast.id);
      for (const target of enemies(this, { area: true })) {
        const tpos = target.positionAt(now);
        if (Math.hypot(cast.pos[0] - tpos[0], cast.pos[1] - tpos[1]) <= 108) {
          packets.push(...this._hit(cast.power.mul(D('1.83')), target, now, cast.generation));
        }
      }
      return packets.concat(this._new_orb(cast.pos, cast.power, cast.generation, now));
    }
    if (kind === 'sima_volley') {
      const [cast, origin, template] = data;
      const target = this.arena.actors.get(cast.target);
      if (!this.alive || this.generation !== cast.generation || !target || !target.alive
        || target.generation !== cast.target_generation) return [];
      const pos = origin || this.positionAt(now);
      return this.shoot(template, pos, target.positionAt(now), now, 0, {
        school: 'energy', target, through_walls: true, context: cast,
      });
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || now < this.cooldowns[slot]) return [];
    if (((slot === 0 || slot === 10) && start[0] === dest[0] && start[1] === dest[1])
      || (slot === 1 && !this.e_count) || (slot === 10 && !this.r_count)) return [];
    const target = this.arena.actors.get(target_id);
    if (slot === 2 && (!target || !enemies(this).includes(target)
      || Math.hypot(start[0] - target.positionAt(now)[0],
        start[1] - target.positionAt(now)[1]) > 720
      || !teamVisible(this, target, now))) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 2000, 2: 20000, 10: 2000 }[slot], slot);
    if (slot === 0) {
      return this.shoot(373100, start, dest, now, power, {
        school: 'energy', basic: true,
      }).concat([this._cooldown(0)]);
    }
    if (slot === 1) {
      this.e_count -= 1;
      if (!this.e_next_charge) this.e_next_charge = now + this.skillCooldown(6000);
      const pos = aimed(start, dest, 600);
      const [ident, p] = this.addObject(373201, pos);
      this._queue(now + 950, 'object_expire', ident);
      const [second, q] = this.addObject(373202, pos);
      this._queue(now + 300, 'sima_create', {
        pos, power, generation: this.generation, id: second,
      });
      return [p, q, this._cooldown(1)];
    }
    if (slot === 10) {
      this.r_count -= 1;
      if (!this.r_next_charge) this.r_next_charge = now + this.skillCooldown(8000);
      const packets = [scene({ skills: [this._skillEvent(373401, start, dest)] }),
        this._cooldown(10)];
      // Snapshot objects first: contact-created orbs cannot join this push.
      const orbs = [...this.arena.actors.values()].filter(a => a instanceof SimaOrb
        && a.alive && a.info.owner === this.id
        && inCone(a.positionAt(now), start, dest, 384, 45));
      for (const other of enemies(this, { area: true })) {
        const pos = other.positionAt(now);
        if (!inCone(pos, start, dest, 384, 45)) continue;
        packets.push(...this._hit(power.mul(D('1.83')), other, now, this.generation));
        if (this.arena.pk && this.arena.pk.finished) return packets;
        if (other.alive && !other.ccImmune(now)) {
          const [origin, stopped] = prepareDisplacement(other, now, { interrupt: false });
          packets.push(...stopped);
          other._setMotion(origin,
            aimed(start, origin, Math.hypot(start[0] - origin[0], start[1] - origin[1]) + 168,
              { fixed: true }), 504, now, 1);
          other.forcedUntil = other.motion[3];
          packets.push(scene({ moves: [other._moveEvent(other.motion[1], 504, 1)] }));
        }
        packets.push(...this._buff(373404, now, other.id));
      }
      for (const orb of orbs) {
        const pos = orb.positionAt(now);
        const endpoint = aimed(start, pos,
          Math.hypot(start[0] - pos[0], start[1] - pos[1]) + 480, { fixed: true });
        const duration = orb._setMotion(pos, endpoint, 960, now, 1);
        const cast = {
          previous: now, finish: now + duration, motion: orb.motion, hits: new Set(),
          power, generation: this.generation,
        };
        orb.push = cast;
        orb._queue(now + Math.min(20, duration), 'sima_orb_push', cast);
        packets.push(...orb._buff(373403, now),
          scene({ moves: [orb._moveEvent(orb.motion[1], 960, 1)] }));
      }
      return packets;
    }
    const orbs = [...this.arena.actors.values()].filter(a => a instanceof SimaOrb
      && a.alive && a.info.owner === this.id);
    const cast = {
      target: target.id, target_generation: target.generation,
      power, generation: this.generation, hits: new Map(),
    };
    const count = this.orb_count;
    const template = count ? 373310 + count * 10 : 373301;
    const packets = [scene({
      skills: [this._skillEvent(template, start, target.positionAt(now), target.id)],
    })];
    packets.push(...this._buff(373301, now, target.id), ...this._buff(373350, now, target.id),
      ...this._buff(373330, now));
    for (let index = 0; index < count; index += 1) {
      this._queue(now + index * 500, 'sima_volley', cast, null, template);
    }
    if (count >= 2) packets.push(...this._buff(count === 3 ? 373105 : 373106, now));
    if (count === 3) this._queue(now + 500, 'sima_remaining', this.generation);
    packets.push(...this._orbs(0, now));
    for (const orb of orbs) {
      const pos = orb.positionAt(now);
      this._queue(now, 'sima_volley', cast, pos, 373310);
      packets.push(...orb.despawn(now));
    }
    return packets.concat([this._cooldown(2)]);
  }
}

export class SimaOrb extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.cooldowns = {};
    this.power = D(0);
    this.end = 0;
    this.push = null;
  }

  snapshot(now) {
    return [1556, encodeS1556(this.sceneId, {
      objectId: this.id, templateId: 373201, x: this.positionAt(now)[0],
      y: this.positionAt(now)[1], hp: this.hp.ceil(), camp: this.camp,
      maxHp: this.maxHp.ceil(), ownerId: this.info.owner, shield: 0, buffs: [],
    })];
  }

  syncSpeed() { return []; }

  _respawn(now, generation) {
    if (generation !== this.generation) return [];
    return retireSummon(this, now, generation);
  }

  despawn(now) {
    if (!this.alive) return [];
    this.position = this.positionAt(now);
    this.motion = null;
    this.hp = D(0);
    this.info.hp = 0;
    this.push = null;
    this._queue(now + 2000, 'respawn', this.generation);
    const packets = [];
    for (const key of [...this.activeBuffs.keys()]) {
      const [owner, template] = key.split(',').map(Number);
      if (owner === this.id) packets.push(...this.removeBuff(template, now));
    }
    return packets.concat([scene({ removedObjects: [this.id] })]);
  }

  _event(now, kind, data) {
    if (kind === 'respawn') return super._event(now, kind, data);
    const owner = this.arena.actors.get(this.info.owner);
    if (kind === 'sima_orb_expire') {
      if (!this.alive) return [];
      const pos = this.positionAt(now);
      const packets = [scene({ skills: [this._skillEvent(373430, pos, pos)] })];
      for (const target of enemies(owner, { area: true })) {
        const tpos = target.positionAt(now);
        if (Math.hypot(pos[0] - tpos[0], pos[1] - tpos[1]) <= 96) {
          packets.push(...owner._hit(this.power.mul(D('1.83')), target, now,
            this.info.source_generation));
        }
      }
      return packets.concat(this.despawn(now));
    }
    if (kind === 'sima_orb_push') {
      const [cast] = data;
      if (!this.alive || this.push !== cast) return [];
      const start = this.positionAt(cast.previous), end = this.positionAt(now);
      const packets = [];
      for (const target of enemies(owner)) {
        const key = `${target.id},${target.generation}`;
        if (cast.hits.has(key)
          || actorContact(start, end, target, cast.previous, now) === null) continue;
        cast.hits.add(key);
        const pos = target.positionAt(now);
        packets.push(...owner._hit(cast.power.mul(D('2.04')), target, now, cast.generation));
        packets.push(...owner._reduce(now, cast.generation),
          ...owner._buff(373421, now, target.id));
        packets.push(...owner._new_orb(pos, cast.power, cast.generation, now));
      }
      if (!this.motion || now >= this.motion[3] || now >= cast.finish) {
        this.position = end;
        this.motion = null;
        this.push = null;
        return packets.concat(this.removeBuff(373403, now));
      }
      cast.previous = now;
      this._queue(Math.min(now + 20, this.motion[3], cast.finish), kind, cast);
      return packets;
    }
    return super._event(now, kind, data);
  }
}

export { SLOTS as SIMAYI_SLOTS };
