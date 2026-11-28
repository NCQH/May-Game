/* Sniper (tank 10000101): stationary aiming, persistent mines and three finite
 * special shots. Port of server/sniper_actions.py.
 *
 * Stubs: no skin/presentation; water reclip only honours an existing lineage.
 */
import { TankActions, friendly } from '../arena.js';
import { D, actorContact, pointAt, rectContact, pyRound } from '../math.js';
import { scene, stop_move, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, inStrip, packII, piercingStep } from './melee.js';
import { acceptWaterReclip, samePosition } from './batch-d-common.js';

const SLOTS = { 0: 376100, 1: 376201, 2: 376301, 10: 376401 };
const SHOTS = [376310, 376320, 376330];

export class SniperActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = this.special = null;
    this.traps = new Map();
    this.aim_state = {
      begin: this.clock(), next_stack_at: this.clock() + 2000, pos: this.position, count: 0,
    };
    this.combat_timer = { end: 0 };
  }

  _cooldown(slot, changed = false) {
    if (!(slot in SLOTS)) {
      return [1572, encodeS1572(this.id, {
        skillId: this.skillForSlot(slot) ?? 0, slot, count: -1,
        end: this.cooldowns[slot] ?? 0, nextCharge: 0,
      })];
    }
    let skill = SLOTS[slot];
    if (slot === 0) {
      skill = this.special ? SHOTS[this.special.index]
        : this.hasBuff(376142, this.clock()) ? 376151 : 376100;
    }
    const info = {
      skillId: skill, slot, count: -1,
      end: slot === 2 && this.special ? 0 : this.cooldowns[slot], nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.ready = this.special = null;
    this.aim_state = { begin: now, next_stack_at: now + 2000, pos: this.position, count: 0 };
    this.combat_timer = { end: 0 };
    const packets = [];
    for (let template = 376101; template < 376108; template += 1) {
      packets.push(...this._buff(template, now));
    }
    return packets.concat(this._conceal(now), [this._cooldown(0, true)]);
  }

  _visibility(now) {
    this.info.untargetable = this.hasBuff(376111, now) && !this.buffTypes(now).has(32);
  }

  _conceal(now) {
    let packets = [];
    if (!this.hasBuff(376111, now)) {
      packets = this._buff(376111, now).concat(this._buff(376112, now));
    }
    this._visibility(now);
    return packets;
  }

  _activity(now) {
    this.combat_timer.end = now + 2000;
    const packets = this.removeBuff(376111, now).concat(this.removeBuff(376112, now),
      this._buff(376121, now));
    this._visibility(now);
    return packets;
  }

  on_damage(source, hit, now, school, reflected, attacker_ap) {
    return this.alive && hit.hp_loss.gt(0) ? this._activity(now) : [];
  }

  _resetAim(now) {
    const changed = this.hasBuff(376142, now);
    this.aim_state = {
      begin: now, next_stack_at: now + 2000, pos: this.positionAt(now), count: 0,
    };
    const packets = this.removeBuff(376142, now).concat(this.removeBuff(376141, now));
    return changed ? packets.concat([this._cooldown(0, true)]) : packets;
  }

  update(now) {
    if (!this.alive) return super.update(now);
    const packets = [];
    let state = this.aim_state;
    const pos = this.positionAt(now);
    if (!samePosition(pos, state.pos) || (this.motion && now < this.motion[3])) {
      packets.push(...this._resetAim(now));
      state = this.aim_state;
    } else {
      if (now >= state.begin + 1500 && !this.special && !this.hasBuff(376142, now)) {
        packets.push(...this._buff(376142, now));
        packets.push(this._cooldown(0, true));
      }
      if (now >= state.next_stack_at) {
        const count = 1 + Math.floor((now - state.next_stack_at) / 500);
        state.next_stack_at += 500 * count;
        state.count = Math.min(10, state.count + count);
        packets.push(...this._buff(376141, now, null, { stacks: state.count }));
      }
    }
    if (this.special || now < this.combat_timer.end) {
      if (this.hasBuff(376111, now)) {
        packets.push(...this.removeBuff(376111, now), ...this.removeBuff(376112, now));
      }
    } else {
      packets.push(...this._conceal(now));
    }
    this._visibility(now);
    if (this.ready) {
      const slot = this.ready.slot;
      const mask = { 0: 1, 10: 8 }[slot];
      for (const [key, [, end]] of this.activeBuffs) {
        const [owner, template] = key.split(',').map(Number);
        if (owner !== this.id || end <= now || [376305, 376313].includes(template)) continue;
        const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
        const effect = Number(row.nEffectType);
        const bits = Number(row.get('fEffectValB', 0));
        if ((effect === 66 || (effect === 35 && slot !== 0))
          && (bits === 0 || (bits & mask))) {
          packets.push(...this.interrupt(now));
          break;
        }
      }
    }
    return packets.concat(super.update(now));
  }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  _endSpecial(now) {
    if (!this.special) return [];
    this.special = null;
    this.cooldowns[2] = now + this.skillCooldown(15000, 2);
    const packets = [];
    for (let template = 376301; template <= 376306; template += 1) {
      packets.push(...this.removeBuff(template, now));
    }
    return packets.concat([this._cooldown(0, true), this._cooldown(2)]);
  }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      packets.push([1583, packII(this.id, this.ready.skill)]);
      this.ready = null;
    }
    if (!this.alive) {
      packets.push(...this._endSpecial(now));
      this.info.untargetable = false;
    }
    return packets.concat(this.syncSpeed(now));
  }

  _markHit(target, raw, power, now) {
    const marked = target.hasBuff(376410, now)
      && target.buffSources.get(376410) === this.id;
    let [packets, lost] = this.damage(raw, now, { target });
    if (marked) {
      packets.push(...target.removeBuff(376410, now));
      const [extra, hit] = this.damage(power, now, { target, school: 'true' });
      packets.push(...extra);
      lost = lost || hit;
      packets.push(...this._buff(376412, now, target.id));
    }
    packets.push(...this._buff(376410, now, target.id));
    return [packets, lost];
  }

  _push(target, flight, now) {
    if (!target.alive || target.ccImmune(now)) return [];
    const current = target.positionAt(now);
    const start = target.stopPosition(now);
    const dx = flight.end[0] - flight.start[0], dy = flight.end[1] - flight.start[1];
    let dest = aimed(start, [start[0] + dx, start[1] + dy], 240, { fixed: true });
    const wall = this.arena.geometry.wallContact(start, dest, 36);
    if (wall !== null) dest = pointAt(start, dest, Math.max(0, wall - 1e-4));
    const requested = dest;
    if (!samePosition(start, current)) { target.position = start; target.motion = null; }
    const packets = target.interrupt(now);
    if (!samePosition(start, current)) packets.push(stop_move(target.sceneId, target.id, start));
    const duration = target._setMotion(start, dest, 720, now, 1);
    target.forcedUntil = now + duration;
    const cast = {
      target: target.id, target_generation: target.generation, end: now + duration,
      motion: target.motion,
      wall: wall !== null
        || Math.hypot(requested[0] - target.motion[1][0],
          requested[1] - target.motion[1][1]) > 0.1,
    };
    this._queue(now + Math.min(20, duration), 'sniper_wall', cast);
    return packets.concat(this._buff(376202, now, target.id), [
      scene({ moves: [this._moveEvent(target.motion[1], 720, 1, target.id)] }),
    ]);
  }

  _bulletHit(flight, target, now) {
    const template = flight.template;
    const current = this.alive && this.generation === flight.source_generation;
    if (flight.basic) {
      let [packets, lost] = this.damage(flight.raw, now, { target, basic: true });
      if (template === 376151) {
        packets.push(...this._buff(376321, now, target.id));
        if (lost && current) {
          this.cooldowns[2] = now + pyRound(Math.max(0, this.cooldowns[2] - now) * 0.85);
          packets.push(this._cooldown(2));
        }
      }
      return packets;
    }
    if (template === 376201) {
      const packets = this._push(target, flight, now);
      const [more, lost] = this._markHit(target, flight.raw, flight.power, now);
      packets.push(...more);
      if (lost && current && !flight.context.aimed) packets.push(...this._buff(376203, now));
      return packets;
    }
    const targets = template === 376310 ? [target]
      : [...enemies(this, { area: true })].filter(t => {
        const a = t.positionAt(now), b = target.positionAt(now);
        return Math.hypot(a[0] - b[0], a[1] - b[1]) <= 120;
      });
    const packets = [];
    for (const victim of targets) {
      packets.push(...this._markHit(victim, flight.raw, flight.power, now)[0]);
      const buffs = template === 376310 ? [376311, 376312, 376421] : [376321, 376421];
      for (const buff of buffs) packets.push(...this._buff(buff, now, victim.id));
    }
    return packets;
  }

  _flight(flight, now) {
    return piercingStep(this, flight, now, (f, t, n) => this._bulletHit(f, t, n),
      { pierce: false });
  }

  clearHiddenTraps(center, radius) {
    const packets = [];
    for (const [ident, trap] of [...this.traps]) {
      if (!trap.triggered && Math.hypot(center[0] - trap.pos[0],
        center[1] - trap.pos[1]) <= radius) {
        this.traps.delete(ident);
        packets.push(...this.removeObject(ident));
      }
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'sniper_wall') {
      const [cast] = data;
      const target = this.arena.actors.get(cast.target);
      if (!target || !target.alive || target.generation !== cast.target_generation) return [];
      if (target.motion !== cast.motion) {
        if (target.motion && target.motionKind === 1 && target.motion[3] <= cast.end
          && target.hasBuff(376202, now) && acceptWaterReclip(target, cast)) {
          cast.motion = target.motion;
          cast.end = target.motion[3];
          cast.wall = true;
        } else {
          return target.removeBuff(376202, now);
        }
      }
      if (now < cast.end) {
        this._queue(Math.min(now + 20, cast.end), kind, cast);
        return [];
      }
      return target.removeBuff(376202, now).concat(
        cast.wall ? this._buff(376210, now, target.id) : []);
    }
    if (kind === 'sniper_special_end') {
      return this.special === data[0] ? this._endSpecial(now) : [];
    }
    if (kind === 'sniper_ready') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      const packets = this.syncSpeed(now);
      if (cast.slot === 10) {
        const [ident, packet] = this.addObject(376401, cast.start.map(pyRound));
        const trap = {
          id: ident, pos: cast.start, power: cast.power, generation: this.generation,
          previous: now, end: now + 15000,
        };
        this.traps.set(ident, trap);
        this._queue(now + 20, 'sniper_trap', trap);
        return packets.concat(friendly(this, packet));
      }
      const skill = cast.skill, start = this.positionAt(now), dest = cast.dest;
      if (skill === 376330) {
        let end = aimed(start, dest, 960, { fixed: true });
        const wall = rectContact(start, end, this.arena.waterRects(now));
        if (wall !== null) end = pointAt(start, end, Math.max(0, wall - 1e-4));
        packets.push(scene({ skills: [this._skillEvent(skill, start, end)] }));
        for (const target of enemies(this, { area: true })) {
          if (inStrip(target.positionAt(now), start, end,
            Math.hypot(start[0] - end[0], start[1] - end[1]), 48)) {
            packets.push(...this._markHit(target, cast.power.mul(D('3.5')), cast.power, now)[0]);
            packets.push(...this._buff(376312, now, target.id),
              ...this._buff(376421, now, target.id));
          }
        }
      } else {
        packets.push(...this.shoot(skill, start, dest, now,
          cast.power.mul(skill === 376310 ? D('2.5') : D(3)),
          { school: 'physical', power: cast.power, through_walls: true }));
      }
      return packets;
    }
    if (kind === 'sniper_trap') {
      const [trap] = data;
      if (this.traps.get(trap.id) !== trap) return [];
      if (now >= trap.end) {
        this.traps.delete(trap.id);
        return this.removeObject(trap.id);
      }
      const hit = [...enemies(this)].some(target => actorContact(
        trap.pos, trap.pos, target, trap.previous, now, 96) !== null);
      if (hit) {
        this.traps.delete(trap.id);
        const packets = this.removeObject(trap.id);
        const [ident, packet] = this.addObject(376402, trap.pos.map(pyRound));
        trap.id = ident;
        trap.end = now + 1000;
        trap.triggered = true;
        this.traps.set(ident, trap);
        this._queue(now + 1000, 'sniper_blast', trap);
        for (const target of enemies(this, { area: true })) {
          const pos = target.positionAt(now);
          if (Math.hypot(pos[0] - trap.pos[0], pos[1] - trap.pos[1]) <= 120) {
            packets.push(...this._buff(376404, now, target.id));
          }
        }
        return packets.concat([packet]);
      }
      trap.previous = now;
      this._queue(Math.min(now + 20, trap.end), kind, trap);
      return [];
    }
    if (kind === 'sniper_blast') {
      const [trap] = data;
      if (this.traps.get(trap.id) !== trap) return [];
      this.traps.delete(trap.id);
      const packets = this.removeObject(trap.id, { destroyed: true });
      for (const target of enemies(this, { area: true })) {
        const pos = target.positionAt(now);
        if (Math.hypot(pos[0] - trap.pos[0], pos[1] - trap.pos[1]) <= 120) {
          packets.push(...this._markHit(target, trap.power.mul(D('2.05')), trap.power, now)[0]);
        }
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if ((slot === 0 || slot === 1) && samePosition(start, dest)) return [];
    const packets = this._activity(now);
    const power = this.combatStat('iAttack', now);
    if (slot === 0 && this.special) {
      const index = this.special.index;
      const skill = SHOTS[index];
      this.cooldowns[0] = now + 1250;
      this.ready = { slot: 0, skill, start, dest, power };
      this._queue(now + (index === 2 ? 100 : 50), 'sniper_ready', this.ready);
      packets.push(scene({ skills: [this._skillEvent(skill, start, dest, 0, { ready: 1 })] }));
      packets.push(...this._buff(376313, now));
      packets.push(...this.removeBuff(376301 + index, now));
      if (index === 2) {
        packets.push(...this._endSpecial(now));
      } else {
        this.special.index += 1;
        packets.push(...this._buff(376302 + index, now));
        if (index === 1) this._queue(now + 3000, 'sniper_special_end', this.special);
        packets.push(this._cooldown(0, true));
      }
    } else if (slot === 0) {
      const isAimed = this.hasBuff(376142, now);
      this.cooldowns[0] = now + this.fireInterval(now);
      packets.push(...this.shoot(isAimed ? 376151 : 376100, start, dest, now,
        power.mul(isAimed ? D(2) : D(1)), { school: 'physical', basic: true }));
      if (isAimed) {
        packets.push(...this.removeBuff(376142, now), ...this._buff(376143, now));
        this.aim_state.begin = now;
        packets.push(this._cooldown(0, true));
      }
    } else if (slot === 1) {
      this.cooldowns[1] = now + this.skillCooldown(6000, 1);
      packets.push(...this.shoot(376201, start, dest, now, power.mul(D('1.75')),
        {
          school: 'physical', power, through_walls: true,
          context: { aimed: this.hasBuff(376142, now) || Boolean(this.special) },
        }));
    } else if (slot === 2) {
      if (this.special) return [];
      this.special = { index: 0 };
      packets.push(...this.removeBuff(376142, now));
      for (const template of [376301, 376304, 376305, 376306]) {
        packets.push(...this._buff(template, now));
      }
      packets.push(this._cooldown(0, true));
    } else {
      this.cooldowns[10] = now + this.skillCooldown(8000, 10);
      this.position = start;
      this.motion = null;
      this.ready = { slot: 10, skill: 376401, start, dest: start, power };
      this._queue(now + 100, 'sniper_ready', this.ready);
      packets.push(scene({ skills: [this._skillEvent(376401, start, start, 0, { ready: 1 })] }));
    }
    return packets.concat([this._cooldown(slot)], this.syncSpeed(now));
  }
}

export { SLOTS as SNIPER_SLOTS, SHOTS as SNIPER_SHOTS };
