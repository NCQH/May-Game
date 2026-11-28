/* Hulu (tank 10000037): healing zones, shield conversion and a turret.
 * Port of server/hulu_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. The turret is a native NPC20017 actor with
 * pinned motion, manual shield conversion and a 10-tick self-decay.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound, quantize } from '../math.js';
import { scene, encodeS1556, encodeS1562, encodeS1572 } from '../protocol.js';

const SLOTS = { 0: 311100, 1: 311201, 2: 311301, 10: 311401 };

export class HuluActions extends TankActions {
  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    })];
  }

  on_spawn(now) {
    this._queue(now + 3000, 'hulu_passive', this.generation);
    return this._buff(311101, now);
  }

  _area(cast, now, { healing = true } = {}) {
    const packets = [];
    for (const target of this.arena.actors.values()) {
      if (target.alive && target.camp === this.camp
        && Math.hypot(cast.pos[0] - target.positionAt(now)[0],
          cast.pos[1] - target.positionAt(now)[1]) <= 264) {
        if (healing) packets.push(...target.restoreHp(cast.power.mul(D('.5')), now));
        const duration = Math.min(550, cast.end - now);
        if (duration > 0) {
          packets.push(...this._buff(311312, now, target.id, { duration }));
          packets.push(...this._buff(311313, now, target.id, { duration }));
        }
      }
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'hulu_passive') {
      const [generation] = data;
      if (!this.alive || this.generation !== generation) return [];
      this._queue(now + 3000, kind, ...data);
      const pos = this.positionAt(now), power = this.combatStat('iEgAtk', now);
      const packets = [scene({ skills: [this._skillEvent(311111, pos, pos, this.id)] })];
      for (const target of this.arena.actors.values()) {
        if (target.alive && target.camp === this.camp
          && Math.hypot(pos[0] - target.positionAt(now)[0],
            pos[1] - target.positionAt(now)[1]) <= 360) {
          packets.push(...target.restoreHp(power.mul(D('.5')), now));
        }
      }
      return packets;
    }
    if (kind === 'hulu_convert') {
      const [target_id, generation, version, amount] = data;
      const target = this.arena.actors.get(target_id);
      if (!target || !target.alive || target.generation !== generation
        || target.buffVersions.get(311201) !== version) return [];
      const shield = target.shields.find(s => s.shield_id === '311201' && s.expires_ms >= now);
      if (!shield) return [];
      const original = shield.remaining;
      const converted = original.min(amount);
      target.shields = target.shields.map(s => (s === shield
        ? { ...s, remaining: quantize(original.sub(converted)) } : s));
      const packets = target.restoreHp(converted, now);
      if (converted.eq(original)) packets.push(...target.removeBuff(311201, now));
      return packets.concat([target.shieldPacket(now)]);
    }
    if (kind === 'hulu_area') {
      const [cast] = data;
      const packets = this._area(cast, now, { healing: true });
      if (now < cast.end) this._queue(now + 500, kind, cast);
      else packets.push(...this.removeObject(cast.id));
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    const target = this.arena.actors.get(target_id);
    if (slot === 1) {
      if (!target || !target.alive || target.camp !== this.camp
        || Math.hypot(start[0] - target.positionAt(now)[0],
          start[1] - target.positionAt(now)[1]) > 480) return [];
    } else if (!this._inside(dest) || (slot === 0 && start[0] === dest[0] && start[1] === dest[1])) {
      return [];
    } else if ((slot === 2 || slot === 10)
      && Math.hypot(start[0] - dest[0], start[1] - dest[1]) > (slot === 2 ? 480 : 336)) {
      return [];
    }
    if (slot === 10) {
      const clamp = this.arena.geometry.clampTankPosition(dest);
      if (clamp[0] !== dest[0] || clamp[1] !== dest[1]
        || this.arena.geometry.wallContact(dest, dest, 36) !== null) return [];
    }
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 6000, 2: 25000, 10: 8000 }[slot], slot);
    if (slot === 0) {
      return this.shoot(311100, start, dest, now, power,
        { school: 'energy', basic: true }).concat([this._cooldown(0)]);
    }
    const packets = [this._cooldown(slot), scene({
      skills: [this._skillEvent(SLOTS[slot], start,
        slot === 1 ? target.positionAt(now) : dest, slot === 1 ? target.id : 0)],
    })];
    if (slot === 1) {
      const version = (target.buffVersions.get(311201) ?? 0) + 1;
      // Enqueue conversion before the natural expiry at the fifth tick.
      for (let i = 1; i <= 5; i += 1) {
        this._queue(now + i * 1200, 'hulu_convert', target.id, target.generation,
          version, power.mul(D('.45')));
      }
      packets.push(...target.addShield(311201, power.mul(D('2.25')), now, { caster: this }));
      if (target.hasBuff(311201, now) && target.buffVersions.get(311201) === version) {
        for (const buff of [311202, 311203, 311204]) {
          packets.push(...this._buff(buff, now, target.id));
        }
      }
    } else if (slot === 2) {
      const [ident, packet] = this.addObject(311301, dest);
      const cast = { id: ident, pos: dest, power, end: now + 4000, generation: this.generation };
      packets.push(packet, ...this._area(cast, now, { healing: false }));
      this._queue(now + 500, 'hulu_area', cast);
    } else {
      const info = {
        acct_id: this.info.acct_id, tank_level: this.info.tank_level,
        npc_template: 20017, owner: this.id, tank_id: 10000037,
        name: 'Hồ Lô', in_room: true, summon_stats: { ...this.stats },
      };
      for (const key of ['iAttack', 'iEgAtk', 'iArmor', 'iEgArmor', 'iCentesis', 'iEgCtsis']) {
        info.summon_stats[key] = this.combatStat(key, now).toString();
      }
      Object.assign(info.summon_stats, {
        iHp: this.maxHp.mul(D('.5')).toString(), iSpeed: '0', iFireInterv: '1000',
        nFireRange: '360',
      });
      const turret = new HuluTurret(this.arena, this._newId(5), info, this.camp, dest);
      this.arena.actors.set(turret.id, turret);
      packets.push(turret.snapshot(now), ...turret.on_spawn(now));
    }
    return packets;
  }
}

export class HuluTurret extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.stats = { ...info.summon_stats };
    this.hp = this.maxHp = D(this.stats.iHp);
    this.info.hp = this.info.max_hp = this.hp.ceil();
    this.cooldowns = {};
    this.passive_ready_at = 0;
    this.lastSpeed = 0;
    this.lastInterval = 1000;
  }

  snapshot(now) {
    return [1556, encodeS1556(this.sceneId, {
      objectId: this.id, templateId: 20017, x: this.positionAt(now)[0],
      y: this.positionAt(now)[1], hp: this.hp.ceil(), camp: this.camp,
      maxHp: this.maxHp.ceil(), ownerId: this.info.owner,
      shield: this.shieldAmount(now).ceil(), buffs: [],
    })];
  }

  syncSpeed() { return []; } // S1560 addresses a player's account, not an AI NPC

  _setMotion() {
    this.position = this.spawn;
    this.motion = [this.spawn, this.spawn, this.clock(), this.clock() + 1];
    return 1;
  }

  moveDestination(start) { return start; } // turrets cannot be pulled/pushed

  on_spawn(now) {
    this.passive_ready_at = now + 1000;
    this._queue(now + 1000, 'turret_tick', 1);
    this._queue(now + 250, 'turret_reveal');
    return this._buff(311421, now).concat(this._buff(311431, now));
  }

  commitHp(hp, now, { critical = false } = {}) {
    const before = this.alive;
    const packets = super.commitHp(hp, now, { critical });
    if (before && !this.alive) packets.push(scene({ removedObjects: [this.id] }));
    return packets;
  }

  _respawn(now, generation) {
    if (generation !== this.generation) return [];
    // Keep a tombstone while delayed projectiles/buffs still refer to it;
    // remove it afterwards instead of growing every checkpoint forever.
    const refers = (value, seen) => {
      if (typeof value === 'number') return value === this.id;
      if (value && typeof value === 'object') {
        if (seen.has(value)) return false;
        seen.add(value);
        const items = value instanceof Map ? [...value.entries()]
          : Array.isArray(value) || value instanceof Set ? [...value]
            : Object.values(value);
        return items.some(item => refers(item, seen));
      }
      return false;
    };
    const busy = this.arena.pending.some(entry => entry.callback.__owner === this
      || refers(entry.args, new Set()));
    if (busy) {
      this._queue(now + 1000, 'respawn', generation);
      return [];
    }
    this.arena.actors.delete(this.id);
    return [];
  }

  taunt_attack(target, now) {
    const start = this.positionAt(now);
    const pos = target.positionAt(now);
    if (!this.alive || !target.alive || target.isUntargetable()
      || this.blocked('attack', now) || this.skillSealed(0, now)
      || now < this.passive_ready_at
      || Math.hypot(start[0] - pos[0], start[1] - pos[1]) > 360
      || this.arena.geometry.wallContact(start, pos) !== null) return [];
    this.passive_ready_at = now + 1000;
    const packets = [];
    let dest = pointAt(start, pos, 360 / Math.max(1, Math.hypot(start[0] - pos[0], start[1] - pos[1])));
    const wall = this.arena.geometry.wallContact(start, dest);
    if (wall !== null) dest = pointAt(start, dest, Math.max(0, wall - 0.001));
    dest = dest.map(pyRound);
    const ident = this._newId(2);
    // Native exhibit 37401 has no travelling sprite/lifetime.
    packets.push(scene({
      fires: [{ bulletId: ident, ownerId: this.id, start, dest, speed: 32767, templateId: 311411 }],
    }));
    for (const enemy of [...this.arena.actors.values()]) {
      if (enemy.alive && enemy.camp !== this.camp
        && actorContact(start, dest, enemy, now, now, 48) !== null) {
        packets.push(...this.damage(this.combatStat('iEgAtk', now).mul(D('.5')), now,
          { target: enemy, school: 'energy', basic: true })[0]);
        packets.push(...this._buff(311412, now, enemy.id));
      }
    }
    packets.push([1562, encodeS1562(ident, dest, dest)], scene({ blownBullets: [ident] }));
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'turret_reveal') {
      if (!this.alive) return [];
      const packets = [];
      for (const target of this.arena.actors.values()) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(this.positionAt(now)[0] - target.positionAt(now)[0],
            this.positionAt(now)[1] - target.positionAt(now)[1]) <= 480) {
          packets.push(...this._buff(311422, now, target.id));
        }
      }
      this._queue(now + 250, kind);
      return packets;
    }
    if (kind === 'turret_tick') {
      if (!this.alive) return [];
      const [tick] = data;
      if (tick === 10) return this.commitHp(D(0), now);
      const packets = this.commitHp(this.hp.sub(this.maxHp.mul(D('.02'))).max(D(0)), now);
      if (!this.alive) return packets;
      const start = this.positionAt(now);
      const targets = [...this.arena.actors.values()].filter(a => a.alive && a.camp !== this.camp
        && !a.isUntargetable()
        && Math.hypot(start[0] - a.positionAt(now)[0], start[1] - a.positionAt(now)[1]) <= 360
        && this.arena.geometry.wallContact(start, a.positionAt(now)) === null);
      if (targets.length && !this.blocked('attack', now) && !this.skillSealed(0, now)) {
        targets.sort((a, b) => (Math.hypot(start[0] - a.positionAt(now)[0],
          start[1] - a.positionAt(now)[1]) - Math.hypot(start[0] - b.positionAt(now)[0],
          start[1] - b.positionAt(now)[1])) || a.id - b.id);
        packets.push(...this.taunt_attack(targets[0], now));
      }
      this._queue(now + 1000, kind, tick + 1);
      return packets;
    }
    return super._event(now, kind, data);
  }
}

export { SLOTS as HULU_SLOTS, HuluTurret as HULU_TURRET };
