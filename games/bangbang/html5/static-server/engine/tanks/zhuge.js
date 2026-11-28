/* Zhuge Liang (tank 10000084): three independent weather kits and a one-use
 * fog counter. Port of server/zhuge_actions.py.
 *
 * Stubs: presentation only. Reaction keys are stringified so they compare
 * across JS event tuples.
 */
import { TankActions, friendly } from '../arena.js';
import { D } from '../math.js';
import { scene, encodeS1572, encodeS1579, moveEvent } from '../protocol.js';
import { enemies, piercingStep, prepareDisplacement } from './melee.js';
import { keyOf } from './batch-f2-common.js';

const SLOTS = [
  { 0: 358100, 1: 358501, 2: 358601, 10: 358401 },
  { 0: 358100, 1: 358201, 2: 358301, 10: 358101 },
  { 0: 358100, 1: 358801, 2: 358901, 10: 358701 },
];

export class ZhugeActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.weather = 0;
    this.mp = 100;
    this.assists = new Map();
    this.hitting = null;
    this.guard_version = 0;
    this.blocked_attacks = [];
  }

  _cooldown(slot, changed = false) {
    const info = {
      skillId: SLOTS[this.weather][slot], slot, count: -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _resource(delta) {
    if (this.noel_box) return [];
    const before = this.mp;
    this.mp = Math.max(0, Math.min(100, this.mp + delta));
    return before !== this.mp ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  on_spawn(now) {
    this.weather = 0;
    this.mp = 100;
    this.assists = new Map();
    this.hitting = null;
    this.guard_version = 0;
    this.blocked_attacks = [];
    this._queue(now + 1000, 'zhuge_energy', this.generation);
    const packets = [scene({ mp: [{ objectId: this.id, mp: this.mp }] })];
    for (const slot of Object.keys(SLOTS[0])) packets.push(this._cooldown(Number(slot), true));
    for (const template of [358911, 358912, 358931, 358932]) {
      packets.push(...this._buff(template, now));
    }
    return packets;
  }

  _deal(target, raw, now, generation, { basic = false, periodic = false } = {}) {
    const current = this.alive && this.generation === generation;
    this.hitting = current ? `${target.id},${target.generation}` : null;
    let packets, lost;
    try {
      [packets, lost] = this.damage(raw, now, { target, school: 'energy', basic, periodic });
    } finally { this.hitting = null; }
    if (lost && current && target.alive && !target.info.npc_template) {
      this.assists.set(`${target.id},${target.generation}`, {
        end: now + 5000, generation,
      });
    }
    return [packets, lost];
  }

  on_target_death(target, now) {
    const key = `${target.id},${target.generation}`;
    const mark = this.assists.get(key) ?? null;
    this.assists.delete(key);
    if (this.alive && target.camp !== this.camp && !target.info.npc_template
      && (this.hitting === key
        || (mark && mark.end >= now && mark.generation === this.generation))) {
      return this._resource(30);
    }
    return [];
  }

  effectBlocked() {
    if (super.effectBlocked()) return true;
    const key = this.arena.damageContext;
    if (key && this.blocked_attacks.includes(keyOf(key))) return true;
    if (!key) return false;
    const source = this.arena.actors.get(key[0]);
    const flight = this.arena.currentFlight;
    const basic = flight ? flight.basic : this.arena.current_slot === 0;
    return this._guard(key, source, this.arena.eventNow || this.clock(), { basic });
  }

  effect_blocked() { return this.effectBlocked(); }

  _guard(key, source, now, { basic = false, periodic = false } = {}) {
    if (periodic) return false;
    const k = keyOf(key);
    if (this.blocked_attacks.includes(k)) return true;
    if (basic || periodic || !source || source.camp === this.camp
      || !this.hasBuff(358921, now)
      || this.guard_version !== this.buffVersions.get(358921)) return false;
    this.guard_version = -1;
    this.blocked_attacks.push(k);
    this.blocked_attacks = this.blocked_attacks.slice(-128);
    const cast = {
      target: source.id, target_generation: source.generation, generation: this.generation,
      power: this.combatStat('iEgAtk', now), version: this.buffVersions.get(358921),
    };
    this._queue(now, 'zhuge_counter', cast);
    return true;
  }

  reject_buff(row, source, now) {
    if (source.camp === this.camp) return false;
    const context = this.arena.damageContext;
    if (context && this.blocked_attacks.includes(keyOf(context))) return true;
    // A refresh of an already-running debuff is not a new direct hit.
    if (row.nBuffId && this.hasBuff(Number(row.nBuffId), now)) return false;
    const flight = this.arena.currentFlight;
    const basic = flight ? flight.basic : this.arena.current_slot === 0;
    return Boolean(context && this._guard(context, source, now, { basic }));
  }

  block_hit(key, amount, now, { basic = false, periodic = false, source = null } = {}) {
    return [this._guard(key, source, now, { basic, periodic }), []];
  }

  update(now) {
    for (const [key, value] of [...this.assists]) if (!(value.end > now)) this.assists.delete(key);
    return super.update(now);
  }

  _bullet_hit(flight, target, now) {
    if (flight.template === 358100) {
      return this._deal(target, flight.raw, now, flight.source_generation, { basic: true })[0];
    }
    // Wind's hit first lifts; damage is a distinct landing operation.
    const packets = this._buff(358501, now, target.id);
    if (target.effectBlocked()) return packets;
    const cast = {
      target: target.id, target_generation: target.generation, power: flight.power,
      generation: flight.source_generation, end: now + 1000,
      lifted: target.hasBuff(358501, now),
    };
    this._queue(now + 20, 'zhuge_landing', cast);
    return packets;
  }

  _flight(flight, now) {
    return piercingStep(this, flight, now, (f, t, n) => this._bullet_hit(f, t, n),
      { pierce: flight.template === 358501 });
  }

  _area(template, pos, now, power, delay, eventName, generation) {
    const [ident, packet] = this.addObject(template, pos);
    const cast = { id: ident, pos, power, generation };
    this._queue(now + delay, eventName, cast);
    return [cast, template !== 358301 ? [packet] : friendly(this, packet)];
  }

  _event(now, kind, data) {
    if (kind === 'zhuge_energy') {
      if (!this.alive || data[0] !== this.generation) return [];
      this._queue(now + 1000, kind, ...data);
      return this._resource(5);
    }
    if (kind === 'zhuge_landing') {
      const [cast] = data;
      const target = this.arena.actors.get(cast.target);
      if (!target || !target.alive || target.generation !== cast.target_generation) return [];
      if (target.hasBuff(358501, now) || (!cast.lifted && now < cast.end)) {
        this._queue(now + 20, kind, cast);
        return [];
      }
      const packets = this._buff(358503, now, target.id);
      packets.push(...this._deal(target, cast.power.mul(D('1.73')), now, cast.generation)[0]);
      return packets.concat(this._buff(358505, now, target.id));
    }
    if (kind === 'zhuge_counter') {
      const [cast] = data;
      if (!this.alive || this.generation !== cast.generation) return [];
      const packets = this.buffVersions.get(358921) === cast.version
        ? this.removeBuff(358921, now) : [];
      const target = this.arena.actors.get(cast.target);
      if (target && target.alive && target.generation === cast.target_generation) {
        const pos = this.positionAt(now);
        packets.push(scene({
          skills: [this._skillEvent(358921, pos, target.positionAt(now), target.id)],
        }));
        for (const key of [...this.activeBuffs.keys()]) {
          const [owner, template] = key.split(',').map(Number);
          if (owner === target.id
            && this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template })
              .get('nEffectType') === '54') packets.push(...target.removeBuff(template, now));
        }
        packets.push(...this._deal(target, cast.power.mul(D('1.17')), now, cast.generation)[0]);
        if (this.arena.pk && this.arena.pk.finished) return packets;
        packets.push(...this._buff(358922, now, target.id),
          ...this._buff(358923, now, target.id, { duration: 1000 }));
      }
      if (!this.alive || this.generation !== cast.generation) return packets;
      const previousVersion = this.buffVersions.get(358925);
      packets.push(...this.addShield(358924, this.maxHp.mul(D('.3')), now),
        ...this._buff(358925, now), ...this._buff(358926, now), ...this._resource(30));
      const version = this.buffVersions.get(358925);
      if (version !== previousVersion && this.hasBuff(358925, now)
        && this.buffSources.get(358925) === this.id) {
        this._queue(now + 1000, 'zhuge_regen', this.generation, version, 1);
      }
      return packets;
    }
    if (kind === 'zhuge_regen') {
      const [generation, version, index] = data;
      if (!this.alive || this.generation !== generation
        || this.buffVersions.get(358925) !== version) return [];
      if (index < 2) this._queue(now + 1000, kind, generation, version, index + 1);
      return this.restoreHp(this.maxHp.mul(D('.05')), now).concat(this._resource(5));
    }
    if (kind === 'zhuge_thunder_e') {
      const [cast] = data;
      const packets = this.removeObject(cast.id, { destroyed: true });
      for (const target of enemies(this, { area: true })) {
        const tpos = target.positionAt(now);
        if (Math.hypot(cast.pos[0] - tpos[0], cast.pos[1] - tpos[1]) > 120) continue;
        const [hit, lost] = this._deal(target, cast.power.mul(D('1.81')), now, cast.generation);
        packets.push(...hit);
        if (!target.hasBuff(358205, now)) {
          packets.push(...this._buff(358204, now, target.id),
            ...this._buff(358205, now, target.id));
        }
        if (lost && this.alive && this.generation === cast.generation) {
          packets.push(...this._buff(358203, now));
        }
      }
      return packets;
    }
    if (kind === 'zhuge_wind_start') {
      const [cast] = data;
      const packets = this.removeObject(cast.id, { destroyed: true });
      cast.ids = [];
      for (const template of [358602, 358603]) {
        const [ident, packet] = this.addObject(template, cast.pos);
        cast.ids.push(ident);
        packets.push(packet);
      }
      this._queue(now + 1000, 'zhuge_wind_tick', cast, 1);
      return packets;
    }
    if (kind === 'zhuge_wind_tick') {
      const [cast, index] = data;
      const packets = [];
      for (const target of enemies(this, { area: true })) {
        const tpos = target.positionAt(now);
        if (Math.hypot(cast.pos[0] - tpos[0], cast.pos[1] - tpos[1]) > 196) continue;
        packets.push(...this._buff(358604, now, target.id),
          ...this._buff(358607, now, target.id));
        packets.push(...this._deal(target, cast.power.mul(D('2.5')), now,
          cast.generation, { periodic: true })[0]);
        if (this.arena.pk && this.arena.pk.finished) return packets;
        if (index === 3 && target.alive && !target.ccImmune(now) && !target.effectBlocked()) {
          const [origin, stopped] = prepareDisplacement(target, now, { interrupt: false });
          packets.push(...stopped);
          const pos = target.moveDestination(origin, cast.pos);
          target.position = pos;
          target.motion = null;
          packets.push(scene({ moves: [moveEvent(pos, 0, 5, target.id)] }));
        }
      }
      if (index < 3) this._queue(now + 1000, kind, cast, index + 1);
      else {
        for (const ident of cast.ids) packets.push(...this.removeObject(ident, { destroyed: true }));
      }
      return packets;
    }
    if (kind === 'zhuge_thunder_start') {
      const [cast] = data;
      const packets = this.removeObject(cast.id, { destroyed: true })
        .concat(this.removeObject(cast.warning, { destroyed: true }));
      for (const target of enemies(this, { area: true })) {
        const tpos = target.positionAt(now);
        if (Math.hypot(cast.pos[0] - tpos[0], cast.pos[1] - tpos[1]) <= 96) {
          packets.push(...this._deal(target, cast.power.mul(D('4.62')), now, cast.generation)[0]);
        }
      }
      const [ident, packet] = this.addObject(358303, cast.pos);
      cast.id = ident;
      packets.push(packet);
      this._queue(now + 1000, 'zhuge_thunder_tick', cast, 1);
      return packets;
    }
    if (kind === 'zhuge_thunder_tick') {
      const [cast, index] = data;
      const packets = [];
      for (const target of enemies(this, { area: true })) {
        const tpos = target.positionAt(now);
        if (Math.hypot(cast.pos[0] - tpos[0], cast.pos[1] - tpos[1]) <= 96) {
          packets.push(...this._deal(target, cast.power.mul(D('.9')), now,
            cast.generation, { periodic: true })[0]);
        }
      }
      if (index < 2) this._queue(now + 1000, kind, cast, index + 1);
      else packets.push(...this.removeObject(cast.id, { destroyed: true }));
      return packets;
    }
    if (kind === 'zhuge_fog') {
      const [cast] = data;
      const packets = this.removeObject(cast.id, { destroyed: true });
      for (const target of this.arena.actors.values()) {
        const tpos = target.positionAt(now);
        if (target.alive && target.camp === this.camp
          && Math.hypot(cast.pos[0] - tpos[0], cast.pos[1] - tpos[1]) <= 300) {
          packets.push(...this._buff(358902, now, target.id),
            ...this._buff(358903, now, target.id));
        }
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS[0]) || !this.alive || this.blocked('attack', now)
      || this.skillSealed(slot, now) || this.cooldowns[slot] > now) return [];
    const skill = SLOTS[this.weather][slot];
    const cost = slot === 1 ? 20 : slot === 2 ? 50 : 0;
    if (this.mp < cost || (slot === 0 && start[0] === dest[0] && start[1] === dest[1])
      || (slot === 1 && this.weather === 0 && start[0] === dest[0] && start[1] === dest[1])) {
      return [];
    }
    if ([1, 2].includes(slot) && this.weather !== 2
      && Math.hypot(start[0] - dest[0], start[1] - dest[1])
        > (skill === 358601 ? 480 : 600)) return [];
    const power = this.combatStat('iEgAtk', now);
    const base = { 0: this.fireInterval(now), 10: 1000 }[slot]
      ?? Number(this.arena.data.tableRow('SkillTemplate_table.xml', { nId: skill })
        .get('iCoolTime'));
    this.cooldowns[slot] = now + this.skillCooldown(base, slot);
    const packets = this._resource(-cost);
    if (slot === 0) {
      return packets.concat(this.shoot(358100, start, dest, now, power, {
        school: 'energy', basic: true,
      }), [this._cooldown(0)]);
    }
    if (slot === 10) {
      for (const template of [358911, 358912, 358913, 358915, 358102, 358103, 358104,
        358402, 358403, 358404, 358702, 358703, 358704]) {
        packets.push(...this.removeBuff(template, now));
      }
      this.weather = (this.weather + 1) % 3;
      const templates = [
        [358911, 358912, 358702, 358703, 358704],
        [358913, 358402, 358403, 358404],
        [358915, 358102, 358103, 358104],
      ][this.weather];
      for (const template of [skill, ...templates]) packets.push(...this._buff(template, now));
      this.cooldowns[1] = this.cooldowns[2] = 0;
      return packets.concat([this._cooldown(1, true), this._cooldown(2, true),
        this._cooldown(10, true), this._cooldown(1), this._cooldown(2), this._cooldown(10)]);
    }
    if (skill === 358501) {
      packets.push(...this.shoot(skill, start, dest, now, 0, {
        school: 'energy', through_walls: true, power,
      }));
    } else if (skill === 358801) {
      const previousVersion = this.buffVersions.get(358921);
      packets.push(...this._buff(358921, now));
      const version = this.buffVersions.get(358921);
      if (version !== previousVersion && this.hasBuff(358921, now)
        && this.buffSources.get(358921) === this.id) this.guard_version = version;
    } else if ([358201, 358601, 358301, 358901].includes(skill)) {
      const [delay, eventName] = {
        358201: [300, 'zhuge_thunder_e'],
        358601: [500, 'zhuge_wind_start'],
        358301: [1250, 'zhuge_thunder_start'],
        358901: [1000, 'zhuge_fog'],
      }[skill];
      const [cast, created] = this._area(skill, skill === 358901 ? start : dest,
        now, power, delay, eventName, this.generation);
      packets.push(...created);
      if (skill === 358301) {
        const [warning, packet] = this.addObject(358305, dest);
        cast.warning = warning;
        packets.push(packet);
      }
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as ZHUGE_SLOTS };
