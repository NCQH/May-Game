/* Teddy Bear (tank 10000032): basics mark, ally heal, delayed splash rocket.
 * Port of server/teddy_actions.py onto the JS battle core.
 *
 * Stubs: presentation only. Q/Space keep the user-approved slow and split
 * radii; E is usable during stuns (iUseInStun=1).
 */
import { TankActions, parseBkey } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';

const SLOTS = { 0: 306100, 1: 306201, 2: 306301 };

export class TeddyActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.cooldowns = { 0: 0, 1: 0, 2: 0 };
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    })];
  }

  onBulletHit(flight, target, now) {
    if (flight.template !== 306100) return [];
    const packets = [];
    for (const template of [306101, 306102, 306103]) {
      packets.push(...this._buff(template, now, target.id));
    }
    return packets;
  }

  _flight(flight, now) {
    if (flight.template !== 306301) return super._flight(flight, now);
    const { begin, finish, previous } = flight;
    const start = pointAt(flight.start, flight.end, (previous - begin) / (finish - begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - begin) / (finish - begin)));
    for (const target of [...this.arena.actors.values()]) {
      if (target.alive && target.camp !== this.camp && this.projectileBlocked(target, now)
        && actorContact(start, end, target, previous, now) !== null) {
        return [scene({ expiredBullets: [flight.id] })];
      }
    }
    if (now < finish) {
      flight.previous = now;
      this._queue(Math.min(now + 20, finish), 'flight', flight);
      return [];
    }
    const packets = [scene({ blownBullets: [flight.id] })];
    for (const target of [...this.arena.actors.values()]) {
      const span = Math.hypot(flight.end[0] - target.positionAt(now)[0],
        flight.end[1] - target.positionAt(now)[1]);
      if (!target.alive || target.camp === this.camp || span > 216) continue;
      // Original chain damages first; each Effect keeps its own radius.
      packets.push(...this.damage(flight.raw, now, { target, school: 'energy' })[0]);
      if (span <= 144) {
        for (const template of [306311, 306321, 306331, 306341]) {
          packets.push(...this._buff(template, now, target.id));
        }
      }
    }
    return packets;
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || !this.alive || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    // iUseInStun=1. Client still enforces its own silence/slot restrictions.
    if (slot !== 1 && this.blocked('attack', now)) return [];
    if (slot !== 1 && (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1]))) {
      return [];
    }
    if (slot === 2 && Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 528) return [];
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 8000, 2: 25000 }[slot], slot);
    let packets;
    if (slot === 0) {
      packets = this.shoot(306100, start, dest, now, this.combatStat('iEgAtk', now),
        { school: 'energy', basic: true });
    } else if (slot === 1) {
      packets = [scene({ skills: [this._skillEvent(306201, start, start, this.id)] })];
      const allies = [...this.arena.actors.values()]
        .filter(a => a.id !== this.id && a.camp === this.camp && a.alive && !a.info.map_object)
        .sort((a, b) => (Math.hypot(start[0] - a.positionAt(now)[0],
          start[1] - a.positionAt(now)[1]) - Math.hypot(start[0] - b.positionAt(now)[0],
          start[1] - b.positionAt(now)[1])) || a.id - b.id)
        .slice(0, 2);
      for (const target of [this, ...allies]) {
        packets.push(...target.restoreHp(target.maxHp.mul(D('.2')), now));
      }
      for (const key of [...this.activeBuffs.keys()]) {
        const [owner, template] = parseBkey(key);
        if (owner === this.id && this.arena.data
          .tableRow('BuffTemplate_table.xml', { nBuffId: template }).get('iAspect') === '-1') {
          packets.push(...this.removeBuff(template, now));
        }
      }
    } else {
      // Exhibit902 is a six-frame projectile, interpolated by travel distance.
      // Detonates at the selected point after travel, ignoring mid-flight tanks.
      const ident = this._newId(2);
      const factor = this.hasBuff(10400233, now) ? 1.15 : 1;
      const speed = Math.max(1, pyRound(Math.hypot(dest[0] - start[0], dest[1] - start[1]) * factor));
      const flight = {
        kind: 'bullet', template: 306301, id: ident, start, end: dest,
        begin: now, finish: now + pyRound(1000 / factor), previous: now, speed,
        raw: this.combatStat('iEgAtk', now).mul(D('3.79')),
        source_generation: this.generation, school: 'energy', basic: false,
      };
      this._queue(now + 20, 'flight', flight);
      packets = [scene({ fires: [{
        bulletId: ident, ownerId: this.id, start, dest, speed, templateId: 306301,
      }] })];
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as TEDDY_SLOTS };
