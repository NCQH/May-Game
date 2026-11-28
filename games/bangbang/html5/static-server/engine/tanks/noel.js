/* Noel (tank 10000054): gifts, mixed-team projectiles and the native rescue
 * box. Port of server/noel_actions.py.
 *
 * Stubs: presentation only; the box reuses HuluTurret and the core's noel_box
 * hold hook.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, circleContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1556, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, piercingStep, packII, prepareDisplacement } from './melee.js';
import { choose } from './batch-f2-common.js';
import { HuluTurret } from './hulu.js';

const SLOTS = { 0: 329100, 1: 329201, 2: 329301, 10: 329401 };
const BOX_NPC = [20017, 20006, 329303];

export class NoelActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = null;
    this.e_count = this.r_count = 3;
    this.e_next_charge = this.r_next_charge = 0;
  }

  _cooldown(slot, changed = false) {
    const prefix = slot === 1 ? 'e' : 'r';
    const count = [1, 10].includes(slot) ? this[`${prefix}_count`] : -1;
    const nextCharge = [1, 10].includes(slot) ? this[`${prefix}_next_charge`] : 0;
    const info = {
      skillId: SLOTS[slot], slot, count, end: this.cooldowns[slot] ?? 0, nextCharge,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.ready = null;
    return this._buff(329101, now);
  }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      packets.push([1583, packII(this.id, this.ready.skill)]);
      this.ready = null;
    }
    return packets.concat(this.syncSpeed(now));
  }

  on_control(source, template, now) {
    if (!this.ready) return [];
    const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
    const mask = Number(row.get('fEffectValB', 0));
    return ['35', '66'].includes(row.get('nEffectType'))
      && (!mask || (mask & { 1: 2, 10: 8 }[this.ready.slot])) ? this.interrupt(now) : [];
  }

  update(now) {
    const packets = [];
    for (const [slot, prefix] of [[1, 'e'], [10, 'r']]) {
      let due = this[`${prefix}_next_charge`];
      while (due && due <= now) {
        const count = Math.min(3, this[`${prefix}_count`] + 1);
        this[`${prefix}_count`] = count;
        due = count < 3 ? due + this.skillCooldown(6000) : 0;
        this[`${prefix}_next_charge`] = due;
        packets.push(this._cooldown(slot));
      }
    }
    if (this.ready && this.skillSealed(this.ready.slot, now)) packets.push(...this.interrupt(now));
    return packets.concat(super.update(now));
  }

  _gift(now) {
    const start = this.positionAt(now);
    const candidates = [];
    for (const radius of [72, 120, 168]) {
      for (let i = 0; i < 16; i += 1) {
        const angle = 2 * Math.PI * i / 16;
        const pos = [pyRound(start[0] + radius * Math.cos(angle)),
          pyRound(start[1] + radius * Math.sin(angle))];
        const free = this.arena.freePosition(pos, now);
        if (free && free[0] === pos[0] && free[1] === pos[1]) candidates.push(pos);
      }
    }
    if (!candidates.length) return [];
    const template = choose(this.arena.rng, [329103, 329104, 329105]);
    return this.shoot(template, start, choose(this.arena.rng, candidates), now, D(0), {
      school: 'energy', fixed_destination: true, through_walls: true,
    });
  }

  _gift_reward(target, template, generation, now) {
    const packets = [];
    if (template === 329103) packets.push(...this._buff(329113, now, target.id));
    else if (template === 329104) {
      packets.push(...target.addShield(329114, target.maxHp.mul(D('.2')), now, { caster: this }));
    }
    if (this.alive && this.generation === generation && !this.effectBlocked()) {
      for (const [slot, field] of [[1, 'e_next_charge'], [10, 'r_next_charge'], [2, null]]) {
        const old = field ? this[field] : this.cooldowns[slot];
        if (old) {
          let remaining = Math.max(0, old - now - 500);
          if (template === 329105) remaining = pyRound(remaining * 0.8);
          if (field) this[field] = now + remaining;
          else this.cooldowns[slot] = now + remaining;
          packets.push(this._cooldown(slot));
        }
      }
    }
    return packets;
  }

  _box_hit(flight, target, now) {
    if (target.info.npc_template || target.ccImmune(now)) return [];
    const packets = this._buff(329301, now, target.id).concat(this._buff(329302, now, target.id));
    if (target.hasBuff(329302, now)) {
      this._queue(now + 830, 'noel_box', {
        target: target.id, target_generation: target.generation,
        version: target.buffVersions.get(329302), source_generation: flight.source_generation,
      });
    }
    return packets;
  }

  _flight(flight, now) {
    const template = flight.template;
    if (template === 329100) return super._flight(flight, now);
    if (template === 329301) {
      return piercingStep(this, flight, now, (f, t, n) => this._box_hit(f, t, n),
        { pierce: false, contactRadius: 72 });
    }
    if (template === 329201) {
      const a = pointAt(flight.start, flight.end,
        (flight.previous - flight.begin) / (flight.finish - flight.begin));
      const b = pointAt(flight.start, flight.end,
        Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
      const contacts = [];
      for (const target of this.arena.actors.values()) {
        const key = `${target.id},${target.generation}`;
        if (!target.alive || target.isUntargetable() || flight.hits.has(key)
          || BOX_NPC.includes(target.info.npc_template)) continue;
        const hit = actorContact(a, b, target, flight.previous, now, 84);
        if (hit !== null) contacts.push([hit, target.id, target, key]);
      }
      contacts.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
      const packets = [];
      for (const [, , target, key] of contacts) {
        if (target.camp !== this.camp && this.projectileBlocked(target, now)) {
          return packets.concat([scene({ expiredBullets: [flight.id] })]);
        }
        flight.hits.add(key);
        packets.push(...(target.camp === this.camp
          ? target.restoreHp(flight.raw, now)
          : this.damage(flight.raw, now, { target, school: 'energy' })[0]));
      }
      if (now >= flight.finish) {
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
    } else {
      const packets = [];
      if (template === 329401) {
        const a = pointAt(flight.start, flight.end,
          (flight.previous - flight.begin) / (flight.finish - flight.begin));
        const b = pointAt(flight.start, flight.end,
          Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
        for (const target of this.arena.actors.values()) {
          if (target.alive && target.camp !== this.camp && !target.isUntargetable()
            && actorContact(a, b, target, flight.previous, now) !== null
            && this.projectileBlocked(target, now)) {
            return [scene({ expiredBullets: [flight.id] })];
          }
        }
      }
      if (now >= flight.finish) {
        packets.push(scene({ blownBullets: [flight.id] }));
        if (template === 329401) {
          for (const target of [...this.arena.actors.values()]) {
            if (!target.alive || !target.isAreaTargetable()) continue;
            const tpos = target.positionAt(now);
            if (Math.hypot(flight.end[0] - tpos[0], flight.end[1] - tpos[1]) > 120) continue;
            if (target.camp === this.camp) {
              if (target !== this || flight.source_generation === this.generation) {
                packets.push(...target.restoreHp(flight.raw, now));
              }
            } else {
              packets.push(...this.damage(flight.raw, now, { target, school: 'energy' })[0],
                ...this._buff(329402, now, target.id));
            }
          }
        } else {
          const [ident, packet] = this.addObject(template, flight.end);
          packets.push(packet);
          this._queue(now + 50, 'noel_pickup', {
            id: ident, pos: flight.end, template, previous: now,
            end: now + 5000, generation: flight.source_generation,
          });
        }
        return packets;
      }
    }
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return [];
  }

  _event(now, kind, data) {
    if (kind === 'noel_cast') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || cast.generation !== this.generation) return [];
      this.ready = null;
      const start = this.positionAt(now);
      const packets = this.syncSpeed(now);
      if (cast.slot === 1) packets.push(...this.restoreHp(cast.power.mul(D('2.25')), now));
      packets.push(...this.shoot(cast.skill, start, cast.dest, now,
        cast.power.mul(D(cast.slot === 1 ? '2.25' : '1.65')), {
          school: 'energy', power: cast.power, through_walls: true,
          fixed_destination: cast.slot === 10,
          hit_ids: cast.slot === 1 ? [`${this.id},${this.generation}`] : [],
        }));
      return packets;
    }
    if (kind === 'noel_pickup') {
      const [gift] = data;
      if (!this.arena.objects.has(gift.id)) return [];
      const targets = [];
      for (const target of this.arena.actors.values()) {
        if (!target.alive || target.camp !== this.camp || target.info.npc_template
          || target.isUntargetable()) continue;
        const hit = circleContact(target.positionAt(gift.previous), target.positionAt(now),
          gift.pos, gift.pos, 72);
        if (hit !== null) targets.push([hit, target.id, target]);
      }
      if (targets.length || now >= gift.end) {
        targets.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const packets = this.removeObject(gift.id, { destroyed: targets.length > 0 });
        if (targets.length) {
          packets.push(...this._gift_reward(targets[0][2], gift.template, gift.generation, now));
        }
        return packets;
      }
      gift.previous = now;
      this._queue(Math.min(now + 50, gift.end), kind, gift);
      return [];
    }
    if (kind === 'noel_box') {
      const [cast] = data;
      const target = this.arena.actors.get(cast.target);
      if (!target || !target.alive || target.generation !== cast.target_generation
        || target.isUntargetable() || target.ccImmune(now)
        || target.buffVersions.get(329302) !== cast.version) return [];
      const [, packets] = prepareDisplacement(target, now, { interrupt: false });
      packets.push(...target.update(now), ...target.interrupt(now));
      target.position = target.positionAt(now);
      target.motion = null;
      // Durations live in tuples so checkpoint rebasing cannot confuse them.
      const saved = {
        remaining_slots: Object.entries(target.cooldowns)
          .map(([slot, value]) => [Number(slot), Math.max(0, value - now)]),
        remaining_fields: [],
      };
      for (const key of Object.keys(target)) {
        if (['e_count', 'r_count', 'space_count'].includes(key) || key.endsWith('_next_charge')) {
          const value = target[key];
          saved.remaining_fields.push([key,
            key.endsWith('_next_charge') && value ? Math.max(0, value - now) : value]);
        }
      }
      const info = {
        acct_id: this.info.acct_id, tank_id: this.info.tank_id,
        tank_level: this.info.tank_level, npc_template: 329303, owner: this.id,
        in_room: true, name: 'Hộp Quà Noel', summon_stats: { ...this.stats },
        target: target.id, target_generation: target.generation,
      };
      Object.assign(info.summon_stats, {
        iHp: '6000', iArmor: '0', iEgArmor: '0', iSpeed: '0',
      });
      const box = new NoelBox(this.arena, this._newId(5), info, this.camp, target.position);
      box.saved = saved;
      this.arena.actors.set(box.id, box);
      box.end = now + 8000;
      box._queue(box.end, 'noel_release');
      packets.push(box.snapshot(now), ...box._buff(329303, now));
      for (const template of [329305, 329306, 329304]) {
        packets.push(...this._buff(template, now, target.id, { duration: 8000 }));
      }
      target.noel_box = box.id;
      return packets.concat([scene({ moves: [target._moveEvent(target.position, 0, 5)] })],
        target.syncSpeed(now));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now
      || (start[0] === dest[0] && start[1] === dest[1])) return [];
    const prefix = slot === 1 ? 'e' : 'r';
    if ([1, 10].includes(slot) && !this[`${prefix}_count`]) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 1500, 10: 1500, 2: 25000 }[slot], slot);
    if (slot === 0) {
      return this.shoot(329100, start, dest, now, power, {
        school: 'energy', basic: true,
      }).concat([this._cooldown(0)]);
    }
    const packets = this._gift(now);
    if (slot === 2) {
      return packets.concat([this._cooldown(slot)],
        this.shoot(329301, start, dest, now, D(0), {
          school: 'energy', through_walls: true,
        }));
    }
    this[`${prefix}_count`] -= 1;
    if (!this[`${prefix}_next_charge`]) {
      this[`${prefix}_next_charge`] = now + this.skillCooldown(6000);
    }
    this.ready = {
      slot, skill: SLOTS[slot], dest: slot === 10 ? aimed(start, dest, 720) : dest,
      power, generation: this.generation,
    };
    const [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
    this.position = stopped.length ? body : start;
    this.motion = null;
    this._queue(now + 50, 'noel_cast', this.ready);
    return packets.concat([
      scene({ skills: [this._skillEvent(SLOTS[slot], start, this.ready.dest, 0, { ready: 1 })] }),
      this._cooldown(slot),
    ], this.syncSpeed(now), stopped);
  }
}

export class NoelBox extends HuluTurret {
  hold(target, now) {
    target.cooldowns = {};
    for (const [slot, remaining] of this.saved.remaining_slots) {
      target.cooldowns[slot] = now + remaining;
    }
    for (const [key, value] of this.saved.remaining_fields) {
      target[key] = key.endsWith('_next_charge') && value ? now + value : value;
    }
  }

  snapshot(now) {
    return [1556, encodeS1556(this.sceneId, {
      objectId: this.id, templateId: 329303, x: this.positionAt(now)[0],
      y: this.positionAt(now)[1], hp: this.hp.ceil(), camp: this.camp,
      maxHp: 6000, ownerId: this.info.owner, shield: 0, buffs: [],
    })];
  }

  reject_buff(row, source, now) { return source.camp !== this.camp; }

  ccImmune() { return true; }

  cc_immune() { return true; }

  on_spawn() { return []; }

  cast() { return []; }

  restoreHp() { return []; }

  addShield() { return []; }

  release(now) {
    const target = this.arena.actors.get(this.info.target);
    if (!target || target.generation !== this.info.target_generation
      || target.noel_box !== this.id) return [];
    target.noel_box = null;
    this.hold(target, now);
    const packets = [];
    for (const template of [329304, 329305, 329306]) {
      packets.push(...target.removeBuff(template, now));
    }
    for (const slot of Object.keys(target.cooldowns)) packets.push(target._cooldown(Number(slot)));
    return packets.concat(target.syncSpeed(now));
  }

  commitHp(hp, now, { critical = false } = {}) {
    const packets = hp.le(0) ? this.release(now) : [];
    return packets.concat(super.commitHp(hp, now, { critical }));
  }

  _event(now, kind, data) {
    if (kind === 'noel_release') return this.alive ? this.commitHp(D(0), now) : [];
    return super._event(now, kind, data);
  }
}

export { SLOTS as NOEL_SLOTS };
