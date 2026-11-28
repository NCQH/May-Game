/* Superman (tank 10000053): nearby-count auras, dash, throwdown.
 * Port of server/superman_actions.py onto the JS battle core.
 *
 * Stubs: no R slot in the native base template; S1578 is encoded locally
 * because protocol.js has no writer for it.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';
import { prepareDisplacement } from './melee.js';
import { encodeS1578, teamVisible } from './batch-c-common.js';

const SLOTS = { 0: 328100, 1: 328201, 2: 328301 };

export class SupermanActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    delete this.cooldowns[10];
    this.dash = null;
    this.nearby = 0;
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot], nextCharge: 0,
    })];
  }

  on_spawn(now) {
    this.nearby = 0;
    this._queue(now, 'superman_aura', this.generation);
    return this._buff(328131, now);
  }

  interrupt(now) {
    if (!this.dash) return [];
    this.dash = null;
    this.position = this.positionAt(now);
    this.motion = null;
    this.forcedUntil = now;
    return this.removeBuff(328212, now).concat(this.syncSpeed(now));
  }

  _event(now, kind, data) {
    if (kind === 'superman_aura') {
      if (!this.alive || data[0] !== this.generation) return [];
      const count = Math.min(5, [...this.arena.actors.values()].filter(a => a.alive
        && a.camp !== this.camp && !a.info.npc_template
        && Math.hypot(this.positionAt(now)[0] - a.positionAt(now)[0],
          this.positionAt(now)[1] - a.positionAt(now)[1]) <= 408).length);
      const packets = [];
      if (count !== this.nearby) {
        if (this.nearby) {
          for (const t of [328100 + this.nearby, 328110 + this.nearby, 328120 + this.nearby]) {
            packets.push(...this.removeBuff(t, now));
          }
        }
        this.nearby = count;
      }
      if (count) {
        for (const t of [328100 + count, 328110 + count, 328120 + count]) {
          packets.push(...this._buff(t, now));
        }
      }
      this._queue(now + 1000, kind, ...data);
      return packets;
    }
    if (kind === 'superman_dash') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive) return [];
      const start = this.positionAt(cast.previous), end = this.positionAt(now);
      const packets = [];
      for (const target of [...this.arena.actors.values()]) {
        const key = `${target.id},${target.generation}`;
        if (!target.alive || target.camp === this.camp || cast.hits.has(key)
          || target.isUntargetable()) continue;
        if (actorContact(start, end, target, cast.previous, now) === null) continue;
        cast.hits.add(key);
        packets.push(...this.damage(cast.power.mul(D('1.32')), now, { target })[0]);
        if (this.arena.pk && this.arena.pk.finished) break;
        const immune = target.ccImmune(now);
        packets.push(...this._buff(328222, now, target.id));
        if (target.alive && !immune) {
          const origin = target.positionAt(now);
          const dest = [origin[0] + cast.direction[0] * 72, origin[1] + cast.direction[1] * 72];
          const duration = target._setMotion(origin, dest, 480, now, 1);
          target.forcedUntil = now + duration;
          packets.push(scene({ moves: [target._moveEvent(target.motion[1], 480, 1)] }));
        }
        if (!target.info.npc_template) {
          cast.count = Math.min(4, cast.count + 1);
          for (let t = 328231; t <= 328235; t += 1) packets.push(...this.removeBuff(t, now));
          packets.push(...this._buff(328230 + cast.count, now));
        }
      }
      if (!this.motion || now >= this.motion[3]) {
        this.dash = null;
        packets.push(...this.removeBuff(328212, now));
      } else {
        cast.previous = now;
        this._queue(Math.min(now + 20, this.motion[3]), kind, cast);
      }
      return packets;
    }
    if (kind === 'superman_landing') {
      const [cast] = data;
      const packets = this.removeObject(cast.warning);
      const target = this.arena.actors.get(cast.target);
      if (!target || !target.alive || target.generation !== cast.target_generation) return packets;
      const pos = target.positionAt(now);
      packets.push(...this._buff(328304, now, target.id), ...this._buff(328307, now, target.id));
      for (const enemy of [...this.arena.actors.values()]) {
        if (enemy.alive && enemy.camp !== this.camp
          && Math.hypot(pos[0] - enemy.positionAt(now)[0], pos[1] - enemy.positionAt(now)[1]) <= 120) {
          packets.push(...this.damage(cast.power.mul(D('2.62')), now, { target: enemy })[0]);
          packets.push(...this._buff(328306, now, enemy.id));
        }
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (!this._inside(dest) || ((slot === 0 || slot === 1)
      && start[0] === dest[0] && start[1] === dest[1])) return [];
    let target;
    if (slot === 2) {
      const candidates = [...this.arena.actors.values()].filter(a => a.alive && a.camp !== this.camp
        && !a.isUntargetable()
        && Math.hypot(start[0] - a.positionAt(now)[0], start[1] - a.positionAt(now)[1]) <= 240
        && teamVisible(this, a, now));
      if (!candidates.length) return [];
      candidates.sort((a, b) => (Math.hypot(start[0] - a.positionAt(now)[0],
        start[1] - a.positionAt(now)[1]) - Math.hypot(start[0] - b.positionAt(now)[0],
        start[1] - b.positionAt(now)[1])) || (a.id - b.id));
      target = candidates[0];
    }
    const power = this.combatStat('iAttack', now);
    this.cooldowns[slot] = now + this.skillCooldown({
      0: this.fireInterval(now), 1: 6000, 2: 20000,
    }[slot], slot);
    if (slot === 0) {
      return this.shoot(328100, start, dest, now, power,
        { school: 'physical', basic: true }).concat([this._cooldown(0)]);
    }
    const packets = [this._cooldown(slot)];
    if (slot === 1) {
      const span = Math.hypot(dest[0] - start[0], dest[1] - start[1]);
      const direction = [(dest[0] - start[0]) / span, (dest[1] - start[1]) / span];
      const endpoint = pointAt(start, dest, Math.min(1, 480 / span));
      const [origin, stopped] = prepareDisplacement(this, now, { interrupt: false });
      const body = stopped.length ? origin : start;
      const duration = this._setMotion(body, endpoint, 600, now, 3);
      this.forcedUntil = now + duration;
      this.dash = {
        previous: now, generation: this.generation, power, hits: new Set(),
        count: 0, direction,
      };
      this._queue(Math.min(now + 20, this.motion[3]), 'superman_dash', this.dash);
      return packets.concat(this._buff(328212, now, null, { duration }), stopped, [
        scene({
          skills: [this._skillEvent(328201, start, this.motion[1])],
          moves: [this._moveEvent(this.motion[1], 600, 3)],
        }),
      ]);
    }
    const span = Math.hypot(start[0] - dest[0], start[1] - dest[1]);
    const desired = pointAt(start, dest, Math.min(1, 528 / Math.max(1, span)));
    let origin = target.positionAt(now);
    const immune = target.ccImmune(now);
    let stopped = [];
    if (!immune) [origin, stopped] = prepareDisplacement(target, now);
    const landing = immune ? origin : target.moveDestination(origin, desired);
    packets.push(scene({ skills: [this._skillEvent(328301, start, landing, target.id)] }));
    let duration = 0;
    if (!immune) {
      packets.push(...stopped);
      const speed = Math.max(1, Math.hypot(landing[0] - origin[0],
        landing[1] - origin[1]) * 1000 / 900);
      duration = target._setMotion(origin, landing, speed, now, 4);
      target.forcedUntil = now + duration;
      packets.push([1578, encodeS1578(target.id, origin, target.motion[1], pyRound(duration), 0)]);
    }
    const [warning, packet] = this.addObject(328311, landing);
    packets.push(packet, ...this.damage(power.mul(D('1.05')), now, { target })[0]);
    const cast = {
      target: target.id, target_generation: target.generation, power,
      generation: this.generation, warning, motion: duration ? target.motion : null,
    };
    packets.push(...this._buff(328303, now, target.id));
    this._queue(now + 1000, 'superman_landing', cast);
    return packets;
  }
}

export { SLOTS as SUPERMAN_SLOTS };
