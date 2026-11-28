/* Doctor Strange (tank 10000083): native exile, cast reveal and a non-recursive
 * shield burst. Port of server/strange_actions.py.
 *
 * Stubs: presentation only. StrangeShadow is the native clone actor, also
 * reused by Kakashi's wood substitute.
 */
import { TankActions, bkey } from '../arena.js';
import { D } from '../math.js';
import { scene, encodeS1556, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, packII, piercingStep, prepareDisplacement } from './melee.js';
import { retireSummon } from './batch-c-common.js';

const SLOTS = { 0: 357100, 1: 357201, 2: 357301, 10: 357401 };

export class StrangeActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = null;
    this.shadow = null;
    this.reveal = null;
    this.shield_power = D(0);
    this.r_marks = new Map();
  }

  _cooldown(slot, changed = false) {
    const now = this.clock();
    let skill = slot === 0 && this.hasBuff(357406, now) ? 357411 : SLOTS[slot];
    let end = this.cooldowns[slot];
    if (slot === 1 && this.shadow) { skill = 357211; end = this.shadow.begin + 1000; }
    const info = { skillId: skill, slot, count: -1, end, nextCharge: 0 };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.ready = this.shadow = this.reveal = null;
    this.shield_power = D(0);
    this.r_marks = new Map();
    const packets = [this._cooldown(0, true), this._cooldown(1, true)];
    for (const template of [357101, 357102, 357103]) packets.push(...this._buff(template, now));
    return packets;
  }

  reject_buff(row, source, now) {
    // The E animation's own short slot lock is not an enemy silence.
    return source.camp !== this.camp && ['35', '66'].includes(row.get('nEffectType'));
  }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      packets.push([1583, packII(this.id, this.ready.skill)]);
      this.ready = null;
    }
    if (!this.alive && this.shadow) {
      const clone = this.arena.actors.get(this.shadow.id);
      if (clone && clone.alive) packets.push(...clone.commitHp(D(0), now));
      this.shadow = null;
    }
    return packets.concat(this.syncSpeed(now));
  }

  on_target_death(target, now) {
    this.r_marks.delete(`${target.id},${target.generation}`);
    if (this.shadow && target.id === this.shadow.id) {
      this.shadow = null;
      return this.removeBuff(357205, now).concat([this._cooldown(1, true)]);
    }
    return [];
  }

  _area(pos, radius, raw, now, generation, power) {
    const packets = [];
    for (const target of enemies(this, { area: true })) {
      const tpos = target.positionAt(now);
      if (Math.hypot(pos[0] - tpos[0], pos[1] - tpos[1]) <= radius) {
        packets.push(...this._skill_hit(raw, target, now, generation, power));
        if (this.arena.pk && this.arena.pk.finished) break;
      }
    }
    return packets;
  }

  _reveal(now) {
    if (!this.alive || (this.arena.pk && this.arena.pk.finished)) return [];
    const packets = this._buff(357121, now);
    if (this.reveal && this.reveal.end > now) this.reveal.end = now + 2000;
    else {
      this.reveal = { end: now + 2000, generation: this.generation };
      this._queue(now, 'strange_reveal', this.reveal);
    }
    return packets;
  }

  _grant_shield(now, generation, power) {
    if (!this.alive || this.generation !== generation
      || (this.arena.pk && this.arena.pk.finished)) return [];
    // Expiry, break and replacement all use the same single removal path.
    const packets = this.removeBuff(357111, now);
    this.shield_power = power;
    return packets.concat(this.addShield(357111, this.maxHp.mul(D('.1')), now));
  }

  removeBuff(template, now, { expired = false } = {}) {
    const active = this.activeBuffs.has(bkey(this.id, template));
    const power = this.shield_power;
    const packets = super.removeBuff(template, now, { expired });
    if (active && template === 357111 && this.alive
      && !(this.arena.pk && this.arena.pk.finished)) {
      this.shield_power = D(0);
      const pos = this.positionAt(now);
      for (const target of enemies(this, { area: true })) {
        const tpos = target.positionAt(now);
        if (Math.hypot(pos[0] - tpos[0], pos[1] - tpos[1]) > 144) continue;
        packets.push(...this.damage(power.mul(D('.25')), now, {
          target, school: 'true',
        })[0]);
        if (this.arena.pk && this.arena.pk.finished) return packets;
        const count = target.hasBuff(357132, now)
          ? Math.min(3, (target.buffStacks.get(357132) ?? 0) + 1) : 1;
        packets.push(...this._buff(357132, now, target.id, { stacks: count }));
      }
      packets.push(...this._buff(357133, now));
    }
    if (active && template === 357406) packets.push(this._cooldown(0, true));
    return packets;
  }

  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  _skill_hit(raw, target, now, generation, power) {
    if (!target.alive || target.hasBuff(357402, now)) return [];
    const packets = this.damage(raw, now, { target, school: 'energy' })[0];
    return packets.concat(this._grant_shield(now, generation, power));
  }

  _r_hit(flight, target, now) {
    const generation = flight.source_generation, power = flight.power;
    const packets = this._skill_hit(flight.raw, target, now, generation, power);
    if (!target.alive) return packets;
    packets.push(...this._buff(357402, now, target.id));
    let end;
    if (target.hasBuff(357402, now)) {
      end = this.activeBuffs.get(bkey(target.id, 357402))[1];
      const [ident, packet] = this.addObject(357405, target.positionAt(now));
      packets.push(packet);
      this._queue(end, 'object_expire', ident);
    } else end = now;
    if (this.alive && this.generation === generation) {
      packets.push(...this._buff(357406, now));
      packets.push(this._cooldown(0, true));
    }
    const mark = {
      target: target.id, target_generation: target.generation, generation,
      end: now + 3000,
    };
    this.r_marks.set(`${target.id},${target.generation}`, mark);
    this._queue(end, 'strange_exile_end', mark);
    return packets;
  }

  _flight(flight, now) {
    if (flight.template === 357401) {
      return piercingStep(this, flight, now, (f, t, n) => this._r_hit(f, t, n),
        { pierce: false });
    }
    if (flight.template === 357411) {
      return piercingStep(this, flight, now, (f, t, n) => this._empowered_hit(f, t, n),
        { pierce: false });
    }
    return super._flight(flight, now);
  }

  _empowered_hit(flight, target, now) {
    const mark = this.r_marks.get(`${target.id},${target.generation}`);
    const enhanced = mark && mark.end > now
      && mark.generation === flight.source_generation && target.hasBuff(357404, now);
    const packets = this.damage(flight.raw.mul(enhanced ? D(2) : D(1)), now, {
      target, school: 'energy', basic: true,
    })[0];
    if (enhanced) {
      this.r_marks.delete(`${target.id},${target.generation}`);
      packets.push(...target.removeBuff(357404, now));
      if (this.alive && this.generation === flight.source_generation) {
        packets.push(...this.restoreHp(flight.power.mul(D('1.5')), now));
      }
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'strange_cast') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.generation !== cast.generation) return [];
      this.ready = null;
      const packets = this.syncSpeed(now);
      const start = this.positionAt(now);
      if (cast.skill === 357211) {
        const clone = this.arena.actors.get(cast.target);
        if (!clone || !clone.alive || !this.shadow || clone.id !== this.shadow.id) return packets;
        const dest = this.blinkDestination(start, clone.positionAt(now));
        packets.push(scene({ skills: [this._skillEvent(357211, start, dest, clone.id)] }));
        this.position = dest;
        this.motion = null;
        packets.push(scene({ moves: [this._moveEvent(dest, 0, 5)] }));
        packets.push(...clone.commitHp(D(0), now));
        packets.push(...this.removeBuff(357205, now));
        return packets.concat(this._reveal(now));
      }
      const dest = this.blinkDestination(start, aimed(start, cast.dest, 600));
      const info = {
        acct_id: this.info.acct_id, tank_id: this.info.tank_id,
        tank_level: this.info.tank_level, npc_template: 357201, owner: this.id,
        source_generation: this.generation, name: this.info.name, in_room: true,
        summon_stats: { ...this.stats }, summon_hp: this.hp.toString(),
      };
      for (const key of ['iAttack', 'iEgAtk', 'iArmor', 'iEgArmor', 'iCentesis', 'iEgCtsis']) {
        info.summon_stats[key] = this.combatStat(key, now).toString();
      }
      info.summon_stats.iHp = this.maxHp.toString();
      const clone = new StrangeShadow(this.arena, this._newId(5), info, this.camp, start);
      this.arena.actors.set(clone.id, clone);
      const shadow = this.shadow = { id: clone.id, begin: cast.begin, end: cast.begin + 5000 };
      clone._queue(shadow.end, 'strange_shadow_end');
      packets.push(clone.snapshot(now), ...clone._buff(357221, now, null,
        { duration: shadow.end - now }));
      this.position = dest;
      this.motion = null;
      packets.push(scene({ moves: [this._moveEvent(dest, 0, 5)] }),
        scene({ skills: [this._skillEvent(357201, start, dest)] }));
      packets.push(...this._area(dest, 144, cast.power.mul(D('1.63')), now,
        cast.generation, cast.power));
      // Damage can synchronously kill the owner/clone or finish the match.
      if (!this.alive || this.generation !== cast.generation
        || (this.arena.pk && this.arena.pk.finished)) return packets;
      for (const target of enemies(this, { area: true })) {
        const tpos = target.positionAt(now);
        if (Math.hypot(dest[0] - tpos[0], dest[1] - tpos[1]) <= 96) {
          packets.push(...this._buff(357204, now, target.id));
        }
      }
      for (const template of [357205, 357206, 357207, 357208]) {
        if (template === 357205 && this.shadow !== shadow) continue;
        packets.push(...this._buff(template, now, null,
          { duration: template === 357205 ? shadow.end - now : null }));
      }
      for (let tick = 1; tick <= 4; tick += 1) this._queue(now + 750 * tick, 'strange_pulse', cast);
      packets.push(...this._reveal(now), this._cooldown(1, true));
      return packets;
    }
    if (kind === 'strange_pulse') {
      const [cast] = data;
      if (!this.alive || this.generation !== cast.generation) return [];
      const pos = this.positionAt(now);
      const packets = [scene({ skills: [this._skillEvent(357221, pos, pos)] })];
      for (const target of enemies(this, { area: true })) {
        const tpos = target.positionAt(now);
        if (Math.hypot(pos[0] - tpos[0], pos[1] - tpos[1]) > 144) continue;
        const amplified = target.hasBuff(357312, now)
          && target.buffSources.get(357312) === this.id;
        const raw = cast.power.mul(D('.5')).mul(amplified ? D(2) : D(1));
        packets.push(...this._skill_hit(raw, target, now, cast.generation, cast.power));
      }
      return packets;
    }
    if (kind === 'strange_field_open') {
      const [cast] = data;
      const packets = this.removeObject(cast.id);
      const pos = cast.pos;
      packets.push(...this._area(pos, 144, cast.power.mul(D('2.03')), now,
        cast.generation, cast.power));
      for (const target of enemies(this, { area: true })) {
        const tpos = target.positionAt(now);
        if (Math.hypot(pos[0] - tpos[0], pos[1] - tpos[1]) <= 144) {
          packets.push(...this._buff(357303, now, target.id),
            ...this._buff(357304, now, target.id));
        }
      }
      const [ident, packet] = this.addObject(357305, pos);
      cast.id = ident;
      cast.end = now + 4000;
      cast.inside = false;
      packets.push(packet);
      if (this.alive && this.generation === cast.generation) {
        packets.push(...this._buff(357306, now));
      }
      this._queue(now, 'strange_field', cast);
      return packets;
    }
    if (kind === 'strange_field') {
      const [cast] = data;
      if (now >= cast.end) return this.removeObject(cast.id);
      const packets = [];
      for (const target of enemies(this, { area: true })) {
        const tpos = target.positionAt(now);
        if (Math.hypot(cast.pos[0] - tpos[0], cast.pos[1] - tpos[1]) <= 144) {
          // This debuff modifies only E's orbit pulses.
          packets.push(...this._buff(357312, now, target.id));
        }
      }
      const current = this.alive && this.generation === cast.generation;
      const pos = this.positionAt(now);
      const inside = current && !this.hasBuff(357402, now)
        && Math.hypot(cast.pos[0] - pos[0], cast.pos[1] - pos[1]) <= 144;
      if (inside && !cast.inside) {
        packets.push(...this._buff(357311, now));
        for (const target of enemies(this, { area: true })) {
          const tpos = target.positionAt(now);
          if (Math.hypot(pos[0] - tpos[0], pos[1] - tpos[1]) <= 144) {
            packets.push(...this._skill_hit(cast.power.mul(D('1.67')), target, now,
              cast.generation, cast.power));
            packets.push(...this._buff(357322, now, target.id));
          }
        }
        packets.push(...this._buff(357323, now));
      }
      cast.inside = inside;
      this._queue(Math.min(now + 100, cast.end), kind, cast);
      return packets;
    }
    if (kind === 'strange_reveal') {
      const [cast] = data;
      if (this.reveal !== cast || !this.alive || this.generation !== cast.generation) return [];
      if (now >= cast.end) { this.reveal = null; return []; }
      const packets = [];
      for (const target of this.arena.actors.values()) {
        const pos = this.positionAt(now), tpos = target.positionAt(now);
        if (target.alive && target.camp !== this.camp
          && Math.hypot(pos[0] - tpos[0], pos[1] - tpos[1]) <= 360) {
          packets.push(...this._buff(357141, now, target.id,
            { duration: Math.min(300, cast.end - now) }));
        }
      }
      this._queue(Math.min(now + 250, cast.end), kind, cast);
      return packets;
    }
    if (kind === 'strange_exile_end') {
      const [mark] = data;
      const target = this.arena.actors.get(mark.target);
      if (!target || !target.alive || target.generation !== mark.target_generation) return [];
      return this._buff(357403, now, target.id, { duration: 2000 }).concat(
        this._buff(357404, now, target.id, { duration: Math.max(1, mark.end - now) }));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    const second = slot === 1 && this.shadow !== null;
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)) return [];
    if (now < (second ? this.shadow.begin + 1000 : this.cooldowns[slot])) return [];
    if ((slot === 0 || slot === 10) && start[0] === dest[0] && start[1] === dest[1]) return [];
    const power = this.combatStat('iEgAtk', now);
    if (!second) {
      this.cooldowns[slot] = now + this.skillCooldown(
        { 0: this.fireInterval(now), 1: 8000, 2: 20000, 10: 6000 }[slot], slot);
    }
    if (slot === 0) {
      const enhanced = this.hasBuff(357406, now);
      const packets = enhanced ? this.removeBuff(357406, now) : [];
      return packets.concat(this.shoot(enhanced ? 357411 : 357100, start, dest, now,
        power, { school: 'energy', basic: true, power }), [this._cooldown(0)]);
    }
    if (slot === 10) {
      return this._reveal(now).concat(
        this.shoot(357401, start, dest, now, power.mul(D('1.44')), {
          school: 'energy', power, through_walls: true,
        }), [this._cooldown(10)]);
    }
    if (slot === 2) {
      const pos = aimed(start, dest, 600);
      const [ident, packet] = this.addObject(357301, pos);
      this._queue(now + 1000, 'strange_field_open', {
        id: ident, pos, power, generation: this.generation,
      });
      return [packet, this._cooldown(2)].concat(this._reveal(now));
    }
    const [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
    this.position = stopped.length ? body : start;
    this.motion = null;
    this.ready = {
      slot: 1, skill: second ? 357211 : 357201, begin: now, dest, power,
      generation: this.generation, target: second ? this.shadow.id : 0,
    };
    this._queue(now + 50, 'strange_cast', this.ready);
    return [scene({
      skills: [this._skillEvent(this.ready.skill, start, dest, this.ready.target, { ready: 1 })],
    }), this._cooldown(1)].concat(this.syncSpeed(now), stopped);
  }
}

export class StrangeShadow extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.stats = { ...info.summon_stats };
    this.maxHp = D(this.stats.iHp);
    this.hp = this.maxHp.min(D(info.summon_hp));
    this.info.hp = this.hp.ceil();
    this.info.max_hp = this.maxHp.ceil();
    this.cooldowns = {};
  }

  snapshot(now) {
    return [1556, encodeS1556(this.sceneId, {
      objectId: this.id, templateId: 357201, x: this.positionAt(now)[0],
      y: this.positionAt(now)[1], hp: this.hp.ceil(), camp: this.camp,
      maxHp: this.maxHp.ceil(), ownerId: this.info.owner, shield: 0, buffs: [],
    })];
  }

  syncSpeed() { return []; }

  _respawn(now, generation) {
    if (generation !== this.generation) return [];
    return retireSummon(this, now, generation);
  }

  commitHp(hp, now, { critical = false } = {}) {
    const before = this.alive;
    const packets = super.commitHp(hp, now, { critical });
    if (before && !this.alive) packets.push(scene({ removedObjects: [this.id] }));
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'strange_shadow_end') return this.alive ? this.commitHp(D(0), now) : [];
    return super._event(now, kind, data);
  }
}

export { SLOTS as STRANGE_SLOTS };
