/* Lu Bu (tank 10000075): per-cast shields, bounded E recast and one reward
 * per basic volley. Port of server/lubu_actions.py.
 *
 * Stubs: no skin/presentation.
 */
import { TankActions } from '../arena.js';
import { D, actorContact } from '../math.js';
import { scene, stop_move, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, inCone, packII, piercingStep, prepareDisplacement } from './melee.js';
import { samePosition } from './batch-d-common.js';

const SLOTS = { 0: 349100, 1: 349201, 2: 349301, 10: 349401 };

export class LuBuActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = Number(this.stats.iMp);
    this.ready = null;
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
    const now = this.clock();
    const second = slot === 1 && this.hasBuff(349204, now);
    const enhanced = slot === 0 && this.hasBuff(349111, now);
    const skill = second ? 349211 : enhanced ? 349121 : SLOTS[slot];
    const info = {
      skillId: skill, slot, count: -1, end: second ? 0 : this.cooldowns[slot], nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.mp = Number(this.stats.iMp);
    this._queue(now + 5000, 'lubu_regen', this.generation);
    return this._buff(349101, now).concat([this._cooldown(0, true), this._cooldown(1, true)]);
  }

  _empower(now) {
    const packets = this.addShield(349112, this.maxHp.mul(D('.15')), now);
    for (const template of [349111, 349113, 349114]) {
      packets.push(...this._buff(template, now));
    }
    return packets.concat([this._cooldown(0, true)]);
  }

  removeBuff(template, now, { expired = false } = {}) {
    const packets = super.removeBuff(template, now, { expired });
    if (template === 349111) {
      packets.push(...this.removeBuff(349113, now), ...this.removeBuff(349114, now));
      packets.push(this._cooldown(0, true));
    }
    if (template === 349204) packets.push(this._cooldown(1, true));
    return packets;
  }

  // Core calls the camelCase removeBuff; keep Python's spelling as an alias.
  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  _stopPackets(packets, position) {
    const attrs = packets.filter(p => p[0] === 1560);
    const stop = stop_move(this.sceneId, this.id, position);
    return packets.filter(p => p[0] !== 1560 && p !== stop).concat([stop], attrs);
  }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  cc_immune(now, { slow = false } = {}) {
    return Boolean(this.ready && this.ready.slot === 2) || super.ccImmune(now, { slow });
  }

  reject_buff(row, source, now) {
    return Boolean(this.ready && this.ready.slot === 2 && source.camp !== this.camp);
  }

  interrupt(now) {
    if (!this.ready) return [];
    const cast = this.ready;
    this.ready = null;
    delete this.info.untargetable;
    delete this.info.damage_immune;
    const packets = cast.object ? this.removeObject(cast.object) : [];
    return packets.concat([[1583, packII(this.id, cast.skill)]], this.syncSpeed(now));
  }

  update(now) {
    const packets = this.ready && this.ready.slot !== 2 && this.skillSealed(1, now)
      ? this.interrupt(now) : [];
    return packets.concat(super.update(now));
  }

  _rHit(flight, target, now) {
    const packets = this.damage(flight.raw, now, { target })[0]
      .concat(this._buff(349402, now, target.id));
    return this.alive && this.generation === flight.source_generation
      ? packets.concat(this._resource(20)) : packets;
  }

  _flight(flight, now) {
    if (flight.template === 349401) {
      return piercingStep(this, flight, now, (f, t, n) => this._rHit(f, t, n));
    }
    if (![349100, 349121].includes(flight.template)) return super._flight(flight, now);
    const start = [
      flight.start[0] + (flight.end[0] - flight.start[0])
        * (flight.previous - flight.begin) / (flight.finish - flight.begin),
      flight.start[1] + (flight.end[1] - flight.start[1])
        * (flight.previous - flight.begin) / (flight.finish - flight.begin),
    ];
    const fraction = Math.min(1, (now - flight.begin) / (flight.finish - flight.begin));
    const end = [
      flight.start[0] + (flight.end[0] - flight.start[0]) * fraction,
      flight.start[1] + (flight.end[1] - flight.start[1]) * fraction,
    ];
    const contacts = [];
    for (const target of enemies(this)) {
      const hit = actorContact(start, end, target, flight.previous, now);
      if (hit !== null) contacts.push([hit, target.id, target]);
    }
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const contact = contacts.length ? contacts[0] : null;
    const wall = this.arena.geometry.wallContact(start, end);
    const packets = [];
    if (contact && (wall === null || contact[0] < wall)) {
      const target = contact[2];
      if (this.projectileBlocked(target, now)) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      const center = [
        start[0] + (end[0] - start[0]) * contact[0],
        start[1] + (end[1] - start[1]) * contact[0],
      ];
      let landed = false;
      const radius = flight.template === 349121 ? 120 : 96;
      for (const victim of enemies(this, { area: true })) {
        const pos = victim.positionAt(now);
        if (victim !== target && Math.hypot(center[0] - pos[0], center[1] - pos[1]) > radius) {
          continue;
        }
        const [result, lost] = this.damage(flight.raw, now, { target: victim, basic: true });
        packets.push(...result);
        landed = landed || lost;
      }
      if (this.alive && this.generation === flight.source_generation) {
        packets.push(...this._resource(flight.template === 349121 ? 15 : 5));
        if (landed && flight.template === 349121) {
          for (const slot of [1, 2, 10]) {
            this.cooldowns[slot] = Math.max(now, this.cooldowns[slot] - 1000);
            packets.push(this._cooldown(slot));
          }
        }
      }
      return packets.concat([scene({ blownBullets: [flight.id] })]);
    }
    if (wall !== null || now >= flight.finish) {
      return [scene(wall !== null ? { blownBullets: [flight.id] } : { expiredBullets: [flight.id] })];
    }
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return [];
  }

  _event(now, kind, data) {
    if (kind === 'lubu_regen') {
      if (!this.alive || this.generation !== data[0]) return [];
      this._queue(now + 5000, kind, ...data);
      return this._resource(10);
    }
    if (kind === 'lubu_arrive') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      delete this.info.untargetable;
      delete this.info.damage_immune;
      this.position = this.blinkDestination(cast.start, cast.dest);
      this.motion = null;
      const packets = [stop_move(this.sceneId, this.id, this.position)];
      if (cast.slot === 1) {
        packets.push(scene({ skills: [this._skillEvent(349201, cast.start, this.position)] }));
      } else {
        packets.push(...this.removeObject(cast.object, { destroyed: true }),
          ...this.removeBuff(349302, now));
      }
      let landed = false;
      const radius = cast.slot === 1 ? 168 : 192;
      const multiplier = cast.slot === 1 ? D('1.55') : D('3.88');
      const buffs = cast.slot === 1 ? [349205, 349203] : [349322, 349323];
      for (const target of enemies(this, { area: true })) {
        const pos = target.positionAt(now);
        if (Math.hypot(this.position[0] - pos[0], this.position[1] - pos[1]) <= radius) {
          const [result, lost] = this.damage(cast.power.mul(multiplier), now, { target });
          packets.push(...result);
          landed = landed || lost;
          for (const template of buffs) packets.push(...this._buff(template, now, target.id));
        }
      }
      if (cast.slot === 1 && landed) {
        packets.push(...this._buff(349204, now));
        packets.push(this._cooldown(1, true));
      }
      return packets.concat(this.syncSpeed(now));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    const second = slot === 1 && this.hasBuff(349204, now);
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || (!second && this.cooldowns[slot] > now)) return [];
    if (!this._inside(dest) || samePosition(start, dest)) return [];
    const cost = second ? 0 : { 0: 0, 1: 30, 2: 50, 10: 20 }[slot];
    if (this.mp < cost) return [];
    const power = this.combatStat('iAttack', now);
    if (!second) {
      this.cooldowns[slot] = now + this.skillCooldown(
        { 0: this.fireInterval(now), 1: 8000, 2: 25000, 10: 6000 }[slot], slot);
    }
    const packets = this._resource(-cost).concat([this._cooldown(slot)]);
    if (slot === 0) {
      const enhanced = this.hasBuff(349111, now);
      if (enhanced) packets.push(...this.removeBuff(349111, now));
      return packets.concat(this.shoot(enhanced ? 349121 : 349100, start, dest, now,
        power.mul(enhanced ? D(2) : D(1)), { school: 'physical', basic: true }));
    }
    packets.push(...this._empower(now));
    if (second) {
      packets.push(...this.removeBuff(349204, now));
      packets.push(scene({ skills: [this._skillEvent(349211, start, dest)] }));
      for (const target of enemies(this, { area: true })) {
        if (inCone(target.positionAt(now), start, dest, 168, 180)) {
          packets.push(...this.damage(power.mul(D('1.58')), now, { target })[0]);
          packets.push(...this.restoreHp(this.maxHp.sub(this.hp).mul(D('.15')), now));
        }
      }
      return packets;
    }
    if (slot === 10) {
      return packets.concat(this.shoot(349401, start, dest, now, power.mul(D('1.84')),
        { school: 'physical', through_walls: true }));
    }
    let origin = start, stopped = [];
    if (slot === 1) [origin, stopped] = prepareDisplacement(this, now, { interrupt: false });
    const body = stopped.length ? origin : start;
    this.position = body;
    this.motion = null;
    dest = this.blinkDestination(start, aimed(start, dest, slot === 1 ? 240 : 720));
    this.ready = {
      slot, skill: SLOTS[slot], start, dest, power, generation: this.generation,
    };
    if (slot === 2) {
      this.info.untargetable = true;
      this.info.damage_immune = true;
      const [ident, packet] = this.addObject(349311, dest);
      this.ready.object = ident;
      packets.push(packet);
      packets.push(...this._buff(349302, now));
    }
    this._queue(now + (slot === 1 ? 50 : 1000), 'lubu_arrive', this.ready);
    return this._stopPackets(packets.concat([
      scene({ skills: [this._skillEvent(SLOTS[slot], start, dest, 0, { ready: 1 })] }),
    ], this.syncSpeed(now)), body);
  }
}

export { SLOTS as LUBU_SLOTS };
