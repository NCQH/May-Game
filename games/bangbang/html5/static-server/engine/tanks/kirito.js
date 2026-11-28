/* Kirito (tank 10000096): lethal-hit rejection, carried dash and a divided
 * fifteen-cut burst. Port of server/kirito_actions.py.
 *
 * Stubs: no skin/presentation; water reclip only honours an existing lineage.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pyRound } from '../math.js';
import { scene, stop_move, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, inStrip, packII, piercingStep, prepareDisplacement } from './melee.js';
import { acceptWaterReclip, samePosition } from './batch-d-common.js';

const SLOTS = { 0: 371100, 1: 371201, 2: 371301, 10: 371401 };

export class KiritoActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = this.dash = this.vanish = null;
    this.passive_ready_at = 0;
  }

  _cooldown(slot, changed = false) {
    if (!(slot in SLOTS)) {
      return [1572, encodeS1572(this.id, {
        skillId: this.skillForSlot(slot) ?? 0, slot, count: -1,
        end: this.cooldowns[slot] ?? 0, nextCharge: 0,
      })];
    }
    const skill = slot === 0 && this.hasBuff(371121, this.clock()) ? 371131 : SLOTS[slot];
    const info = { skillId: skill, slot, count: -1, end: this.cooldowns[slot], nextCharge: 0 };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    return this._buff(371101, now).concat(this._buff(371102, now), [this._cooldown(0, true)]);
  }

  _rescue(now) {
    this.passive_ready_at = now + 30000;
    this.cooldowns[1] = this.cooldowns[10] = 0;
    return this._buff(371111, now).concat(this._buff(371113, now),
      [this._cooldown(1), this._cooldown(10), this._hpPacket(this.id, this.hp)]);
  }

  prevent_lethal_hit(hit, now) {
    if (this.alive && hit.hp_after.isZero() && now >= this.passive_ready_at) {
      return this._rescue(now);
    }
    return null;
  }

  commit_hp(hp, now, { critical = false } = {}) {
    if (this.alive && hp.isZero() && now >= this.passive_ready_at) return this._rescue(now);
    return super.commitHp(hp, now, { critical });
  }

  _empower(now) {
    const packets = [];
    for (const template of [371121, 371122, 371123, 371124]) {
      packets.push(...this._buff(template, now));
    }
    return packets.concat([this._cooldown(0, true)]);
  }

  removeBuff(template, now, { expired = false } = {}) {
    const packets = super.removeBuff(template, now, { expired });
    if (template === 371121) {
      packets.push(...super.removeBuff(371122, now));
      packets.push(this._cooldown(0, true));
    }
    if (template === 371111 && expired && this.alive) packets.push(...this._buff(371114, now));
    return packets;
  }

  // Core calls the camelCase removeBuff; keep Python's spelling as an alias.
  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  _hit(target, raw, now, { school = 'physical' } = {}) {
    const [packets, lost] = this.damage(raw, now, { target, school });
    if (lost && this.alive) packets.push(...this._empower(now));
    return packets;
  }

  _speed(now) { return this.ready || this.vanish ? 0 : super._speed(now); }

  blocked(action, now) {
    return Boolean(this.ready || this.vanish || this.dash) || super.blocked(action, now);
  }

  reject_buff(row, source, now) { return Boolean(this.vanish && source.camp !== this.camp); }

  cc_immune(now, { slow = false } = {}) {
    return Boolean(this.vanish) || super.ccImmune(now, { slow });
  }

  _endVanish(now) {
    const cast = this.vanish;
    this.vanish = null;
    if (!cast) return [];
    this.info.untargetable = cast.was_untargetable;
    this.info.damage_immune = cast.was_immune;
    const packets = [];
    for (const template of [371306, 371401, 371302]) packets.push(...this.removeBuff(template, now));
    for (const ident of cast.objects) packets.push(...this.removeObject(ident, { destroyed: true }));
    return packets.concat(this.syncSpeed(now));
  }

  interrupt(now) {
    const packets = [];
    if (this.vanish && this.alive) return [];
    if (this.ready) {
      packets.push([1583, packII(this.id, this.ready.skill)]);
      this.ready = null;
    }
    if (this.dash) {
      this.dash = null;
      this.position = this.positionAt(now);
      this.motion = null;
      this.forcedUntil = now;
      packets.push(...this.removeBuff(371201, now));
    }
    if (!this.alive) packets.push(...this._endVanish(now));
    return packets.concat(this.syncSpeed(now));
  }

  update(now) {
    const packets = this.ready && this.skillSealed(this.ready.slot, now)
      ? this.interrupt(now) : [];
    return packets.concat(super.update(now));
  }

  handle(message, payload) {
    if (message === 514 && payload.length >= 8 && this.vanish && this.vanish.slot === 2) {
      const now = this.clock();
      const pk = this.arena.pk;
      if (!this.arena.inputOpen(now, this)
        || (pk && !this.arena.tankTest && now >= pk.end)) return this.arena.tick(now);
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
      if (view.getUint32(0, true) === this.sceneId) {
        this.vanish.dest = [view.getInt16(4, true), view.getInt16(6, true)];
      }
      return this.arena.tick(this.clock());
    }
    return super.handle(message, payload);
  }

  _blade(flight, target, now) {
    const current = this.alive && flight.source_generation === this.generation;
    const [packets, lost] = this.damage(flight.raw, now, {
      target, basic: true,
      lifesteal: flight.template === 371131 && current ? D('.25') : 0,
    });
    if (lost && current && flight.template === 371131) packets.push(...this._buff(371132, now));
    return packets;
  }

  _flight(flight, now) {
    return piercingStep(this, flight, now, (f, t, n) => this._blade(f, t, n),
      { pierce: false });
  }

  _carry(target, cast, now) {
    if (!target.alive || target.ccImmune(now)) return [];
    const current = target.positionAt(now);
    const start = target.stopPosition(now);
    let dest = cast.dest;
    const wall = this.arena.geometry.wallContact(start, dest, 36);
    if (wall !== null) {
      dest = [start[0] + (dest[0] - start[0]) * Math.max(0, wall - 1e-4),
        start[1] + (dest[1] - start[1]) * Math.max(0, wall - 1e-4)];
    }
    if (!samePosition(start, current)) { target.position = start; target.motion = null; }
    const packets = target.interrupt(now);
    if (!samePosition(start, current)) packets.push(stop_move(this.sceneId, target.id, start));
    const duration = target._setMotion(start, dest, 1200, now, 1);
    target.forcedUntil = now + duration;
    const carried = {
      target: target.id, target_generation: target.generation,
      source_generation: this.generation, power: cast.power,
      end: now + duration, motion: target.motion, wall: cast.wall || wall !== null,
    };
    this._queue(now + Math.min(20, duration), 'kirito_wall', carried);
    return packets.concat(this._buff(371221, now, target.id), [
      scene({ moves: [this._moveEvent(target.motion[1], 1200, 1, target.id)] }),
    ]);
  }

  _event(now, kind, data) {
    if (kind === 'kirito_arrival_visual') {
      const [cast] = data;
      return this.removeObject(cast.visual_object,
        { destroyed: this.vanish === cast && this.alive });
    }
    if (kind === 'kirito_wall') {
      const [cast] = data;
      const target = this.arena.actors.get(cast.target);
      if (!target || !target.alive || target.generation !== cast.target_generation) return [];
      if (target.motion !== cast.motion) {
        if (target.motion && target.motionKind === 1 && target.motion[3] <= cast.end
          && target.hasBuff(371221, now) && acceptWaterReclip(target, cast)) {
          cast.motion = target.motion;
          cast.end = target.motion[3];
          cast.wall = true;
        } else {
          return target.removeBuff(371221, now);
        }
      }
      if (now < cast.end) {
        this._queue(Math.min(now + 20, cast.end), kind, cast);
        return [];
      }
      const packets = target.removeBuff(371221, now);
      if (cast.wall) {
        packets.push(...this.damage(cast.power.mul(D('1.45')), now, { target })[0]);
        packets.push(...this._buff(371232, now, target.id));
        if (this.alive && this.generation === cast.source_generation) {
          packets.push(...this.restoreHp(cast.power, now), ...this._empower(now));
        }
      }
      return packets;
    }
    if (kind === 'kirito_dash') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive) return [];
      const start = this.positionAt(cast.previous), end = this.positionAt(now);
      const packets = [];
      if (this.motion && !samePosition(this.motion[1], cast.dest)) {
        cast.dest = this.motion[1];
        cast.wall = true;
      }
      for (const target of enemies(this)) {
        const key = `${target.id},${target.generation}`;
        if (cast.hits.has(key)
          || actorContact(start, end, target, cast.previous, now) === null) continue;
        cast.hits.add(key);
        packets.push(...this._hit(target, cast.power, now));
        if (this.arena.pk && this.arena.pk.finished) break;
        packets.push(...this._carry(target, cast, now));
      }
      if (!this.motion || now >= this.motion[3] || now >= cast.end) {
        this.dash = null;
        packets.push(...this.removeBuff(371201, now));
      } else {
        cast.previous = now;
        this._queue(Math.min(now + 20, cast.end), kind, cast);
      }
      return packets;
    }
    if (kind === 'kirito_blink') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      const start = this.positionAt(now);
      const dest = this.blinkDestination(start, cast.dest);
      this.position = dest;
      this.motion = null;
      this.forcedUntil = now;
      cast.dest = dest;
      cast.was_untargetable = this.info.untargetable ?? false;
      cast.was_immune = this.info.damage_immune ?? false;
      cast.objects = [];
      this.vanish = cast;
      this.info.untargetable = this.info.damage_immune = true;
      const packets = this._buff(371401, now).concat([
        scene({ moves: [this._moveEvent(dest, 0, 5)] }),
      ]);
      const [ident, packet] = this.addObject(371402, start.map(pyRound));
      packets.push(packet);
      this._queue(now + 700, 'object_expire', ident);
      const [ident2, packet2] = this.addObject(371404, dest.map(pyRound));
      packets.push(packet2);
      cast.objects.push(ident2);
      this._queue(now + 500, 'kirito_land', cast);
      return packets.concat(this.syncSpeed(now));
    }
    if (kind === 'kirito_land') {
      const [cast] = data;
      if (this.vanish !== cast || !this.alive) return [];
      const packets = this._endVanish(now);
      for (const target of enemies(this, { area: true })) {
        const pos = target.positionAt(now);
        if (Math.hypot(cast.dest[0] - pos[0], cast.dest[1] - pos[1]) <= 144) {
          packets.push(...this._buff(371405, now, target.id));
          packets.push(...this._hit(target, cast.power.mul(D('1.27')), now));
        }
      }
      return packets;
    }
    if (kind === 'kirito_cut') {
      const [cast, index] = data;
      if (this.vanish !== cast || !this.alive) return [];
      const targets = [...enemies(this, { area: true })].filter((target) => {
        const pos = target.positionAt(now);
        return Math.hypot(cast.start[0] - pos[0], cast.start[1] - pos[1]) <= 216;
      });
      const packets = [];
      for (const target of targets) {
        packets.push(...this._hit(target, cast.power.mul(D('.4')).div(D(targets.length)), now));
        for (const template of [371312, 371313, 371314]) {
          packets.push(...this._buff(template, now, target.id));
        }
      }
      if (index < 14) this._queue(now + 100, kind, cast, index + 1);
      if (index === 14) {
        packets.push(scene({ skills: [this._skillEvent(371321, cast.start, cast.dest, 0, { ready: 1 })] }));
      }
      return packets;
    }
    if (kind === 'kirito_final') {
      const [cast] = data;
      if (this.vanish !== cast || !this.alive) return [];
      const packets = this._endVanish(now);
      const { start, dest } = cast;
      const targets = [...enemies(this, { area: true })].filter(target =>
        inStrip(target.positionAt(now), start, dest, 224, 300));
      packets.push(scene({ skills: [this._skillEvent(371321, start, dest)] }));
      for (const target of targets) {
        const missing = target.maxHp.sub(target.hp);
        packets.push(...this._hit(target, cast.power.mul(D('1.75')).div(D(targets.length)), now));
        packets.push(...this._hit(target,
          missing.mul(D('.2')).div(D(targets.length)), now, { school: 'true' }));
        packets.push(...this._buff(371305, now, target.id), ...this._buff(371307, now, target.id));
      }
      const [ident, packet] = this.addObject(371308, start.map(pyRound));
      this._queue(now + 100, 'object_expire', ident);
      return packets.concat([packet]);
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if ((slot === 0 || slot === 1) && samePosition(start, dest)) return [];
    if (slot === 10 && (!this._inside(dest)
      || Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 360)) return [];
    const power = this.combatStat('iAttack', now);
    const packets = [];
    let correction = [];
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 6000, 2: 25000, 10: 8000 }[slot], slot);
    if (slot === 0) {
      const enhanced = this.hasBuff(371121, now);
      const key = [this.id, this.generation, 371100, this._newId(2)];
      packets.push(...this.shoot(371100, start, dest, now, power,
        { school: 'physical', basic: true, attack_key: key }));
      if (enhanced) {
        const angle = Math.atan2(dest[1] - start[1], dest[0] - start[0]);
        for (const degrees of [-144, -72, 72, 144]) {
          const a = angle + degrees * Math.PI / 180;
          const end = [pyRound(start[0] + 480 * Math.cos(a)),
            pyRound(start[1] + 480 * Math.sin(a))];
          packets.push(...this.shoot(371131, start, end, now, power.mul(D('.75')),
            { school: 'physical', basic: true, attack_key: key }));
        }
        packets.push(...this.removeBuff(371121, now));
      }
    } else if (slot === 1) {
      dest = aimed(start, dest, 336, { fixed: true });
      let body, stopped;
      [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      body = stopped.length ? body : start;
      const wall = this.arena.geometry.wallContact(body, dest, 36);
      if (wall !== null) {
        dest = [body[0] + (dest[0] - body[0]) * Math.max(0, wall - 1e-4),
          body[1] + (dest[1] - body[1]) * Math.max(0, wall - 1e-4)];
      }
      const requested = dest;
      const duration = this._setMotion(body, dest, 1200, now, 3);
      this.forcedUntil = now + duration;
      this.dash = {
        previous: now, end: now + duration, dest: this.motion[1], hits: new Set(), power,
        wall: wall !== null
          || Math.hypot(requested[0] - this.motion[1][0], requested[1] - this.motion[1][1]) > 0.1,
      };
      this._queue(now + Math.min(20, duration), 'kirito_dash', this.dash);
      packets.push(...this._buff(371201, now, null, { duration }), ...stopped);
      packets.push(scene({ moves: [this._moveEvent(this.motion[1], 1200, 3)] }));
    } else if (slot === 2) {
      let body;
      [body, correction] = prepareDisplacement(this, now, { interrupt: false });
      this.position = correction.length ? body : start;
      this.motion = null;
      const cast = {
        slot: 2,
        start,
        dest: !samePosition(dest, start) && !(dest[0] === 0 && dest[1] === 0)
          ? dest : [start[0] + 224, start[1]],
        power, objects: [],
        was_untargetable: this.info.untargetable ?? false,
        was_immune: this.info.damage_immune ?? false,
      };
      this.vanish = cast;
      this.info.untargetable = this.info.damage_immune = true;
      packets.push(...this._buff(371306, now),
        ...this._buff(371302, now, null, { duration: 1500 }));
      const [ident, packet] = this.addObject(371301, start.map(pyRound));
      cast.objects.push(ident);
      packets.push(packet);
      this._queue(now, 'kirito_cut', cast, 0);
      this._queue(now + 1500, 'kirito_final', cast);
      packets.push(...this.syncSpeed(now));
    } else {
      let body;
      [body, correction] = prepareDisplacement(this, now, { interrupt: false });
      this.position = correction.length ? body : start;
      this.motion = null;
      this.ready = { slot: 10, skill: 371401, dest, power };
      const [ident, packet] = this.addObject(371411, dest.map(pyRound));
      packets.push(packet);
      this.ready.visual_object = ident;
      this._queue(now + 450, 'kirito_arrival_visual', this.ready);
      this._queue(now + 50, 'kirito_blink', this.ready);
      packets.push(scene({ skills: [this._skillEvent(371401, start, dest, 0, { ready: 1 })] }));
      packets.push(...this.syncSpeed(now));
    }
    return packets.concat([this._cooldown(slot)], correction);
  }
}

export { SLOTS as KIRITO_SLOTS };
