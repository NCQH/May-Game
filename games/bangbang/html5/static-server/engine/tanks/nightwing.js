/* Night Wing (tank 10000114): impact distance, counted dodge, return darts.
 * Port of server/nightwing_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. Dodge rolls are cached per damage key.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1562, encodeS1572, encodeS1579 } from '../protocol.js';
import { enemies, packII, piercingStep, prepareDisplacement } from './melee.js';
import { keyOf } from './batch-e-common.js';
import { teamVisible } from './batch-c-common.js';

const SLOTS = { 0: 390100, 1: 390201, 2: 390301, 10: 390401 };

export class NightWingActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = 100;
    this.r_count = 2;
    this.r_next_charge = 0;
    this.ready = this.channel = null;
    this.marks = new Map();
    this.wounds = new Map();
    this.dodge_rolls = new Map();
    this.passive_ready_at = 0;
  }

  _cooldown(slot, changed = false) {
    const skill = slot === 0 && this.hasBuff(390204, this.clock()) ? 390221 : SLOTS[slot];
    const info = {
      skillId: skill, slot, count: slot === 10 ? this.r_count : -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: slot === 10 ? this.r_next_charge : 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _resource(delta) {
    if (this.noel_box) return [];
    const old = this.mp;
    this.mp = Math.max(0, Math.min(100, this.mp + delta));
    return old !== this.mp ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  on_spawn(now) {
    this.mp = 100;
    this.ready = this.channel = null;
    this.marks.clear();
    this.dodge_rolls.clear();
    this.passive_ready_at = 0;
    this._queue(now + 3000, 'night_energy', this.generation);
    const packets = [scene({ mp: [{ objectId: this.id, mp: 100 }] }), this._cooldown(0, true)];
    for (const template of [390101, 390102, 390103, 390104]) {
      packets.push(...this._buff(template, now));
    }
    return packets;
  }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }
  _speed(now) { return this.ready ? 0 : super._speed(now); }

  is_untargetable() { return this.isUntargetable(); }

  isUntargetable() {
    const now = this.arena.eventNow || this.clock();
    const stealthed = this.hasBuff(390201, now) || this.hasBuff(390304, now);
    return super.isUntargetable() || (stealthed && !this.buffTypes(now).has(32));
  }

  removeBuff(template, now, { expired = false } = {}) {
    const packets = super.removeBuff(template, now, { expired });
    if (template === 390201) {
      for (const other of [390202, 390203]) packets.push(...super.removeBuff(other, now));
    }
    if (template === 390204) packets.push(this._cooldown(0, true));
    return packets;
  }

  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  _breakStealth(now) {
    const packets = [];
    for (const template of [390201, 390304]) {
      if (this.hasBuff(template, now)) packets.push(...this.removeBuff(template, now));
    }
    return packets;
  }

  onDamage(source, hit, now) {
    return hit.hp_loss.gt(0) ? this._breakStealth(now) : [];
  }

  blockHit(key, amount, now, { basic = false, periodic = false, source = null } = {}) {
    if (amount.le(0) || periodic) return [false, []];
    const name = keyOf(key);
    if (this.dodge_rolls.has(name)) return [this.dodge_rolls.get(name), []];
    const dodged = now >= this.passive_ready_at && this.arena.rng() < 0.25;
    this.dodge_rolls.set(name, dodged);
    if (this.dodge_rolls.size > 256) {
      this.dodge_rolls.delete(this.dodge_rolls.keys().next().value);
    }
    if (!dodged) return [false, []];
    this.passive_ready_at = now + 500;
    return [true, this._buff(390131, now)];
  }

  update(now) {
    const packets = [];
    while (this.r_next_charge && now >= this.r_next_charge) {
      this.r_count = Math.min(2, this.r_count + 1);
      this.r_next_charge = this.r_count < 2
        ? this.r_next_charge + this.skillCooldown(8000) : 0;
      packets.push(this._cooldown(10));
    }
    return packets.concat(super.update(now));
  }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      packets.push([1583, packII(this.id, this.ready.skill)]);
      this.ready = null;
    }
    if (!this.alive) this.channel = null;
    return packets.concat(this.syncSpeed(now));
  }

  onControl(source, template, now) {
    const kind = this.arena.data.tableRow('BuffTemplate_table.xml',
      { nBuffId: template }).get('nEffectType');
    return ['30', '35', '66'].includes(kind) ? this.interrupt(now) : [];
  }

  _mark(target, now, power, generation) {
    if (!target.alive) return [];
    const key = `${target.id},${target.generation}`;
    const old = this.marks.get(key);
    const valid = Boolean(old && old.generation === generation && old.end > now
      && target.buffVersions.get(390110 + old.count) === old.version);
    const count = valid ? old.count + 1 : 1;
    const packets = [];
    for (let template = 390111; template < 390115; template += 1) {
      if (target.buffSources.get(template) === this.id) packets.push(...target.removeBuff(template, now));
    }
    if (count < 5) {
      packets.push(...this._buff(390110 + count, now, target.id));
      if (target.hasBuff(390110 + count, now)) {
        this.marks.set(key, {
          count, end: now + 3000, generation,
          version: target.buffVersions.get(390110 + count),
        });
      }
      return packets;
    }
    this.marks.delete(key);
    packets.push(...this._buff(390115, now, target.id),
      ...this._buff(390117, now, target.id, { duration: 3000 }));
    if (!target.hasBuff(390115, now)) return packets;
    const wound = this.wounds.get(key);
    const validWound = Boolean(wound && wound.generation === generation && now < wound.end
      && target.buffVersions.get(390115) === wound.version + 1);
    if (validWound) {
      Object.assign(wound, {
        end: now + 3000, power, version: target.buffVersions.get(390115),
        dot_version: target.buffVersions.get(390117),
      });
    } else {
      const record = {
        target: target.id, target_generation: target.generation, generation, power,
        end: now + 3000, previous: now, next_tick_at: now + 1000, distance: 0,
        version: target.buffVersions.get(390115),
        dot_version: target.buffVersions.get(390117),
      };
      this.wounds.set(key, record);
      this._queue(now + 20, 'night_wound', record);
    }
    return packets;
  }

  _hit(flight, target, now) {
    const current = this.alive && this.generation === flight.source_generation;
    const origin = this.generation === flight.source_generation
      ? this.positionAt(now) : flight.context.origin;
    const span = Math.hypot(origin[0] - target.positionAt(now)[0],
      origin[1] - target.positionAt(now)[1]);
    const factor = D(1).add(D(1).sub(D(String(span)).div(D(408))).max(D(0)));
    let raw = flight.raw.mul(factor);
    const template = flight.template;
    if (template === 390311 && target.id !== flight.target) raw = raw.mul(D('.5'));
    const [packets, lost] = this.damage(raw, now, { target, basic: flight.basic });
    if (flight.basic || lost) {
      packets.push(...this._mark(target, now, flight.context.power, flight.source_generation));
      if (current) packets.push(...this._resource(5));
    }
    if (template === 390221) {
      packets.push(...this._buff(390222, now, target.id),
        ...this._buff(390223, now, target.id));
      if (current) packets.push(...this._resource(25));
    }
    if (template === 390401 || template === 390411) {
      packets.push(...this._buff(390413, now, target.id));
      if (lost && current) {
        this.cooldowns[1] = now + Math.round(Math.max(0, this.cooldowns[1] - now) * 0.9);
        packets.push(this._cooldown(1));
      }
    }
    if (template === 390311 && current) {
      packets.push(...this.restoreHp(flight.context.power.mul(D('.25')), now));
    }
    return packets;
  }

  _flight(flight, now) {
    const template = flight.template;
    if (template === 390100 || template === 390221) {
      return piercingStep(this, flight, now, (f, t, n) => this._hit(f, t, n), { pierce: false });
    }
    const returning = template === 390411;
    const homing = returning || template === 390311;
    const packets = [];
    const target = this.arena.actors.get(flight.target);
    let start, end, reached;
    if (homing) {
      if (!target || !target.alive || target.generation !== flight.target_generation) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      start = flight.pos;
      const dest = target.positionAt(now);
      end = pointAt(start, dest, Math.min(1, flight.speed * (now - flight.previous)
        / 1000 / Math.max(1, Math.hypot(start[0] - dest[0], start[1] - dest[1]))));
      if (dest[0] !== flight.end[0] || dest[1] !== flight.end[1]) {
        packets.push([1562, encodeS1562(flight.id, start, dest)]);
      }
      flight.end = dest;
      flight.pos = end;
      reached = returning && Math.hypot(end[0] - dest[0], end[1] - dest[1]) <= 1;
    } else {
      start = pointAt(flight.start, flight.end,
        (flight.previous - flight.begin) / (flight.finish - flight.begin));
      end = pointAt(flight.start, flight.end,
        Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
      reached = now >= flight.finish;
    }
    const contacts = [];
    for (const enemy of enemies(this)) {
      const key = `${enemy.id},${enemy.generation}`;
      if (flight.hits.has(key)) continue;
      const hit = actorContact(start, end, enemy, flight.previous, now);
      if (hit !== null) contacts.push([hit, enemy.id, enemy, key]);
    }
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [, , enemy, key] of contacts) {
      if (this.projectileBlocked(enemy, now)) {
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
      flight.hits.add(key);
      packets.push(...this._hit(flight, enemy, now));
      if (template === 390311) return packets.concat([scene({ blownBullets: [flight.id] })]);
    }
    if (reached || now >= flight.finish) {
      packets.push(scene({ expiredBullets: [flight.id] }));
      if (template === 390401 && this.alive && this.generation === flight.source_generation) {
        packets.push(...this.shoot(390411, end.map(pyRound), this.positionAt(now), now,
          flight.context.power.mul(D('.3')), {
            school: 'physical', target: this, through_walls: true,
            context: flight.context, attack_key: flight.attack_key,
          }));
      }
      return packets;
    }
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'night_energy') {
      if (!this.alive || this.generation !== data[0]) return [];
      this._queue(now + 3000, kind, ...data);
      return this._resource(10);
    }
    if (kind === 'night_wound') {
      const [wound] = data;
      const target = this.arena.actors.get(wound.target);
      const key = `${wound.target},${wound.target_generation}`;
      if (this.wounds.get(key) !== wound || !target || !target.alive
        || target.generation !== wound.target_generation
        || target.buffVersions.get(390115) !== wound.version
        || target.buffVersions.get(390117) !== wound.dot_version) {
        if (this.wounds.get(key) === wound) this.wounds.delete(key);
        return [];
      }
      const packets = [];
      if (target.motion) {
        const begin = Math.max(wound.previous, target.motion[2]);
        const end = Math.min(now, target.motion[3]);
        if (end > begin) {
          const p0 = target.positionAt(begin), p1 = target.positionAt(end);
          wound.distance += Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        }
      }
      wound.previous = now;
      const count = Math.floor(wound.distance / 100);
      wound.distance -= 100 * count;
      for (let i = 0; i < count; i += 1) {
        packets.push(...this.damage(wound.power.mul(D('.5')), now,
          { target, school: 'true', periodic: true })[0]);
      }
      if (now >= wound.next_tick_at) {
        wound.next_tick_at += 1000;
        packets.push(...this.damage(wound.power.mul(D('.5')), now,
          { target, periodic: true })[0]);
      }
      if (now >= wound.end) this.wounds.delete(key);
      else this._queue(Math.min(now + 20, wound.end), kind, wound);
      return packets;
    }
    if (kind === 'night_trace') {
      const [generation, version, pos] = data;
      if (!this.alive || this.generation !== generation || !this.hasBuff(390203, now)
        || this.buffVersions.get(390203) !== version) return [];
      const current = this.positionAt(now);
      const packets = [];
      if (current[0] !== pos[0] || current[1] !== pos[1]) {
        const [ident, packet] = this.addObject(390211, current);
        packets.push(packet);
        this._queue(now + 500, 'night_trace_show', ident, current);
      }
      this._queue(now + 750, kind, generation, version, current);
      return packets;
    }
    if (kind === 'night_trace_show') {
      const [ident, pos] = data;
      const packets = this.removeObject(ident);
      let newIdent, packet;
      [newIdent, packet] = this.addObject(390212, pos);
      this._queue(now + 750, 'object_expire', newIdent);
      return packets.concat([packet]);
    }
    if (kind === 'night_cast') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.generation !== cast.generation) return [];
      this.ready = null;
      const packets = this.syncSpeed(now);
      const start = this.positionAt(now);
      if (cast.slot === 10) {
        const angle = Math.atan2(cast.dest[1] - start[1], cast.dest[0] - start[0]);
        for (const degrees of [0, -30, 30]) {
          const dest = [
            Math.round(start[0] + 408 * Math.cos(angle + degrees * Math.PI / 180)),
            Math.round(start[1] + 408 * Math.sin(angle + degrees * Math.PI / 180)),
          ];
          packets.push(...this.shoot(390401, start, dest, now, cast.power.mul(D('.15')), {
            school: 'physical', through_walls: true, context: cast,
          }));
        }
      } else {
        const target = this.arena.actors.get(cast.target);
        if (!target || !target.alive || target.generation !== cast.target_generation) return packets;
        packets.push(...this._buff(390305, now, target.id));
        if (!target.hasBuff(390305, now)) return packets;
        cast.version = target.buffVersions.get(390305);
        cast.end = now + 3000;
        this.channel = cast;
        for (const template of [390301, 390302, 390303, 390304]) {
          packets.push(...this._buff(template, now));
        }
        for (let delay = 250; delay <= 3000; delay += 250) {
          this._queue(now + delay, 'night_ghost', cast);
        }
      }
      return packets;
    }
    if (kind === 'night_ghost') {
      const [cast] = data;
      const target = this.arena.actors.get(cast.target);
      if (this.channel !== cast || !this.alive || this.generation !== cast.generation
        || !target || !target.alive || target.generation !== cast.target_generation
        || target.buffVersions.get(390305) !== cast.version) return [];
      const packets = this.shoot(390311, this.positionAt(now), target.positionAt(now), now,
        cast.power.mul(D('.5')), {
          school: 'physical', target, through_walls: true, context: cast,
        });
      if (now >= cast.end) this.channel = null;
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || now < this.cooldowns[slot]) return [];
    if ([0, 10].includes(slot) && start[0] === dest[0] && start[1] === dest[1]) return [];
    const cost = { 0: 0, 1: 15, 2: 60, 10: 25 }[slot];
    if (this.mp < cost || (slot === 10 && this.r_count === 0)) return [];
    const target = this.arena.actors.get(targetId);
    if (slot === 2 && (!target || !enemies(this).includes(target)
      || Math.hypot(start[0] - target.positionAt(now)[0],
        start[1] - target.positionAt(now)[1]) > 480
      || !teamVisible(this, target, now))) return [];
    const power = this.combatStat('iAttack', now);
    const packets = this._resource(-cost).concat(this._breakStealth(now));
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 8000, 2: 25000, 10: 4000 }[slot], slot);
    if (slot === 0) {
      const enhanced = this.hasBuff(390204, now);
      if (enhanced) packets.push(...this.removeBuff(390204, now));
      packets.push(...this.shoot(enhanced ? 390221 : 390100, start, dest, now,
        power.mul(enhanced ? D('.75') : D('.5')), {
          school: 'physical', basic: true, context: { power, origin: start },
        }));
    } else if (slot === 1) {
      for (const template of [390201, 390202, 390203, 390204]) {
        packets.push(...this._buff(template, now));
      }
      this._queue(now + 500, 'night_trace', this.generation,
        this.buffVersions.get(390203), start);
      packets.push(scene({ skills: [this._skillEvent(390201, start, start)] }), this._cooldown(0, true));
    } else {
      let body, stopped;
      [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      if (slot === 10) {
        this.r_count -= 1;
        if (!this.r_next_charge) this.r_next_charge = now + this.skillCooldown(8000);
        packets.push(...this._buff(390421, now));
      }
      this.position = stopped.length ? body : start;
      this.motion = null;
      this.ready = {
        slot, skill: SLOTS[slot], dest, power, origin: start, generation: this.generation,
        target: slot === 2 ? target.id : 0,
        target_generation: slot === 2 ? target.generation : 0,
      };
      this._queue(now + 100, 'night_cast', this.ready);
      packets.push(scene({
        skills: [this._skillEvent(SLOTS[slot], start, dest, slot === 2 ? targetId : 0,
          { ready: 1 })],
      }));
      packets.push(...this.syncSpeed(now), ...stopped);
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as NIGHTWING_SLOTS };
