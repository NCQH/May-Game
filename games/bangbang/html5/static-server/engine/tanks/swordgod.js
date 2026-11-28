/* Sword God (tank 10000081): movement energy, cast snapshots and delayed
 * E-mark consumption. Port of server/swordgod_actions.py.
 *
 * Stubs: no skin/presentation.
 */
import { TankActions } from '../arena.js';
import { D, pyRound } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';
import { aimed, enemies, piercingStep, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 355100, 1: 355201, 2: 355301, 10: 355401 };

export class SwordGodActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = 0;
    this.e_count = 3;
    this.e_next_charge = 0;
    this.ready = null;
    this.nearby = false;
    this.walk = {
      pos: this.position, previous: this.clock(), end: this.clock() + 2000,
      next_stack_at: 0, distance: 0,
    };
  }

  _cooldown(slot) {
    if (!(slot in SLOTS)) {
      return [1572, encodeS1572(this.id, {
        skillId: this.skillForSlot(slot) ?? 0, slot, count: -1,
        end: this.cooldowns[slot] ?? 0, nextCharge: 0,
      })];
    }
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: slot === 1 ? this.e_count : -1,
      end: this.cooldowns[slot], nextCharge: slot === 1 ? this.e_next_charge : 0,
    })];
  }

  _resource(delta, now = null) {
    if (this.noel_box) return [];
    now = now === null ? this.clock() : now;
    const old = this.mp;
    this.mp = Math.max(0, Math.min(100, this.mp + delta));
    if (delta > 0) this.walk.end = now + 2000;
    return old !== this.mp ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  on_spawn(now) {
    this.mp = 0;
    this.ready = null;
    this.nearby = false;
    this.walk = {
      pos: this.position, previous: now, end: now + 2000, next_stack_at: 0, distance: 0,
    };
    this._queue(now, 'sword_aura', this.generation);
    return [scene({ mp: [{ objectId: this.id, mp: 0 }] })];
  }

  _speed(now) {
    // Q37: enemy present, speed only; no obsolete +25% AP.
    return super._speed(now)
      + (this.nearby && !this.buffTypes(now).has(36)
        ? pyRound(Number(this.stats.iSpeed) * 0.25) : 0);
  }

  cleanse(now) {
    const packets = super.cleanse(now);
    for (const key of [...this.activeBuffs.keys()]) {
      const [owner, template] = key.split(',').map(Number);
      const source = this.arena.actors.get(this.buffSources.get(template));
      if (owner === this.id && source && source.camp !== this.camp) {
        const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
        if ([30, 35, 36, 39, 62, 66].includes(Number(row.nEffectType))) {
          packets.push(...this.removeBuff(template, now));
        }
      }
    }
    return packets;
  }

  interrupt(now) {
    this.ready = null;
    return [];
  }

  update(now) {
    const packets = [];
    while (this.e_next_charge && this.e_next_charge <= now) {
      this.e_count = Math.min(3, this.e_count + 1);
      this.e_next_charge = this.e_count < 3
        ? this.e_next_charge + this.skillCooldown(6000) : 0;
      packets.push(this._cooldown(1));
    }
    const pos = this.positionAt(now), walk = this.walk;
    // Only the actual kind-0 walking path contributes.
    let distance = 0;
    if (this.alive && this.motion && this.motionKind === 0) {
      const [a, b, began, end] = this.motion;
      const start = Math.max(began, walk.previous);
      const finish = Math.min(now, end);
      if (finish > start) {
        distance = Math.hypot(a[0] - b[0], a[1] - b[1]) * (finish - start) / (end - began);
      }
    }
    if (distance) {
      walk.distance += distance;
      walk.end = now + 2000;
      if (walk.distance >= 120 && now >= walk.next_stack_at) {
        walk.distance -= 120;
        walk.next_stack_at = now + 1000;
        packets.push(...this._resource(5, now));
      }
    } else if (this.alive && now >= walk.end) {
      walk.distance = 0;
      packets.push(...this._resource(-100, now));
    }
    walk.pos = pos;
    walk.previous = now;
    return packets.concat(super.update(now));
  }

  _blade(flight, target, now) {
    const cast = flight.context;
    const distance = Math.min(840, Math.hypot(flight.start[0] - target.positionAt(now)[0],
      flight.start[1] - target.positionAt(now)[1]));
    const [packets, lost] = this.damage(
      cast.power.mul(D(1).add(D(String(distance)).div(D(840)))), now,
      { target, ignore_armor: true });
    if (this.arena.pk && this.arena.pk.finished) return packets;
    if (!target.info.npc_template) packets.push(...this._buff(355202, now, target.id));
    if (lost && this.alive && this.generation === flight.source_generation) {
      const previousVersion = this.buffVersions.get(355204);
      packets.push(...this._buff(355204, now));
      const version = this.buffVersions.get(355204);
      if (version !== previousVersion && this.hasBuff(355204, now)
        && this.buffSources.get(355204) === this.id) {
        this._queue(now + 300, 'sword_refund', this.generation, version, 0);
      }
    }
    return packets;
  }

  _flight(flight, now) {
    if (flight.template === 355201) {
      return piercingStep(this, flight, now, (f, t, n) => this._blade(f, t, n),
        { pierce: false });
    }
    return super._flight(flight, now);
  }

  _event(now, kind, data) {
    if (kind === 'sword_aura') {
      if (!this.alive || data[0] !== this.generation) return [];
      this.nearby = [...enemies(this)].some(actor =>
        Math.hypot(this.positionAt(now)[0] - actor.positionAt(now)[0],
          this.positionAt(now)[1] - actor.positionAt(now)[1]) <= 360);
      this._queue(now + 1000, kind, ...data);
      return this.syncSpeed(now);
    }
    if (kind === 'sword_refund') {
      const [generation, version, index] = data;
      if (!this.alive || this.generation !== generation
        || this.buffVersions.get(355204) !== version) return [];
      if (index < 4) this._queue(now + 300, kind, generation, version, index + 1);
      return this._resource(5, now);
    }
    if (kind === 'sword_fire') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      return this.shoot(355201, this.positionAt(now), cast.dest, now, D(0), {
        school: 'physical', through_walls: true,
        speed_multiplier: cast.speed, context: cast,
      });
    }
    if (kind === 'sword_space') {
      const [cast] = data;
      const target = this.arena.actors.get(cast.target);
      if (!target || !target.alive || target.generation !== cast.target_generation
        || target.buffVersions.get(355301) !== cast.version) return [];
      const marked = target.hasBuff(355202, now)
        && target.buffSources.get(355202) === this.id;
      const missing = target.maxHp.sub(target.hp);
      const packets = target.removeBuff(355301, now);
      if (marked) packets.push(...target.removeBuff(355202, now));
      packets.push(...this.damage(cast.power.mul(marked ? D(3) : D(1)), now, { target })[0]);
      packets.push(...this.damage(missing.mul(D('.15')), now, { target, school: 'true' })[0]);
      packets.push(...this._buff(355305, now, target.id));
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || !this.alive
      || (slot !== 10 && (this.blocked('attack', now) || this.skillSealed(slot, now)))
      || this.cooldowns[slot] > now) return [];
    if (((slot === 0 || slot === 1) && start[0] === dest[0] && start[1] === dest[1])
      || (slot === 1 && (!this.e_count || this.ready))) return [];
    const energy = this.mp;
    const power = this.combatStat('iAttack', now)
      .mul(D(1).add(D('.25').mul(D(energy)).div(D(100))));
    if (slot === 0) {
      this.cooldowns[0] = now + this.fireInterval(now);
      return this.shoot(355100, start, dest, now, power,
        { school: 'physical', basic: true }).concat([this._cooldown(0)]);
    }
    if (slot === 1) {
      this.e_count -= 1;
      if (!this.e_next_charge) this.e_next_charge = now + this.skillCooldown(6000);
      this.cooldowns[1] = now + this.skillCooldown(2000, 1);
      this.ready = {
        slot: 1, dest,
        power: this.combatStat('iAttack', now)
          .mul(D(1).add(D('.5').mul(D(energy)).div(D(100)))),
        speed: 1 + 0.5 * energy / 100,
      };
      this._queue(now + 50, 'sword_fire', this.ready);
      return this._resource(-100, now).concat(this._buff(355211, now), [this._cooldown(1)]);
    }
    this.cooldowns[slot] = now + this.skillCooldown(slot === 2 ? 25000 : 10000, slot);
    const packets = [this._cooldown(slot)];
    if (slot === 2) {
      for (const target of enemies(this, { area: true })) {
        if (target.info.npc_template
          || Math.hypot(start[0] - target.positionAt(now)[0],
            start[1] - target.positionAt(now)[1]) > 1200
          || target.hasBuff(355301, now)) continue;
        packets.push(...this._buff(355301, now, target.id));
        if (!target.hasBuff(355301, now)
          || target.buffSources.get(355301) !== this.id) continue;
        const cast = {
          target: target.id, target_generation: target.generation, power,
          version: target.buffVersions.get(355301),
        };
        this._queue(now + 1500, 'sword_space', cast);
      }
      return packets;
    }
    packets.push(...this.cleanse(now), ...this._resource(50, now), ...this._buff(355403, now));
    packets.push(scene({ skills: [this._skillEvent(355401, start, start)] }));
    for (const target of enemies(this, { area: true })) {
      const origin = target.positionAt(now);
      if (Math.hypot(start[0] - origin[0], start[1] - origin[1]) > 196) continue;
      packets.push(...this.damage(power, now, { target })[0]);
      if (this.arena.pk && this.arena.pk.finished) return packets;
      packets.push(...this._buff(355406, now, target.id));
      if (target.alive && !target.ccImmune(now)) {
        let originStop, stopped;
        [originStop, stopped] = prepareDisplacement(target, now);
        packets.push(...stopped);
        const angle = originStop[0] === start[0] && originStop[1] === start[1]
          ? [start[0] + 1, start[1]] : originStop;
        const end = aimed(start, angle,
          Math.hypot(start[0] - originStop[0], start[1] - originStop[1]) + 240,
          { fixed: true });
        const duration = target._setMotion(originStop, end, 720, now, 1);
        target.forcedUntil = now + duration;
        packets.push(scene({ moves: [target._moveEvent(target.motion[1], 720, 1)] }));
      }
    }
    return packets;
  }
}

export { SLOTS as SWORDGOD_SLOTS };
