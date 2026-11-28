/* Kurumi (tank 10000095): counted E, snapshot clones, launch-time slowing.
 * Port of server/kurumi_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. Clones are native actors retired by summon.
 */
import { TankActions } from '../arena.js';
import { D, pointAt, pyRound, quantize, rectContact } from '../math.js';
import { scene, encodeS1556, encodeS1562, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, inStrip, packII, prepareDisplacement } from './melee.js';
import { retireSummon, teamVisible } from './batch-c-common.js';

const SLOTS = { 0: 370100, 1: 370201, 2: 370301, 10: 370401 };

export class KurumiActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = null;
    this.combo_count = 0;
    this.combo_until = 0;
  }

  _basic(now) {
    if (this.hasBuff(370207, now)) return 370220;
    if (this.hasBuff(370203, now)) return 370210;
    if (this.hasBuff(370204, now)) return 370211;
    return 370100;
  }

  _cooldown(slot, changed = false) {
    const skill = slot === 0 ? this._basic(this.clock()) : SLOTS[slot];
    const info = { skillId: skill, slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0 };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.ready = null;
    this.combo_count = this.combo_until = 0;
    return [this._cooldown(0, true)];
  }

  removeBuff(template, now, { expired = false } = {}) {
    const active = this.hasBuff(template, now) || this.activeBuffs.has(`${this.id},${template}`);
    const packets = super.removeBuff(template, now, { expired });
    if (active && [370203, 370207].includes(template) && !this.info.npc_template) {
      packets.push(this._cooldown(0, true));
    }
    return packets;
  }

  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  _speed(now) { return this.ready ? 0 : super._speed(now); }
  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      this.ready = null;
      packets.push([1583, packII(this.id, 370301)]);
    }
    return packets.concat(this.syncSpeed(now));
  }

  onControl(source, template, now) {
    const kind = Number(this.arena.data.tableRow('BuffTemplate_table.xml',
      { nBuffId: template }).get('nEffectType'));
    return this.ready && [30, 35, 66].includes(kind) ? this.interrupt(now) : [];
  }

  _refund(now, generation) {
    if (!this.alive || this.generation !== generation || this.cooldowns[1] <= now) return [];
    this.cooldowns[1] = Math.max(now, this.cooldowns[1] - 500);
    return [this._cooldown(1)];
  }

  onBulletHit(flight, target, now) {
    return flight.template === 370100 ? this._refund(now, flight.source_generation) : [];
  }

  _beam(start, dest, now, template) {
    let end = aimed(start, dest, 600, { fixed: true });
    const wall = rectContact(start, end, this.arena.waterRects(now));
    if (wall !== null) end = pointAt(start, end, Math.max(0, wall - 0.001)).map(pyRound);
    const packets = [scene({ skills: [this._skillEvent(template, start, end)] })];
    const power = this.combatStat('iAttack', now);
    const generation = this.generation;
    let hit = false;
    for (const target of enemies(this, { area: true })) {
      const pos = target.positionAt(now);
      if (!inStrip(pos, start, end,
        Math.hypot(end[0] - start[0], end[1] - start[1]), 48)) continue;
      packets.push(...this.damage(
        power.mul(D('2.25')).mul(template === 370220 ? D(2) : D(1)), now, {
          target, basic: true, critical_display: template === 370220,
        })[0]);
      packets.push(...this._refund(now, generation));
      if (template === 370220) packets.push(...this._buff(370221, now, target.id));
      hit = true;
    }
    if (hit && this.alive && this.generation === generation && template !== 370211) {
      if (template === 370220) packets.push(...this.restoreHp(power.mul(D('2.09')), now));
      else {
        this.combo_count = Math.min(2, (now < this.combo_until ? this.combo_count : 0) + 1);
        this.combo_until = now + 10000;
        packets.push(...this.removeBuff(370205, now), ...this.removeBuff(370206, now));
        packets.push(...this._buff(370204 + this.combo_count, now));
      }
    }
    for (const buff of [370203, 370204, 370207, 370209, 370231]) {
      packets.push(...this.removeBuff(buff, now));
    }
    return packets;
  }

  _flight(flight, now) {
    if (flight.template !== 370301) return super._flight(flight, now);
    if (now < flight.finish) {
      flight.previous = now;
      this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
      return [];
    }
    const pos = flight.end;
    const [ident, packet] = this.addObject(370301, pos);
    const [visual, visualPacket] = this.addObject(370307, pos);
    this._queue(now + 3000, 'kurumi_visual_remove', visual);
    this._queue(now, 'kurumi_field', { id: ident, pos, end: now + 3000 });
    const packets = [scene({ blownBullets: [flight.id] }), packet, visualPacket];
    for (const target of enemies(this, { area: true })) {
      if (Math.hypot(pos[0] - target.positionAt(now)[0],
        pos[1] - target.positionAt(now)[1]) <= 192) {
        packets.push(...this._buff(370306, now, target.id));
      }
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'kurumi_visual_remove') return this.removeObject(data[0], { destroyed: true });
    if (kind === 'kurumi_ready') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      return this.shoot(370301, this.positionAt(now), cast.dest, now, D(0), {
        school: 'physical', through_walls: true, fixed_destination: true,
      }).concat(this.syncSpeed(now));
    }
    if (kind === 'kurumi_field') {
      const [cast] = data;
      if (now >= cast.end) return this.removeObject(cast.id);
      const packets = [];
      for (const target of enemies(this, { area: true })) {
        if (Math.hypot(cast.pos[0] - target.positionAt(now)[0],
          cast.pos[1] - target.positionAt(now)[1]) <= 192) {
          for (const buff of [370302, 370303, 370304, 370308]) {
            packets.push(...this._buff(buff, now, target.id));
          }
        }
      }
      this._queue(Math.min(now + 150, cast.end), kind, cast);
      return packets;
    }
    if (kind === 'kurumi_spawn') {
      const [cast] = data;
      const pos = this.arena.freePosition(cast.pos, now);
      if (pos === null) return [];
      const info = {
        acct_id: this.info.acct_id, tank_level: this.info.tank_level, tank_id: 10000095,
        npc_template: 370402, owner: this.id, source_generation: cast.generation,
        name: this.info.name, in_room: true, summon_stats: cast.stats,
        summon_hp: cast.hp.toString(),
      };
      const clone = new KurumiClone(this.arena, this._newId(5), info, this.camp, pos);
      this.arena.actors.set(clone.id, clone);
      return [clone.snapshot(now)].concat(clone.on_spawn(now));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || !this.alive || this.blocked('attack', now)
      || this.skillSealed(slot, now) || this.cooldowns[slot] > now) return [];
    if (!this._inside(dest) || ([0, 1].includes(slot)
      && start[0] === dest[0] && start[1] === dest[1])) return [];
    if (slot === 2 && Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 600) return [];
    if (slot === 10) {
      const clamp = this.arena.geometry.clampTankPosition(dest);
      if (Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 336
        || clamp[0] !== dest[0] || clamp[1] !== dest[1]
        || this.arena.geometry.wallContact(dest, dest, 36 - 0.001) !== null
        || rectContact(dest, dest, this.arena.waterRects(now), 36 - 0.001) !== null) return [];
    }
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 6000, 2: 30000, 10: 8000 }[slot], slot);
    if (slot === 0) {
      const template = this._basic(now);
      const packets = template !== 370100 ? this._beam(start, dest, now, template)
        : this.shoot(template, start, dest, now,
          this.combatStat('iAttack', now).mul(D('1.5')), {
            school: 'physical', basic: true, speed_multiplier: 1.5,
          });
      return packets.concat([this._cooldown(0)]);
    }
    if (slot === 1) {
      const intended = aimed(start, dest, 300);
      let body, stopped;
      [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      if (!stopped.length) body = start;
      const packets = [];
      for (const buff of [370203, 370207, 370209]) packets.push(...this.removeBuff(buff, now));
      const third = this.combo_count >= 2 && this.combo_until > now;
      if (third) {
        this.combo_count = this.combo_until = 0;
        packets.push(...this.removeBuff(370205, now), ...this.removeBuff(370206, now),
          ...this._buff(370209, now));
      }
      packets.push(...this._buff(third ? 370207 : 370203, now),
        ...this._buff(370202, now), ...this._buff(370231, now));
      this._setMotion(body, intended, 960, now, 4);
      this.forcedUntil = this.motion[3];
      packets.push(...stopped);
      packets.push(scene({ moves: [this._moveEvent(this.motion[1], 960, 4)] }));
      for (const clone of this.arena.actors.values()) {
        if (clone.alive && clone.info.npc_template === 370402
          && clone.info.owner === this.id
          && clone.info.source_generation === this.generation) {
          packets.push(...this._buff(370204, now, clone.id));
        }
      }
      return packets.concat([this._cooldown(0, true), this._cooldown(1)]);
    }
    if (slot === 10) {
      const stats = { ...this.stats };
      for (const key of ['iAttack', 'iEgAtk', 'iArmor', 'iEgArmor', 'iCentesis', 'iEgCtsis']) {
        stats[key] = this.combatStat(key, now)
          .mul(['iAttack', 'iEgAtk'].includes(key) ? D('.5') : D(1)).toString();
      }
      Object.assign(stats, {
        iHp: this.maxHp.toString(), iSpeed: '150', iFireInterv: '1000', nFireRange: '432',
      });
      this._queue(now + 500, 'kurumi_spawn', {
        pos: dest, stats, hp: this.hp, generation: this.generation,
      });
      const packets = [scene({
        skills: [this._skillEvent(370401, start, dest, 0, { ready: 1 })],
      }), this._cooldown(10)];
      for (const [template, duration] of [[370401, 1300], [370403, 500]]) {
        const [ident, packet] = this.addObject(template, dest);
        packets.push(packet);
        this._queue(now + duration, 'object_expire', ident);
      }
      return packets;
    }
    this.ready = { slot: 2, skill: 370301, dest };
    const [, stopped] = prepareDisplacement(this, now, { interrupt: false });
    this.position = this.positionAt(now);
    this.motion = null;
    this._queue(now + 50, 'kurumi_ready', this.ready);
    const [ident, packet] = this.addObject(370305, dest);
    this._queue(now + 1000, 'object_expire', ident);
    return [packet, scene({
      skills: [this._skillEvent(370301, start, dest, 0, { ready: 1 })],
    }), this._cooldown(2)].concat(this.syncSpeed(now), stopped);
  }
}

export class KurumiClone extends KurumiActions {
  taunt_mobile = true;

  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.stats = { ...info.summon_stats };
    this.maxHp = D(this.stats.iHp);
    this.hp = this.maxHp.min(D(info.summon_hp));
    this.info.hp = this.hp.ceil();
    this.info.max_hp = this.maxHp.ceil();
    this.cooldowns = {};
    this.passive_ready_at = 0;
  }

  snapshot(now) {
    const pos = this.positionAt(now);
    return [1556, encodeS1556(this.sceneId, {
      objectId: this.id, templateId: 370402, x: pos[0], y: pos[1], hp: this.hp.ceil(),
      camp: this.camp, maxHp: this.maxHp.ceil(), ownerId: this.info.owner,
      shield: this.shieldAmount(now).ceil(), buffs: [],
    })];
  }

  syncSpeed() { return []; }

  on_spawn(now) {
    this._queue(now + 8000, 'kurumi_clone_end');
    this._queue(now + 100, 'kurumi_ai');
    return this._buff(370404, now);
  }

  _refund(now, generation) {
    const owner = this.arena.actors.get(this.info.owner);
    return owner ? owner._refund(now, this.info.source_generation) : [];
  }

  limitHit(key, amount) { return quantize(amount.mul(D(2))); }

  commitHp(hp, now, { critical = false } = {}) {
    const before = this.alive;
    const packets = super.commitHp(hp, now, { critical });
    if (before && !this.alive) {
      const pos = this.positionAt(now);
      packets.unshift(scene({ skills: [this._skillEvent(370411, pos, pos)] }));
      this._queue(now, 'kurumi_clone_explode', pos, this.combatStat('iAttack', now));
      packets.push(scene({ removedObjects: [this.id] }));
    }
    return packets;
  }

  taunt_attack(target, now) {
    const pos = this.positionAt(now), dest = target.positionAt(now);
    if (!this.alive || !target.alive || target.isUntargetable()
      || this.blocked('attack', now) || this.skillSealed(0, now)
      || now < this.passive_ready_at
      || Math.hypot(pos[0] - dest[0], pos[1] - dest[1]) > 432) return [];
    this.passive_ready_at = now + this.fireInterval(now);
    if (this._basic(now) === 370211) return this._beam(pos, dest, now, 370211);
    return pos[0] !== dest[0] || pos[1] !== dest[1]
      ? this.shoot(370100, pos, dest, now, this.combatStat('iAttack', now).mul(D('1.5')), {
        school: 'physical', basic: true, speed_multiplier: 1.5,
      }) : [];
  }

  _event(now, kind, data) {
    if (kind === 'kurumi_clone_end') return this.alive ? this.commitHp(D(0), now) : [];
    if (kind === 'kurumi_clone_explode') {
      const [pos, power] = data;
      const packets = [];
      for (const target of enemies(this, { area: true })) {
        if (Math.hypot(pos[0] - target.positionAt(now)[0],
          pos[1] - target.positionAt(now)[1]) <= 144) {
          packets.push(...this.damage(power.mul(D('2.07')), now, { target })[0]);
        }
      }
      return packets;
    }
    if (kind === 'kurumi_ai') {
      if (!this.alive) return [];
      this._queue(now + 100, kind);
      const pos = this.positionAt(now);
      const candidates = enemies(this).filter(actor => Math.hypot(pos[0] - actor.positionAt(now)[0],
        pos[1] - actor.positionAt(now)[1]) <= 960 && teamVisible(this, actor, now));
      candidates.sort((a, b) => (Math.hypot(pos[0] - a.positionAt(now)[0],
        pos[1] - a.positionAt(now)[1]) - Math.hypot(pos[0] - b.positionAt(now)[0],
        pos[1] - b.positionAt(now)[1])) || a.id - b.id);
      const target = candidates.length ? candidates[0] : null;
      const packets = [];
      if (target && Math.hypot(pos[0] - target.positionAt(now)[0],
        pos[1] - target.positionAt(now)[1]) > 432) {
        if (!this.blocked('move', now) && this._speed(now) > 0) {
          const span = Math.hypot(pos[0] - target.positionAt(now)[0],
            pos[1] - target.positionAt(now)[1]);
          this._setMotion(pos, aimed(pos, target.positionAt(now), span - 432),
            this._speed(now), now, 3);
          packets.push(scene({ moves: [this._moveEvent(this.motion[1],
            this._speed(now), 3)] }));
        }
      } else if (this.motion && now >= this.forcedUntil) {
        this.position = pos;
        this.motion = null;
        packets.push(scene({ moves: [this._moveEvent(pos, 0, 5)] }));
      }
      if (target && Math.hypot(pos[0] - target.positionAt(now)[0],
        pos[1] - target.positionAt(now)[1]) <= 432
        && !this.blocked('attack', now) && !this.skillSealed(0, now)
        && now >= this.passive_ready_at) {
        packets.push(...this.taunt_attack(target, now));
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  _respawn(now, generation) { return retireSummon(this, now, generation); }
}

export { SLOTS as KURUMI_SLOTS, KurumiClone as KURUMI_CLONE };
