/* Thuy Tinh (tank 10000079): five marks, water walls, ice rebirth.
 * Port of server/thuytinh_actions.py onto the JS battle core.
 *
 * Stubs: presentation only. Water blocks use objectPacket; wall collision is
 * already integrated by the arena's waterRects/clipMotion.
 */
import { TankActions } from '../arena.js';
import { D, pyRound, rectContact } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { packII, prepareDisplacement } from './melee.js';
import { objectPacket } from './batch-c-common.js';

const SLOTS = { 0: 353100, 1: 353201, 2: 353301, 10: 353101 };
const MARKS = [353200, 353201, 353202, 353204];
const ICE = [353121, 353122, 353123, 353125];

export class ThuyTinhActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ice = this.ready = this.water_wall = null;
    this.passive_ready_at = 0;
  }

  _cooldown(slot, changed = false) {
    const cancel = slot === 1 && this.water_wall !== null && this.hasBuff(353501, this.clock());
    const info = {
      skillId: cancel ? 353501 : SLOTS[slot], slot, count: -1,
      end: cancel ? 0 : this.cooldowns[slot], nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) { return this._buff(353111, now).concat([this._cooldown(1, true)]); }

  _speed(now) { return this.ready || this.ice ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  cc_immune(now, options = {}) { return Boolean(this.ice) || super.ccImmune(now, options); }

  reject_buff(row, source, now) { return Boolean(this.ice && source.camp !== this.camp); }

  _end_ice(now) {
    if (!this.ice) return [];
    this.ice = null;
    const packets = [];
    for (const t of ICE) packets.push(...this.removeBuff(t, now));
    return packets.concat(this._buff(353131, now), this.syncSpeed(now));
  }

  // The core calls camelCase commitHp; keep the Python death-intercept there.
  commitHp(hp, now, { critical = false } = {}) {
    const value = D(hp);
    if (this.hp.gt(0) && value.isZero() && !this.ice && now >= this.passive_ready_at) {
      const packets = this.interrupt(now).concat(this.cleanse(now));
      this.passive_ready_at = now + 15000;
      packets.push(...super.commitHp(1, now, { critical }));
      this.ice = { end: now + 2000, generation: this.generation };
      for (let index = 1; index <= 4; index += 1) {
        this._queue(now + index * 500, 'thuy_ice', this.ice, index);
      }
      for (const t of ICE) packets.push(...this._buff(t, now, null, { duration: 2000 }));
      packets.push(...this._buff(353124, now, null, { duration: 15000 }));
      return packets.concat(this.syncSpeed(now));
    }
    return super.commitHp(hp, now, { critical });
  }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      this.ready = null;
      packets.push([1583, packII(this.id, 353301)]);
    }
    if (!this.alive) packets.push(...this._end_ice(now));
    return packets.concat(this.syncSpeed(now));
  }

  update(now) {
    const packets = this.ready && this.skillSealed(2, now) ? this.interrupt(now) : [];
    return packets.concat(super.update(now));
  }

  _mark(target, now, count = 1) {
    if (!target.alive || target.hasBuff(353403, now)
      || target.rejectBuff({ nEffectType: '201' }, this, now)) return [];
    let stage = 0;
    for (let i = 0; i < MARKS.length; i += 1) if (target.hasBuff(MARKS[i], now)) stage = i + 1;
    const packets = [];
    for (const t of MARKS) if (target.hasBuff(t, now)) packets.push(...target.removeBuff(t, now));
    if (stage + count < 5) return packets.concat(this._buff(MARKS[stage + count - 1], now, target.id));
    for (const t of [353401, 353403, 353205]) packets.push(...this._buff(t, now, target.id));
    return packets;
  }

  on_bullet_hit(flight, target, now) {
    return flight.template === 353100 ? this._mark(target, now) : [];
  }

  _remove_wall(now) {
    const wall = this.water_wall;
    this.water_wall = null;
    if (!wall) return [];
    const packets = [];
    for (const [ident] of wall.blocks) packets.push(...this.removeObject(ident, { destroyed: true }));
    packets.push(...this.removeObject(wall.prop));
    packets.push(...this.removeBuff(353501, now));
    return packets.concat([this._cooldown(1, true), this._cooldown(1)]);
  }

  _create_wall(start, center, power, now) {
    const span = Math.hypot(center[0] - start[0], center[1] - start[1]);
    const normal = [(center[0] - start[0]) / span, (center[1] - start[1]) / span];
    const axis = [-normal[1], normal[0]];
    const packets = [];
    for (const target of [...this.arena.actors.values()]) {
      const pos = target.positionAt(now);
      const offset = [pos[0] - center[0], pos[1] - center[1]];
      if (target.alive && target.camp !== this.camp
        && Math.abs(offset[0] * axis[0] + offset[1] * axis[1]) <= 108
        && Math.abs(offset[0] * normal[0] + offset[1] * normal[1]) <= 36) {
        packets.push(...this.damage(power.mul(D('2.21')), now, { target, school: 'energy' })[0]);
        if (this.arena.pk && this.arena.pk.finished) return packets;
        packets.push(...this._mark(target, now, 2));
      }
    }
    let centers = [];
    for (let index = -4; index <= 4; index += 1) {
      centers.push([pyRound(center[0] + axis[0] * index * 72),
        pyRound(center[1] + axis[1] * index * 72)]);
    }
    centers = centers.filter(p => {
      const clamped = this.arena.geometry.clampTankPosition(p);
      return clamped[0] === p[0] && clamped[1] === p[1];
    });
    const planned = centers.map(p => ([p, [p[0] - 36, p[1] - 36, p[0] + 36, p[1] + 36]]));
    const [ident, packet] = this.addObject(353205, center);
    const wall = { blocks: [], prop: ident, end: now + 4000 };
    this.water_wall = wall;
    packets.push(packet);
    for (const [pos, rect] of planned) {
      let pushes = new Map();
      for (const target of this.arena.actors.values()) {
        const current = target.positionAt(now);
        if (!target.alive || rectContact(current, current, [rect], 36 - 0.001) === null) continue;
        if (target.info.npc_template) { pushes = null; break; }
        const occupied = [...this.arena.actors.values()]
          .filter(a => a.alive && a.id !== target.id)
          .map(a => pushes.get(a.id) ?? a.positionAt(now));
        const dest = this.arena.freePosition(current, now,
          { extra: planned.map(entry => entry[1]), occupied });
        if (dest === null) { pushes = null; break; }
        pushes.set(target.id, dest);
      }
      if (pushes === null) continue;
      for (const [owner, dest] of pushes) {
        const target = this.arena.actors.get(owner);
        packets.push(...target.interrupt(now));
        target.position = dest;
        target.motion = null;
        target.forcedUntil = now;
        packets.push(scene({ moves: [target._moveEvent(dest, 0, 5)] }));
      }
      const block = this._newId(3);
      const [, blockPacket] = objectPacket(this, 353201, pos,
        { ident: block, hp: -1, maxHp: -1, ownerId: this.id });
      wall.blocks.push([block, pos]);
      packets.push(blockPacket);
    }
    for (const target of this.arena.actors.values()) {
      if (!target.alive || !target.motion || target.motion[3] <= now) continue;
      const origin = target.positionAt(now), dest = target.motion[1];
      if (!target.motionKind && target.forcedUntil <= now
        && rectContact(origin, dest, this.arena.waterRects(now), 36 - 0.001) === null) continue;
      let clipped = this.arena.clipMotion(origin, dest, now);
      if (clipped[0] === dest[0] && clipped[1] === dest[1]) continue;
      const oldMotion = target.motion;
      const oldReclip = target.water_motion_reclip;
      const motionOrigin = oldReclip && oldReclip.generation === target.generation
        && oldReclip.motion === oldMotion ? oldReclip.origin : { motion: oldMotion };
      const speed = Math.max(1, pyRound(Math.hypot(dest[0] - origin[0], dest[1] - origin[1])
        * 1000 / (target.motion[3] - now)));
      const kind = target.motionKind;
      const [safe, stopped] = prepareDisplacement(target, now, { interrupt: false });
      packets.push(...stopped);
      clipped = this.arena.clipMotion(safe, dest, now);
      const duration = target._setMotion(safe, clipped, speed, now, kind);
      target.forcedUntil = Math.min(target.forcedUntil, now + duration);
      if (kind === 1) {
        target.water_motion_reclip = {
          generation: target.generation, origin: motionOrigin, motion: target.motion,
        };
      }
      packets.push(scene({ moves: [target._moveEvent(clipped, speed, kind)] }));
    }
    this._queue(now + 4000, 'thuy_wall_end', wall);
    return packets.concat(this._buff(353501, now), [this._cooldown(1, true)]);
  }

  _event(now, kind, data) {
    if (kind === 'thuy_ice') {
      const [cast, index] = data;
      if (this.ice !== cast || !this.alive || this.generation !== cast.generation) return [];
      const packets = this.restoreHp(this.maxHp.mul(D('.0375')), now);
      return index === 4 ? packets.concat(this._end_ice(now)) : packets;
    }
    if (kind === 'thuy_wall_end') {
      return this.water_wall === data[0] ? this._remove_wall(now) : [];
    }
    if (kind === 'thuy_space_cast') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.skillSealed(2, now)) {
        return this.ready === cast ? this.interrupt(now) : [];
      }
      this.ready = null;
      const start = this.positionAt(now);
      return this.shoot(353301, start, cast.dest, now, D(0), {
        school: 'energy', power: cast.power, through_walls: true,
        context: cast, fixed_destination: true,
      }).concat(this.syncSpeed(now));
    }
    if (kind === 'thuy_area') {
      const [cast, index] = data;
      const packets = [];
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(cast.pos[0] - target.positionAt(now)[0],
            cast.pos[1] - target.positionAt(now)[1]) <= 288) {
          packets.push(...this.damage(cast.power.mul(D('.81')), now,
            { target, school: 'energy', periodic: true })[0]);
          packets.push(...this._mark(target, now), ...this._buff(353304, now, target.id));
        }
      }
      if (this.alive && this.generation === cast.generation
        && Math.hypot(cast.pos[0] - this.positionAt(now)[0],
          cast.pos[1] - this.positionAt(now)[1]) <= 288) {
        packets.push(...this.restoreHp(cast.power.mul(D('.5')), now));
      }
      if (index === 8) packets.push(...this.removeObject(cast.id));
      else this._queue(now + 500, kind, cast, index + 1);
      return packets;
    }
    return super._event(now, kind, data);
  }

  _flight(flight, now) {
    if (flight.template === 353100) return super._flight(flight, now);
    if (now < flight.finish) {
      flight.previous = now;
      this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
      return [];
    }
    const [ident, packet] = this.addObject(353301, flight.end);
    const cast = { id: ident, pos: flight.end, power: flight.power, generation: flight.source_generation };
    this._queue(now + 500, 'thuy_area', cast, 1);
    return [scene({ blownBullets: [flight.id] }), packet];
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)) return [];
    const cancel = slot === 1 && this.water_wall && this.hasBuff(353501, now);
    if (!cancel && this.cooldowns[slot] > now) return [];
    if (!cancel && (!this._inside(dest)
      || ((slot === 0 || slot === 1) && start[0] === dest[0] && start[1] === dest[1])
      || (slot !== 0 && Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 600))) return [];
    if (cancel) {
      return this._end_ice(now).concat(
        [scene({ skills: [this._skillEvent(353501, start, start, this.id)] })],
        this._remove_wall(now));
    }
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown({
      0: this.fireInterval(now), 1: 10000, 2: 25000, 10: 6000,
    }[slot], slot);
    if (slot === 0) {
      return this.shoot(353100, start, dest, now, power,
        { school: 'energy', basic: true }).concat([this._cooldown(0)]);
    }
    const packets = this._end_ice(now);
    packets.push(scene({ skills: [this._skillEvent(SLOTS[slot], start, dest, 0,
      { ready: slot === 2 ? 1 : 0 })] }));
    if (slot === 10) {
      for (const target of [...this.arena.actors.values()]) {
        if (!target.alive || target.camp === this.camp
          || Math.hypot(dest[0] - target.positionAt(now)[0],
            dest[1] - target.positionAt(now)[1]) > 192) continue;
        const missing = target.maxHp.sub(target.hp);
        packets.push(...this._buff(353300, now, target.id), ...this._mark(target, now));
        const version = target.buffVersions.get(353205) ?? 0;
        const extra = target.hasBuff(353205, now) && target.freeze_consumed_version !== version;
        if (extra) target.freeze_consumed_version = version;
        packets.push(...this.damage(power.mul(D('1.75')), now, { target, school: 'energy' })[0]);
        if (extra) {
          packets.push(...this.damage(power.mul(D('2.25')).add(missing.mul(D('.15'))), now,
            { target, school: 'energy' })[0]);
          packets.push(...this._buff(353601, now, target.id));
          this.cooldowns[10] = now;
        }
      }
    } else if (slot === 1) {
      packets.push(...this._create_wall(start, dest, power, now));
    } else {
      const [, stopped] = prepareDisplacement(this, now, { interrupt: false });
      const [ident, packet] = this.addObject(353801, dest);
      this._queue(now + 50, 'object_expire', ident);
      this.ready = { slot: 2, dest, power, generation: this.generation };
      this._queue(now + 50, 'thuy_space_cast', this.ready);
      packets.push(packet);
      return packets.concat([this._cooldown(slot)], this.syncSpeed(now), stopped);
    }
    return packets.concat([this._cooldown(slot)], this.syncSpeed(now));
  }
}

export { SLOTS as THUYTINH_SLOTS, MARKS as THUYTINH_MARKS };
