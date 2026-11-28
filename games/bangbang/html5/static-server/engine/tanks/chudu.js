/* Chu Du (tank 10000112): contagion burn, fire orbs and an MP channel.
 * Port of server/chudu_actions.py onto the JS battle core.
 *
 * Stubs: no bush visibility (teamVisible always true) and no presentation.
 * Orb actors are written as native ObjInfo packets with two BuffInfo rows.
 */
import { TankActions } from '../arena.js';
import { D, pointAt, pyRound } from '../math.js';
import { scene, encodeS1556, objectInfo, encodeS1572, encodeS1579 } from '../protocol.js';
import { packII, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 388100, 1: 388201, 2: 388301, 10: 388401 };
const CHANNEL_BUFFS = [388401, 388402, 388403, 388404, 388405, 388406, 388421];
const teamVisible = () => true; // stub: no bush/fog visibility on the JS core

export class ChuDuActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = Number(this.stats.iMp);
    this.e_count = 3;
    this.e_next_charge = 0;
    this.ready = this.channel = null;
    this.marks = new Map();
    this.orbs = new Map();
    this.rewarded = new Set();
  }

  _cooldown(slot, changed = false) {
    const channel = slot === 10 && this.channel;
    const info = {
      skillId: channel ? 388431 : SLOTS[slot], slot,
      count: slot === 1 ? this.e_count : -1,
      end: channel ? 0 : (this.cooldowns[slot] ?? 0),
      nextCharge: slot === 1 ? this.e_next_charge : 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _resource(delta) {
    if (this.noel_box) return []; // stasis suppresses resource effects too
    const before = this.mp;
    this.mp = Math.max(0, Math.min(Number(this.stats.iMp), this.mp + delta));
    return before !== this.mp ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  on_spawn(now) {
    this.mp = Number(this.stats.iMp);
    this.rewarded.clear();
    this._queue(now + 3000, 'chu_regen', this.generation);
    const packets = [scene({ mp: [{ objectId: this.id, mp: this.mp }] })];
    for (const template of [388101, 388102, 388103, 388104, 388141]) {
      packets.push(...this._buff(template, now));
    }
    return packets.concat([this._cooldown(10, true), this._cooldown(10)]);
  }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  cc_immune(now, { slow = false } = {}) {
    return Boolean(this.channel) || super.cc_immune(now, { slow });
  }

  update(now) {
    const packets = [];
    if (this.ready && this.skillSealed(this.ready.slot, now)) packets.push(...this.interrupt(now));
    if (this.channel && this._silenced(now)) packets.push(...this._end_channel(now));
    while (this.e_next_charge && this.e_next_charge <= now) {
      this.e_count = Math.min(3, this.e_count + 1);
      this.e_next_charge = this.e_count < 3 ? this.e_next_charge + this.skillCooldown(8000) : 0;
      packets.push(this._cooldown(1));
    }
    return packets.concat(super.update(now));
  }

  _silenced(now) {
    // Own initial R lock (388406) is not an external silence.
    for (const [key, [, end]] of this.activeBuffs) {
      const [owner, template] = key.split(',').map(Number);
      if (owner !== this.id || end <= now || this.buffSources.get(template) === this.id) continue;
      const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
      if (['35', '66'].includes(row.nEffectType)
        && (!Number(row.get('fEffectValB', 0)) || (Number(row.get('fEffectValB', 0)) & 8))) {
        return true;
      }
    }
    return false;
  }

  _end_channel(now) {
    if (!this.channel) return [];
    this.channel = null;
    this.cooldowns[10] = now + this.skillCooldown(6000, 10);
    const packets = [];
    for (const template of CHANNEL_BUFFS) packets.push(...this.removeBuff(template, now));
    packets.push(...this._buff(388435, now));
    return packets.concat([this._cooldown(10, true), this._cooldown(10)], this.syncSpeed(now));
  }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      const slot = this.ready.slot;
      this.ready = null;
      if (slot === 10) this.cooldowns[10] = now + this.skillCooldown(6000, 10);
      packets.push([1583, packII(this.id, SLOTS[slot])], this._cooldown(slot));
    }
    return packets.concat(this._end_channel(now), this.syncSpeed(now));
  }

  handle(message, payload) {
    if (message === 514) {
      const now = this.clock();
      const packets = this.arena.tick(now);
      if (!this.arena.inputOpen(now, this)) return packets;
      if (payload.length === 8 && this.channel && this.alive) {
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        const sceneId = view.getUint32(0, true);
        const x = view.getInt16(4, true), y = view.getInt16(6, true);
        if (sceneId === this.sceneId && (x !== this.positionAt(now)[0] || y !== this.positionAt(now)[1])) {
          this.channel.dest = [x, y];
        }
      }
      return packets;
    }
    return super.handle(message, payload);
  }

  _enemies(pos, radius, now) {
    return [...this.arena.actors.values()].filter(a => a.alive && a.camp !== this.camp
      && a.isAreaTargetable()
      && Math.hypot(pos[0] - a.positionAt(now)[0], pos[1] - a.positionAt(now)[1]) <= radius);
  }

  _valid(target, mark, now, final = false) {
    return this.marks.get(target.id) === mark && target.alive
      && target.generation === mark.target_generation
      && target.buffVersions.get(388113) === mark.version
      && (final ? now <= mark.end : now < mark.end)
      && (final || target.hasBuff(388113, now));
  }

  _burn(target, power, generation, now, { chain = null } = {}) {
    if (!target.alive || target.rejectBuff({ nEffectType: '201' }, this, now)) return [];
    const direct = chain === null;
    const key = `${target.id},${target.generation}`;
    if (chain !== null && chain.has(key)) return [];
    chain = direct ? new Set([key]) : chain;
    chain.add(key);
    const old = this.marks.get(target.id);
    const valid = old && old.source_generation === generation && this._valid(target, old, now);
    const mark = valid ? old : {};
    const packets = this._buff(388113, now, target.id, { duration: 2000 });
    Object.assign(mark, {
      version: target.buffVersions.get(388113), end: now + 2000, power,
      source_generation: generation, target_generation: target.generation,
    });
    this.marks.set(target.id, mark);
    if (direct) {
      packets.push(...this._buff(388111, now, target.id, { duration: 2000 }));
      packets.push(...this._buff(388112, now, target.id, { duration: 2000 }));
      const stacks = target.buffStacks.get(388111) ?? 1;
      for (let template = 388115; template < 388120; template += 1) {
        if (target.hasBuff(template, now)) packets.push(...target.removeBuff(template, now));
      }
      packets.push(...this._buff(388114 + stacks, now, target.id, { duration: 2000 }));
    }
    if (!valid) this._queue(now + 1000, 'chu_dot', target.id, mark);
    this._queue(now + 1000, 'chu_spread', target.id, mark, chain);
    return packets;
  }

  _reward(target, generation, now) {
    const key = `${target.id},${target.generation}`;
    if (!this.alive || this.generation !== generation || this.rewarded.has(key)) return [];
    this.rewarded.add(key);
    const packets = this._resource(15).concat(this._buff(388121, now));
    if (this.e_next_charge) this.e_next_charge = Math.max(now, this.e_next_charge - 400);
    for (const [slot, amount] of [[2, 1500], [10, 300]]) {
      if (!(slot === 10 && this.channel)) this.cooldowns[slot] = Math.max(now, this.cooldowns[slot] - amount);
    }
    return packets.concat([1, 2, 10].map(slot => this._cooldown(slot)));
  }

  on_target_death(target, now) {
    const mark = this.marks.get(target.id);
    this.marks.delete(target.id);
    if (mark && target.generation === mark.target_generation && now <= mark.end
      && target.buffVersions.get(388113) === mark.version) {
      return this._reward(target, mark.source_generation, now);
    }
    return [];
  }

  _hurt(target, raw, power, generation, now, {
    burn = true, periodic = false, steal = 0, basic = false,
  } = {}) {
    const before_alive = target.alive;
    const [packets, lost] = this.damage(raw, now, {
      target, school: 'energy', periodic, basic,
      lifesteal: generation === this.generation ? steal : 0,
    });
    if (before_alive && !target.alive) packets.push(...this._reward(target, generation, now));
    if (lost && burn) packets.push(...this._burn(target, power, generation, now));
    return [packets, lost];
  }

  on_bullet_hit(flight, target, now) {
    // The generic flight has already applied normal damage.
    const packets = flight.source_generation === this.generation ? this.removeBuff(388141, now) : [];
    if (!target.alive) packets.push(...this._reward(target, flight.source_generation, now));
    return packets;
  }

  _new_orb(pos, power, generation, now) {
    const ident = this._newId(5);
    const info = {
      objectId: ident, templateId: 388201, x: pos[0], y: pos[1], hp: 10, camp: this.camp,
      maxHp: 10, ownerId: this.id, shield: 0,
      buffs: [388205, 388206].map(templateId => ({
        templateId, instanceId: this._newId(6), stackCount: 1, casterId: this.id,
      })),
    };
    const body = encodeS1556(this.sceneId, info);
    this.arena.objects.set(ident, objectInfo(info));
    const [prop, packet] = this.addObject(388206, pos);
    const orb = { id: ident, prop, pos, power, generation, end: now + 8000, ignited: false };
    this.orbs.set(ident, orb);
    this._queue(now + 8000, 'chu_orb', orb);
    return [[1556, body], packet];
  }

  _ignite(orb, now, { immediate = false } = {}) {
    if (this.orbs.get(orb.id) !== orb) return [];
    if (immediate) return this._explode_orb(orb, now);
    if (!orb.ignited) {
      orb.ignited = true;
      this._queue(now + 1000, 'chu_orb', orb);
    }
    return [];
  }

  _explode_orb(orb, now) {
    if (this.orbs.get(orb.id) !== orb) return [];
    this.orbs.delete(orb.id);
    const packets = this.removeObject(orb.id, { destroyed: true })
      .concat(this.removeObject(orb.prop));
    const pos = orb.pos;
    packets.push(scene({ skills: [this._skillEvent(388211, pos, pos, this.id)] }));
    let hit = false;
    for (const target of this._enemies(pos, 168, now)) {
      const [more, lost] = this._hurt(target, orb.power.mul(D('1.26')), orb.power,
        orb.generation, now);
      packets.push(...more, ...this._buff(388212, now, target.id));
      hit = hit || lost;
    }
    if (hit && this.alive && orb.generation === this.generation && this.e_next_charge) {
      this.e_next_charge = now + pyRound(Math.max(0, this.e_next_charge - now) * 0.75);
      packets.push(this._cooldown(1));
    }
    const [ident, packet] = this.addObject(388213, pos);
    packets.push(packet);
    const area = { ...orb, id: ident };
    this._queue(now + 1000, 'chu_ground', area, 1);
    return packets;
  }

  static _in_cone(start, dest, pos) {
    const span = Math.hypot(start[0] - pos[0], start[1] - pos[1]);
    if (!span) return true;
    const length = Math.hypot(start[0] - dest[0], start[1] - dest[1]);
    const dot = (dest[0] - start[0]) * (pos[0] - start[0])
      + (dest[1] - start[1]) * (pos[1] - start[1]);
    return span <= 456 && length > 0
      && dot / (length * span) >= Math.cos(7.5 * Math.PI / 180);
  }

  _flight(flight, now) {
    if (flight.template === 388100) return super._flight(flight, now);
    if (now < flight.finish) {
      this._queue(flight.finish, 'flight', flight);
      return [];
    }
    const pos = flight.end;
    const packets = [scene({ blownBullets: [flight.id] })];
    let hit = false;
    for (const target of this._enemies(pos, 168, now)) {
      const [more, lost] = this._hurt(target, flight.power.mul(D('1.47')), flight.power,
        flight.source_generation, now);
      packets.push(...more);
      if (this.arena.pk && this.arena.pk.finished) return packets;
      packets.push(...this._buff(388203, now, target.id));
      hit = hit || lost;
    }
    if (this.alive && flight.source_generation === this.generation) {
      if (hit) {
        packets.push(...this._buff(388202, now));
        for (let index = 1; index <= 5; index += 1) {
          this._queue(now + index * 400, 'chu_e_mp', this.generation);
        }
      }
      const start = this.positionAt(now);
      const span = Math.hypot(start[0] - pos[0], start[1] - pos[1]);
      if (span > 0 && span <= 168 && !this.ccImmune(now)) {
        const dest = pointAt(pos, start, 1 + 240 / span);
        const duration = this._setMotion(start, dest, 720, now, 1);
        this.forcedUntil = now + duration;
        packets.push(scene({ moves: [this._moveEvent(this.motion[1], 720, 1)] }));
      }
    }
    return packets.concat(this._new_orb(pos, flight.power, flight.source_generation, now));
  }

  _event(now, kind, data) {
    if (kind === 'chu_regen' || kind === 'chu_e_mp') {
      const [generation] = data;
      if (!this.alive || this.generation !== generation) return [];
      if (kind === 'chu_regen') this._queue(now + 3000, kind, generation);
      return this._resource(kind === 'chu_regen' ? 10 : 5);
    }
    if (kind === 'chu_dot') {
      const [ident, mark] = data;
      const target = this.arena.actors.get(ident);
      if (!this._valid(target, mark, now, true)) {
        if (this.marks.get(ident) === mark) this.marks.delete(ident);
        return [];
      }
      const packets = this._hurt(target, target.maxHp.sub(target.hp).mul(D('.025')),
        mark.power, mark.source_generation, now, { burn: false, periodic: true })[0];
      if (this.marks.get(ident) === mark) {
        if (now < mark.end) this._queue(now + 1000, kind, ident, mark);
        else this.marks.delete(ident);
      }
      return packets;
    }
    if (kind === 'chu_spread') {
      const [ident, mark, chain] = data;
      const target = this.arena.actors.get(ident);
      if (!this._valid(target, mark, now)) return [];
      const packets = [];
      for (const victim of this._enemies(target.positionAt(now), 120, now)) {
        packets.push(...this._burn(victim, mark.power, mark.source_generation, now, { chain }));
      }
      return packets;
    }
    if (kind === 'chu_orb') return this._explode_orb(data[0], now);
    if (kind === 'chu_ground') {
      const [area, index] = data;
      const packets = [];
      for (const target of this._enemies(area.pos, 168, now)) {
        packets.push(...this._hurt(target, area.power.mul(D('.3')), area.power,
          area.generation, now)[0]);
      }
      if (index < 3) this._queue(now + 1000, kind, area, index + 1);
      else packets.push(...this.removeObject(area.id));
      return packets;
    }
    if (kind === 'chu_ready') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.generation !== cast.generation) return [];
      if (this.skillSealed(cast.slot, now)) return this.interrupt(now);
      this.ready = null;
      const pos = this.positionAt(now);
      const packets = this.syncSpeed(now);
      packets.push(scene({ skills: [this._skillEvent(SLOTS[cast.slot], pos, cast.dest)] }));
      if (cast.slot === 10) {
        this.channel = cast;
        for (const template of CHANNEL_BUFFS.slice(0, -1)) packets.push(...this._buff(template, now));
        this._queue(now + 300, 'chu_beam', cast);
        this._queue(now + 400, 'chu_cost', cast);
        return packets.concat([this._cooldown(10, true), this._cooldown(10)]);
      }
      packets.push(...this._buff(388302, now));
      for (const target of this._enemies(pos, 10000, now)) {
        if (!teamVisible(this.arena, this, target, now)) continue;
        packets.push(...this._buff(388301, now, target.id));
        this._queue(now + 100, 'chu_warning', { ...cast, pos: target.positionAt(now) });
      }
      return packets;
    }
    if (kind === 'chu_warning') {
      const [cast] = data;
      const [ident, packet] = this.addObject(388311, cast.pos);
      this._queue(now + 1000, 'chu_space', { ...cast, id: ident });
      return [packet];
    }
    if (kind === 'chu_space') {
      const [cast] = data;
      const packets = this.removeObject(cast.id, { destroyed: true });
      for (const target of this._enemies(cast.pos, 120, now)) {
        packets.push(...this._hurt(target, cast.power.mul(D('3.23')), cast.power,
          cast.generation, now)[0]);
        packets.push(...this._buff(388322, now, target.id));
      }
      for (const orb of [...this.orbs.values()]) {
        if (Math.hypot(cast.pos[0] - orb.pos[0], cast.pos[1] - orb.pos[1]) <= 120) {
          packets.push(...this._ignite(orb, now, { immediate: true }));
        }
      }
      return packets;
    }
    if (kind === 'chu_beam' || kind === 'chu_cost') {
      const [cast] = data;
      if (this.channel !== cast || !this.alive || this.generation !== cast.generation) return [];
      if (this._silenced(now)) return this._end_channel(now);
      if (kind === 'chu_cost') {
        if (this.mp < 10) return this._end_channel(now);
        const packets = this._resource(-10).concat(this._buff(388421, now));
        if (this.mp === 0) return packets.concat(this._end_channel(now));
        this._queue(now + 400, kind, cast);
        return packets;
      }
      const start = this.positionAt(now), dest = cast.dest;
      const packets = [scene({ skills: [this._skillEvent(388411, start, dest)] })];
      for (const target of this._enemies(start, 456, now)) {
        if (ChuDuActions._in_cone(start, dest, target.positionAt(now))) {
          const scale = Math.hypot(start[0] - target.positionAt(now)[0],
            start[1] - target.positionAt(now)[1]) > 408 ? D('1.5') : D(1);
          packets.push(...this._buff(388411, now, target.id));
          packets.push(...this._hurt(target, cast.power.mul(D('.375')).mul(scale),
            cast.power, cast.generation, now, { steal: D('.25') })[0]);
        }
      }
      for (const orb of [...this.orbs.values()]) {
        if (ChuDuActions._in_cone(start, dest, orb.pos)) packets.push(...this._ignite(orb, now));
      }
      this._queue(now + 300, kind, cast);
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (slot === 10 && this.channel && this.alive && !this.skillSealed(slot, now)) {
      return this._end_channel(now);
    }
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now || (slot === 1 && !this.e_count)
      || (slot === 10 && this.mp < 10)) return [];
    if (slot !== 2 && (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1]))) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 2000, 2: 30000, 10: 6000 }[slot], slot);
    let packets;
    if (slot === 0) {
      packets = this.shoot(388100, start, dest, now, power, { school: 'energy', basic: true });
    } else if (slot === 1) {
      this.e_count -= 1;
      if (!this.e_next_charge) this.e_next_charge = now + this.skillCooldown(8000);
      const distance = Math.min(480, Math.hypot(start[0] - dest[0], start[1] - dest[1]));
      packets = this.shoot(388201, start, dest, now, power.mul(D('1.47')), {
        school: 'energy', power, range_multiplier: distance / 480, through_walls: true,
      });
    } else {
      // R does not forbid E/Space; their prep is a separate state.
      this.ready = { slot, dest, power, generation: this.generation };
      let [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      this.position = stopped.length ? body : start;
      this.motion = null;
      this._queue(now + (slot === 2 ? 100 : 300), 'chu_ready', this.ready);
      packets = [scene({ skills: [this._skillEvent(SLOTS[slot], start, dest, 0, { ready: 1 })] })]
        .concat(this.syncSpeed(now), stopped);
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as CHUDU_SLOTS, CHANNEL_BUFFS as CHUDU_CHANNEL_BUFFS };
