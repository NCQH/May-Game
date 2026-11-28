/* Wukong (tank 10000036): empowered sweep, reactive shield, vanish slam.
 * Port of server/wukong_actions.py onto the JS battle core.
 *
 * Stubs: presentation only. `_stop_packets` keeps the native S1554 ordering.
 */
import { TankActions } from '../arena.js';
import { D } from '../math.js';
import { scene, stop_move, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, inCone, packII, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 310100, 1: 310201, 2: 310301, 10: 310401 };

export class WukongActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = this.vanish = null;
  }

  _cooldown(slot, changed = false) {
    const skill = slot === 0 && this.hasBuff(310111, this.clock()) ? 310121 : SLOTS[slot];
    const info = { skillId: skill, slot, count: -1, end: this.cooldowns[slot], nextCharge: 0 };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) { return this._buff(310101, now).concat([this._cooldown(0, true)]); }

  _empower(now) {
    return this._buff(310111, now).concat(this._buff(310112, now), [this._cooldown(0, true)]);
  }

  _stop_packets(packets, position) {
    const attrs = packets.filter(p => p[0] === 1560);
    const stop = stop_move(this.sceneId, this.id, position);
    return packets.filter(p => p[0] !== 1560).concat([stop], attrs);
  }

  // The core calls camelCase removeBuff; keep the Python override there.
  removeBuff(template, now, { expired = false } = {}) {
    const packets = super.removeBuff(template, now, { expired });
    if (template === 310111) {
      packets.push(...this.removeBuff(310112, now), this._cooldown(0, true));
    }
    return packets;
  }

  _speed(now) { return this.ready || this.vanish ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready || this.vanish) || super.blocked(action, now); }

  reject_buff(row, source, now) { return Boolean(this.vanish && source.camp !== this.camp); }

  cc_immune(now, options = {}) { return Boolean(this.vanish) || super.ccImmune(now, options); }

  on_skill_damage(source, hit, now) {
    if (!this.alive || hit.potential_damage.le(0) || !this.hasBuff(310204, now)) return [];
    const packets = this.removeBuff(310204, now);
    for (const slot of [1, 10]) {
      this.cooldowns[slot] = now + Math.round(Math.max(0, this.cooldowns[slot] - now) * 0.75);
      packets.push(this._cooldown(slot));
    }
    return packets.concat(this.addShield(310223, this.maxHp.mul(D('.25')), now));
  }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      packets.push([1583, packII(this.id, this.ready.skill)]);
      this.ready = null;
    }
    if (!this.alive && this.vanish) {
      for (const ident of this.vanish.objects) packets.push(...this.removeObject(ident));
      this.vanish = null;
      delete this.info.untargetable;
      delete this.info.damage_immune;
    }
    return packets.concat(this.syncSpeed(now));
  }

  update(now) {
    const packets = this.ready && this.skillSealed(this.ready.slot, now) ? this.interrupt(now) : [];
    return packets.concat(super.update(now));
  }

  _event(now, kind, data) {
    if (kind === 'wukong_hit') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      const start = this.positionAt(now);
      const packets = [scene({ skills: [this._skillEvent(cast.skill, start, cast.dest)] })];
      for (const target of enemies(this, { area: true })) {
        const pos = target.positionAt(now);
        const inside = cast.slot === 0
          ? inCone(pos, start, cast.dest, 192, 180)
          : Math.hypot(start[0] - pos[0], start[1] - pos[1]) <= 216;
        if (inside) {
          packets.push(...this.damage(cast.power.mul(cast.slot === 0 ? D(2) : D('1.77')), now, {
            target, basic: cast.slot === 0,
            lifesteal: cast.slot === 0 ? D('.25') : 0,
          })[0]);
          packets.push(...this._buff(cast.slot === 0 ? 310122 : 310402, now, target.id));
          if (cast.slot === 0) packets.push(...this._buff(310123, now, target.id));
        }
      }
      if (cast.slot === 10) packets.push(...this._empower(now));
      return packets.concat(this.syncSpeed(now));
    }
    if (kind === 'wukong_land') {
      const [cast] = data;
      if (this.vanish !== cast || !this.alive) return [];
      this.vanish = null;
      delete this.info.untargetable;
      delete this.info.damage_immune;
      const packets = this.removeBuff(310302, now);
      for (const target of enemies(this, { area: true })) {
        if (Math.hypot(cast.dest[0] - target.positionAt(now)[0],
          cast.dest[1] - target.positionAt(now)[1]) <= 192) {
          packets.push(...this.damage(cast.power.mul(D('4.87')), now, { target })[0]);
          packets.push(...this._buff(310312, now, target.id));
        }
      }
      return packets.concat(this._empower(now), this.syncSpeed(now));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if ((slot === 0 || slot === 1 || slot === 2)
      && ((start[0] === dest[0] && start[1] === dest[1]) || !this._inside(dest))) return [];
    const cancelled_e = this.hasBuff(310211, now) && this.motion !== null;
    let packets = [];
    if (cancelled_e) {
      start = this.moveDestination(this.motion[0], this.positionAt(now));
      this.position = start;
      this.motion = null;
      this.forcedUntil = 0;
      packets.push(...this.removeBuff(310211, now));
    }
    const power = this.combatStat('iAttack', now);
    this.cooldowns[slot] = now + this.skillCooldown({
      0: this.fireInterval(now), 1: 6000, 2: 20000, 10: 8000,
    }[slot], slot);
    packets.push(this._cooldown(slot));
    if (slot === 0 && !this.hasBuff(310111, now)) {
      if (cancelled_e) packets = this._stop_packets(packets, start);
      return packets.concat(this.shoot(310100, start, dest, now, power,
        { school: 'physical', basic: true }));
    }
    if (slot === 0 || slot === 10) {
      const skill = slot === 0 ? 310121 : 310401;
      if (slot === 0) packets.push(...this.removeBuff(310111, now));
      const [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      const origin = stopped.length ? body : start;
      this.position = origin;
      this.motion = null;
      this.ready = { slot, skill, dest, power, generation: this.generation };
      this._queue(now + (slot === 0 ? 10 : 100), 'wukong_hit', this.ready);
      return this._stop_packets(packets.concat([
        scene({ skills: [this._skillEvent(skill, start, dest, 0, { ready: 1 })] }),
      ], this.syncSpeed(now)), origin);
    }
    if (slot === 1) {
      const intended = aimed(start, dest, 384, { fixed: true });
      const [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      const origin = stopped.length ? body : start;
      const duration = this._setMotion(origin, intended, 960, now, 3);
      this.forcedUntil = now + duration;
      const movement = scene({
        skills: [this._skillEvent(310201, start, this.motion[1])],
        moves: [this._moveEvent(this.motion[1], 960, 3)],
      });
      if (!stopped.length) packets.push(movement);
      for (const template of [310202, 310203, 310204, 310211]) {
        packets.push(...this._buff(template, now, null,
          { duration: template === 310211 ? duration : null }));
      }
      packets.push(...this._empower(now));
      return stopped.length ? packets.concat(stopped, [movement]) : packets;
    }
    dest = this.blinkDestination(start, aimed(start, dest, 264));
    this.position = dest;
    this.motion = null;
    this.vanish = { slot: 2, dest, power, generation: this.generation, objects: [] };
    this.info.untargetable = true;
    this.info.damage_immune = true;
    for (const [template, pos, life] of [[310302, start, 360], [310304, dest, 700],
      [310305, dest, 1350]]) {
      const [ident, packet] = this.addObject(template, pos);
      packets.push(packet);
      this.vanish.objects.push(ident);
      this._queue(now + life, 'object_expire', ident);
    }
    this._queue(now + 700, 'wukong_land', this.vanish);
    return this._stop_packets(packets.concat(this._buff(310302, now), this.syncSpeed(now)), dest);
  }
}

export { SLOTS as WUKONG_SLOTS };
