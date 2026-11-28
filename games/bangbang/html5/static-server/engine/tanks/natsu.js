/* Natsu (tank 10000090): three-stage passive, cone flame, dash and aura.
 * Port of server/natsu_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. Stored stages are the passive stack display and
 * cooldown refund; enhanced E/R switch to the native 3655xx/3656xx skills.
 */
import { TankActions } from '../arena.js';
import { D, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { packII, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 365100, 1: 365201, 2: 365401, 10: 365301 };
const STAGES = [[365102, 365103], [365104, 365105], [365106, 365107]];
const AURA_BUFFS = [365402, 365403, 365404, 365405, 365406, 365407];

export class NatsuActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.power_stacks = 0;
    this.ready = this.dash = this.aura = null;
  }

  _slot(slot) {
    if ((slot === 1 || slot === 10)
      && this.hasBuff(slot === 1 ? 365405 : 365406, this.clock())) {
      return slot === 1 ? 365501 : 365601;
    }
    return SLOTS[slot];
  }

  _cooldown(slot, changed = false) {
    const info = { skillId: this._slot(slot), slot, count: -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: 0 };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _slots() {
    return [1, 10].flatMap(slot => [this._cooldown(slot, true), this._cooldown(slot)]);
  }

  on_spawn(now) { return this._buff(365101, now).concat(this._slots()); }

  on_death() { this.power_stacks = 0; this.aura = null; }

  blocked(action, now) {
    return super.blocked(action, now) || this.ready !== null || this.dash !== null;
  }

  _speed(now) { return this.ready || this.dash ? 0 : super._speed(now); }

  removeBuff(template, now, { expired = false } = {}) {
    const existed = this.activeBuffs.has(`${this.id},${template}`);
    const packets = super.removeBuff(template, now, { expired });
    if (existed && (template === 365405 || template === 365406)) {
      const slot = template === 365405 ? 1 : 10;
      packets.push(this._cooldown(slot, true), this._cooldown(slot));
    }
    return packets;
  }

  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  _passive(slot, now) {
    const packets = [];
    for (const templates of STAGES) {
      for (const template of templates) {
        if (this.activeBuffs.has(`${this.id},${template}`)) packets.push(...this.removeBuff(template, now));
      }
    }
    if (this.power_stacks === 3) {
      this.power_stacks = 0;
      packets.push(...this.removeBuff(365108, now));
      this.cooldowns[slot] = Math.max(now, this.cooldowns[slot] - 6000);
      packets.push(...this._buff(365109, now), ...this._buff(365110, now));
    } else {
      this.power_stacks += 1;
      for (const template of STAGES[this.power_stacks - 1]) packets.push(...this._buff(template, now));
      if (this.power_stacks === 3) packets.push(...this._buff(365108, now));
    }
    return packets;
  }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      packets.push([1583, packII(this.id, this.ready.skill)]);
      this.ready = null;
    }
    if (this.dash) {
      const template = this.dash.buff;
      this.dash = null;
      this.position = this.positionAt(now);
      this.motion = null;
      this.forcedUntil = now;
      packets.push(...this.removeBuff(template, now));
    }
    return packets.concat(this.syncSpeed(now));
  }

  _enemies(center, radius, now) {
    return [...this.arena.actors.values()].filter(a => a.alive && a.camp !== this.camp
      && a.isAreaTargetable()
      && Math.hypot(center[0] - a.positionAt(now)[0], center[1] - a.positionAt(now)[1]) <= radius);
  }

  _event(now, kind, data) {
    if (kind === 'natsu_flame') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.generation !== cast.generation) return [];
      this.ready = null;
      const center = this.positionAt(now);
      const packets = this.syncSpeed(now).concat([scene({
        skills: [this._skillEvent(cast.skill, center, cast.dest)],
      })]);
      const enhanced = cast.enhanced;
      const radius = enhanced ? 528 : 480;
      const length = Math.hypot(center[0] - cast.dest[0], center[1] - cast.dest[1]);
      if (!length) return packets;
      const direction = [(cast.dest[0] - center[0]) / length, (cast.dest[1] - center[1]) / length];
      for (const target of this._enemies(center, radius + 36, now)) {
        const pos = target.positionAt(now);
        const dx = pos[0] - center[0], dy = pos[1] - center[1];
        const along = dx * direction[0] + dy * direction[1];
        const across = Math.abs(dx * direction[1] - dy * direction[0]);
        const span = Math.hypot(dx, dy);
        const contact = enhanced
          ? span <= 528 && along >= span * Math.cos(22.5 * Math.PI / 180)
          : along >= 0 && along <= 480 && across <= 48 + 36;
        if (!contact) continue;
        packets.push(...this.damage(cast.power.mul(D(enhanced ? '1.66' : '1.28')), now, {
          target, school: 'energy', lifesteal: enhanced ? D('.3') : D(0),
        })[0]);
        packets.push(...this._buff(365202, now, target.id));
        if (enhanced) packets.push(...this._buff(365503, now, target.id));
      }
      return packets;
    }
    if (kind === 'natsu_arrive') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive || this.generation !== cast.generation) return [];
      this.dash = null;
      const center = this.positionAt(now);
      this.position = center;
      this.motion = null;
      this.forcedUntil = now;
      const packets = this.removeBuff(cast.buff, now).concat(this.syncSpeed(now));
      const enhanced = cast.enhanced;
      const targets = this._enemies(center, enhanced ? 240 : 192, now)
        .map(target => [target, target.maxHp.sub(target.hp)]);
      for (const [target, missing] of targets) {
        // One logical impact: snapshot missing HP before both packets.
        packets.push(...this.damage(cast.power.mul(D(enhanced ? '2.29' : '1.76')), now, {
          target, school: 'energy', lifesteal: enhanced ? D('.3') : D(0),
        })[0]);
        if (enhanced && target.alive) {
          packets.push(...this.damage(missing.mul(D('.06')), now,
            { target, school: 'true' })[0]);
        }
      }
      for (const template of enhanced ? [365604, 365303] : [365303, 365304, 365305]) {
        packets.push(...this._buff(template, now));
      }
      return packets;
    }
    if (kind === 'natsu_aura') {
      const [cast, index] = data;
      if (this.aura !== cast || !this.alive || this.generation !== cast.generation) return [];
      const center = this.positionAt(now);
      const packets = [scene({ skills: [this._skillEvent(365801, center, center, this.id)] })];
      for (const target of this._enemies(center, 240, now)) {
        const span = Math.hypot(center[0] - target.positionAt(now)[0],
          center[1] - target.positionAt(now)[1]);
        packets.push(...this.damage(cast.power.mul(span <= 120 ? D('.75') : D('.5')), now,
          { target, school: 'energy', periodic: true })[0]);
      }
      packets.push(...this.restoreHp(this.maxHp.sub(this.hp).mul(D('.03')), now));
      if (index === 16) this.aura = null;
      else this._queue(now + 500, kind, cast, index + 1);
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (slot !== 2 && (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1]))) return [];
    const power = this.combatStat('iEgAtk', now);
    const skill = this._slot(slot);
    const enhanced = skill === 365501 || skill === 365601;
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 6000, 2: 25000, 10: 8000 }[slot], slot);
    const packets = slot ? this._passive(slot, now) : [];
    if (slot === 0) {
      packets.push(...this.shoot(skill, start, dest, now, power,
        { school: 'energy', basic: true, power }));
    } else if (slot === 1) {
      this.ready = { slot: 1, skill, dest, power, generation: this.generation, enhanced };
      let [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      this.position = stopped.length ? body : start;
      this.motion = null;
      this._queue(now + 100, 'natsu_flame', this.ready);
      packets.push(scene({ skills: [this._skillEvent(skill, start, dest, 0, { ready: 1 })] }));
      packets.push(...this.syncSpeed(now), ...stopped);
    } else if (slot === 10) {
      const span = Math.hypot(start[0] - dest[0], start[1] - dest[1]);
      if (span > 336) dest = pointAt(start, dest, 336 / span).map(pyRound);
      let [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      body = stopped.length ? body : start;
      const duration = this._setMotion(body, dest, 600, now, 3);
      this.forcedUntil = now + duration;
      this.dash = {
        power, generation: this.generation, enhanced,
        buff: enhanced ? 365601 : 365301,
      };
      this._queue(now + duration, 'natsu_arrive', this.dash);
      packets.push(...this._buff(this.dash.buff, now, null, { duration }));
      packets.push(...stopped);
      packets.push(scene({ moves: [this._moveEvent(this.motion[1], 600, 3)] }));
      packets.push(...this.syncSpeed(now));
    } else {
      this.aura = { power, generation: this.generation, end: now + 8000 };
      for (const template of AURA_BUFFS) packets.push(...this._buff(template, now));
      packets.push(...this._slots());
      this._queue(now + 500, 'natsu_aura', this.aura, 1);
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as NATSU_SLOTS, STAGES as NATSU_STAGES, AURA_BUFFS as NATSU_AURA_BUFFS };
