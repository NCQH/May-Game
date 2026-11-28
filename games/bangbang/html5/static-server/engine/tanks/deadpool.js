/* Deadpool (tank 10000070): one rescue per R window, deduped push.
 * Port of server/deadpool_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. teamVisible uses the core line-of-sight stub.
 */
import { TankActions, bkey } from '../arena.js';
import { D, actorContact, pointAt } from '../math.js';
import { scene, stopMove, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, packII, prepareDisplacement } from './melee.js';
import { acceptWaterReclip } from './batch-e-common.js';
import { teamVisible } from './batch-c-common.js';

const SLOTS = { 0: 344100, 1: 344201, 2: 344301, 10: 344101 };

export class DeadpoolActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = this.rebirth = this.mark = null;
  }

  _cooldown(slot, changed = false) {
    const follow = slot === 1 && this.mark !== null && this.hasBuff(344212, this.clock());
    const info = {
      skillId: follow ? 344202 : SLOTS[slot], slot, count: -1,
      end: follow ? 0 : this.cooldowns[slot] ?? 0, nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.ready = this.rebirth = this.mark = null;
    this.info.untargetable = this.info.damage_immune = false;
    return [this._cooldown(1, true)];
  }

  attrBonus(attributes, now) {
    let value = super.attrBonus(attributes, now);
    if (attributes.includes(4) && this.hasBuff(344112, now)) {
      value = value.add(D('.05').mul(D(this.buffStacks.get(344112) ?? 1)));
    }
    return value;
  }

  _speed(now) { return this.rebirth ? 0 : super._speed(now); }

  blocked(action, now) {
    return Boolean(this.rebirth || (this.ready && action === 'attack'))
      || super.blocked(action, now);
  }

  rejectBuff(row, source, now) { return Boolean(this.rebirth && source.camp !== this.camp); }

  cc_immune(now, options) { return this.ccImmune(now, options); }

  ccImmune(now, options) { return Boolean(this.rebirth) || super.ccImmune(now, options); }

  restoreHp(amount, now) { return this.rebirth ? [] : super.restoreHp(amount, now); }

  commitHp(hp, now, { critical = false } = {}) {
    if (this.alive && D(hp).isZero() && this.hasBuff(344101, now) && !this.rebirth) {
      const [, stopped] = prepareDisplacement(this, now, { interrupt: false });
      const packets = this.interrupt(now)
        .concat(this.removeBuff(344101, now), this.cleanse(now));
      this.position = this.positionAt(now);
      this.motion = null;
      this.forcedUntil = now;
      this.rebirth = {
        end: now + 1000, was_immune: this.info.damage_immune,
        was_untargetable: this.info.untargetable,
      };
      this.info.untargetable = this.info.damage_immune = true;
      packets.push(...super.commitHp(D(1), now, { critical }));
      packets.push(...this._buff(344103, now), ...this._buff(344104, now));
      this._queue(now + 1000, 'deadpool_return', this.rebirth);
      return packets.concat(stopped, [
        scene({ moves: [this._moveEvent(this.position, 0, 5)] }),
      ], this.syncSpeed(now));
    }
    if (this.rebirth && hp.lt(this.hp)) return [];
    return super.commitHp(hp, now, { critical });
  }

  interrupt(now) {
    if (!this.ready) return [];
    this.ready = null;
    return [[1583, packII(this.id, 344202)]];
  }

  onControl(source, template, now) {
    if (!this.ready) return [];
    const kind = Number(this.arena.data.tableRow('BuffTemplate_table.xml',
      { nBuffId: template }).get('nEffectType'));
    return [30, 35, 66].includes(kind) ? this.interrupt(now) : [];
  }

  removeBuff(template, now, { expired = false } = {}) {
    const packets = super.removeBuff(template, now, { expired });
    if (template === 344212) {
      this.mark = null;
      packets.push(this._cooldown(1, true));
    }
    return packets;
  }

  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  _markedTarget(now) {
    const mark = this.mark;
    if (!mark) return null;
    const target = this.arena.actors.get(mark.target);
    if (target && target.alive && target.generation === mark.target_generation
      && target.hasBuff(344211, now)
      && target.buffVersions.get(344211) === mark.version) return target;
    return null;
  }

  update(now) {
    const packets = [];
    if (this.mark && !this._markedTarget(now)) packets.push(...this.removeBuff(344212, now));
    if (this.ready && this.skillSealed(1, now)) packets.push(...this.interrupt(now));
    return packets.concat(super.update(now));
  }

  onBulletHit(flight, target, now) {
    if (flight.template !== 344201 || !this.alive
      || flight.source_generation !== this.generation) return [];
    const packets = this._buff(344211, now, target.id);
    if (target.hasBuff(344211, now) && target.buffSources.get(344211) === this.id) {
      this.mark = {
        target: target.id, target_generation: target.generation,
        version: target.buffVersions.get(344211),
      };
      packets.push(...this._buff(344212, now));
      packets.push(this._cooldown(1, true));
    }
    return packets;
  }

  _push(target, start, power, now) {
    if (!target.alive || target.ccImmune(now)) return [];
    const current = target.positionAt(now), pos = target.stopPosition(now);
    let direction = [pos[0] - start[0], pos[1] - start[1]];
    if (direction[0] === 0 && direction[1] === 0) direction = [1, 0];
    let dest = aimed(pos, [pos[0] + direction[0], pos[1] + direction[1]], 480,
      { fixed: true });
    const wall = this.arena.geometry.wallContact(pos, dest, 36);
    if (wall !== null) dest = pointAt(pos, dest, Math.max(0, wall - 0.00001)).map(Math.round);
    const requested = dest;
    if (pos[0] !== current[0] || pos[1] !== current[1]) {
      target.position = pos;
      target.motion = null;
    }
    const packets = target.interrupt(now);
    if (pos[0] !== current[0] || pos[1] !== current[1]) {
      packets.push([1554, stopMove(target.sceneId, target.id, pos)]);
    }
    const duration = target._setMotion(pos, dest, 720, now, 1);
    target.forcedUntil = now + duration;
    const cast = {
      target: target.id, target_generation: target.generation, power, previous: now,
      end: now + duration, motion: target.motion,
      wall: wall !== null || Math.hypot(requested[0] - target.motion[1][0],
        requested[1] - target.motion[1][1]) > 0.1,
      hits: new Set(),
    };
    this._queue(now + Math.min(20, duration), 'deadpool_push', cast);
    return packets.concat(this._buff(344303, now, target.id, { duration }),
      [scene({ moves: [this._moveEvent(target.motion[1], 720, 1, target.id)] })]);
  }

  _event(now, kind, data) {
    if (kind === 'deadpool_return') {
      const [cast] = data;
      if (this.rebirth !== cast || !this.alive) return [];
      this.rebirth = null;
      this.info.damage_immune = cast.was_immune;
      this.info.untargetable = cast.was_untargetable;
      const packets = this.removeBuff(344103, now)
        .concat(this.removeBuff(344104, now), super.commitHp(this.maxHp.mul(D('.5')), now));
      for (const template of [344106, 344108, 344109, 344110, 344111, 344112, 344113]) {
        packets.push(...this._buff(template, now));
      }
      const [ident, packet] = this.addObject(344107, this.positionAt(now));
      packets.push(packet);
      this._queue(now + 1000, 'object_expire', ident);
      return packets.concat(this.syncSpeed(now));
    }
    if (kind === 'deadpool_recast') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      const target = this.arena.actors.get(cast.target);
      if (!target || !target.alive || target.generation !== cast.target_generation
        || target.isUntargetable() || !target.hasBuff(344211, now)
        || target.buffVersions.get(344211) !== cast.version) return [];
      const start = this.positionAt(now);
      const dest = this.blinkDestination(start, target.positionAt(now));
      this.position = dest;
      this.motion = null;
      this.forcedUntil = now;
      const packets = [
        scene({ moves: [this._moveEvent(dest, 0, 5)] }),
        scene({ skills: [this._skillEvent(344202, start, dest, target.id)] }),
      ];
      packets.push(...this.damage(target.maxHp.sub(target.hp).mul(D('.25')), now,
        { target, school: 'true' })[0]);
      packets.push(...this._buff(344204, now), ...this._buff(344205, now, target.id),
        ...this._buff(344207, now, target.id), ...this._buff(344206, now));
      return packets;
    }
    if (kind === 'deadpool_push') {
      const [cast] = data;
      const target = this.arena.actors.get(cast.target);
      if (!target || !target.alive || target.generation !== cast.target_generation) return [];
      if (target.motion !== cast.motion) {
        if (target.motion && target.motionKind === 1 && target.motion[3] <= cast.end
          && target.hasBuff(344303, now) && acceptWaterReclip(target, cast)) {
          cast.motion = target.motion;
          cast.previous = Math.max(cast.previous, target.motion[2]);
          cast.end = target.motion[3];
          cast.wall = true;
        } else return target.removeBuff(344303, now);
      }
      const start = target.positionAt(cast.previous), end = target.positionAt(now);
      const packets = [];
      const contacts = [];
      for (const other of enemies(this)) {
        const key = `${other.id},${other.generation}`;
        if (other === target || cast.hits.has(key)) continue;
        const hit = actorContact(start, end, other, cast.previous, now, 72);
        if (hit !== null) contacts.push([hit, other.id, other, key]);
      }
      contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      for (const [, , other, key] of contacts) {
        cast.hits.add(key);
        for (const victim of [target, other]) {
          packets.push(...this.damage(cast.power.mul(D('2.5')), now, { target: victim })[0]);
          if (this.arena.pk && this.arena.pk.finished) return packets;
          if (victim.alive) packets.push(...this._buff(344305, now, victim.id));
        }
        if (!target.alive || target.isUntargetable()) return packets;
        target.motion = cast.motion;
        target.position = cast.motion[1];
        target.motionKind = 1;
        target.forcedUntil = cast.end;
        packets.push(scene({ moves: [this._moveEvent(target.motion[1], 720, 1, target.id)] }));
      }
      if (now >= cast.end) {
        target.position = end;
        target.motion = null;
        target.forcedUntil = now;
        packets.push(...target.removeBuff(344303, now));
        packets.push(scene({ moves: [this._moveEvent(end, 0, 5, target.id)] }));
        if (cast.wall) {
          packets.push(...this.damage(cast.power.mul(D('2.5')), now, { target })[0]);
          packets.push(...this._buff(344307, now, target.id));
        }
        return packets;
      }
      cast.previous = now;
      this._queue(Math.min(now + 20, cast.end), kind, cast);
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)) return [];
    const follow = slot === 1 && this.mark && this.hasBuff(344212, now);
    if (!follow && this.cooldowns[slot] > now) return [];
    if (follow) {
      const target = this._markedTarget(now);
      if (!target || !(targetId === 0 || targetId === target.id) || target.isUntargetable()
        || Math.hypot(start[0] - target.positionAt(now)[0],
          start[1] - target.positionAt(now)[1]) > 600) return [];
      if (!teamVisible(this, target, now)) return [];
      this.ready = {
        ...this.mark, slot: 1, skill: 344202, dest: target.positionAt(now), end: now + 50,
      };
      this._queue(now + 50, 'deadpool_recast', this.ready);
      return this.removeBuff(344212, now).concat([scene({
        skills: [this._skillEvent(344202, start, target.positionAt(now), target.id, { ready: 1 })],
      })]);
    }
    if ([0, 1].includes(slot) && start[0] === dest[0] && start[1] === dest[1]) return [];
    let target = null;
    if (slot === 2) {
      target = this.arena.actors.get(targetId);
      if (!target || !enemies(this).includes(target)
        || Math.hypot(start[0] - target.positionAt(now)[0],
          start[1] - target.positionAt(now)[1]) > 168) return [];
      if (!teamVisible(this, target, now)) return [];
    }
    const power = this.combatStat('iAttack', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 6000, 2: 15000, 10: 8000 }[slot], slot);
    const packets = [this._cooldown(slot)];
    if (slot === 0 || slot === 1) {
      return packets.concat(this.shoot(SLOTS[slot], start, dest, now,
        slot === 1 ? power.mul(D('1.85')) : power, {
          school: 'physical', basic: slot === 0, through_walls: slot === 1,
        }));
    }
    packets.push(scene({ skills: [this._skillEvent(SLOTS[slot], start, dest, targetId)] }));
    if (slot === 10) return packets.concat(this._buff(344101, now));
    packets.push(...this.damage(power.mul(D('3.58')), now, { target })[0]);
    if (this.arena.pk && this.arena.pk.finished) return packets;
    return packets.concat(this._push(target, start, power, now));
  }
}

export { SLOTS as DEADPOOL_SLOTS };
