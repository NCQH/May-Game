/* Aquaman (tank 10000110): third-shot current, whirlpool, charged burst.
 * Port of server/aquaman_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. Shield decay edits the 385315 shield entry.
 */
import { TankActions } from '../arena.js';
import { D, quantize } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, inCone, packII, piercingStep, prepareDisplacement } from './melee.js';
import { powD } from './batch-c-common.js';

const SLOTS = { 0: 385100, 1: 385201, 2: 385301, 10: 385401 };
const CHARGE = [385311, 385312, 385313, 385314, 385316];

export class AquamanActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = 100;
    this.shots = 0;
    this.ready = this.dash = this.r_window = null;
  }

  _skill(slot) {
    if (slot === 0 && this.shots === 2) return 385111;
    if (slot === 2 && this.ready) return 385321;
    if (slot === 10 && this.r_window) return 385401 + 10 * this.r_window.phase;
    return SLOTS[slot];
  }

  _cooldown(slot, changed = false) {
    const info = {
      skillId: this._skill(slot), slot, count: -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _resource(delta) {
    if (this.noel_box) return [];
    const old = this.mp;
    this.mp = Math.max(0, Math.min(100, this.mp + delta));
    return old !== this.mp ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  on_spawn(now) {
    this.mp = 100;
    this.shots = 0;
    this.ready = this.dash = this.r_window = null;
    this._queue(now + 3000, 'aqua_energy', this.generation);
    return [scene({ mp: [{ objectId: this.id, mp: 100 }] })].concat(
      Object.keys(SLOTS).map(Number).map(slot => this._cooldown(slot, true)));
  }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  _basicHit(flight, target, now) {
    const packets = this.damage(flight.raw, now, { target, basic: true })[0];
    const current = this.alive && this.generation === flight.source_generation;
    if (flight.template === 385111) {
      packets.push(...this._buff(385112, now, target.id));
      if (current) packets.push(...this.restoreHp(this.maxHp.mul(D('.03')), now));
    }
    if (current) packets.push(...this._resource(5));
    return packets;
  }

  _flight(flight, now) {
    return piercingStep(this, flight, now, (f, t, n) => this._basicHit(f, t, n),
      { pierce: flight.template === 385111 });
  }

  _endR(now) {
    this.r_window = null;
    this.cooldowns[10] = now + this.skillCooldown(8000, 10);
    return this.removeBuff(385402, now).concat(this.removeBuff(385412, now),
      [this._cooldown(10, true), this._cooldown(10)]);
  }

  _release(now) {
    const cast = this.ready;
    this.ready = null;
    if (!cast) return [];
    const packets = [];
    for (const template of CHARGE) packets.push(...this.removeBuff(template, now));
    const ratio = D(now - cast.begin).div(D(3000)).min(D(1));
    const radius = D(120).add(D(240).mul(ratio));
    const pos = this.positionAt(now);
    packets.push(scene({ skills: [this._skillEvent(385301, pos, pos)] }));
    for (const target of enemies(this, { area: true })) {
      if ([20006, 20017, 353201].includes(Number(target.info.npc_template))) continue;
      const span = Math.hypot(pos[0] - target.positionAt(now)[0],
        pos[1] - target.positionAt(now)[1]);
      if (D(String(span)).gt(radius)) continue;
      packets.push(...this.damage(cast.power.mul(D('1.145')).mul(
        D(1).add(ratio)), now, { target })[0]);
      packets.push(...this._buff(385302, now, target.id),
        ...this._buff(385303, now, target.id));
    }
    return packets.concat([this._cooldown(2, true), this._cooldown(2)], this.syncSpeed(now));
  }

  interrupt(now) {
    const packets = [];
    if (this.ready && !this.alive) {
      this.ready = null;
      for (const template of CHARGE) packets.push(...this.removeBuff(template, now));
      packets.push(this._cooldown(2, true));
    }
    if (this.dash) {
      this.dash = null;
      this.forcedUntil = now;
      this.position = this.stopPosition(now);
      this.motion = null;
      packets.push(...this.removeBuff(385202, now));
      packets.push(scene({ moves: [this._moveEvent(this.position, 0, 5)] }));
    }
    if (!this.alive && this.r_window) packets.push(...this._endR(now));
    return packets.concat(this.syncSpeed(now));
  }

  onControl(source, template, now) {
    const kind = this.arena.data.tableRow('BuffTemplate_table.xml',
      { nBuffId: template }).get('nEffectType');
    return ['30', '35', '66'].includes(kind) ? this.interrupt(now) : [];
  }

  _event(now, kind, data) {
    if (kind === 'aqua_energy') {
      if (!this.alive || this.generation !== data[0]) return [];
      this._queue(now + 3000, kind, ...data);
      return this._resource(5);
    }
    if (kind === 'aqua_land') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive || this.generation !== cast.generation) return [];
      const pos = this.positionAt(now);
      const [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      this.position = body;
      this.motion = null;
      this.dash = null;
      this.forcedUntil = now;
      const packets = this.removeBuff(385202, now).concat(stopped, [
        scene({ skills: [this._skillEvent(385211, pos, pos)] }),
      ]);
      for (const target of enemies(this, { area: true })) {
        if (Math.hypot(pos[0] - target.positionAt(now)[0],
          pos[1] - target.positionAt(now)[1]) <= 168) {
          packets.push(...this.damage(cast.power.mul(D('1.35')), now, { target })[0]);
        }
      }
      const [ident, packet] = this.addObject(385212, pos);
      packets.push(packet);
      packets.push(...this._buff(385213, now));
      this._queue(now + 1000, 'aqua_whirl', {
        pos, id: ident, power: cast.power, generation: cast.generation,
      });
      return packets;
    }
    if (kind === 'aqua_whirl') {
      const [cast] = data;
      const packets = this.removeObject(cast.id, { destroyed: true });
      for (const target of enemies(this, { area: true })) {
        if (Math.hypot(cast.pos[0] - target.positionAt(now)[0],
          cast.pos[1] - target.positionAt(now)[1]) > 168) continue;
        packets.push(...this.damage(cast.power.mul(D('1.87')), now, { target })[0]);
        if (this.arena.pk && this.arena.pk.finished) return packets;
        if (target.alive && !target.ccImmune(now) && !target.effectBlocked()) {
          const origin = target.positionAt(now);
          const [body, stopped] = prepareDisplacement(target, now, { interrupt: false });
          packets.push(...stopped);
          target.position = target.moveDestination(body, cast.pos);
          target.motion = null;
          packets.push(scene({ moves: [target._moveEvent(target.position, 0, 5)] }));
        }
        packets.push(...this._buff(385223, now, target.id));
      }
      return packets;
    }
    if (kind === 'aqua_r_end') return this.r_window === data[0] ? this._endR(now) : [];
    if (kind === 'aqua_release') return this.ready === data[0] && this.alive ? this._release(now) : [];
    if (kind === 'aqua_decay') {
      const [generation, version, amount] = data;
      if (this.generation !== generation || !this.alive
        || this.buffVersions.get(385315) !== version) return [];
      const shield = this.shields.find(entry => entry.shield_id === '385315');
      if (!shield) return [];
      const value = quantize(shield.remaining.sub(amount).max(D(0)));
      if (!value.gt(0)) {
        return this.removeBuff(385315, now).concat([this.shieldPacket(now)]);
      }
      this.shields = this.shields.map(entry => (entry === shield
        ? { ...entry, remaining: value } : entry));
      return [this.shieldPacket(now)];
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, targetId, now) {
    if (this.ready && slot === 2 && this.alive && now - this.ready.begin >= 750) {
      return this._release(now);
    }
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || now < this.cooldowns[slot]) return [];
    if ([0, 1, 10].includes(slot) && start[0] === dest[0] && start[1] === dest[1]) return [];
    const follow = slot === 10 && this.r_window;
    const cost = { 0: 0, 1: 20, 2: 60, 10: follow ? 0 : 30 }[slot];
    if (this.mp < cost) return [];
    const packets = this._resource(-cost);
    const power = this.combatStat('iAttack', now);
    let correction = [];
    if (slot === 0) {
      const template = this._skill(0);
      this.shots = (this.shots + 1) % 3;
      this.cooldowns[0] = now + this.fireInterval(now);
      if (template === 385111) packets.push(...this.removeBuff(385121, now),
        ...this.removeBuff(385122, now));
      packets.push(...this.shoot(template, start, dest, now,
        template === 385111 ? power.mul(D('1.5')) : power, {
          school: 'physical', basic: true, through_walls: template === 385111,
        }));
      if (this.shots === 2) packets.push(...this._buff(385121, now, null, { duration: -1 }));
      return packets.concat([this._cooldown(0, true), this._cooldown(0)]);
    }
    if (slot === 1) {
      this.cooldowns[1] = now + this.skillCooldown(8000, 1);
      const intended = aimed(start, dest, 480, { fixed: true });
      let body, stopped;
      [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      if (!stopped.length) body = start;
      const duration = this._setMotion(body, intended, 960, now, 3);
      this.forcedUntil = now + duration;
      this.dash = { generation: this.generation, power, end: now + duration, begin: now };
      packets.push(...this._buff(385202, now, null, { duration }));
      packets.push(...stopped);
      packets.push(scene({
        moves: [this._moveEvent(this.motion[1], 960, 3)],
        skills: [this._skillEvent(385201, start, this.motion[1])],
      }));
      this._queue(now + duration, 'aqua_land', this.dash);
    } else if (slot === 10) {
      const phase = follow ? follow.phase : 0;
      if (follow) packets.push(...this.removeBuff(385402, now), ...this.removeBuff(385412, now));
      packets.push(scene({ skills: [this._skillEvent(385401 + phase * 10, start, dest)] }));
      let hit = false;
      for (const target of enemies(this, { area: true })) {
        const pos = target.positionAt(now);
        if (!inCone(pos, start, dest, phase === 2 ? 192 : 168, 180)) continue;
        const [result, lost] = this.damage(power.mul(D('1.01')).mul(powD(D('1.25'), phase)),
          now, { target });
        packets.push(...result);
        if (this.arena.pk && this.arena.pk.finished) return packets;
        if (lost) {
          hit = true;
          packets.push(...this.restoreHp(this.maxHp.sub(this.hp).mul(
            phase === 2 ? D('.1') : D('.05')), now));
          packets.push(...this._resource(phase === 2 ? 20 : 10));
          for (const s of [1, 2]) {
            this.cooldowns[s] = now + pyRoundNumber(Math.max(0, this.cooldowns[s] - now) * 0.9);
            packets.push(this._cooldown(s));
          }
        }
        if (phase === 2) packets.push(...this._buff(385423, now, target.id));
        else if (target.alive && !target.ccImmune(now)) {
          const [pos2, stopped] = prepareDisplacement(target, now, { interrupt: false });
          packets.push(...stopped);
          const end = [pos2[0] + dest[0] - start[0], pos2[1] + dest[1] - start[1]];
          const duration = target._setMotion(pos2, aimed(pos2, end, 36, { fixed: true }),
            240, now, 1);
          target.forcedUntil = now + duration;
          packets.push(scene({ moves: [target._moveEvent(target.motion[1], 240, 1)] }));
        }
      }
      const intended = aimed(start, dest, 36, { fixed: true });
      let body, stopped;
      [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      if (!stopped.length) body = start;
      const duration = this._setMotion(body, intended, 240, now, 3);
      packets.push(...stopped);
      this.forcedUntil = now + duration;
      packets.push(scene({ moves: [this._moveEvent(this.motion[1], 240, 3)] }));
      if (hit && phase < 2) {
        this.r_window = { phase: phase + 1, end: now + 3000 };
        this.cooldowns[10] = now + 500;
        packets.push(...this._buff(phase === 0 ? 385402 : 385412, now),
          ...this._buff(385408, now));
        this._queue(now + 3000, 'aqua_r_end', this.r_window);
        packets.push(this._cooldown(10, true));
      } else packets.push(...this._endR(now));
    } else {
      this.cooldowns[2] = now + this.skillCooldown(15000, 2);
      let body;
      [body, correction] = prepareDisplacement(this, now, { interrupt: false });
      this.position = correction.length ? body : start;
      this.motion = null;
      this.ready = { slot: 2, skill: 385301, begin: now, power, dest: start,
        generation: this.generation };
      for (const template of CHARGE) packets.push(...this._buff(template, now));
      const previousVersion = this.buffVersions.get(385315);
      packets.push(...this.addShield(385315, this.maxHp, now));
      if (this.hasBuff(385315, now) && this.buffVersions.get(385315) !== previousVersion) {
        for (let delay = 250; delay <= 5000; delay += 250) {
          this._queue(now + delay, 'aqua_decay', this.generation,
            this.buffVersions.get(385315), this.maxHp.mul(D('.05')));
        }
      }
      this._queue(now + 3000, 'aqua_release', this.ready);
      packets.push(scene({ skills: [this._skillEvent(385301, start, start, 0, { ready: 1 })] }));
      packets.push(this._cooldown(2, true));
      packets.push(...this.syncSpeed(now));
    }
    return packets.concat([this._cooldown(slot)], correction);
  }
}

function pyRoundNumber(value) { return Math.floor(value + 0.5); }

export { SLOTS as AQUAMAN_SLOTS, CHARGE as AQUAMAN_CHARGE };
