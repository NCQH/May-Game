/* Pea Shooter (tank 10000033): MP, traps, carried bombs, Gatling mode.
 * Port of server/pea_actions.py onto the JS battle core.
 *
 * Stubs: presentation only. The Gatling toggle, photosynthesis idle mode and
 * trap visibility follow the Python kit; friendly() provides the same packet
 * filtering the core already exports.
 */
import { TankActions, bkey, friendly } from '../arena.js';
import { D, actorContact } from '../math.js';
import { scene, encodeS1560, encodeS1556, encodeS1572, encodeS1579, objectInfo }
  from '../protocol.js';

const SLOTS = { 0: 307100, 1: 307201, 2: 307301, 10: 307401 };
const GATLING_BUFFS = [307301, 307302, 307303, 307304, 307305, 307306];
const PHOTO_BUFFS = [307131, 307132, 307133];

export class PeaActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = Number(this.stats.iMp);
    this.e_count = 2;
    this.e_next_charge = 0;
    this.gatling = false;
    this.photo_epoch = 0;
    this.photosynthesis = false;
    this.traps = new Map();
    this.bombs = new Map();
  }

  _cooldown(slot, changed = false) {
    const skill = this.gatling && (slot === 0 || slot === 2)
      ? (slot === 0 ? 307321 : 307311) : SLOTS[slot];
    const end = this.gatling && slot === 2 ? 0 : this.cooldowns[slot];
    const info = {
      skillId: skill, slot, count: slot === 1 ? this.e_count : -1,
      end, nextCharge: slot === 1 ? this.e_next_charge : 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  fire_rate_packet() {
    return [1560, encodeS1560(this.info.acct_id, 4, this.fireInterval(this.clock()))];
  }

  _resource(delta, now) {
    if (this.noel_box) return []; // Stasis suppresses resource effects too.
    const before = this.mp;
    this.mp = Math.max(0, Math.min(Number(this.stats.iMp), this.mp + delta));
    const packets = before !== this.mp
      ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
    if (this.gatling && this.mp === 0) packets.push(...this._end_gatling(now));
    return packets;
  }

  _activity(now) {
    this.photo_epoch += 1;
    this.photosynthesis = false;
    this.info.untargetable = false;
    const packets = [];
    for (const template of PHOTO_BUFFS) packets.push(...this.removeBuff(template, now));
    // Begin only after 2.5 seconds actually stationary, not from step start.
    const stationary = this.motion ? Math.max(now, this.motion[3]) : now;
    this._queue(stationary + 2500, 'photo_begin', this.generation, this.photo_epoch);
    return packets;
  }

  on_spawn(now) {
    this.mp = Number(this.stats.iMp);
    this.gatling = false;
    const packets = this._activity(now);
    this._queue(now + Number(this.stats.iMpRecInterv), 'mp_regen', this.generation);
    return packets.concat([this.fire_rate_packet(),
      scene({ mp: [{ objectId: this.id, mp: this.mp }] })]);
  }

  _end_gatling(now) {
    this.gatling = false;
    const packets = [];
    for (const template of GATLING_BUFFS) packets.push(...this.removeBuff(template, now));
    for (const slot of [0, 2]) {
      packets.push(this._cooldown(slot, true), this._cooldown(slot));
    }
    return packets.concat([this.fire_rate_packet()]);
  }

  interrupt(now) {
    const packets = this.photosynthesis ? this._activity(now) : [];
    if (!this.alive) {
      if (this.gatling) packets.push(...this._end_gatling(now));
      // User: caster death removes both planted traps and carried bombs.
      for (const trap of this.traps.values()) {
        this.arena.objects.delete(trap.id);
        packets.push(scene({ expiredBullets: [trap.id] }));
      }
      this.traps.clear();
      for (const bomb of this.bombs.values()) {
        const target = this.arena.actors.get(bomb.target);
        if (target && this.activeBuffs.get(bkey(target.id, 307401))?.[0] === bomb.buff_id) {
          packets.push(...target.removeBuff(307401, now));
        }
      }
      this.bombs.clear();
    }
    return packets;
  }

  on_death() {
    this.gatling = false;
    this.photosynthesis = false;
    this.photo_epoch += 1;
    this.info.untargetable = false;
  }

  onTargetDeath(target, now) {
    // User: a carried bomb is cancelled when its carrier dies.
    for (const [token, bomb] of [...this.bombs]) {
      if (bomb.target === target.id) this.bombs.delete(token);
    }
    return [];
  }

  _detonate_bomb(bomb, carrier, now) {
    if (!this.alive || !carrier?.alive || carrier.generation !== bomb.generation) return [];
    const center = carrier.positionAt(now);
    const packets = this._buff(307403, now, carrier.id);
    // This explosion owns the targets present when it began, not newborns.
    for (const target of [...this.arena.actors.values()]) {
      if (target.alive && target.camp !== this.camp
        && Math.hypot(center[0] - target.positionAt(now)[0],
          center[1] - target.positionAt(now)[1]) <= 144) {
        const [hit, lost] = this.damage(bomb.power.mul(D('2.78')), now,
          { target, school: 'energy', lifesteal: D('.5') });
        packets.push(...hit);
        if (lost) packets.push(...this._resource(25, now));
      }
    }
    return packets;
  }

  update(now) {
    const packets = super.update(now);
    this.info.untargetable = this.photosynthesis && !this.buffTypes(now).has(32);
    if (this.e_next_charge && now >= this.e_next_charge) {
      while (this.e_count < 2 && now >= this.e_next_charge) {
        this.e_count += 1;
        this.e_next_charge += this.skillCooldown(8000);
      }
      if (this.e_count === 2) this.e_next_charge = 0;
      packets.push(this._cooldown(1));
    }
    return packets;
  }

  damage(raw, now, options = {}) {
    const target = options.target ?? this.enemy;
    let value = raw;
    if (options.basic && target.hasBuff(307121, now)
      && target.buffSources.get(307121) === this.id) {
      value = value.mul(D(1).add(D('.05').mul(target.buffStacks.get(307121) ?? 1)));
    }
    return super.damage(value, now, { ...options, target });
  }

  onBulletHit(flight, target, now) {
    if (!this.alive || this.generation !== flight.source_generation) return [];
    const packets = this._resource(5, now);
    for (const template of [307121, 307122]) {
      packets.push(...this._buff(template, now, target.id));
    }
    return packets;
  }

  _flight(flight, now) {
    if (flight.template === 307321) flight.through_walls = true; // Stops at first enemy.
    return super._flight(flight, now);
  }

  _trap_object(template, pos) {
    const ident = this._newId(4);
    const info = {
      objectId: ident, templateId: template, x: pos[0], y: pos[1], hp: 0,
      camp: this.camp, maxHp: 0, ownerId: this.id, shield: 0, buffs: [],
    };
    this.arena.objects.set(ident, objectInfo(info));
    // Armed traps are hidden from enemies; sprouting and allied traps show.
    const packet = [1556, encodeS1556(this.sceneId, info)];
    const packets = template === 307201 ? [packet] : friendly(this, packet);
    return [ident, packets];
  }

  clearHiddenTraps(center, radius) {
    const packets = [];
    for (const [token, trap] of [...this.traps]) {
      if (trap.end !== undefined && Math.hypot(center[0] - trap.pos[0],
        center[1] - trap.pos[1]) <= radius) {
        this.traps.delete(token);
        this.arena.objects.delete(trap.id);
        packets.push(scene({ expiredBullets: [trap.id] }));
      }
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'mp_regen') {
      if (!this.alive || this.generation !== data[0]) return [];
      this._queue(now + Number(this.stats.iMpRecInterv), kind, ...data);
      return this._resource(Number(this.stats.iMpRecover), now);
    }
    if (kind === 'photo_begin' || kind === 'photo_tick') {
      const [generation, epoch] = data;
      if (!this.alive || this.generation !== generation || this.photo_epoch !== epoch) return [];
      if (this.motion && this.motion[3] > now) return this._activity(now);
      const packets = [];
      if (kind === 'photo_begin') {
        this.photosynthesis = true;
        this.info.untargetable = true;
        for (const template of PHOTO_BUFFS) packets.push(...this._buff(template, now));
      } else {
        packets.push(...this.restoreHp(this.maxHp.mul(D('.025')), now));
        packets.push(...this._resource(5, now));
      }
      this._queue(now + 500, 'photo_tick', generation, epoch);
      return packets;
    }
    if (kind === 'trap_arm') {
      const [token] = data;
      const trap = this.traps.get(token);
      if (trap === undefined) return [];
      const old = trap.id;
      this.arena.objects.delete(old);
      const [ident, packets] = this._trap_object(307211, trap.pos);
      trap.id = ident;
      trap.previous = now;
      trap.end = now + 45000;
      this._queue(now, 'trap_check', token);
      return [scene({ expiredBullets: [old] })].concat(packets);
    }
    if (kind === 'trap_check') {
      const [token] = data;
      const trap = this.traps.get(token);
      if (trap === undefined) return [];
      if (now >= trap.end) {
        this.traps.delete(token);
        this.arena.objects.delete(trap.id);
        return [scene({ expiredBullets: [trap.id] })];
      }
      for (const target of this.arena.actors.values()) {
        if (!target.alive || target.camp === this.camp) continue;
        // PropsTemplate iSelectRange=72 is the trap trigger radius.
        if (actorContact(trap.pos, trap.pos, target, trap.previous, now, 72) === null) continue;
        this.traps.delete(token);
        this.arena.objects.delete(trap.id);
        const packets = [scene({ removedObjects: [trap.id] })];
        const [hit, lost] = this.damage(trap.power.mul(D('1.57')), now,
          { target, school: 'energy', lifesteal: D('.5') });
        packets.push(...hit);
        if (lost) packets.push(...this._resource(25, now));
        packets.push(...this._buff(307231, now, target.id, { duration: 1500 }));
        packets.push(...this._buff(307232, now, target.id));
        return packets;
      }
      trap.previous = now;
      this._queue(Math.min(now + 20, trap.end), kind, token);
      return [];
    }
    if (kind === 'bomb') {
      const [token] = data;
      const bomb = this.bombs.get(token);
      this.bombs.delete(token);
      if (bomb === undefined) return [];
      const carrier = this.arena.actors.get(bomb.target);
      return this._detonate_bomb(bomb, carrier, now);
    }
    return super._event(now, kind, data);
  }

  handle(message, payload) {
    const packets = super.handle(message, payload);
    const now = this.clock();
    if (message === 501 && this.motion && this.motion[2] === now
      && (this.motion[0][0] !== this.motion[1][0] || this.motion[0][1] !== this.motion[1][1])) {
      packets.push(...this._activity(now));
    }
    return packets;
  }

  teamVisible(target, now) {
    if (!target || !target.alive || target.isUntargetable()) return false;
    const start = this.positionAt(now), end = target.positionAt(now);
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) > 960) return false;
    const rect = target.map_rect || target.mapRect;
    return this.arena.geometry.wallContact(start, end, 0,
      { exclude: rect ? [rect] : [] }) === null;
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)) return [];
    if (slot === 2 && this.gatling) return this._end_gatling(now);
    if (this.cooldowns[slot] > now || (slot === 1 && !this.e_count)) return [];
    if ((slot === 0 || slot === 1) && !this._inside(dest)) return [];
    if (slot === 0 && ((start[0] === dest[0] && start[1] === dest[1])
      || (this.gatling && this.mp < 10))) return [];
    if (slot === 1 && Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 360) return [];
    const target = this.arena.actors.get(targetId);
    if (slot === 10 && (!target || !target.alive
      || (target.camp !== this.camp
        && (target.isUntargetable() || !this.teamVisible(target, now)))
      || Math.hypot(start[0] - target.positionAt(now)[0],
        start[1] - target.positionAt(now)[1]) > 480)) return [];
    if (slot === 2 && this.mp < 10) return [];
    const packets = this._activity(now);
    const power = this.combatStat('iEgAtk', now);
    if (slot === 0) {
      const gatling = this.gatling;
      this.cooldowns[0] = now + this.fireInterval(now);
      packets.push(...this.shoot(gatling ? 307321 : 307100, start, dest, now,
        power.mul(D('1.5')), {
          school: 'energy', basic: true, speed_multiplier: gatling ? 1 : 1.5,
        }));
      if (gatling) packets.push(...this._resource(-10, now));
    } else if (slot === 1) {
      this.cooldowns[1] = now + this.skillCooldown(1000, 1);
      this.e_count -= 1;
      if (!this.e_next_charge) this.e_next_charge = now + this.skillCooldown(8000);
      const [ident, objects] = this._trap_object(307201, dest);
      this.traps.set(ident, { id: ident, pos: dest, power });
      this._queue(now + 1000, 'trap_arm', ident);
      packets.push(scene({ skills: [this._skillEvent(307201, start, dest)] }), ...objects);
    } else if (slot === 2) {
      this.cooldowns[2] = now + this.skillCooldown(20000, 2);
      this.gatling = true;
      for (const template of GATLING_BUFFS) packets.push(...this._buff(template, now));
      for (const changed of [0, 2]) {
        packets.push(this._cooldown(changed, true), this._cooldown(changed));
      }
      packets.push(this.fire_rate_packet());
    } else {
      this.cooldowns[10] = now + this.skillCooldown(10000, 10);
      packets.push(...this._buff(307401, now, target.id));
      if (target.hasBuff(307401, now)) {
        const ident = this.activeBuffs.get(bkey(target.id, 307401))[0];
        this.bombs.set(ident, {
          target: target.id, generation: target.generation, power, buff_id: ident,
        });
        this._queue(now + 2000, 'bomb', ident);
      }
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as PEA_SLOTS, GATLING_BUFFS, PHOTO_BUFFS };
