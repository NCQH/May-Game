/* Werewolf (tank 10000040): separate passive clocks, server-owned taunts.
 * Port of server/wolf_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. The dash exhibits a visual bullet only.
 */
import { TankActions, bkey } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, stopMove, encodeS1572 } from '../protocol.js';
import { aimed, enemies, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 314100, 1: 314201, 2: 314301, 10: 314401 };

export class WolfActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.r_count = 2;
    this.r_next_charge = 0;
    this.passive_ready_at = 0;
    this.counter_ready_at = 0;
    this.dash = null;
    this.taunts = new Map();
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: slot === 10 ? this.r_count : -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: slot === 10 ? this.r_next_charge : 0,
    })];
  }

  on_spawn(now) {
    this.passive_ready_at = 0;
    this.counter_ready_at = 0;
    const packets = [];
    for (const template of [314101, 314102, 314103, 314104]) {
      packets.push(...this._buff(template, now));
    }
    return packets;
  }

  update(now) {
    const packets = [];
    while (this.r_next_charge && this.r_next_charge <= now) {
      this.r_count = Math.min(2, this.r_count + 1);
      this.r_next_charge = this.r_count < 2
        ? this.r_next_charge + this.skillCooldown(8000) : 0;
      packets.push(this._cooldown(10));
    }
    return packets.concat(super.update(now));
  }

  blocked(action, now) { return Boolean(this.dash) || super.blocked(action, now); }

  _endDash(now, { hit = false } = {}) {
    if (!this.dash) return [];
    const cast = this.dash;
    this.dash = null;
    const pos = this.positionAt(now);
    this.position = pos;
    this.motion = null;
    this.forcedUntil = now;
    return [scene({
      moves: [this._moveEvent(pos, 0, 5)],
      ...(hit ? { blownBullets: [cast.bullet] } : { expiredBullets: [cast.bullet] }),
    })].concat(this.removeBuff(314202, now));
  }

  _endTaunt(target, cast, now) {
    this.taunts.delete(target.id);
    if (target.generation !== cast.target_generation
      || target.buffSources.get(314303) !== this.id) return [];
    if (target.hasBuff(314303, now)
      && target.buffVersions.get(314303) !== cast.version) return [];
    const packets = [];
    for (const template of [314303, 314304, 314305]) packets.push(...target.removeBuff(template, now));
    if (target.motion && target.motion === cast.motion) {
      target.position = target.positionAt(now);
      target.motion = null;
      target.forcedUntil = now;
      packets.push(scene({ moves: [this._moveEvent(target.position, 0, 5, target.id)] }));
    }
    return packets;
  }

  interrupt(now) {
    const packets = this._endDash(now);
    if (!this.alive) {
      for (const [ident, cast] of [...this.taunts]) {
        const target = this.arena.actors.get(ident);
        if (target) packets.push(...this._endTaunt(target, cast, now));
      }
    }
    return packets;
  }

  _hit(target, raw, now, {
    ownRatio = 0, space = false, basic = false, current = true, reflected = false,
  } = {}) {
    const missing = this.maxHp.sub(this.hp);
    const targetHp = target.hp;
    let vamp = D('.25');
    if (!basic) vamp = vamp.add(D('.25').mul(missing).div(this.maxHp));
    let [packets, lost] = this.damage(raw, now, {
      target, basic, reflected, lifesteal: current ? vamp : 0,
    });
    if (ownRatio && target.alive) {
      const [extra, extraLost] = this.damage(missing.mul(D(ownRatio)), now, {
        target, school: 'true', lifesteal: current ? vamp : 0, reflected,
      });
      packets.push(...extra);
      lost = lost || extraLost;
    }
    const bonus = space || (!basic && lost && current && now >= this.passive_ready_at);
    if (bonus) {
      if (current) this.passive_ready_at = now + 250;
      if (target.alive) {
        packets.push(...this.damage(targetHp.mul(D('.05')), now, {
          target, school: 'true', lifesteal: current ? vamp : 0, reflected,
        })[0]);
      }
      if (current) packets.push(...this._buff(314112, now));
    }
    return packets;
  }

  _r(now, { reflected = false } = {}) {
    const pos = this.positionAt(now);
    const packets = [scene({ skills: [this._skillEvent(314401, pos, pos)] })];
    const power = this.combatStat('iAttack', now);
    for (const target of enemies(this, { area: true })) {
      if (Math.hypot(pos[0] - target.positionAt(now)[0],
        pos[1] - target.positionAt(now)[1]) <= 168) {
        packets.push(...this._hit(target, power, now, { ownRatio: '.05', reflected }));
      }
    }
    return packets;
  }

  onBasicDamage(source, hit, now) {
    if (!this.alive || now < this.counter_ready_at) return [];
    this.counter_ready_at = now + 250;
    if (this.arena.rng() >= 0.25) return [];
    this._queue(now + 50, 'wolf_counter', this.generation);
    return this._buff(314121, now).concat(this._buff(314122, now));
  }

  _taunt(target, now) {
    if (target.ccImmune(now)) return [];
    const packets = [];
    packets.push(...this._buff(314303, now, target.id, { duration: 3000 }));
    if (!target.hasBuff(314303, now)) return packets;
    const end = this.arena.activeBuffs.get(bkey(target.id, 314303))[1];
    for (const template of [314304, 314305]) {
      packets.push(...this._buff(template, now, target.id, { duration: 3000 }));
    }
    const [, stopped] = prepareDisplacement(target, now);
    packets.push(...stopped);
    const cast = {
      target: target.id, target_generation: target.generation, generation: this.generation,
      end, version: target.buffVersions.get(314303),
    };
    this.taunts.set(target.id, cast);
    return packets.concat(this._tauntStep(cast, now));
  }

  _tauntStep(cast, now) {
    const target = this.arena.actors.get(cast.target);
    if (!target || this.taunts.get(target.id) !== cast) return [];
    if (!this.alive || this.generation !== cast.generation || !target.alive
      || target.generation !== cast.target_generation || now >= cast.end
      || !target.hasBuff(314303, now)
      || target.buffVersions.get(314303) !== cast.version) {
      return this._endTaunt(target, cast, now);
    }
    const packets = [];
    const pos = target.positionAt(now), dest = this.positionAt(now);
    const npc = Boolean(target.info.npc_template);
    const types = target.buffTypes(now);
    if ((!npc || target.taunt_mobile) && !types.has(30) && !types.has(36)) {
      const span = Math.hypot(pos[0] - dest[0], pos[1] - dest[1]);
      if (span > 72) {
        const speed = Math.max(1, pyRound(Number(target.stats.iSpeed) * 0.15));
        const [origin, stopped] = prepareDisplacement(target, now, { interrupt: false });
        packets.push(...stopped);
        const remaining = Math.max(0, Math.hypot(origin[0] - dest[0],
          origin[1] - dest[1]) - 72);
        const end = aimed(origin, dest,
          Math.min(remaining, speed * Math.min(100, cast.end - now) / 1000));
        const elapsed = target._setMotion(origin, end, speed, now, 1);
        target.forcedUntil = now + elapsed;
        cast.motion = target.motion;
        packets.push(scene({ moves: [this._moveEvent(target.motion[1], speed, 1, target.id)] }));
      }
    }
    if (!this.isUntargetable()
      && Math.hypot(pos[0] - dest[0], pos[1] - dest[1]) <= Number(target.stats.nFireRange)
      && this.arena.geometry.wallContact(pos, dest) === null) {
      this.arena.forced_basic_actor = target.id;
      try {
        if (npc) {
          if (typeof target.taunt_attack === 'function') {
            packets.push(...target.taunt_attack(this, now));
          }
        } else packets.push(...target.cast(0, pos, dest, this.id, now));
      } finally { this.arena.forced_basic_actor = null; }
    }
    this._queue(Math.min(now + 100, cast.end), 'wolf_taunt', cast);
    return packets;
  }

  _flight(flight, now) {
    if (flight.template === 314100) {
      flight.lifesteal = this.alive && this.generation === flight.source_generation
        ? D('.25') : 0;
    }
    return super._flight(flight, now);
  }

  _event(now, kind, data) {
    if (kind === 'wolf_counter') {
      return this.alive && this.generation === data[0] ? this._r(now, { reflected: true }) : [];
    }
    if (kind === 'wolf_taunt') return this._tauntStep(data[0], now);
    if (kind === 'wolf_dash') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive) return [];
      const start = this.positionAt(cast.previous), end = this.positionAt(now);
      const contacts = [];
      for (const target of enemies(this)) {
        const hit = actorContact(start, end, target, cast.previous, now);
        if (hit !== null) contacts.push([hit, target.id, target]);
      }
      if (contacts.length) {
        contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const [, , target] = contacts[0];
        const impact = pointAt(start, end, contacts[0][0]).map(pyRound);
        this.position = this.stopPosition(now, impact);
        this.motion = null;
        const packets = [[1554, stopMove(this.sceneId, this.id, this.position)]];
        packets.push(...this._endDash(now, { hit: true }));
        packets.push(...this._hit(target, cast.power.mul(D('1.67')), now, { ownRatio: '.05' }));
        for (const template of [314212, 314213]) {
          packets.push(...this._buff(template, now, target.id));
        }
        packets.push(scene({
          skills: [this._skillEvent(314211, impact, target.positionAt(now), target.id)],
        }));
        return packets;
      }
      if (!this.motion || now >= this.motion[3]) return this._endDash(now);
      cast.previous = now;
      this._queue(Math.min(now + 20, this.motion[3]), kind, cast);
      return [];
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if ((slot === 10 && !this.r_count)
      || ([0, 1].includes(slot) && start[0] === dest[0] && start[1] === dest[1])) return [];
    const power = this.combatStat('iAttack', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 6000, 2: 30000, 10: 4000 }[slot], slot);
    if (slot === 0) {
      return this.shoot(314100, start, dest, now, power,
        { school: 'physical', basic: true }).concat([this._cooldown(0)]);
    }
    if (slot === 10) {
      this.r_count -= 1;
      if (!this.r_next_charge) this.r_next_charge = now + this.skillCooldown(8000);
      return this._r(now).concat([this._cooldown(10)]);
    }
    const packets = [scene({ skills: [this._skillEvent(SLOTS[slot], start, dest)] })];
    if (slot === 1) {
      const end = aimed(start, dest, 360, { fixed: true });
      let origin, stopped;
      [origin, stopped] = prepareDisplacement(this, now, { interrupt: false });
      if (!stopped.length) origin = start;
      const elapsed = this._setMotion(origin, end, 720, now, 3);
      this.forcedUntil = now + elapsed;
      this.dash = { previous: now, power, bullet: this._newId(2) };
      packets.push(...this._buff(314202, now));
      packets.push(...stopped);
      packets.push(scene({ fires: [{
        bulletId: this.dash.bullet, ownerId: this.id, start, dest: this.motion[1],
        speed: 720, templateId: 314201,
      }] }));
      packets.push(scene({ moves: [this._moveEvent(this.motion[1], 720, 3)] }));
      this._queue(now + Math.min(20, elapsed), 'wolf_dash', this.dash);
    } else {
      for (const target of enemies(this, { area: true })) {
        if (Math.hypot(start[0] - target.positionAt(now)[0],
          start[1] - target.positionAt(now)[1]) <= 192) {
          packets.push(...this._hit(target, power.mul(D('2.68')), now,
            { ownRatio: '.1', space: true }));
          if (this.arena.pk && this.arena.pk.finished) break;
          if (target.alive) packets.push(...this._taunt(target, now));
        }
      }
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as WOLF_SLOTS };
