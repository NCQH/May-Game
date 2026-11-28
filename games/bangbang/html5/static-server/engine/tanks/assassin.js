/* Assassin (tank 10000048): stealth, rolling Space, recast stab, kill marks.
 * Port of server/assassin_actions.py onto the JS battle core.
 *
 * Stubs: no bush/fog visibility (teamVisible is always true on the core), no
 * presentation/skin. Stealth uses the core's info.untargetable flag.
 */
import { TankActions, bkey } from '../arena.js';
import { TableRow } from '../data.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, stop_move, encodeS1572, encodeS1579, encodeS1562 } from '../protocol.js';
import { packII, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 322100, 1: 322201, 2: 322301, 10: 322401 };
const teamVisible = () => true; // stub: no bush/fog visibility on the JS core

export class AssassinActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.space_count = 3;
    this.space_next_charge = 0;
    this.ready = this.dash = null;
    this.marks = new Map();
  }

  _cooldown(slot, changed = false) {
    const recast = slot === 2 && this.hasBuff(322302, this.clock());
    const info = recast
      ? { skillId: 322311, slot, count: -1, end: 0, nextCharge: 0 }
      : {
        skillId: SLOTS[slot], slot, count: slot === 2 ? this.space_count : -1,
        end: this.cooldowns[slot] ?? 0, nextCharge: slot === 2 ? this.space_next_charge : 0,
      };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _basic_slot() { return [this._cooldown(0, true), this._cooldown(0)]; }
  _space_slot() { return [this._cooldown(2, true), this._cooldown(2)]; }

  _stab_target(start, cursor, now) {
    const candidates = [];
    for (const actor of this.arena.actors.values()) {
      if (![1, 2].includes(actor.camp) || actor.camp === this.camp || !actor.alive
        || actor.info.npc_template || actor.isUntargetable()) continue;
      const types = actor.buffTypes(now);
      if ((types.has(26) && !types.has(32)) || !teamVisible(this.arena, this, actor, now)) continue;
      const span = Math.hypot(start[0] - actor.positionAt(now)[0], start[1] - actor.positionAt(now)[1]);
      if (span > 0 && span <= 300) {
        candidates.push([actor, span,
          Math.hypot(cursor[0] - actor.positionAt(now)[0], cursor[1] - actor.positionAt(now)[1])]);
      }
    }
    const near = candidates.filter(row => row[2] <= 72);
    const pool = near.length ? near : candidates;
    if (!pool.length) return null;
    pool.sort((a, b) => (near.length ? a[2] - b[2] : a[0].hp.div(a[0].maxHp).toNumber()
      - b[0].hp.div(b[0].maxHp).toNumber()) || a[1] - b[1] || a[0].id - b[0].id);
    return pool[0][0];
  }

  _isolated(now) {
    const pos = this.positionAt(now);
    return ![...this.arena.actors.values()].some(a => a.id !== this.id && a.alive
      && a.camp === this.camp && !a.info.map_object
      && Math.hypot(pos[0] - a.positionAt(now)[0], pos[1] - a.positionAt(now)[1]) <= 300);
  }

  attr_bonus(attributes, now) {
    const value = super.attr_bonus(attributes, now);
    // This conditional buff means damage, not AP/EN or healing strength.
    return attributes.includes(1) && this.hasBuff(322101, now) ? value.sub(D('.25')) : value;
  }

  _visibility(now) {
    const types = this.buffTypes(now);
    this.info.untargetable = types.has(26) && !types.has(32);
  }

  _speed(now) {
    let value = super._speed(now);
    if (this.hasBuff(322113, now) && this.hasBuff(322203, now)) {
      value -= pyRound(Number(this.stats.iSpeed) * 0.25);
    }
    return Math.max(0, value);
  }

  on_spawn(now) {
    const packets = [];
    for (const template of [322102, 322103]) packets.push(...this._buff(template, now));
    this._visibility(now);
    return packets.concat(this._basic_slot(), this._space_slot());
  }

  update(now) {
    const packets = [];
    if (this.dash !== null && this.motion === null) packets.push(...this._end_dash(now));
    const isolated = this.alive && this._isolated(now);
    if (isolated && !this.hasBuff(322101, now)) packets.push(...this._buff(322101, now));
    else if (!isolated && this.hasBuff(322101, now)) packets.push(...this.removeBuff(322101, now));
    this._visibility(now);
    if (this.space_next_charge && now >= this.space_next_charge) {
      while (this.space_count < 3 && now >= this.space_next_charge) {
        this.space_count += 1;
        this.space_next_charge += this.skillCooldown(6000);
      }
      if (this.space_count === 3) this.space_next_charge = 0;
      packets.push(this._cooldown(2));
    }
    return packets.concat(super.update(now));
  }

  // The core calls camelCase removeBuff; keep the Python spelling as an alias.
  removeBuff(template, now, { expired = false } = {}) {
    const key = bkey(this.id, template);
    const existed = this.activeBuffs.has(key);
    const packets = super.removeBuff(template, now, { expired });
    if (template === 322201 && existed) {
      for (const other of [322202, 322203, 322204]) {
        packets.push(...super.removeBuff(other, now, { expired: false }));
      }
      if (this.alive) {
        for (const other of [322211, 322212, 322213, 322214]) {
          packets.push(...this._buff(other, now, null, { duration: 3000 }));
        }
      }
    }
    if (template === 322302 && existed) packets.push(...this._space_slot());
    if ([322201, 322202, 322303].includes(template)) this._visibility(now);
    return packets;
  }

  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  _reveal(now) { return this.removeBuff(322201, now).concat(this.removeBuff(322303, now)); }

  blocked(action, now) {
    return super.blocked(action, now) || this.ready !== null || this.dash !== null;
  }

  _end_dash(now) {
    let pos = this.positionAt(now);
    if (this.dash) pos = this.moveDestination(this.dash.start ?? pos, pos);
    this.position = pos;
    this.motion = null;
    this.forcedUntil = now;
    this.dash = null;
    const packets = [stop_move(this.sceneId, this.id, this.position)];
    for (const template of [322311, 322312, 322341, 50353]) {
      packets.push(...this.removeBuff(template, now));
    }
    return packets.concat(this.syncSpeed(now));
  }

  interrupt(now) {
    const packets = this.dash ? this._end_dash(now) : [];
    if (this.ready) {
      this.ready = null;
      packets.push([1583, packII(this.id, 322401)]);
    }
    if (!this.alive) this.info.untargetable = false;
    return packets;
  }

  on_target_death(target) {
    this.marks.delete(target.id);
    return [];
  }

  _deal(raw, target, now, generation, {
    basic = false, school = 'physical', multiplier = null, critical_handled = false,
  } = {}) {
    const value = multiplier === null
      ? (this._isolated(now) ? D('1.25') : D(1)) : multiplier;
    const was_alive = target.alive;
    const [packets] = this.damage(raw.mul(value), now, {
      target, basic, school, critical_handled, critical_display: critical_handled,
    });
    if (this.arena.pk && this.arena.pk.finished) return packets;
    if (was_alive && !target.alive && this.alive && generation === this.generation) {
      this.cooldowns[1] = this.cooldowns[10] = 0;
      packets.push(this._cooldown(1), this._cooldown(10), ...this._buff(322113, now));
    }
    return packets;
  }

  _mark(target, power, generation, now) {
    if (!target.alive) return [];
    if (target.rejectBuff(new TableRow({ nEffectType: '201' }), this, now)) return [];
    const packets = [];
    for (const template of [322402, 322403, 322404, 322405, 322406, 322407, 322409]) {
      packets.push(...this._buff(template, now, target.id));
    }
    if (!target.hasBuff(322404, now) || target.buffSources.get(322404) !== this.id) return packets;
    const mark = {
      target_generation: target.generation, source_generation: generation, power,
      version: target.buffVersions.get(322404), end: now + 3000, first: true,
      multiplier: this._isolated(now) ? D('1.25') : D(1),
    };
    this.marks.set(target.id, mark);
    this._queue(now + 3000, 'assassin_mark_end', target.id, mark);
    return packets;
  }

  _own_mark(target, now) {
    const mark = this.marks.get(target.id);
    return mark && mark.end > now && mark.target_generation === target.generation
      && target.hasBuff(322404, now)
      && target.buffVersions.get(322404) === mark.version ? mark : null;
  }

  _basic_hit(target, power, generation, now, { stab = false, critical = false } = {}) {
    const mark = this._own_mark(target, now);
    const ratio = stab ? D('1.8') : D(1);
    let amp = mark ? D('.25') : D(0);
    if (stab && target.hasBuff(322322, now) && target.buffSources.get(322322) === this.id) {
      amp = amp.add(D('.25').mul(target.buffStacks.get(322322) ?? 1));
    }
    const raw = power.mul(ratio).mul(D(1).add(amp)).mul(critical ? D('1.5') : D(1));
    const packets = this._deal(raw, target, now, generation, { basic: true, critical_handled: critical });
    if (this.arena.pk && this.arena.pk.finished) return packets;
    if (mark && mark.first && generation === mark.source_generation && generation === this.generation
      && this.alive) {
      mark.first = false;
      packets.push(...this.restoreHp(power.mul(D('1.5')), now));
      packets.push(...this._buff(322422, now), ...this._buff(322431, now, target.id));
    }
    if (stab) {
      packets.push(...this._buff(322322, now, target.id), ...this._buff(322323, now, target.id));
      packets.push(scene({ skills: [this._skillEvent(322321, this.positionAt(now),
        target.positionAt(now), target.id)] }));
    }
    return packets;
  }

  _flight(flight, now) {
    const start = pointAt(flight.start, flight.end,
      (flight.previous - flight.begin) / (flight.finish - flight.begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
    const contacts = [];
    for (const target of this.arena.actors.values()) {
      if (target.alive && target.camp !== this.camp
        && !flight.hits.has(`${target.id},${target.generation}`)) {
        const hit = actorContact(start, end, target, flight.previous, now);
        if (hit !== null) contacts.push([hit, target.id]);
      }
    }
    const wall = flight.template === 322100 ? this.arena.geometry.wallContact(start, end) : null;
    const packets = [];
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [contact, ident] of contacts) {
      if (wall !== null && contact >= wall) break;
      const target = this.arena.actors.get(ident);
      flight.hits.add(`${ident},${target.generation}`);
      if (this.projectileBlocked(target, now)) {
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
      if (flight.template === 322100) {
        packets.push(...this._basic_hit(target, flight.power, flight.source_generation, now,
          { critical: flight.proc }));
        return packets.concat([scene({ blownBullets: [flight.id] })]);
      }
      packets.push(...this._deal(flight.raw, target, now, flight.source_generation));
      packets.push(...this._mark(target, flight.power, flight.source_generation, now));
    }
    if (now >= flight.finish || wall !== null) {
      return packets.concat([scene(wall !== null
        ? { blownBullets: [flight.id] } : { expiredBullets: [flight.id] })]);
    }
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return packets;
  }

  _start_dash(start, dest, now, kind, extra = {}) {
    const duration = this._setMotion(start, dest, 720, now, kind === 'roll' ? 4 : 3);
    this.forcedUntil = now + duration;
    this.dash = {
      kind, start, previous: now, generation: this.generation, hits: new Set(), ...extra,
    };
    this._queue(now + Math.min(20, duration), 'assassin_dash', this.dash);
    // 322311 is a visual face buff, not BUT_AUTO_MOVE.
    return this._buff(50353, now).concat([
      stop_move(this.sceneId, this.id, start),
      scene({ moves: [this._moveEvent(this.motion[1], 720, this.motionKind)] }),
    ]);
  }

  _dash_step(dash, now) {
    if (this.arena.pk && this.arena.pk.finished) {
      this.dash = null;
      return [];
    }
    if (this.dash !== dash || !this.alive || dash.generation !== this.generation) return [];
    if (this.motion === null) return this._end_dash(now);
    const start = this.positionAt(dash.previous);
    const end = this.positionAt(now);
    const packets = [];
    let touched = false;
    if (dash.kind !== 'roll') {
      for (const target of [...this.arena.actors.values()]) {
        const key = `${target.id},${target.generation}`;
        if (!(target.alive && target.camp !== this.camp) || dash.hits.has(key)) continue;
        const hit = actorContact(start, end, target, dash.previous, now);
        if (hit === null) continue;
        dash.hits.add(key);
        packets.push(...this._basic_hit(target, dash.power, dash.generation, now,
          { stab: true, critical: dash.critical }));
        if (this.arena.pk && this.arena.pk.finished) {
          this.dash = null;
          return packets;
        }
        if (this.dash !== dash) return packets;
        if (this.motion === null) return packets.concat(this._end_dash(now));
        touched = touched || target.id === dash.target;
      }
    }
    if (dash.kind === 'track') {
      const target = this.arena.actors.get(dash.target);
      if (touched || now >= this.motion[3] || !target.alive
        || target.generation !== dash.target_generation) {
        let direction = this.motion[1];
        if (direction[0] === start[0] && direction[1] === start[1]) direction = dash.aim;
        const span = Math.hypot(start[0] - end[0], start[1] - end[1]);
        const aimSpan = Math.max(1, Math.hypot(start[0] - direction[0], start[1] - direction[1]));
        const dest = pointAt(start, direction, (span + 240) / aimSpan);
        dash.kind = 'pierce';
        this._setMotion(end, dest, 720, now, 4);
        this.forcedUntil = this.motion[3];
        packets.push(...this.removeBuff(322312, now));
        for (const template of [322332, 322341]) packets.push(...this._buff(template, now));
        packets.push(scene({ moves: [this._moveEvent(this.motion[1], 720, 4)] }));
      } else if (target.positionAt(now)[0] !== this.motion[1][0]
        || target.positionAt(now)[1] !== this.motion[1][1]) {
        this._setMotion(end, target.positionAt(now), 720, now, 3);
        this.forcedUntil = this.motion[3];
        packets.push(scene({ moves: [this._moveEvent(this.motion[1], 720, 3)] }));
      }
    } else if (now >= this.motion[3]) {
      return packets.concat(this._end_dash(now));
    }
    dash.previous = now;
    if (this.motion) this._queue(Math.min(now + 20, this.motion[3]), 'assassin_dash', dash);
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'assassin_dash') return this._dash_step(data[0], now);
    if (kind === 'assassin_warn') {
      const [generation, version] = data;
      if (generation !== this.generation || !this.hasBuff(322201, now)
        || this.buffVersions.get(322201) !== version) return [];
      const packets = [];
      for (const target of this.arena.actors.values()) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(this.positionAt(now)[0] - target.positionAt(now)[0],
            this.positionAt(now)[1] - target.positionAt(now)[1]) <= 600) {
          packets.push(...this._buff(305221, now, target.id));
        }
      }
      this._queue(now + 1000, 'assassin_warn', generation, version);
      return packets;
    }
    if (kind === 'assassin_ready') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || cast.generation !== this.generation) return [];
      this.ready = null;
      return this.shoot(322401, this.positionAt(now), cast.dest, now, cast.power.mul(D('1.25')),
        { school: 'physical', power: cast.power, through_walls: true });
    }
    if (kind === 'assassin_mark_end') {
      const [ident, mark] = data;
      const target = this.arena.actors.get(ident);
      if (this.marks.get(ident) !== mark) return [];
      this.marks.delete(ident);
      if (!target.alive || target.generation !== mark.target_generation
        || target.buffVersions.get(322404) !== mark.version) return [];
      return this._deal(target.maxHp.sub(target.hp).mul(D('.2')), target, now,
        mark.source_generation, { school: 'true', multiplier: mark.multiplier })
        .concat(this._buff(322412, now, target.id));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    const recast = slot === 2 && this.hasBuff(322302, now);
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || (!recast && this.cooldowns[slot] > now)) return [];
    if (slot === 1) {
      if (this.hasBuff(322201, now)) return [];
      this.cooldowns[1] = now + this.skillCooldown(10000, 1);
      const packets = [];
      for (const template of [322201, 322202, 322203, 322204]) {
        packets.push(...this._buff(template, now));
      }
      this._queue(now + 1000, 'assassin_warn', this.generation, this.buffVersions.get(322201));
      this._visibility(now);
      return packets.concat([this._cooldown(1),
        scene({ skills: [this._skillEvent(322201, start, start, this.id)] })]);
    }
    if (recast) {
      const target = this._stab_target(start, dest, now);
      if (target === null) return [];
      dest = target.positionAt(now);
      const packets = this._reveal(now);
      packets.push(...this.removeBuff(322302, now), ...this.removeBuff(322307, now));
      packets.push(...this._buff(322312, now));
      packets.push(scene({ skills: [this._skillEvent(322311, start, dest, target.id)] }));
      return packets.concat(this._start_dash(start, dest, now, 'track', {
        target: target.id, target_generation: target.generation, aim: dest,
        power: this.combatStat('iAttack', now), critical: this.hasBuff(322212, now),
      }));
    }
    if (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1])) return [];
    if (slot === 2 && this.space_count <= 0) return [];
    const packets = [0, 10].includes(slot) ? this._reveal(now) : [];
    const power = this.combatStat('iAttack', now);
    if (slot === 0) {
      this.cooldowns[0] = now + this.fireInterval(now);
      return packets.concat(this.shoot(322100, start, dest, now, power, {
        school: 'physical', basic: true, power, proc: this.hasBuff(322212, now),
      }));
    }
    if (slot === 10) {
      this.cooldowns[10] = now + this.skillCooldown(8000, 10);
      this.ready = { slot: 10, dest, power, generation: this.generation };
      this._queue(now + 100, 'assassin_ready', this.ready);
      let [origin, stopped] = prepareDisplacement(this, now, { interrupt: false, cancelMotion: true });
      this.position = stopped.length ? origin : start;
      this.motion = null;
      return packets.concat([this._cooldown(10),
        scene({ skills: [this._skillEvent(322401, start, dest, 0, { ready: 1 })] })], stopped);
    }
    this.space_count -= 1;
    if (!this.space_next_charge) this.space_next_charge = now + this.skillCooldown(6000);
    this.cooldowns[2] = now + this.skillCooldown(1000, 2);
    const span = Math.hypot(dest[0] - start[0], dest[1] - start[1]);
    dest = this.moveDestination(start, pointAt(start, dest, 240 / span));
    for (const template of [322302, 322303, 322304, 322305, 322306, 322307, 322311]) {
      packets.push(...this._buff(template, now, null, template === 322303 ? { duration: 500 } : {}));
    }
    this._visibility(now);
    packets.push(...this._space_slot());
    // Original exhibit 104801 is a fire sound only; expire the visual at once.
    const ident = this._newId(2);
    packets.push(scene({
      fires: [{ bulletId: ident, ownerId: this.id, start, dest, speed: 720, templateId: 322301 }],
      expiredBullets: [ident],
    }));
    return packets.concat(this._start_dash(start, dest, now, 'roll'));
  }
}

export { SLOTS as ASSASSIN_SLOTS };
