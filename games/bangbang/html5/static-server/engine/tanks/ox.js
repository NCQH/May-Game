/* Ox King (tank 10000103): HP thresholds, shield conversion, carry dash.
 * Port of server/ox_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. V1 energy-armor stacks and the 5% max-HP
 * shield conversion are kept.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';
import { packII, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 378100, 1: 378201, 2: 378301, 10: 378401 };

export class OxActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = this.dash = null;
    this.r_count = 2;
    this.r_next_charge = 0;
    this.received = D(0);
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: slot === 10 ? this.r_count : -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: slot === 10 ? this.r_next_charge : 0,
    })];
  }

  on_spawn(now) {
    this.received = D(0);
    this._queue(now + 3000, 'ox_periodic', this.generation);
    return this._buff(378111, now).concat(this._buff(378112, now), this._buff(378113, now));
  }

  attr_bonus(attributes, now) {
    let value = super.attr_bonus(attributes, now);
    if (this.hasBuff(378131, now)) {
      const stacks = this.buffStacks.get(378131) ?? 1;
      // User selected V1: +10% energy armor, not native +5% physical.
      if (attributes.includes(6)) value = value.sub(D('.05').mul(stacks));
      if (attributes.includes(7)) value = value.add(D('.1').mul(stacks));
    }
    return value;
  }

  _enemies(center, radius, now) {
    return [...this.arena.actors.values()].filter(a => a.alive && a.camp !== this.camp
      && a.isAreaTargetable()
      && Math.hypot(center[0] - a.positionAt(now)[0], center[1] - a.positionAt(now)[1]) <= radius);
  }

  _cry(now) {
    if (!this.alive || (this.arena.pk && this.arena.pk.finished)) return [];
    const center = this.positionAt(now);
    const power = this.combatStat('iAttack', now);
    const packets = [scene({ skills: [this._skillEvent(378501, center, center, this.id)] })];
    packets.push(...this._buff(378131, now), ...this._buff(378502, now));
    for (const target of this._enemies(center, 240, now)) {
      const stacks = target.hasBuff(378503, now) && target.buffSources.get(378503) === this.id
        ? target.buffStacks.get(378503) ?? 0 : 0;
      packets.push(...this.damage(power.mul(D('.5')).mul(D(1).add(D('.15').mul(stacks))), now,
        { target })[0]);
      if (this.arena.pk && this.arena.pk.finished) return packets;
      packets.push(...this._buff(378503, now, target.id), ...this._buff(378505, now, target.id));
    }
    return packets;
  }

  on_damage(source, hit) {
    if (!this.alive) return [];
    this.received = this.received.add(hit.hp_loss); // excludes shield absorption
    const packets = [];
    const threshold = this.maxHp.mul(D('.1'));
    while (this.received.ge(threshold) && this.alive) {
      this.received = this.received.sub(threshold);
      packets.push(...this._cry(this.arena.eventNow || this.clock()));
    }
    return packets;
  }

  _speed(now) { return this.ready || this.dash ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready || this.dash) || super.blocked(action, now); }

  _finish_dash(now) {
    const cast = this.dash;
    this.dash = null;
    if (!cast) return [];
    this.position = this.positionAt(now);
    this.motion = null;
    this.forcedUntil = now;
    const packets = [scene({ moves: [this._moveEvent(this.position, 0, 5)] })];
    const finished = this.arena.pk && this.arena.pk.finished;
    for (const [ident, held] of Object.entries(cast.held)) {
      const target = this.arena.actors.get(Number(ident));
      if (target.generation === held.generation
        && (target.motion === held.motion || (finished && target.motion === null))) {
        target.position = target.positionAt(now);
        target.motion = null;
        target.forcedUntil = now;
        packets.push(scene({ moves: [this._moveEvent(target.position, 0, 5, target.id)] }));
      }
    }
    return finished ? packets : packets.concat(this.syncSpeed(now));
  }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      const slot = this.ready.slot;
      this.ready = null;
      if (slot === 2) {
        this.cooldowns[slot] = now + this.skillCooldown(5000, slot);
        packets.push(this._cooldown(slot));
      }
      packets.push([1583, packII(this.id, SLOTS[slot])]);
    }
    return packets.concat(this._finish_dash(now), this.syncSpeed(now));
  }

  update(now) {
    const packets = [];
    if (this.ready && this.skillSealed(this.ready.slot, now)) packets.push(...this.interrupt(now));
    while (this.r_next_charge && this.r_next_charge <= now) {
      this.r_count = Math.min(2, this.r_count + 1);
      this.r_next_charge = this.r_count < 2
        ? this.r_next_charge + this.skillCooldown(6000) : 0;
      packets.push(this._cooldown(10));
    }
    return packets.concat(super.update(now));
  }

  _shield(now) {
    const cast = { generation: this.generation, version: 0, amount: this.maxHp.mul(D('.05')) };
    // Queue the fifth conversion before the native shield expiry at 4000.
    for (let index = 1; index <= 5; index += 1) {
      this._queue(now + 800 * index, 'ox_convert', cast);
    }
    const packets = this.addShield(378202, this.maxHp.mul(D('.25')), now)
      .concat(this._buff(378203, now));
    cast.version = this.buffVersions.get(378202) ?? 0;
    return packets;
  }

  _dash_tick(cast, now) {
    if (this.dash !== cast || !this.alive) return [];
    if (!this.motion) return this._finish_dash(now);
    const start = this.positionAt(cast.previous);
    const end = this.positionAt(now);
    const packets = [];
    for (const target of [...this.arena.actors.values()]) {
      const key = `${target.id},${target.generation}`;
      if (!target.alive || target.camp === this.camp || target.isUntargetable()
        || cast.hits.has(key)) continue;
      if (actorContact(start, end, target, cast.previous, now) === null) continue;
      cast.hits.add(key);
      if (!target.ccImmune(now)) {
        packets.push(...target.interrupt(now));
        if (this.dash !== cast) return packets;
        if (!this.motion) return packets.concat(this._finish_dash(now));
        target._setMotion(target.positionAt(now), this.motion[1], 360, now, 1);
        target.forcedUntil = target.motion[3];
        cast.held[target.id] = { generation: target.generation, motion: target.motion };
        packets.push(scene({ moves: [target._moveEvent(target.motion[1], 360, 1)] }));
      }
      packets.push(...this.damage(cast.power.mul(D('1.62')), now, { target })[0]);
      if (this.arena.pk && this.arena.pk.finished) return packets.concat(this._finish_dash(now));
      packets.push(...this._buff(378213, now, target.id));
      if (this.dash !== cast) return packets;
      if (!this.motion) return packets.concat(this._finish_dash(now));
    }
    if (now >= this.motion[3]) return packets.concat(this._finish_dash(now));
    cast.previous = now;
    this._queue(Math.min(now + 20, this.motion[3]), 'ox_dash', cast);
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'ox_periodic') {
      const [generation] = data;
      if (!this.alive || generation !== this.generation) return [];
      this._queue(now + 3000, kind, generation);
      return this._cry(now);
    }
    if (kind === 'ox_convert') {
      const [cast] = data;
      if (!this.alive || cast.generation !== this.generation
        || this.buffVersions.get(378202) !== cast.version) return [];
      const shield = this.shields.find(s => s.shield_id === '378202' && s.expires_ms >= now);
      if (!shield) return [];
      const amount = shield.remaining.min(cast.amount);
      const remaining = shield.remaining.sub(amount);
      this.shields = this.shields.map(s => (s === shield
        ? { ...s, remaining } : s));
      const packets = [this.shieldPacket(now)].concat(this.restoreHp(amount, now));
      if (remaining.isZero()) packets.push(...this.removeBuff(378202, now), ...this.removeBuff(378203, now));
      return packets;
    }
    if (kind === 'ox_dash') return this._dash_tick(data[0], now);
    if (kind === 'ox_after_cc') {
      const [ident, generation, buff, version, slot] = data;
      const target = this.arena.actors.get(ident);
      if (!target.alive || target.generation !== generation
        || target.buffVersions.get(buff) !== version) return [];
      const packets = [];
      for (const template of slot === 2 ? [378302, 378303] : [378411, 378412, 378413]) {
        packets.push(...this._buff(template, now, ident, { duration: slot === 2 ? 2500 : 2000 }));
      }
      return packets;
    }
    if (kind === 'ox_ready') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || cast.generation !== this.generation) return [];
      if (this.skillSealed(cast.slot, now)) return this.interrupt(now);
      this.ready = null;
      const slot = cast.slot;
      const start = this.positionAt(now);
      const packets = this.syncSpeed(now);
      if (slot === 1) {
        const span = Math.max(1, Math.hypot(start[0] - cast.dest[0], start[1] - cast.dest[1]));
        const dest = pointAt(start, cast.dest, Math.min(1, 408 / span));
        const duration = this._setMotion(start, dest, 360, now, 3);
        this.forcedUntil = now + duration;
        this.dash = { ...cast, previous: now, hits: new Set(), held: {} };
        packets.push(...this._shield(now));
        packets.push(scene({ moves: [this._moveEvent(this.motion[1], 360, 3)] }));
        packets.push(...this.syncSpeed(now));
        this._queue(Math.min(now + 20, this.motion[3]), 'ox_dash', this.dash);
        return packets;
      }
      packets.push(scene({ skills: [this._skillEvent(SLOTS[slot], start, cast.dest)] }));
      const span = Math.max(1, Math.hypot(start[0] - cast.dest[0], start[1] - cast.dest[1]));
      const direction = [(cast.dest[0] - start[0]) / span, (cast.dest[1] - start[1]) / span];
      const targets = this._enemies(start, slot === 2 ? Math.hypot(720, 132) : 240, now);
      for (const target of targets) {
        const pos = target.positionAt(now);
        const dx = pos[0] - start[0], dy = pos[1] - start[1];
        if (slot === 2 && !(0 <= dx * direction[0] + dy * direction[1]
          && dx * direction[0] + dy * direction[1] <= 720
          && Math.abs(dx * direction[1] - dy * direction[0]) <= 96 + 36)) continue;
        packets.push(...this.damage(cast.power.mul(D(slot === 2 ? '3.57' : '1')), now,
          { target })[0]);
        if (this.arena.pk && this.arena.pk.finished) return packets;
        const buff = slot === 2 ? 378304 : 378402;
        packets.push(...this._buff(buff, now, target.id));
        if (target.hasBuff(buff, now)) {
          const duration = this.activeBuffs.get(`${target.id},${buff}`)[1] - now;
          this._queue(now + duration, 'ox_after_cc', target.id, target.generation,
            buff, target.buffVersions.get(buff), slot);
          if (slot === 10 && (pos[0] !== start[0] || pos[1] !== start[1])) {
            const pullSpan = Math.hypot(pos[0] - start[0], pos[1] - start[1]);
            const push = pointAt(start, pos, 1 + 72 / pullSpan);
            const [body, stopped] = prepareDisplacement(target, now, { interrupt: false });
            packets.push(...stopped);
            const travel = target._setMotion(body, push, 360, now, 1);
            target.forcedUntil = now + travel;
            packets.push(scene({ moves: [this._moveEvent(target.motion[1], 360, 1, target.id)] }));
          }
        }
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now || (slot === 10 && !this.r_count)) return [];
    if (slot !== 10 && (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1]))) return [];
    const power = this.combatStat('iAttack', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 8000, 2: 25000, 10: 3000 }[slot], slot);
    if (slot === 0) {
      return this.shoot(378100, start, dest, now, power,
        { school: 'physical', basic: true }).concat([this._cooldown(slot)]);
    }
    if (slot === 10) {
      this.r_count -= 1;
      if (!this.r_next_charge) this.r_next_charge = now + this.skillCooldown(6000);
    }
    const packets = this._cry(now);
    if (!this.alive || (this.arena.pk && this.arena.pk.finished)) {
      return packets.concat([this._cooldown(slot)]);
    }
    let [body, handoff] = prepareDisplacement(this, now, { interrupt: false });
    if (!handoff.length) body = start;
    this.ready = { slot, dest, power, generation: this.generation };
    this.position = body;
    this.motion = null;
    this._queue(now + (slot === 2 ? 1000 : 300), 'ox_ready', this.ready);
    packets.push(scene({ skills: [this._skillEvent(SLOTS[slot], start, dest, 0, { ready: 1 })] }));
    return packets.concat(this.syncSpeed(now), [this._cooldown(slot)], handoff);
  }
}

export { SLOTS as OX_SLOTS };
