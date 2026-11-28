/* Saitama (tank 10000102): finite serious mode and a manually released charged
 * punch. Port of server/saitama_actions.py.
 *
 * Stubs: no skin/presentation; water reclip only honours an existing lineage.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, stop_move, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, inCone, packII, prepareDisplacement } from './melee.js';
import { acceptWaterReclip, samePosition } from './batch-d-common.js';

const SLOTS = { 0: 377100, 1: 377201, 2: 377301, 10: 377401 };
const CHARGE_BUFFS = [377321, 377322, 377323, 377324, 377325];

export class SaitamaActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = Number(this.stats.iMp);
    this.stacks = 0;
    this.received = D(0);
    this.proc_clocks = { false: { end: 0 }, true: { end: 0 } };
    this.ready = this.dash = this.serious = null;
  }

  _resource(delta) {
    if (this.noel_box) return [];
    const old = this.mp;
    this.mp = Math.max(0, Math.min(Number(this.stats.iMp), this.mp + delta));
    return old !== this.mp ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  _cooldown(slot, changed = false) {
    if (!(slot in SLOTS)) {
      return [1572, encodeS1572(this.id, {
        skillId: this.skillForSlot(slot) ?? 0, slot, count: -1,
        end: this.cooldowns[slot] ?? 0, nextCharge: 0,
      })];
    }
    const skill = slot === 2 && this.ready && this.ready.slot === 2 ? 377311 : SLOTS[slot];
    const info = {
      skillId: skill, slot, count: -1, end: skill === 377311 ? 0 : this.cooldowns[slot],
      nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.mp = Number(this.stats.iMp);
    this.stacks = 0;
    this.received = D(0);
    this.serious = this.dash = this.ready = null;
    this.proc_clocks = { false: { end: 0 }, true: { end: 0 } };
    this._queue(now + 3000, 'saitama_energy', this.generation);
    const packets = [];
    for (const template of [377101, 377102, 377103]) {
      packets.push(...this._buff(template, now));
    }
    return packets.concat([this._cooldown(2, true),
      scene({ mp: [{ objectId: this.id, mp: this.mp }] })]);
  }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready || this.dash) || super.blocked(action, now); }

  cc_immune(now, { slow = false } = {}) {
    return Boolean(this.serious || (this.ready && this.ready.slot === 2))
      || super.ccImmune(now, { slow });
  }

  _stack(count, now) {
    if (!this.alive || this.serious || count <= 0) return [];
    if (this.stacks && !this.hasBuff(377110 + this.stacks, now)) this.stacks = 0;
    const packets = [];
    for (let template = 377111; template < 377121; template += 1) {
      packets.push(...this.removeBuff(template, now));
    }
    this.stacks = Math.min(10, this.stacks + count);
    packets.push(...this._buff(377110 + this.stacks, now));
    if (this.stacks === 10) {
      this.serious = { end: now + 3000, generation: this.generation };
      for (const template of [377121, 377122, 377123, 377124, 377126, 377127, 377128]) {
        packets.push(...this._buff(template, now));
      }
      this._queue(now + 500, 'saitama_heal', this.serious, 1);
    }
    return packets;
  }

  damage(raw, now, options = {}) {
    const [packets, lost] = super.damage(raw, now, options);
    const flight = this.arena.currentFlight;
    const current = !flight || flight.source_generation === this.generation;
    const basic = options.basic ?? false;
    if (lost && current && this.alive) {
      if (basic) packets.push(...this._resource(5));
      const timer = this.proc_clocks[basic];
      if (now >= timer.end) {
        timer.end = now + (basic ? 150 : 500);
        packets.push(...(this.serious ? this._resource(10) : this._stack(1, now)));
      }
    }
    return [packets, lost];
  }

  on_damage(source, hit, now, school, reflected, attacker_ap) {
    if (!this.alive || hit.hp_loss.le(0)) return [];
    this.received = this.received.add(hit.hp_loss);
    const step = this.maxHp.mul(D('.05'));
    const count = this.received.div(step).floor();
    this.received = this.received.sub(step.mul(D(count)));
    return this._stack(count, now);
  }

  _clearCharge(now) {
    const packets = [];
    for (const template of CHARGE_BUFFS) packets.push(...this.removeBuff(template, now));
    return packets.concat([this._cooldown(2, true)], this.syncSpeed(now));
  }

  interrupt(now) {
    if (this.alive && this.ready && this.ready.slot === 2) return [];
    const packets = [];
    if (this.ready) {
      packets.push([1583, packII(this.id, this.ready.skill)]);
      this.ready = null;
      packets.push(...this._clearCharge(now));
    }
    if (this.dash) {
      this.dash = null;
      this.position = this.positionAt(now);
      this.motion = null;
      this.forcedUntil = now;
      packets.push(...this.removeBuff(377202, now));
    }
    if (!this.alive) {
      this.serious = null;
      this.stacks = 0;
      this.received = D(0);
    }
    return packets.concat(this.syncSpeed(now));
  }

  update(now) {
    const packets = this.ready && this.ready.slot !== 2
      && this.skillSealed(this.ready.slot, now) ? this.interrupt(now) : [];
    return packets.concat(super.update(now));
  }

  _push(target, direction, now) {
    if (!target.alive || target.ccImmune(now)) return [];
    const current = target.positionAt(now);
    const start = target.stopPosition(now);
    let dest = aimed(start, [start[0] + direction[0], start[1] + direction[1]], 360,
      { fixed: true });
    const wall = this.arena.geometry.wallContact(start, dest, 36);
    if (wall !== null) dest = pointAt(start, dest, Math.max(0, wall - 1e-4));
    const requested = dest;
    if (!samePosition(start, current)) { target.position = start; target.motion = null; }
    const packets = target.interrupt(now);
    if (!samePosition(start, current)) packets.push(stop_move(this.sceneId, target.id, start));
    const duration = target._setMotion(start, dest, 960, now, 1);
    target.forcedUntil = now + duration;
    const cast = {
      target: target.id, target_generation: target.generation,
      source_generation: this.generation, motion: target.motion, end: now + duration,
      wall: wall !== null
        || Math.hypot(requested[0] - target.motion[1][0],
          requested[1] - target.motion[1][1]) > 0.1,
    };
    this._queue(now + Math.min(20, duration), 'saitama_wall', cast);
    return packets.concat(this._buff(377303, now, target.id), [
      scene({ moves: [this._moveEvent(target.motion[1], 960, 1, target.id)] }),
    ]);
  }

  _release(cast, now) {
    if (this.ready !== cast || !this.alive) return [];
    this.ready = null;
    const fraction = Math.min(1, Math.max(0, (now - cast.begin) / 3000));
    const radius = 240 + 360 * fraction;
    const power = cast.power.mul(D('1.58')).mul(D(1).add(D(String(fraction))));
    const start = this.positionAt(now), dest = cast.dest;
    const packets = this._clearCharge(now).concat([
      [1583, packII(this.id, 377301)],
      scene({ skills: [this._skillEvent(377301, start, dest)] }),
    ]);
    for (const target of enemies(this, { area: true })) {
      if (inCone(target.positionAt(now), start, dest, radius, 60)) {
        packets.push(...this.damage(power, now, { target })[0]);
        if (this.arena.pk && this.arena.pk.finished) return packets;
        packets.push(...this._push(target, [dest[0] - start[0], dest[1] - start[1]], now));
      }
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'saitama_energy') {
      if (!this.alive || data[0] !== this.generation) return [];
      this._queue(now + 3000, kind, this.generation);
      return this._resource(10);
    }
    if (kind === 'saitama_heal') {
      const [cast, index] = data;
      if (this.serious !== cast || !this.alive) return [];
      const packets = this.restoreHp(this.maxHp.sub(this.hp).mul(D('.05')), now);
      if (index < 6) {
        this._queue(now + 500, kind, cast, index + 1);
      } else {
        this.serious = null;
        this.stacks = 0;
        for (let template = 377111; template < 377130; template += 1) {
          packets.push(...this.removeBuff(template, now));
        }
        packets.push(...this._buff(377141, now));
      }
      return packets;
    }
    if (kind === 'saitama_wall') {
      const [cast] = data;
      const target = this.arena.actors.get(cast.target);
      if (!target || !target.alive || target.generation !== cast.target_generation) return [];
      if (target.motion !== cast.motion) {
        if (target.motion && target.motionKind === 1 && target.motion[3] <= cast.end
          && target.hasBuff(377303, now) && acceptWaterReclip(target, cast)) {
          cast.motion = target.motion;
          cast.end = target.motion[3];
          cast.wall = true;
        } else {
          return target.removeBuff(377303, now);
        }
      }
      if (now < cast.end) {
        this._queue(Math.min(now + 20, cast.end), kind, cast);
        return [];
      }
      const packets = target.removeBuff(377303, now);
      if (cast.wall) {
        const raw = target.maxHp.sub(target.hp).mul(D('.5'));
        const result = this.generation === cast.source_generation
          ? this.damage(raw, now, { target }) : super.damage(raw, now, { target });
        packets.push(...result[0]);
        packets.push(...this._buff(377332, now, target.id));
      }
      return packets;
    }
    if (kind === 'saitama_release') return this._release(data[0], now);
    if (kind === 'saitama_ready') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      const start = this.positionAt(now), dest = cast.dest;
      const packets = this.syncSpeed(now);
      if (cast.slot === 1) {
        const duration = this._setMotion(start, aimed(start, dest, 480, { fixed: true }),
          960, now, 3);
        this.forcedUntil = now + duration;
        this.dash = { end: now + duration, previous: now, power: cast.power };
        this._queue(now + Math.min(20, duration), 'saitama_dash', this.dash);
        return packets.concat(this._buff(377202, now, null, { duration }), [
          scene({ moves: [this._moveEvent(this.motion[1], 960, 3)] }),
        ]);
      }
      packets.push(scene({ skills: [this._skillEvent(377401, start, dest)] }));
      let count = 0;
      for (const target of enemies(this, { area: true })) {
        if (!inCone(target.positionAt(now), start, dest, 360, 60)) continue;
        const [more, lost] = this.damage(cast.power.mul(D('1.75')), now, { target });
        packets.push(...more);
        count += lost ? 1 : 0;
        if (this.arena.pk && this.arena.pk.finished) return packets;
        packets.push(...this._buff(377403, now, target.id));
        if (target.alive && !target.ccImmune(now)) {
          let origin, stopped;
          [origin, stopped] = prepareDisplacement(target, now);
          packets.push(...stopped);
          const end = aimed(origin, aimed(start, dest, 360), 120);
          target.forcedUntil = now + target._setMotion(origin, end, 720, now, 1);
          packets.push(scene({ moves: [this._moveEvent(target.motion[1], 720, 1, target.id)] }));
        }
      }
      return packets.concat(this._stack(Math.max(0, count - 1), now));
    }
    if (kind === 'saitama_dash') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive) return [];
      const start = this.positionAt(cast.previous), end = this.positionAt(now);
      const hits = [];
      for (const target of enemies(this)) {
        const hit = actorContact(start, end, target, cast.previous, now);
        if (hit !== null) hits.push([hit, target.id, target]);
      }
      let done = !this.motion || now >= this.motion[3] || now >= cast.end;
      const packets = [];
      if (hits.length) {
        hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const impact = pointAt(start, end, hits[0][0]).map(pyRound);
        // Keep impact damage separate from the safe 72px body landing.
        this.position = this.stopPosition(now, impact);
        this.motion = null;
        this.forcedUntil = now;
        done = true;
        packets.push(stop_move(this.sceneId, this.id, this.position));
        packets.push(scene({
          moves: [this._moveEvent(this.position, 0, 5)],
          skills: [this._skillEvent(377211, impact, impact)],
        }));
        for (const target of enemies(this, { area: true })) {
          const pos = target.positionAt(now);
          if (Math.hypot(impact[0] - pos[0], impact[1] - pos[1]) <= 144) {
            packets.push(...this.damage(cast.power.mul(D('2.25')), now, { target })[0]);
            packets.push(...this._buff(377212, now, target.id));
          }
        }
      }
      if (done) {
        this.dash = null;
        packets.push(...this.removeBuff(377202, now));
      } else {
        cast.previous = now;
        this._queue(Math.min(now + 20, cast.end), kind, cast);
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (this.ready && this.ready.slot === 2 && slot === 2 && this.alive) {
      return this._release(this.ready, now);
    }
    const cost = { 0: 0, 1: 15, 2: 60, 10: 25 }[slot] ?? 0;
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now || this.mp < cost || samePosition(start, dest)) return [];
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 6000, 2: 15000, 10: 8000 }[slot], slot);
    const packets = this._resource(-cost).concat([this._cooldown(slot)]);
    if (slot === 0) {
      return packets.concat(this.shoot(377100, start, dest, now,
        this.combatStat('iAttack', now), { school: 'physical', basic: true }));
    }
    const power = this.combatStat('iAttack', now);
    let body, handoff;
    [body, handoff] = prepareDisplacement(this, now, { interrupt: false });
    if (!handoff.length) body = start;
    this.position = body;
    this.motion = null;
    this.ready = {
      slot, skill: SLOTS[slot], begin: now, dest, power, generation: this.generation,
    };
    if (slot === 2) {
      for (const template of CHARGE_BUFFS) packets.push(...this._buff(template, now));
      packets.push(this._cooldown(2, true));
    }
    this._queue(now + { 1: 100, 2: 3000, 10: 300 }[slot],
      slot === 2 ? 'saitama_release' : 'saitama_ready', this.ready);
    return packets.concat([
      scene({ skills: [this._skillEvent(SLOTS[slot], start, dest, 0, { ready: 1 })] }),
    ], this.syncSpeed(now), handoff);
  }
}

export { SLOTS as SAITAMA_SLOTS, CHARGE_BUFFS as SAITAMA_CHARGE_BUFFS };
