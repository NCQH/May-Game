/* Apocalypse (tank 10000072): bounded pellet budget, timed bursts and
 * non-lethal recovery. Port of server/apocalypse_actions.py.
 *
 * Stubs: presentation/skin only. No borrowed view or S1578 writer is used.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import {
  aimed, enemies, inCone, inStrip, piercingStep, prepareDisplacement, packII,
} from './melee.js';

const SLOTS = { 0: 346100, 1: 346201, 2: 346301, 10: 346401 };

export class ApocalypseActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = null;
    this.burst_count = 0;
    this.passive_ready_at = 0;
  }

  _cooldown(slot, changed = false) {
    const info = {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.ready = null;
    this.burst_count = this.passive_ready_at = 0;
    this._queue(now + 3000, 'apoc_reload', this.generation);
    const packets = [];
    for (const template of [346101, 346102, 346103]) packets.push(...this._buff(template, now));
    return packets;
  }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      packets.push([1583, packII(this.id, this.ready.skill)]);
      this.ready = null;
    }
    return packets.concat(this.syncSpeed(now));
  }

  on_control(source, template, now) {
    const effect = this.arena.data
      .tableRow('BuffTemplate_table.xml', { nBuffId: template }).get('nEffectType');
    return ['30', '35', '66'].includes(effect) ? this.interrupt(now) : [];
  }

  on_damage(source, hit, now, school, reflected, attacker_ap) {
    if (!this.alive || hit.hp_loss.le(0) || this.hp.ge(this.maxHp.div(D(2)))
      || now < this.passive_ready_at) return [];
    // Set the cooldown before healing/cleansing can invoke other hooks.
    this.passive_ready_at = now + 30000;
    const packets = this.cleanse(now)
      .concat(this._buff(346112, now), this._buff(346113, now, null, { duration: 30000 }));
    packets.push(...this.restoreHp(this.maxHp.mul(D('.1')), now));
    for (let tick = 1; tick <= 5; tick += 1) this._queue(now + 1000 * tick, 'apoc_heal', this.generation);
    return packets;
  }

  _pellet(flight, target, now) {
    const cast = flight.context;
    const key = `${target.id},${target.generation}`;
    const used = cast.budget.get(key) ?? D(0);
    const raw = flight.raw.min(cast.power.mul(D('2.5')).sub(used).max(D(0)));
    cast.budget.set(key, used.add(raw));
    return this.damage(raw, now, { target, basic: true })[0]
      .concat(this._buff(346201, now, target.id));
  }

  _flight(flight, now) {
    if (flight.template === 346401) {
      return piercingStep(this, flight, now, (f, t, n) => this._pellet(f, t, n), { pierce: false });
    }
    if (flight.template !== 346301) return super._flight(flight, now);
    const start = pointAt(flight.start, flight.end,
      (flight.previous - flight.begin) / (flight.finish - flight.begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
    const contacts = [];
    for (const target of enemies(this)) {
      const hit = actorContact(start, end, target, flight.previous, now);
      if (hit !== null) contacts.push([hit, target.id, target]);
    }
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (contacts.length) {
      const [hit, , target] = contacts[0];
      if (this.projectileBlocked(target, now)) return [scene({ expiredBullets: [flight.id] })];
      const pos = pointAt(start, end, hit).map(pyRound);
      const ratio = D(String(Math.hypot(flight.start[0] - pos[0], flight.start[1] - pos[1])))
        .div(D(840)).min(D(1));
      const raw = flight.raw.mul(D('2.03').add(D('3.15').mul(ratio)));
      const [ident, packet] = this.addObject(346302, pos);
      this._queue(now + 2000, 'object_expire', ident);
      const packets = [packet, scene({ blownBullets: [flight.id] })];
      for (const enemy of enemies(this, { area: true })) {
        if (Math.hypot(pos[0] - enemy.positionAt(now)[0], pos[1] - enemy.positionAt(now)[1]) <= 120) {
          packets.push(...this.damage(raw, now, { target: enemy })[0]);
          packets.push(...this._buff(346303, now, enemy.id));
        }
      }
      return packets;
    }
    if (now >= flight.finish) return [scene({ expiredBullets: [flight.id] })];
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return [];
  }

  _event(now, kind, data) {
    if (kind === 'apoc_reload') {
      if (!this.alive || this.generation !== data[0]) return [];
      this._queue(now + 3000, kind, this.generation);
      return this._buff(346121, now);
    }
    if (kind === 'apoc_heal') {
      return this.alive && this.generation === data[0]
        ? this.restoreHp(this.maxHp.mul(D('.04')), now) : [];
    }
    if (kind === 'apoc_burst') {
      const [cast] = data;
      if (!this.alive || this.generation !== cast.generation
        || this.blocked('attack', now) || this.skillSealed(0, now)) return [];
      const start = this.positionAt(now);
      const dest = [start[0] + cast.direction[0], start[1] + cast.direction[1]];
      return this.shoot(346100, start, dest, now, cast.power.mul(D('1.5')), {
        school: 'physical', basic: true, speed_multiplier: 1.5, proc: true,
      });
    }
    if (kind === 'apoc_cast') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.generation !== cast.generation) return [];
      this.ready = null;
      const start = this.positionAt(now), dest = cast.dest;
      const packets = this.syncSpeed(now);
      this.burst_count = 2;
      packets.push(...this._buff(346131, now), ...this._buff(346132, now));
      if (cast.slot === 1) {
        packets.push(scene({ skills: [this._skillEvent(346201, start, dest)] }));
        for (const target of enemies(this, { area: true })) {
          if (inStrip(target.positionAt(now), start, dest, 480, 72)) {
            packets.push(...this.damage(cast.power.mul(D('1.5')), now, { target })[0]);
            packets.push(...this._buff(346203, now, target.id));
          }
        }
        packets.push(...this._buff(346204, now));
      } else if (cast.slot === 10) {
        for (const target of enemies(this, { area: true })) {
          const tpos = target.positionAt(now);
          if (inCone(tpos, start, dest, 168, 30) && !target.ccImmune(now)) {
            const [pos, stopped] = prepareDisplacement(target, now, { interrupt: false });
            packets.push(...stopped);
            const pushed = aimed(start, pos,
              Math.hypot(start[0] - pos[0], start[1] - pos[1]) + 240, { fixed: true });
            // BEAT_BACK1 keeps the victim's facing and is forced on clients.
            target._setMotion(pos, target.arena.clipMotion(pos, pushed, now), 720, now, 1);
            target.forcedUntil = target.motion[3];
            packets.push(scene({ moves: [target._moveEvent(target.motion[1], 720, 1)] }));
          }
        }
        const angle = Math.atan2(dest[1] - start[1], dest[0] - start[0]);
        for (const degree of [-15, -7.5, 0, 7.5, 15]) {
          const endpoint = [
            pyRound(start[0] + 600 * Math.cos(angle + degree * Math.PI / 180)),
            pyRound(start[1] + 600 * Math.sin(angle + degree * Math.PI / 180)),
          ];
          packets.push(...this.shoot(346401, start, endpoint, now, cast.power.mul(D('1.6')), {
            school: 'physical', basic: true, through_walls: true, context: cast,
          }));
        }
      } else {
        packets.push(...this.shoot(346301, start, dest, now, cast.power, {
          school: 'physical', through_walls: true,
        }));
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || (start[0] === dest[0] && start[1] === dest[1])
      || this.blocked('attack', now) || this.skillSealed(slot, now)
      || now < this.cooldowns[slot]) return [];
    const power = this.combatStat('iAttack', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 6000, 2: 25000, 10: 8000 }[slot], slot);
    if (slot === 0) {
      const packets = this.shoot(346100, start, dest, now, power.mul(D('1.5')), {
        school: 'physical', basic: true, speed_multiplier: 1.5,
      });
      let burst = false;
      if (this.hasBuff(346131, now) && this.burst_count) {
        this.burst_count -= 1;
        burst = true;
        if (!this.burst_count) {
          packets.push(...this.removeBuff(346131, now), ...this.removeBuff(346132, now));
        }
      } else if (this.hasBuff(346121, now)) {
        burst = true;
        packets.push(...this.removeBuff(346121, now));
      }
      if (burst) {
        const cast = {
          power, direction: [dest[0] - start[0], dest[1] - start[1]], generation: this.generation,
        };
        for (const delay of [100, 200]) this._queue(now + delay, 'apoc_burst', cast);
      }
      return packets.concat([this._cooldown(0)]);
    }
    const [body, stopped] = prepareDisplacement(this, now, {
      interrupt: false, cancelMotion: true,
    });
    this.position = stopped.length ? body : start;
    this.motion = null;
    this.ready = {
      slot, skill: SLOTS[slot], dest, power, generation: this.generation, budget: new Map(),
    };
    this._queue(now + 100, 'apoc_cast', this.ready);
    return [scene({ skills: [this._skillEvent(SLOTS[slot], start, dest, 0, { ready: 1 })] }),
      this._cooldown(slot)].concat(this.syncSpeed(now), stopped);
  }
}

export { SLOTS as APOCALYPSE_SLOTS };
