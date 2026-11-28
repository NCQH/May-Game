/* Spider Man (tank 10000008): webs, web-pull, dash, field clock.
 * Port of server/spider_actions.py onto the JS battle core.
 *
 * Stubs: presentation only. Web timing/anchor and pull geometry keep the
 * user-approved values; the field accelerates E/R cooldowns while inside it.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, circleContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';

const SLOTS = { 0: 303100, 1: 303201, 2: 303301, 10: 303401 };

export class SpiderActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = Number(this.stats.iMp);
    this.r_count = 3;
    this.r_next_charge = 0;
    this.webs = new Map();
    this.fields = new Map();
    this.web_dots = new Map();
    this.dash = null;
  }

  _cooldown(slot, changed = false) {
    const skill = slot === 0 && this.hasBuff(303113, this.clock())
      ? 303131 : SLOTS[slot];
    const info = {
      skillId: skill, slot, count: slot === 10 ? this.r_count : -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: slot === 10 ? this.r_next_charge : 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _resource(amount) {
    if (this.noel_box) return []; // Stasis suppresses resource effects too.
    const old = this.mp;
    this.mp = Math.max(0, Math.min(Number(this.stats.iMp), this.mp + amount));
    return old !== this.mp
      ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  on_spawn(now) {
    this.mp = Number(this.stats.iMp);
    this._queue(now + 1000, 'spider_regen', this.generation);
    const packets = [scene({ mp: [{ objectId: this.id, mp: this.mp }] })];
    for (const template of [303101, 303102]) packets.push(...this._buff(template, now));
    return packets;
  }

  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  removeBuff(template, now, { expired = false } = {}) {
    const packets = super.removeBuff(template, now, { expired });
    if (template === 303113) packets.push(this._cooldown(0, true), this._cooldown(0));
    return packets;
  }

  damage(raw, now, options = {}) {
    const [packets, lost] = super.damage(raw, now, options);
    if (lost && !options.basic && this.alive) {
      for (const template of [303121, 303122]) {
        packets.push(...this._buff(template, now));
      }
    }
    return [packets, lost];
  }

  update(now) {
    const packets = super.update(now);
    if (this.r_next_charge && now >= this.r_next_charge) {
      while (this.r_count < 3 && now >= this.r_next_charge) {
        this.r_count += 1;
        this.r_next_charge += this.skillCooldown(6000);
      }
      if (this.r_count === 3) this.r_next_charge = 0;
      packets.push(this._cooldown(10));
    }
    return packets;
  }

  interrupt(now) {
    const packets = [];
    if (this.dash) {
      this.dash = null;
      for (const template of [303202, 303203]) {
        packets.push(...this.removeBuff(template, now));
      }
    }
    if (!this.alive) {
      for (const obj of [...this.webs.values(), ...this.fields.values()]) {
        packets.push(...this.removeObject(obj.id));
      }
      this.webs.clear();
      this.fields.clear();
      this.web_dots.clear();
    }
    return packets;
  }

  _web(pos, power, now) {
    const [ident, packet] = this.addObject(303402, pos);
    this.webs.set(ident, { id: ident, pos, power, end: now + 8000 });
    this._queue(now, 'web_tick', ident);
    return [packet];
  }

  _web_contact(target, web, now) {
    if (target.rejectBuff({ nEffectType: '201' }, this, now)) return [];
    const key = `${target.id},${target.generation}`;
    const dot = this.web_dots.get(key);
    const valid = dot && dot.end >= now && target.buffVersions.get(303403) === dot.version;
    const packets = [];
    for (const template of [303403, 303404, 303405]) {
      packets.push(...this._buff(template, now, target.id));
    }
    packets.push(...this._buff(303406, now));
    if (!target.hasBuff(303403, now) || target.buffSources.get(303403) !== this.id) {
      return packets;
    }
    if (!valid) {
      const fresh = { end: now + 2000, power: web.power,
        version: target.buffVersions.get(303403) };
      this.web_dots.set(key, fresh);
      this._queue(now + 1000, 'web_dot', key, fresh);
      fresh.end = now + 2000;
      fresh.power = web.power;
      fresh.version = target.buffVersions.get(303403);
      return packets;
    }
    dot.end = now + 2000;
    dot.power = web.power;
    dot.version = target.buffVersions.get(303403);
    return packets;
  }

  _clipped(start, dest) {
    dest = this.arena.geometry.clampTankPosition(dest);
    const wall = this.arena.geometry.wallContact(start, dest, 36);
    if (wall !== null) dest = pointAt(start, dest, Math.max(0, wall - 0.001));
    return dest.map(pyRound);
  }

  onBulletHit(flight, target, now) {
    if (flight.template !== 303131 || !this.alive || !target.alive
      || this.generation !== flight.source_generation) return [];
    if (this.arena.pk && this.arena.pk.finished) return [];
    // User: this separate SAFE buff protects the caster from ALL damage.
    const packets = this._buff(303136, now);
    const a = this.positionAt(now), b = target.positionAt(now);
    const span = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (span <= 72 || target.ccImmune(now)) return packets;
    const half = (span - 72) / 2;
    const ends = [[this, this._clipped(a, pointAt(a, b, half / span))],
      [target, this._clipped(b, pointAt(b, a, half / span))]];
    for (const [actor, end] of ends) {
      const origin = actor.positionAt(now);
      const duration = actor._setMotion(origin, end, 720, now, 3);
      const dest = actor.motion[1];
      actor.forcedUntil = now + duration;
      packets.push(...actor.interrupt(now));
      packets.push(scene({ moves: [this._moveEvent(dest, 720, 3, actor.id)] }));
      if (actor === target) {
        for (const template of [303132, 303133, 303134, 303135]) {
          packets.push(...this._buff(template, now, target.id, { duration }));
        }
        const pull = { target: target.id, generation: target.generation,
          previous: now, end: now + duration, rooted: false };
        this._queue(now + Math.min(20, duration), 'pull_web', pull);
      }
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'pull_web') {
      const [pull] = data;
      const target = this.arena.actors.get(pull.target);
      if (!target?.alive || target.generation !== pull.generation || pull.rooted) return [];
      const start = target.positionAt(pull.previous), end = target.positionAt(now);
      for (const web of this.webs.values()) {
        if (circleContact(start, end, web.pos, web.pos, 72) !== null) {
          pull.rooted = true;
          return this._buff(303141, now, target.id);
        }
      }
      pull.previous = now;
      if (now < pull.end) this._queue(Math.min(now + 20, pull.end), kind, pull);
      return [];
    }
    if (kind === 'spider_regen') {
      if (!this.alive || this.generation !== data[0]) return [];
      this._queue(now + 1000, kind, ...data);
      return this._resource(Number(this.stats.iMpRecover));
    }
    if (kind === 'spider_shot') {
      const [generation, template, start, dest, power] = data;
      if (!this.alive || generation !== this.generation || this.blocked('attack', now)) return [];
      return this.shoot(template, start, dest, now,
        power.mul(template === 303401 ? D('1.05') : D('1.5')), {
          school: 'energy', basic: template === 303131, power,
        });
    }
    if (kind === 'spider_dash') {
      const [dash] = data;
      if (this.dash !== dash || !this.alive) return [];
      const start = this.positionAt(dash.previous), end = this.positionAt(now);
      const packets = [];
      for (const target of [...this.arena.actors.values()]) {
        const key = `${target.id},${target.generation}`;
        if (!target.alive || target.camp === this.camp || dash.hits.has(key)) continue;
        if (actorContact(start, end, target, dash.previous, now, 72) === null) continue;
        dash.hits.add(key);
        packets.push(...this.damage(dash.power.mul(D('2.46')), now,
          { target, school: 'energy' })[0]);
        for (const template of [303213, 303214, 303215]) {
          packets.push(...this._buff(template, now, target.id));
        }
        packets.push(...this._resource(25));
        packets.push(...this.restoreHp(dash.power.mul(D('.75')), now));
      }
      for (const [token, web] of [...this.webs]) {
        if (circleContact(start, end, web.pos, web.pos, 144) !== null) {
          this.webs.delete(token);
          packets.push(...this.removeObject(web.id, { destroyed: true }));
          this.cooldowns[1] = now;
          packets.push(this._cooldown(1));
        }
      }
      if (now >= dash.end) {
        this.dash = null;
        for (const template of [303202, 303203]) {
          packets.push(...this.removeBuff(template, now));
        }
      } else {
        dash.previous = now;
        this._queue(Math.min(now + 20, dash.end), kind, dash);
      }
      return packets;
    }
    if (kind === 'web_tick') {
      const [token] = data;
      const web = this.webs.get(token);
      if (web === undefined) return [];
      if (now >= web.end) {
        this.webs.delete(token);
        return this.removeObject(web.id);
      }
      const packets = [];
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(web.pos[0] - target.positionAt(now)[0],
            web.pos[1] - target.positionAt(now)[1]) <= 72) {
          packets.push(...this._web_contact(target, web, now));
        }
      }
      this._queue(Math.min(now + 100, web.end), kind, token);
      return packets;
    }
    if (kind === 'web_dot') {
      const [key, dot] = data;
      const target = this.arena.actors.get(Number(key.split(',')[0]));
      if (this.web_dots.get(key) !== dot || !target?.alive
        || target.generation !== Number(key.split(',')[1])
        || now > dot.end || target.buffVersions.get(303403) !== dot.version) return [];
      this._queue(now + 1000, kind, key, dot);
      return this.damage(dot.power.mul(D('.5')), now,
        { target, school: 'energy', periodic: true })[0];
    }
    if (kind === 'spider_field_open') {
      const [token] = data;
      const field = this.fields.get(token);
      if (field === undefined) return [];
      const packets = this.removeObject(field.id, { destroyed: true });
      const [ident, packet] = this.addObject(303301, field.pos);
      field.id = ident;
      field.previous = now;
      packets.push(packet);
      for (let offset = 1000; offset <= 6000; offset += 1000) {
        this._queue(now + offset, 'spider_field_damage', token);
      }
      this._queue(now + 20, 'spider_field_clock', token);
      this._queue(now, 'spider_field_presence', token);
      this._queue(now + 6000, 'spider_field_end', token);
      return packets;
    }
    if (kind === 'spider_field_presence') {
      const field = this.fields.get(data[0]);
      if (field === undefined || now >= field.end) return [];
      const packets = [];
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(field.pos[0] - target.positionAt(now)[0],
            field.pos[1] - target.positionAt(now)[1]) <= 300) {
          for (const template of [303303, 303305]) {
            packets.push(...this._buff(template, now, target.id));
          }
        }
      }
      this._queue(now + 500, kind, ...data);
      return packets;
    }
    if (kind === 'spider_field_damage') {
      const field = this.fields.get(data[0]);
      if (field === undefined) return [];
      const packets = [];
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(field.pos[0] - target.positionAt(now)[0],
            field.pos[1] - target.positionAt(now)[1]) <= 300) {
          packets.push(...this.damage(field.power.mul(D('.6')), now,
            { target, school: 'energy', periodic: true })[0]);
        }
      }
      if (Math.hypot(field.pos[0] - this.positionAt(now)[0],
        field.pos[1] - this.positionAt(now)[1]) <= 300) {
        packets.push(...this._resource(20));
      }
      return packets;
    }
    if (kind === 'spider_field_clock') {
      const field = this.fields.get(data[0]);
      if (field === undefined) return [];
      const packets = [];
      // Two extra ms per elapsed ms while the caster is inside its field.
      if (Math.hypot(field.pos[0] - this.positionAt(now)[0],
        field.pos[1] - this.positionAt(now)[1]) <= 300) {
        const extra = (now - field.previous) * 2;
        for (const slot of [1, 10]) {
          if (this.cooldowns[slot] > now) {
            this.cooldowns[slot] = Math.max(now, this.cooldowns[slot] - extra);
          }
        }
        if (this.r_next_charge) this.r_next_charge -= extra;
        packets.push(...this.update(now));
        if ((now - field.begin) % 500 === 0) {
          packets.push(this._cooldown(1), this._cooldown(10));
        }
      }
      field.previous = now;
      if (now < field.end) this._queue(Math.min(now + 20, field.end), kind, ...data);
      return packets;
    }
    if (kind === 'spider_field_end') {
      const packets = this._event(now, 'spider_field_clock', data);
      const field = this.fields.get(data[0]);
      this.fields.delete(data[0]);
      return field ? packets.concat(this.removeObject(field.id, { destroyed: true })) : packets;
    }
    return super._event(now, kind, data);
  }

  _flight(flight, now) {
    if (flight.template !== 303401) return super._flight(flight, now);
    const { previous, begin, finish } = flight;
    const start = pointAt(flight.start, flight.end, (previous - begin) / (finish - begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - begin) / (finish - begin)));
    const wall = this.arena.geometry.wallContact(start, end);
    const candidates = [];
    for (const target of this.arena.actors.values()) {
      if (target.alive && target.camp !== this.camp) {
        const hit = actorContact(start, end, target, previous, now);
        if (hit !== null && (wall === null || hit < wall)) candidates.push([hit, target.id]);
      }
    }
    candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const contact = candidates.length ? candidates[0] : null;
    const packets = [];
    if (contact) {
      const target = this.arena.actors.get(contact[1]);
      if (this.projectileBlocked(target, now)) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      packets.push(...this.damage(flight.raw, now, { target, school: 'energy' })[0]);
    }
    if (contact || wall !== null || now >= finish) {
      const pos = pointAt(start, end, contact ? contact[0] : (wall !== null ? wall : 1));
      packets.push(scene({ blownBullets: [flight.id] }));
      if (this.alive && this.generation === flight.source_generation) {
        packets.push(...this._web(pos.map(pyRound), flight.power, now));
      }
      return packets;
    }
    flight.previous = now;
    this._queue(Math.min(now + 20, finish), 'flight', flight);
    return packets;
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (slot !== 2 && (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1]))) {
      return [];
    }
    if ((slot === 1 && (this.mp < 25 || this.dash)) || (slot === 10 && !this.r_count)) return [];
    if (slot === 0 && this.hasBuff(303112, now)) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 8000, 2: 25000, 10: 1500 }[slot], slot);
    const packets = slot === 0 ? this._buff(303111, now) : [];
    if (slot === 0) {
      if (this.hasBuff(303113, now)) {
        packets.push(...this.removeBuff(303113, now));
        this._queue(now + 100, 'spider_shot', this.generation, 303131, start, dest, power);
      } else {
        packets.push(...this.shoot(303100, start, dest, now, power,
          { school: 'energy', basic: true }));
      }
    } else if (slot === 10) {
      this.r_count -= 1;
      if (!this.r_next_charge) this.r_next_charge = now + this.skillCooldown(6000);
      for (const template of [303112, 303113]) packets.push(...this._buff(template, now));
      packets.push(this._cooldown(0, true), this._cooldown(0));
      this._queue(now + 100, 'spider_shot', this.generation, 303401, start, dest, power);
    } else if (slot === 1) {
      packets.push(...this._resource(-25));
      const span = Math.hypot(start[0] - dest[0], start[1] - dest[1]);
      dest = this._clipped(start, pointAt(start, dest, 360 / span));
      // MOVE_DASH (3), not MOVE_TRANSFER (2): the self consumer needs a dash.
      const duration = this._setMotion(start, dest, 720, now, 3);
      dest = this.motion[1];
      this.forcedUntil = now + duration;
      this.dash = { power, previous: now, end: now + duration, hits: new Set() };
      for (const template of [303202, 303203]) {
        packets.push(...this._buff(template, now, null, { duration }));
      }
      packets.push(scene({
        moves: [this._moveEvent(dest, 720, 3)],
        skills: [this._skillEvent(303201, start, dest)],
      }));
      this._queue(now + Math.min(20, duration), 'spider_dash', this.dash);
    } else {
      const [ident, packet] = this.addObject(303311, start);
      this.fields.set(ident, {
        id: ident, pos: start, power, begin: now + 500, end: now + 6500,
        previous: now + 500,
      });
      this._queue(now + 500, 'spider_field_open', ident);
      packets.push(scene({ skills: [this._skillEvent(303301, start, start, this.id)] }), packet);
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as SPIDER_SLOTS };
