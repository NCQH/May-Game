/* Sasuke (tank 10000093): Amaterasu chains, substitution, counted wards.
 * Port of server/sasuke_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. The substitution shadow is a native actor and
 * uses the shared retireSummon tombstone cleanup.
 */
import { TankActions, bkey } from '../arena.js';
import { D, actorContact, pyRound, quantize } from '../math.js';
import { scene, encodeS1556, encodeS1562, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, packII, prepareDisplacement } from './melee.js';
import { keyOf } from './batch-e-common.js';
import { retireSummon, teamVisible } from './batch-c-common.js';

const SLOTS = { 0: 368100, 1: 368201, 2: 368301, 10: 368401 };

export class SasukeActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = 100;
    this.ready = this.dash = this.counter = null;
    this.dots = new Map();
    this.ward_count = 0;
    this.blocked_attacks = new Set();
  }

  _skill(slot, now) {
    if (slot === 0 && this.hasBuff(368301, now)) return 368310;
    if (slot === 2 && this.hasBuff(368304, now)) return 368320;
    if (slot === 10 && this.hasBuff(368404, now)) return 368410;
    return SLOTS[slot];
  }

  _cooldown(slot, changed = false) {
    const skill = this._skill(slot, this.clock());
    const info = {
      skillId: skill, slot, count: -1,
      end: [368320, 368410].includes(skill) ? 0 : this.cooldowns[slot] ?? 0, nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _resource(delta) {
    if (this.noel_box) return [];
    const old = this.mp;
    this.mp = Math.max(0, Math.min(100, this.mp + delta));
    return old !== this.mp ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })] : [];
  }

  on_spawn(now) {
    this.mp = 100;
    this.ready = this.dash = this.counter = null;
    this.ward_count = 0;
    this.blocked_attacks.clear();
    delete this.info.untargetable;
    this._queue(now + 1000, 'sasuke_energy', this.generation);
    return this._buff(368101, now)
      .concat([scene({ mp: [{ objectId: this.id, mp: this.mp }] })],
        Object.keys(SLOTS).map(Number).map(slot => this._cooldown(slot, true)));
  }

  _visibility(now) {
    this.info.untargetable = this.hasBuff(368403, now) && !this.buffTypes(now).has(32);
  }

  _ward(now) {
    this.ward_count = 3;
    return this._buff(368414, now);
  }

  removeBuff(template, now, { expired = false } = {}) {
    const existed = this.activeBuffs.has(bkey(this.id, template));
    const packets = super.removeBuff(template, now, { expired });
    if (template === 368403) {
      this._visibility(now);
      if (existed && this.alive) packets.push(...this._ward(now));
    }
    if (template === 368414) this.ward_count = 0;
    if (template === 368401 && existed && this.alive) packets.push(...this._buff(368408, now));
    if ([368301, 368304, 368404].includes(template)) {
      const slot = template === 368301 ? 0 : template === 368304 ? 2 : 10;
      packets.push(this._cooldown(slot, true));
    }
    return packets;
  }

  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  blockHit(key, amount, now, { basic = false, periodic = false, source = null } = {}) {
    if (amount.le(0)) return [false, []];
    const name = keyOf(key);
    if (this.blocked_attacks.has(name)) return [true, []];
    if (basic && this.hasBuff(368401, now) && source) {
      this.blocked_attacks.add(name);
      const packets = this.removeBuff(368401, now).concat(this.removeBuff(368406, now));
      const pos = this.positionAt(now);
      const flight = this.arena.currentFlight;
      const origin = flight ? flight.start : source.positionAt(now);
      const endpoint = flight ? flight.end : pos;
      let vector = [endpoint[0] - origin[0], endpoint[1] - origin[1]];
      if (vector[0] === 0 && vector[1] === 0) vector = [1, 0];
      this.counter = {
        target: source.id, target_generation: source.generation, vector, end: now + 3000,
      };
      for (const template of [368403, 368404]) packets.push(...this._buff(template, now));
      packets.push(...this._buff(368405, now, source.id));
      this.cooldowns[1] = now + Math.round(Math.max(0, this.cooldowns[1] - now) * 0.25);
      const info = {
        acct_id: this.info.acct_id, tank_level: this.info.tank_level,
        tank_id: this.info.tank_id, npc_template: 368402, owner: this.id,
        source_generation: this.generation, name: this.info.name, in_room: true,
        summon_stats: { ...this.stats },
      };
      info.summon_stats.iHp = D('.001').max(quantize(this.maxHp.mul(D('.00001')))).toString();
      for (const key2 of ['iAttack', 'iEgAtk', 'iArmor', 'iEgArmor', 'iCentesis', 'iEgCtsis']) {
        info.summon_stats[key2] = this.combatStat(key2, now).toString();
      }
      const shadow = new SasukeShadow(this.arena, this._newId(5), info, this.camp, pos);
      this.arena.actors.set(shadow.id, shadow);
      this._visibility(now);
      return [true, packets.concat([shadow.snapshot(now)], shadow.on_spawn(now),
        [this._cooldown(1), this._cooldown(10, true)])];
    }
    if (!periodic && this.ward_count && this.hasBuff(368414, now)) {
      this.ward_count -= 1;
      this.blocked_attacks.add(name);
      return [true, this.ward_count ? [] : this.removeBuff(368414, now)];
    }
    return [false, []];
  }

  _speed(now) { return this.ready ? 0 : super._speed(now); }
  blocked(action, now) { return Boolean(this.ready || this.dash) || super.blocked(action, now); }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      packets.push([1583, packII(this.id, this.ready.skill)]);
      this.ready = null;
    }
    if (this.dash) {
      this.position = this.stopPosition(now);
      this.motion = null;
      this.forcedUntil = now;
      this.dash = null;
      packets.push(scene({ moves: [this._moveEvent(this.position, 0, 5)] }));
      packets.push(...this.removeBuff(368201, now));
    }
    return packets.concat(this.syncSpeed(now));
  }

  onControl(source, template, now) {
    if (!(this.ready || this.dash)) return [];
    const kind = Number(this.arena.data.tableRow('BuffTemplate_table.xml',
      { nBuffId: template }).get('nEffectType'));
    return [30, 35, 66].includes(kind) ? this.interrupt(now) : [];
  }

  update(now) {
    this._visibility(now);
    for (const [key, value] of [...this.dots]) if (!(value.end > now)) this.dots.delete(key);
    const live = new Set();
    for (const entry of this.arena.pending) {
      const [kind, data] = entry.args || [];
      if (kind === 'flight' && data?.[0]?.attack_key) live.add(keyOf(data[0].attack_key));
    }
    for (const key of [...this.blocked_attacks]) if (!live.has(key)) this.blocked_attacks.delete(key);
    const packets = this.ready && this.skillSealed(this.ready.slot, now) ? this.interrupt(now) : [];
    return packets.concat(super.update(now));
  }

  _ignite(target, power, now, { generation, chain = null, form = false }) {
    if (!target.alive) return [];
    const key = `${target.id},${target.generation}`;
    if (chain === null) chain = { end: now + 12000, visited: new Set() };
    if (now >= chain.end || chain.visited.has(key)) return [];
    chain.visited.add(key);
    const template = form ? 368311 : 368102;
    const spread = form ? 368312 : 368103;
    const packets = [];
    for (const item of [368102, 368103, 368311, 368312]) {
      packets.push(...target.removeBuff(item, now));
    }
    const duration = Math.min(4000, chain.end - now);
    packets.push(...this._buff(template, now, target.id, { duration }),
      ...this._buff(spread, now, target.id, { duration }));
    if (!target.hasBuff(template, now)) return packets;
    const dot = {
      target: target.id, target_generation: target.generation, power, generation,
      template, version: target.buffVersions.get(template), chain, end: now + duration, form,
    };
    this.dots.set(key, dot);
    packets.push(...this._dotHit(dot, now));
    this._queue(now + 1000, 'sasuke_dot', dot, 1);
    this._queue(now + 250, 'sasuke_spread', dot);
    return packets;
  }

  _dotTarget(dot, now) {
    const target = this.arena.actors.get(dot.target);
    const key = `${dot.target},${dot.target_generation}`;
    if (!target || !target.alive || target.generation !== dot.target_generation
      || now >= dot.end || this.dots.get(key) !== dot
      || target.buffVersions.get(dot.template) !== dot.version) return null;
    return target;
  }

  _dotHit(dot, now) {
    const target = this._dotTarget(dot, now);
    if (!target) return [];
    const previous = this.arena.damageContext;
    this.arena.damageContext = [this.id, this._newId(2)];
    try {
      return this.damage(dot.power.mul(D('.75')), now,
        { target, school: 'energy', periodic: true })[0];
    } finally { this.arena.damageContext = previous; }
  }

  _hit(target, raw, power, now, { generation }) {
    const packets = this.damage(raw, now, { target, school: 'energy' })[0];
    return packets.concat(this._ignite(target, power, now, { generation }));
  }

  onBulletHit(flight, target, now) {
    if (flight.template !== 368310) return [];
    return this._ignite(target, flight.power, now, {
      generation: flight.source_generation, form: true,
    });
  }

  _event(now, kind, data) {
    if (kind === 'sasuke_energy') {
      if (!this.alive || this.generation !== data[0]) return [];
      this._queue(now + 1000, kind, data[0]);
      return this._resource(2);
    }
    if (kind === 'sasuke_dot') {
      const [dot, index] = data;
      const packets = this._dotHit(dot, now);
      if (index < 3 && this._dotTarget(dot, now)) {
        this._queue(now + 1000, kind, dot, index + 1);
      }
      return packets;
    }
    if (kind === 'sasuke_spread') {
      const [dot] = data;
      const target = this._dotTarget(dot, now);
      if (!target) return [];
      const packets = [];
      const pos = target.positionAt(now);
      for (const enemy of enemies(this, { area: true })) {
        if ((enemy.info.npc_template && !dot.form)
          || Math.hypot(pos[0] - enemy.positionAt(now)[0],
            pos[1] - enemy.positionAt(now)[1]) > 144) continue;
        packets.push(...this._ignite(enemy, dot.power, now, {
          generation: dot.generation, chain: dot.chain, form: dot.form,
        }));
      }
      if (now + 900 < dot.end) this._queue(now + 900, kind, dot);
      return packets;
    }
    if (kind === 'sasuke_ready') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      const start = this.positionAt(now);
      const packets = this.syncSpeed(now).concat([scene({
        skills: [this._skillEvent(cast.skill, start, cast.dest, cast.target ?? 0)],
      })]);
      if (cast.skill === 368201) {
        const end = aimed(start, cast.dest, 432, { fixed: true });
        const duration = this._setMotion(start, end, 960, now, 3);
        this.forcedUntil = now + duration;
        this.dash = {
          generation: this.generation, power: cast.power, hits: new Set(),
          previous: now, end: now + duration,
        };
        packets.push(...this._buff(368201, now));
        packets.push(scene({ moves: [this._moveEvent(this.motion[1], 960, 3)] }));
        this._queue(now + Math.min(20, duration), 'sasuke_dash', this.dash);
      } else if (cast.skill === 368320) {
        for (const template of [368320, 368323]) {
          const [ident, packet] = this.addObject(template, cast.dest);
          packets.push(packet);
          this._queue(now + (template === 368320 ? 500 : 800), 'object_expire', ident);
        }
        this._queue(now + 500, 'sasuke_arrow_art', cast);
        this._queue(now + 800, 'sasuke_arrow_hit', cast);
      } else {
        const target = this.arena.actors.get(cast.target);
        if (!target || !target.alive || target.generation !== cast.target_generation) return packets;
        const pos = target.positionAt(now);
        const [dx, dy] = cast.vector;
        const length = Math.hypot(dx, dy);
        const dest = this.blinkDestination(start, [
          Math.round(pos[0] - 72 * dx / length), Math.round(pos[1] - 72 * dy / length),
        ]);
        this.position = dest;
        this.motion = null;
        this.forcedUntil = now;
        packets.push(scene({ moves: [this._moveEvent(dest, 0, 5)] }));
        packets.push(...this._hit(target, cast.power.mul(D(2)), cast.power, now,
          { generation: cast.generation }));
        packets.push(...this._buff(368412, now, target.id),
          ...this._buff(368415, now, target.id), ...this._buff(368413, now));
        packets.push(...this._resource(30));
      }
      return packets;
    }
    if (kind === 'sasuke_dash') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive) return [];
      const start = this.positionAt(cast.previous), end = this.positionAt(now);
      const packets = [];
      for (const target of enemies(this)) {
        const key = `${target.id},${target.generation}`;
        if (cast.hits.has(key) || actorContact(start, end, target, cast.previous, now) === null) continue;
        cast.hits.add(key);
        packets.push(...this._hit(target, cast.power.mul(D('2.06')), cast.power, now,
          { generation: cast.generation }));
        packets.push(...this._buff(368203, now, target.id));
        if (target.hasBuff(368305, now)) packets.push(...this._buff(368204, now, target.id));
        packets.push(...this.restoreHp(cast.power, now), ...this._resource(20));
      }
      if (!this.motion || now >= Math.min(cast.end, this.motion[3])) {
        this.dash = null;
        packets.push(...this.removeBuff(368201, now));
      } else {
        cast.previous = now;
        this._queue(Math.min(now + 20, cast.end, this.motion[3]), kind, cast);
      }
      return packets;
    }
    if (kind === 'sasuke_arrow_art') {
      const [cast] = data;
      const packets = [];
      for (const [template, lifetime] of [[368321, 1000], [368322, 300]]) {
        const [ident, packet] = this.addObject(template, cast.dest);
        packets.push(packet);
        this._queue(now + lifetime, 'object_expire', ident);
      }
      return packets;
    }
    if (kind === 'sasuke_arrow_hit') {
      const [cast] = data;
      const packets = [];
      for (const target of enemies(this, { area: true })) {
        if (Math.hypot(cast.dest[0] - target.positionAt(now)[0],
          cast.dest[1] - target.positionAt(now)[1]) <= 192) {
          packets.push(...this._hit(target, cast.power.mul(D('3.87')), cast.power, now,
            { generation: cast.generation }));
        }
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)) return [];
    const skill = this._skill(slot, now);
    if (![368320, 368410].includes(skill) && this.cooldowns[slot] > now) return [];
    if (([0, 1].includes(slot) && start[0] === dest[0] && start[1] === dest[1])
      || (skill === 368301 && this.mp < 100)) return [];
    if (skill === 368320 && (!this._inside(dest)
      || Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 600)) return [];
    if (skill === 368410) {
      const mark = this.counter;
      const target = mark ? this.arena.actors.get(mark.target) : null;
      if (!target || !enemies(this).includes(target)
        || target.generation !== mark.target_generation
        || !target.hasBuff(368405, now) || target.buffSources.get(368405) !== this.id
        || mark.end <= now
        || Math.hypot(start[0] - target.positionAt(now)[0],
          start[1] - target.positionAt(now)[1]) > 720) return [];
      if (!(targetId === 0 || targetId === target.id)) return [];
      if (!teamVisible(this, target, now)) return [];
    }
    const packets = this.removeBuff(368403, now);
    const power = this.combatStat('iEgAtk', now);
    if (![368320, 368410].includes(skill)) {
      this.cooldowns[slot] = now + this.skillCooldown(
        { 0: this.fireInterval(now), 1: 6000, 2: 20000, 10: 8000 }[slot], slot);
    }
    if (slot === 0) {
      return packets.concat(this.shoot(skill, start, dest, now, power, {
        school: 'energy', basic: true, power,
      }), [this._cooldown(0)]);
    }
    if ([368201, 368320, 368410].includes(skill)) {
      const duration = skill === 368201 ? 100 : 50;
      let body, stopped;
      [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      this.position = stopped.length ? body : start;
      this.motion = null;
      this.ready = {
        slot, skill, dest, power, generation: this.generation, end: now + duration,
      };
      if (skill === 368410) {
        Object.assign(this.ready, this.counter);
        this.ready.end = now + duration;
        packets.push(...this.removeBuff(368404, now));
        this.counter = null;
      } else if (skill === 368320) packets.push(...this.removeBuff(368304, now));
      packets.push(scene({
        skills: [this._skillEvent(skill, start, dest, 0, { ready: duration })],
      }));
      this._queue(now + duration, 'sasuke_ready', this.ready);
      return packets.concat(this.syncSpeed(now), [this._cooldown(slot, true)], stopped);
    }
    packets.push(scene({ skills: [this._skillEvent(skill, start, dest)] }));
    if (skill === 368401) {
      packets.push(...this._buff(368401, now), ...this._buff(368406, now));
    } else {
      packets.push(...this._resource(-100));
      for (const template of [368301, 368302, 368304]) packets.push(...this._buff(template, now));
      for (const target of enemies(this, { area: true })) {
        if (Math.hypot(start[0] - target.positionAt(now)[0],
          start[1] - target.positionAt(now)[1]) > 192) continue;
        packets.push(...this._hit(target, power.mul(D('2.46')), power, now,
          { generation: this.generation }));
        packets.push(...this._buff(368305, now, target.id),
          ...this._buff(368306, now, target.id));
      }
      packets.push(this._cooldown(0, true));
    }
    return packets.concat([this._cooldown(slot, true)]);
  }
}

export class SasukeShadow extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.stats = { ...info.summon_stats };
    this.hp = this.maxHp = D(this.stats.iHp);
    this.info.hp = this.info.max_hp = this.hp.ceil();
    this.cooldowns = {};
  }

  snapshot(now) {
    const pos = this.positionAt(now);
    return [1556, encodeS1556(this.sceneId, {
      objectId: this.id, templateId: 368402, x: pos[0], y: pos[1],
      hp: this.hp.ceil(), camp: this.camp, maxHp: this.maxHp.ceil(),
      ownerId: this.info.owner, shield: 0, buffs: [],
    })];
  }

  syncSpeed() { return []; }

  on_spawn(now) {
    this._queue(now + 3000, 'sasuke_shadow_end');
    return [];
  }

  commitHp(hp, now, { critical = false } = {}) {
    const before = this.alive;
    const packets = super.commitHp(hp, now, { critical });
    if (before && !this.alive) {
      const pos = this.positionAt(now);
      packets.push(scene({ skills: [this._skillEvent(368421, pos, pos)] }),
        scene({ removedObjects: [this.id] }));
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'sasuke_shadow_end') return this.alive ? this.commitHp(D(0), now) : [];
    return super._event(now, kind, data);
  }

  _respawn(now, generation) { return retireSummon(this, now, generation); }
}

export { SLOTS as SASUKE_SLOTS };
