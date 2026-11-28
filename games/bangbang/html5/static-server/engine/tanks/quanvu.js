/* Quan Cong / Quan Vu (tank 10000056): E dash, E2 execute+DoT, R shockwave.
 * Port of server/quanvu_actions.py onto the JS battle core.
 *
 * Stubs: no skin/effect presentation; EffectTemplate rows are read from the
 * arena table and fall back to the native values in melee.js.
 */
import { TankActions, TANK_CONTACT_RADIUS } from '../arena.js';
import { D, ONE, ZERO, pointAt, pyRound } from '../math.js';
import { scene, stop_move, encodeS1572, encodeS1579 } from '../protocol.js';
import { effectRows } from './melee.js';

const QUAN_VU = 10000056;
const R_USE_INTERVAL_MS = 1500; // User choice over raw 2000ms.
const SKILLS = [331100, 331201, 331211, 331221, 331301];
const BUFFS = [331102, 331202, 331204, 331205, 331206,
  331211, 331212, 331222, 331224, 331304];

export class QuanVuActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    const data = arena.data;
    this.skills = Object.fromEntries(SKILLS.map(id => [id, data.tableRow('SkillTemplate_table.xml', { nId: id })]));
    this.buffs = Object.fromEntries(BUFFS.map(id => [id, data.tableRow('BuffTemplate_table.xml', { nBuffId: id })]));
    this.effects = effectRows(this, [331201, 331203, 331221, 331301, 331302, 331303]);
    this.dash_effect = this.effects[331201];
    this.e_second_until = 0;
    this.r_count = Number(this.skills[331221].get('iStackCount'));
    this.r_next_charge = 0;
    this.dash_id = 0;
  }

  damage_bonus(target) {
    return ONE.add(target.hp.mul(2).lt(target.maxHp)
      ? D(this.buffs[331102].get('fEffectValA')) : ZERO);
  }

  on_death() {
    this.e_second_until = 0;
    this.dash_id += 1;
  }

  on_dash_hit(position, target, now) {
    // Damage contact can sit inside a narrow map NPC; resolve from the full
    // dash origin before starting the retreat (same as hard CC).
    position = this.stopPosition(now, position);
    this.position = position;
    this.motion = null;
    this.forced_until = now;
    const packets = [stop_move(this.sceneId, this.id, position),
      scene({ skills: [this._skillEvent(331203, position, target.positionAt(now), target.id)] })];
    if (target.alive) packets.push(...this._buff(331204, now, target.id));
    return packets;
  }

  _cooldown(slot, changed = false) {
    let skill = { 0: 331100, 1: 331201, 2: 331301, 10: 331221 }[slot];
    let end = this.cooldowns[slot];
    if (slot === 1 && this.e_second_until) { skill = 331211; end = 0; }
    const info = {
      skillId: skill, slot, count: slot === 10 ? this.r_count : -1, end,
      nextCharge: slot === 10 ? this.r_next_charge : 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _space_hit(start, now, victim = null) {
    victim = victim || this.enemy;
    const bot = victim.info;
    const threshold = D(this.effects[331301].get('fEffectVal'));
    const execute = victim.hp.le(victim.maxHp.mul(threshold));
    const packets = [];
    if (execute) {
      // General damage immunity is NOT execute immunity (V1 D07).
      if (!bot.execute_immune && D(bot.death_floor ?? 0).isZero()) {
        victim.damageCredit = [this.id, this.generation];
        try { packets.push(...victim.commitHp(0, now)); }
        finally { victim.damageCredit = null; }
        if (victim.alive) return packets; // Ghost's lethal form change, not a kill.
        packets.push(scene({ skills: [this._skillEvent(331101, start, start, this.id)] }));
        packets.push(...this.restore_hp(this.maxHp.sub(this.hp).mul(D('0.25')), now));
        this.e_second_until = 0;
        this.cooldowns[1] = 0;
        this.r_count = Number(this.skills[331221].get('iStackCount'));
        this.r_next_charge = this.cooldowns[10] = 0;
        this.cooldowns[2] = now + this.skillCooldown(1500, 2); // User choice.
        packets.push(this._cooldown(1, true), this._cooldown(1),
          this._cooldown(10), this._cooldown(2));
      }
    } else {
      packets.push(...this.damage(this.combatStat('iAttack', now)
        .mul(D(this.effects[331302].get('fAddVal'))), now, { target: victim })[0]);
    }
    if (this.arena.pk && this.arena.pk.finished) return packets;
    if (victim.alive && !victim.ccImmune(now)) {
      const current = victim.positionAt(now);
      const origin = victim.stopPosition(now);
      const span = Math.hypot(start[0] - origin[0], start[1] - origin[1]);
      if (span) {
        const moved = origin[0] !== current[0] || origin[1] !== current[1];
        if (moved) { victim.position = origin; victim.motion = null; }
        packets.push(...victim.interrupt(now));
        if (moved) packets.push(stop_move(victim.sceneId, victim.id, origin));
        const effect = this.effects[331303];
        let dest = pointAt(start, origin, 1 + Number(effect.get('nEffectValB')) / span);
        const wall = this.arena.geometry.wallContact(origin, dest, TANK_CONTACT_RADIUS);
        if (wall !== null) dest = pointAt(origin, dest, Math.max(0, wall - 0.001));
        dest = dest.map(pyRound);
        const speed = Number(effect.get('fEffectVal'));
        const duration = victim._setMotion(origin, dest, speed, now, 3);
        dest = victim.motion[1];
        victim.forcedUntil = now + duration;
        packets.push(scene({ moves: [this._moveEvent(dest, speed, 3, victim.id)] }));
      }
    }
    return packets;
  }

  update(now) {
    const packets = super.update(now);
    if (this.e_second_until && now >= this.e_second_until) {
      this.e_second_until = 0;
      packets.push(this._cooldown(1, true), this._cooldown(1));
    }
    if (this.r_next_charge && now >= this.r_next_charge) {
      const maximum = Number(this.skills[331221].get('iStackCount'));
      const recharge = Number(this.skills[331221].get('iCoolTime'));
      while (this.r_count < maximum && now >= this.r_next_charge) {
        this.r_count += 1;
        this.r_next_charge += this.skillCooldown(recharge);
      }
      if (this.r_count === maximum) this.r_next_charge = 0;
      packets.push(this._cooldown(10));
    }
    return packets;
  }

  cast(slot, start, dest, target, now) {
    const packets = [];
    let victim = null;
    const second_e = slot === 1 && this.e_second_until > now;
    if (this.blocked('attack', now) || (this.cooldowns[slot] > now && !second_e)) return packets;
    if (second_e || slot === 2) {
      victim = this.arena.actors.get(target);
      if (!victim || victim.camp === this.camp || !victim.alive || victim.isUntargetable()) return packets;
      const template = this.skills[second_e ? 331211 : 331301];
      dest = victim.positionAt(now);
      if (Math.hypot(start[0] - dest[0], start[1] - dest[1]) > Number(template.get('iRange'))) return packets;
    } else if ((slot === 0 || slot === 1)
      && (!this._inside(dest) || (dest[0] === start[0] && dest[1] === start[1]))) {
      return packets;
    }

    if (slot === 0) {
      this.cooldowns[0] = now + this.fireInterval(now);
      packets.push(...this.shoot(331100, start, dest, now, this.combatStat('iAttack', now),
        { school: 'physical', basic: true }));
      packets.push(this._cooldown(0));
    } else if (second_e) {
      dest = this.blinkDestination(start, dest);
      this.dash_id += 1; // Cancel an unfinished E1 flight if E2 interrupts it.
      this.e_second_until = 0;
      this.position = dest;
      this.motion = null;
      this.forced_until = 0;
      packets.push(scene({
        moves: [this._moveEvent(dest, 0, 5)],
        skills: [this._skillEvent(331211, start, dest, target)],
      }), this._cooldown(1, true));
      packets.push(this._cooldown(1));
      packets.push(...this._buff(331211, now, victim.id), ...this._buff(331212, now, victim.id));
      const dot = this.buffs[331212];
      const raw = this.combatStat('iAttack', now).mul(D(dot.get('fFixParam')));
      packets.push(...this.damage(raw, now, { target: victim })[0]);
      if (victim.hasBuff(331212, now)) {
        const cool = Number(dot.get('iCoolTime')), persist = Number(dot.get('iPersistTime'));
        for (let offset = cool; offset <= persist; offset += cool) {
          this._queue(now + offset, 'damage', victim.generation, raw, 331212,
            victim.buffVersions.get(331212), victim.id, this.generation);
        }
      }
    } else if (slot === 1) {
      const span = Math.hypot(start[0] - dest[0], start[1] - dest[1]);
      const length = Math.min(span, Number(this.skills[331201].get('iRange')));
      dest = [start[0] + (dest[0] - start[0]) * length / span,
        start[1] + (dest[1] - start[1]) * length / span].map(pyRound);
      // Description explicitly allows E's dash through map obstructions.
      const speed = Number(parseFloat(this.dash_effect.get('fEffectVal')));
      const duration = this._setMotion(start, dest, speed, now, 3);
      dest = this.motion[1];
      this.forced_until = now + duration;
      this.cooldowns[1] = now + this.skillCooldown(Number(this.skills[331201].get('iCoolTime')), 1);
      this.e_second_until = now + Number(this.buffs[331205].get('iPersistTime'));
      packets.push(scene({
        moves: [this._moveEvent(dest, speed, 3)],
        skills: [this._skillEvent(331201, start, dest)],
      }));
      packets.push(...this._buff(331202, now), ...this._buff(331206, now));
      packets.push(this._cooldown(1, true));
      this.dash_id += 1;
      this._launch('dash', this.dash_id, start, dest, duration,
        this.combatStat('iAttack', now).mul(D(this.effects[331203].get('fAddVal'))), now);
    } else if (slot === 10) {
      if (this.r_count === 0) return packets;
      this.r_count -= 1;
      this.cooldowns[10] = now + this.skillCooldown(R_USE_INTERVAL_MS, 10);
      if (!this.r_next_charge) {
        this.r_next_charge = now + this.skillCooldown(Number(this.skills[331221].get('iCoolTime')));
      }
      packets.push(scene({ skills: [this._skillEvent(331221, start, start, this.id)] }),
        this._cooldown(10));
      let any_damage = false;
      for (const foe of [...this.arena.actors.values()]) {
        const pos = foe.positionAt(now);
        if (!(foe.alive && foe.camp !== this.camp && foe.isAreaTargetable()
          && Math.hypot(start[0] - pos[0], start[1] - pos[1]) <= Number(this.effects[331221].get('iRange1')))) {
          continue;
        }
        const [hit_packets, damaged] = this.damage(this.combatStat('iAttack', now)
          .mul(D(this.effects[331221].get('fAddVal'))), now, { target: foe });
        packets.push(...hit_packets);
        any_damage = any_damage || damaged;
        if (foe.alive) packets.push(...this._buff(331222, now, foe.id));
      }
      if (any_damage) {
        if (this.cooldowns[1] > now) this.cooldowns[1] = Math.max(now, this.cooldowns[1] - 1000);
        packets.push(this._cooldown(1));
        packets.push(...this._buff(331224, now));
      }
    } else if (slot === 2) {
      this.cooldowns[2] = now + this.skillCooldown(Number(this.skills[331301].get('iCoolTime')), 2);
      packets.push(scene({ skills: [this._skillEvent(331301, start, dest, target)] }), this._cooldown(2));
      packets.push(...this._buff(331304, now));
      packets.push(...this._space_hit(start, now, victim));
    }
    return packets;
  }
}

export { QUAN_VU };
