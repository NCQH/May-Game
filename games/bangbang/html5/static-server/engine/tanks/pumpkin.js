/* Pumpkin (tank 10000052): traps, finite soul volleys, NPC20001 ghosts.
 * Port of server/pumpkin_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin; `observable` is folded into teamVisible on the
 * core (fog is not modelled). Ghosts retire through retireSummon.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, circleContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1556, encodeS1562, encodeS1572 } from '../protocol.js';
import { aimed, enemies, packII, prepareDisplacement } from './melee.js';
import { acceptWaterReclip } from './batch-e-common.js';
import { retireSummon, teamVisible } from './batch-c-common.js';

const SLOTS = { 0: 327100, 1: 327201, 2: 327301, 10: 327401 };

export class PumpkinActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.e_count = 2;
    this.e_next_charge = 0;
    this.ready = this.volley = null;
  }

  _cooldown(slot) {
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: slot === 1 ? this.e_count : -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: slot === 1 ? this.e_next_charge : 0,
    })];
  }

  on_spawn(now) {
    this.ready = this.volley = null;
    return this._buff(327102, now);
  }

  _speed(now) { return this.ready ? 0 : super._speed(now); }
  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      this.ready = null;
      packets.push([1583, packII(this.id, 327301)]);
    }
    if (!this.alive && this.volley) {
      this.volley = null;
      this.cooldowns[10] = now + this.skillCooldown(10000, 10);
      packets.push(this._cooldown(10));
    }
    return packets.concat(this.syncSpeed(now));
  }

  onControl(source, template, now) {
    if (!this.ready) return [];
    const kind = Number(this.arena.data.tableRow('BuffTemplate_table.xml',
      { nBuffId: template }).get('nEffectType'));
    return [30, 35, 66].includes(kind) ? this.interrupt(now) : [];
  }

  update(now) {
    const packets = [];
    while (this.e_next_charge && this.e_next_charge <= now) {
      this.e_count = Math.min(2, this.e_count + 1);
      this.e_next_charge = this.e_count < 2
        ? this.e_next_charge + this.skillCooldown(8000) : 0;
      packets.push(this._cooldown(1));
    }
    return packets.concat(super.update(now));
  }

  _summonStats(now) {
    const stats = { ...this.stats };
    for (const key of ['iAttack', 'iEgAtk', 'iArmor', 'iEgArmor', 'iCentesis', 'iEgCtsis']) {
      stats[key] = this.combatStat(key, now).toString();
    }
    Object.assign(stats, {
      iHp: this.maxHp.mul(D('.5')).toString(), iSpeed: '150',
      iFireInterv: '1500', nFireRange: '96',
    });
    return stats;
  }

  onTargetDeath(target, now) {
    if (!this.alive || target.camp === this.camp || target.info.npc_template) return [];
    const owners = [...this.arena.actors.values()].filter(actor => actor.alive
      && actor.camp === this.camp && Number(actor.info.tank_id) === 10000052
      && !actor.info.npc_template).map(actor => actor.id);
    if (this.id === Math.min(...owners)) {
      this._queue(now, 'pumpkin_spawn', target.positionAt(now), this._summonStats(now),
        this.generation);
    }
    return [];
  }

  _spawnGhost(pos, stats, generation, now) {
    const spawn = this.blinkDestination(this.positionAt(now), pos);
    const info = {
      acct_id: this.info.acct_id, tank_level: this.info.tank_level, npc_template: 20001,
      owner: this.id, source_generation: generation, tank_id: 10000052,
      name: 'Hồn Bí Ngô', in_room: true, summon_stats: { ...stats },
    };
    const ghost = new PumpkinGhost(this.arena, this._newId(5), info, this.camp, spawn);
    this.arena.actors.set(ghost.id, ghost);
    return [ghost.snapshot(now)].concat(ghost.on_spawn(now));
  }

  _explosion(flight, pos, now) {
    const span = Math.min(960, Math.hypot(flight.start[0] - pos[0], flight.start[1] - pos[1]));
    const raw = flight.power.mul(D('1.11').add(D('6.66').mul(D(String(span))).div(D(960))));
    const packets = [];
    for (const target of enemies(this, { area: true })) {
      if (Math.hypot(pos[0] - target.positionAt(now)[0],
        pos[1] - target.positionAt(now)[1]) <= 192) {
        packets.push(...this.damage(raw, now, { target, school: 'energy' })[0],
          ...this._buff(327302, now, target.id));
      }
    }
    const [ident, packet] = this.addObject(327303, pos);
    packets.push(packet);
    this._queue(now + 1000, 'pumpkin_portal', {
      id: ident, pos, stats: flight.context.stats, generation: flight.source_generation,
    }, 1);
    return packets;
  }

  _flight(flight, now) {
    const template = flight.template;
    if (template === 327100) return super._flight(flight, now);
    if (template === 327201) {
      if (now < flight.finish) {
        flight.previous = now;
        this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
        return [];
      }
      const [obj, packet] = this.addObject(327201, flight.end);
      this._queue(now, 'pumpkin_trap', {
        id: obj, pos: flight.end, power: flight.power, end: now + 45000,
        generation: flight.source_generation,
      });
      return [scene({ blownBullets: [flight.id] }), packet];
    }
    if (template === 327411) {
      const target = this.arena.actors.get(flight.target);
      if (!target || !target.alive || target.generation !== flight.target_generation) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      const start = flight.pos, dest = target.positionAt(now);
      const end = pointAt(start, dest, Math.min(1, flight.speed * (now - flight.previous)
        / 1000 / Math.max(1, Math.hypot(start[0] - dest[0], start[1] - dest[1]))));
      const packets = [];
      if (dest[0] !== flight.end[0] || dest[1] !== flight.end[1]) {
        packets.push([1562, encodeS1562(flight.id, start, dest)]);
        flight.end = dest;
      }
      const contact = circleContact(start, end, target.positionAt(flight.previous), dest);
      if (contact !== null) {
        if (this.projectileBlocked(target, now)) {
          return packets.concat([scene({ expiredBullets: [flight.id] })]);
        }
        packets.push(...this.damage(flight.raw, now, { target, school: 'energy' })[0]);
        if (this.alive && this.generation === flight.source_generation) {
          packets.push(...this.restoreHp(this.maxHp.sub(this.hp).mul(D('.05')), now));
        }
        return packets.concat([scene({ blownBullets: [flight.id] })]);
      }
      if (now >= flight.finish) return packets.concat([scene({ expiredBullets: [flight.id] })]);
      flight.pos = end;
      flight.previous = now;
      this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
      return packets;
    }
    const start = pointAt(flight.start, flight.end,
      (flight.previous - flight.begin) / (flight.finish - flight.begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
    const contacts = [];
    for (const target of enemies(this)) {
      const hit = actorContact(start, end, target, flight.previous, now);
      if (hit !== null) contacts.push([hit, target.id, target]);
    }
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const hit = contacts.length ? contacts[0] : null;
    if (hit && this.projectileBlocked(hit[2], now)) {
      return [scene({ expiredBullets: [flight.id] })];
    }
    if (hit || now >= flight.finish) {
      const pos = pointAt(start, end, hit ? hit[0] : 1).map(pyRound);
      return [scene({ blownBullets: [flight.id] })].concat(this._explosion(flight, pos, now));
    }
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return [];
  }

  _event(now, kind, data) {
    if (kind === 'pumpkin_spawn') return this._spawnGhost(...data, now);
    if (kind === 'pumpkin_portal') {
      const [cast, index] = data;
      const packets = this._spawnGhost(cast.pos, cast.stats, cast.generation, now);
      if (index < 6) this._queue(now + 1000, kind, cast, index + 1);
      else packets.push(...this.removeObject(cast.id));
      return packets;
    }
    if (kind === 'pumpkin_trap') {
      const [cast] = data;
      if (now >= cast.end) return this.removeObject(cast.id);
      const candidates = [...this.arena.actors.values()].filter(actor => actor.alive
        && !actor.isUntargetable()
        && Math.hypot(cast.pos[0] - actor.positionAt(now)[0],
          cast.pos[1] - actor.positionAt(now)[1]) <= 96);
      if (!candidates.length) {
        this._queue(Math.min(now + 50, cast.end), kind, cast);
        return [];
      }
      candidates.sort((a, b) => (Math.hypot(cast.pos[0] - a.positionAt(now)[0],
        cast.pos[1] - a.positionAt(now)[1]) - Math.hypot(cast.pos[0] - b.positionAt(now)[0],
        cast.pos[1] - b.positionAt(now)[1])) || a.id - b.id);
      const target = candidates[0];
      const packets = this.removeObject(cast.id, { destroyed: true });
      if (target.camp === this.camp) {
        return packets.concat(target.restoreHp(cast.power.mul(D('1.27')), now),
          this._buff(327222, now, target.id));
      }
      packets.push(...this.damage(cast.power.mul(D('2.15')), now,
        { target, school: 'energy' })[0]);
      if (this.arena.pk && this.arena.pk.finished) return packets;
      if (!target.alive || target.ccImmune(now)) return packets;
      const pos = target.positionAt(now);
      const direction = pos[0] !== cast.pos[0] || pos[1] !== cast.pos[1]
        ? pos : [pos[0] + 1, pos[1]];
      let dest = aimed(cast.pos, direction,
        Math.hypot(cast.pos[0] - pos[0], cast.pos[1] - pos[1]) + 240, { fixed: true });
      const [body, stopped] = prepareDisplacement(target, now, { interrupt: false });
      let origin = body;
      if (!stopped.length) origin = pos;
      packets.push(...stopped);
      dest = target.moveDestination(origin, dest);
      const wall = this.arena.geometry.wallContact(origin, dest, 36);
      if (wall !== null) dest = pointAt(origin, dest, Math.max(0, wall - 0.001)).map(pyRound);
      target._setMotion(origin, dest, 480, now, 1);
      target.forcedUntil = target.motion[3];
      Object.assign(cast, {
        target: target.id, target_generation: target.generation, previous: now,
        motion: target.motion,
        wall: Math.hypot(origin[0] - dest[0], origin[1] - dest[1]) < 239.5,
      });
      this._queue(now + 20, 'pumpkin_push', cast);
      return packets.concat(this._buff(327214, now, target.id), [scene({
        moves: [this._moveEvent(target.motion[1], 480, 1, target.id)],
      })]);
    }
    if (kind === 'pumpkin_push') {
      const [cast] = data;
      const target = this.arena.actors.get(cast.target);
      if (!target || !target.alive || target.generation !== cast.target_generation) return [];
      if (target.motion !== cast.motion) {
        if (!acceptWaterReclip(target, cast)) return [];
        cast.motion = target.motion;
        cast.previous = Math.max(cast.previous, target.motion[2]);
        cast.wall = true;
      }
      const start = target.positionAt(cast.previous), end = target.positionAt(now);
      const contacts = [];
      for (const actor of this.arena.actors.values()) {
        if (actor === target || !actor.alive || actor.isUntargetable()) continue;
        const hit = actorContact(start, end, actor, cast.previous, now);
        if (hit !== null) contacts.push([hit, actor.id, actor]);
      }
      if (contacts.length) {
        contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const [hit, , other] = contacts[0];
        target.position = target.moveDestination(start, pointAt(start, end, hit));
        target.motion = null;
        target.forcedUntil = now;
        return [scene({ moves: [this._moveEvent(target.position, 0, 5, target.id)] })].concat(
          this._buff(327231, now, target.id), this._buff(327232, now, other.id));
      }
      if (!target.motion || now >= target.motion[3]) {
        return cast.wall || (target.motion && target.motion !== cast.motion)
          ? this._buff(327231, now, target.id) : [];
      }
      cast.previous = now;
      this._queue(Math.min(now + 20, target.motion[3]), kind, cast);
      return [];
    }
    if (kind === 'pumpkin_volley') {
      const [cast, index] = data;
      if (this.volley !== cast || !this.alive) return [];
      const packets = [];
      const pos = this.positionAt(now);
      const targets = enemies(this).filter(target => Math.hypot(pos[0] - target.positionAt(now)[0],
        pos[1] - target.positionAt(now)[1]) <= 600 && teamVisible(this, target, now));
      if (targets.length) {
        targets.sort((a, b) => (Math.hypot(pos[0] - a.positionAt(now)[0],
          pos[1] - a.positionAt(now)[1]) - Math.hypot(pos[0] - b.positionAt(now)[0],
          pos[1] - b.positionAt(now)[1])) || a.id - b.id);
        const target = targets[0];
        packets.push(...this.shoot(327411, pos, target.positionAt(now), now,
          cast.power.mul(D('.65')), {
            school: 'energy', target, through_walls: true,
          }));
      }
      if (index < 10) this._queue(now + 500, kind, cast, index + 1);
      else {
        this.volley = null;
        this.cooldowns[10] = now + this.skillCooldown(10000, 10);
        packets.push(...this.removeBuff(327401, now), ...this.removeBuff(327402, now),
          this._cooldown(10));
      }
      return packets;
    }
    if (kind === 'pumpkin_ready') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      return this.shoot(327301, this.positionAt(now), cast.dest, now, D(0), {
        school: 'energy', power: cast.power, through_walls: true, context: cast,
      }).concat(this.syncSpeed(now));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || !this.alive || this.blocked('attack', now)
      || this.skillSealed(slot, now) || this.cooldowns[slot] > now) return [];
    if (([0, 2].includes(slot) && start[0] === dest[0] && start[1] === dest[1])
      || (slot === 1 && (!this.e_count
        || Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 480))
      || (slot === 10 && this.volley)) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + {
      0: this.fireInterval(now), 1: 4000, 2: this.skillCooldown(30000, 2),
      10: 5000 + this.skillCooldown(10000, 10),
    }[slot];
    if (slot === 0) {
      return this.shoot(327100, start, dest, now, power,
        { school: 'energy', basic: true }).concat([this._cooldown(0)]);
    }
    if (slot === 1) {
      this.e_count -= 1;
      if (!this.e_next_charge) this.e_next_charge = now + this.skillCooldown(8000);
      return this.shoot(327201, start, dest, now, D(0), {
        school: 'energy', power, through_walls: true, fixed_destination: true,
      }).concat([this._cooldown(1)]);
    }
    if (slot === 2) {
      this.ready = {
        slot: 2, skill: 327301, dest, power, stats: this._summonStats(now),
      };
      const [, stopped] = prepareDisplacement(this, now, { interrupt: false });
      this.position = this.positionAt(now);
      this.motion = null;
      this._queue(now + 500, 'pumpkin_ready', this.ready);
      return [scene({
        skills: [this._skillEvent(327301, start, dest, 0, { ready: 1 })],
      }), this._cooldown(2)].concat(this.syncSpeed(now), stopped);
    }
    this.volley = { power, generation: this.generation };
    this._queue(now + 500, 'pumpkin_volley', this.volley, 1);
    return this._buff(327401, now).concat(this._buff(327402, now), [this._cooldown(10)]);
  }
}

export class PumpkinGhost extends TankActions {
  taunt_mobile = true;

  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.stats = { ...info.summon_stats };
    this.hp = this.maxHp = D(this.stats.iHp);
    this.info.hp = this.info.max_hp = this.hp.ceil();
    this.cooldowns = {};
    this.passive_ready_at = 0;
  }

  snapshot(now) {
    const pos = this.positionAt(now);
    return [1556, encodeS1556(this.sceneId, {
      objectId: this.id, templateId: 20001, x: pos[0], y: pos[1], hp: this.hp.ceil(),
      camp: this.camp, maxHp: this.maxHp.ceil(), ownerId: this.info.owner,
      shield: this.shieldAmount(now).ceil(), buffs: [],
    })];
  }

  syncSpeed() { return []; }

  on_spawn(now) {
    this._queue(now + 1000, 'pumpkin_decay', 1);
    this._queue(now + 100, 'pumpkin_ai');
    return this._buff(327122, now);
  }

  commitHp(hp, now, { critical = false } = {}) {
    const before = this.alive;
    const packets = super.commitHp(hp, now, { critical });
    if (before && !this.alive) {
      packets.push(scene({ removedObjects: [this.id] }));
      this._queue(now, 'pumpkin_death', this.positionAt(now), this.combatStat('iEgAtk', now));
    }
    return packets;
  }

  _flight(flight, now) {
    const target = this.arena.actors.get(flight.target);
    if (now < flight.finish) {
      flight.previous = now;
      this._queue(flight.finish, 'flight', flight);
      return [];
    }
    const packets = [scene({ blownBullets: [flight.id] })];
    if (target && target.alive && target.generation === flight.target_generation
      && !this.projectileBlocked(target, now)) {
      packets.push(...this.damage(flight.raw, now, { target, school: 'energy' })[0],
        ...this._buff(327113, now, target.id));
    }
    return packets;
  }

  taunt_attack(target, now) {
    const pos = this.positionAt(now), dest = target.positionAt(now);
    if (!this.alive || !target.alive || target.isUntargetable()
      || this.blocked('attack', now) || this.skillSealed(0, now)
      || now < this.passive_ready_at
      || Math.hypot(pos[0] - dest[0], pos[1] - dest[1]) > 96) return [];
    this.passive_ready_at = now + this.fireInterval(now);
    return this.shoot(327112, pos, dest, now, this.combatStat('iEgAtk', now).mul(D('.5')), {
      school: 'energy', target, through_walls: true,
    });
  }

  _event(now, kind, data) {
    if (kind === 'pumpkin_death') {
      const [pos, power] = data;
      const packets = [scene({ skills: [this._skillEvent(327121, pos, pos)] })];
      for (const target of enemies(this, { area: true })) {
        if (Math.hypot(pos[0] - target.positionAt(now)[0],
          pos[1] - target.positionAt(now)[1]) <= 168) {
          packets.push(...this.damage(power.mul(D('1.5')), now,
            { target, school: 'energy' })[0]);
        }
      }
      return packets;
    }
    if (kind === 'pumpkin_decay') {
      if (!this.alive) return [];
      const [index] = data;
      const packets = this.commitHp(index < 120
        ? this.hp.sub(this.maxHp.mul(D('.125'))).max(D(0)) : D(0), now);
      if (this.alive) this._queue(now + 1000, kind, index + 1);
      return packets;
    }
    if (kind === 'pumpkin_ai') {
      if (!this.alive) return [];
      this._queue(now + 100, kind);
      const packets = [];
      if (this.blocked('attack', now)) return packets;
      const pos = this.positionAt(now);
      const candidates = enemies(this).filter(target =>
        teamVisible(this, target, now));
      if (!candidates.length) return packets;
      candidates.sort((a, b) => (Math.hypot(pos[0] - a.positionAt(now)[0],
        pos[1] - a.positionAt(now)[1]) - Math.hypot(pos[0] - b.positionAt(now)[0],
        pos[1] - b.positionAt(now)[1])) || a.id - b.id);
      const target = candidates[0], dest = target.positionAt(now);
      const span = Math.hypot(pos[0] - dest[0], pos[1] - dest[1]);
      if (span > 96) {
        if (!this.blocked('move', now) && this._speed(now) > 0) {
          this._setMotion(pos, aimed(pos, dest, Math.max(0, span - 90)),
            this._speed(now), now, 3);
          packets.push(scene({ moves: [this._moveEvent(this.motion[1],
            this._speed(now), 3, this.id)] }));
        }
      } else {
        if (this.motion && now >= this.forcedUntil) {
          this.position = pos;
          this.motion = null;
          packets.push(scene({ moves: [this._moveEvent(pos, 0, 5, this.id)] }));
        }
        packets.push(...this.taunt_attack(target, now));
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  _respawn(now, generation) { return retireSummon(this, now, generation); }
}

export { SLOTS as PUMPKIN_SLOTS, PumpkinGhost as PUMPKIN_GHOST };
