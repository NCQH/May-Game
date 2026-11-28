/* Gundam (tank 10000019): missile salvo, burn combo, beam laser, recoil shot.
 * Port of server/gundam_actions.py onto the JS battle core.
 *
 * Stubs: presentation/skin only. The 25% extra-missile roll is kept as the
 * approved description rule (EffectTemplate raw 40% is not used).
 */
import { TankActions, TANK_CONTACT_RADIUS, bkey } from '../arena.js';
import { D, pointAt, pyRound } from '../math.js';
import { scene, encodeS1559, encodeS1572 } from '../protocol.js';
import { effectRows, packII, prepareDisplacement } from './melee.js';

const GUNDAM = 10000019;
const EXTRA_MISSILE_CHANCE = 0.25; // User chose description/V1 over raw Effect 40%.
const SLOTS = { 0: 302600, 1: 302701, 2: 302801, 10: 302901 };

export class GundamActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    const data = arena.data;
    this.skills = Object.fromEntries(Object.values(SLOTS)
      .map(id => [id, data.tableRow('SkillTemplate_table.xml', { nId: id })]));
    this.effects = effectRows(this, [302600, 302611, 302701, 302801, 302902, 302911]);
    this.ready = null;
    this.cast_serial = 0;
    this.combo_target = null;
    this.combo_count = this.combo_until = 0;
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    })];
  }

  blocked(action, now) { return super.blocked(action, now) || this.ready !== null; }

  on_death() {
    this.ready = null;
    this.combo_target = null;
    this.combo_count = this.combo_until = 0;
  }

  update(now) {
    if (now >= this.combo_until) {
      this.combo_target = null;
      this.combo_count = 0;
    }
    return super.update(now);
  }

  interrupt(now) {
    if (this.ready === null) return [];
    this.ready = null;
    this.cooldowns[2] = now + this.skillCooldown(
      Number(this.skills[302801].get('iSkillBreakCoolTime')), 2);
    return [[1583, packII(this.id, 302801)], this._cooldown(2)];
  }

  _clear_marks(target) {
    const packets = [];
    for (const template of [302601, 302602]) {
      const key = bkey(target.id, template);
      const item = this.activeBuffs.get(key);
      if (item) {
        this.activeBuffs.delete(key);
        packets.push([1559, encodeS1559(target.id, item[0])]);
      }
    }
    return packets;
  }

  on_bullet_hit(flight, target, now) {
    const packets = [];
    if (flight.template === 302911) packets.push(...this._buff(302912, now, target.id));
    // Primary basic, E and R all count/proc; extra missile never recurses.
    if (flight.proc || !flight.basic || !this.alive
      || flight.source_generation !== this.generation || !target.alive) return packets;
    const key = `${target.id},${target.generation}`;
    if (this.combo_target !== key || now >= this.combo_until) this.combo_count = 0;
    this.combo_target = key;
    this.combo_count += 1;
    this.combo_until = now + Number(this.arena.data
      .tableRow('BuffTemplate_table.xml', { nBuffId: 302601 }).get('iPersistTime'));
    packets.push(...this._clear_marks(target));
    if (this.combo_count === 3) {
      this.combo_count = 0;
      packets.push(...this._buff(302612, now, target.id));
      packets.push(...this.damage(flight.power.mul(D(this.effects[302611].get('fAddVal'))),
        now, { target, school: 'energy', basic: true })[0]);
    } else {
      packets.push(...this._buff(302600 + this.combo_count, now, target.id));
    }
    if (target.alive && this.arena.rng() < EXTRA_MISSILE_CHANCE) {
      packets.push(...this.shoot(302602, this.positionAt(now), target.positionAt(now), now,
        flight.power.mul(D(this.effects[302701].get('fAddVal'))),
        { school: 'energy', basic: true, target, proc: true, power: flight.power }));
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'missile') {
      const [generation, target_id, target_generation, power] = data;
      const target = this.arena.actors.get(target_id);
      if (this.alive && this.generation === generation && target?.alive
        && target.generation === target_generation) {
        return this.shoot(302701, this.positionAt(now), target.positionAt(now), now,
          power.mul(D(this.effects[302701].get('fAddVal'))),
          { school: 'energy', basic: true, target, power });
      }
      return [];
    }
    if (kind === 'laser') {
      const [token, generation, start, dest, power] = data;
      if (!this.alive || this.generation !== generation || this.ready !== token) return [];
      this.ready = null;
      const packets = [scene({ skills: [this._skillEvent(302801, start, dest)] })];
      const span = Math.hypot(dest[0] - start[0], dest[1] - start[1]);
      const ux = (dest[0] - start[0]) / span, uy = (dest[1] - start[1]) / span;
      const length = Number(this.effects[302801].get('iRange1'));
      const half_width = Number(this.effects[302801].get('iRange2')) / 2;
      for (const target of [...this.arena.actors.values()]) {
        if (!target.alive || target.camp === this.camp) continue;
        const [tx, ty] = target.positionAt(now);
        const dx = tx - start[0], dy = ty - start[1];
        const along = dx * ux + dy * uy, side = -dx * uy + dy * ux;
        const outside_x = Math.max(0, -along, along - length);
        const outside_y = Math.max(0, Math.abs(side) - half_width);
        if (Math.hypot(outside_x, outside_y) <= TANK_CONTACT_RADIUS) {
          packets.push(...this.damage(power.mul(D(this.effects[302801].get('fAddVal'))),
            now, { target, school: 'energy' })[0]);
        }
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.cooldowns[slot] > now) return [];
    const skill = SLOTS[slot];
    const row = this.skills[skill];
    const power = this.combatStat('iEgAtk', now);
    let combo_target = null;
    if (slot === 1) {
      combo_target = this.arena.actors.get(target_id);
      const target = combo_target;
      if (!target || !target.alive || target.camp === this.camp || target.isUntargetable()
        || Math.hypot(start[0] - target.positionAt(now)[0], start[1] - target.positionAt(now)[1])
        > Number(row.get('iRange'))) return [];
      dest = target.positionAt(now);
    } else if (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1])) {
      return [];
    }
    this.cooldowns[slot] = now + this.skillCooldown(
      slot === 0 ? this.fireInterval(now) : Number(row.get('iCoolTime')), slot);
    if (slot === 0) {
      return this.shoot(skill, start, dest, now,
        power.mul(D(this.effects[302600].get('fAddVal'))),
        { school: 'energy', basic: true, speed_multiplier: 2, power }).concat([this._cooldown(slot)]);
    }
    if (slot === 1) {
      for (let count = 1; count <= Number(row.get('iCount')); count += 1) {
        this._queue(now + count * Number(row.get('iInterval')), 'missile',
          this.generation, combo_target.id, combo_target.generation, power);
      }
      return [scene({ skills: [this._skillEvent(skill, start, dest, combo_target.id)] }),
        this._cooldown(slot)];
    }
    if (slot === 10) {
      const packets = this.shoot(302911, start, dest, now,
        power.mul(D(this.effects[302911].get('fAddVal'))),
        { school: 'energy', basic: true, power });
      // Effect302902: recoil speed 960/distance 300, opposite the shot.
      const effect = this.effects[302902];
      let end = pointAt(start, dest,
        -Number(effect.get('nEffectValB')) / Math.hypot(dest[0] - start[0], dest[1] - start[1]));
      end = this.arena.geometry.clampTankPosition(end);
      let body, stopped;
      [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      if (!stopped.length) body = start;
      const wall = this.arena.geometry.wallContact(body, end, TANK_CONTACT_RADIUS);
      if (wall !== null) end = pointAt(body, end, Math.max(0, wall - 0.001));
      end = end.map(pyRound);
      const speed = Number(effect.get('fEffectVal'));
      this.forced_until = now + this._setMotion(body, end, speed, now, 3);
      end = this.motion[1];
      packets.push(...stopped);
      packets.push(scene({ moves: [this._moveEvent(end, speed, 3)] }), this._cooldown(slot));
      return packets;
    }
    this.cast_serial += 1;
    this.ready = this.cast_serial;
    let body, stopped;
    [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
    this.position = stopped.length ? body : start;
    this.motion = null;
    this._queue(now + Number(row.get('iReadyTime')), 'laser',
      this.ready, this.generation, start, dest, power);
    return [scene({
      moves: [this._moveEvent(start, 0, 5)],
      skills: [this._skillEvent(skill, start, dest, 0, { ready: 1 })],
    }), this._cooldown(slot)].concat(stopped);
  }
}

export { GUNDAM, EXTRA_MISSILE_CHANCE };
