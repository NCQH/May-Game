/* Ghost Rider (tank 10000038): soul form on lethal damage, hellfire, judgment.
 * Port of server/ghost_actions.py onto the JS battle core.
 *
 * Stubs: presentation and the client HP-bar animation; the form's max-HP packet
 * keeps the native S1560 shape. The Space beam is a short channelled judgment.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt } from '../math.js';
import { scene, encodeS1572, encodeS1560 } from '../protocol.js';
import { packII, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 312100, 1: 312201, 2: 312301, 10: 312401 };
const FORM_BUFFS = [312111, 312114, 312115, 312116, 312117, 312118, 312121];
const EMBERS = Array.from({ length: 9 }, (_, i) => 312151 + i);

export class GhostActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.soul = null;
    this.channel = null;
    this.passive_ready_at = 0;
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    })];
  }

  on_spawn(now) { return this._buff(312101, now); }

  blocked(action, now) {
    return super.blocked(action, now) || (action === 'attack' && this.soul !== null)
      || this.channel !== null;
  }

  _speed(now) { return this.channel ? 0 : super._speed(now); }

  ccImmune(now, { slow = false } = {}) {
    // User: Space cannot be controlled; form description also grants immunity.
    return this.channel !== null || this.soul !== null || super.ccImmune(now, { slow });
  }

  interrupt(now) {
    const cast = this.channel;
    this.channel = null;
    if (cast === null || cast === undefined) return [];
    const packets = [[1583, packII(this.id, 312301)]];
    const target = this.arena.actors.get(cast.target);
    for (const [actor, templates] of [[this, [312331, 312341]], [target, [312311, 312321]]]) {
      if (!actor) continue;
      for (const template of templates) {
        if (actor.buffSources.get(template) === this.id) {
          packets.push(...actor.removeBuff(template, now));
        }
      }
    }
    return packets.concat(this.syncSpeed(now));
  }

  _max_hp_packet() {
    this.info.max_hp = this.maxHp.ceil();
    return [1560, encodeS1560(this.info.acct_id, 3, this.maxHp.ceil())];
  }

  _maxHpPacket() { return this._max_hp_packet(); }

  _clear_form(now) {
    this.soul = null;
    const packets = [];
    for (const template of [...FORM_BUFFS, ...EMBERS]) {
      if (this.hasBuff(template, now)) packets.push(...this.removeBuff(template, now));
    }
    this.maxHp = D(this.stats.iHp);
    return packets.concat([this._max_hp_packet()]);
  }

  commitHp(hp, now, { critical = false } = {}) {
    if (this.hp.gt(0) && D(hp).isZero()) {
      if (this.soul === null && now >= this.passive_ready_at) {
        const [, stopped] = prepareDisplacement(this, now, { interrupt: false });
        const packets = this.interrupt(now);
        this.position = this.positionAt(now);
        this.motion = null;
        this.forcedUntil = 0;
        this.passive_ready_at = now + 10000; // Original passive buff cooldown.
        this.soul = { begin: now, generation: this.generation,
          power: this.combatStat('iEgAtk', now) };
        // User chose 150% HP for the form, with a matching client HP bar.
        this.maxHp = D(this.stats.iHp).mul(D('1.5'));
        this.hp = this.maxHp;
        this.info.hp = this.maxHp.ceil();
        for (const key of [...this.activeBuffs.keys()]) {
          const [owner, template] = key.split(',').map(Number);
          if (owner !== this.id) continue;
          const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
          const effect = Number(row.nEffectType);
          const cc = [30, 35, 36, 66].includes(effect)
            || (row.nEffectType === '201' && row.get('nTypeParam') === '11'
              && D(row.get('fEffectValA', '0')).lt(0));
          if (row.get('iAspect') === '-1' && cc) {
            packets.push(...this.removeBuff(template, now));
          }
        }
        packets.push(this._max_hp_packet(), this._hpPacket(this.id, this.hp));
        for (const template of FORM_BUFFS) packets.push(...this._buff(template, now));
        this._queue(now + 300, 'hellfire', this.soul);
        return packets.concat(stopped);
      }
      if (this.soul) {
        const pos = this.positionAt(now), power = this.combatStat('iEgAtk', now);
        const packets = this._clear_form(now);
        packets.push(...super.commitHp(0, now, { critical }));
        const [ident, packet] = this.addObject(312411, pos);
        this._queue(now + 410, 'death_flame',
          { id: ident, pos, power, generation: this.generation });
        return packets.concat([packet]);
      }
    }
    return super.commitHp(hp, now, { critical });
  }

  _ember(now) {
    let stage = 0;
    for (let i = 0; i < EMBERS.length; i += 1) {
      if (this.hasBuff(EMBERS[i], now)) stage = i + 1;
    }
    const packets = [];
    for (const template of EMBERS) {
      if (this.hasBuff(template, now)) packets.push(...this.removeBuff(template, now));
    }
    if (stage < 9) {
      return packets.concat(this._buff(EMBERS[stage], now, null, { duration: 4000 }));
    }
    const hp = this.hp.add(D(this.stats.iHp).mul(D('.5')));
    packets.push(...this._clear_form(now));
    // Explicit form revival, not ordinary healing (which is banned).
    packets.push(...super.commitHp(this.maxHp.min(hp), now));
    packets.push(...this._buff(312161, now));
    return packets;
  }

  _flame(pos, power, now, { death = false } = {}) {
    const packets = [];
    let lostAny = false;
    for (const target of [...this.arena.actors.values()]) {
      if (!target.alive || target.camp === this.camp
        || Math.hypot(pos[0] - target.positionAt(now)[0],
          pos[1] - target.positionAt(now)[1]) > 192) continue;
      const missing = target.maxHp.sub(target.hp);
      const factor = death && target.hasBuff(312124, now)
        ? D(1).add(D('.1').mul(target.buffStacks.get(312124) ?? 0)) : D(1);
      const [first, lost] = this.damage(power.mul(D('2.21')).mul(factor), now,
        { target, school: 'energy' });
      packets.push(...first);
      const [second, lost2] = this.damage(missing.mul(D('.15')).mul(factor), now,
        { target, school: 'true' });
      packets.push(...second);
      lostAny = lostAny || lost || lost2;
      packets.push(...this._buff(312403, now, target.id));
    }
    if (lostAny && !death) {
      this.cooldowns[10] = Math.max(now, this.cooldowns[10] - 2000);
      packets.push(this._cooldown(10));
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'hellfire') {
      const [soul] = data;
      if (this.soul !== soul || !this.alive) return [];
      const packets = [];
      for (const target of [...this.arena.actors.values()]) {
        if (!target.alive || target.camp === this.camp
          || Math.hypot(this.positionAt(now)[0] - target.positionAt(now)[0],
            this.positionAt(now)[1] - target.positionAt(now)[1]) > 168) continue;
        const [hit, lost] = this.damage(soul.power.mul(D('.75')), now,
          { target, school: 'energy', periodic: true });
        packets.push(...hit);
        packets.push(...this._buff(312122, now, target.id));
        if (lost) {
          packets.push(...this._buff(312124, now, target.id));
          packets.push(...this._ember(now));
          if (this.soul !== soul) break;
        }
      }
      if (this.soul === soul) this._queue(now + 300, kind, soul);
      return packets;
    }
    if (kind === 'death_flame') {
      const [cast] = data;
      const packets = this.removeObject(cast.id, { destroyed: true });
      if (cast.generation === this.generation) {
        packets.push(...this._flame(cast.pos, cast.power, now, { death: true }));
      }
      return packets;
    }
    if (kind === 'judgment') {
      const [cast] = data;
      if (this.channel !== cast || !this.alive) return [];
      const target = this.arena.actors.get(cast.target);
      if (!target?.alive || target.generation !== cast.target_generation
        || Math.hypot(this.positionAt(now)[0] - target.positionAt(now)[0],
          this.positionAt(now)[1] - target.positionAt(now)[1]) > 264) {
        return this.interrupt(now);
      }
      const packets = this.damage(cast.power.mul(D('1.5')), now,
        { target, school: 'energy', periodic: true })[0];
      if (now >= cast.end || !target.alive) return packets.concat(this.interrupt(now));
      this._queue(now + 500, kind, cast);
      return packets;
    }
    return super._event(now, kind, data);
  }

  onTargetDeath(target, now) {
    return this.channel && this.channel.target === target.id ? this.interrupt(now) : [];
  }

  _flight(flight, now) {
    if (flight.template !== 312201) return super._flight(flight, now);
    const { previous, begin, finish } = flight;
    const start = pointAt(flight.start, flight.end, (previous - begin) / (finish - begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - begin) / (finish - begin)));
    const hits = [];
    for (const target of this.arena.actors.values()) {
      if (!target.alive || target.camp === this.camp) continue;
      const hit = actorContact(start, end, target, previous, now, 54);
      if (hit !== null) hits.push([hit, target.id]);
    }
    if (hits.length) {
      hits.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const target = this.arena.actors.get(hits[0][1]);
      if (this.projectileBlocked(target, now)) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      const packets = [];
      const center = this.positionAt(now), origin = target.positionAt(now);
      const span = Math.hypot(center[0] - origin[0], center[1] - origin[1]);
      if (this.alive && this.generation === flight.source_generation && span > 72
        && !target.ccImmune(now)) {
        let body, stopped;
        [body, stopped] = prepareDisplacement(target, now, { interrupt: false });
        if (!stopped.length) body = origin;
        target.position = target.moveDestination(body, pointAt(center, origin, 72 / span));
        target.motion = null;
        packets.push(...target.interrupt(now));
        packets.push(...stopped);
        packets.push(scene({ moves: [this._moveEvent(target.position, 0, 5, target.id)] }));
      }
      packets.push(...this.damage(flight.raw, now, { target, school: 'energy' })[0]);
      packets.push(...this._buff(312212, now, target.id));
      return packets.concat([scene({ blownBullets: [flight.id] })]);
    }
    if (now >= finish) return [scene({ expiredBullets: [flight.id] })];
    flight.previous = now;
    this._queue(Math.min(now + 20, finish), 'flight', flight);
    return [];
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if ((slot === 0 || slot === 1)
      && (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1]))) return [];
    const target = this.arena.actors.get(targetId);
    if (slot === 2 && (!target || !target.alive || target.camp === this.camp
      || target.isUntargetable()
      || Math.hypot(start[0] - target.positionAt(now)[0],
        start[1] - target.positionAt(now)[1]) > 264)) return [];
    if (slot === 2 && !this.teamVisible(target, now)) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 8000, 2: 25000, 10: 6000 }[slot], slot);
    let packets;
    if (slot === 0 || slot === 1) {
      packets = this.shoot(SLOTS[slot], start, dest, now,
        power.mul(slot ? D('2.35') : D(1)),
        { school: 'energy', basic: slot === 0 });
    } else if (slot === 10) {
      packets = [scene({ skills: [this._skillEvent(312401, start, start, this.id)] })];
      packets.push(...this._flame(start, power, now));
    } else {
      this.channel = { target: target.id, target_generation: target.generation,
        power, end: now + 2500 };
      this.position = start;
      this.motion = null;
      packets = [scene({
        skills: [this._skillEvent(312301, start, target.positionAt(now), target.id)],
        moves: [this._moveEvent(start, 0, 5)],
      })];
      for (const [actor, templates] of [[target, [312311, 312321]],
        [this, [312331, 312341]]]) {
        for (const template of templates) {
          packets.push(...this._buff(template, now, actor.id, { duration: 2500 }));
        }
      }
      packets.push(...this.syncSpeed(now));
      this._queue(now + 500, 'judgment', this.channel);
    }
    return packets.concat([this._cooldown(slot)]);
  }

  /** bot_ai.team_visible: native wall line-of-sight within 960px. */
  teamVisible(target, now) {
    if (!target || !target.alive || target.isUntargetable()) return false;
    const start = this.positionAt(now), end = target.positionAt(now);
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) > 960) return false;
    const rect = target.map_rect || target.mapRect;
    return this.arena.geometry.wallContact(start, end, 0,
      { exclude: rect ? [rect] : [] }) === null;
  }
}

export { SLOTS as GHOST_SLOTS, FORM_BUFFS, EMBERS };
