/* Athena (tank 10000085): ally shield/blessing, passive heal, soul mark.
 * Port of server/athena_actions.py onto the JS battle core.
 *
 * Stubs: fog is replaced by the shared wall line-of-sight/range check used by
 * teamVisible; no skin presentation.
 */
import { TankActions } from '../arena.js';
import { D } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';
import { packII } from './melee.js';
import { teamVisible } from './batch-c-common.js';

const SLOTS = { 0: 359100, 1: 359201, 2: 359301, 10: 359401 };

export class AthenaActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = Number(this.stats.iMp);
    this.r_count = 3;
    this.r_next_charge = 0;
    this.ready = null;
  }

  _resource(delta) {
    if (this.noel_box) return [];
    const old = this.mp;
    this.mp = Math.max(0, Math.min(Number(this.stats.iMp), this.mp + delta));
    return old !== this.mp ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot,
      count: slot === 10 ? this.r_count : -1,
      end: this.cooldowns[slot], nextCharge: slot === 10 ? this.r_next_charge : 0,
    })];
  }

  on_spawn(now) {
    this.mp = Number(this.stats.iMp);
    this._queue(now + 3000, 'athena_mp', this.generation);
    return this._buff(359101, now).concat([scene({ mp: [{ objectId: this.id, mp: this.mp }] })]);
  }

  update(now) {
    const packets = [];
    if (this.ready && this.skillSealed(1, now)) packets.push(...this.interrupt(now));
    while (this.r_next_charge && this.r_next_charge <= now) {
      this.r_count = Math.min(3, this.r_count + 1);
      this.r_next_charge = this.r_count < 3 ? this.r_next_charge + this.skillCooldown(6000) : 0;
      packets.push(this._cooldown(10));
    }
    return packets.concat(super.update(now));
  }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  interrupt(now) {
    if (!this.ready) return [];
    this.ready = null;
    return [[1583, packII(this.id, 359201)]].concat(this.syncSpeed(now));
  }

  _passive(power, now) {
    const allies = [...this.arena.actors.values()].filter(a => a.alive && a.camp === this.camp
      && (a.id >>> 26) === 0
      && Math.hypot(this.positionAt(now)[0] - a.positionAt(now)[0],
        this.positionAt(now)[1] - a.positionAt(now)[1]) <= 300);
    const packets = [];
    if (allies.length) {
      allies.sort((a, b) => (a.hp.div(a.maxHp).toNumber() - b.hp.div(b.maxHp).toNumber())
        || (a.id - b.id));
      const target = allies[0];
      packets.push(scene({ skills: [this._skillEvent(359111, this.positionAt(now),
        target.positionAt(now), target.id)] }));
      packets.push(...this._buff(359112, now, target.id),
        ...target.restoreHp(power.mul(D('1.5')), now));
    }
    packets.push(...this._buff(359113, now));
    const version = this.buffVersions.get(359113);
    for (let i = 1; i <= 5; i += 1) {
      this._queue(now + 400 * i, 'athena_hot', this.generation, version, power.mul(D('.3')));
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'athena_mp') {
      if (!this.alive || data[0] !== this.generation) return [];
      this._queue(now + 3000, kind, ...data);
      return this._resource(10);
    }
    if (kind === 'athena_hot') {
      const [generation, version, amount] = data;
      return this.alive && generation === this.generation && this.buffVersions.get(359113) === version
        ? this.restoreHp(amount, now) : [];
    }
    if (kind === 'athena_e') {
      const [cast] = data;
      if (this.ready !== cast) return [];
      if (!this.alive || this.skillSealed(1, now) || super.blocked('attack', now)) {
        return this.interrupt(now);
      }
      this.ready = null;
      const target = this.arena.actors.get(cast.target);
      const packets = this.syncSpeed(now);
      if (!target || !target.alive || target.generation !== cast.target_generation) return packets;
      packets.push(scene({ skills: [this._skillEvent(359201, this.positionAt(now),
        target.positionAt(now), target.id)] }));
      packets.push(...target.cleanse(now));
      const previous = target.buffVersions.get(359201) ?? 0;
      packets.push(...target.addShield(359201, cast.max_hp.mul(D('.3')), now, { caster: this }));
      if (target.hasBuff(359201, now) && (target.buffVersions.get(359201) ?? 0) > previous) {
        target.athenaShield = {
          owner: this.id, generation: this.generation,
          step: cast.max_hp.mul(D('.03')), absorbed: D(0),
        };
      }
      return packets.concat(this._passive(cast.power, now));
    }
    if (kind === 'athena_blessing') {
      const [targetId, generation, version, amount] = data;
      const target = this.arena.actors.get(targetId);
      return target && target.alive && target.generation === generation
        && target.buffVersions.get(359302) === version ? target.restoreHp(amount, now) : [];
    }
    if (kind === 'athena_mark') {
      const [cast] = data;
      const target = this.arena.actors.get(cast.target);
      if (!target || !target.alive || target.generation !== cast.target_generation
        || target.buffVersions.get(359401) !== cast.version) return [];
      const pos = target.positionAt(now);
      const [ident, packet] = this.addObject(359701, pos);
      this._queue(now + 500, 'object_expire', ident);
      const packets = [packet];
      for (const enemy of [...this.arena.actors.values()]) {
        if (enemy.alive && enemy.camp !== this.camp
          && Math.hypot(pos[0] - enemy.positionAt(now)[0], pos[1] - enemy.positionAt(now)[1]) <= 96) {
          const missing = enemy.maxHp.sub(enemy.hp);
          packets.push(...this.damage(cast.power.mul(D('1.76')), now,
            { target: enemy, school: 'energy' })[0]);
          packets.push(...this.damage(missing.mul(D('.15')), now,
            { target: enemy, school: 'true' })[0]);
        }
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (slot === 0) {
      if ((start[0] === dest[0] && start[1] === dest[1]) || !this._inside(dest)) return [];
      this.cooldowns[0] = now + this.fireInterval(now);
      return this.shoot(359100, start, dest, now, this.combatStat('iEgAtk', now),
        { school: 'energy', basic: true }).concat([this._cooldown(0)]);
    }
    let target = this.arena.actors.get(target_id);
    if (slot === 1 || slot === 2) {
      if (!target || !target.alive || target.camp !== this.camp
        || Math.hypot(start[0] - target.positionAt(now)[0],
          start[1] - target.positionAt(now)[1]) > 480) return [];
    } else {
      if (!this.r_count || this.mp < 50) return [];
      const scouts = [...this.arena.actors.values()].filter(a => a.alive && a.camp === this.camp
        && !a.info.npc_template);
      const targets = [...this.arena.actors.values()].filter(a => a.alive && a.camp !== this.camp
        && !a.isUntargetable()
        && Math.hypot(start[0] - a.positionAt(now)[0], start[1] - a.positionAt(now)[1]) <= 600
        && scouts.some(scout => teamVisible(scout, a, now)));
      if (!targets.length) return [];
      targets.sort((a, b) => (Number((a.id >>> 26) !== 0) - Number((b.id >>> 26) !== 0))
        || (Math.hypot(start[0] - a.positionAt(now)[0], start[1] - a.positionAt(now)[1])
          - Math.hypot(start[0] - b.positionAt(now)[0], start[1] - b.positionAt(now)[1]))
        || (a.id - b.id));
      target = targets[0];
    }
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown({ 1: 8000, 2: 25000, 10: 2000 }[slot], slot);
    const cast = {
      slot, target: target.id, target_generation: target.generation,
      power, max_hp: this.maxHp, generation: this.generation, dest: target.positionAt(now),
    };
    const packets = [this._cooldown(slot)];
    if (slot === 1) {
      this.position = start;
      this.motion = null;
      this.ready = cast;
      this._queue(now + 50, 'athena_e', cast);
      packets.push(scene({ skills: [this._skillEvent(359201, start, cast.dest, target.id, { ready: 1 })] }));
      return packets.concat(this.syncSpeed(now));
    }
    packets.push(scene({ skills: [this._skillEvent(SLOTS[slot], start, cast.dest, target.id)] }));
    if (slot === 2) {
      const version = (target.buffVersions.get(359302) ?? 0) + 1;
      this._queue(now + 3000, 'athena_blessing', target.id, target.generation, version,
        this.maxHp.mul(D('.3')));
      packets.push(...this._buff(359301, now, target.id, { duration: 3000 }),
        ...this._buff(359302, now, target.id));
    } else {
      this.r_count -= 1;
      if (!this.r_next_charge) this.r_next_charge = now + this.skillCooldown(6000);
      packets.push(...this._resource(-50), ...this._buff(359401, now, target.id));
      if (target.hasBuff(359401, now)) {
        cast.version = target.buffVersions.get(359401);
        this._queue(now + 1000, 'athena_mark', cast);
      }
      packets[0] = this._cooldown(10);
    }
    return packets.concat(this._passive(power, now));
  }
}

export { SLOTS as ATHENA_SLOTS };
