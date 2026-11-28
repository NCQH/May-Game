/* Lac Long Quan (tank 10000094): two safe dashes, two independent shields and
 * water form. Port of server/laclongquan_actions.py.
 *
 * Stubs: presentation only; water re-clips accept only an existing recorded
 * lineage (the JS core has no recorder), like the batch-D/E ports.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, rectContact } from '../math.js';
import { scene, stop_move, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, packII, piercingStep, prepareDisplacement } from './melee.js';
import { teamVisible } from './batch-c-common.js';
import { acceptWaterReclip } from './batch-d-common.js';

const SLOTS = { 0: 387100, 1: 387201, 2: 387301, 10: 387401 };

export class LacLongQuanActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.dash = this.form = null;
    this.e_second_until = this.e_gap_until = 0;
    this.passive_ready_at = 0;
  }

  _cooldown(slot, changed = false) {
    const now = this.arena.eventNow || this.clock();
    let skill = SLOTS[slot], end = this.cooldowns[slot];
    if (slot === 0 && this.form) skill = 387311;
    if (slot === 1 && now < this.e_second_until) {
      skill = 387231; end = this.e_gap_until;
    }
    if (slot === 2 && this.form) {
      skill = this.hasBuff(387313, now) && (this.buffStacks.get(387313) ?? 0) >= 4
        ? 387331 : 387321;
      end = this.form.used ? this.cooldowns[2] : 0;
    }
    const info = { skillId: skill, slot, count: -1, end, nextCharge: 0 };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.dash = this.form = null;
    this.e_second_until = this.e_gap_until = 0;
    this.passive_ready_at = 0;
    return this.addShield(387101, this.maxHp.mul(D('.15')), now)
      .concat([this._cooldown(0, true), this._cooldown(1, true), this._cooldown(2, true)]);
  }

  attr_bonus(attributes, now) {
    let result = super.attr_bonus(attributes, now);
    if (attributes.includes(5) && this.hasBuff(387313, now)) {
      result = result.sub(D('.05').mul(D(this.buffStacks.get(387313) ?? 1)));
    }
    return result;
  }

  blocked(action, now) { return Boolean(this.dash) || super.blocked(action, now); }

  interrupt(now) {
    const packets = [];
    if (this.dash) {
      const pos = this.stopPosition(now);
      this.dash = null;
      this.position = pos;
      this.motion = null;
      this.forcedUntil = now;
      packets.push(stop_move(this.sceneId, this.id, pos));
      for (const template of [387201, 387206]) packets.push(...this.removeBuff(template, now));
    }
    if (!this.alive && this.form) {
      this.cooldowns[2] = now + this.skillCooldown(30000, 2);
      this.form = null;
    }
    return packets.concat(this.syncSpeed(now));
  }

  removeBuff(template, now, { expired = false } = {}) {
    const packets = super.removeBuff(template, now, { expired });
    if (template === 387313) {
      for (let visual = 387351; visual < 387355; visual += 1) {
        if (this.hasBuff(visual, now)) packets.push(...this.removeBuff(visual, now));
      }
    }
    if (template === 387202 && this.e_second_until && now >= this.e_second_until) {
      this.e_second_until = 0;
      packets.push(this._cooldown(1, true));
    }
    return packets;
  }

  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  on_shield_break(template, now) {
    if (template !== 387101 || !this.alive) return [];
    this.passive_ready_at = now + 15000;
    this._queue(this.passive_ready_at, 'lac_shield', this.generation);
    const packets = this._buff(387102, now).concat(this._buff(387104, now));
    for (const target of this._targets(this.positionAt(now), 192, now)) {
      packets.push(...this.damage(this.combatStat('iAttack', now).mul(D('2.31')), now, { target })[0]);
      if (this.arena.pk && this.arena.pk.finished) return packets;
      packets.push(...this._buff(387105, now, target.id));
    }
    return packets;
  }

  _targets(pos, radius, now) {
    return enemies(this, { area: true }).filter(target => {
      const tpos = target.positionAt(now);
      return Math.hypot(pos[0] - tpos[0], pos[1] - tpos[1]) <= radius
        && rectContact(pos, tpos, this.arena.waterRects(now), 0) === null;
    });
  }

  _flight(flight, now) {
    if (flight.template === 387311) {
      return piercingStep(this, flight, now, (f, t, n) => this._water_hit(f, t, n),
        { pierce: false, contactRadius: 48 });
    }
    return super._flight(flight, now);
  }

  _water_hit(flight, target, now) {
    const packets = [];
    const targetPos = target.positionAt(now);
    for (const enemy of this._targets(targetPos, 144, now)) {
      let raw = flight.raw;
      if (enemy.info.map_turret || enemy.info.base) raw = raw.mul(D('.5'));
      packets.push(...this.damage(raw, now, {
        target: enemy, basic: true, source_generation: flight.source_generation,
      })[0]);
      if (this.arena.pk && this.arena.pk.finished) return packets;
      packets.push(...this._buff(387312, now, enemy.id), ...this._buff(387316, now, enemy.id));
    }
    if (this.alive && this.generation === flight.source_generation && this.form) {
      packets.push(...this.restoreHp(this.maxHp.sub(this.hp).max(D(0)).mul(D('.05')), now));
      const count = this.hasBuff(387313, now)
        ? Math.min(5, (this.buffStacks.get(387313) ?? 0) + 1) : 1;
      packets.push(...this._buff(387313, now, null, { stacks: count }),
        ...this._buff(387314, now, null, { stacks: count }));
      const visual = 387350 + Math.min(count, 4);
      for (let other = 387351; other < 387355; other += 1) {
        if (other !== visual && this.hasBuff(other, now)) {
          packets.push(...this.removeBuff(other, now));
        }
      }
      packets.push(...this._buff(visual, now));
      if (count >= 4 && !this.form.used) {
        packets.push(...this._buff(387318, now, null, { duration: Math.max(1, this.form.end - now) }));
      }
      packets.push(this._cooldown(2, true));
    }
    return packets;
  }

  _push(target, cast, now) {
    if (!target.alive || target.ccImmune(now)) return [];
    const [start, packets] = prepareDisplacement(target, now);
    const [dx, dy] = cast.direction;
    const dest = target.moveDestination(start,
      aimed(start, [start[0] + dx, start[1] + dy], cast.distance, { fixed: true }));
    if (dest[0] === start[0] && dest[1] === start[1]) return packets;
    const duration = target._setMotion(start, dest, cast.speed, now, 1);
    target.forcedUntil = now + duration;
    return packets.concat([scene({ moves: [target._moveEvent(target.motion[1], cast.speed, 1)] })]);
  }

  _event(now, kind, data) {
    if (kind === 'lac_visual_remove') {
      return this.removeObject(data[0], { destroyed: true });
    }
    if (kind === 'lac_shield') {
      return this.alive && this.generation === data[0]
        ? this.addShield(387101, this.maxHp.mul(D('.15')), now) : [];
    }
    if (kind === 'lac_dash') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive) return [];
      if (this.motion !== cast.motion && !acceptWaterReclip(this, cast)) return this.interrupt(now);
      const start = this.positionAt(cast.previous), end = this.positionAt(now);
      const packets = [];
      for (const target of enemies(this, { area: true })) {
        const key = `${target.id},${target.generation}`;
        if (!cast.hits.has(key)
          && actorContact(start, end, target, cast.previous, now, 36) !== null) {
          cast.hits.add(key);
          packets.push(...this._push(target, cast, now));
          if (this.arena.pk && this.arena.pk.finished) return packets;
        }
      }
      if (now < this.motion[3]) {
        cast.previous = now;
        this._queue(Math.min(now + 20, this.motion[3]), kind, cast);
        return packets;
      }
      this.position = this.stopPosition(now);
      this.motion = null;
      this.forcedUntil = now;
      this.dash = null;
      for (const template of [387201, 387206]) packets.push(...this.removeBuff(template, now));
      packets.push(stop_move(this.sceneId, this.id, this.position));
      packets.push(...this._buff(cast.second ? 387207 : 387203, now));
      for (const target of this._targets(this.position, 168, now)) {
        let raw = cast.power.mul(D(cast.second ? '1.57' : '1.23'));
        if (target.info.map_turret || target.info.base) raw = raw.mul(D('.5'));
        packets.push(...this.damage(raw, now, {
          target, source_generation: cast.generation,
        })[0]);
        if (this.arena.pk && this.arena.pk.finished) return packets;
        if (cast.second) packets.push(...this._buff(387210, now, target.id));
      }
      return packets.concat(this.syncSpeed(now));
    }
    if (kind === 'lac_form_end') {
      const [cast] = data;
      if (this.form !== cast) return [];
      this.form = null;
      this.cooldowns[2] = now + this.skillCooldown(30000, 2);
      const packets = [];
      for (const template of [387301, 387302, 387303, 387304, 387318]) {
        packets.push(...this.removeBuff(template, now));
      }
      return packets.concat([this._cooldown(0, true), this._cooldown(2, true)], this.syncSpeed(now));
    }
    if (kind === 'lac_wave') {
      const [cast, index] = data;
      const raw = cast.power.mul(D(cast.enhanced && index === 1 ? '3.68' : '2.16'));
      const debuff = index === 2 ? 387339 : cast.enhanced ? 387337 : 387327;
      const packets = [];
      for (const target of this._targets(cast.pos, 192, now)) {
        packets.push(...this.damage(raw, now, {
          target, source_generation: cast.generation,
        })[0]);
        if (this.arena.pk && this.arena.pk.finished) return packets;
        packets.push(...this._buff(debuff, now, target.id));
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (this.arena.pk && this.arena.pk.finished) return [];
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)) return [];
    const second = slot === 1 && now < this.e_second_until;
    const wave = slot === 2 && this.form !== null;
    const gate = second ? this.e_gap_until : (wave && !this.form.used ? 0 : this.cooldowns[slot]);
    if (gate > now) return [];
    if (wave && this.form.used) return [];
    if ((slot === 0 || slot === 1)
      && ((start[0] === dest[0] && start[1] === dest[1]) || !this._inside(dest))) return [];
    if (wave && (!this._inside(dest)
      || Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 600)) return [];
    if (slot === 10) {
      const targets = enemies(this).filter(target => {
        const tpos = target.positionAt(now);
        return Math.hypot(start[0] - tpos[0], start[1] - tpos[1]) <= 192
          && teamVisible(this, target, now);
      });
      if (!targets.length) return [];
      targets.sort((a, b) => {
        const da = Math.hypot(start[0] - a.positionAt(now)[0], start[1] - a.positionAt(now)[1]);
        const db = Math.hypot(start[0] - b.positionAt(now)[0], start[1] - b.positionAt(now)[1]);
        return Number(Boolean(a.info.npc_template)) - Number(Boolean(b.info.npc_template))
          || da - db || a.id - b.id;
      });
      dest = targets[0].positionAt(now);
    }
    const power = this.combatStat('iAttack', now);
    if (slot === 0) {
      this.cooldowns[0] = now + this.fireInterval(now);
      return [this._cooldown(0)].concat(this.shoot(this.form ? 387311 : 387100,
        start, dest, now, power.mul(this.form ? D('1.5') : D(1)), {
          school: 'physical', basic: true, power,
        }));
    }
    if (!second && !wave) {
      this.cooldowns[slot] = now + this.skillCooldown({ 1: 8000, 2: 30000, 10: 6000 }[slot], slot);
    }
    const skill = second ? 387231
      : wave && (this.buffStacks.get(387313) ?? 0) >= 4 && this.hasBuff(387313, now) ? 387331
        : wave ? 387321 : SLOTS[slot];
    const packets = [scene({
      skills: [this._skillEvent(skill, start, dest, slot === 10 ? target_id : 0)],
    })];
    if (slot === 1) {
      const [body, pre] = prepareDisplacement(this, now, { interrupt: false });
      packets.push(...pre);
      const [distance, speed] = second ? [240, 600] : [192, 480];
      const end = this.moveDestination(body, aimed(body, dest, distance));
      const duration = this._setMotion(body, end, speed, now, 1);
      this.forcedUntil = now + duration;
      this.dash = {
        previous: now, motion: this.motion, generation: this.generation, power,
        direction: [dest[0] - body[0], dest[1] - body[1]],
        distance, speed, second, hits: new Set(),
      };
      if (second) {
        this.e_second_until = 0;
        packets.push(...this.removeBuff(387202, now));
      } else {
        this.e_second_until = now + 2000;
        this.e_gap_until = now + 500;
        packets.push(...this._buff(387202, now));
      }
      packets.push(...this._buff(second ? 387206 : 387201, now, null, { duration }));
      packets.push(scene({ moves: [this._moveEvent(end, speed, 1)] }));
      this._queue(now + Math.min(20, duration), 'lac_dash', this.dash);
    } else if (slot === 2 && !wave) {
      this.form = { end: now + 8000, used: false, generation: this.generation };
      this.cooldowns[2] = this.form.end + this.skillCooldown(30000, 2);
      for (const template of [387301, 387302, 387303, 387304]) {
        packets.push(...this._buff(template, now));
      }
      this._queue(this.form.end, 'lac_form_end', this.form);
      packets.push(this._cooldown(0, true));
    } else if (wave) {
      this.form.used = true;
      const cast = {
        pos: dest, power, generation: this.generation, enhanced: skill === 387331,
      };
      const [obj, packet] = this.addObject(cast.enhanced ? 387331 : 387321, dest);
      packets.push(packet);
      this._queue(now + 1000, 'object_expire', obj);
      // Props 387322/387332 (300ms) and 387333 (1300ms) start the dragon movie.
      const visuals = cast.enhanced ? [[387332, 300], [387333, 1300]] : [[387322, 300]];
      for (const [template, delay] of visuals) {
        const [visual, visualPacket] = this.addObject(template, dest);
        packets.push(visualPacket);
        this._queue(now + delay, 'lac_visual_remove', visual);
      }
      this._queue(now + 1000, 'lac_wave', cast, 1);
      if (cast.enhanced) this._queue(now + 2000, 'lac_wave', cast, 2);
      for (const template of [387304, 387318]) packets.push(...this.removeBuff(template, now));
    } else {
      const [obj, packet] = this.addObject(387401, dest);
      packets.push(packet);
      this._queue(now + 50, 'lac_visual_remove', obj);
      for (const enemy of this._targets(dest, 168, now)) {
        let raw = power.mul(D('2.04'));
        if (enemy.info.map_turret || enemy.info.base) raw = raw.mul(D('.5'));
        packets.push(...this.damage(raw, now, { target: enemy })[0]);
        if (this.arena.pk && this.arena.pk.finished) return packets;
        packets.push(...this._buff(387402, now, enemy.id), ...this._buff(387404, now, enemy.id));
      }
      packets.push(...this.addShield(387405, this.maxHp.mul(D('.15')), now));
    }
    return packets.concat([this._cooldown(slot, true)], this.syncSpeed(now));
  }
}

export { SLOTS as LACLONGQUAN_SLOTS };
