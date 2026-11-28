/* Transformer (tank 10000049): scoped E/R reactions, charged pierce, beam.
 * Port of server/transformer_actions.py onto the JS battle core.
 *
 * Stubs: presentation only.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';
import { packII, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 324100, 1: 324201, 2: 324301, 10: 324401 };

export class TransformerActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = null;
    this.r_count = 2;
    this.r_next_charge = 0;
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: slot === 10 ? this.r_count : -1,
      end: this.cooldowns[slot], nextCharge: slot === 10 ? this.r_next_charge : 0,
    })];
  }

  on_spawn(now) { return this._buff(324101, now); }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  interrupt(now) {
    if (!this.ready) return [];
    const slot = this.ready.slot;
    this.ready = null;
    return [[1583, packII(this.id, SLOTS[slot])]].concat(this.syncSpeed(now));
  }

  update(now) {
    const packets = this.ready && this.skillSealed(this.ready.slot, now) ? this.interrupt(now) : [];
    while (this.r_next_charge && this.r_next_charge <= now) {
      this.r_count = Math.min(2, this.r_count + 1);
      this.r_next_charge = this.r_count < 2 ? this.r_next_charge + this.skillCooldown(6000) : 0;
      packets.push(this._cooldown(10));
    }
    return packets.concat(super.update(now));
  }

  _passive(now, generation) {
    if (!this.alive || generation !== this.generation) return [];
    return this._buff(324111, now).concat(this._buff(324112, now));
  }

  _reaction(target, now, slot, generation) {
    const other = slot === 1 ? 324402 : 324203;
    if (!target.hasBuff(other, now) || target.buffSources.get(other) !== this.id) return [];
    const packets = target.removeBuff(other, now);
    packets.push(...this._buff(324411, now, target.id));
    packets.push(...this.damage(target.maxHp.mul(D('.15')), now, { target, school: 'energy' })[0]);
    packets.push(...this._buff(324413, now, target.id));
    return packets;
  }

  _hit(target, slot, power, generation, now) {
    const packets = this.damage(power.mul(D(slot === 1 ? '2.12' : '1.92')), now,
      { target, school: 'energy' })[0];
    packets.push(...this._reaction(target, now, slot, generation));
    for (const buff of (slot === 1 ? [324202, 324203] : [324402, 324403, 324404])) {
      packets.push(...this._buff(buff, now, target.id));
    }
    if (slot === 10 && this.alive && generation === this.generation) {
      this.cooldowns[1] = Math.max(now, this.cooldowns[1] - 1200);
      if (this.r_next_charge) this.r_next_charge = Math.max(now, this.r_next_charge - 900);
      packets.push(this._cooldown(1), this._cooldown(10));
    }
    return packets.concat(this._passive(now, generation));
  }

  on_bullet_hit(flight, target, now) {
    if (flight.template !== 324201) return [];
    const packets = [];
    const pos = target.positionAt(now);
    for (const enemy of [...this.arena.actors.values()]) {
      if (enemy.alive && enemy.camp !== this.camp
        && Math.hypot(pos[0] - enemy.positionAt(now)[0], pos[1] - enemy.positionAt(now)[1]) <= 144) {
        packets.push(...this._hit(enemy, 1, flight.power, flight.source_generation, now));
      }
    }
    return packets;
  }

  _flight(flight, now) {
    if (flight.template !== 324401) return super._flight(flight, now);
    const start = pointAt(flight.start, flight.end,
      (flight.previous - flight.begin) / (flight.finish - flight.begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
    const contacts = [];
    for (const target of [...this.arena.actors.values()]) {
      const key = `${target.id},${target.generation}`;
      if (!target.alive || target.camp === this.camp || flight.hits.has(key)
        || target.isUntargetable()) continue;
      const hit = actorContact(start, end, target, flight.previous, now, 84);
      if (hit !== null) contacts.push([hit, target.id, target, key]);
    }
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const packets = [];
    for (const [, , target, key] of contacts) {
      if (this.projectileBlocked(target, now)) {
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
      flight.hits.add(key);
      packets.push(...this._hit(target, 10, flight.power, flight.source_generation, now));
    }
    if (now >= flight.finish) return packets.concat([scene({ expiredBullets: [flight.id] })]);
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'transformer_ready') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      const start = this.positionAt(now), slot = cast.slot;
      const packets = [scene({ skills: [this._skillEvent(SLOTS[slot], start, cast.dest)] })];
      if (slot === 2) {
        const [ident, packet] = this.addObject(324301, cast.dest);
        cast.id = ident;
        packets.push(packet);
        this._queue(now + 1000, 'transformer_beam', cast);
      } else {
        packets.push(...this.shoot(SLOTS[slot], start, cast.dest, now, D(0),
          { school: 'energy', through_walls: true, power: cast.power }));
      }
      return packets.concat(this.syncSpeed(now));
    }
    if (kind === 'transformer_beam') {
      const [cast] = data;
      const packets = this.removeObject(cast.id, { destroyed: true });
      for (const target of [...this.arena.actors.values()]) {
        if (!target.alive || target.camp === this.camp
          || Math.hypot(cast.dest[0] - target.positionAt(now)[0],
            cast.dest[1] - target.positionAt(now)[1]) > 192) continue;
        let raw = cast.power.mul(D('2.5')).add(target.maxHp.mul(D('.15')));
        if (target.hasBuff(324413, now) && target.buffSources.get(324413) === this.id) {
          raw = raw.mul(D('1.5'));
        }
        packets.push(...this.damage(raw, now, { target, school: 'energy' })[0]);
        packets.push(...this._buff(324313, now, target.id));
        packets.push(...this._passive(now, cast.generation));
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (!this._inside(dest) || (slot !== 2 && start[0] === dest[0] && start[1] === dest[1])
      || (slot === 10 && !this.r_count)) return [];
    if (slot === 2 && Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 960) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown({
      0: this.fireInterval(now), 1: 8000, 2: 20000, 10: 3000,
    }[slot], slot);
    if (slot === 0) {
      return this.shoot(324100, start, dest, now, power,
        { school: 'energy', basic: true }).concat([this._cooldown(0)]);
    }
    if (slot === 10) {
      this.r_count -= 1;
      if (!this.r_next_charge) this.r_next_charge = now + this.skillCooldown(6000);
    }
    const [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
    this.position = stopped.length ? body : start;
    this.motion = null;
    this.ready = { slot, dest, power, generation: this.generation };
    this._queue(now + 100, 'transformer_ready', this.ready);
    return [this._cooldown(slot),
      scene({ skills: [this._skillEvent(SLOTS[slot], start, dest, 0, { ready: 1 })] }),
      ...this.syncSpeed(now), ...stopped];
  }
}

export { SLOTS as TRANSFORMER_SLOTS };
