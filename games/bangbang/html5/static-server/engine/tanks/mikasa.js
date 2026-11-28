/* Mikasa (tank 10000078): wall-only hook, bounded travel and separate E/Space
 * reserves. Port of server/mikasa_actions.py.
 *
 * Stubs: no skin/presentation; the hook line packet uses the native
 * expiredBullets vector. Physical damage uses inverse armor.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, rectContact } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';
import { aimed, enemies, packII, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 352100, 1: 352201, 2: 352301, 10: 352401 };

export class MikasaActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = Number(this.stats.iMp);
    this.e_count = this.space_count = 3;
    this.e_next_charge = this.space_next_charge = 0;
    this.ready = this.hook = this.dash = this.reload = null;
  }

  _cooldown(slot) {
    if (!(slot in SLOTS)) {
      return [1572, encodeS1572(this.id, {
        skillId: this.skillForSlot(slot) ?? 0, slot, count: -1,
        end: this.cooldowns[slot] ?? 0, nextCharge: 0,
      })];
    }
    const count = slot === 1 ? this.e_count : slot === 2 ? this.space_count : -1;
    const nextCharge = slot === 1 ? this.e_next_charge
      : slot === 2 ? this.space_next_charge : 0;
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count, end: this.cooldowns[slot], nextCharge,
    })];
  }

  _resource(delta) {
    if (this.noel_box) return [];
    const old = this.mp;
    this.mp = Math.max(0, Math.min(Number(this.stats.iMp), this.mp + delta));
    return old !== this.mp ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  on_spawn(now) {
    this.mp = Number(this.stats.iMp);
    this.hook = this.dash = this.ready = this.reload = null;
    this._queue(now + 1000, 'mikasa_energy', this.generation);
    return this._buff(352101, now).concat([
      scene({ mp: [{ objectId: this.id, mp: this.mp }] }),
    ]);
  }

  damage(raw, now, options = {}) {
    if ((options.school ?? 'physical') === 'physical') options.inverse_armor = true;
    return super.damage(raw, now, options);
  }

  _speed(now) { return this.ready || this.hook ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready || this.hook) || super.blocked(action, now); }

  cc_immune(now, { slow = false } = {}) {
    return Boolean(this.dash) || this.hasBuff(352404, now) || super.ccImmune(now, { slow });
  }

  _endReload(now) {
    if (!this.reload) return [];
    this.reload = null;
    this.cooldowns[10] = now + this.skillCooldown(7000, 10);
    const packets = [];
    for (const template of [352404, 352405, 352407]) {
      packets.push(...this.removeBuff(template, now));
    }
    return packets.concat([this._cooldown(10)]);
  }

  cleanse(now) {
    const packets = super.cleanse(now);
    // Some native stun rows are positive; R also clears hostile controls.
    for (const key of [...this.activeBuffs.keys()]) {
      const [owner, template] = key.split(',').map(Number);
      const source = this.arena.actors.get(this.buffSources.get(template));
      if (owner !== this.id || !source || source.camp === this.camp) continue;
      const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
      if ([30, 35, 36, 39, 62, 66].includes(Number(row.nEffectType))) {
        packets.push(...this.removeBuff(template, now));
      }
    }
    return packets;
  }

  removeBuff(template, now, { expired = false } = {}) {
    const packets = super.removeBuff(template, now, { expired });
    if (template === 352406) packets.push(...this._endReload(now));
    return packets;
  }

  // Core calls the camelCase removeBuff; keep Python's spelling as an alias.
  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  interrupt(now) {
    if (this.alive && this.dash) return []; // Successful hook travel ignores control.
    const packets = [];
    if (this.ready) {
      this.ready = null;
      packets.push([1583, packII(this.id, 352401)]);
    }
    packets.push(...this._removeHookLine());
    this.hook = this.dash = null;
    this.position = this.positionAt(now);
    this.motion = null;
    this.forcedUntil = now;
    packets.push(...this.removeBuff(352201, now), ...this.removeBuff(352601, now));
    if (!this.alive) packets.push(...this._endReload(now));
    return packets.concat(this.syncSpeed(now));
  }

  update(now) {
    const packets = [];
    for (const [slot, countName, nextName] of [
      [1, 'e_count', 'e_next_charge'], [2, 'space_count', 'space_next_charge'],
    ]) {
      let changed = false;
      while (this[nextName] && this[nextName] <= now) {
        const count = Math.min(3, this[countName] + 1);
        this[countName] = count;
        this[nextName] = count < 3 ? this[nextName] + this.skillCooldown(4000) : 0;
        changed = true;
      }
      if (changed) packets.push(this._cooldown(slot));
    }
    return packets.concat(super.update(now));
  }

  on_bullet_hit(flight, target, now) {
    return flight.basic && this.alive && flight.source_generation === this.generation
      ? this._resource(5) : [];
  }

  _endHook(now) {
    this.hook = null;
    return this.removeBuff(352201, now).concat(this.syncSpeed(now));
  }

  _removeHookLine() {
    const ident = this.dash ? (this.dash.bullet ?? null) : null;
    return ident !== null ? [scene({ expiredBullets: [ident] })] : [];
  }

  _flight(flight, now) {
    if (flight.template !== 352501) return super._flight(flight, now);
    const cast = flight.context;
    if (this.hook !== cast || !this.alive
      || flight.source_generation !== this.generation) {
      return [scene({ expiredBullets: [flight.id] })];
    }
    const start = [
      flight.start[0] + (flight.end[0] - flight.start[0])
        * (flight.previous - flight.begin) / (flight.finish - flight.begin),
      flight.start[1] + (flight.end[1] - flight.start[1])
        * (flight.previous - flight.begin) / (flight.finish - flight.begin),
    ];
    const fraction = Math.min(1, (now - flight.begin) / (flight.finish - flight.begin));
    const end = [
      flight.start[0] + (flight.end[0] - flight.start[0]) * fraction,
      flight.start[1] + (flight.end[1] - flight.start[1]) * fraction,
    ];
    const contacts = [
      this.arena.geometry.wallContact(start, end),
      rectContact(start, end, this.arena.waterRects(now)),
    ].filter(value => value !== null);
    if (contacts.length) {
      const latch = [
        start[0] + (end[0] - start[0]) * Math.min(...contacts),
        start[1] + (end[1] - start[1]) * Math.min(...contacts),
      ];
      const packets = this._endHook(now);
      const origin = this.positionAt(now);
      const hit = this.arena.geometry.wallContact(origin, latch, 36);
      const dest = hit !== null
        ? [origin[0] + (latch[0] - origin[0]) * Math.max(0, hit - 1e-4),
          origin[1] + (latch[1] - origin[1]) * Math.max(0, hit - 1e-4)]
        : latch;
      const duration = this._setMotion(origin, dest, 720, now, 3);
      this.forcedUntil = now + duration;
      this.dash = {
        end: now + duration, previous: now, generation: this.generation, hits: new Set(),
        power: cast.power, bullet: flight.id,
      };
      this._queue(now + Math.min(20, duration), 'mikasa_dash', this.dash);
      packets.push(...this._buff(352502, now), ...this._buff(352504, now),
        ...this._buff(352601, now, null, { duration }));
      return packets.concat([scene({
        blownBullets: [flight.id],
        moves: [this._moveEvent(this.motion[1], 720, 3)],
      })]);
    }
    if (now >= flight.finish) {
      return this._endHook(now).concat([scene({ expiredBullets: [flight.id] })]);
    }
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return [];
  }

  _event(now, kind, data) {
    if (kind === 'mikasa_energy') {
      if (data[0] !== this.generation || !this.alive) return [];
      this._queue(now + 1000, kind, this.generation);
      return this._resource(5);
    }
    if (kind === 'mikasa_dash') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive) return [];
      const start = this.positionAt(cast.previous), end = this.positionAt(now);
      const packets = [];
      for (const target of enemies(this)) {
        const key = `${target.id},${target.generation}`;
        if (!cast.hits.has(key)
          && actorContact(start, end, target, cast.previous, now) !== null) {
          cast.hits.add(key);
          packets.push(...this.damage(cast.power, now, { target })[0]);
          packets.push(...this._buff(352602, now, target.id));
        }
      }
      if (!this.motion || now >= this.motion[3] || now >= cast.end) {
        packets.push(...this._removeHookLine());
        this.dash = null;
        packets.push(...this.removeBuff(352601, now));
      } else {
        cast.previous = now;
        this._queue(Math.min(now + 20, cast.end), kind, cast);
      }
      return packets;
    }
    if (kind === 'mikasa_reload') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      const start = this.positionAt(now);
      const dest = aimed(start, cast.dest, 336, { fixed: true });
      this.forcedUntil = now + this._setMotion(start, dest, 960, now, 3);
      this.reload = { end: now + 4000 };
      const packets = this.cleanse(now).concat(this._resource(75));
      for (const template of [352404, 352405, 352407]) {
        packets.push(...this._buff(template, now));
      }
      packets.push(...this.addShield(352406, this.maxHp.mul(D('.25')), now));
      return packets.concat([scene({ moves: [this._moveEvent(this.motion[1], 960, 3)] })],
        this.syncSpeed(now));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || !this.alive || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if ((slot !== 10 && this.blocked('attack', now)) || (slot === 10 && (this.reload || this.ready))) {
      return [];
    }
    if ((slot === 0 || slot === 1 || slot === 10)
      && start[0] === dest[0] && start[1] === dest[1]) return [];
    if (slot === 1 && (!this.e_count || this.mp < 50)) return [];
    if (slot === 2 && !this.space_count) return [];
    const packets = [];
    if (slot === 0) {
      this.cooldowns[0] = now + this.fireInterval(now);
      packets.push(...this.shoot(352100, start, dest, now, this.combatStat('iAttack', now),
        { school: 'physical', basic: true }));
    } else if (slot === 1) {
      this.e_count -= 1;
      this.e_next_charge = this.e_next_charge || now + this.skillCooldown(4000);
      this.cooldowns[1] = now + this.skillCooldown(1500, 1);
      packets.push(...this._resource(-50));
      this.hook = { generation: this.generation, power: this.combatStat('iAttack', now) };
      packets.push(...this._buff(352201, now, null, { duration: 401 }));
      packets.push(...this.shoot(352501, start, dest, now, D(0),
        { school: 'physical', context: this.hook }));
    } else if (slot === 2) {
      this.space_count -= 1;
      this.space_next_charge = this.space_next_charge || now + this.skillCooldown(4000);
      this.cooldowns[2] = now + this.skillCooldown(1500, 2);
      packets.push(scene({ skills: [this._skillEvent(352301, start, start)] }));
      const critical = this.hasBuff(352502, now);
      const power = this.combatStat('iAttack', now).mul(critical ? D(2) : D(1));
      for (const target of enemies(this, { area: true })) {
        if (Math.hypot(start[0] - target.positionAt(now)[0],
          start[1] - target.positionAt(now)[1]) > 144) continue;
        const stacks = target.hasBuff(352302, now)
          && target.buffSources.get(352302) === this.id
          ? (target.buffStacks.get(352302) ?? 0) : 0;
        packets.push(...this.damage(power.mul(D(1).add(D('.25').mul(D(stacks)))), now,
          { target, lifesteal: D('.5'), critical_display: critical })[0]);
        packets.push(...this._buff(352302, now, target.id,
          { stacks: Math.min(3, stacks + 1) }));
      }
    } else {
      let origin, stopped;
      [origin, stopped] = prepareDisplacement(this, now, { interrupt: false });
      packets.push(...this._removeHookLine());
      this.hook = this.dash = null;
      packets.push(...this.removeBuff(352201, now), ...this.removeBuff(352601, now),
        ...this.cleanse(now));
      this.position = stopped.length ? origin : start;
      this.motion = null;
      this.forcedUntil = now;
      this.ready = { slot: 10, dest, generation: this.generation };
      this._queue(now + 150, 'mikasa_reload', this.ready);
      packets.push(scene({ skills: [this._skillEvent(352401, start, dest, 0, { ready: 1 })] }));
      packets.push(...this.syncSpeed(now), ...stopped);
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

// actorContact lives in math.js; the hook/step contacts use it directly.

export { SLOTS as MIKASA_SLOTS };
