/* Panda (tank 10000003): leap aura, cleanse/shield stomp, rolling charge.
 * Port of server/panda_actions.py onto the JS battle core.
 *
 * Stubs: presentation only. Q09/Q84 math and the provisional contact rules
 * match the Python kit; space is a mobile aura, not an interruptible channel.
 */
import { TankActions, TANK_CONTACT_RADIUS, parseBkey } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';
import { packII, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 301100, 1: 301201, 2: 301301, 10: 301401 };

export class PandaActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    const data = arena.data;
    this.skills = Object.fromEntries(Object.values(SLOTS)
      .map(id => [id, data.tableRow('SkillTemplate_table.xml', { nId: id })]));
    this.ready = this.aura = this.roll = null;
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    })];
  }

  blocked(action, now) { return super.blocked(action, now) || this.ready !== null; }

  interrupt(now) {
    const packets = [];
    if (this.ready && (this.ready.slot !== 1 || !this.alive)) {
      const slot = this.ready.slot;
      this.ready = null;
      packets.push([1583, packII(this.id, SLOTS[slot])]);
      if (slot === 2) {
        this.cooldowns[2] = now + this.skillCooldown(20000, 2);
        packets.push(this._cooldown(2));
      }
    }
    if (this.roll) {
      this.roll = null;
      this.forced_until = now;
      packets.push(...this.remove_buff(301403, now));
    }
    // Space is a mobile aura, not an interruptible channel.
    if (!this.alive && this.aura) {
      this.aura = null;
      this.cooldowns[2] = now + this.skillCooldown(20000, 2);
      packets.push(this._cooldown(2));
    }
    return packets;
  }

  on_death() { this.ready = this.aura = this.roll = null; }

  on_bullet_hit(flight, target, now) {
    if (flight.template === 301100 && this.alive && flight.source_generation === this.generation) {
      return this.restoreHp(this.maxHp.mul(D('.01')), now); // Q09, includes bot tanks.
    }
    return [];
  }

  on_damage(source, hit, now, school, reflected, attacker_ap) {
    if (!this.alive || !this.aura || now >= this.aura.end || school !== 'energy'
      || reflected || hit.potential_damage.le(0) || !source.alive) return [];
    // Q84: original attacker's AP snapshot, never incoming damage or EN.
    return this.shoot(301331, this.positionAt(now), source.positionAt(now), now,
      attacker_ap.mul(D('.5')),
      { school: 'physical', target: source, reflected: true, lifesteal: D(1) });
  }

  _cleanse(now) {
    const packets = [];
    for (const key of [...this.activeBuffs.keys()]) {
      const [owner, template] = parseBkey(key);
      if (owner !== this.id) continue;
      const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
      if (row.get('iAspect') === '-1' || [30, 36].includes(Number(row.get('nEffectType')))) {
        packets.push(...this.remove_buff(template, now));
      }
    }
    return packets;
  }

  _targets(now, radius = null) {
    const start = this.positionAt(now);
    return [...this.arena.actors.values()].filter(a => a.camp !== this.camp && a.alive
      && a.isAreaTargetable()
      && (radius === null || Math.hypot(start[0] - a.positionAt(now)[0],
        start[1] - a.positionAt(now)[1]) <= radius));
  }

  _space_target(ident, now) {
    const target = this.arena.actors.get(ident);
    if (!target || target.camp === this.camp || !target.alive || target.isUntargetable()) return null;
    const types = target.buffTypes(now);
    if (types.has(26) && !types.has(32)) return null;
    if (Math.hypot(this.positionAt(now)[0] - target.positionAt(now)[0],
      this.positionAt(now)[1] - target.positionAt(now)[1])
      > Number(this.skills[301301].get('iRange'))) return null;
    return target;
  }

  _pull(target, now) {
    const start = this.positionAt(now);
    const current = target.positionAt(now);
    if (!target.alive || target.ccImmune(now)
      || Math.hypot(start[0] - current[0], start[1] - current[1]) <= 72) return [];
    // Resolve an interrupted dash from its full path before replacing it.
    const origin = target.stopPosition(now);
    const span = Math.hypot(start[0] - origin[0], start[1] - origin[1]);
    let dest = span > 72 ? pointAt(start, origin, 72 / span) : origin;
    const wall = this.arena.geometry.wallContact(origin, dest, TANK_CONTACT_RADIUS);
    if (wall !== null) dest = pointAt(origin, dest, Math.max(0, wall - 0.001));
    target.position = target.moveDestination(origin, dest);
    target.motion = null;
    const packets = target.interrupt(now);
    return packets.concat([scene({ moves: [this._moveEvent(target.position, 0, 5, target.id)] })]);
  }

  _event(now, kind, data) {
    if (kind === 'prepared') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || cast.generation !== this.generation) return [];
      this.ready = null;
      const start = this.positionAt(now);
      if (cast.slot === 1) {
        const packets = [scene({ skills: [this._skillEvent(301201, start, start, this.id)] })];
        packets.push(...this._cleanse(now));
        packets.push(...this.addShield(301201, this.maxHp.mul(D('.15')), now));
        for (const target of this._targets(now, 192)) {
          // Original effects 301203 -> 301204 -> 301205: pull, stun, damage.
          packets.push(...this._pull(target, now));
          packets.push(...this._buff(301204, now, target.id));
          packets.push(...this.damage(cast.power.mul(D('1.57')), now, { target })[0]);
          if (this.arena.pk && this.arena.pk.finished) break;
        }
        return packets;
      }
      const target = this._space_target(cast.target, now);
      if (target === null || target.generation !== cast.target_generation) {
        this.cooldowns[2] = now + this.skillCooldown(20000, 2);
        return [[1583, packII(this.id, 301301)], this._cooldown(2)];
      }
      const dest = this.moveDestination(start, target.positionAt(now));
      this.position = dest;
      this.motion = null;
      cast.end = now + 5000;
      this.aura = cast;
      // Instant relocation must reach self too; presentation converts the
      // speed-0 SERVER5 move to S1554 before dispatching the Space effect.
      const packets = [scene({
        moves: [this._moveEvent(dest, 0, 5)],
        skills: [this._skillEvent(301301, start, dest, target.id)],
      })];
      for (const template of [301303, 301305, 301306]) packets.push(...this._buff(template, now));
      packets.push(...this.damage(cast.power.mul(D('2.33')), now,
        { target, lifesteal: D(1) })[0]);
      packets.push(...this._buff(301302, now, target.id));
      for (let offset = 250; offset <= 5000; offset += 250) {
        this._queue(now + offset, 'aura_tick', cast);
      }
      this._queue(now + 5000, 'aura_end', cast);
      return packets;
    }
    if (kind === 'aura_tick' || kind === 'aura_end') {
      const [cast] = data;
      if (this.aura !== cast || !this.alive) return [];
      if (kind === 'aura_end') {
        this.aura = null;
        this.cooldowns[2] = now + this.skillCooldown(20000, 2);
        return [this._cooldown(2)];
      }
      const packets = [];
      for (const target of this._targets(now, 192)) {
        packets.push(...this.damage(cast.power.mul(D('.25')), now,
          { target, lifesteal: D(1) })[0]);
        packets.push(...this._buff(301312, now, target.id));
      }
      return packets;
    }
    if (kind === 'roll_tick') {
      const [roll] = data;
      if (this.roll !== roll || !this.alive) return [];
      const start = pointAt(roll.start, roll.dest,
        (roll.previous - roll.began) / roll.duration);
      const end = this.positionAt(now);
      const packets = [];
      for (const target of this._targets(now)) {
        if (roll.hit.has(target.id)) continue;
        const contact = actorContact(start, end, target, roll.previous, now);
        if (contact !== null) {
          roll.hit.add(target.id);
          // Original effects 301411 -> 301412 -> 301413.
          packets.push(...this._buff(301411, now, target.id));
          packets.push(...this._buff(301412, now, target.id));
          packets.push(...this.damage(roll.power.mul(D('1.71')), now, { target })[0]);
        }
      }
      if (now >= roll.began + roll.duration) {
        this.roll = null;
        packets.push(...this.remove_buff(301403, now));
      } else {
        roll.previous = now;
        this._queue(Math.min(now + 20, roll.began + roll.duration), 'roll_tick', roll);
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || !this.alive || this.ready || this.cooldowns[slot] > now) return [];
    // Original iUseInStun=1 permits E to cleanse even during hard CC.
    if (slot !== 1 && super.blocked('attack', now)) return [];
    const row = this.skills[SLOTS[slot]], power = this.combatStat('iAttack', now);
    let target = null;
    if (slot === 2) {
      target = this._space_target(target_id, now);
      if (this.aura || target === null) return [];
      dest = target.positionAt(now);
    } else if ((slot === 0 || slot === 10)
      && (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1]))) {
      return [];
    }
    this.cooldowns[slot] = now + this.skillCooldown(
      slot === 0 ? this.fireInterval(now) : Number(row.get('iCoolTime')), slot);
    if (slot === 0) {
      return this.shoot(301100, start, dest, now, power,
        { school: 'physical', basic: true }).concat([this._cooldown(0)]);
    }
    if (slot === 10) {
      dest = pointAt(start, dest, 336 / Math.hypot(dest[0] - start[0], dest[1] - start[1]));
      dest = this.arena.geometry.clampTankPosition(dest);
      let body, stopped;
      [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      if (!stopped.length) body = start;
      const wall = this.arena.geometry.wallContact(body, dest, TANK_CONTACT_RADIUS);
      if (wall !== null) dest = pointAt(body, dest, Math.max(0, wall - 0.001));
      dest = dest.map(pyRound);
      const duration = this._setMotion(body, dest, 720, now, 4);
      dest = this.motion[1];
      this.forced_until = now + duration;
      this.roll = {
        start: body, dest, began: now, previous: now, duration, hit: new Set(), power,
      };
      this._queue(now + Math.min(20, duration), 'roll_tick', this.roll);
      const movement = scene({
        moves: [this._moveEvent(dest, 720, 4)],
        skills: [this._skillEvent(301401, start, dest)],
      });
      const packets = [this._cooldown(10), ...this._buff(301403, now)];
      return stopped.length ? packets.concat(stopped, [movement]) : [movement].concat(packets);
    }
    let body, stopped;
    [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
    this.position = stopped.length ? body : start;
    this.motion = null;
    const stopped_roll = this.roll ? this.interrupt(now) : [];
    this.ready = { slot, power, generation: this.generation, dest };
    if (slot === 2) {
      Object.assign(this.ready, { target: target.id, target_generation: target.generation });
      this.cooldowns[2] = now + Number(row.get('iReadyTime')) + 5000
        + this.skillCooldown(Number(row.get('iCoolTime')), 2);
    }
    this._queue(now + Number(row.get('iReadyTime')), 'prepared', this.ready);
    return stopped_roll.concat([scene({
      moves: [this._moveEvent(start, 0, 5)],
      skills: [this._skillEvent(SLOTS[slot], start, dest, target_id, { ready: 1 })],
    }), this._cooldown(slot)], stopped);
  }
}

export { SLOTS as PANDA_SLOTS };
