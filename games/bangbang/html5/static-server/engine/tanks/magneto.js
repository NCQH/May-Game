/* Magneto (tank 10000097): lift/land combo, R storm and explicit global storm
 * policy. Port of server/magneto_actions.py.
 *
 * Stubs: presentation/skin only. arena.rng is a function, so random.choice is
 * emulated with `choose`.
 */
import { TankActions } from '../arena.js';
import { D, rectContact } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';
import { enemies, packII, prepareDisplacement } from './melee.js';
import { choose } from './batch-f2-common.js';

const SLOTS = { 0: 372100, 1: 372201, 2: 372301, 10: 372401 };

export class MagnetoActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = null;
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    })];
  }

  on_spawn(now) {
    this.ready = null;
    return this._buff(372101, now);
  }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  interrupt(now) {
    if (!this.ready) return [];
    this.ready = null;
    return [[1583, packII(this.id, 372401)]].concat(this.syncSpeed(now));
  }

  update(now) {
    const packets = this.ready && this.skillSealed(10, now) ? this.interrupt(now) : [];
    return packets.concat(super.update(now));
  }

  _skill_hit(target, raw, now, generation, school = 'energy') {
    const [packets, hit] = this.damage(raw, now, { target, school, source_generation: generation });
    if (this.arena.pk && this.arena.pk.finished) return packets;
    if (hit && this.alive && this.generation === generation) {
      packets.push(...this._buff(372102, now), ...this._buff(372103, now));
    }
    return packets;
  }

  _area_targets(pos, radius, now) {
    return enemies(this, { area: true }).filter(target => {
      const tpos = target.positionAt(now);
      return Math.hypot(pos[0] - tpos[0], pos[1] - tpos[1]) <= radius
        && rectContact(pos, tpos, this.arena.waterRects(now), 0) === null;
    });
  }

  _object(template, pos, now, duration) {
    const [ident, packet] = this.addObject(template, pos);
    this._queue(now + duration, 'object_expire', ident);
    return [packet];
  }

  _event(now, kind, data) {
    if (kind === 'magneto_visual_remove') {
      // Presentation-only native prop 372403 has its SWF on ITEM_REMOVE.
      return this.removeObject(data[0], { destroyed: true });
    }
    if (kind === 'magneto_e_lift') {
      const [cast] = data;
      const targets = this._area_targets(cast.pos, 108, now);
      cast.targets = targets.map(target => [target.id, target.generation]);
      cast.lifted = new Set();
      const packets = [];
      for (const target of targets) {
        packets.push(...this._buff(372202, now, target.id));
        if (this.arena.pk && this.arena.pk.finished) return packets;
        if (target.hasBuff(372202, now)) {
          cast.lifted.add(`${target.id},${target.generation}`);
          packets.push(...this._buff(372204, now, target.id, { duration: 1500 }));
        }
      }
      this._queue(now + 1500, 'magneto_e_land', cast);
      return packets;
    }
    if (kind === 'magneto_e_land') {
      const [cast] = data;
      const lifted = [];
      for (const [id, generation] of cast.targets) {
        const actor = this.arena.actors.get(id);
        if (actor && actor.alive && actor.generation === generation) lifted.push(actor);
      }
      const direct = new Set(lifted.map(a => `${a.id},${a.generation}`));
      const victims = new Map(lifted.map(a => [a.id, a]));
      const packets = [];
      for (const target of lifted) {
        if (!cast.lifted.has(`${target.id},${target.generation}`)) continue;
        const pos = target.positionAt(now);
        packets.push(...this._buff(372206, now, target.id),
          ...this._object(372209, pos, now, 400));
        for (const other of this._area_targets(pos, 108, now)) {
          if (!other.info.npc_template) victims.set(other.id, other);
        }
      }
      for (const target of victims.values()) {
        packets.push(...this._skill_hit(target, cast.power.mul(D('1.9')), now, cast.generation));
        if (this.arena.pk && this.arena.pk.finished) return packets;
        if (!direct.has(`${target.id},${target.generation}`)) {
          packets.push(...this._buff(372207, now, target.id));
        }
      }
      return packets;
    }
    if (kind === 'magneto_r_ready') {
      const [cast] = data;
      if (this.ready !== cast) return [];
      if (!this.alive || this.skillSealed(10, now)) return this.interrupt(now);
      this.ready = null;
      const packets = this.syncSpeed(now).concat([
        scene({ skills: [this._skillEvent(372401, this.positionAt(now), cast.pos)] }),
      ]);
      const [visual, packet] = this.addObject(372403, cast.pos);
      packets.push(packet);
      this._queue(now + 100, 'magneto_visual_remove', visual);
      for (const [template, delay] of [[372401, 700], [372402, 1300]]) {
        packets.push(...this._object(template, cast.pos, now, delay));
        this._queue(now + delay, 'magneto_r_hit', cast, template);
      }
      return packets;
    }
    if (kind === 'magneto_r_hit') {
      const [cast, template] = data;
      const packets = [];
      for (const target of this._area_targets(cast.pos, 144, now)) {
        const key = `${target.id},${target.generation}`;
        packets.push(...this._skill_hit(target,
          cast.power.mul(D(template === 372401 ? '1.24' : '1.83')), now, cast.generation));
        if (this.arena.pk && this.arena.pk.finished) return packets;
        if (template === 372401) cast.hits.add(key);
        else if (cast.hits.has(key)) {
          packets.push(...this._skill_hit(target, target.maxHp.mul(D('.1')), now,
            cast.generation, 'true'));
          if (this.arena.pk && this.arena.pk.finished) return packets;
        }
      }
      return packets;
    }
    if (kind === 'magneto_storm') {
      const [cast, tick] = data;
      if (!this.alive || this.generation !== cast.generation) return [];
      // User retains map-wide hits on invisible tanks; stasis still protects.
      const targets = [...this.arena.actors.values()].filter(a => a.alive
        && a.camp !== this.camp && !a.info.npc_template && !a.inStasis()
        && (!a.info.untargetable || a.buffTypes(now).has(26)));
      const pos = this.positionAt(now);
      const close = targets.filter(a => {
        const tpos = a.positionAt(now);
        return Math.hypot(pos[0] - tpos[0], pos[1] - tpos[1]) <= 360;
      });
      const enhanced = close.length ? choose(this.arena.rng, close) : null;
      const packets = [];
      for (const target of targets) {
        packets.push(...this._skill_hit(target,
          cast.power.mul(target === enhanced ? D('1.5') : D('.25')), now, cast.generation));
        if (this.arena.pk && this.arena.pk.finished) return packets;
        packets.push(...this._buff((target === enhanced ? 372316 : 372306) + ((tick - 1) % 3),
          now, target.id));
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (this.arena.pk && this.arena.pk.finished) return [];
    if (!(slot in SLOTS) || this.blocked('attack', now)
      || this.skillSealed(slot, now) || this.cooldowns[slot] > now) return [];
    if ([0, 1, 10].includes(slot) && (!this._inside(dest)
      || (slot === 0 && start[0] === dest[0] && start[1] === dest[1]))) return [];
    if ([1, 10].includes(slot)
      && Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 600) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + (slot === 0 ? this.fireInterval(now)
      : this.skillCooldown({ 1: 8000, 2: 30000, 10: 6000 }[slot], slot));
    const packets = [this._cooldown(slot)];
    if (slot === 0) {
      return packets.concat(this.shoot(372100, start, dest, now, power, {
        school: 'energy', basic: true,
      }));
    }
    const cast = {
      pos: dest, dest, slot, power, generation: this.generation, hits: new Set(),
    };
    if (slot === 10) {
      const [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      packets.push(...stopped);
      this.position = body;
      this.motion = null;
      this.ready = cast;
      this._queue(now + 300, 'magneto_r_ready', cast);
      return packets.concat([
        scene({ skills: [this._skillEvent(372401, start, dest, 0, { ready: 1 })] }),
      ], this.syncSpeed(now));
    }
    packets.push(scene({ skills: [this._skillEvent(SLOTS[slot], start, dest)] }));
    if (slot === 1) {
      packets.push(...this._object(372201, dest, now, 700));
      this._queue(now + 700, 'magneto_e_lift', cast);
    } else {
      packets.push(...this._buff(372301, now), ...this._buff(372302, now));
      for (let tick = 1; tick <= 8; tick += 1) {
        this._queue(now + 750 * tick, 'magneto_storm', cast, tick);
      }
    }
    return packets;
  }
}

export { SLOTS as MAGNETO_SLOTS };
