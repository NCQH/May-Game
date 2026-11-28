/* Erlang / Duong Tien (tank 10000087): one travelling dog, three manual Space
 * phases and Q40 marks. Port of server/erlang_actions.py.
 *
 * Stubs: presentation/skin only; no visibility helper.
 */
import { TankActions } from '../arena.js';
import { D, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572, encodeS1579, moveEvent } from '../protocol.js';
import { enemies, inCone, packII, piercingStep } from './melee.js';
import { powD } from './batch-c-common.js';
import { flightPending, lastFlight } from './batch-f2-common.js';

const SLOTS = { 0: 361100, 1: 361201, 2: 361301, 10: 361401 };

export class ErlangActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.dog = this.ready = null;
    this.phase = 1;
    this.phase_end = 0;
    this.phase_gap = 0;
  }

  _cooldown(slot, changed = false) {
    let skill = SLOTS[slot], end = this.cooldowns[slot];
    if (slot === 1 && this.dog && this.hasBuff(361201, this.clock())) {
      skill = 361801; end = 0;
    }
    if (slot === 2 && this.phase > 1) {
      skill = { 2: 361601, 3: 361701 }[this.phase];
      end = this.phase_gap;
    }
    const info = { skillId: skill, slot, count: -1, end, nextCharge: 0 };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.dog = this.ready = null;
    this.phase = 1;
    this.phase_end = this.phase_gap = 0;
    return this._buff(361101, now).concat(this._buff(361102, now),
      [this._cooldown(1, true), this._cooldown(2, true)]);
  }

  interrupt(now) {
    const cast = this.ready;
    this.ready = null;
    if (cast && cast.slot === 2) {
      this.phase = 1;
      this.phase_end = 0;
      this.cooldowns[2] = now + 500;
      return this.removeBuff(361303, now).concat(this.removeBuff(361603, now), [
        [1583, packII(this.id, cast.skill)], this._cooldown(2, true), this._cooldown(2),
      ]);
    }
    return cast ? [[1583, packII(this.id, 361801)]] : [];
  }

  on_control(source, template, now) {
    const effect = Number(this.arena.data
      .tableRow('BuffTemplate_table.xml', { nBuffId: template }).get('nEffectType'));
    return this.ready && [30, 35, 66].includes(effect) ? this.interrupt(now) : [];
  }

  _drop_dog(now) {
    this.dog = null;
    return this.removeBuff(361201, now).concat([this._cooldown(1, true), this._cooldown(1)]);
  }

  update(now) {
    const packets = [];
    if (this.dog && (!this.alive || now >= this.dog.finish
      || !flightPending(this, flight => flight === this.dog))) {
      packets.push(...this._drop_dog(now));
    }
    if (this.phase > 1 && (!this.alive || now >= this.phase_end)) {
      this.phase = 1;
      this.phase_end = 0;
      packets.push(...this.removeBuff(361303, now), ...this.removeBuff(361603, now),
        this._cooldown(2, true), this._cooldown(2));
    }
    return packets.concat(super.update(now));
  }

  _hit(target, raw, power, generation, now, { basic = false, heal = false } = {}) {
    const marked = target.hasBuff(361403, now) && target.buffSources.get(361403) === this.id;
    const packets = this.damage(raw, now, { target, basic })[0];
    const current = this.alive && this.generation === generation;
    if (marked) {
      packets.push(...this.damage(power.mul(D('.45')), now, { target })[0]);
      packets.push(...this._buff(361901, now, target.id));
      if (current) {
        packets.push(...this.restoreHp(this.maxHp.mul(D('.015')), now));
        this.cooldowns[1] = now + Math.max(0, pyRound((this.cooldowns[1] - now) * 0.9));
        packets.push(this._cooldown(1));
      }
    }
    for (const template of [361111, 361112]) packets.push(...this._buff(template, now, target.id));
    if (current) {
      packets.push(...this._buff(361113, now), ...this._buff(361114, now));
      if (heal) {
        packets.push(...this.restoreHp(this.maxHp.sub(this.hp).mul(
          D(target.info.npc_template ? '.075' : '.15')), now));
      }
    }
    return packets;
  }

  _bullet_hit(flight, target, now) {
    const template = flight.template;
    let raw = flight.raw, heal = false;
    if (template === 361701) {
      const counts = flight.context.counts;
      const key = `${target.id},${target.generation}`;
      const index = counts.get(key) ?? 0;
      counts.set(key, index + 1);
      raw = raw.mul(powD(D('.75'), index));
      heal = index === 0;
    }
    return this._hit(target, raw, flight.power, flight.source_generation, now,
      { basic: template === 361100, heal });
  }

  _flight(flight, now) {
    if (flight.template === 361501
      && (!this.alive || flight.source_generation !== this.generation)) {
      return [scene({ expiredBullets: [flight.id] })];
    }
    const packets = piercingStep(this, flight, now, (f, t, n) => this._bullet_hit(f, t, n),
      { pierce: flight.template !== 361100 });
    if (flight.template === 361501 && (now >= flight.finish
      || !flightPending(this, f => f === flight))) {
      packets.push(...this._drop_dog(now));
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'erlang_landing') {
      const [targetId, generation, version] = data;
      const target = this.arena.actors.get(targetId);
      if (!target || !target.alive || target.generation !== generation) return [];
      if (target.hasBuff(361402, now)) {
        this._queue(now + 20, kind, ...data);
        return [];
      }
      return target.buffVersions.get(361402) === version
        ? this._buff(361406, now, target.id) : [];
    }
    if (kind === 'erlang_ready') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      let start = this.positionAt(now);
      const dest = cast.dest, power = cast.power;
      if (cast.slot === 1) {
        const dog = cast.dog;
        if (this.dog !== dog || now >= dog.finish) return [];
        const pos = pointAt(dog.start, dog.end,
          (now - dog.begin) / (dog.finish - dog.begin));
        this.position = this.blinkDestination(start, pos);
        this.motion = null;
        start = this.position;
        const packets = [scene({
          moves: [moveEvent(start, 0, 5, this.id)],
          skills: [this._skillEvent(361801, start, start)],
        })];
        for (const target of enemies(this, { area: true })) {
          const tpos = target.positionAt(now);
          if (Math.hypot(start[0] - tpos[0], start[1] - tpos[1]) <= 192) {
            packets.push(...this._hit(target, power.mul(D('2.29')), power, cast.generation, now));
          }
        }
        return packets.concat(this._buff(361803, now));
      }
      const packets = [scene({ skills: [this._skillEvent(cast.skill, start, dest)] })];
      for (const target of enemies(this, { area: true })) {
        if (inCone(target.positionAt(now), start, dest, 192, 180)) {
          packets.push(...this._hit(target, power.mul(D(2)), power, cast.generation, now,
            { heal: true }));
          packets.push(...this._buff(361305, now, target.id, { duration: 1500 }));
        }
      }
      this.phase = cast.phase + 1;
      this.phase_end = now + 5000;
      this.phase_gap = now + 500;
      packets.push(...this._buff(this.phase === 2 ? 361303 : 361603, now),
        ...this._buff(361304, now));
      return packets.concat([this._cooldown(2, true), this._cooldown(2)]);
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || !this.alive || this.ready || this.blocked('attack', now)
      || this.skillSealed(slot, now)) return [];
    const second = slot === 1 && this.dog && this.hasBuff(361201, now);
    const phase = slot === 2 && now < this.phase_end ? this.phase : 1;
    if (!second && (slot === 2 && phase > 1 ? this.phase_gap : this.cooldowns[slot]) > now) return [];
    if ([0, 1, 2].includes(slot) && !second
      && start[0] === dest[0] && start[1] === dest[1]) return [];
    const power = this.combatStat('iAttack', now);
    if (slot === 0) {
      this.cooldowns[0] = now + this.fireInterval(now);
      return this.shoot(361100, start, dest, now, power, {
        school: 'physical', basic: true, power,
      }).concat([this._cooldown(0)]);
    }
    if (slot === 1) {
      if (second) {
        this.ready = {
          slot: 1, skill: 361801, dest, power, dog: this.dog, generation: this.generation,
        };
        this._queue(now + 50, 'erlang_ready', this.ready);
        return this.removeBuff(361201, now).concat([
          scene({ skills: [this._skillEvent(361801, start, start, 0, { ready: 1 })] }),
          this._cooldown(1, true), this._cooldown(1),
        ]);
      }
      this.cooldowns[1] = now + this.skillCooldown(8000, 1);
      const packets = this.shoot(361501, start, dest, now, power.mul(D('1.12')), {
        school: 'physical', power, through_walls: true,
      });
      this.dog = lastFlight(this, flight => flight.template === 361501 && flight.begin === now);
      return packets.concat(this._buff(361201, now),
        [this._cooldown(1, true), this._cooldown(1)]);
    }
    if (slot === 10) {
      this.cooldowns[10] = now + this.skillCooldown(6000, 10);
      const packets = [scene({ skills: [this._skillEvent(361401, start, start)] }),
        this._cooldown(10)];
      for (const target of enemies(this, { area: true })) {
        const tpos = target.positionAt(now);
        if (Math.hypot(start[0] - tpos[0], start[1] - tpos[1]) > 192) continue;
        packets.push(...this._hit(target, power.mul(D('1.36')), power, this.generation, now));
        packets.push(...this._buff(361402, now, target.id),
          ...this._buff(361403, now, target.id, { duration: 5000 }));
        if (target.hasBuff(361402, now)) {
          this._queue(now + 20, 'erlang_landing', target.id, target.generation,
            target.buffVersions.get(361402));
        }
      }
      return packets.concat(this._buff(361404, now, null, { duration: 5000 }),
        this._buff(361405, now, null, { duration: 5000 }));
    }
    if (phase === 1) this.cooldowns[2] = now + this.skillCooldown(15000, 2);
    const packets = this.removeBuff(361303, now).concat(this.removeBuff(361603, now));
    if (phase < 3) {
      const skill = phase === 1 ? 361301 : 361601;
      this.ready = {
        slot: 2, skill, dest, power, phase, generation: this.generation,
      };
      this._queue(now + 100, 'erlang_ready', this.ready);
      return packets.concat([
        scene({ skills: [this._skillEvent(skill, start, dest, 0, { ready: 1 })] }),
        this._cooldown(2),
      ]);
    }
    this.phase = 1;
    this.phase_end = 0;
    const context = { counts: new Map() };
    const angle = Math.atan2(dest[1] - start[1], dest[0] - start[0]);
    for (const offset of [-15, 0, 15]) {
      const a = angle + offset * Math.PI / 180;
      const end = [start[0] + pyRound(600 * Math.cos(a)), start[1] + pyRound(600 * Math.sin(a))];
      packets.push(...this.shoot(361701, start, end, now, power.mul(D(2)), {
        school: 'physical', power, through_walls: true, context,
      }));
    }
    return packets.concat([this._cooldown(2, true), this._cooldown(2)]);
  }
}

export { SLOTS as ERLANG_SLOTS };
