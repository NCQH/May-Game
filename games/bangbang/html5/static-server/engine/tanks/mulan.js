/* Hoa Moc Lan / Mulan (tank 10000099): carried sweeps, persistent sword field
 * and charged rectangle. Port of server/mulan_actions.py.
 *
 * Stubs: no skin/presentation; team visibility uses batch-C's wall/range check
 * because the JS core has no fog model.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pyRound } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, inStrip, packII, piercingStep, prepareDisplacement } from './melee.js';
import { teamVisible } from './batch-c-common.js';
import { samePosition } from './batch-d-common.js';

const SLOTS = { 0: 374100, 1: 374201, 2: 374301, 10: 374401 };
const MARKS = [374111, 374112, 374113, 374114];
const E_BUFFS = [374204, 374205, 374206, 374207, 374211];
const CHARGE_BUFFS = [374311, 374312, 374313, 374314, 374315];

export class MulanActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = this.dash = null;
    this.fields = new Map();
    this.r_window = { end: 0 };
  }

  _cooldown(slot, changed = false) {
    if (!(slot in SLOTS)) {
      return [1572, encodeS1572(this.id, {
        skillId: this.skillForSlot(slot) ?? 0, slot, count: -1,
        end: this.cooldowns[slot] ?? 0, nextCharge: 0,
      })];
    }
    let skill = SLOTS[slot];
    if (slot === 2 && this.ready) skill = 374321;
    if (slot === 10 && this.r_window.end > this.clock()) skill = 374411;
    const info = {
      skillId: skill, slot, count: -1,
      end: skill === 374321 || skill === 374411 ? 0 : this.cooldowns[slot], nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.ready = this.dash = null;
    this.r_window = { end: 0 };
    return this._buff(374101, now).concat(this._buff(374102, now),
      [this._cooldown(2, true), this._cooldown(10, true)]);
  }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready || this.dash) || super.blocked(action, now); }

  cc_immune(now, { slow = false } = {}) {
    return Boolean(this.ready || this.dash) || this.hasBuff(374125, now)
      || this.hasBuff(374414, now) || super.ccImmune(now, { slow });
  }

  _mark(target, now) {
    if (!target.alive || target.rejectBuff({ nEffectType: '49' }, this, now)) return [];
    let count = 0;
    for (let index = 0; index < MARKS.length; index += 1) {
      if (target.hasBuff(MARKS[index], now) && target.buffSources.get(MARKS[index]) === this.id) {
        count = index + 1;
      }
    }
    const packets = [];
    for (const template of MARKS) packets.push(...target.removeBuff(template, now));
    if (count < 4) return packets.concat(this._buff(MARKS[count], now, target.id));
    packets.push(...this.damage(target.maxHp.mul(D('.08')), now, { target })[0]);
    packets.push(...this._buff(374122, now, target.id));
    for (const template of [374123, 374124]) {
      packets.push(...this._buff(template, now, target.id, { duration: 2000 }));
    }
    return packets.concat(this._buff(374125, now), this._buff(374126, now));
  }

  _hit(target, raw, generation, now, {
    basic = false, school = 'physical', periodic = false,
  } = {}) {
    const [packets, lost] = this.damage(raw, now, { target, basic, school, periodic });
    if (lost && this.alive && this.generation === generation) {
      packets.push(...this._mark(target, now));
    }
    return packets;
  }

  _flight(flight, now) {
    return piercingStep(this, flight, now,
      (f, t, n) => this._hit(t, f.raw, f.source_generation, n, { basic: true }),
      { pierce: false });
  }

  _endDash(now) {
    this.dash = null;
    this.position = this.positionAt(now);
    this.motion = null;
    this.forcedUntil = now;
    const packets = [];
    for (const template of [...E_BUFFS, 374431]) packets.push(...this.removeBuff(template, now));
    return packets;
  }

  _clearCharge(now) {
    const packets = [];
    for (const template of CHARGE_BUFFS) packets.push(...this.removeBuff(template, now));
    return packets.concat([this._cooldown(2, true)], this.syncSpeed(now));
  }

  interrupt(now) {
    if (this.alive) return [];
    this.ready = null;
    this.r_window = { end: 0 };
    return this._endDash(now).concat(this._clearCharge(now), [this._cooldown(10, true)]);
  }

  update(now) {
    const packets = [];
    if (this.r_window.end && now >= this.r_window.end) {
      this.r_window = { end: 0 };
      packets.push(this._cooldown(10, true));
    }
    return packets.concat(super.update(now));
  }

  _moveTarget(target, dest, speed, now) {
    if (!target.alive || target.ccImmune(now)) return [];
    let start, packets;
    [start, packets] = prepareDisplacement(target, now);
    target.forcedUntil = now + target._setMotion(start, dest, speed, now, 1);
    return packets.concat([scene({
      moves: [this._moveEvent(target.motion[1], speed, 1, target.id)],
    })]);
  }

  _swing(target, cast, index, now) {
    const key = `${target.id},${target.generation}`;
    if (cast.swing_hits[index].has(key)) return [];
    cast.swing_hits[index].add(key);
    const packets = this._hit(target,
      cast.power.mul([D('1.27'), D('1.59'), D('1.98')][index]), cast.generation, now);
    if (this.arena.pk && this.arena.pk.finished) return packets;
    packets.push(...this._buff(374213, now, target.id));
    if (index === 2) {
      packets.push(...this.damage(target.maxHp.mul(D('.03')), now,
        { target, school: 'true' })[0]);
      packets.push(...this._buff(374233, now, target.id));
    }
    return packets;
  }

  _release(cast, now) {
    if (this.ready !== cast || !this.alive) return [];
    this.ready = null;
    const fraction = Math.min(1, Math.max(0, (now - cast.begin) / 3000));
    const length = 120 + 360 * fraction;
    const start = this.positionAt(now), dest = cast.dest;
    const power = cast.power.mul(D('2.23')).mul(D(1).add(D(String(fraction))));
    const packets = this._clearCharge(now).concat([
      [1583, packII(this.id, 374301)],
      scene({ skills: [this._skillEvent(374301, start, dest)] }),
    ]);
    for (const target of enemies(this, { area: true })) {
      if (inStrip(target.positionAt(now), start, dest, length, 300)) {
        packets.push(...this._hit(target, power, this.generation, now));
        if (this.arena.pk && this.arena.pk.finished) return packets;
        packets.push(...this._buff(374213, now, target.id));
        const origin = target.positionAt(now);
        const dx = dest[0] - start[0], dy = dest[1] - start[1];
        packets.push(...this._moveTarget(target,
          aimed(origin, [origin[0] + dx, origin[1] + dy], 120, { fixed: true }), 360, now));
      }
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'mulan_release') return this._release(data[0], now);
    if (kind === 'mulan_swing') {
      const [cast, index] = data;
      if (this.dash !== cast || !this.alive) return [];
      const packets = this._buff(index === 1 ? 374222 : 374232, now);
      for (const target of enemies(this, { area: true })) {
        const pos = target.positionAt(now);
        if (Math.hypot(this.positionAt(now)[0] - pos[0],
          this.positionAt(now)[1] - pos[1]) <= 144) {
          packets.push(...this._swing(target, cast, index, now));
          if (this.arena.pk && this.arena.pk.finished) {
            return packets.concat(this._endDash(now));
          }
          packets.push(...this._moveTarget(target,
            this.motion ? this.motion[1] : this.positionAt(now), 240, now));
        }
      }
      return packets;
    }
    if (kind === 'mulan_dash') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive) return [];
      const start = this.positionAt(cast.previous), end = this.positionAt(now);
      const packets = [];
      for (const target of enemies(this)) {
        const key = `${target.id},${target.generation}`;
        if (cast.hits.has(key)
          || actorContact(start, end, target, cast.previous, now) === null) continue;
        cast.hits.add(key);
        if (cast.slot === 1) {
          packets.push(...this._swing(target, cast, 0, now));
          if (this.arena.pk && this.arena.pk.finished) return packets.concat(this._endDash(now));
          packets.push(...this._moveTarget(target,
            this.motion ? this.motion[1] : end, 240, now));
        } else {
          packets.push(...this._hit(target, cast.power.mul(D('1.62')), cast.generation, now));
          if (this.arena.pk && this.arena.pk.finished) return packets.concat(this._endDash(now));
          const origin = target.positionAt(now);
          const [dx, dy] = cast.direction;
          const dest = aimed(origin, [origin[0] + dx, origin[1] + dy],
            target.id === cast.target ? 360 : 180, { fixed: true });
          packets.push(...this._moveTarget(target, dest, 600, now));
          packets.push(...this._buff(374434, now, target.id),
            ...this._buff(374435, now, target.id));
        }
      }
      // The three swings keep their schedule even when travel is clipped.
      let done = cast.slot === 1 ? now >= cast.end
        : !this.motion || now >= this.motion[3] || now >= cast.end;
      if (done && cast.slot === 10 && !cast.second) {
        cast.second = true;
        const [dx, dy] = cast.direction;
        const duration = this._setMotion(end,
          aimed(end, [end[0] + dx, end[1] + dy], 168, { fixed: true }), 720, now, 3);
        cast.end = now + duration;
        this.forcedUntil = cast.end;
        done = false;
        packets.push(scene({ moves: [this._moveEvent(this.motion[1], 720, 3)] }));
      }
      if (done) {
        packets.push(...this._endDash(now));
      } else {
        cast.previous = now;
        this._queue(Math.min(now + 20, cast.end), kind, cast);
      }
      return packets;
    }
    if (kind === 'mulan_sword_land') {
      const [field] = data;
      if (this.fields.get(field.id) !== field) return [];
      this.fields.delete(field.id);
      const packets = this.removeObject(field.id, { destroyed: true });
      const [ident, packet] = this.addObject(374402, field.pos.map(pyRound));
      field.id = ident;
      field.end = now + 4000;
      field.next_stack_at = now + 1000;
      this.fields.set(ident, field);
      packets.push(packet);
      let hit = false;
      for (const target of enemies(this, { area: true })) {
        const pos = target.positionAt(now);
        if (Math.hypot(field.pos[0] - pos[0], field.pos[1] - pos[1]) <= 144) {
          hit = true;
          packets.push(...this._hit(target, field.power.mul(D('1.34')), field.generation, now));
          packets.push(...this._buff(374404, now, target.id, { duration: 2000 }),
            ...this._buff(374405, now, target.id));
        }
      }
      if (hit && this.alive && this.generation === field.generation) {
        this.r_window = { end: now + 2000 };
        packets.push(...this._buff(374406, now));
        packets.push(this._cooldown(10, true));
      }
      this._queue(now + 250, 'mulan_field', field);
      return packets;
    }
    if (kind === 'mulan_field') {
      const [field] = data;
      if (this.fields.get(field.id) !== field) return [];
      const damageTick = now >= field.next_stack_at;
      const packets = [];
      if (damageTick) field.next_stack_at += 1000;
      for (const target of enemies(this, { area: true })) {
        const pos = target.positionAt(now);
        if (Math.hypot(field.pos[0] - pos[0], field.pos[1] - pos[1]) <= 144) {
          if (damageTick) {
            packets.push(...this._hit(target, field.power.mul(D('.67')), field.generation, now,
              { periodic: true }));
          }
          if (now < field.end) {
            const count = target.hasBuff(374422, now)
              && target.buffSources.get(374422) === this.id
              ? (target.buffStacks.get(374422) ?? 0) : 0;
            packets.push(...this._buff(374422, now, target.id, {
              stacks: Math.min(5, Math.max(1, count + (damageTick ? 1 : 0))),
              duration: Math.min(550, field.end - now),
            }));
          }
        }
      }
      if (now >= field.end) {
        this.fields.delete(field.id);
        packets.push(...this.removeObject(field.id, { destroyed: true }));
      } else {
        this._queue(Math.min(now + 250, field.end), kind, field);
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (this.ready && slot === 2 && this.alive) return this._release(this.ready, now);
    const second = slot === 10 && this.r_window.end > now;
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || (!second && this.cooldowns[slot] > now)) return [];
    if ([0, 1, 2].includes(slot) && samePosition(start, dest)) return [];
    if (slot === 10 && !second && (!this._inside(dest)
      || Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 480)) return [];
    let target = null;
    if (second) {
      const candidates = [...enemies(this)].filter(t => Math.hypot(start[0] - t.positionAt(now)[0],
        start[1] - t.positionAt(now)[1]) <= 600
        && t.hasBuff(374405, now) && t.buffSources.get(374405) === this.id
        && teamVisible(this, t, now));
      if (!candidates.length) return [];
      candidates.sort((a, b) => (a.hp.cmp(b.hp)) || (a.id - b.id));
      target = candidates[0];
      dest = target.positionAt(now);
    }
    const power = this.combatStat('iAttack', now);
    const packets = [];
    if (!second) {
      this.cooldowns[slot] = now + this.skillCooldown(
        { 0: this.fireInterval(now), 1: 8000, 2: 20000, 10: 6000 }[slot], slot);
    }
    if (slot === 0) {
      return this.shoot(374100, start, dest, now, power,
        { school: 'physical', basic: true }).concat([this._cooldown(0)]);
    }
    if (slot === 2) {
      let body, handoff;
      [body, handoff] = prepareDisplacement(this, now, { interrupt: false });
      if (!handoff.length) body = start;
      this.position = body;
      this.motion = null;
      this.ready = {
        slot: 2, skill: 374301, begin: now, dest, power, generation: this.generation,
      };
      for (const template of CHARGE_BUFFS) packets.push(...this._buff(template, now));
      this._queue(now + 3000, 'mulan_release', this.ready);
      return packets.concat([this._cooldown(2, true),
        scene({ skills: [this._skillEvent(374301, start, dest, 0, { ready: 1 })] })],
      this.syncSpeed(now), handoff);
    }
    if (slot === 10 && !second) {
      const [ident, packet] = this.addObject(374401, dest.map(pyRound));
      const field = { id: ident, pos: dest, power, generation: this.generation };
      this.fields.set(ident, field);
      this._queue(now + 500, 'mulan_sword_land', field);
      return [packet, this._cooldown(10)];
    }
    const direction = [dest[0] - start[0], dest[1] - start[1]];
    const speed = slot === 1 ? 240 : 720;
    const end = slot === 1 ? aimed(start, dest, 360, { fixed: true }) : dest;
    const duration = this._setMotion(start, end, speed, now, 3);
    this.forcedUntil = now + duration;
    this.dash = {
      slot, end: now + duration, previous: now, hits: new Set(),
      swing_hits: [new Set(), new Set(), new Set()], power, generation: this.generation,
      direction, target: target ? target.id : 0, second: false,
    };
    if (slot === 1) {
      this.dash.end = now + 1500;
      packets.push(...this._buff(374203, now));
      for (const template of E_BUFFS) {
        packets.push(...this._buff(template, now, null, { duration: 1500 }));
      }
      for (const index of [1, 2]) {
        this._queue(now + 650 * index, 'mulan_swing', this.dash, index);
      }
    } else {
      this.r_window = { end: 0 };
      packets.push(...this.removeBuff(374406, now));
      packets.push(this._cooldown(10, true));
      for (const template of [374412, 374413, 374414, 374431]) {
        packets.push(...this._buff(template, now, null, { duration: 2000 }));
      }
    }
    this._queue(now + Math.min(20, duration), 'mulan_dash', this.dash);
    return packets.concat([
      scene({ moves: [this._moveEvent(this.motion[1], speed, 3)] }), this._cooldown(slot),
    ]);
  }
}

export { SLOTS as MULAN_SLOTS, MARKS as MULAN_MARKS };
