/* Naruto (tank 10000044): chakra, four piercing attacks, Rasengan vortex.
 * Port of server/naruto_actions.py onto the JS battle core.
 *
 * Stubs: no borrowed-view (Kakashi) copy of e_hits, no skin effects. The
 * approved basic-hit MP rider calls the same _resource hook Medusa exposes.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, stop_move, encodeS1572, encodeS1579 } from '../protocol.js';
import { drainMp, aimed, enemies, packII, piercingStep, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 318100, 1: 318201, 2: 318301, 10: 318401 };

/** Python promoted e_hits keys are (source_generation, target_id,
 * target_generation) tuples. The core cleanse hook indexes key[1]/key[2], so
 * keep string lookup keys internally but expose tuple-shaped keys(). */
class HitMap {
  constructor() { this.entries = new Map(); }
  static keyOf(key) { return Array.isArray(key) ? key.join(',') : key; }
  get(key) { return this.entries.get(HitMap.keyOf(key)); }
  set(key, value) { this.entries.set(HitMap.keyOf(key), value); return this; }
  has(key) { return this.entries.has(HitMap.keyOf(key)); }
  delete(key) { return this.entries.delete(HitMap.keyOf(key)); }
  clear() { this.entries.clear(); }
  get size() { return this.entries.size; }
  keys() { return [...this.entries.keys()].map(key => key.split(',').map(Number)); }
  [Symbol.iterator]() { return this.entries[Symbol.iterator](); }
}

export class NarutoActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = Number(this.stats.iMp);
    this.shots = 0;
    this.ready = this.dash = this.hitting = null;
    this.assists = new Map();
    this.fields = new Map();
    this.e_hits = new HitMap();
  }

  _cooldown(slot, changed = false) {
    const skill = slot === 0 && this.shots && this.hasBuff(318201, this.clock())
      ? 318211 : SLOTS[slot];
    const info = { skillId: skill, slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0 };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _resource(delta) {
    if (this.noel_box) return [];
    const old = this.mp;
    this.mp = Math.max(0, Math.min(Number(this.stats.iMp), this.mp + delta));
    return old !== this.mp ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  on_spawn(now) {
    this.mp = Number(this.stats.iMp);
    this.shots = 0;
    this.ready = this.dash = this.hitting = null;
    this.assists.clear();
    this.e_hits.clear();
    this._queue(now + 3000, 'naruto_energy', this.generation);
    const packets = [scene({ mp: [{ objectId: this.id, mp: this.mp }] }), this._cooldown(0, true)];
    for (const template of [318101, 318102, 318103]) packets.push(...this._buff(template, now));
    return packets;
  }

  // The core calls camelCase removeBuff; keep the Python spelling as an alias.
  removeBuff(template, now, { expired = false } = {}) {
    const packets = super.removeBuff(template, now, { expired });
    if (template === 318201) {
      this.shots = 0;
      packets.push(this._cooldown(0, true));
    }
    return packets;
  }

  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  _deal(target, raw, now, { generation = null, ...options } = {}) {
    generation = generation === null ? this.generation : generation;
    const current = this.alive && this.generation === generation;
    this.hitting = current ? `${target.id},${target.generation}` : null;
    let packets, lost;
    try { [packets, lost] = this.damage(raw, now, { target, ...options }); }
    finally { this.hitting = null; }
    if (lost && current && target.alive && !target.info.npc_template) {
      this.assists.set(`${target.id},${target.generation}`, { end: now + 5000, generation });
    }
    return packets;
  }

  on_target_death(target, now) {
    const key = `${target.id},${target.generation}`;
    const mark = this.assists.get(key) || null;
    this.assists.delete(key);
    if (!this.alive || target.camp === this.camp || target.info.npc_template
      || !(this.hitting === key || (mark && mark.end >= now && mark.generation === this.generation))) {
      return [];
    }
    const packets = this._resource(50);
    for (const template of [318111, 318112, 318113, 318115, 318116, 318117]) {
      packets.push(...this._buff(template, now));
    }
    return packets;
  }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready || this.dash) || super.blocked(action, now); }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      this.ready = null;
      this.cooldowns[2] = now + this.skillCooldown(5000, 2);
      packets.push([1583, packII(this.id, 318301)], this._cooldown(2));
    }
    if (this.dash) {
      this.dash = null;
      packets.push(...this.remove_buff(318416, now));
    }
    return packets.concat(this.syncSpeed(now));
  }

  on_control(source, template, now) {
    if (this.ready && [30, 35, 66].includes(Number(this.arena.data
      .tableRow('BuffTemplate_table.xml', { nBuffId: template }).get('nEffectType')))) {
      return this.interrupt(now);
    }
    return [];
  }

  update(now) {
    for (const [key, value] of [...this.assists]) if (!(value.end > now)) this.assists.delete(key);
    for (const [key, value] of [...this.e_hits]) if (!(value.end > now)) this.e_hits.delete(key);
    const packets = this.ready && this.skillSealed(2, now) ? this.interrupt(now) : [];
    return packets.concat(super.update(now));
  }

  _basic_hit(flight, target, now) {
    const current = this.alive && this.generation === flight.source_generation;
    const enhanced = flight.template === 318211;
    let raw = flight.raw;
    if (enhanced) {
      const span = Math.hypot(this.positionAt(now)[0] - target.positionAt(now)[0],
        this.positionAt(now)[1] - target.positionAt(now)[1]);
      raw = raw.mul(D('.75').add(D(String(span)).div(D(480)).min(D(1))));
    }
    if (target.hasBuff(318313, now) && target.buffSources.get(318313) === this.id) {
      raw = raw.mul(D('1.5'));
    }
    const packets = this._deal(target, raw, now, {
      generation: flight.source_generation, basic: true,
      lifesteal: current ? flight.lifesteal : 0,
    });
    if (current) {
      packets.push(...drainMp(target, 5, now), ...this._resource(5));
      for (const [slot, base] of [[1, 5000], [2, 25000], [10, 8000]]) {
        this.cooldowns[slot] = Math.max(now, this.cooldowns[slot] - Math.floor(base / 20));
        packets.push(this._cooldown(slot));
      }
    }
    if (enhanced && target.alive) {
      const key = `${flight.source_generation},${target.id},${target.generation}`;
      const mark = this.e_hits.get(key);
      const count = mark && mark.end > now ? mark.count : 0;
      for (const template of [318212, 318213, 318214]) {
        if (target.buffSources.get(template) === this.id) packets.push(...target.remove_buff(template, now));
      }
      if (count === 3) {
        this.e_hits.delete(key);
        packets.push(...this._deal(target, target.maxHp.mul(D('.1')), now,
          { generation: flight.source_generation, school: 'true' }));
        packets.push(...this._buff(318216, now, target.id));
      } else {
        this.e_hits.set(key, { count: count + 1, end: now + 1500 });
        packets.push(...this._buff(318212 + count, now, target.id));
      }
    }
    return packets;
  }

  _vortex(flight, pos, now) {
    const packets = [];
    for (const target of enemies(this, { area: true })) {
      if (Math.hypot(pos[0] - target.positionAt(now)[0], pos[1] - target.positionAt(now)[1]) <= 144) {
        packets.push(...this._deal(target, flight.power.mul(D('3.5')), now,
          { generation: flight.source_generation }));
        packets.push(...this._buff(318302, now, target.id), ...this._buff(318303, now, target.id));
      }
    }
    const [ident, packet] = this.addObject(318304, pos);
    packets.push(packet);
    this.fields.set(ident, { pos, power: flight.power, generation: flight.source_generation });
    this._queue(now + 500, 'naruto_vortex', ident, 1);
    return packets;
  }

  _flight(flight, now) {
    if (flight.template !== 318301) {
      return piercingStep(this, flight, now, (f, t, n) => this._basic_hit(f, t, n),
        { pierce: flight.template === 318211 });
    }
    const start = pointAt(flight.start, flight.end,
      (flight.previous - flight.begin) / (flight.finish - flight.begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
    const contacts = [];
    for (const target of enemies(this)) {
      const hit = actorContact(start, end, target, flight.previous, now);
      if (hit !== null) contacts.push([hit, target.id, target]);
    }
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const contact = contacts.length ? contacts[0] : null;
    if (contact && this.projectileBlocked(contact[2], now)) {
      return [scene({ expiredBullets: [flight.id] })];
    }
    if (contact || now >= flight.finish) {
      const pos = pointAt(start, end, contact ? contact[0] : 1).map(pyRound);
      return [scene({ blownBullets: [flight.id] })].concat(this._vortex(flight, pos, now));
    }
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return [];
  }

  _event(now, kind, data) {
    if (kind === 'naruto_energy') {
      if (data[0] !== this.generation || !this.alive) return [];
      this._queue(now + 3000, kind, this.generation);
      return this._resource(10);
    }
    if (kind === 'naruto_space') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      return this.shoot(318301, cast.start, cast.dest, now, 0,
        { school: 'physical', power: cast.power, through_walls: true }).concat(this.syncSpeed(now));
    }
    if (kind === 'naruto_vortex') {
      const [ident, index] = data;
      const cast = this.fields.get(ident);
      if (!cast) return [];
      const packets = [];
      for (const target of enemies(this, { area: true })) {
        if (Math.hypot(cast.pos[0] - target.positionAt(now)[0],
          cast.pos[1] - target.positionAt(now)[1]) <= 144) {
          packets.push(...this._buff(318311, now, target.id), ...this._buff(318313, now, target.id));
          packets.push(...this._deal(target, cast.power.mul(D('.5')), now,
            { generation: cast.generation, periodic: true }));
        }
      }
      if (index < 8) this._queue(now + 500, kind, ident, index + 1);
      else {
        this.fields.delete(ident);
        packets.push(...this.removeObject(ident, { destroyed: true }));
      }
      return packets;
    }
    if (kind === 'naruto_dash') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive) return [];
      const start = this.positionAt(cast.previous), end = this.positionAt(now);
      const contacts = [];
      for (const target of enemies(this)) {
        const hit = actorContact(start, end, target, cast.previous, now);
        if (hit !== null) contacts.push([hit, target.id, target]);
      }
      if (contacts.length) {
        contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const impact = pointAt(start, end, contacts[0][0]).map(pyRound);
        const pos = this.stopPosition(now, impact);
        this.dash = null;
        this.position = pos;
        this.motion = null;
        const packets = this.remove_buff(318416, now).concat([
          stop_move(this.sceneId, this.id, pos),
          scene({ skills: [this._skillEvent(318411, impact, cast.dest)] }),
        ]);
        for (const target of enemies(this, { area: true })) {
          const tpos = target.positionAt(now);
          const span = Math.hypot(impact[0] - tpos[0], impact[1] - tpos[1]);
          if (span > 144) continue;
          packets.push(...this._deal(target, cast.power.mul(D('1.96')), now));
          if (this.arena.pk && this.arena.pk.finished) return packets;
          if (target.alive && !target.ccImmune(now) && span > 72) {
            const [body, stopped] = prepareDisplacement(target, now, { interrupt: false });
            const dest = target.moveDestination(body, pointAt(impact, tpos, 72 / span));
            packets.push(...target.interrupt(now), ...stopped);
            target.position = dest;
            target.motion = null;
            target.forcedUntil = now;
            packets.push(scene({ moves: [this._moveEvent(dest, 0, 5, target.id)] }));
          }
          packets.push(...this._buff(318413, now, target.id));
        }
        const dest = [pos[0] - cast.direction[0] * 240, pos[1] - cast.direction[1] * 240];
        const duration = this._setMotion(pos, dest, 960, now, 4);
        this.forcedUntil = now + duration;
        return packets.concat(this._resource(25), this._buff(318414, now), this._buff(318415, now),
          [scene({ moves: [this._moveEvent(this.motion[1], 960, 4)] })]);
      }
      if (!this.motion || now >= this.motion[3]) {
        this.dash = null;
        return this.remove_buff(318416, now);
      }
      cast.previous = now;
      this._queue(Math.min(now + 20, this.motion[3]), kind, cast);
      return [];
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if ([0, 2, 10].includes(slot) && start[0] === dest[0] && start[1] === dest[1]) return [];
    const cost = { 0: 0, 1: 25, 2: 50, 10: 25 }[slot];
    if (this.mp < cost) return [];
    const power = this.combatStat('iAttack', now);
    const packets = this._resource(-cost);
    let handoff = [];
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 5000, 2: 25000, 10: 8000 }[slot], slot);
    if (slot === 0) {
      const enhanced = this.shots > 0 && this.hasBuff(318201, now);
      const nine = this.hasBuff(318111, now);
      packets.push(...this.shoot(enhanced ? 318211 : 318100, start, dest, now,
        power.mul(nine ? D('1.5') : D(1)), {
          school: 'physical', basic: true, lifesteal: nine ? D('.5') : 0, through_walls: enhanced,
        }));
      if (enhanced) {
        this.shots -= 1;
        if (!this.shots) packets.push(...this.remove_buff(318201, now));
      }
    } else if (slot === 1) {
      this.shots = 4;
      packets.push(...this._buff(318201, now), ...this._buff(318202, now));
      packets.push(this._cooldown(0, true));
    } else if (slot === 2) {
      let body;
      [body, handoff] = prepareDisplacement(this, now, { interrupt: false });
      if (!handoff.length) body = start;
      this.position = body;
      this.motion = null;
      this.ready = { slot: 2, start, dest, power, end: now + 500 };
      this._queue(now + 500, 'naruto_space', this.ready);
      packets.push(scene({ skills: [this._skillEvent(318301, start, dest, 0, { ready: 1 })] }));
    } else {
      const span = Math.hypot(dest[0] - start[0], dest[1] - start[1]);
      const direction = [(dest[0] - start[0]) / span, (dest[1] - start[1]) / span];
      let body, stopped;
      [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      if (!stopped.length) body = start;
      const duration = this._setMotion(body, aimed(start, dest, 480), 960, now, 3);
      this.forcedUntil = now + duration;
      this.dash = { start, dest: this.motion[1], power, previous: now, direction };
      this._queue(now + Math.min(20, duration), 'naruto_dash', this.dash);
      packets.push(...this._buff(318402, now), ...this._buff(318416, now));
      packets.push(...stopped);
      packets.push(scene({ skills: [this._skillEvent(318401, start, this.motion[1])] }),
        scene({ moves: [this._moveEvent(this.motion[1], 960, 3)] }));
    }
    return packets.concat([this._cooldown(slot)], this.syncSpeed(now), handoff);
  }
}

export { SLOTS as NARUTO_SLOTS };
