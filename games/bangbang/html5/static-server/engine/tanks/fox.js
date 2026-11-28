/* Nine-tailed Fox (tank 10000086): per-wave decay and finite foxfire.
 * Port of server/fox_actions.py onto the JS battle core.
 *
 * Stubs: presentation only; foxfire/cast decay counters use Map keys.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';
import { packII } from './melee.js';
import { powD, teamVisible } from './batch-c-common.js';

const SLOTS = { 0: 360100, 1: 360401, 2: 360701, 10: 360201 };

export class FoxActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.e_count = 3;
    this.space_count = 3;
    this.e_next_charge = 0;
    this.space_next_charge = 0;
    this.ready = this.foxfire = null;
    this.fire_count = 0;
  }

  _cooldown(slot) {
    const count = slot === 1 ? this.e_count : slot === 2 ? this.space_count : -1;
    const charge = slot === 1 ? this.e_next_charge : slot === 2 ? this.space_next_charge : 0;
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count, end: this.cooldowns[slot], nextCharge: charge,
    })];
  }

  on_spawn(now) {
    this.foxfire = null;
    this.fire_count = 0;
    return this._buff(360101, now);
  }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      this.ready = null;
      packets.push([1583, packII(this.id, 360701)]);
    }
    if (!this.alive) { this.foxfire = null; this.fire_count = 0; }
    return packets.concat(this.syncSpeed(now));
  }

  update(now) {
    const packets = this.ready && this.skillSealed(2, now) ? this.interrupt(now) : [];
    for (const [slot, field, clock] of [[1, 'e_count', 'e_next_charge'],
      [2, 'space_count', 'space_next_charge']]) {
      while (this[clock] && this[clock] <= now) {
        const count = Math.min(3, this[field] + 1);
        this[field] = count;
        this[clock] = count < 3 ? this[clock] + this.skillCooldown(6000) : 0;
        packets.push(this._cooldown(slot));
      }
    }
    return packets.concat(super.update(now));
  }

  _fire_visual(now, template = 0) {
    const packets = [];
    for (let t = 360102; t <= 360112; t += 1) packets.push(...this.removeBuff(t, now));
    if (template) packets.push(...this._buff(template, now));
    return packets;
  }

  _stack_fire(now, generation) {
    if (!this.alive || generation !== this.generation || this.foxfire) return [];
    if (this.fire_count && !this.hasBuff(360101 + this.fire_count, now)) this.fire_count = 0;
    this.fire_count += 1;
    const packets = this._fire_visual(now, 360101 + this.fire_count);
    if (this.fire_count === 5) {
      this.foxfire = {
        left: 5, counts: new Map(), end: now + 10000, generation: this.generation,
      };
      this.fire_count = 0;
      this._queue(now + 400, 'fox_fire', this.foxfire);
    }
    return packets;
  }

  on_bullet_hit(flight, target, now) {
    if (flight.template === 360201) {
      return this._buff(360202, now, target.id).concat(this._buff(360203, now, target.id),
        this._stack_fire(now, flight.source_generation));
    }
    if (flight.template === 360601) {
      const cast = flight.context;
      const key = `${target.id},${target.generation}`;
      const count = cast.counts.get(key) ?? 0;
      cast.counts.set(key, count + 1);
      const packets = this.damage(flight.power.mul(powD(D('.8'), count)), now,
        { target, school: 'energy' })[0];
      if (this.alive && flight.source_generation === this.generation && !target.info.npc_template) {
        packets.push(...this.restoreHp(flight.power.mul(D('.5')), now));
      }
      return packets;
    }
    return [];
  }

  _flight(flight, now) {
    if (flight.template !== 360401) return super._flight(flight, now);
    const start = pointAt(flight.start, flight.end,
      (flight.previous - flight.begin) / (flight.finish - flight.begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
    const contacts = [];
    const packets = [];
    for (const target of [...this.arena.actors.values()]) {
      const key = `${target.id},${target.generation}`;
      if (!target.alive || target.camp === this.camp || flight.hits.has(key)
        || target.isUntargetable()) continue;
      const hit = actorContact(start, end, target, flight.previous, now, 84);
      if (hit !== null) contacts.push([hit, target.id, target, key]);
    }
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [, , target, key] of contacts) {
      if (this.projectileBlocked(target, now)) {
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
      const count = flight.context.counts.get(key) ?? 0;
      const raw = flight.raw.mul(powD(D('.75'), flight.hits.size + count));
      flight.hits.add(key);
      flight.context.counts.set(key, count + 1);
      packets.push(...this.damage(raw, now, { target, school: 'energy' })[0]);
      if (this.alive && flight.source_generation === this.generation) {
        if (this.e_next_charge) {
          this.e_next_charge = Math.max(now, this.e_next_charge - 300);
          packets.push(this._cooldown(1));
        }
        packets.push(...this._stack_fire(now, flight.source_generation));
      }
    }
    if (now >= flight.finish) return packets.concat([scene({ expiredBullets: [flight.id] })]);
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return packets;
  }

  _blink_hit(pos, cast, now) {
    const packets = [];
    for (const target of [...this.arena.actors.values()]) {
      if (!target.alive || target.camp === this.camp
        || Math.hypot(pos[0] - target.positionAt(now)[0], pos[1] - target.positionAt(now)[1]) > 168) {
        continue;
      }
      const repeat = target.hasBuff(360302, now) && target.buffSources.get(360302) === this.id;
      packets.push(...this.damage(cast.power, now, { target, school: 'energy' })[0]);
      packets.push(...this._buff(360302, now, target.id));
      if (repeat) packets.push(...this._buff(360311, now, target.id));
      packets.push(...this._stack_fire(now, cast.generation));
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'fox_fire') {
      const [cast] = data;
      if (this.foxfire !== cast || !this.alive || cast.generation !== this.generation) return [];
      if (now >= cast.end) {
        this.foxfire = null;
        return this._fire_visual(now);
      }
      const start = this.positionAt(now);
      const targets = [...this.arena.actors.values()].filter(a => a.alive && a.camp !== this.camp
        && !a.isUntargetable() && !a.info.npc_template
        && Math.hypot(start[0] - a.positionAt(now)[0], start[1] - a.positionAt(now)[1]) <= 480
        && teamVisible(this, a, now));
      const packets = [];
      if (targets.length) {
        targets.sort((a, b) => (Math.hypot(start[0] - a.positionAt(now)[0],
          start[1] - a.positionAt(now)[1]) - Math.hypot(start[0] - b.positionAt(now)[0],
          start[1] - b.positionAt(now)[1])) || (a.id - b.id));
        const target = targets[0];
        const power = this.combatStat('iEgAtk', now);
        packets.push(...this.shoot(360601, start, target.positionAt(now), now, D(0), {
          school: 'energy', target, proc: true, through_walls: true, power, context: cast,
        }));
        cast.left -= 1;
        packets.push(...this._fire_visual(now, cast.left ? 360113 - cast.left : 0));
      }
      if (cast.left) this._queue(Math.min(now + 400, cast.end), kind, cast);
      else this.foxfire = null;
      return packets;
    }
    if (kind === 'fox_blink') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      const start = this.positionAt(now);
      const dest = this.blinkDestination(start, cast.dest);
      this.position = dest;
      this.motion = null;
      const packets = [scene({
        moves: [this._moveEvent(dest, 0, 5)],
        skills: [this._skillEvent(360701, start, dest)],
      })];
      return packets.concat(this._blink_hit(dest, cast, now), this.syncSpeed(now));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if ((slot === 0 || slot === 1 || slot === 2)
      && ((start[0] === dest[0] && start[1] === dest[1]) || !this._inside(dest))) return [];
    if ((slot === 1 && !this.e_count) || (slot === 2 && !this.space_count)) return [];
    const target = this.arena.actors.get(target_id);
    if (slot === 10 && (!target || !target.alive || target.camp === this.camp
      || target.isUntargetable()
      || Math.hypot(start[0] - target.positionAt(now)[0],
        start[1] - target.positionAt(now)[1]) > 480
      || !teamVisible(this, target, now))) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown({
      0: this.fireInterval(now), 1: 1500, 2: 1500, 10: 8000,
    }[slot], slot);
    if (slot === 0) {
      return this.shoot(360100, start, dest, now, power,
        { school: 'energy', basic: true }).concat([this._cooldown(0)]);
    }
    if (slot === 10) {
      return this.shoot(360201, start, target.positionAt(now), now, power.mul(D('1.56')),
        { school: 'energy', target, through_walls: true }).concat([this._cooldown(10)]);
    }
    if (slot === 1) {
      this.e_count -= 1;
      if (!this.e_next_charge) this.e_next_charge = now + this.skillCooldown(6000);
      const cast = { counts: new Map(), generation: this.generation };
      const theta = Math.atan2(dest[1] - start[1], dest[0] - start[0]);
      const packets = [this._cooldown(1)];
      for (const angle of [-15, 0, 15]) {
        const rad = theta + angle * Math.PI / 180;
        const endpoint = [start[0] + pyRound(600 * Math.cos(rad)),
          start[1] + pyRound(600 * Math.sin(rad))];
        packets.push(...this.shoot(360401, start, endpoint, now, power.mul(D('1.65')),
          { school: 'energy', through_walls: true, context: cast }));
      }
      return packets;
    }
    this.space_count -= 1;
    if (!this.space_next_charge) this.space_next_charge = now + this.skillCooldown(6000);
    const span = Math.hypot(dest[0] - start[0], dest[1] - start[1]);
    dest = pointAt(start, dest, Math.min(1, 336 / span));
    this.position = start;
    this.motion = null;
    const cast = { slot: 2, dest, power, generation: this.generation };
    this.ready = cast;
    const [ident, packet] = this.addObject(360303, start);
    this._queue(now + 800, 'object_expire', ident);
    this._queue(now + 50, 'fox_blink', cast);
    return [this._cooldown(2), packet,
      scene({ skills: [this._skillEvent(360701, start, dest, 0, { ready: 1 })] }),
      ...this._blink_hit(start, cast, now), ...this.syncSpeed(now)];
  }
}

export { SLOTS as FOX_SLOTS };
