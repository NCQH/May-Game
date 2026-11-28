/* Time Hunter (tank 10000050): absolute rewind, wormhole detonation, pulses.
 * Port of server/timehunter_actions.py onto the JS battle core.
 *
 * Stubs: skin presentation only. Wormhole objects are written through the
 * shared objectPacket helper (the core has no raw ObjInfo writer).
 */
import { TankActions } from '../arena.js';
import { D, pointAt } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { packII, prepareDisplacement } from './melee.js';
import { objectPacket } from './batch-c-common.js';

const SLOTS = { 0: 325100, 1: 325201, 2: 325601, 10: 325501 };

export class TimeHunterActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.rewind = this.worm = this.ready = this.channel = null;
    this.passive_ready_at = 0;
  }

  _cooldown(slot, changed = false) {
    const warp = slot === 10 && this.worm && !this.worm.used && this.hasBuff(325502, this.clock());
    const info = {
      skillId: warp ? 325701 : SLOTS[slot], slot, count: -1,
      end: warp ? this.worm.begin + 300 : this.cooldowns[slot], nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    return this._buff(325401, now).concat([this._cooldown(10, true)]);
  }

  _speed(now) { return this.ready || this.channel ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready || this.channel) || super.blocked(action, now); }

  reject_buff(row, source, now) {
    if (!this.rewind || now >= this.rewind.begin + 2000 || source.camp === this.camp) return false;
    // Synthetic callers pass a plain { nEffectType } dict; real buffs pass TableRow.
    const effect = row.nEffectType ?? row.get?.('nEffectType');
    const bits = Number(row.fEffectValB ?? row.get?.('fEffectValB', 31) ?? 31);
    return effect === '35' || (effect === '66' && (bits & 30) !== 0);
  }

  _silenced(now) {
    for (const [key, [, end]] of this.activeBuffs) {
      const [owner, template] = key.split(',').map(Number);
      if (owner !== this.id || end <= now || this.buffSources.get(template) === this.id) continue;
      const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
      const effect = row.get('nEffectType');
      const bits = Number(row.get('fEffectValB', 0));
      if ((effect === '35' || effect === '66') && (!bits || (bits & 30))) return true;
    }
    return false;
  }

  _end_rewind(now) {
    const cast = this.rewind;
    this.rewind = null;
    if (!cast) return [];
    const packets = this.removeObject(cast.id);
    for (const t of [325201, 325202, 325211, 325212, 325213]) packets.push(...this.removeBuff(t, now));
    return packets;
  }

  interrupt(now) {
    const cast = this.channel || this.ready;
    this.channel = this.ready = null;
    const packets = [];
    if (cast) {
      const skill = cast.skill ?? 325601;
      packets.push([1583, packII(this.id, skill)]);
      if (skill === 325601) {
        packets.push(...this.removeObject(cast.id));
        for (const t of [325611, 325612, 325613, 325605]) packets.push(...this.removeBuff(t, now));
        packets.push(...this._buff(325621, now));
        for (const target of this.arena.actors.values()) {
          if (target.buffSources.get(325607) !== this.id) continue;
          const pull = cast.pulls?.[target.id];
          if (target.hasBuff(325607, now) && target.motionKind === 1 && pull
            && target.generation === pull.generation && target.motion === pull.motion) {
            target.position = target.positionAt(now);
            target.motion = null;
            target.forcedUntil = now;
            packets.push(scene({ moves: [target._moveEvent(target.position, 0, 5)] }));
          }
          for (const t of [325601, 325603, 325604, 325607]) {
            if (target.buffSources.get(t) === this.id) packets.push(...target.removeBuff(t, now));
          }
        }
      }
    }
    if (!this.alive) packets.push(...this._end_rewind(now));
    return packets.concat(this.syncSpeed(now));
  }

  update(now) {
    const packets = [];
    if (this.rewind && now >= this.rewind.begin + 2000 && this._silenced(now)) {
      packets.push(...this._end_rewind(now));
    }
    if ((this.ready || this.channel) && this._silenced(now)) packets.push(...this.interrupt(now));
    return packets.concat(super.update(now));
  }

  on_basic_damage(source, hit, now) {
    if (!this.alive || now < this.passive_ready_at) return [];
    this.passive_ready_at = now + 1000;
    const packets = this._buff(325412, now);
    const pos = this.positionAt(now), power = this.combatStat('iEgAtk', now);
    for (const target of [...this.arena.actors.values()]) {
      if (target.alive && target.camp !== this.camp
        && Math.hypot(pos[0] - target.positionAt(now)[0], pos[1] - target.positionAt(now)[1]) <= 192) {
        packets.push(...this.damage(power.mul(D('1.5')), now, { target, school: 'energy' })[0]);
        packets.push(...this._buff(325413, now, target.id));
      }
    }
    return packets;
  }

  _pulse(cast, index, now) {
    const pos = this.positionAt(now);
    const packets = this._buff(325605, now).concat(this._buff(325613, now));
    for (const target of [...this.arena.actors.values()]) {
      const span = Math.hypot(pos[0] - target.positionAt(now)[0], pos[1] - target.positionAt(now)[1]);
      if (!target.alive || target.camp === this.camp || span > 264) continue;
      if (index) {
        const raw = cast.power.mul(D('1.26').sub(D('.63').mul(D(String(span)).div(D(264)))));
        packets.push(...this.damage(raw, now, { target, school: 'energy', periodic: true })[0]);
        if (this.arena.pk && this.arena.pk.finished) return packets;
      }
      if (!target.alive || target.ccImmune(now) || index === 10) continue;
      for (const t of [325601, 325603, 325604, 325607]) {
        packets.push(...this._buff(t, now, target.id, { duration: 300 }));
      }
      if (span > 72) {
        const [start, stopped] = prepareDisplacement(target, now);
        packets.push(...stopped);
        const remaining = Math.hypot(start[0] - pos[0], start[1] - pos[1]);
        const dest = pointAt(start, pos,
          Math.min(27, Math.max(0, remaining - 72)) / Math.max(1, remaining));
        const duration = target._setMotion(start, dest, 90, now, 1);
        target.forcedUntil = now + duration;
        cast.pulls = cast.pulls || {};
        cast.pulls[target.id] = { motion: target.motion, generation: target.generation };
        packets.push(scene({ moves: [target._moveEvent(target.motion[1], 90, 1)] }));
      }
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'time_rewind_phase' || kind === 'time_rewind') {
      const [cast] = data;
      if (this.rewind !== cast || !this.alive) return [];
      if (this._silenced(now)) return this._end_rewind(now);
      if (kind === 'time_rewind_phase') return this._buff(325213, now);
      this.position = this.blinkDestination(this.positionAt(now), cast.pos);
      this.motion = null;
      this.forcedUntil = now;
      const packets = super.commitHp(cast.hp.min(this.maxHp), now);
      return packets.concat([scene({ moves: [this._moveEvent(this.position, 0, 5)] })],
        this._end_rewind(now));
    }
    if (kind === 'time_worm_form') {
      const [cast] = data;
      const buffs = [325511, 325512].map(t => ({
        templateId: t, instanceId: this._newId(6), stackCount: 1, casterId: this.id,
      }));
      const [ident, packet] = objectPacket(this, 325511, cast.pos,
        { hp: 1, maxHp: 1, ownerId: this.id, buffs });
      cast.npc = ident;
      return this.removeObject(cast.warning).concat([packet]);
    }
    if (kind === 'time_worm_slot') {
      const [cast] = data;
      if (this.worm !== cast) return [];
      cast.used = true;
      return this.removeBuff(325502, now).concat([this._cooldown(10, true), this._cooldown(10)]);
    }
    if (kind === 'time_worm_end') {
      const [cast] = data;
      const packets = this.removeObject(cast.id);
      if (cast.npc !== null) packets.push(...this.removeObject(cast.npc, { destroyed: true }));
      if (this.worm === cast) this.worm = null;
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(cast.pos[0] - target.positionAt(now)[0],
            cast.pos[1] - target.positionAt(now)[1]) <= 192) {
          packets.push(...this.damage(cast.power.mul(D('3.24')), now, { target, school: 'energy' })[0]);
          packets.push(...this._buff(325522, now, target.id));
        }
      }
      return packets;
    }
    if (kind === 'time_warp') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this._silenced(now)) {
        return this.ready === cast ? this.interrupt(now) : [];
      }
      this.ready = null;
      const start = this.positionAt(now);
      this.position = this.blinkDestination(start, cast.dest);
      this.motion = null;
      this.forcedUntil = now;
      return [scene({
        skills: [this._skillEvent(325701, start, this.position)],
        moves: [this._moveEvent(this.position, 0, 5)],
      })].concat(this.syncSpeed(now));
    }
    if (kind === 'time_channel') {
      const [cast, index] = data;
      if ((this.ready || this.channel) !== cast || !this.alive) return [];
      if (this._silenced(now) || this.buffTypes(now).has(30)) return this.interrupt(now);
      this.ready = null;
      this.channel = cast;
      const packets = index === 0
        ? [scene({ skills: [this._skillEvent(325601, this.positionAt(now), this.positionAt(now), this.id)] })]
        : [];
      packets.push(...this._pulse(cast, index, now));
      if (index === 10) return packets.concat(this.interrupt(now));
      this._queue(now + 300, kind, cast, index + 1);
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)) return [];
    const warp = slot === 10 && this.worm && !this.worm.used && this.hasBuff(325502, now);
    if (!warp && this.cooldowns[slot] > now) return [];
    if (slot === 0 && (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1]))) return [];
    if (slot === 10) {
      const distance = warp
        ? Math.hypot(start[0] - this.worm.pos[0], start[1] - this.worm.pos[1]) : 0;
      if (warp ? distance > 600
        : !this._inside(dest) || Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 480) return [];
    }
    const power = this.combatStat('iEgAtk', now);
    if (warp) {
      const cast = { slot: 10, skill: 325701, dest: this.worm.pos };
      this.ready = cast;
      this.worm.used = true;
      this._queue(now + 50, 'time_warp', cast);
      return this.removeBuff(325502, now).concat([this._cooldown(10, true), this._cooldown(10),
        scene({ skills: [this._skillEvent(325701, start, cast.dest, 0, { ready: 1 })] })],
      this.syncSpeed(now));
    }
    this.cooldowns[slot] = now + this.skillCooldown({
      0: this.fireInterval(now), 1: 8000, 2: 30000, 10: 8000,
    }[slot], slot);
    if (slot === 0) {
      return this.shoot(325100, start, dest, now, power,
        { school: 'energy', basic: true }).concat([this._cooldown(0)]);
    }
    const packets = [scene({ skills: [this._skillEvent(SLOTS[slot], start, dest, 0,
      { ready: slot === 2 ? 1 : 0 })] })];
    if (slot === 1) {
      const [ident, packet] = this.addObject(325221, start);
      this.rewind = { id: ident, pos: start, hp: this.hp, begin: now };
      this._queue(now + 2000, 'time_rewind_phase', this.rewind);
      this._queue(now + 3500, 'time_rewind', this.rewind);
      for (const t of [325201, 325202, 325211, 325212]) packets.push(...this._buff(t, now));
      packets.push(packet);
    } else if (slot === 10) {
      const [warning, packet] = this.addObject(325501, dest);
      const [ident, timer] = this.addObject(325504, dest);
      this.worm = {
        id: ident, warning, npc: null, pos: dest, power, begin: now, used: false,
      };
      this._queue(now + 300, 'time_worm_form', this.worm);
      this._queue(now + 3500, 'time_worm_slot', this.worm);
      this._queue(now + 3800, 'time_worm_end', this.worm);
      packets.push(packet, timer);
      packets.push(...this._buff(325502, now), ...this._buff(325503, now));
      packets.push(this._cooldown(10, true));
    } else {
      const [ident, packet] = this.addObject(325614, start);
      this.ready = { id: ident, slot: 2, skill: 325601, dest: start, power };
      this._queue(now + 200, 'time_channel', this.ready, 0);
      this.position = start;
      this.motion = null;
      for (const t of [325611, 325612, 325613]) packets.push(...this._buff(t, now, null, { duration: 3200 }));
      packets.push(packet);
    }
    return packets.concat([this._cooldown(slot)], this.syncSpeed(now));
  }
}

export { SLOTS as TIMEHUNTER_SLOTS };
