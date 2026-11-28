/* Minion (tank 10000060): owner-only component drops, two reserves and a
 * persistent native turret NPC. Port of server/minion_actions.py.
 *
 * Stubs: no skin/presentation; the turret reuses HuluTurret but emits the
 * native 20006 ObjInfo and its own attack/damage rules.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pyRound, rectContact, quantize } from '../math.js';
import { scene, encodeS1556, encodeS1572, objectInfo } from '../protocol.js';
import { enemies, inStrip, packII, prepareDisplacement } from './melee.js';
import { teamVisible } from './batch-c-common.js';
import { HuluTurret } from './hulu.js';

const SLOTS = { 0: 335100, 1: 335201, 2: 335301, 10: 335401 };

export class MinionActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = 100;
    this.e_count = 2;
    this.e_next_charge = 0;
    this.ready = null;
    this.components = new Map();
    this.turret_marks = new Map();
  }

  _cooldown(slot) {
    if (!(slot in SLOTS)) {
      return [1572, encodeS1572(this.id, {
        skillId: this.skillForSlot(slot) ?? 0, slot, count: -1,
        end: this.cooldowns[slot] ?? 0, nextCharge: 0,
      })];
    }
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: slot === 1 ? this.e_count : -1,
      end: this.cooldowns[slot], nextCharge: slot === 1 ? this.e_next_charge : 0,
    })];
  }

  _resource(delta) {
    if (this.noel_box) return [];
    const old = this.mp;
    this.mp = Math.max(0, Math.min(100, this.mp + delta));
    return old !== this.mp ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  on_spawn(now) {
    this.mp = 100;
    this.ready = null;
    this._queue(now + 1000, 'minion_energy', this.generation);
    return [scene({ mp: [{ objectId: this.id, mp: this.mp }] }), this._cooldown(1)];
  }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  interrupt(now) {
    if (!this.ready) return [];
    this.ready = null;
    this.cooldowns[10] = now + this.skillCooldown(3000, 10);
    return [[1583, packII(this.id, 335401)], this._cooldown(10)].concat(this.syncSpeed(now));
  }

  update(now) {
    const packets = [];
    for (const [key, value] of [...this.turret_marks]) {
      if (!(value.end > now)) this.turret_marks.delete(key);
    }
    if (this.ready && (super.blocked('attack', now) || this.skillSealed(10, now))) {
      packets.push(...this.interrupt(now));
    }
    while (this.e_next_charge && this.e_next_charge <= now) {
      this.e_count = Math.min(2, this.e_count + 1);
      this.e_next_charge = this.e_count < 2
        ? this.e_next_charge + this.skillCooldown(6000) : 0;
      packets.push(this._cooldown(1));
    }
    return packets.concat(super.update(now));
  }

  damage(raw, now, options = {}) {
    const target = options.target || this.enemy;
    if (target && options.basic && target.hasBuff(335311, now)
      && target.buffSources.get(335311) === this.id) {
      raw = raw.mul(D('1.25'));
    }
    return super.damage(raw, now, options);
  }

  dropComponent(entity, pos, generation, now) {
    // The owning event removes its entity before calling this.
    const [ident, packet] = this.addObject(335101, pos.map(pyRound));
    const item = { id: ident, entity, pos, generation, end: now + 5000 };
    this.components.set(ident, item);
    this._queue(now + 100, 'minion_pickup', item);
    return [packet];
  }

  _pickup(item, now) {
    this.components.delete(item.id);
    const packets = this.removeObject(item.id).concat(this._resource(10));
    for (const slot of [2, 10]) {
      this.cooldowns[slot] = Math.max(now, this.cooldowns[slot] - 4000);
      packets.push(this._cooldown(slot));
    }
    if (this.e_next_charge) this.e_next_charge = Math.max(now, this.e_next_charge - 4000);
    packets.push(...this.update(now));
    packets.push(this._cooldown(1));
    const power = this.combatStat('iAttack', now);
    packets.push(...this.addShield(335103, power, now));
    if (this.hasBuff(335103, now)) {
      const version = this.buffVersions.get(335103);
      for (let i = 1; i <= 4; i += 1) {
        this._queue(now + i * 1000, 'minion_shield', this.generation, version,
          power.mul(D('.1')));
      }
    }
    return packets;
  }

  _deviceArea(cast, now) {
    const packets = [];
    for (const target of enemies(this, { area: true })) {
      const distance = Math.hypot(cast.pos[0] - target.positionAt(now)[0],
        cast.pos[1] - target.positionAt(now)[1]);
      if (distance <= 240) {
        for (const template of [335311, 335312]) {
          packets.push(...this._buff(template, now, target.id));
        }
      }
      if (distance >= 240 && distance <= 264) {
        for (const template of [335313, 335314]) {
          packets.push(...this._buff(template, now, target.id));
        }
      }
    }
    if (this.alive && this.generation === cast.generation
      && Math.hypot(cast.pos[0] - this.positionAt(now)[0],
        cast.pos[1] - this.positionAt(now)[1]) <= 264) {
      packets.push(...this._buff(335315, now));
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'minion_energy') {
      if (!this.alive || this.generation !== data[0]) return [];
      this._queue(now + 1000, kind, ...data);
      return this._resource(5);
    }
    if (kind === 'minion_laser') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      if (super.blocked('attack', now) || this.skillSealed(10, now)) return this.interrupt(now);
      this.ready = null;
      const start = this.positionAt(now);
      const packets = [scene({ skills: [this._skillEvent(335401, start, cast.dest)] })]
        .concat(this.syncSpeed(now));
      for (const target of enemies(this, { area: true })) {
        if (inStrip(target.positionAt(now), start, cast.dest, 600, 96)) {
          packets.push(...this.damage(cast.power.mul(D('1.99')), now, { target })[0]);
          packets.push(...this._buff(335402, now, target.id));
        }
      }
      return packets;
    }
    if (kind === 'minion_pickup') {
      const [item] = data;
      if (this.components.get(item.id) !== item) return [];
      if (now >= item.end) {
        this.components.delete(item.id);
        return this.removeObject(item.id);
      }
      if (this.alive && this.generation === item.generation
        && Math.hypot(this.positionAt(now)[0] - item.pos[0],
          this.positionAt(now)[1] - item.pos[1]) <= 72) {
        return this._pickup(item, now);
      }
      this._queue(Math.min(now + 100, item.end), kind, item);
      return [];
    }
    if (kind === 'minion_shield') {
      const [generation, version, amount] = data;
      if (!this.alive || this.generation !== generation
        || this.buffVersions.get(335103) !== version) return [];
      const shield = this.shields.find(s => s.shield_id === '335103');
      if (!shield) return [];
      this.shields = this.shields.map(s => (s === shield
        ? { ...s, remaining: quantize(s.remaining.sub(amount).max(D(0))) } : s));
      return [this.shieldPacket(now)];
    }
    if (kind === 'minion_device_start') {
      const [cast] = data;
      const packets = this.removeObject(cast.prepare);
      for (const target of enemies(this, { area: true })) {
        if (Math.hypot(cast.pos[0] - target.positionAt(now)[0],
          cast.pos[1] - target.positionAt(now)[1]) <= 240) {
          packets.push(...this.damage(cast.power.mul(D('3.98')), now, { target })[0]);
        }
      }
      const ident = this._newId(5);
      const buff = this._newId(6);
      const body = {
        objectId: ident, templateId: 20007,
        x: pyRound(cast.pos[0]), y: pyRound(cast.pos[1]),
        hp: 1, camp: this.camp, maxHp: 1, ownerId: this.id, shield: 0,
        buffs: [{ templateId: 335321, instanceId: buff, stackCount: 1, casterId: this.id }],
      };
      this.arena.objects.set(ident, objectInfo(body));
      cast.id = ident;
      cast.end = now + 3000;
      packets.push([1556, encodeS1556(this.sceneId, body)]);
      packets.push(...this._deviceArea(cast, now));
      this._queue(now + 100, 'minion_device_tick', cast);
      return packets;
    }
    if (kind === 'minion_device_tick') {
      const [cast] = data;
      if (now >= cast.end) {
        const packets = this.removeObject(cast.id, { destroyed: true })
          .concat(this.removeObject(cast.visual, { destroyed: true }));
        return packets.concat(this.dropComponent(cast.id, cast.pos, cast.generation, now));
      }
      this._queue(now + 100, kind, cast);
      return this._deviceArea(cast, now);
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if ((slot === 0 || slot === 10) && start[0] === dest[0] && start[1] === dest[1]) return [];
    if ((slot === 1 || slot === 2) && (!this._inside(dest)
      || Math.hypot(start[0] - dest[0], start[1] - dest[1]) > (slot === 1 ? 480 : 600))) {
      return [];
    }
    if (slot === 1) {
      const clamp = this.arena.geometry.clampTankPosition(dest);
      if (this.e_count < 1 || this.mp < 30
        || clamp[0] !== dest[0] || clamp[1] !== dest[1]
        || this.arena.geometry.wallContact(dest, dest, 36) !== null
        || rectContact(dest, dest, this.arena.waterRects(now), 36) !== null) return [];
    }
    const power = this.combatStat('iAttack', now);
    const packets = [];
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 1000, 2: 25000, 10: 8000 }[slot], slot);
    if (slot === 0) {
      return this.shoot(335100, start, dest, now, power,
        { school: 'physical', basic: true }).concat([this._cooldown(0)]);
    }
    if (slot === 10) {
      let body, stopped;
      [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      this.position = stopped.length ? body : start;
      this.motion = null;
      this.ready = { slot: 10, dest, power };
      this._queue(now + 600, 'minion_laser', this.ready);
      return [scene({ skills: [this._skillEvent(335401, start, dest, 0, { ready: 1 })] }),
        this._cooldown(10)].concat(this.syncSpeed(now), stopped);
    }
    packets.push(scene({ skills: [this._skillEvent(SLOTS[slot], start, dest)] }));
    if (slot === 1) {
      this.e_count -= 1;
      if (!this.e_next_charge) this.e_next_charge = now + this.skillCooldown(6000);
      packets.push(...this._resource(-30));
      const stats = { ...this.stats };
      for (const key of ['iAttack', 'iEgAtk', 'iArmor', 'iEgArmor', 'iCentesis', 'iEgCtsis']) {
        stats[key] = this.combatStat(key, now).toString();
      }
      Object.assign(stats, {
        iHp: this.maxHp.mul(D('.6')).toString(), iSpeed: '0',
        iFireInterv: '1000', nFireRange: '480',
      });
      const info = {
        acct_id: this.info.acct_id, tank_level: this.info.tank_level,
        npc_template: 20006, owner: this.id, owner_generation: this.generation,
        tank_id: 10000060, name: 'Minion', in_room: true, summon_stats: stats,
      };
      const turret = new MinionTurret(this.arena, this._newId(5), info, this.camp, dest);
      this.arena.actors.set(turret.id, turret);
      packets.push(turret.snapshot(now), ...turret.on_spawn(now));
    } else {
      const [prepare, p] = this.addObject(335301, dest.map(pyRound));
      const [visual, v] = this.addObject(335304, dest.map(pyRound));
      packets.push(p, v);
      const cast = {
        prepare, visual, pos: dest, power, generation: this.generation,
      };
      this._queue(now + 1000, 'minion_device_start', cast);
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export class MinionTurret extends HuluTurret {
  snapshot(now) {
    return [1556, encodeS1556(this.sceneId, {
      objectId: this.id, templateId: 20006, x: this.positionAt(now)[0],
      y: this.positionAt(now)[1], hp: this.hp.ceil(), camp: this.camp,
      maxHp: this.maxHp.ceil(), ownerId: this.info.owner,
      shield: this.shieldAmount(now).ceil(), buffs: [],
    })];
  }

  on_spawn(now) {
    this.passive_ready_at = now + 1000;
    this.component_dropped = false;
    this._queue(now + 1000, 'minion_turret_tick', 1);
    return this._buff(335221, now);
  }

  commit_hp(hp, now, { critical = false } = {}) {
    const before = this.alive;
    const packets = super.commitHp(hp, now, { critical });
    if (before && !this.alive && !this.component_dropped) {
      this.component_dropped = true;
      const owner = this.arena.actors.get(this.info.owner);
      if (owner && typeof owner.dropComponent === 'function') {
        packets.push(...owner.dropComponent(this.id, this.positionAt(now),
          this.info.owner_generation, now));
      }
    }
    return packets;
  }

  _flight(flight, now) { return super._flight(flight, now); }

  damage(raw, now, options = {}) {
    const target = options.target || this.enemy;
    const owner = this.arena.actors.get(this.info.owner);
    if (options.basic && owner && target) {
      const key = `${this.info.owner_generation},${target.id},${target.generation}`;
      const mark = owner.turret_marks.get(key) ?? {};
      const stacks = (mark.end ?? 0) > now ? mark.stacks : 0;
      raw = raw.mul(D(1).add(D('.025').mul(D(stacks))));
      if (target.hasBuff(335312, now) && target.buffSources.get(335312) === owner.id) {
        raw = raw.mul(D('1.25'));
      }
      const [packets, lost] = super.damage(raw, now, options);
      if (target.alive) {
        owner.turret_marks.set(key, { stacks: Math.min(40, stacks + 1), end: now + 1500 });
        packets.push(...this._buff(335212, now, target.id,
          { stacks: Math.min(40, stacks + 1) }));
      }
      return [packets, lost];
    }
    return super.damage(raw, now, options);
  }

  taunt_attack(target, now) {
    const start = this.positionAt(now), dest = target.positionAt(now);
    if (!this.alive || !target.alive || target.isUntargetable()
      || this.blocked('attack', now) || this.skillSealed(0, now)
      || now < this.passive_ready_at
      || Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 480
      || this.arena.geometry.wallContact(start, dest) !== null
      || rectContact(start, dest, this.arena.waterRects(now)) !== null) return [];
    this.passive_ready_at = now + 1000;
    return this.shoot(335211, start, dest, now,
      this.combatStat('iAttack', now).mul(D('.5')),
      { school: 'physical', basic: true, target });
  }

  _event(now, kind, data) {
    if (kind === 'minion_turret_tick') {
      if (!this.alive) return [];
      const [tick] = data;
      const packets = this.commitHp(
        tick >= 20 ? D(0) : this.hp.sub(this.maxHp.mul(D('.05'))).max(D(0)), now);
      if (!this.alive) return packets;
      const start = this.positionAt(now);
      const candidates = [...enemies(this)].filter(target =>
        Math.hypot(start[0] - target.positionAt(now)[0],
          start[1] - target.positionAt(now)[1]) <= 480
        && teamVisible(this, target, now)
        && this.arena.geometry.wallContact(start, target.positionAt(now)) === null
        && rectContact(start, target.positionAt(now), this.arena.waterRects(now)) === null);
      if (candidates.length && !this.blocked('attack', now) && !this.skillSealed(0, now)) {
        candidates.sort((a, b) => (Math.hypot(start[0] - a.positionAt(now)[0],
          start[1] - a.positionAt(now)[1]) - Math.hypot(start[0] - b.positionAt(now)[0],
          start[1] - b.positionAt(now)[1])) || a.id - b.id);
        packets.push(...this.taunt_attack(candidates[0], now));
      }
      this._queue(now + 1000, kind, tick + 1);
      return packets;
    }
    return super._event(now, kind, data);
  }
}

export { SLOTS as MINION_SLOTS };
