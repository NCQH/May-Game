/* Zoro (tank 10000077): Oni marks, three-shot scatter and native S1590/C510
 * reflection aim. Port of server/zoro_actions.py.
 *
 * Stubs: no skin/presentation. A reflected projectile asks the client with
 * S1590; bots use arena.botBrains.get(id).aim, else the current position.
 */
import { TankActions, human, privatePacket } from '../arena.js';
import { D, pyRound } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';
import { aimed, enemies, inStrip, packII, piercingStep, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 351100, 1: 351201, 2: 351301, 10: 351401 };

export class ZoroActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = null;
    this.space_count = 3;
    this.space_next_charge = 0;
    this.scatter_count = 0;
    this.marks = new Map();
    this.reflections = [];
  }

  _cooldown(slot) {
    if (!(slot in SLOTS)) {
      return [1572, encodeS1572(this.id, {
        skillId: this.skillForSlot(slot) ?? 0, slot, count: -1,
        end: this.cooldowns[slot] ?? 0, nextCharge: 0,
      })];
    }
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot,
      count: slot === 2 ? this.space_count : -1,
      end: this.cooldowns[slot],
      nextCharge: slot === 2 ? this.space_next_charge : 0,
    })];
  }

  on_spawn(now) {
    this.reflections = [];
    return this._buff(351101, now);
  }

  _mark(target, now, generation) {
    const packets = [];
    for (const template of [351111, 351112, 351113]) {
      packets.push(...this._buff(template, now, target.id));
    }
    if (target.hasBuff(351112, now) && target.buffSources.get(351112) === this.id) {
      this.marks.set(target.id, {
        generation, target_generation: target.generation, end: now + 3000,
        version: target.buffVersions.get(351112),
      });
    }
    return packets;
  }

  on_target_death(target, now) {
    const mark = this.marks.get(target.id);
    this.marks.delete(target.id);
    if (!(mark && mark.end > now && mark.generation === this.generation && this.alive
      && mark.target_generation === target.generation
      && target.buffVersions.get(351112) === mark.version
      && target.buffSources.get(351112) === this.id)) return [];
    this.cooldowns[1] = now;
    const pos = this.positionAt(now);
    return [this._cooldown(1), scene({ skills: [this._skillEvent(351121, pos, pos)] })];
  }

  _basicHit(flight, target, now) {
    const mark = this.marks.get(target.id);
    const marked = Boolean(mark && mark.end > now && mark.target_generation === target.generation
      && target.hasBuff(351112, now) && target.buffSources.get(351112) === this.id);
    const packets = this.damage(flight.raw, now, { target, basic: true })[0];
    if (marked && this.alive && this.generation === flight.source_generation
      && flight.source_generation === mark.generation) {
      packets.push(...this._mark(target, now, mark.generation));
      packets.push(...this.restoreHp(flight.attacker_ap.mul(D('.25')), now));
      for (const slot of [1, 10]) {
        this.cooldowns[slot] = Math.max(now, this.cooldowns[slot] - 500);
        packets.push(this._cooldown(slot));
      }
      if (this.space_next_charge) {
        this.space_next_charge = Math.max(now, this.space_next_charge - 500);
        packets.push(this._cooldown(2));
      }
    }
    return packets;
  }

  _skillHit(flight, target, now) {
    const missing = target.maxHp.sub(target.hp);
    const packets = this._mark(target, now, flight.source_generation);
    packets.push(...this.damage(flight.raw, now,
      { target, reflected: flight.reflected ?? false })[0]);
    if (flight.template === 351301) {
      packets.push(...this.damage(missing.mul(D('.05')), now, { target, school: 'true' })[0]);
      packets.push(...this._buff(351303, now, target.id));
    }
    return packets;
  }

  _flight(flight, now) {
    if (flight.template === 351100) {
      return piercingStep(this, flight, now, (f, t, n) => this._basicHit(f, t, n),
        { pierce: false });
    }
    return piercingStep(this, flight, now, (f, t, n) => this._skillHit(f, t, n));
  }

  // Core projectileBlocked calls this snake_case hook directly.
  reflect_projectile(flight, now) {
    if (flight.reflected) return;
    this._queue(now, 'zoro_reflect', {
      generation: this.generation, power: this.combatStat('iAttack', now), end: now + 2000,
    });
  }

  _event(now, kind, data) {
    if (kind === 'zoro_reflect') {
      const [request] = data;
      if (!this.alive || this.generation !== request.generation) return [];
      this.reflections.push(request);
      if (human(this)) return [privatePacket(this, [1590, new Uint8Array(0)])];
      const dest = this.arena.botBrains.get(this.id)?.aim ?? this.positionAt(now);
      return this._reflectReply(dest, now);
    }
    if (kind === 'zoro_blink') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      this.position = this.blinkDestination(cast.start, cast.dest);
      this.motion = null;
      const packets = [scene({
        moves: [this._moveEvent(this.position, 0, 5)],
        skills: [this._skillEvent(351201, cast.start, this.position)],
      })];
      const span = Math.min(432, Math.hypot(cast.start[0] - this.position[0],
        cast.start[1] - this.position[1]));
      for (const target of enemies(this, { area: true })) {
        if (inStrip(target.positionAt(now), cast.start, this.position, span, 96)) {
          packets.push(...this._buff(351202, now, target.id));
          packets.push(...this._mark(target, now, cast.generation));
          packets.push(...this.damage(cast.power.mul(D('2.07')), now, { target })[0]);
        }
      }
      this.scatter_count = 3;
      for (const template of [351204, 351205, 351206]) {
        packets.push(...this._buff(template, now));
      }
      return packets.concat(this.syncSpeed(now));
    }
    return super._event(now, kind, data);
  }

  _reflectReply(dest, now) {
    if (!this.reflections.length) return [];
    const request = this.reflections.shift();
    const start = this.positionAt(now);
    if (!this.alive || this.generation !== request.generation || request.end < now
      || (start[0] === dest[0] && start[1] === dest[1])) return [];
    return this.shoot(351411, start, dest, now, request.power.mul(D('1.5')),
      { school: 'physical', reflected: true, through_walls: true });
  }

  handle(message, payload) {
    if (message === 510) {
      const now = this.clock();
      const packets = this.arena.tick(now);
      if (!this.arena.inputOpen(now, this)) return packets;
      if (payload.length >= 12) {
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        if (view.getUint32(0, true) === this.sceneId) {
          packets.push(...this._reflectReply([view.getInt16(8, true), view.getInt16(10, true)],
            this.clock()));
        }
      }
      return packets; // C510 replies to S1590, never an unsolicited basic.
    }
    return super.handle(message, payload);
  }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      this.ready = null;
      packets.push([1583, packII(this.id, 351201)]);
    }
    for (const template of [351401, 351402]) packets.push(...this.removeBuff(template, now));
    return packets.concat(this.syncSpeed(now));
  }

  update(now) {
    const packets = [];
    while (this.space_next_charge && this.space_next_charge <= now) {
      this.space_count = Math.min(3, this.space_count + 1);
      this.space_next_charge = this.space_count < 3
        ? this.space_next_charge + this.skillCooldown(10000) : 0;
      packets.push(this._cooldown(2));
    }
    if ((this.ready && this.skillSealed(1, now))
      || (this.hasBuff(351401, now) && this.skillSealed(10, now))) {
      packets.push(...this.interrupt(now));
    }
    for (const [key, value] of [...this.marks]) {
      if (!(value.end > now)) this.marks.delete(key);
    }
    return packets.concat(super.update(now));
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if ((slot !== 10 && ((start[0] === dest[0] && start[1] === dest[1])
      || !this._inside(dest))) || (slot === 2 && !this.space_count)) return [];
    const power = this.combatStat('iAttack', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 10000, 2: 1500, 10: 10000 }[slot], slot);
    if (slot === 2) {
      this.space_count -= 1;
      if (!this.space_next_charge) this.space_next_charge = now + this.skillCooldown(10000);
    }
    const packets = [this._cooldown(slot)];
    if (slot === 0) {
      const scatter = this.hasBuff(351204, now) && this.scatter_count > 0;
      if (scatter) {
        this.scatter_count -= 1;
        if (!this.scatter_count) packets.push(...this.removeBuff(351204, now));
      }
      const angle = Math.atan2(dest[1] - start[1], dest[0] - start[0]);
      const hits = new Set();
      for (const offset of scatter ? [-15, 0, 15] : [0]) {
        const direction = angle + offset * Math.PI / 180;
        const aim = [pyRound(start[0] + 336 * Math.cos(direction)),
          pyRound(start[1] + 336 * Math.sin(direction))];
        packets.push(...this.shoot(351100, start, aim, now, power,
          { school: 'physical', basic: true, shared_hits: scatter ? hits : null }));
      }
      return packets;
    }
    if (slot === 10) {
      return packets.concat(this._buff(351401, now), this._buff(351402, now));
    }
    if (slot === 2) {
      return packets.concat(this.shoot(351301, start, dest, now, power.mul(D('3.22')),
        { school: 'physical', through_walls: true }));
    }
    let body, stopped;
    [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
    this.position = stopped.length ? body : start;
    this.motion = null;
    this.ready = {
      slot: 1, start, dest: aimed(start, dest, 456, { fixed: true }), power,
      generation: this.generation,
    };
    this._queue(now + 50, 'zoro_blink', this.ready);
    return packets.concat([
      scene({ skills: [this._skillEvent(351201, start, this.ready.dest, 0, { ready: 1 })] }),
    ], this.syncSpeed(now), stopped);
  }
}

export { SLOTS as ZORO_SLOTS };
