/* Falcon (tank 10000104): ammo, precision armor reversal, marked blasts.
 * Port of server/falcon_actions.py onto the JS battle core.
 *
 * Stubs: presentation only; hidden-trap clearing is a guarded optional hook.
 */
import { TankActions } from '../arena.js';
import { D, ONE, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { prepareDisplacement } from './melee.js';

const SLOTS = { 0: 379100, 1: 379201, 2: 379301, 10: 379401 };

export class FalconActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = Number(this.stats.iMp);
    this.enhanced = this.precision_count = 0;
    this.reload = this.dash = null;
    this.marks = new Map();
  }

  _cooldown(slot, changed = false) {
    const skill = slot === 0 && this.enhanced ? 379211 : SLOTS[slot];
    const info = {
      skillId: skill, slot, count: -1, end: this.cooldowns[slot], nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _resource(delta) {
    if (this.noel_box) return [];
    const old = this.mp;
    this.mp = Math.max(0, Math.min(Number(this.stats.iMp), this.mp + delta));
    return old !== this.mp ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  on_spawn(now) {
    this.mp = Number(this.stats.iMp);
    this.reload = this.dash = null;
    this.enhanced = this.precision_count = 0;
    const packets = [];
    for (let t = 379101; t <= 379106; t += 1) packets.push(...this._buff(t, now));
    return packets.concat([this._cooldown(0, true),
      scene({ mp: [{ objectId: this.id, mp: this.mp }] })]);
  }

  attr_bonus(attributes, now) {
    let value = super.attrBonus(attributes, now);
    if (attributes.includes(5) || attributes.includes(28)) {
      value = value.add(D('.5').mul(ONE.sub(this.hp.div(this.maxHp))));
    }
    return value;
  }

  _reload(now) {
    if (this.reload || !this.alive || this.mp >= 10) return [];
    this.reload = { generation: this.generation };
    this._queue(now + 1000, 'falcon_reload', this.reload);
    return this._buff(379114, now);
  }

  interrupt(now) {
    if (!this.dash) return [];
    this.dash = null;
    const [, stopped] = prepareDisplacement(this, now,
      { interrupt: false, cancelMotion: true });
    return stopped.concat(this.removeBuff(379202, now), this.removeBuff(379207, now));
  }

  update(now) { return this._reload(now).concat(super.update(now)); }

  damage(raw, now, options = {}) {
    if (options.basic && this.hasBuff(379113, now)) options.inverse_armor = true;
    return super.damage(raw, now, options);
  }

  _precision(now) {
    const buff = this.precision_count
      ? [379111, 379121, 379122][this.precision_count - 1] : 0;
    if (buff && !this.hasBuff(buff, now)) this.precision_count = 0;
    const packets = [];
    for (const t of [379111, 379121, 379122]) packets.push(...this.removeBuff(t, now));
    this.precision_count += 1;
    if (this.precision_count === 4) {
      this.precision_count = 0;
      packets.push(...this._buff(379113, now));
    } else {
      packets.push(...this._buff([379111, 379121, 379122][this.precision_count - 1], now));
    }
    return packets;
  }

  on_bullet_hit(flight, target, now) {
    const current = this.alive && flight.source_generation === this.generation;
    if (flight.template === 379301) {
      const packets = this._buff(379302, now, target.id).concat(this._buff(379303, now, target.id));
      if (target.hasBuff(379302, now) && target.buffSources.get(379302) === this.id
        && target.hasBuff(379303, now) && target.buffSources.get(379303) === this.id) {
        this.marks.set(target.id, {
          target_generation: target.generation, generation: flight.source_generation,
          power: flight.power, version: target.buffVersions.get(379302), index: 0, end: now + 4000,
        });
      }
      return packets;
    }
    if (!flight.basic) return [];
    const packets = current ? this._precision(now) : [];
    // arena.rng is a function in the JS core (Python: arena.rng.random()).
    if (flight.template === 379211 && this.arena.rng() < 0.25) {
      packets.push(...this._buff(379212, now, target.id));
    }
    const mark = this.marks.get(target.id);
    if (mark && target.alive && mark.target_generation === target.generation && mark.end > now
      && target.hasBuff(379302, now) && target.buffVersions.get(379302) === mark.version
      && mark.index < 4 && flight.source_generation === mark.generation) {
      const index = mark.index;
      mark.index += 1;
      const pos = target.positionAt(now);
      const [ident, packet] = this.addObject(379321 + index, pos);
      packets.push(packet);
      this._queue(now + 400, 'falcon_explosion', {
        id: ident, pos, power: mark.power, index, generation: mark.generation,
      });
      packets.push(...target.removeBuff(index === 0 ? 379303 : 379310 + index, now));
      if (index < 3) {
        packets.push(...this._buff(379311 + index, now, target.id,
          { duration: mark.end - now }));
      }
    }
    return packets;
  }

  on_target_death(target, now) {
    this.marks.delete(target.id);
    return [];
  }

  _radar(cast, now) {
    const packets = [];
    for (const target of [...this.arena.actors.values()]) {
      if (target.camp !== this.camp && typeof target.clear_hidden_traps === 'function') {
        packets.push(...target.clear_hidden_traps(cast.pos, 192));
      }
      if (target.alive && target.camp !== this.camp
        && Math.hypot(cast.pos[0] - target.positionAt(now)[0],
          cast.pos[1] - target.positionAt(now)[1]) <= 192) {
        packets.push(...this._buff(379411, now, target.id), ...this._buff(379412, now, target.id));
      }
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'falcon_reload') {
      if (this.reload !== data[0] || !this.alive) return [];
      this.reload = null;
      return this._resource(100).concat(this.removeBuff(379114, now));
    }
    if (kind === 'falcon_dash') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive) return [];
      this.dash = this.reload = null;
      this.enhanced = 5;
      const packets = this._resource(100).concat(this.removeBuff(379114, now));
      for (const t of [379203, 379204, 379206]) packets.push(...this._buff(t, now));
      return packets.concat([this._cooldown(0, true), this._cooldown(0)], this.syncSpeed(now));
    }
    if (kind === 'falcon_radar') {
      const [cast] = data;
      const packets = this._radar(cast, now);
      if (now < cast.end) this._queue(Math.min(now + 250, cast.end), kind, cast);
      else packets.push(...this.removeObject(cast.id));
      return packets;
    }
    if (kind === 'falcon_explosion') {
      const [cast] = data;
      const packets = this.removeObject(cast.id);
      for (const target of [...this.arena.actors.values()]) {
        const span = Math.hypot(cast.pos[0] - target.positionAt(now)[0],
          cast.pos[1] - target.positionAt(now)[1]);
        if (target.alive && target.camp !== this.camp && span <= 192) {
          const raw = cast.power.mul(D('.75').add(D('.25').mul(D(cast.index))))
            .mul(ONE.sub(D('.5').mul(D(String(span)).div(D(192)))));
          packets.push(...this.damage(raw, now, { target, school: 'energy' })[0]);
        }
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (!this._inside(dest) || (slot !== 10 && start[0] === dest[0] && start[1] === dest[1])
      || (slot === 10 && Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 600)) return [];
    if (slot === 0 && this.mp < 10) return this._reload(now);
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown({
      0: this.fireInterval(now), 1: 6000, 2: 25000, 10: 8000,
    }[slot], slot);
    const packets = [];
    if (slot === 0) {
      const enhanced = this.enhanced > 0;
      const lifesteal = this.attrBonus([28], now).add(enhanced ? D('.5') : D(0));
      packets.push(...this.shoot(enhanced ? 379211 : 379100, start, dest, now, power, {
        school: 'energy', basic: true, speed_multiplier: 1.5, lifesteal, power,
      }));
      packets.push(...this._resource(-10));
      if (enhanced) {
        this.enhanced -= 1;
        if (!this.enhanced) {
          packets.push(...this.removeBuff(379203, now), ...this.removeBuff(379204, now),
            this._cooldown(0, true));
        }
      }
      packets.push(...this._reload(now));
    } else if (slot === 1) {
      const span = Math.hypot(dest[0] - start[0], dest[1] - start[1]);
      dest = pointAt(start, dest, Math.min(1, 336 / span));
      const [body, handoff] = prepareDisplacement(this, now, { interrupt: false });
      const origin = handoff.length ? body : start;
      const duration = this._setMotion(origin, dest, 720, now, 4);
      this.forcedUntil = now + duration;
      this.dash = { generation: this.generation };
      this._queue(now + 450, 'falcon_dash', this.dash);
      packets.push(...this._buff(379202, now), ...this._buff(379207, now), ...handoff);
      packets.push(scene({
        skills: [this._skillEvent(379201, start, this.motion[1])],
        moves: [this._moveEvent(this.motion[1], 720, 4)],
      }));
    } else if (slot === 2) {
      packets.push(...this.shoot(379301, start, dest, now, power.mul(D('1.57')),
        { school: 'energy', through_walls: true, power }));
    } else {
      const [ident, packet] = this.addObject(379402, dest);
      const cast = { id: ident, pos: dest, end: now + 5000, generation: this.generation };
      packets.push(packet, scene({ skills: [this._skillEvent(379401, start, dest)] }),
        ...this._radar(cast, now));
      this._queue(now + 250, 'falcon_radar', cast);
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as FALCON_SLOTS };
