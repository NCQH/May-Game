/* Hulk (tank 10000034): rage heal, missing-health bonus, leap.
 * Port of server/hulk_actions.py onto the JS battle core.
 *
 * Stubs: presentation only.
 */
import { TankActions } from '../arena.js';
import { D, ONE, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';
import { packII, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 308100, 1: 308501, 2: 308601, 10: 308401 };

export class HulkActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = this.jump = null;
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot], nextCharge: 0,
    })];
  }

  on_spawn(now) {
    this._queue(now + 3000, 'hulk_regen', this.generation);
    return this._buff(308101, now).concat(this._buff(308102, now));
  }

  attr_bonus(attributes, now) {
    let value = super.attrBonus(attributes, now);
    if (attributes.includes(21) && this.hasBuff(308102, now)) {
      value = value.add(D('.5').mul(ONE.sub(this.hp.div(this.maxHp))));
    }
    return value;
  }

  _speed(now) { return this.ready || this.jump ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready || this.jump) || super.blocked(action, now); }

  interrupt(now) {
    if (!this.ready && !this.jump) return [];
    const cast = this.ready || this.jump;
    this.ready = this.jump = null;
    this.position = this.positionAt(now);
    this.motion = null;
    this.forcedUntil = now;
    const packets = [[1583, packII(this.id, 308501)]];
    packets.push(...this.removeObject(cast.warning));
    packets.push(...this.removeBuff(308502, now));
    return packets.concat([scene({ moves: [this._moveEvent(this.position, 0, 5)] })], this.syncSpeed(now));
  }

  update(now) {
    const packets = this.ready && this.skillSealed(1, now) ? this.interrupt(now) : [];
    return packets.concat(super.update(now));
  }

  on_basic_damage(source, hit, now) {
    if (!this.alive || !this.hasBuff(308601, now)) return [];
    const packets = this.restoreHp(this.maxHp.sub(this.hp).mul(D('.03')), now);
    for (const slot of [1, 10]) {
      this.cooldowns[slot] = now + Math.round(Math.max(0, this.cooldowns[slot] - now) * 0.9);
      packets.push(this._cooldown(slot));
    }
    return packets.concat(this._buff(308631, now), this._buff(308641, now));
  }

  _event(now, kind, data) {
    if (kind === 'hulk_regen') {
      if (!this.alive || this.generation !== data[0]) return [];
      this._queue(now + 3000, kind, ...data);
      return this.restoreHp(this.maxHp.mul(D('.06')), now);
    }
    if (kind === 'hulk_rage_heal') {
      const [generation, version] = data;
      if (!this.alive || this.generation !== generation || this.buffVersions.get(308601) !== version) {
        return [];
      }
      return this.restoreHp(this.maxHp.mul(D('.03')), now);
    }
    if (kind === 'hulk_jump') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      this.jump = cast;
      const start = this.positionAt(now);
      const dest = this.moveDestination(start, cast.dest);
      const speed = Math.max(1, pyRound(Math.hypot(dest[0] - start[0], dest[1] - start[1]) * 2));
      const duration = this._setMotion(start, dest, speed, now, 4);
      this.forcedUntil = now + duration;
      this._queue(now + duration, 'hulk_land', cast);
      return [scene({
        skills: [this._skillEvent(308501, start, this.motion[1])],
        moves: [this._moveEvent(this.motion[1], speed, 4)],
      })].concat(this._buff(308502, now, null, { duration }));
    }
    if (kind === 'hulk_land') {
      const [cast] = data;
      if (this.jump !== cast || !this.alive) return [];
      const pos = this.positionAt(now);
      this.jump = null;
      this.position = pos;
      this.motion = null;
      this.forcedUntil = now;
      const packets = this.removeObject(cast.warning);
      const [ident, packet] = this.addObject(308522, pos);
      packets.push(packet);
      this._queue(now + 416, 'object_expire', ident);
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(pos[0] - target.positionAt(now)[0], pos[1] - target.positionAt(now)[1]) <= 168) {
          packets.push(...this.damage(cast.power.mul(D('1.55')), now, { target })[0]);
          packets.push(...this._buff(308512, now, target.id));
        }
      }
      return packets.concat(this.removeBuff(308502, now), this.syncSpeed(now));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if ((slot === 0 || slot === 1)
      && (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1]))) return [];
    const power = this.combatStat('iAttack', now);
    this.cooldowns[slot] = now + this.skillCooldown({
      0: this.fireInterval(now), 1: 10000, 2: 25000, 10: 6000,
    }[slot], slot);
    if (slot === 0) {
      return this.shoot(308100, start, dest, now, power,
        { school: 'physical', basic: true }).concat([this._cooldown(0)]);
    }
    const packets = [this._cooldown(slot)];
    if (slot === 1) {
      const span = Math.hypot(dest[0] - start[0], dest[1] - start[1]);
      dest = this.moveDestination(start, pointAt(start, dest, Math.min(1, 408 / span)));
      const [ident, packet] = this.addObject(308521, dest);
      const [body, handoff] = prepareDisplacement(this, now, { interrupt: false });
      this.position = handoff.length ? body : start;
      this.motion = null;
      this.ready = { slot: 1, dest, power, generation: this.generation, warning: ident };
      this._queue(now + 100, 'hulk_jump', this.ready);
      return packets.concat([packet,
        scene({ skills: [this._skillEvent(308501, start, dest, 0, { ready: 1 })] })],
      this.syncSpeed(now), handoff);
    }
    packets.push(scene({ skills: [this._skillEvent(SLOTS[slot], start, start, this.id)] }));
    if (slot === 2) {
      const version = (this.buffVersions.get(308601) ?? 0) + 1;
      for (let offset = 1000; offset <= 8000; offset += 1000) {
        this._queue(now + offset, 'hulk_rage_heal', this.generation, version);
      }
      for (const template of [308601, 308602, 308603, 308604]) packets.push(...this._buff(template, now));
    } else {
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(start[0] - target.positionAt(now)[0],
            start[1] - target.positionAt(now)[1]) <= 192) {
          packets.push(...this.damage(power.mul(D('1.63')), now, { target })[0]);
          packets.push(...this._buff(308402, now, target.id), ...this._buff(308403, now, target.id));
        }
      }
    }
    return packets;
  }
}

export { SLOTS as HULK_SLOTS };
