/* Medusa (tank 10000058): bouncing snakes and a paid channel.
 * Port of server/medusa_actions.py onto the JS battle core.
 *
 * Stubs: presentation only; silence probing reads BuffTemplate rows.
 */
import { TankActions, bkey } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';
import { drainMp, packII, prepareDisplacement } from './melee.js';
import { powD, teamVisible } from './batch-c-common.js';

const SLOTS = { 0: 333100, 1: 333201, 2: 333301, 10: 333401 };

export class MedusaActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = this.channel = null;
    this.e_count = 2;
    this.e_next_charge = 0;
    this.mp = Number(this.stats.iMp);
  }

  _resource(delta) {
    if (this.noel_box) return [];
    const old = this.mp;
    this.mp = Math.max(0, Math.min(Number(this.stats.iMp), this.mp + delta));
    return old !== this.mp ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: slot === 1 ? this.e_count : -1,
      end: this.cooldowns[slot], nextCharge: slot === 1 ? this.e_next_charge : 0,
    })];
  }

  on_spawn(now) {
    this.mp = Number(this.stats.iMp);
    this._queue(now + 3000, 'medusa_regen', this.generation);
    return this._buff(333101, now).concat(this._buff(333102, now),
      [scene({ mp: [{ objectId: this.id, mp: this.mp }] })]);
  }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  _end_channel(now) {
    if (!this.channel) return [];
    this.channel = null;
    this.cooldowns[2] = now + this.skillCooldown(15000, 2);
    const packets = [];
    for (let template = 333302; template <= 333305; template += 1) {
      packets.push(...this.removeBuff(template, now));
    }
    if (this.hasBuff(333301, now)) {
      const remaining = Math.min(500, this.activeBuffs.get(bkey(this.id, 333301))[1] - now);
      packets.push(...this._buff(333301, now, null, { duration: remaining }));
    }
    return packets.concat([this._cooldown(2)], this.syncSpeed(now));
  }

  interrupt(now) {
    const packets = this._end_channel(now);
    if (this.ready) {
      this.ready = null;
      packets.push([1583, packII(this.id, 333401)]);
    }
    return packets.concat(this.syncSpeed(now));
  }

  update(now) {
    const packets = [];
    if (this.ready && this.skillSealed(10, now)) packets.push(...this.interrupt(now));
    if (this.channel) {
      const sealed = [...this.buffStarted.keys()].some(t => this.hasBuff(t, now)
        && t !== 333304 && this._silence_row(t));
      if (sealed) packets.push(...this._end_channel(now));
    }
    while (this.e_next_charge && this.e_next_charge <= now) {
      this.e_count = Math.min(2, this.e_count + 1);
      this.e_next_charge = this.e_count < 2 ? this.e_next_charge + this.skillCooldown(8000) : 0;
      packets.push(this._cooldown(1));
    }
    return packets.concat(super.update(now));
  }

  _silence_row(template) {
    const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
    const bits = Number(row.get('fEffectValB', 0));
    return [35, 66].includes(Number(row.get('nEffectType'))) && (!bits || (bits & 4));
  }

  _curse(target, now) {
    if (target.rejectBuff({ nEffectType: '49' }, this, now)) return [];
    let count = 0;
    for (let t = 333121; t <= 333124; t += 1) {
      if (target.hasBuff(t, now) && target.buffSources.get(t) === this.id) count = t - 333120;
    }
    const penalty = target.hasBuff(333112, now) && target.buffSources.get(333112) === this.id
      ? (target.buffStacks.get(333112) ?? 0) : 0;
    const packets = [];
    for (let t = 333121; t <= 333124; t += 1) {
      if (target.buffSources.get(t) === this.id) packets.push(...target.removeBuff(t, now));
    }
    count += 1;
    packets.push(...this._buff(333112, now, target.id,
      { duration: 2000, stacks: Math.min(5, penalty + 1) }));
    if (count >= 5) packets.push(...this._buff(333125, now, target.id));
    else packets.push(...this._buff(333120 + count, now, target.id, { duration: 2000 }));
    packets.push(...drainMp(target, 5, now));
    return packets.concat(this._resource(5));
  }

  on_bullet_hit(flight, target, now) {
    const packets = [];
    const current = this.alive && flight.source_generation === this.generation;
    if (current) packets.push(...this._curse(target, now));
    if (flight.template !== 333201 && flight.template !== 333211) return packets;
    packets.push(...drainMp(target, 10, now));
    if (current && this.e_next_charge) {
      this.e_next_charge = Math.max(now, this.e_next_charge - 800);
      packets.push(this._cooldown(1));
    }
    const cast = flight.context;
    const key = `${target.id},${target.generation}`;
    cast.hits.add(key);
    if (cast.hits.size >= 5) return packets;
    const pos = target.positionAt(now);
    const choices = [...this.arena.actors.values()].filter(a => a.alive && a.camp !== this.camp
      && !a.isUntargetable() && !cast.hits.has(`${a.id},${a.generation}`)
      && Math.hypot(pos[0] - a.positionAt(now)[0], pos[1] - a.positionAt(now)[1]) <= 336
      && teamVisible(this, a, now));
    if (choices.length) {
      choices.sort((a, b) => (Math.hypot(pos[0] - a.positionAt(now)[0],
        pos[1] - a.positionAt(now)[1]) - Math.hypot(pos[0] - b.positionAt(now)[0],
        pos[1] - b.positionAt(now)[1])) || (a.id - b.id));
      const next = choices[0];
      packets.push(...this.shoot(333211, pos, next.positionAt(now), now,
        cast.power.mul(D('1.51')).mul(D(1).add(D('.1').mul(D(cast.hits.size)))), {
          school: 'energy', target: next, through_walls: true,
          context: cast, attack_key: flight.attack_key,
        }));
    }
    return packets;
  }

  _flight(flight, now) {
    if (flight.template !== 333311) {
      if (flight.context && flight.context.generation !== undefined) {
        flight.source_generation = flight.context.generation;
      }
      return super._flight(flight, now);
    }
    const start = pointAt(flight.start, flight.end,
      (flight.previous - flight.begin) / (flight.finish - flight.begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
    const packets = [];
    const contacts = [];
    for (const target of [...this.arena.actors.values()]) {
      const key = `${target.id},${target.generation}`;
      if (!target.alive || target.camp === this.camp || flight.hits.has(key)
        || target.isUntargetable()) continue;
      const hit = actorContact(start, end, target, flight.previous, now);
      if (hit !== null) contacts.push([hit, target.id, target, key]);
    }
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [, , target, key] of contacts) {
      if (this.projectileBlocked(target, now)) {
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
      flight.hits.add(key);
      const counts = flight.context.counts;
      const raw = flight.raw.mul(powD(D('.75'), counts.get(key) ?? 0));
      counts.set(key, (counts.get(key) ?? 0) + 1);
      packets.push(...this.damage(raw, now, { target, school: 'energy' })[0]);
      if (this.alive && flight.source_generation === this.generation) {
        packets.push(...this._curse(target, now));
      }
    }
    if (now >= flight.finish) return packets.concat([scene({ expiredBullets: [flight.id] })]);
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'medusa_regen') {
      if (!this.alive || this.generation !== data[0]) return [];
      this._queue(now + 3000, kind, ...data);
      return this._resource(10);
    }
    if (kind === 'medusa_channel') {
      const [cast] = data;
      if (this.channel !== cast || !this.alive) return [];
      if (this.mp < 25) return this._end_channel(now);
      const packets = this._resource(-25).concat(this._buff(333301, now, null, { duration: 500 }));
      const start = this.positionAt(now), dest = cast.dest;
      const theta = Math.atan2(dest[1] - start[1], dest[0] - start[0]);
      const volley = { counts: new Map(), generation: this.generation };
      const power = this.combatStat('iEgAtk', now);
      for (const angle of [-15, 0, 15]) {
        const rad = theta + angle * Math.PI / 180;
        const end = [start[0] + pyRound(600 * Math.cos(rad)),
          start[1] + pyRound(600 * Math.sin(rad))];
        packets.push(...this.shoot(333311, start, end, now, power,
          { school: 'energy', through_walls: true, context: volley }));
      }
      this._queue(now + 500, kind, cast);
      return packets;
    }
    if (kind === 'medusa_gaze') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      const start = this.positionAt(now);
      const theta = Math.atan2(cast.dest[1] - start[1], cast.dest[0] - start[0]);
      const packets = [scene({ skills: [this._skillEvent(333401, start, cast.dest)] })];
      for (const target of [...this.arena.actors.values()]) {
        if (!target.alive || target.camp === this.camp
          || Math.hypot(start[0] - target.positionAt(now)[0],
            start[1] - target.positionAt(now)[1]) > 480) continue;
        const pos = target.positionAt(now);
        const angle = Math.atan2(pos[1] - start[1], pos[0] - start[0]) - theta;
        if (Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) > 30 * Math.PI / 180) continue;
        packets.push(...this.damage(cast.power.mul(D('1.87')), now, { target, school: 'energy' })[0]);
        packets.push(...this._buff(333402, now, target.id), ...this._curse(target, now));
      }
      return packets.concat(this.syncSpeed(now));
    }
    return super._event(now, kind, data);
  }

  handle(message, payload) {
    if (message === 514) {
      const now = this.clock();
      const packets = this.arena.tick(now);
      if (!this.arena.inputOpen(now, this)) return packets;
      if (this.channel && payload.length === 8) {
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        const sceneId = view.getUint32(0, true);
        const x = view.getInt16(4, true), y = view.getInt16(6, true);
        const pos = this.positionAt(now);
        if (sceneId === this.sceneId && (x !== pos[0] || y !== pos[1])) this.channel.dest = [x, y];
      }
      return packets;
    }
    return super.handle(message, payload);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if ((slot === 0 || slot === 10)
      && (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1]))) return [];
    const target = this.arena.actors.get(target_id);
    if (slot === 1 && (!this.e_count || !target || !target.alive || target.camp === this.camp
      || target.isUntargetable()
      || Math.hypot(start[0] - target.positionAt(now)[0],
        start[1] - target.positionAt(now)[1]) > 600
      || !teamVisible(this, target, now))) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown({
      0: this.fireInterval(now), 1: 3000, 2: 0, 10: 10000,
    }[slot], slot);
    if (slot === 0) {
      return this.shoot(333100, start, dest, now, power,
        { school: 'energy', basic: true }).concat([this._cooldown(0)]);
    }
    if (slot === 1) {
      this.e_count -= 1;
      if (!this.e_next_charge) this.e_next_charge = now + this.skillCooldown(8000);
      const cast = { hits: new Set(), power, generation: this.generation };
      return this.shoot(333201, start, target.positionAt(now), now, power.mul(D('1.51')), {
        school: 'energy', target, through_walls: true, context: cast,
      }).concat([this._cooldown(1)]);
    }
    if (slot === 2) {
      this.channel = {
        dest: start[0] === dest[0] && start[1] === dest[1]
          ? [start[0] + 600, start[1]] : dest,
        generation: this.generation,
      };
      this._queue(now + 500, 'medusa_channel', this.channel);
      const packets = [scene({ skills: [this._skillEvent(333301, start, start, this.id)] })];
      for (let t = 333301; t <= 333305; t += 1) packets.push(...this._buff(t, now));
      return packets.concat([this._cooldown(2)], this.syncSpeed(now));
    }
    const [origin, stopped] = prepareDisplacement(this, now, { interrupt: false });
    this.position = stopped.length ? origin : start;
    this.motion = null;
    this.ready = { slot: 10, dest, power, generation: this.generation };
    this._queue(now + 500, 'medusa_gaze', this.ready);
    return [this._cooldown(10),
      scene({ skills: [this._skillEvent(333401, start, dest, 0, { ready: 1 })] }),
      ...this.syncSpeed(now), ...stopped];
  }
}

export { SLOTS as MEDUSA_SLOTS };
