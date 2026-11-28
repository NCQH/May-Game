/* Time Goddess (tank 10000113): energy ammunition, sleep, life-bound rewind and
 * guardians. Port of server/timegoddess_actions.py.
 *
 * Stubs: presentation/skin only; the guardian reuses HuluTurret.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, rectContact } from '../math.js';
import { scene, encodeS1556, encodeS1572 } from '../protocol.js';
import { enemies, piercingStep } from './melee.js';
import { HuluTurret } from './hulu.js';

const SLOTS = { 0: 389100, 1: 389201, 2: 389301, 10: 389401 };

function clearLine(actor, start, end, now) {
  return actor.arena.geometry.wallContact(start, end) === null
    && rectContact(start, end, actor.arena.waterRects(now), 0) === null;
}

export class TimeGoddessActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = 100;
    this.time_combat_until = 0;
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    })];
  }

  _resource(delta) {
    if (!this.alive || this.inStasis()) return [];
    const old = this.mp;
    this.mp = Math.max(0, Math.min(100, this.mp + delta));
    return this.mp !== old ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  on_spawn(now) {
    this.mp = 100;
    this.time_combat_until = now;
    this._queue(now + 500, 'time_energy', this.generation);
    return [scene({ mp: [{ objectId: this.id, mp: 100 }] })];
  }

  on_combat(now) { this.time_combat_until = now + 4000; }

  on_damage(source, hit, now, school, reflected, attacker_ap) {
    if (this.arena.pk && this.arena.pk.finished) return [];
    if (hit.potential_damage.gt(0)) this.on_combat(now);
    return [];
  }

  _flight(flight, now) {
    if (flight.template === 389100) {
      const start = pointAt(flight.start, flight.end,
        (flight.previous - flight.begin) / (flight.finish - flight.begin));
      const end = pointAt(flight.start, flight.end,
        Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
      const targets = enemies(this).concat([...this.arena.actors.values()].filter(a =>
        a.id !== this.id && a.alive && a.camp === this.camp
        && !a.info.npc_template && !a.inStasis()));
      const contacts = [];
      for (const target of targets) {
        const hit = actorContact(start, end, target, flight.previous, now, 24);
        if (hit !== null) contacts.push([hit, target.id, target]);
      }
      contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (contacts.length) {
        const target = contacts[0][2];
        if (target.camp !== this.camp && this.projectileBlocked(target, now)) {
          return [scene({ expiredBullets: [flight.id] })];
        }
        return this._impact(flight, target, now).concat([scene({ blownBullets: [flight.id] })]);
      }
      if (now >= flight.finish) return [scene({ expiredBullets: [flight.id] })];
      flight.previous = now;
      this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
      return [];
    }
    if (flight.template === 389201) {
      return piercingStep(this, flight, now, (f, t, n) => this._impact(f, t, n),
        { pierce: false, contactRadius: 36 });
    }
    return super._flight(flight, now);
  }

  _impact(flight, target, now) {
    if (flight.template === 389201) {
      const packets = this.damage(flight.raw, now, {
        target, school: 'energy', source_generation: flight.source_generation,
      })[0];
      if (this.arena.pk && this.arena.pk.finished) return packets;
      return packets.concat(this._buff(389202, now, target.id),
        this._buff(389203, now, target.id));
    }
    const pos = target.positionAt(now);
    const packets = [];
    for (const enemy of enemies(this, { area: true })) {
      const tpos = enemy.positionAt(now);
      if (Math.hypot(pos[0] - tpos[0], pos[1] - tpos[1]) > 144) continue;
      if (rectContact(pos, tpos, this.arena.waterRects(now), 0) !== null) continue;
      const distance = Math.min(720,
        Math.hypot(flight.start[0] - tpos[0], flight.start[1] - tpos[1]));
      const factor = D('.5').add(D(String(distance / 1440)));
      packets.push(...this.damage(flight.power.mul(factor), now, {
        target: enemy, school: 'energy', basic: true,
        ignore_reductions: distance >= 720,
        source_generation: flight.source_generation,
      })[0]);
      if (this.arena.pk && this.arena.pk.finished) return packets;
    }
    for (const ally of this.arena.actors.values()) {
      const apos = ally.positionAt(now);
      if (ally.alive && ally.camp === this.camp && !ally.info.npc_template
        && Math.hypot(pos[0] - apos[0], pos[1] - apos[1]) <= 144
        && clearLine(this, pos, apos, now)) {
        if (ally.id !== this.id || this.generation === flight.source_generation) {
          packets.push(...ally.restoreHp(flight.power, now));
        }
      }
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'time_energy') {
      const [generation] = data;
      if (!this.alive || this.generation !== generation) return [];
      this._queue(now + 500, kind, generation);
      return now >= this.time_combat_until ? this._resource(10) : [];
    }
    if (kind === 'time_reload') {
      const [generation, version] = data;
      if (this.alive && this.generation === generation
        && this.buffVersions.get(389121) === version) {
        return this.removeBuff(389121, now).concat(this._resource(100));
      }
      return [];
    }
    if (kind === 'time_rewind') {
      const [cast] = data;
      const target = this.arena.actors.get(cast.target);
      if (!target || !target.alive || target.inStasis()
        || target.generation !== cast.target_generation
        || target.buffVersions.get(389301) !== cast.version) return [];
      const packets = target.removeBuff(389301, now).concat(target.removeBuff(389305, now));
      return packets.concat(target.commitHp(target.maxHp.min(cast.hp), now),
        this._buff(389302, now, target.id));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (this.arena.pk && this.arena.pk.finished) return [];
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (!this._inside(dest) || ((slot === 0 || slot === 1)
      && start[0] === dest[0] && start[1] === dest[1])) return [];
    if ([2, 10].includes(slot)
      && Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 480) return [];
    if (slot === 0 && this.mp < 20) return [];
    if (slot === 10) {
      const clamped = this.arena.geometry.clampTankPosition(dest);
      if (clamped[0] !== dest[0] || clamped[1] !== dest[1]
        || this.arena.geometry.wallContact(dest, dest, 36) !== null
        || rectContact(dest, dest, this.arena.waterRects(now), 36) !== null) return [];
    }
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + (slot === 0 ? this.fireInterval(now)
      : this.skillCooldown({ 1: 8000, 2: 30000, 10: 8000 }[slot], slot));
    this.on_combat(now);
    const packets = [this._cooldown(slot)];
    if (slot === 0 || slot === 1) {
      packets.push(...this.shoot(SLOTS[slot], start, dest, now,
        power.mul(slot === 0 ? D(1) : D('1.75')), {
          school: 'energy', basic: slot === 0, through_walls: true, power,
        }));
      if (slot === 0) {
        packets.push(...this._resource(-20));
        if (this.mp === 0) {
          // Queue before natural expiry so a version check survives a checkpoint.
          const version = (this.buffVersions.get(389121) ?? 0) + 1;
          this._queue(now + 1000, 'time_reload', this.generation, version);
          packets.push(...this._buff(389121, now));
        }
      }
      return packets;
    }
    packets.push(scene({ skills: [this._skillEvent(SLOTS[slot], start, dest)] }));
    if (slot === 2) {
      for (const ally of [...this.arena.actors.values()]) {
        const apos = ally.positionAt(now);
        if (!ally.alive || ally.camp !== this.camp || ally.info.npc_template
          || ally.inStasis()
          || Math.hypot(dest[0] - apos[0], dest[1] - apos[1]) > 300
          || !clearLine(this, dest, apos, now) || !clearLine(this, start, apos, now)) continue;
        const cast = {
          target: ally.id, target_generation: ally.generation, hp: ally.hp,
          version: (ally.buffVersions.get(389301) ?? 0) + 1,
        };
        this._queue(now + 2000, 'time_rewind', cast);
        packets.push(...this._buff(389301, now, ally.id), ...this._buff(389305, now, ally.id));
        // Falcon ammunition and Minion components are not energy.
        if (typeof ally._resource === 'function'
          && ![10000104, 10000060].includes(ally.info.tank_id)) {
          packets.push(...ally._resource(100));
        }
      }
      return packets.concat(this._buff(389304, now));
    }
    const info = {
      acct_id: this.info.acct_id, tank_id: this.info.tank_id,
      tank_level: this.info.tank_level, npc_template: 389401, owner: this.id,
      source_generation: this.generation, name: 'Thủ Hộ Thời Gian', in_room: true,
      summon_stats: { ...this.stats },
    };
    for (const key of ['iAttack', 'iEgAtk', 'iArmor', 'iEgArmor', 'iCentesis', 'iEgCtsis']) {
      info.summon_stats[key] = this.combatStat(key, now).toString();
    }
    Object.assign(info.summon_stats, {
      iHp: this.maxHp.mul(D('.5')).toString(), iSpeed: '0',
      iFireInterv: '1000', nFireRange: '0',
    });
    const guardian = new TimeGuardian(this.arena, this._newId(5), info, this.camp, dest);
    this.arena.actors.set(guardian.id, guardian);
    return packets.concat([guardian.snapshot(now)], guardian.on_spawn(now));
  }
}

export class TimeGuardian extends HuluTurret {
  snapshot(now) {
    return [1556, encodeS1556(this.sceneId, {
      objectId: this.id, templateId: 389401, x: this.positionAt(now)[0],
      y: this.positionAt(now)[1], hp: this.hp.ceil(), camp: this.camp,
      maxHp: this.maxHp.ceil(), ownerId: this.info.owner, shield: 0, buffs: [],
    })];
  }

  taunt_attack() { return []; }

  on_spawn(now) {
    this._queue(now + 1000, 'time_guardian');
    return this._buff(389402, now).concat(this._buff(389403, now));
  }

  _event(now, kind, data) {
    if (kind === 'time_guardian') {
      if (!this.alive) return [];
      const packets = this.commitHp(this.hp.sub(this.maxHp.mul(D('.08'))).max(D(0)), now);
      if (!this.alive || (this.arena.pk && this.arena.pk.finished)) return packets;
      if (!this.blocked('attack', now) && !this.skillSealed(0, now)) {
        const pos = this.positionAt(now);
        const owner = this.arena.actors.get(this.info.owner);
        for (const ally of this.arena.actors.values()) {
          const apos = ally.positionAt(now);
          if (!ally.alive || ally.camp !== this.camp || ally.info.npc_template
            || Math.hypot(pos[0] - apos[0], pos[1] - apos[1]) > 300
            || !clearLine(this, pos, apos, now)) continue;
          if (owner === ally && owner.generation !== this.info.source_generation) continue;
          packets.push(...ally.restoreHp(D(this.stats.iEgAtk).mul(D('.75')), now));
        }
      }
      this._queue(now + 1000, kind);
      return packets;
    }
    return super._event(now, kind, data);
  }
}

export { SLOTS as TIMEGODDESS_SLOTS };
