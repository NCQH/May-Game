/* Joker (tank 10000071): shadow clone and distance soul tear.
 * Port of server/joker_actions.py onto the JS battle core.
 *
 * Stubs: skin presentation only. The clone is a direct TankActions subclass
 * (no core class registry needed) and retires via the tombstone helper.
 */
import { TankActions } from '../arena.js';
import { D, pointAt } from '../math.js';
import { scene, encodeS1556, encodeS1572, objectInfo } from '../protocol.js';
import { retireSummon } from './batch-c-common.js';

const SLOTS = { 0: 451100, 1: 451201, 2: 451301, 10: 451401 };

export class JokerActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.e_count = 3;
    this.e_next_charge = 0;
    this.passive_ready_at = 0;
    this.marks = new Map();
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: slot === 1 ? this.e_count : -1,
      end: this.cooldowns[slot], nextCharge: slot === 1 ? this.e_next_charge : 0,
    })];
  }

  on_spawn(now) {
    this.info.untargetable = false;
    return this._buff(451101, now).concat(this._buff(451102, now));
  }

  _visibility(now) {
    this.info.untargetable = this.hasBuff(451403, now) && !this.buffTypes(now).has(32);
  }

  // The core calls camelCase removeBuff; keep the Python override there.
  removeBuff(template, now, { expired = false } = {}) {
    const packets = super.removeBuff(template, now, { expired });
    if (template === 451403) this._visibility(now);
    return packets;
  }

  update(now) {
    this._visibility(now);
    const packets = [];
    while (this.e_next_charge && this.e_next_charge <= now) {
      this.e_count = Math.min(3, this.e_count + 1);
      this.e_next_charge = this.e_count < 3 ? this.e_next_charge + this.skillCooldown(8000) : 0;
      packets.push(this._cooldown(1));
    }
    return packets.concat(super.update(now));
  }

  _proc(now, generation) {
    if (!this.alive || generation !== this.generation || now < this.passive_ready_at) return [];
    this.passive_ready_at = now + 250;
    const packets = this.restoreHp(this.maxHp.mul(D('.08')), now);
    if (this.e_next_charge) this.e_next_charge = now + Math.round(Math.max(0, this.e_next_charge - now) * 0.92);
    for (const slot of [2, 10]) {
      this.cooldowns[slot] = now + Math.round(Math.max(0, this.cooldowns[slot] - now) * 0.92);
    }
    return packets.concat([1, 2, 10].map(slot => this._cooldown(slot)));
  }

  _area(pos, power, ratio, generation, now, { slow = false } = {}) {
    const packets = [];
    for (const target of [...this.arena.actors.values()]) {
      if (target.alive && target.camp !== this.camp
        && Math.hypot(pos[0] - target.positionAt(now)[0], pos[1] - target.positionAt(now)[1]) <= 144) {
        packets.push(...this.damage(power.mul(ratio), now, { target })[0]);
        if (slow) packets.push(...this._buff(451204, now, target.id));
        packets.push(...this._proc(now, generation));
      }
    }
    return packets;
  }

  on_bullet_hit(flight, target, now) {
    if (flight.template !== 451301) return [];
    const packets = this._proc(now, flight.source_generation);
    packets.push(...this._buff(451302, now, target.id));
    if (!target.hasBuff(451302, now) || target.buffSources.get(451302) !== this.id) return packets;
    const mark = {
      target: target.id, target_generation: target.generation,
      generation: flight.source_generation, power: flight.power,
      version: target.buffVersions.get(451302), distance: 0, pos: target.positionAt(now),
    };
    this.marks.set(target.id, mark);
    this._queue(now + 500, 'joker_tear_start', mark);
    return packets;
  }

  on_target_death(target, now) {
    this.marks.delete(target.id);
    return [];
  }

  _event(now, kind, data) {
    if (kind === 'joker_box') {
      const [cast] = data;
      return this.removeObject(cast.id, { destroyed: true })
        .concat(this._area(cast.pos, cast.power, D('3.54'), cast.generation, now, { slow: true }));
    }
    if (kind === 'joker_tear_start' || kind === 'joker_tear') {
      const [mark] = data;
      const target = this.arena.actors.get(mark.target);
      if (!target || !target.alive || target.generation !== mark.target_generation
        || this.marks.get(target.id) !== mark) return [];
      let packets;
      if (kind === 'joker_tear_start') {
        if (target.buffVersions.get(451302) !== mark.version) return [];
        packets = this._buff(345303, now, target.id);
        if (!target.hasBuff(345303, now)) return packets;
        mark.version = target.buffVersions.get(345303);
        mark.pos = target.positionAt(now);
        mark.end = now + 3000;
      } else {
        if (target.buffVersions.get(345303) !== mark.version || now > mark.end) return [];
        packets = [];
        const pos = target.positionAt(now);
        mark.distance += Math.hypot(pos[0] - mark.pos[0], pos[1] - mark.pos[1]);
        mark.pos = pos;
        const count = Math.floor(mark.distance / 24);
        mark.distance -= count * 24;
        for (let i = 0; i < count; i += 1) {
          if (!target.alive) break;
          packets.push(...this.damage(mark.power.mul(D('.36')), now,
            { target, school: 'true', periodic: true })[0]);
          packets.push(...this._proc(now, mark.generation));
        }
      }
      if (now < mark.end) this._queue(Math.min(now + 20, mark.end), 'joker_tear', mark);
      else this.marks.delete(target.id);
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    const span = Math.hypot(start[0] - dest[0], start[1] - dest[1]);
    if (!this._inside(dest) || ((slot === 0 || slot === 2 || slot === 10)
      && start[0] === dest[0] && start[1] === dest[1])
      || (slot === 1 && (!this.e_count || span > 600))) return [];
    const power = this.combatStat('iAttack', now);
    this.cooldowns[slot] = now + this.skillCooldown({
      0: this.fireInterval(now), 1: 1000, 2: 25000, 10: 8000,
    }[slot], slot);
    const packets = this.removeBuff(451403, now);
    if (slot === 0 || slot === 2) {
      return packets.concat(this.shoot(SLOTS[slot], start, dest, now,
        power.mul(slot ? D('4.12') : D(1)), {
          school: 'physical', basic: slot === 0, through_walls: slot === 2, power,
        }), [this._cooldown(slot)]);
    }
    packets.push(scene({ skills: [this._skillEvent(SLOTS[slot], start, dest)] }));
    if (slot === 1) {
      this.e_count -= 1;
      if (!this.e_next_charge) this.e_next_charge = now + this.skillCooldown(8000);
      const [ident, packet] = this.addObject(451201, dest);
      packets.push(packet);
      this._queue(now + 1000, 'joker_box', {
        id: ident, pos: dest, power, generation: this.generation,
      });
    } else {
      const summonStats = { ...this.stats };
      for (const key of ['iAttack', 'iEgAtk', 'iArmor', 'iEgArmor', 'iCentesis', 'iEgCtsis']) {
        summonStats[key] = this.combatStat(key, now).toString();
      }
      summonStats.iHp = this.maxHp.toString();
      const info = {
        acct_id: this.info.acct_id, tank_level: this.info.tank_level,
        tank_id: this.info.tank_id, npc_template: 451401, owner: this.id,
        source_generation: this.generation, name: this.info.name, in_room: true,
        summon_stats: summonStats,
      };
      const clone = new JokerClone(this.arena, this._newId(5), info, this.camp, start);
      this.arena.actors.set(clone.id, clone); // JS core actors is a Map.
      packets.push(clone.snapshot(now), ...clone.on_spawn(now));
      const blink = this.blinkDestination(start,
        pointAt(start, dest, Math.min(1, 336 / span)));
      this.position = blink;
      this.motion = null;
      packets.push(scene({ moves: [this._moveEvent(blink, 0, 5)] }));
      packets.push(...this._buff(451403, now));
      this._visibility(now);
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export class JokerClone extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.stats = { ...this.info.summon_stats };
    this.hp = this.maxHp = D(this.stats.iHp);
    this.info.hp = this.info.max_hp = this.hp.ceil();
    this.cooldowns = {};
    this.received = D(0);
    this.exploded = false;
  }

  snapshot(now) {
    const pos = this.positionAt(now);
    const info = {
      objectId: this.id, templateId: 451401, x: pos[0], y: pos[1], hp: this.hp.ceil(),
      camp: this.camp, maxHp: this.maxHp.ceil(), ownerId: this.info.owner,
      shield: this.shieldAmount(now).ceil(), buffs: [],
    };
    return [1556, encodeS1556(this.sceneId, info)];
  }

  syncSpeed() { return []; }

  on_spawn(now) {
    this._queue(now + 2000, 'joker_clone_end');
    return [];
  }

  on_damage(source, hit, now, school, reflected, attacker_ap) {
    this.received = this.received.add(hit.hp_loss);
    const owner = this.arena.actors.get(this.info.owner);
    const step = this.maxHp.mul(D('.08'));
    if (owner && owner.alive && owner.generation === this.info.source_generation
      && now >= owner.passive_ready_at && this.received.ge(step)) {
      this.received = this.received.sub(step);
      return owner._proc(now, this.info.source_generation);
    }
    return [];
  }

  commitHp(hp, now, { critical = false } = {}) {
    const before = this.alive;
    const packets = super.commitHp(hp, now, { critical });
    if (before && !this.alive && !this.exploded) {
      this.exploded = true;
      const owner = this.arena.actors.get(this.info.owner);
      const pos = this.positionAt(now);
      packets.push(scene({ skills: [this._skillEvent(451411, pos, pos)] }));
      packets.push(...owner._area(pos, D(this.stats.iAttack), D('2.7'),
        this.info.source_generation, now));
      packets.push(scene({ removedObjects: [this.id] }));
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'joker_clone_end') return this.alive ? this.commitHp(D(0), now) : [];
    return super._event(now, kind, data);
  }

  _respawn(now, generation) { return retireSummon(this, now, generation); }
}

export { SLOTS as JOKER_SLOTS };
