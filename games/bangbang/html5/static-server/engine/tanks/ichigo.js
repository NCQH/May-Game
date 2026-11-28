/* Ichigo (tank 10000064): three-step reserves, Bankai slots and four
 * generation-bound cuts. Port of server/ichigo_actions.py.
 *
 * Stubs: no skin/presentation; team visibility uses batch-C's range/wall check.
 */
import { TankActions } from '../arena.js';
import { D, rectContact } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, inStrip, packII, piercingStep, prepareDisplacement } from './melee.js';
import { teamVisible } from './batch-c-common.js';
import { samePosition } from './batch-d-common.js';

const SLOTS = { 0: 339100, 1: 339201, 2: 339301, 10: 339401 };

export class IchigoActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = 150;
    this.e_count = 3;
    this.e_next_charge = 0;
    this.ready = this.vanish = null;
    this.next_stack_at = 0;
  }

  _skill(slot, now) {
    if (slot === 0) {
      return this.hasBuff(339111, now) ? 339121
        : this.hasBuff(339308, now) ? 339106 : 339100;
    }
    if (slot === 2 && this.hasBuff(339303, now)) return 339306;
    if (slot === 10 && this.hasBuff(339302, now)) return 339305;
    return SLOTS[slot];
  }

  _cooldown(slot, changed = false) {
    if (!(slot in SLOTS)) {
      return [1572, encodeS1572(this.id, {
        skillId: this.skillForSlot(slot) ?? 0, slot, count: -1,
        end: this.cooldowns[slot] ?? 0, nextCharge: 0,
      })];
    }
    const skill = this._skill(slot, this.clock());
    const info = {
      skillId: skill, slot, count: slot === 1 ? this.e_count : -1,
      end: skill === 339306 ? 0 : this.cooldowns[slot],
      nextCharge: slot === 1 ? this.e_next_charge : 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _resource(delta) {
    if (this.noel_box) return [];
    const old = this.mp;
    this.mp = Math.max(0, Math.min(150, this.mp + delta));
    return old !== this.mp ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  on_spawn(now) {
    this.mp = 150;
    this.ready = this.vanish = null;
    this.next_stack_at = 0;
    this._queue(now + 3000, 'ichigo_energy', this.generation);
    return this._buff(339101, now).concat(this._buff(339102, now), [
      scene({ mp: [{ objectId: this.id, mp: this.mp }] }),
    ], [this._cooldown(0, true), this._cooldown(2, true), this._cooldown(10, true)]);
  }

  _empower(now) {
    return this._buff(339111, now).concat([this._cooldown(0, true)]);
  }

  _hit(target, power, now, { critical_display = false } = {}) {
    const [packets, lost] = this.damage(power, now, { target, critical_display });
    if (lost && this.alive && now >= this.next_stack_at) {
      this.next_stack_at = now + 500;
      for (const template of [339112, 339113, 339114]) {
        packets.push(...this._buff(template, now));
      }
    }
    return packets;
  }

  removeBuff(template, now, { expired = false } = {}) {
    const packets = super.removeBuff(template, now, { expired });
    const slot = { 339111: 0, 339308: 0, 339303: 2, 339302: 10 }[template];
    if (slot !== undefined) {
      packets.push(this._cooldown(slot, true), this._cooldown(slot));
    }
    return packets;
  }

  // Core calls the camelCase removeBuff; keep Python's spelling as an alias.
  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

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

  _speed(now) { return this.vanish ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.vanish) || super.blocked(action, now); }

  cc_immune(now, { slow = false } = {}) {
    return Boolean(this.vanish) || super.ccImmune(now, { slow });
  }

  reject_buff(row, source, now) { return Boolean(this.vanish && source.camp !== this.camp); }

  _endVanish(now) {
    const cast = this.vanish;
    this.vanish = null;
    if (!cast) return [];
    this.info.untargetable = cast.was_untargetable;
    this.info.damage_immune = cast.was_immune;
    const packets = this.removeBuff(339336, now).concat(this.removeBuff(339346, now));
    packets.push(...this.removeObject(cast.object));
    return packets.concat(this.syncSpeed(now));
  }

  interrupt(now) {
    if (this.alive && this.vanish) return [];
    this.ready = null;
    return !this.alive ? this._endVanish(now) : [];
  }

  update(now) {
    const packets = [];
    while (this.e_next_charge && this.e_next_charge <= now) {
      this.e_count = Math.min(3, this.e_count + 1);
      this.e_next_charge = this.e_count < 3
        ? this.e_next_charge + this.skillCooldown(6000) : 0;
      packets.push(this._cooldown(1));
    }
    return packets.concat(super.update(now));
  }

  _blade(flight, target, now) {
    if (flight.basic) {
      const targets = flight.template === 339100 ? [target]
        : [...enemies(this, { area: true })].filter(t => {
          const a = t.positionAt(now), b = target.positionAt(now);
          return Math.hypot(a[0] - b[0], a[1] - b[1]) <= 96;
        });
      const packets = [];
      for (const victim of targets) {
        packets.push(...this.damage(flight.raw, now, { target: victim, basic: true })[0]);
      }
      return packets;
    }
    const current = this.alive && this.generation === flight.source_generation;
    const packets = current ? this._hit(target, flight.raw, now)
      : this.damage(flight.raw, now, { target })[0];
    return packets.concat(this._buff(
      flight.template === 339305 ? 339315 : 339402, now, target.id));
  }

  _flight(flight, now) {
    if (flight.template === 339201) {
      if (now < flight.finish) {
        this._queue(flight.finish, 'flight', flight);
        return [];
      }
      return [scene({ expiredBullets: [flight.id] })];
    }
    return piercingStep(this, flight, now, (f, t, n) => this._blade(f, t, n),
      { pierce: !flight.basic });
  }

  _enhanced(start, dest, now) {
    const power = this.combatStat('iAttack', now);
    const packets = [];
    let landed = false;
    for (const target of enemies(this, { area: true })) {
      const pos = target.positionAt(now);
      if (!inStrip(pos, start, dest, 408, 72)
        || rectContact(start, pos, this.arena.waterRects(now)) !== null) continue;
      const tip = !inStrip(pos, start, dest, 240, 72);
      const [hit, lost] = this.damage(power.mul(tip ? D('1.5') : D(1)), now,
        { target, basic: true });
      packets.push(...hit);
      landed = landed || lost;
      if (tip) packets.push(...this._buff(339122, now, target.id));
      if (target.buffSources.get(339210) === this.id) {
        packets.push(...target.removeBuff(339210, now));
      }
      packets.push(...this._buff(339127, now, target.id));
    }
    if (landed) packets.push(...this.restoreHp(power, now), ...this._resource(15));
    packets.push(scene({ skills: [this._skillEvent(339121, start, dest)] }));
    return packets.concat(this.removeBuff(339111, now));
  }

  _airborne(target, now) {
    for (const [key, [, end]] of target.activeBuffs) {
      const [owner, template] = key.split(',').map(Number);
      if (owner !== target.id || end <= now) continue;
      const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
      if (row.nBuffShowType === '1') return true;
    }
    return false;
  }

  _event(now, kind, data) {
    if (kind === 'ichigo_step') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      const target = this.arena.actors.get(cast.target);
      if (!target || !target.alive || target.generation !== cast.target_generation) return [];
      const start = this.positionAt(now), aim = target.positionAt(now);
      const dest = this.blinkDestination(start, aim);
      this.position = dest;
      this.motion = null;
      this.forcedUntil = now;
      const packets = this.shoot(339201, start, aim, now, D(0), {
        school: 'physical', target, through_walls: true, fixed_destination: true,
      });
      packets.push(scene({ moves: [this._moveEvent(dest, 0, 5)] }));
      if (target.camp !== this.camp) {
        packets.push(...this._hit(target, cast.power.mul(D('1.25')), now));
        packets.push(...this._buff(339210, now, target.id));
      }
      for (const template of [339204, 339205, 339206]) {
        packets.push(...this._buff(template, now));
      }
      return packets.concat(this._empower(now));
    }
    if (kind === 'ichigo_energy') {
      if (!this.alive || data[0] !== this.generation) return [];
      this._queue(now + 3000, kind, ...data);
      return this._resource(5);
    }
    if (kind === 'ichigo_form') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      const packets = this.cleanse(now).concat(this._resource(75));
      this.cooldowns[10] = 0;
      for (const template of [339301, 339302, 339303, 339308, 339309]) {
        packets.push(...this._buff(template, now));
      }
      packets.push(...this._empower(now));
      return packets.concat([this._cooldown(0, true), this._cooldown(2, true),
        this._cooldown(10, true)], [this._cooldown(10)]);
    }
    if (kind === 'ichigo_cut') {
      const [cast, index] = data;
      if (this.vanish !== cast || !this.alive) return [];
      const packets = [];
      for (const [ident, generation] of cast.targets) {
        const target = this.arena.actors.get(ident);
        if (target && target.alive && target.generation === generation) {
          packets.push(...this._hit(target, cast.power.mul(D('1.5')), now,
            { critical_display: true }));
        }
      }
      if (index < 3) this._queue(now + 375, kind, cast, index + 1);
      else packets.push(...this._endVanish(now));
      return packets;
    }
    return super._event(now, kind, data);
  }

  _startStep(start, dest, target, now, power) {
    this.e_count -= 1;
    if (!this.e_next_charge) this.e_next_charge = now + this.skillCooldown(6000);
    this.cooldowns[1] = now + this.skillCooldown(1500, 1);
    this.ready = {
      slot: 1, target: target.id, target_generation: target.generation, power,
    };
    this._queue(now + 50, 'ichigo_step', this.ready);
    return this._resource(-40).concat(this._buff(339207, now), [this._cooldown(1)]);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || !this.alive || this.vanish) return [];
    const skill = this._skill(slot, now);
    if ((slot !== 2 || skill === 339306)
      && (this.blocked('attack', now) || this.skillSealed(slot, now))) return [];
    if (skill !== 339306 && this.cooldowns[slot] > now) return [];
    if ((slot === 0 || slot === 10) && samePosition(start, dest)) return [];
    if (this.ready) return [];
    let target = this.arena.actors.get(target_id);
    if (slot === 1) {
      if (!this.e_count || this.mp < 40 || !target || target === this || !target.alive
        || target.isUntargetable()
        || Math.hypot(start[0] - target.positionAt(now)[0],
          start[1] - target.positionAt(now)[1]) > 432) return [];
      if (target.hasBuff(339210, now) && target.buffSources.get(339210) === this.id) return [];
      if (target.camp !== this.camp && !teamVisible(this, target, now)) return [];
    }
    if (slot === 10 && this.mp < 30) return [];
    if (skill === 339306) {
      const candidates = [...enemies(this)].filter(t => this._airborne(t, now)
        && Math.hypot(start[0] - t.positionAt(now)[0],
          start[1] - t.positionAt(now)[1]) <= 600 && teamVisible(this, t, now));
      if (!candidates.length) return [];
      candidates.sort((a, b) => (Math.hypot(start[0] - a.positionAt(now)[0],
        start[1] - a.positionAt(now)[1]) - Math.hypot(start[0] - b.positionAt(now)[0],
        start[1] - b.positionAt(now)[1])) || a.id - b.id);
      target = candidates[0];
    }
    const power = this.combatStat('iAttack', now);
    const packets = [];
    if (slot === 0) {
      this.cooldowns[0] = now + this.fireInterval(now);
      packets.push(...(skill === 339121 ? this._enhanced(start, dest, now)
        : this.shoot(skill, start, dest, now, power, { school: 'physical', basic: true })));
    } else if (slot === 1) {
      return this._startStep(start, dest, target, now, power);
    } else if (slot === 10) {
      this.cooldowns[10] = now + this.skillCooldown(8000, 10);
      packets.push(...this._resource(-30));
      packets.push(...this.shoot(skill, start, dest, now, power.mul(D('1.65')),
        { school: 'physical', through_walls: true }));
      if (skill === 339305) packets.push(...this.removeBuff(339302, now));
      packets.push(...this._empower(now));
    } else if (skill === 339301) {
      this.cooldowns[2] = now + this.skillCooldown(25000, 2);
      this.ready = { slot: 2, dest: start };
      this._queue(now + 50, 'ichigo_form', this.ready);
      packets.push(scene({ skills: [this._skillEvent(skill, start, start)] }));
    } else {
      const center = target ? target.positionAt(now) : this.positionAt(now);
      const targets = [...enemies(this, { area: true })].filter(t => {
        const pos = t.positionAt(now);
        return Math.hypot(center[0] - pos[0], center[1] - pos[1]) <= 96;
      });
      this.position = this.blinkDestination(start, center);
      this.motion = null;
      packets.push(...this.removeBuff(339303, now));
      const [ident, packet] = this.addObject(339327, center);
      packets.push(packet);
      this.vanish = {
        power, targets: targets.map(t => [t.id, t.generation]), object: ident,
        was_untargetable: this.info.untargetable ?? false,
        was_immune: this.info.damage_immune ?? false,
      };
      this.info.untargetable = this.info.damage_immune = true;
      for (const t of targets) packets.push(...this._buff(339306, now, t.id));
      for (const template of [339336, 339346]) packets.push(...this._buff(template, now));
      packets.push(...this._empower(now), ...this.syncSpeed(now));
      packets.push(scene({ moves: [this._moveEvent(this.position, 0, 5)] }));
      this._queue(now + 375, 'ichigo_cut', this.vanish, 0);
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as ICHIGO_SLOTS };
