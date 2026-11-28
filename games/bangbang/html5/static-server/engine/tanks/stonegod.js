/* Stone God (tank 10000109): buried recovery, annular storm, host attach.
 * Port of server/stonegod_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. Burrow phases are exact event milestones.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pyRound } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, packII, piercingStep, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 384100, 1: 384201, 2: 384301, 10: 384401 };
const BURROW = [384201, 384202, 384203, 384204, 384205, 384206, 384207, 384208, 384209,
  384210, 384217, 384218];
const STORM = [384401, 384402, 384414, 384415, 384416, 384417, 384418, 384431];

export class StoneGodActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = this.burrow = this.storm = this.dash = this.attach = null;
  }

  _cooldown(slot, changed = false) {
    let skill = SLOTS[slot];
    if (slot === 1 && this.burrow && this.clock() < this.burrow.phase_end) skill = 384211;
    if (slot === 10 && this.storm && this.storm.count === 5) skill = 384421;
    const info = { skillId: skill, slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0 };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.ready = this.burrow = this.storm = this.dash = this.attach = null;
    this._queue(now + 3000, 'stone_shield', this.generation);
    return this._buff(384101, now).concat(this._buff(384103, now),
      Object.keys(SLOTS).map(Number).map(slot => this._cooldown(slot, true)));
  }

  blocked(action, now) {
    return Boolean(this.ready || this.burrow || this.attach || this.dash)
      || super.blocked(action, now);
  }

  _speed(now) {
    return this.ready || this.burrow || this.attach ? 0 : super._speed(now);
  }

  is_untargetable() { return this.isUntargetable(); }

  is_area_targetable() { return this.isAreaTargetable(); }

  isUntargetable() {
    const now = this.arena.eventNow || this.clock();
    return Boolean(this.attach) || super.isUntargetable()
      || (this.hasBuff(384208, now) && !this.buffTypes(now).has(32));
  }

  cc_immune(now, options) { return this.ccImmune(now, options); }

  ccImmune(now, options) { return Boolean(this.attach) || super.ccImmune(now, options); }

  isAreaTargetable() { return !this.attach && (Boolean(this.burrow) || super.isAreaTargetable()); }

  rejectBuff(row, source, now) { return Boolean(this.attach) && source.camp !== this.camp; }

  positionAt(now) {
    const cast = this.attach;
    if (cast) {
      const target = this.arena.actors.get(cast.target);
      if (target && target.generation === cast.target_generation) return target.positionAt(now);
    }
    return super.positionAt(now);
  }

  _endStorm(now) {
    if (!this.storm) return [];
    this.storm = null;
    this.cooldowns[10] = now + this.skillCooldown(6000, 10);
    const packets = [];
    for (const template of STORM) packets.push(...this.removeBuff(template, now));
    return packets.concat([this._cooldown(10, true), this._cooldown(10)]);
  }

  _endBurrow(now) {
    if (!this.burrow) return [];
    this.burrow = null;
    this.cooldowns[1] = now + this.skillCooldown(8000, 1);
    const packets = [];
    for (const template of BURROW) packets.push(...this.removeBuff(template, now));
    return packets.concat([this._cooldown(1, true), this._cooldown(1)]);
  }

  _endAttach(now, { burst = true } = {}) {
    const cast = this.attach;
    if (!cast) return [];
    const pos = this.positionAt(now);
    this.attach = null;
    this.info.damage_immune = cast.was_immune;
    this.position = this.blinkDestination(cast.origin, pos);
    this.motion = null;
    const packets = [];
    const target = this.arena.actors.get(cast.target);
    if (target && target.generation === cast.target_generation) {
      for (const template of [384321, 384322, 384331, 384335, 384336, 384337, 384338, 384340]) {
        if (target.buffSources.get(template) === this.id) packets.push(...target.removeBuff(template, now));
      }
    }
    for (const template of [384311, 384312, 384333]) packets.push(...this.removeBuff(template, now));
    packets.push(scene({ moves: [this._moveEvent(this.position, 0, 5)] }));
    if (burst && this.alive) {
      packets.push(scene({ skills: [this._skillEvent(384341, this.position, this.position)] }));
      for (const enemy of enemies(this, { area: true })) {
        if (Math.hypot(this.position[0] - enemy.positionAt(now)[0],
          this.position[1] - enemy.positionAt(now)[1]) <= 168) {
          packets.push(...this.damage(cast.power.mul(D('2.24')), now, { target: enemy })[0]);
          packets.push(...this._buff(384342, now, enemy.id));
        }
      }
      for (const ally of this.arena.actors.values()) {
        if (ally.alive && ally.camp === this.camp
          && Math.hypot(this.position[0] - ally.positionAt(now)[0],
            this.position[1] - ally.positionAt(now)[1]) <= 168) {
          packets.push(...ally.addShield(384343, cast.max_hp.mul(D('.2')), now,
            { caster: this }));
        }
      }
    }
    return packets.concat(this.syncSpeed(now));
  }

  onTargetDeath(target, now) {
    return this.attach && this.attach.target === target.id ? this._endAttach(now) : [];
  }

  interrupt(now) {
    if (this.ready && this.ready.slot === 1 && this.alive) return [];
    const packets = [];
    if (this.ready) {
      packets.push([1583, packII(this.id, this.ready.skill)]);
      if (this.ready.object !== undefined) packets.push(...this.removeObject(this.ready.object));
      this.ready = null;
    }
    if (this.dash) {
      this.position = this.stopPosition(now);
      this.motion = null;
      this.dash = null;
      this.forcedUntil = now;
      packets.push(...this.removeBuff(384302, now));
      packets.push(scene({ moves: [this._moveEvent(this.position, 0, 5)] }));
    }
    if (!this.alive) {
      packets.push(...this._endBurrow(now), ...this._endStorm(now),
        ...this._endAttach(now, { burst: false }));
    }
    return packets.concat(this.syncSpeed(now));
  }

  onControl(source, template, now) {
    const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
    return ['30', '35', '66'].includes(row.get('nEffectType')) ? this.interrupt(now) : [];
  }

  _flight(flight, now) {
    return piercingStep(this, flight, now, (f, target, due) => {
      const packets = this.damage(f.raw, due, { target, basic: f.basic })[0];
      if (!f.basic) {
        packets.push(...this._buff(384422, due, target.id),
          ...this._buff(384423, due, target.id));
      }
      return packets;
    }, { pierce: flight.template === 384421 });
  }

  _emerge(cast, now) {
    if (this.ready !== cast || !this.alive) return [];
    this.ready = null;
    const pos = this.blinkDestination(this.positionAt(now), cast.dest);
    const packets = this._endBurrow(now).concat(this.removeObject(cast.object, { destroyed: true }));
    this.position = pos;
    this.motion = null;
    packets.push(scene({
      moves: [this._moveEvent(pos, 0, 5)],
      skills: [this._skillEvent(384211, pos, pos)],
    }));
    for (const target of enemies(this, { area: true })) {
      if (Math.hypot(pos[0] - target.positionAt(now)[0],
        pos[1] - target.positionAt(now)[1]) > 168) continue;
      packets.push(...this.damage(cast.power.mul(D('1.62')), now, { target })[0]);
      packets.push(...this._buff(384222, now, target.id));
      this._queue(now + 100, 'stone_fall', target.id, target.generation, now + 1000);
    }
    return packets.concat(this.syncSpeed(now));
  }

  _event(now, kind, data) {
    if (kind === 'stone_shield') {
      if (!this.alive || this.generation !== data[0]) return [];
      this._queue(now + 3000, kind, ...data);
      return this.addShield(384111, this.maxHp.mul(D('.05')), now);
    }
    if (kind === 'stone_burrow') {
      const [cast] = data;
      if (this.burrow !== cast || !this.alive) return [];
      const packets = this.restoreHp(this.maxHp.sub(this.hp).mul(D('.05')), now);
      if (now === cast.begin + 1000) {
        for (const template of [384208, 384217, 384218]) packets.push(...this._buff(template, now));
      }
      if (now === cast.phase_end) packets.push(this._cooldown(1, true));
      if (now === cast.begin + 3500 && !this.ready) {
        const [ident, packet] = this.addObject(384213, this.positionAt(now));
        packets.push(packet);
        this.ready = {
          slot: 1, skill: 384211, dest: this.positionAt(now), power: cast.power,
          generation: this.generation, object: ident,
        };
        this._queue(now + 500, 'stone_emerge', this.ready);
      }
      return packets;
    }
    if (kind === 'stone_emerge') return this._emerge(data[0], now);
    if (kind === 'stone_fall') {
      const [ident, generation, finish] = data;
      const target = this.arena.actors.get(ident);
      if (!target || !target.alive || target.generation !== generation) return [];
      if (target.hasBuff(384222, now) && now < finish) {
        this._queue(Math.min(now + 100, finish), kind, ...data);
        return [];
      }
      return this._buff(384223, now, target.id, { duration: 2000 });
    }
    if (kind === 'stone_storm') {
      const [cast] = data;
      if (this.storm !== cast || !this.alive) return [];
      const packets = [];
      if (cast.count < 5 && cast.phase_end <= now) {
        cast.count = 0;
        for (let template = 384414; template < 384418; template += 1) {
          packets.push(...this.removeBuff(template, now));
        }
      }
      for (const target of enemies(this, { area: true })) {
        const span = Math.hypot(this.positionAt(now)[0] - target.positionAt(now)[0],
          this.positionAt(now)[1] - target.positionAt(now)[1]);
        if (span > 192) continue;
        packets.push(...this._buff(384411, now, target.id));
        if (span <= 120) packets.push(...this._buff(384412, now, target.id));
        const word = span > 120 ? '5' : '1';
        const [result, lost] = this.damage(cast.power.mul(D('.25')).mul(D(word)), now,
          { target });
        packets.push(...result);
        if (lost && cast.count < 5) {
          for (let template = 384414; template < 384418; template += 1) {
            packets.push(...this.removeBuff(template, now));
          }
          cast.count += 1;
          cast.phase_end = now + 3000;
          packets.push(...this._buff(384413 + cast.count, now));
          if (cast.count === 5) {
            cast.phase_end = now + 5000;
            packets.push(...this.removeBuff(384402, now), ...this._buff(384431, now));
            this.cooldowns[10] = now;
            packets.push(this._cooldown(10, true));
            this._queue(cast.phase_end, 'stone_storm_end', cast);
          }
        }
      }
      if (now < cast.end) this._queue(Math.min(now + 500, cast.end), kind, cast);
      else if (cast.count < 5) packets.push(...this._endStorm(now));
      return packets;
    }
    if (kind === 'stone_storm_end') {
      return this.storm === data[0] ? this._endStorm(now) : [];
    }
    if (kind === 'stone_cast') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.generation !== cast.generation) return [];
      this.ready = null;
      const packets = this.syncSpeed(now);
      const start = this.positionAt(now);
      if (cast.slot === 10) {
        const angle = Math.atan2(cast.dest[1] - start[1], cast.dest[0] - start[0]);
        for (const degrees of [0, 72, -72, 144, -144]) {
          const dest = [
            Math.round(start[0] + 480 * Math.cos(angle + degrees * Math.PI / 180)),
            Math.round(start[1] + 480 * Math.sin(angle + degrees * Math.PI / 180)),
          ];
          packets.push(...this.shoot(384421, start, dest, now, cast.power.mul(D('2.08')), {
            school: 'physical', through_walls: true,
          }));
        }
        return packets;
      }
      const duration = this._setMotion(start, aimed(start, cast.dest, 480, { fixed: true }),
        960, now, 3);
      this.forcedUntil = now + duration;
      Object.assign(cast, { previous: now, end: now + duration, origin: start });
      this.dash = cast;
      packets.push(...this._buff(384302, now, null, { duration }));
      packets.push(scene({ moves: [this._moveEvent(this.motion[1], 960, 3)] }));
      this._queue(now + Math.min(20, duration), 'stone_dash', cast);
      return packets;
    }
    if (kind === 'stone_dash') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive) return [];
      const start = this.positionAt(cast.previous), end = this.positionAt(now);
      const contacts = [];
      for (const target of this.arena.actors.values()) {
        if (target === this || !target.alive || target.info.npc_template
          || target.isUntargetable() || target.attach) continue;
        const hit = actorContact(start, end, target, cast.previous, now);
        if (hit !== null) contacts.push([hit, target.id, target]);
      }
      if (contacts.length) {
        contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const [, , target] = contacts[0];
        this.dash = null;
        this.motion = null;
        this.forcedUntil = now;
        Object.assign(cast, {
          target: target.id, target_generation: target.generation, end: now + 5000,
          was_immune: this.info.damage_immune ?? false, max_hp: this.maxHp,
        });
        this.attach = cast;
        this.info.damage_immune = true;
        const packets = this.removeBuff(384302, now);
        for (const template of [384311, 384312]) packets.push(...this._buff(template, now, null, { duration: 5000 }));
        for (const template of [384321, 384322]) packets.push(...this._buff(template, now, target.id));
        this._queue(now + 500, 'stone_attach', cast);
        return packets.concat(this.syncSpeed(now));
      }
      if (now >= cast.end || !this.motion || now >= this.motion[3]) {
        this.dash = null;
        this.forcedUntil = now;
        return this.removeBuff(384302, now);
      }
      cast.previous = now;
      this._queue(Math.min(now + 20, cast.end), kind, cast);
      return [];
    }
    if (kind === 'stone_attach') {
      const [cast] = data;
      if (this.attach !== cast || !this.alive) return [];
      const target = this.arena.actors.get(cast.target);
      if (!target || !target.alive || target.generation !== cast.target_generation) {
        return this._endAttach(now);
      }
      const packets = [scene({
        skills: [this._skillEvent(384331, this.positionAt(now), target.positionAt(now), target.id)],
      })];
      packets.push(...this._buff(384333, now, null,
        { duration: Math.min(600, Math.max(1, cast.end - now)) }));
      if (target.camp === this.camp) {
        packets.push(...target.addShield(384334, cast.max_hp.mul(D('.1')), now,
          { caster: this }));
        for (const template of [384335, 384336]) packets.push(...this._buff(template, now, target.id));
      } else {
        for (const template of [384337, 384338]) packets.push(...this._buff(template, now, target.id));
        packets.push(...this.damage(cast.power.mul(D('.35')), now,
          { target, periodic: true })[0]);
      }
      if (this.attach !== cast) return packets;
      packets.push(...this._buff(384340, now, target.id));
      if (now >= cast.end) packets.push(...this._endAttach(now));
      else this._queue(now + 500, kind, cast);
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, targetId, now) {
    const e2 = slot === 1 && this.burrow
      && this.burrow.begin + 1000 <= now && now < this.burrow.phase_end && !this.ready;
    const r2 = slot === 10 && this.storm && this.storm.count === 5;
    if (!(slot in SLOTS) || !this.alive || this.skillSealed(slot, now)
      || (this.blocked('attack', now) && !e2) || now < this.cooldowns[slot]) return [];
    if ((slot === 0 || slot === 2 || r2)
      && start[0] === dest[0] && start[1] === dest[1]) return [];
    const power = this.combatStat('iAttack', now);
    const packets = [];
    let stopped = [];
    if (slot === 0) {
      this.cooldowns[0] = now + this.fireInterval(now);
      return this.shoot(384100, start, dest, now, power,
        { school: 'physical', basic: true }).concat([this._cooldown(0)]);
    }
    if (e2) {
      if (!this._inside(dest)
        || Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 480) return [];
      dest = this.blinkDestination(start, dest);
      const [ident, packet] = this.addObject(384213, dest);
      packets.push(packet);
      this.ready = {
        slot: 1, skill: 384211, dest, power, generation: this.generation, object: ident,
      };
      packets.push(...this.removeBuff(384207, now));
      this.burrow.phase_end = now;
      this._queue(now + 500, 'stone_emerge', this.ready);
      packets.push(scene({
        skills: [this._skillEvent(384211, start, dest, 0, { ready: 1 })],
      }));
    } else if (slot === 1) {
      let body;
      [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      this.position = stopped.length ? body : start;
      this.motion = null;
      this.burrow = {
        begin: now, end: now + 4000, phase_end: now + 3000, power,
        generation: this.generation,
      };
      this.cooldowns[1] = now + 1000;
      for (let template = 384201; template < 384208; template += 1) {
        packets.push(...this._buff(template, now));
      }
      packets.push(...this._buff(384209, now), ...this._buff(384210, now));
      packets.push(...this.addShield(384111, this.maxHp.mul(D('.05')), now));
      for (let delay = 500; delay <= 4000; delay += 500) {
        this._queue(now + delay, 'stone_burrow', this.burrow);
      }
      packets.push(this._cooldown(1, true), scene({
        skills: [this._skillEvent(384201, start, start)],
      }));
    } else if (slot === 10 && !r2) {
      this.storm = {
        begin: now, end: now + 5000, count: 0, phase_end: now + 3000, power,
      };
      this.cooldowns[10] = now + 5000;
      packets.push(...this._buff(384401, now), ...this._buff(384402, now));
      this._queue(now + 500, 'stone_storm', this.storm);
    } else {
      packets.push(...this._endStorm(now));
      if (slot === 2) this.cooldowns[2] = now + this.skillCooldown(30000, 2);
      const skill = slot === 10 ? 384421 : 384301;
      let body;
      [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      this.position = stopped.length ? body : start;
      this.motion = null;
      this.ready = { slot, skill, dest, power, generation: this.generation };
      this._queue(now + (slot === 10 ? 150 : 300), 'stone_cast', this.ready);
      packets.push(scene({ skills: [this._skillEvent(skill, start, dest, 0, { ready: 1 })] }));
    }
    return packets.concat([this._cooldown(slot)], this.syncSpeed(now), stopped);
  }
}

export { SLOTS as STONEGOD_SLOTS, BURROW as STONEGOD_BURROW, STORM as STONEGOD_STORM };
