/* Cao Cao (tank 10000091): one aura clock, explicit hostage ownership and a
 * one-way damage split. Port of server/caocao_actions.py.
 *
 * Stubs: no skin/presentation. team_visible uses the batch-C wall check.
 */
import { TankActions, parseBkey } from '../arena.js';
import { D } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, packII, prepareDisplacement } from './melee.js';
import { teamVisible } from './batch-c-common.js';

const SLOTS = { 0: 366100, 1: 366201, 2: 366301, 10: 366401 };

export class CaoCaoActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = this.dash = this.aura = this.hostage = null;
    this.passive_damage = D(0);
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
    this.ready = this.dash = this.aura = this.hostage = null;
    this.passive_damage = D(0);
    this.passive_ready_at = 0;
    return this._buff(366101, now).concat(this._buff(366102, now));
  }

  blocked(action, now) {
    return Boolean(this.ready || this.dash || this.hostage) || super.blocked(action, now);
  }

  _speed(now) {
    return this.ready || this.dash || this.hostage ? 0 : super._speed(now);
  }

  _start_aura(now) {
    if (!this.alive) return [];
    // Refreshing extends the existing clock, including a kill inside a tick.
    if (this.aura && this.aura.end >= now) this.aura.end = now + 5000;
    else {
      this.aura = { end: now + 5000, generation: this.generation };
      this._queue(now + 500, 'cao_aura', this.aura);
    }
    const packets = [];
    for (const template of [366401, 366402, 366403, 366404]) packets.push(...this._buff(template, now));
    return packets;
  }

  on_damage(source, hit, now, school, reflected, attacker_ap) {
    if (!this.alive || hit.hp_loss.le(0)) return [];
    const packets = [];
    if (now >= this.passive_ready_at) {
      this.passive_damage = this.passive_damage.add(hit.hp_loss);
      if (this.passive_damage.ge(this.maxHp.mul(D('.3')))) {
        this.passive_damage = this.passive_damage.sub(this.maxHp.mul(D('.3')));
        this.passive_ready_at = now + 15000;
        packets.push(...this._buff(366103, now), ...this._buff(366104, now));
      }
    }
    return packets;
  }

  on_skill_damage(source, hit, now) {
    return this.alive && hit.hp_loss.gt(0) && this.hasBuff(366103, now)
      ? this.restoreHp(this.maxHp.mul(D('.03')), now) : [];
  }

  on_target_death(target, now) {
    const packets = [];
    if (this.hostage && this.hostage.target === target.id) packets.push(...this._release(now));
    if (this.dash && this.dash.target === target.id) packets.push(...this.interrupt(now));
    if (this.alive && target.camp !== this.camp && !target.info.npc_template
      && Array.isArray(target.damageCredit)
      && target.damageCredit[0] === this.id && target.damageCredit[1] === this.generation) {
      packets.push(...this._start_aura(now));
    }
    return packets;
  }

  _release(now) {
    const cast = this.hostage;
    if (!cast) return [];
    this.hostage = null;
    const packets = [];
    for (const [ident, templates] of [
      [this.id, [366806, 366807, 366808, 366809, 366810, 366811]],
      [cast.target, [366301, 366601, 366801, 366802, 366803, 366804, 366805]],
    ]) {
      const actor = this.arena.actors.get(ident);
      if (!actor) continue;
      if (actor.caocao_hostage === cast) actor.caocao_hostage = null;
      for (const template of templates) packets.push(...actor.removeBuff(template, now));
      if (actor.alive) packets.push(...this._buff(366901, now, actor.id));
      packets.push(...actor.syncSpeed(now));
    }
    return packets.concat(this.syncSpeed(now));
  }

  // Core checks target.hostage and calls target.redirectDamage on the caster.
  redirectDamage(amount, school, now) {
    const cast = this.hostage;
    const target = cast ? this.arena.actors.get(cast.target) : null;
    if (!target || !target.alive || cast.end <= now
      || target.generation !== cast.target_generation) {
      return [amount, this._release(now)];
    }
    const half = amount.div(D(2));
    const [packets] = this.damage(half, now, {
      target, school, reflected: true, resolved_damage: half,
    });
    return [amount.sub(half), packets];
  }

  redirect_damage(amount, school, now) { return this.redirectDamage(amount, school, now); }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      packets.push([1583, packII(this.id, 366301)]);
      this.ready = null;
    }
    if (this.dash) {
      this.position = this.stopPosition(now);
      this.motion = null;
      this.forcedUntil = 0;
      this.dash = null;
      packets.push(...this.removeBuff(366302, now));
      packets.push(scene({ moves: [this._moveEvent(this.position, 0, 5)] }));
    }
    if (!this.alive) {
      this.aura = null;
      packets.push(...this._release(now));
    }
    return packets.concat(this.syncSpeed(now));
  }

  on_control(source, template, now) {
    const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
    const mask = Number(row.get('fEffectValB', 0));
    return (this.ready || this.dash) && ['30', '35', '66'].includes(row.get('nEffectType'))
      && (!mask || (mask & 4)) ? this.interrupt(now) : [];
  }

  _hold(cast, target, now) {
    // Contact may occur before either moving body has cleared a wall.
    this.dash = null;
    this.position = this.stopPosition(now);
    this.motion = null;
    this.forcedUntil = 0;
    const packets = this.removeBuff(366302, now);
    if (!target.alive || target.isUntargetable()
      || target.generation !== cast.target_generation) return packets.concat(this.syncSpeed(now));
    // Only the original CC-immunity buff type is removed; forms stay intact.
    for (const key of [...target.activeBuffs.keys()]) {
      const [owner, template] = parseBkey(key);
      if (owner === target.id
        && this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template })
          .get('nEffectType') === '54') packets.push(...target.removeBuff(template, now));
    }
    target.position = target.stopPosition(now);
    target.motion = null;
    target.forcedUntil = 0;
    packets.push(...target.interrupt(now));
    for (const template of [366801, 366802, 366803, 366804, 366805]) {
      packets.push(...this._buff(template, now, target.id));
    }
    for (const template of [366806, 366807, 366808, 366809, 366810, 366811]) {
      packets.push(...this._buff(template, now));
    }
    cast.end = now + 3000;
    cast.owner = this.id;
    this.hostage = target.caocao_hostage = cast;
    packets.push(scene({
      moves: [this._moveEvent(this.position, 0, 5), target._moveEvent(target.position, 0, 5)],
    }));
    this._queue(now + 250, 'cao_hostage', cast, 1);
    return packets.concat(this.syncSpeed(now), target.syncSpeed(now));
  }

  _flight(flight, now) {
    if (flight.template !== 366201) return super._flight(flight, now);
    if (now < flight.finish) {
      this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
      flight.previous = now;
      return [];
    }
    const packets = [scene({ blownBullets: [flight.id] })];
    const pos = flight.end;
    for (const target of enemies(this, { area: true })) {
      const old = target.positionAt(now);
      if (Math.hypot(pos[0] - old[0], pos[1] - old[1]) > 144) continue;
      packets.push(...this.damage(flight.raw, now, {
        target, source_generation: flight.source_generation,
      })[0]);
      if (this.arena.pk && this.arena.pk.finished) return packets;
      packets.push(...this._buff(366202, now, target.id));
      if (target.alive && !target.ccImmune(now)) {
        const [origin, stopped] = prepareDisplacement(target, now, { interrupt: false });
        packets.push(...stopped);
        const dest = aimed(origin, pos, 72);
        target._setMotion(origin, dest, 300, now, 1);
        target.forcedUntil = target.motion[3];
        packets.push(scene({ moves: [target._moveEvent(target.motion[1], 300, 1)] }));
      }
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'cao_aura') {
      const [cast] = data;
      if (this.aura !== cast || !this.alive || cast.generation !== this.generation) return [];
      if (now > cast.end) { this.aura = null; return []; }
      const packets = [];
      const power = this.combatStat('iAttack', now);
      for (const target of enemies(this, { area: true })) {
        const pos = this.positionAt(now), tpos = target.positionAt(now);
        if (Math.hypot(pos[0] - tpos[0], pos[1] - tpos[1]) <= 240) {
          const [more, lost] = this.damage(power.mul(D('.5')), now, { target });
          packets.push(...more);
          if (lost && !target.info.npc_template) {
            packets.push(...this.restoreHp(this.maxHp.mul(D('.02')), now));
          }
        }
      }
      if (now < cast.end) this._queue(now + 500, kind, cast);
      else this.aura = null;
      return packets;
    }
    if (kind === 'cao_ready') {
      const [cast] = data;
      if (this.ready !== cast) return [];
      this.ready = null;
      const target = this.arena.actors.get(cast.target);
      if (!this.alive || !target || !target.alive || target.isUntargetable()
        || target.generation !== cast.target_generation) return this.syncSpeed(now);
      const start = this.positionAt(now), dest = target.positionAt(now);
      this._setMotion(start, dest, 960, now, 3);
      cast.end = this.motion[3];
      this.dash = cast;
      this._queue(Math.min(now + 20, cast.end), 'cao_dash', cast);
      return this._start_aura(now).concat(this._buff(366302, now), [scene({
        moves: [this._moveEvent(this.motion[1], 960, 3)],
        skills: [this._skillEvent(366301, start, dest, target.id)],
      })], this.syncSpeed(now));
    }
    if (kind === 'cao_dash') {
      const [cast] = data;
      const target = this.arena.actors.get(cast.target);
      if (this.dash !== cast) return [];
      if (!this.alive || !target || !target.alive
        || target.generation !== cast.target_generation) return this.interrupt(now);
      const pos = this.positionAt(now), tpos = target.positionAt(now);
      if (Math.hypot(pos[0] - tpos[0], pos[1] - tpos[1]) <= 72) {
        return this._hold(cast, target, now);
      }
      if (!this.motion || now >= Math.min(cast.end, this.motion[3])) return this.interrupt(now);
      this._queue(Math.min(now + 20, cast.end), kind, cast);
      return [];
    }
    if (kind === 'cao_hostage') {
      const [cast, tick] = data;
      if (this.hostage !== cast) return [];
      const target = this.arena.actors.get(cast.target);
      if (!this.alive || !target || !target.alive
        || target.generation !== cast.target_generation) return this._release(now);
      const packets = this.damage(cast.power.mul(D('.2')), now, {
        target, periodic: true,
      })[0];
      if (this.hostage === cast) {
        if (tick < 12) this._queue(now + 250, kind, cast, tick + 1);
        else packets.push(...this._release(now));
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    const enemy = this.arena.actors.get(target_id);
    if (slot === 2 && (!enemy || !enemy.alive || enemy.camp === this.camp
      || enemy.info.npc_template || enemy.isUntargetable()
      || enemy.hasBuff(366806, now) || enemy.caocao_hostage
      || Math.hypot(start[0] - enemy.positionAt(now)[0],
        start[1] - enemy.positionAt(now)[1]) > 264)) return [];
    if (slot === 2 && !teamVisible(this, enemy, now)) return [];
    if ((slot === 0 || slot === 1)
      && ((start[0] === dest[0] && start[1] === dest[1]) || !this._inside(dest))) return [];
    if (slot === 0) {
      this.cooldowns[0] = now + this.fireInterval(now);
      return this.shoot(366100, start, dest, now, this.combatStat('iAttack', now), {
        school: 'physical', basic: true,
      }).concat([this._cooldown(0)]);
    }
    this.cooldowns[slot] = now + this.skillCooldown({ 1: 6000, 2: 30000, 10: 10000 }[slot], slot);
    if (slot === 1) {
      return this.shoot(366201, start, aimed(start, dest, 480), now,
        this.combatStat('iAttack', now).mul(D('1.83')), {
          school: 'physical', through_walls: true, fixed_destination: true,
        }).concat([this._cooldown(1)]);
    }
    if (slot === 10) {
      return this._start_aura(now).concat([
        scene({ skills: [this._skillEvent(366401, start, start)] }), this._cooldown(10),
      ]);
    }
    this.ready = {
      slot: 2, target: target_id, target_generation: enemy.generation,
      generation: this.generation, power: this.combatStat('iAttack', now),
      dest: enemy.positionAt(now),
    };
    this._queue(now + 10, 'cao_ready', this.ready);
    return this._buff(366301, now, target_id).concat([
      scene({ skills: [this._skillEvent(366301, start, this.ready.dest, target_id, { ready: 1 })] }),
      this._cooldown(2),
    ], this.syncSpeed(now));
  }
}

export { SLOTS as CAOCAO_SLOTS };
