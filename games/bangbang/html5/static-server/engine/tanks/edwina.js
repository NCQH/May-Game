/* Edwina Knight (tank 10000066): paid mobile E, projectile ward R and a
 * persistent sword field. Port of server/edwina_actions.py.
 *
 * Stubs: no skin/presentation.
 */
import { TankActions } from '../arena.js';
import { D, pyRound } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, inStrip, prepareDisplacement } from './melee.js';
import { samePosition } from './batch-d-common.js';

const SLOTS = { 0: 341100, 1: 341201, 2: 341301, 10: 341401 };

export class EdwinaActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.channel = this.ready = this.combat = null;
    this.mp = Number(this.stats.iMp);
  }

  _resource(delta) {
    if (this.noel_box) return [];
    const old = this.mp;
    this.mp = Math.max(0, Math.min(Number(this.stats.iMp), this.mp + delta));
    return old !== this.mp ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  _cooldown(slot, changed = false) {
    if (!(slot in SLOTS)) {
      return [1572, encodeS1572(this.id, {
        skillId: this.skillForSlot(slot) ?? 0, slot, count: -1,
        end: this.cooldowns[slot] ?? 0, nextCharge: 0,
      })];
    }
    const skill = slot === 1 && this.channel ? 341221 : SLOTS[slot];
    const info = { skillId: skill, slot, count: -1, end: this.cooldowns[slot], nextCharge: 0 };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.mp = Number(this.stats.iMp);
    this.combat = null;
    this._queue(now + 1000, 'edwina_idle', this.generation);
    const packets = [];
    for (const template of [341101, 341102, 341103, 341104]) {
      packets.push(...this._buff(template, now));
    }
    return packets.concat([this._cooldown(1, true)]);
  }

  on_combat(now) {
    if (this.alive) this.combat = { end: now + 5000 };
  }

  block_hit(key, amount, now, { basic = false, periodic = false, source = null } = {}) {
    if (amount > 0) this.on_combat(now);
    return [false, []];
  }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  reject_buff(row, source, now) {
    return Boolean(this.ready && source.camp !== this.camp);
  }

  cc_immune(now, { slow = false } = {}) {
    return Boolean(this.ready) || super.ccImmune(now, { slow });
  }

  _endChannel(now) {
    if (!this.channel) return [];
    this.channel = null;
    this.cooldowns[1] = now + this.skillCooldown(1000, 1);
    const packets = [];
    for (const template of [341201, 341202, 341203, 341204]) {
      packets.push(...this.removeBuff(template, now));
    }
    return packets.concat([this._cooldown(1, true), this._cooldown(1)], this.syncSpeed(now));
  }

  interrupt(now) {
    if (this.alive) return []; // Mobile E persists through crowd control.
    this.ready = null;
    delete this.info.damage_immune;
    return this._endChannel(now).concat(this.syncSpeed(now));
  }

  on_bullet_hit(flight, target, now) {
    return this.alive && flight.source_generation === this.generation ? this._resource(5) : [];
  }

  _event(now, kind, data) {
    if (kind === 'edwina_idle') {
      if (!this.alive || data[0] !== this.generation) return [];
      this._queue(now + 1000, kind, ...data);
      const idle = !this.channel && !this.ready && !this.hasBuff(341401, now)
        && (!this.combat || now >= this.combat.end);
      const packets = [];
      for (const template of [341111, 341112]) {
        if (idle && !this.hasBuff(template, now)) packets.push(...this._buff(template, now));
        if (!idle) packets.push(...this.removeBuff(template, now));
      }
      return idle ? packets.concat(this.restoreHp(this.maxHp.mul(D('.03')), now),
        this._resource(5)) : packets;
    }
    if (kind === 'edwina_aura') {
      const [cast, index] = data;
      if (this.channel !== cast || !this.alive) return [];
      if (this.mp < 10) return this._endChannel(now);
      const packets = this._resource(-10);
      if (index % 2 === 0) {
        const start = this.positionAt(now);
        for (const target of enemies(this, { area: true })) {
          if (Math.hypot(start[0] - target.positionAt(now)[0],
            start[1] - target.positionAt(now)[1]) <= 144) {
            packets.push(...this.damage(this.combatStat('iEgAtk', now).mul(D('1.52')), now,
              { target, school: 'energy', lifesteal: D('.3') })[0]);
            const key = `${target.id},${target.generation}`;
            const last = cast.slows.get(key);
            const count = last && last.end >= now ? last.count : 0;
            packets.push(...this._buff(341212, now, target.id,
              { duration: 1000, stacks: Math.min(2, count + 1) }));
            if (target.hasBuff(341212, now)) {
              cast.slows.set(key, { count: Math.min(2, count + 1), end: now + 1000 });
            }
          }
        }
      }
      this._queue(now + 500, kind, cast, index + 1);
      return packets;
    }
    if (kind === 'edwina_guard_heal') {
      const [generation, version] = data;
      if (!this.alive || this.generation !== generation
        || this.buffVersions.get(341401) !== version) return [];
      return this.restoreHp(this.maxHp.mul(D('.03')), now).concat(this._resource(10));
    }
    if (kind === 'edwina_sword') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      delete this.info.damage_immune;
      const packets = this.removeBuff(341321, now).concat([
        scene({ skills: [this._skillEvent(341301, cast.start, cast.dest)] }),
      ]);
      for (const target of enemies(this, { area: true })) {
        if (inStrip(target.positionAt(now), cast.start, cast.dest, 600, 150)) {
          packets.push(...this.damage(cast.power.mul(D('2.23')), now,
            { target, school: 'energy' })[0]);
        }
      }
      const [ident, packet] = this.addObject(341302, cast.start.map(pyRound));
      packets.push(packet);
      cast.id = ident;
      cast.end = now + 6000;
      for (let index = 1; index <= 12; index += 1) {
        this._queue(now + index * 500, 'edwina_field', cast, index);
      }
      return packets.concat(this.syncSpeed(now));
    }
    if (kind === 'edwina_field') {
      const [cast, index] = data;
      const packets = [];
      for (const target of enemies(this, { area: true })) {
        if (inStrip(target.positionAt(now), cast.start, cast.dest, 600, 150)) {
          packets.push(...this.damage(cast.power.mul(D('.82')), now,
            { target, school: 'energy', periodic: true })[0]);
          packets.push(...this._buff(341311, now, target.id, { duration: 550 }));
          packets.push(...this._buff(341312, now, target.id, { duration: 550 }));
        }
      }
      if (this.alive && this.generation === cast.generation
        && inStrip(this.positionAt(now), cast.start, cast.dest, 600, 150)) {
        packets.push(...this._buff(341313, now, null,
          { duration: Math.min(550, Math.max(1, cast.end - now)) }));
        if (index % 2 === 0) {
          packets.push(...this.restoreHp(this.maxHp.mul(D('.03')), now), ...this._resource(15));
        }
      }
      if (index === 12) packets.push(...this.removeObject(cast.id));
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || !this.alive || this.ready || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (slot !== 10 && this.blocked('attack', now)) return [];
    if (slot === 1 && this.channel) return this._endChannel(now);
    if ([0, 2, 10].includes(slot) && (samePosition(start, dest) || !this._inside(dest))) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + {
      0: this.fireInterval(now), 1: 1000,
      2: this.skillCooldown(25000, 2), 10: this.skillCooldown(10000, 10),
    }[slot];
    const packets = [this._cooldown(slot)];
    if (slot === 0) {
      return packets.concat(this.shoot(341100, start, dest, now, power,
        { school: 'energy', basic: true }));
    }
    if (slot === 1) {
      if (this.mp < 10) {
        this.cooldowns[1] = now;
        return [];
      }
      this.channel = { generation: this.generation, slows: new Map() };
      for (const template of [341201, 341202, 341203, 341204]) {
        packets.push(...this._buff(template, now));
      }
      this._queue(now + 500, 'edwina_aura', this.channel, 1);
      return packets.concat([this._cooldown(1, true)]);
    }
    if (slot === 10) {
      const endpoint = aimed(start, dest, 336, { fixed: true });
      let origin, stopped;
      [origin, stopped] = prepareDisplacement(this, now, { interrupt: false });
      origin = stopped.length ? origin : start;
      const duration = this._setMotion(origin, endpoint, 600, now, 3);
      this.forcedUntil = now + duration;
      const version = (this.buffVersions.get(341401) ?? 0) + 1;
      for (let offset = 500; offset <= 2500; offset += 500) {
        this._queue(now + offset, 'edwina_guard_heal', this.generation, version);
      }
      for (const template of [341401, 341402, 341403, 341404]) {
        packets.push(...this._buff(template, now));
      }
      packets.push(...stopped);
      return packets.concat([scene({ moves: [this._moveEvent(this.motion[1], 600, 3)] })]);
    }
    let origin, stopped;
    [origin, stopped] = prepareDisplacement(this, now, { interrupt: false });
    this.position = stopped.length ? origin : start;
    this.motion = null;
    this.ready = {
      slot: 2, start, dest: aimed(start, dest, 600, { fixed: true }), power,
      generation: this.generation,
    };
    this.info.damage_immune = true;
    this._queue(now + 500, 'edwina_sword', this.ready);
    return packets.concat(this._buff(341321, now, null, { duration: 500 }), [
      scene({ skills: [this._skillEvent(341301, start, this.ready.dest, 0, { ready: 1 })] }),
    ], this.syncSpeed(now), stopped);
  }
}

export { SLOTS as EDWINA_SLOTS };
