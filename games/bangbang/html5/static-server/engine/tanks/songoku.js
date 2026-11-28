/* Songoku (tank 10000042): target teleport and a twelve-second, cast-time
 * enemy-count form. Port of server/songoku_actions.py.
 *
 * Stubs: no skin/presentation; team visibility uses batch-C's range/wall check.
 */
import { TankActions } from '../arena.js';
import { D } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';
import { aimed, enemies, prepareDisplacement } from './melee.js';
import { teamVisible } from './batch-c-common.js';
import { samePosition } from './batch-d-common.js';

const SLOTS = { 0: 316100, 1: 316201, 2: 316301 };
const FORM_BONUS = [D(1), D('1.1'), D('1.3'), D('1.5')];

export class SongokuActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    delete this.cooldowns[10];
    this.nearby = 0;
    this.teleport = null;
  }

  _cooldown(slot) {
    if (!(slot in SLOTS)) {
      return [1572, encodeS1572(this.id, {
        skillId: this.skillForSlot(slot) ?? 0, slot, count: -1,
        end: this.cooldowns[slot] ?? 0, nextCharge: 0,
      })];
    }
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot], nextCharge: 0,
    })];
  }

  _count(now) {
    let count = 0;
    for (const actor of this.arena.actors.values()) {
      if (actor.alive && actor.camp !== this.camp && !actor.info.npc_template
        && Math.hypot(this.positionAt(now)[0] - actor.positionAt(now)[0],
          this.positionAt(now)[1] - actor.positionAt(now)[1]) <= 432) count += 1;
    }
    return Math.min(3, count);
  }

  _form(now) {
    for (let template = 316311; template < 316315; template += 1) {
      if (this.hasBuff(template, now)) return template - 316311;
    }
    return null;
  }

  attr_bonus(attributes, now) {
    let value = super.attrBonus(attributes, now);
    // Native rows use attribute 5 for the form display; V1 treats this as an
    // outgoing damage bonus only.
    const form = this._form(now);
    if (attributes.includes(5) && form !== null) value = value.sub(FORM_BONUS[form]);
    return value;
  }

  _power(now) {
    const form = this._form(now);
    const base = this.combatStat('iEgAtk', now);
    return form === null ? base : base.mul(D(1).add(FORM_BONUS[form]));
  }

  on_spawn(now) {
    this.nearby = 0;
    this.teleport = null;
    this._queue(now, 'goku_aura', this.generation);
    return this._buff(316141, now);
  }

  _aura(now) {
    const count = this._form(now) !== null ? 0 : this._count(now);
    const packets = [];
    if (count !== this.nearby) {
      if (this.nearby) packets.push(...this.removeBuff(316130 + this.nearby, now));
      this.nearby = count;
    }
    if (count) packets.push(...this._buff(316130 + count, now));
    return packets;
  }

  stripDefenses(now) {
    const packets = super.stripDefenses(now);
    // TankBase: Groot suppression also removes Saiyan gains.
    for (const start of [316311, 316321, 316331]) {
      for (let template = start; template < start + 4; template += 1) {
        packets.push(...this.removeBuff(template, now));
      }
    }
    return packets.concat(this._aura(now));
  }

  strip_defenses(now) { return this.stripDefenses(now); }

  interrupt(now) {
    if (!this.alive) this.teleport = null;
    return []; // Approved: hostile control does not cancel an already placed E.
  }

  _event(now, kind, data) {
    if (kind === 'goku_aura') {
      if (!this.alive || data[0] !== this.generation) return [];
      this._queue(now + 1000, kind, ...data);
      return this._aura(now);
    }
    if (kind === 'goku_teleport') {
      const [cast] = data;
      if (this.teleport !== cast || !this.alive) return [];
      this.teleport = null;
      const target = this.arena.actors.get(cast.target);
      if (!target || !target.alive || target.generation !== cast.target_generation) return [];
      const start = this.positionAt(now);
      const dest = this.blinkDestination(start, target.positionAt(now));
      this.position = dest;
      this.motion = null;
      this.forcedUntil = now;
      const packets = [scene({ moves: [this._moveEvent(dest, 0, 5)] })];
      if (target.camp !== this.camp) {
        packets.push(...this.damage(cast.power.mul(D(2)), now,
          { target, school: 'energy' })[0]);
        packets.push(...this._buff(316213, now, target.id));
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (slot === 0 && samePosition(start, dest)) return [];
    const target = this.arena.actors.get(target_id);
    if (slot === 1 && (!target || !target.alive || target.isUntargetable()
      || Math.hypot(start[0] - target.positionAt(now)[0],
        start[1] - target.positionAt(now)[1]) > 432)) return [];
    if (slot === 1 && target.camp !== this.camp && !teamVisible(this, target, now)) return [];
    const power = this._power(now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 6000, 2: 20000 }[slot], slot);
    if (slot === 0) {
      return this.shoot(316100, start, dest, now, power,
        { school: 'energy', basic: true }).concat([this._cooldown(0)]);
    }
    const packets = [this._cooldown(slot),
      scene({ skills: [this._skillEvent(SLOTS[slot], start, dest, target_id)] })];
    if (slot === 1) {
      this.teleport = {
        target: target.id, target_generation: target.generation, power,
      };
      packets.push(...this._buff(316201, now, target.id));
      this._queue(now + 1000, 'goku_teleport', this.teleport);
      return packets;
    }
    const count = this._count(now); // Before the initial push, not after it.
    for (const victim of enemies(this, { area: true })) {
      const origin = victim.positionAt(now);
      if (Math.hypot(start[0] - origin[0], start[1] - origin[1]) > 144) continue;
      packets.push(...this.damage(power.mul(D(2)), now, { target: victim, school: 'energy' })[0]);
      if (this.arena.pk && this.arena.pk.finished) break;
      packets.push(...this._buff(316302, now, victim.id));
      if (victim.alive && !victim.ccImmune(now)) {
        let originStop, stopped;
        [originStop, stopped] = prepareDisplacement(victim, now);
        packets.push(...stopped);
        const angle = samePosition(originStop, start) ? [start[0] + 1, start[1]] : originStop;
        const end = aimed(start, angle,
          Math.hypot(start[0] - originStop[0], start[1] - originStop[1]) + 144,
          { fixed: true });
        const duration = victim._setMotion(originStop, end, 720, now, 1);
        victim.forcedUntil = now + duration;
        packets.push(scene({
          moves: [victim._moveEvent(victim.motion[1], 720, 1)],
        }));
      }
    }
    for (const template of [316311 + count, 316321 + count, 316331 + count]) {
      packets.push(...this._buff(template, now));
    }
    return packets.concat(this._aura(now));
  }
}

export { SLOTS as SONGOKU_SLOTS };
