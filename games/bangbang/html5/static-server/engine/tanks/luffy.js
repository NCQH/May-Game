/* Luffy (tank 10000046): no native R, one collision per push, five Space punches.
 * Port of server/luffy_actions.py onto the JS battle core.
 *
 * Stubs: no skin/presentation; water reclip only honours a lineage record the
 * (unported) water-wall kit would have written.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt } from '../math.js';
import { scene, stop_move, encodeS1572 } from '../protocol.js';
import { aimed, enemies, inCone, inStrip, packII, prepareDisplacement } from './melee.js';
import { acceptWaterReclip, samePosition } from './batch-d-common.js';

const SLOTS = { 0: 320100, 1: 320301, 2: 320201 };

export class LuffyActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    delete this.cooldowns[10];
    this.channel = null;
    this.passive_ready_at = 0;
  }

  _cooldown(slot) {
    if (!(slot in SLOTS)) {
      return [1572, encodeS1572(this.id, {
        skillId: this.skillForSlot(slot) ?? 0, slot, count: -1,
        end: this.cooldowns[slot] ?? 0, nextCharge: 0,
      })];
    }
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot], nextCharge: 0,
    })];
  }

  on_spawn(now) { return this._buff(320102, now); }

  commit_hp(hp, now, { critical = false } = {}) {
    const trigger = this.hp.gt(0) && hp.lt(this.hp) && hp.lt(this.maxHp.mul(D('.4')))
      && now >= this.passive_ready_at;
    if (trigger) {
      this.passive_ready_at = now + 30000;
      return super.commitHp(hp.max(D(1)), now, { critical }).concat(this._buff(320101, now));
    }
    return super.commitHp(hp, now, { critical });
  }

  _speed(now) { return this.channel ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.channel) || super.blocked(action, now); }

  interrupt(now) {
    if (!this.channel) return [];
    this.channel = null;
    return [[1583, packII(this.id, 320201)]].concat(this.syncSpeed(now));
  }

  update(now) {
    const packets = this.channel && this.skillSealed(2, now) ? this.interrupt(now) : [];
    return packets.concat(super.update(now));
  }

  _push(target, dest, now, pairs) {
    if (!target.alive || target.ccImmune(now)) return [];
    const current = target.positionAt(now);
    // Keep the old dash origin until its interrupted body has a legal stop.
    const start = target.stopPosition(now);
    let finish = aimed(start, [start[0] + dest[0], start[1] + dest[1]], 240, { fixed: true });
    const wall = this.arena.geometry.wallContact(start, finish, 36);
    if (wall !== null) finish = pointAt(start, finish, Math.max(0, wall - 1e-5));
    const requested = finish;
    if (!samePosition(start, current)) { target.position = start; target.motion = null; }
    const packets = target.interrupt(now);
    if (!samePosition(start, current)) packets.push(stop_move(target.sceneId, target.id, start));
    const duration = target._setMotion(start, finish, 480, now, 1);
    finish = target.motion[1];
    target.forcedUntil = now + duration;
    const cast = {
      target: target.id, target_generation: target.generation, generation: this.generation,
      start, end: now + duration, previous: now, motion: target.motion, pairs,
      wall: wall !== null || Math.hypot(finish[0] - requested[0], finish[1] - requested[1]) > 0.1,
    };
    this._queue(now + Math.min(20, duration), 'luffy_push', cast);
    return packets.concat(this._buff(320311, now, target.id, { duration }),
      this._buff(320321, now, target.id, { duration }),
      [scene({ moves: [this._moveEvent(finish, 480, 1, target.id)] })]);
  }

  _event(now, kind, data) {
    if (kind === 'luffy_punch') {
      const [cast, index] = data;
      if (this.channel !== cast || !this.alive) return [];
      const packets = [scene({ skills: [this._skillEvent(320201, cast.start, cast.dest)] })];
      for (const target of enemies(this, { area: true })) {
        if (inCone(target.positionAt(now), cast.start, cast.dest, 360, 60)) {
          packets.push(...this.damage(cast.power.mul(D('.91')), now, { target })[0]);
          if (index < 5) packets.push(...this._buff(320211, now, target.id, { duration: 200 }));
        }
      }
      if (index === 5) {
        this.channel = null;
        packets.push(...this.syncSpeed(now));
      }
      return packets;
    }
    if (kind === 'luffy_push') {
      const [cast] = data;
      const target = this.arena.actors.get(cast.target);
      if (!target || !target.alive || target.generation !== cast.target_generation) return [];
      if (target.motion !== cast.motion) {
        if (target.motion && target.motionKind === 1 && target.motion[3] <= cast.end
          && target.hasBuff(320311, now) && acceptWaterReclip(target, cast)) {
          cast.motion = target.motion;
          cast.previous = Math.max(cast.previous, target.motion[2]);
          cast.end = target.motion[3];
          cast.wall = true;
        } else {
          return target.removeBuff(320311, now).concat(target.removeBuff(320321, now));
        }
      }
      const start = target.positionAt(cast.previous), end = target.positionAt(now);
      const contacts = [];
      for (const other of this.arena.actors.values()) {
        const pair = [[target.id, target.generation], [other.id, other.generation]]
          .sort((a, b) => a[0] - b[0] || a[1] - b[1]).join(',');
        if (other === target || !other.alive || other.isUntargetable() || cast.pairs.has(pair)) continue;
        const hit = actorContact(start, end, other, cast.previous, now, 72);
        if (hit !== null) contacts.push([hit, other.id, other, pair]);
      }
      if (contacts.length || now >= cast.end) {
        const packets = [];
        let other = null;
        if (contacts.length) {
          contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
          const [hit, , victim, pair] = contacts[0];
          other = victim;
          cast.pairs.add(pair);
          target.position = target.moveDestination(start, pointAt(start, end, hit));
        } else {
          target.position = end;
        }
        target.motion = null;
        target.forcedUntil = now;
        packets.push(...target.removeBuff(320311, now), ...target.removeBuff(320321, now));
        packets.push(scene({ moves: [this._moveEvent(target.position, 0, 5, target.id)] }));
        if (contacts.length || cast.wall) {
          const amount = target.maxHp.mul(D('.05'));
          const victims = [target].concat(other && other.camp !== this.camp ? [other] : []);
          for (const victim of victims) {
            packets.push(...this._buff(320411, now, victim.id));
            packets.push(...this.damage(amount, now, { target: victim })[0]);
          }
        }
        return packets;
      }
      cast.previous = now;
      this._queue(Math.min(now + 20, cast.end), kind, cast);
      return [];
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (samePosition(start, dest) || !this._inside(dest)) return [];
    const power = this.combatStat('iAttack', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 8000, 2: 25000 }[slot], slot);
    const packets = [this._cooldown(slot)];
    if (slot === 0) {
      return packets.concat(this.shoot(320100, start, dest, now, power,
        { school: 'physical', basic: true }));
    }
    if (slot === 1) {
      packets.push(scene({ skills: [this._skillEvent(320301, start, dest)] }));
      const pairs = new Set();
      for (const target of enemies(this, { area: true })) {
        if (inStrip(target.positionAt(now), start, dest, 360, 72)) {
          packets.push(...this.damage(power.mul(D('1.24')), now, { target })[0]);
          if (this.arena.pk && this.arena.pk.finished) return packets;
          packets.push(...this._push(target, [dest[0] - start[0], dest[1] - start[1]], now, pairs));
        }
      }
      return packets;
    }
    let body, handoff;
    [body, handoff] = prepareDisplacement(this, now, { interrupt: false });
    if (!handoff.length) body = start;
    this.position = body;
    this.motion = null;
    this.channel = { start, dest, power, generation: this.generation, end: now + 1000 };
    for (const target of enemies(this, { area: true })) {
      if (inCone(target.positionAt(now), start, dest, 360, 60)) {
        packets.push(...this._buff(320211, now, target.id, { duration: 1000 }));
      }
    }
    for (let index = 1; index <= 5; index += 1) {
      this._queue(now + index * 200, 'luffy_punch', this.channel, index);
    }
    return packets.concat(this.syncSpeed(now), handoff);
  }
}

export { SLOTS as LUFFY_SLOTS };
