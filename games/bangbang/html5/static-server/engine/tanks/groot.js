/* Groot (tank 10000002): passive regrowth, drain/borrow, seeded field.
 * Port of server/groot_actions.py onto the JS battle core.
 *
 * Stubs: presentation only. The mobile drain is an aura (not a held beam);
 * stat loans use the core statLoans map so combatStat reads them directly.
 */
import { TankActions, TANK_CONTACT_RADIUS } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';

const SLOTS = { 0: 416100, 1: 416201, 2: 416301, 10: 416401 };
const BORROW_KEYS = ['iAttack', 'iEgAtk', 'iArmor', 'iEgArmor'];

export class GrootActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.passive_ready_at = 0;
    this.drain = null;
    this.fields = new Map();
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    })];
  }

  on_spawn(now) { return this._buff(416101, now); }

  onDamage(source, hit, now, school, reflected, attacker_ap) {
    if (!this.alive || !hit.hp_loss.gt(0) || this.hp.ge(this.maxHp.mul(D('.8')))
      || this.passive_ready_at > now) return [];
    this.passive_ready_at = now + 10000;
    const start = this.positionAt(now);
    const packets = [scene({ skills: [this._skillEvent(416111, start, start, this.id)] })];
    packets.push(...this.restoreHp(this.maxHp.mul(D('.05')), now));
    packets.push(...this._buff(416102, now, null, { duration: 3000 }));
    packets.push(...this.cleanse(now));
    packets.push(...this._buff(416104, now));
    packets.push(...this._buff(416105, now, null, { duration: 3000 }));
    for (const offset of [1000, 2000, 3000]) {
      this._queue(now + offset, 'regrowth', this.generation, this.buffVersions.get(416102));
    }
    return packets;
  }

  interrupt(now) {
    if (this.alive) return []; // Mobile R is an aura, not a held beam.
    const packets = [];
    if (this.drain) {
      this.drain = null;
      this.cooldowns[10] = now + this.skillCooldown(8000, 10);
      packets.push(this._cooldown(10));
    }
    for (const field of this.fields.values()) packets.push(...this.removeObject(field.id));
    this.fields.clear();
    return packets;
  }

  _borrow(target, now) {
    const key = `${this.id},${this.generation},${target.id},${target.generation}`;
    const old = this.statLoans.get(key);
    const continuing = Boolean(old && old.end > now && this.hasBuff(416413, now));
    const base = continuing ? old.base
      : Object.fromEntries(BORROW_KEYS.map(k => [k, target.combatStat(k, now)]));
    const stacks = continuing ? Math.min(10, old.stacks + 1) : 1;
    const values = Object.fromEntries(BORROW_KEYS
      .map(k => [k, base[k].mul(D('.05')).mul(stacks)]));
    const packets = [];
    for (const [owner, templates] of [[this, [416412, 416413]],
      [target, [416415, 416416]]]) {
      for (const template of templates) {
        packets.push(...this._buff(template, now, owner.id));
      }
    }
    this.statLoans.set(key, {
      base, values: new Map(Object.entries(values)), stacks, end: now + 2000,
      armor_buff: 416412, attack_buff: 416413,
    });
    target.statLoans.set(key, {
      values: new Map(Object.entries(values).map(([k, v]) => [k, v.neg()])),
      end: now + 2000, armor_buff: 416415, attack_buff: 416416,
    });
    return packets;
  }

  _field_tick(field, now) {
    const packets = [];
    for (const target of this.arena.actors.values()) {
      if (!target.alive || Math.hypot(field.pos[0] - target.positionAt(now)[0],
        field.pos[1] - target.positionAt(now)[1]) > 264) continue;
      if (target.camp === this.camp) {
        for (const template of [416321, 416322, 416325]) {
          packets.push(...this._buff(template, now, target.id));
        }
      } else {
        packets.push(...target.stripDefenses(now));
        packets.push(...this._buff(416323, now, target.id));
        packets.push(...this._buff(416324, now, target.id));
        const key = `${target.id},${target.generation}`;
        let mark = field.marks.get(key);
        if (mark === undefined || mark.end <= now) {
          mark = { pos: target.positionAt(now), end: now + 2000, previous: now,
            steps: [], stage: 0, done: false };
          field.marks.set(key, mark);
          this._queue(now + 20, 'movement_mark', field, key, mark);
        }
        mark.end = now + 2000;
      }
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'regrowth') {
      const [generation, version] = data;
      if (this.alive && generation === this.generation
        && this.buffVersions.get(416102) === version) {
        return this.restoreHp(this.maxHp.mul(D('.02')), now);
      }
      return [];
    }
    if (kind === 'drain_tick') {
      const [cast] = data;
      if (this.drain !== cast || !this.alive || cast.generation !== this.generation) return [];
      const pos = this.positionAt(now);
      const packets = [scene({ skills: [this._skillEvent(416411, pos, pos, this.id)] })];
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(pos[0] - target.positionAt(now)[0],
            pos[1] - target.positionAt(now)[1]) <= 192) {
          const [hit, lost] = this.damage(cast.power.mul(D('.42')), now,
            { target, school: 'energy' });
          packets.push(...hit);
          if (lost) {
            packets.push(...this._borrow(target, now));
            packets.push(...this.restoreHp(cast.power.mul(D('.26')), now));
          }
        }
      }
      if (now === cast.end) {
        this.drain = null;
        packets.push(...this.removeBuff(416403, now));
        packets.push(...this._buff(416421, now));
        this.cooldowns[10] = now + this.skillCooldown(8000, 10);
        packets.push(this._cooldown(10));
      }
      return packets;
    }
    if (kind === 'field_open') {
      const [token] = data;
      const field = this.fields.get(token);
      if (field === undefined) return [];
      const packets = this.removeObject(field.id, { destroyed: true });
      const [ident, packet] = this.addObject(416311, field.pos);
      field.id = ident;
      packets.push(packet);
      for (const target of [...this.arena.actors.values()]) {
        if (!target.alive || Math.hypot(field.pos[0] - target.positionAt(now)[0],
          field.pos[1] - target.positionAt(now)[1]) > 264) continue;
        if (target.camp === this.camp) {
          packets.push(...target.restoreHp(field.power.mul(D('1.95')), now));
          packets.push(...this._buff(416313, now, target.id));
        } else {
          packets.push(...this.damage(field.power.mul(D('2.47')), now,
            { target, school: 'energy' })[0]);
          packets.push(...target.stripDefenses(now));
          packets.push(...this._buff(416315, now, target.id));
        }
      }
      this._queue(now, 'field_tick', token);
      return packets;
    }
    if (kind === 'field_tick') {
      const [token] = data;
      const field = this.fields.get(token);
      if (field === undefined) return [];
      if (now >= field.end) {
        this.fields.delete(token);
        return this.removeObject(field.id, { destroyed: true });
      }
      this._queue(Math.min(now + 500, field.end), kind, token);
      return this._field_tick(field, now); // Refresh 550 ms buffs continuously.
    }
    if (kind === 'movement_mark') {
      const [, key, mark] = data;
      const target = this.arena.actors.get(Number(key.split(',')[0]));
      if (!target?.alive || target.generation !== Number(key.split(',')[1])
        || now >= mark.end || !target.hasBuff(416324, now) || mark.done) return [];
      const pos = target.positionAt(now);
      mark.steps.push({ end: now, distance: Math.hypot(mark.pos[0] - pos[0],
        mark.pos[1] - pos[1]) });
      mark.steps = mark.steps.filter(s => s.end > now - 2000);
      mark.pos = pos;
      mark.previous = now;
      const span = mark.steps.reduce((sum, s) => sum + s.distance, 0);
      const stage = Math.min(3, Math.floor(span / 90));
      const packets = [];
      if (stage !== mark.stage) {
        for (const template of [416341, 416342, 416343]) {
          packets.push(...target.removeBuff(template, now));
        }
        if (stage) packets.push(...this._buff(416340 + stage, now, target.id));
        mark.stage = stage;
      }
      if (span >= 360) {
        mark.done = true;
        for (const template of [416351, 416352]) {
          packets.push(...this._buff(template, now, target.id));
        }
        packets.push(...this.damage(target.hp.mul(D('.25')), now,
          { target, school: 'true' })[0]);
      } else {
        this._queue(Math.min(now + 20, mark.end), kind, data[0], key, mark);
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  _flight(flight, now) {
    if (flight.template !== 416201) return super._flight(flight, now);
    const { previous, begin, finish } = flight;
    const start = pointAt(flight.start, flight.end, (previous - begin) / (finish - begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - begin) / (finish - begin)));
    const wall = this.arena.geometry.wallContact(start, end);
    for (const target of [...this.arena.actors.values()]) {
      if (target.alive && target.camp !== this.camp && this.projectileBlocked(target, now)) {
        const hit = actorContact(start, end, target, previous, now);
        if (hit !== null && (wall === null || hit < wall)) {
          return [scene({ expiredBullets: [flight.id] })];
        }
      }
    }
    if (wall === null && now < finish) {
      flight.previous = now;
      this._queue(Math.min(now + 20, finish), 'flight', flight);
      return [];
    }
    const pos = wall !== null ? pointAt(start, end, wall) : end;
    const packets = [scene({ blownBullets: [flight.id] })];
    for (const target of [...this.arena.actors.values()]) {
      if (target.alive && target.camp !== this.camp
        && Math.hypot(pos[0] - target.positionAt(now)[0],
          pos[1] - target.positionAt(now)[1]) <= 168) {
        packets.push(...this.damage(flight.raw, now, { target, school: 'energy' })[0]);
        for (const template of [416202, 416203]) {
          packets.push(...this._buff(template, now, target.id));
        }
      }
    }
    const [ident, packet] = this.addObject(416204, pos);
    this._queue(now + 800, 'object_expire', ident);
    return packets.concat([packet]);
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (slot === 10 && this.drain) return [];
    if ([0, 1, 2].includes(slot) && (!this._inside(dest)
      || (slot !== 2 && start[0] === dest[0] && start[1] === dest[1]))) return [];
    if ((slot === 1 || slot === 2)
      && Math.hypot(start[0] - dest[0], start[1] - dest[1]) > { 1: 480, 2: 360 }[slot]) {
      return [];
    }
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + {
      0: this.fireInterval(now), 1: this.skillCooldown(6000, 1),
      2: this.skillCooldown(30000, 2), 10: 5000,
    }[slot];
    if (slot === 0) {
      return this.shoot(416100, start, dest, now, power,
        { school: 'energy', basic: true }).concat([this._cooldown(slot)]);
    }
    if (slot === 1) {
      const ident = this._newId(2);
      const speed = pyRound(600 * (1 + this.attrBonus([37], now).toNumber()));
      const duration = Math.max(1,
        pyRound(Math.hypot(dest[0] - start[0], dest[1] - start[1]) * 1000 / speed));
      const flight = {
        kind: 'bullet', id: ident, template: 416201, start, end: dest,
        begin: now, finish: now + duration, previous: now, speed,
        raw: power.mul(D('1.89')), source_generation: this.generation,
        school: 'energy', basic: false,
      };
      this._queue(now + Math.min(20, duration), 'flight', flight);
      return [scene({ fires: [{
        bulletId: ident, ownerId: this.id, start, dest, speed, templateId: 416201,
      }] }), this._cooldown(slot)];
    }
    if (slot === 2) {
      const [ident, packet] = this.addObject(416301, dest);
      this.fields.set(ident, { id: ident, pos: dest, power, end: now + 5000, marks: new Map() });
      this._queue(now + 1000, 'field_open', ident);
      return [scene({ skills: [this._skillEvent(416301, start, dest)] }), packet,
        this._cooldown(slot)];
    }
    this.drain = { power, end: now + 5000, generation: this.generation };
    const packets = [scene({ skills: [this._skillEvent(416401, start, start, this.id)] })];
    for (const template of [416401, 416402, 416403]) packets.push(...this._buff(template, now));
    for (let offset = 500; offset <= 5000; offset += 500) {
      this._queue(now + offset, 'drain_tick', this.drain);
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as GROOT_SLOTS, BORROW_KEYS };
