/* Fire God (tank 10000105): burn clock, lava trail, three melee stages.
 * Port of server/firegod_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. V1 total-damage bonus and the five-stack
 * confuse rider are kept; the geometric raw table is not guessed.
 */
import { TankActions } from '../arena.js';
import { D, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { packII, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 380100, 1: 380201, 2: 380301, 10: 380401 };
const BURNS = Array.from({ length: 5 }, (_, i) => 380121 + i);

export class FireGodActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.marks = new Map();
    this.ready = this.jump = this.trail = null;
  }

  _melee(now) {
    for (let i = 0; i < 3; i += 1) if (this.hasBuff(380402 + i, now)) return i;
    return null;
  }

  _cooldown(slot, changed = false) {
    const stage = slot === 0 ? this._melee(this.clock()) : null;
    const info = {
      skillId: stage !== null ? 380141 + stage : SLOTS[slot], slot, count: -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _basic_slot() { return [this._cooldown(0, true), this._cooldown(0)]; }

  on_spawn(now) {
    return this._buff(380101, now).concat(this._buff(380102, now), this._basic_slot());
  }

  removeBuff(template, now, { expired = false } = {}) {
    const existed = this.activeBuffs.has(`${this.id},${template}`);
    const packets = super.removeBuff(template, now, { expired });
    if (existed && [380402, 380403, 380404].includes(template)) packets.push(...this._basic_slot());
    return packets;
  }

  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  _valid(target, mark, now, final = false) {
    return this.marks.get(target.id) === mark && target.alive
      && target.generation === mark.target_generation
      && target.buffVersions.get(mark.template) === mark.version
      && (final ? now <= mark.end : now < mark.end)
      && (final || target.hasBuff(mark.template, now));
  }

  // Core damage reads burningCount for the Fire God bonus.
  burningCount(now) {
    if (!this.alive) return 0;
    let count = 0;
    for (const [ident, mark] of this.marks) {
      if (mark.source_generation === this.generation
        && this._valid(this.arena.actors.get(ident), mark, now)) count += 1;
    }
    return count;
  }

  attr_bonus(attributes, now) {
    let value = super.attr_bonus(attributes, now);
    // V1 defines total damage, not a second +EN bonus from the display buff.
    if (attributes.includes(5) && this.hasBuff(380146, now)) value = value.sub(D('.1'));
    return value;
  }

  _enemies(pos, radius, now) {
    return [...this.arena.actors.values()].filter(a => a.alive && a.camp !== this.camp
      && a.isAreaTargetable()
      && Math.hypot(pos[0] - a.positionAt(now)[0], pos[1] - a.positionAt(now)[1]) <= radius);
  }

  _burn(target, power, generation, now) {
    // A simultaneous Doraemon/Noel stasis must not turn this into a buff grant.
    if (!target.alive || target.inStasis() || (this.arena.pk && this.arena.pk.finished)
      || target.rejectBuff({ nEffectType: '201' }, this, now)) return [];
    const old = this.marks.get(target.id);
    const valid = old && old.source_generation === generation && this._valid(target, old, now);
    let stacks = valid ? old.stacks : 0;
    let next_stack = valid ? old.next_stack_at : 0;
    if (now >= next_stack) {
      stacks = Math.min(5, stacks + 1);
      next_stack = now + 100;
    }
    const packets = [];
    for (const template of BURNS) {
      if (target.hasBuff(template, now)) packets.push(...target.removeBuff(template, now));
    }
    const template = BURNS[stacks - 1];
    const previous_version = target.buffVersions.get(template);
    packets.push(...this._buff(template, now, target.id));
    const version = target.buffVersions.get(template);
    if (version === previous_version || !target.hasBuff(template, now)
      || target.buffSources.get(template) !== this.id) return packets;
    const mark = valid ? old : {};
    Object.assign(mark, {
      template, stacks, version, end: now + 3000, next_stack_at: next_stack, power,
      source_generation: generation, target_generation: target.generation,
    });
    this.marks.set(target.id, mark);
    if (!valid) this._queue(now + 1000, 'fire_dot', target.id, mark);
    if (stacks === 5 && !target.hasBuff(380126, now) && !target.hasBuff(380127, now)) {
      packets.push(...this._buff(380126, now, target.id));
      if (target.hasBuff(380126, now)) {
        this._queue(this.activeBuffs.get(`${target.id},380126`)[1], 'fire_confuse_end',
          target.id, target.generation, target.buffVersions.get(380126));
      }
    }
    if (this.alive && generation === this.generation) {
      packets.push(...this._buff(380146, now), ...this._buff(380147, now));
    }
    return packets;
  }

  _hit(target, raw, power, generation, now) {
    const [packets, lost] = this.damage(raw, now, { target, school: 'energy' });
    if (lost) packets.push(...this._burn(target, power, generation, now));
    return packets;
  }

  on_target_death(target, now) {
    const mark = this.marks.get(target.id);
    this.marks.delete(target.id);
    if (!mark || target.generation !== mark.target_generation || now > mark.end
      || target.buffVersions.get(mark.template) !== mark.version) return [];
    const pos = target.positionAt(now);
    const [ident, packet] = this.addObject(380160 + mark.stacks, pos);
    this._queue(now + 300, 'fire_death_blast', pos, mark, ident);
    return [packet];
  }

  _speed(now) { return this.ready || this.jump ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready || this.jump) || super.blocked(action, now); }

  update(now) {
    const packets = this.ready && this.skillSealed(1, now) ? this.interrupt(now) : [];
    return packets.concat(super.update(now));
  }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      this.ready = null;
      packets.push([1583, packII(this.id, 380201)]);
    }
    if (this.jump) {
      this.jump = null;
      this.position = this.positionAt(now);
      this.motion = null;
      this.forcedUntil = now;
      packets.push(scene({ moves: [this._moveEvent(this.position, 0, 5)] }));
    }
    if (!this.alive) this.trail = null;
    return packets.concat(this.syncSpeed(now));
  }

  _object(template, pos, lifetime, now) {
    const [ident, packet] = this.addObject(template, pos);
    this._queue(now + lifetime, 'object_expire', ident);
    return [packet];
  }

  _begin_trail(now, power) {
    this.trail = { end: now + 2000, previous: this.positionAt(now), power,
      generation: this.generation };
    this._queue(now + 300, 'fire_trail', this.trail);
    return this._buff(380111, now);
  }

  _radial(pos, maximum, cast, now, { space = false } = {}) {
    const packets = [];
    for (const target of this._enemies(pos, 192, now)) {
      const d = D(String(Math.hypot(pos[0] - target.positionAt(now)[0],
        pos[1] - target.positionAt(now)[1])));
      packets.push(...this._hit(target, cast.power.mul(maximum).mul(D(1).sub(d.div(D('384')))),
        cast.power, cast.generation, now));
      if (this.arena.pk && this.arena.pk.finished) return packets;
      if (space) {
        if (d.le(D('96'))) packets.push(...this._buff(380312, now, target.id));
      } else {
        packets.push(...this._buff(380212, now, target.id));
        if (target.hasBuff(380212, now)) {
          this._queue(this.activeBuffs.get(`${target.id},380212`)[1], 'fire_slow',
            target.id, target.generation, target.buffVersions.get(380212));
        }
      }
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'fire_dot') {
      const [ident, mark] = data;
      const target = this.arena.actors.get(ident);
      if (!this._valid(target, mark, now, true)) {
        if (this.marks.get(ident) === mark) this.marks.delete(ident);
        return [];
      }
      const packets = this.damage(mark.power.mul(D('.25')).mul(mark.stacks), now,
        { target, school: 'true', periodic: true })[0];
      if (this.arena.pk && this.arena.pk.finished) return packets;
      if (this.alive && mark.source_generation === this.generation && now < mark.end) {
        packets.push(...this._buff(380146, now), ...this._buff(380147, now));
      }
      if (this.marks.get(ident) === mark) {
        if (now < mark.end) this._queue(now + 1000, kind, ident, mark);
        else this.marks.delete(ident);
      }
      return packets;
    }
    if (kind === 'fire_confuse_end') {
      const [ident, generation, version] = data;
      const target = this.arena.actors.get(ident);
      return target.alive && target.generation === generation
        && target.buffVersions.get(380126) === version ? this._buff(380127, now, ident) : [];
    }
    if (kind === 'fire_death_blast') {
      const [pos, mark, ident] = data;
      const packets = this.removeObject(ident);
      for (const target of this._enemies(pos, 168, now)) {
        packets.push(...this.damage(mark.power.mul(D(1).add(D('.25').mul(mark.stacks - 1))),
          now, { target, school: 'true' })[0]);
      }
      return packets;
    }
    if (kind === 'fire_trail') {
      const [cast] = data;
      if (this.trail !== cast || !this.alive || this.generation !== cast.generation
        || now > cast.end) return [];
      const pos = this.positionAt(now);
      const packets = [];
      if (pos[0] !== cast.previous[0] || pos[1] !== cast.previous[1]) {
        const [ident, packet] = this.addObject(380144, pos);
        packets.push(packet);
        const area = { pos, power: cast.power, generation: cast.generation, id: ident,
          end: now + 6000 };
        this._queue(now + 1000, 'fire_lava', area);
        cast.previous = pos;
      }
      this._queue(now + 300, kind, cast);
      return packets;
    }
    if (kind === 'fire_lava') {
      const [cast] = data;
      const packets = [];
      for (const target of this._enemies(cast.pos, 72, now)) {
        packets.push(...this._burn(target, cast.power, cast.generation, now));
      }
      if (now < cast.end) this._queue(now + 1000, kind, cast);
      else packets.push(...this.removeObject(cast.id));
      return packets;
    }
    if (kind === 'fire_takeoff') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.generation !== cast.generation) return [];
      if (this.skillSealed(1, now)) return this.interrupt(now);
      this.ready = null;
      this.jump = cast;
      const start = this.positionAt(now);
      const dest = this.moveDestination(start, cast.dest);
      const speed = Math.max(1, Math.hypot(start[0] - dest[0], start[1] - dest[1]) * 2);
      const duration = this._setMotion(start, dest, speed, now, 4);
      this.forcedUntil = now + duration;
      this._queue(now + 550, 'fire_land', cast);
      return this._object(380202, dest, 200, now).concat(this._buff(380203, now),
        [scene({ moves: [this._moveEvent(this.motion[1], pyRound(speed), 4)] })]);
    }
    if (kind === 'fire_land') {
      const [cast] = data;
      if (this.jump !== cast || !this.alive || this.generation !== cast.generation) return [];
      const pos = this.positionAt(now);
      this.jump = null;
      this.position = pos;
      this.motion = null;
      this.forcedUntil = now;
      const packets = [scene({ skills: [this._skillEvent(380211, pos, pos, this.id)] })];
      packets.push(...this._radial(pos, D('2.29'), cast, now));
      if (this.arena.pk && this.arena.pk.finished) return packets;
      packets.push(...this._buff(380214, now, null, { duration: 2000 }),
        ...this._buff(380215, now, null, { duration: 2000 }));
      return packets.concat(this.syncSpeed(now));
    }
    if (kind === 'fire_slow') {
      const [ident, generation, version] = data;
      const target = this.arena.actors.get(ident);
      return target.alive && target.generation === generation
        && target.buffVersions.get(380212) === version
        ? this._buff(380213, now, ident, { duration: 1500 }) : [];
    }
    if (kind === 'fire_space') {
      const [cast] = data;
      if (!this.alive || this.generation !== cast.generation) return [];
      const pos = this.positionAt(now);
      return [scene({ skills: [this._skillEvent(380311, pos, pos, this.id)] })]
        .concat(this._radial(pos, D('7.25'), cast, now, { space: true }));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if ((slot === 0 || slot === 1) && (!this._inside(dest)
      || (start[0] === dest[0] && start[1] === dest[1]))) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 8000, 2: 20000, 10: 8000 }[slot], slot);
    const packets = slot ? [] : this._begin_trail(now, power);
    let handoff = [];
    if (slot === 0) {
      const stage = this._melee(now);
      if (stage === null) {
        return this.shoot(380100, start, dest, now, power,
          { school: 'energy', basic: true }).concat([this._cooldown(0)]);
      }
      packets.push(scene({ skills: [this._skillEvent(380141 + stage, start, dest)] }));
      const direction = [dest[0] - start[0], dest[1] - start[1]];
      let hit = false;
      for (const target of this._enemies(start, stage === 2 ? 216 : 192, now)) {
        const dx = target.positionAt(now)[0] - start[0], dy = target.positionAt(now)[1] - start[1];
        if (stage < 2 && dx * direction[0] + dy * direction[1] < 0) continue;
        const [more, lost] = this.damage(power.mul(D('1.5')), now,
          { target, school: 'energy', basic: true, lifesteal: D('.75') });
        packets.push(...more);
        hit = hit || lost;
      }
      packets.push(...this.removeBuff(380402 + stage, now));
      if (stage < 2) packets.push(...this._buff(380403 + stage, now));
      else packets.push(...this.removeBuff(380411, now));
      if (hit) {
        this.cooldowns[1] = now + pyRound(Math.max(0, this.cooldowns[1] - now) * 0.9);
        packets.push(this._cooldown(1));
      }
      packets.push(...this._basic_slot());
    } else if (slot === 1) {
      const span = Math.hypot(start[0] - dest[0], start[1] - dest[1]);
      dest = pointAt(start, dest, Math.min(1, 480 / span));
      let body;
      [body, handoff] = prepareDisplacement(this, now, { interrupt: false });
      if (!handoff.length) body = start;
      this.ready = { slot: 1, dest, power, generation: this.generation };
      this.position = body;
      this.motion = null;
      packets.push(...this._object(380221, start, 300, now));
      packets.push(scene({ skills: [this._skillEvent(380201, start, dest, 0, { ready: 1 })] }));
      this._queue(now + 300, 'fire_takeoff', this.ready);
      packets.push(...this.syncSpeed(now));
    } else if (slot === 2) {
      packets.push(...this._buff(380301, now), ...this._buff(380302, now));
      this._queue(now + 2000, 'fire_space', { power, generation: this.generation });
    } else {
      for (const template of [380402, 380403, 380404]) packets.push(...this.removeBuff(template, now));
      packets.push(...this._buff(380401, now), ...this._buff(380402, now),
        ...this._buff(380411, now));
      packets.push(...this.addShield(380413, power.mul(D('1.5')), now), ...this._basic_slot());
    }
    return packets.concat([this._cooldown(slot)], handoff);
  }
}

export { SLOTS as FIREGOD_SLOTS, BURNS as FIREGOD_BURNS };
