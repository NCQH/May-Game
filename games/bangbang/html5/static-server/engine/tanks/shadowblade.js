/* Shadowblade (tank 10000108): energy snapshots, bounces, links, field.
 * Port of server/shadowblade_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin; teamVisible uses the core line-of-sight stub.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1562, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, packII, piercingStep, prepareDisplacement } from './melee.js';
import { powD, teamVisible } from './batch-c-common.js';

const SLOTS = { 0: 383100, 1: 383201, 2: 383301, 10: 383401 };

export class ShadowbladeActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = 100;
    this.e_count = 2;
    this.e_next_charge = 0;
    this.ready = this.dash = this.hitting = null;
    this.links = new Map();
    this.assists = new Map();
  }

  _cooldown(slot, changed = false) {
    const skill = slot === 0 && this.hasBuff(383203, this.clock()) ? 383211 : SLOTS[slot];
    const info = {
      skillId: skill, slot, count: slot === 1 ? this.e_count : -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: slot === 1 ? this.e_next_charge : 0,
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

  _factor() { return D(1).add(D('.05').mul(D(Math.floor(this.mp / 10)))); }

  _speed(now) {
    if (this.ready || this.dash || this.buffTypes(now).has(36)) return 0;
    return Math.max(0, super._speed(now)
      + pyRound(Number(this.stats.iSpeed) * 0.05 * Math.floor(this.mp / 10)));
  }

  blocked(action, now) {
    return Boolean(this.ready || this.dash) || super.blocked(action, now);
  }

  cc_immune(now, options) { return this.ccImmune(now, options); }

  ccImmune(now, options) {
    return Boolean(this.dash || (this.ready && this.ready.slot === 2))
      || super.ccImmune(now, options);
  }

  rejectBuff(row, source, now) {
    return source.camp !== this.camp
      && Boolean(this.dash || (this.ready && this.ready.slot === 2));
  }

  blockHit(key, amount, now, { basic = false } = {}) {
    if (basic && (this.hasBuff(383402, now) || this.hasBuff(383345, now))) {
      return [true, this.restoreHp(amount, now)];
    }
    return [false, []];
  }

  on_spawn(now) {
    this.mp = 100;
    this.ready = this.dash = this.hitting = null;
    this.links.clear();
    this.assists.clear();
    this._queue(now + 1000, 'shadow_energy', this.generation);
    const packets = [scene({ mp: [{ objectId: this.id, mp: 100 }] }), this._cooldown(0, true)];
    for (let template = 383101; template < 383108; template += 1) {
      packets.push(...this._buff(template, now));
    }
    return packets;
  }

  removeBuff(template, now, { expired = false } = {}) {
    const packets = super.removeBuff(template, now, { expired });
    if (template === 383203 && this.alive) packets.push(this._cooldown(0, true));
    return packets;
  }

  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  update(now) {
    const packets = [];
    while (this.e_next_charge && this.e_next_charge <= now) {
      this.e_count = Math.min(2, this.e_count + 1);
      this.e_next_charge = this.e_count < 2
        ? this.e_next_charge + this.skillCooldown(8000) : 0;
      packets.push(this._cooldown(1));
    }
    for (const [key, value] of [...this.assists]) if (!(value.end > now)) this.assists.delete(key);
    return packets.concat(super.update(now));
  }

  _deal(target, raw, now, generation, options = {}) {
    const current = this.alive && this.generation === generation;
    this.hitting = current ? `${target.id},${target.generation}` : null;
    let packets, lost;
    try { [packets, lost] = this.damage(raw, now, { target, ...options }); }
    finally { this.hitting = null; }
    if (current && lost && target.alive && !target.info.npc_template) {
      this.assists.set(`${target.id},${target.generation}`,
        { end: now + 5000, generation });
    }
    return [packets, lost];
  }

  onTargetDeath(target, now) {
    const key = `${target.id},${target.generation}`;
    const mark = this.assists.get(key) || null;
    this.assists.delete(key);
    if (!this.alive || target.camp === this.camp || target.info.npc_template
      || !(this.hitting === key
        || (mark && mark.end >= now && mark.generation === this.generation))) return [];
    const ratio = this.hitting === key ? D('.15') : D('.05');
    const packets = this.restoreHp(this.maxHp.mul(ratio), now)
      .concat(this._resource(Math.floor(100 * ratio.toNumber())));
    for (const slot of [2, 10]) {
      this.cooldowns[slot] = now + pyRound(Math.max(0, this.cooldowns[slot] - now)
        * (1 - ratio.toNumber()));
      packets.push(this._cooldown(slot));
    }
    if (this.e_next_charge) {
      this.e_next_charge = now + pyRound(Math.max(0, this.e_next_charge - now)
        * (1 - ratio.toNumber()));
      packets.push(this._cooldown(1));
    }
    return packets;
  }

  _basicHit(flight, target, now) {
    const [packets] = this._deal(target, flight.raw, now, flight.source_generation,
      { school: 'energy', basic: true });
    if (this.alive && this.generation === flight.source_generation) {
      packets.push(...this._resource(5));
    }
    return packets;
  }

  _bounceHit(flight, target, now) {
    const cast = flight.context;
    const pos = target.positionAt(now);
    cast.hits.add(`${target.id},${target.generation}`);
    const current = this.alive && this.generation === cast.generation;
    const packets = [];
    for (const enemy of enemies(this, { area: true })) {
      if (Math.hypot(pos[0] - enemy.positionAt(now)[0],
        pos[1] - enemy.positionAt(now)[1]) > 96) continue;
      const [hit] = this._deal(enemy, cast.power.mul(D('1.97'))
        .mul(powD(D('.75'), cast.index)), now, cast.generation, {
        school: 'energy', basic: true, lifesteal: current ? D('.25') : 0,
      });
      packets.push(...hit);
      for (const template of [383212, 383213]) {
        packets.push(...this._buff(template, now, enemy.id));
      }
    }
    if (current) packets.push(...this._resource(10));
    cast.index += 1;
    if (cast.index < 4) {
      const choices = enemies(this).filter(enemy =>
        !cast.hits.has(`${enemy.id},${enemy.generation}`)
        && Math.hypot(pos[0] - enemy.positionAt(now)[0],
          pos[1] - enemy.positionAt(now)[1]) <= 300
        && teamVisible(this, enemy, now));
      if (choices.length) {
        choices.sort((a, b) => (Math.hypot(pos[0] - a.positionAt(now)[0],
          pos[1] - a.positionAt(now)[1]) - Math.hypot(pos[0] - b.positionAt(now)[0],
          pos[1] - b.positionAt(now)[1])) || a.id - b.id);
        const following = choices[0];
        packets.push(...this.shoot(383221, pos, following.positionAt(now), now, D(0), {
          school: 'energy', basic: true, target: following, through_walls: true,
          context: cast, attack_key: flight.attack_key,
        }));
      }
    }
    return packets;
  }

  _flight(flight, now) {
    if (flight.template === 383100) {
      return piercingStep(this, flight, now, (f, t, n) => this._basicHit(f, t, n),
        { pierce: false });
    }
    if (flight.template !== 383211 && flight.template !== 383221) return super._flight(flight, now);
    const cast = flight.context;
    flight.source_generation = cast.generation;
    const target = this.arena.actors.get(flight.target);
    const packets = [];
    let start, end, choices;
    if (target) {
      if (!target.alive || target.generation !== flight.target_generation) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      start = flight.pos;
      const dest = target.positionAt(now);
      end = pointAt(start, dest, Math.min(1, flight.speed * (now - flight.previous)
        / 1000 / Math.max(1, Math.hypot(start[0] - dest[0], start[1] - dest[1]))));
      if (dest[0] !== flight.end[0] || dest[1] !== flight.end[1]) {
        packets.push([1562, encodeS1562(flight.id, start, dest)]);
        flight.end = dest;
      }
      flight.pos = end;
      choices = [target];
    } else {
      start = pointAt(flight.start, flight.end,
        (flight.previous - flight.begin) / (flight.finish - flight.begin));
      end = pointAt(flight.start, flight.end,
        Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
      choices = enemies(this);
    }
    const contacts = [];
    for (const actor of choices) {
      if (!actor.alive || actor.isUntargetable()) continue;
      const hit = actorContact(start, end, actor, flight.previous, now);
      if (hit !== null) contacts.push([hit, actor.id, actor]);
    }
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (contacts.length) {
      const target2 = contacts[0][2];
      const blocked = this.projectileBlocked(target2, now);
      if (!blocked) packets.push(...this._bounceHit(flight, target2, now));
      return packets.concat([scene(blocked
        ? { expiredBullets: [flight.id] } : { blownBullets: [flight.id] })]);
    }
    if (now >= flight.finish) return packets.concat([scene({ expiredBullets: [flight.id] })]);
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return packets;
  }

  _endLink(target, cast, now, { pull = false } = {}) {
    this.links.delete(target.id);
    if (target.generation !== cast.target_generation
      || target.buffSources.get(383403) !== this.id) return [];
    if (target.hasBuff(383403, now)
      && target.buffVersions.get(383403) !== cast.version) return [];
    const packets = [];
    for (const template of [383403, 383404, 383405, 383421, 383431]) {
      packets.push(...target.removeBuff(template, now));
    }
    if (pull && target.alive && !target.ccImmune(now)) {
      const [pos, stopped] = prepareDisplacement(target, now);
      packets.push(...stopped);
      const dest = this.positionAt(now);
      const end = aimed(pos, dest, Math.min(72, Math.max(0,
        Math.hypot(pos[0] - dest[0], pos[1] - dest[1]) - 72)));
      const elapsed = target._setMotion(pos, end, 720, now, 1);
      target.forcedUntil = now + elapsed;
      packets.push(scene({ moves: [this._moveEvent(target.motion[1], 720, 1, target.id)] }));
      this._queue(now + elapsed, 'shadow_link_slow', target.id, target.generation);
    }
    return packets;
  }

  _linkStep(cast, now) {
    const target = this.arena.actors.get(cast.target);
    if (!target || this.links.get(target.id) !== cast) return [];
    if (!this.alive || this.generation !== cast.generation || !target.alive
      || target.generation !== cast.target_generation || now > cast.end
      || target.buffVersions.get(383403) !== cast.version
      || target.buffVersions.get(383404) !== cast.debuff_version) {
      return this._endLink(target, cast, now);
    }
    if (Math.hypot(this.positionAt(now)[0] - target.positionAt(now)[0],
      this.positionAt(now)[1] - target.positionAt(now)[1]) > 300) {
      return this._endLink(target, cast, now, { pull: true });
    }
    const packets = [];
    if (now >= cast.next_tick_at) {
      packets.push(...this._deal(target, cast.power.mul(D('.5')), now, cast.generation,
        { school: 'energy', periodic: true })[0]);
      cast.next_tick_at += 1000;
    }
    if (now >= cast.end) return packets.concat(this._endLink(target, cast, now));
    this._queue(Math.min(now + 100, cast.end), 'shadow_link', cast);
    return packets;
  }

  _clearForm(now) {
    this.ready = this.dash = null;
    delete this.info.untargetable;
    delete this.info.damage_immune;
    const packets = [];
    for (const template of [383302, 383303, 383304, 383305, 383312, 383313, 383314]) {
      packets.push(...this.removeBuff(template, now));
    }
    return packets.concat(this.syncSpeed(now));
  }

  interrupt(now) {
    if (this.alive && (this.dash || (this.ready && this.ready.slot === 2))) return [];
    const packets = [];
    if (this.ready) packets.push([1583, packII(this.id, SLOTS[this.ready.slot])]);
    packets.push(...this._clearForm(now));
    if (!this.alive) {
      for (const [ident, cast] of [...this.links]) {
        const target = this.arena.actors.get(ident);
        if (target) packets.push(...this._endLink(target, cast, now));
      }
    }
    return packets;
  }

  onControl(source, template, now) {
    const kind = this.arena.data.tableRow('BuffTemplate_table.xml',
      { nBuffId: template }).get('nEffectType');
    return this.ready && this.ready.slot === 1 && ['30', '35', '66'].includes(kind)
      ? this.interrupt(now) : [];
  }

  _fieldHit(target, cast, now, raw) {
    const [packets, lost] = this._deal(target, raw, now, cast.generation,
      { school: 'energy', periodic: (cast.index || 0) > 0 });
    const key = `${target.id},${target.generation}`;
    if (lost && !cast.hits.has(key)) {
      cast.hits.add(key);
      if (this.alive && this.generation === cast.generation) {
        packets.push(...this._buff(383323, now));
      }
    }
    return packets;
  }

  _field(cast, now) {
    cast.index += 1;
    const packets = [];
    for (const target of enemies(this, { area: true })) {
      if (Math.hypot(cast.pos[0] - target.positionAt(now)[0],
        cast.pos[1] - target.positionAt(now)[1]) <= 216) {
        packets.push(...this._fieldHit(target, cast, now, cast.power.mul(D('.18'))));
        if (now < cast.end) {
          for (const template of [383342, 383343]) {
            packets.push(...this._buff(template, now, target.id,
              { duration: Math.min(300, cast.end - now) }));
          }
        }
      }
    }
    if (this.alive && this.generation === cast.generation
      && Math.hypot(cast.pos[0] - this.positionAt(now)[0],
        cast.pos[1] - this.positionAt(now)[1]) <= 216) {
      packets.push(...this._resource(5));
      if (now < cast.end) {
        packets.push(...this._buff(383345, now, null, { duration: Math.min(300, cast.end - now) }));
      }
    }
    if (now < cast.end) this._queue(now + 250, 'shadow_field', cast);
    else packets.push(...this.removeObject(cast.id, { destroyed: true }));
    return packets;
  }

  _arrive(cast, now) {
    const pos = this.positionAt(now);
    this.position = pos;
    this.motion = null;
    this.forcedUntil = now;
    const packets = [scene({ moves: [this._moveEvent(pos, 0, 5)] })].concat(this._clearForm(now));
    packets.push(scene({ skills: [this._skillEvent(383311, pos, pos)] }));
    packets.push(...this._buff(383315, now));
    let ident, packet;
    [ident, packet] = this.addObject(383321, pos);
    packets.push(packet);
    this._queue(now + 250, 'object_expire', ident);
    [ident, packet] = this.addObject(383331, pos);
    packets.push(packet);
    Object.assign(cast, { id: ident, pos, end: now + 3000, hits: new Set(), index: 0 });
    for (const target of enemies(this, { area: true })) {
      if (Math.hypot(pos[0] - target.positionAt(now)[0],
        pos[1] - target.positionAt(now)[1]) <= 216) {
        packets.push(...this._fieldHit(target, cast, now, cast.power.mul(D('3.19'))));
        for (const template of [383342, 383343]) {
          packets.push(...this._buff(template, now, target.id));
        }
      }
    }
    if (this.alive) packets.push(...this._buff(383345, now));
    this._queue(now + 250, 'shadow_field', cast);
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'shadow_energy') {
      if (!this.alive || this.generation !== data[0]) return [];
      this._queue(now + 1000, kind, ...data);
      return this._resource(-5);
    }
    if (kind === 'shadow_link') return this._linkStep(data[0], now);
    if (kind === 'shadow_link_slow') {
      const target = this.arena.actors.get(data[0]);
      return target && target.alive && target.generation === data[1]
        ? this._buff(383461, now, target.id) : [];
    }
    if (kind === 'shadow_field') return this._field(data[0], now);
    if (kind === 'shadow_ready') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      const pos = this.positionAt(now);
      if (cast.slot === 1) {
        this.position = this.blinkDestination(pos, cast.dest);
        this.motion = null;
        this.forcedUntil = now;
        const packets = [scene({ moves: [this._moveEvent(this.position, 0, 5)] }),
          scene({ skills: [this._skillEvent(383201, pos, this.position)] })];
        for (const template of [383201, 383203, 383204, 383205]) {
          packets.push(...this._buff(template, now));
        }
        return packets.concat([this._cooldown(0, true)], this.syncSpeed(now));
      }
      const packets = [];
      for (const template of [383312, 383313, 383314]) packets.push(...this.removeBuff(template, now));
      for (const template of [383302, 383303, 383304, 383305]) packets.push(...this._buff(template, now));
      const elapsed = this._setMotion(pos, cast.dest, 960, now, 3);
      this.forcedUntil = now + elapsed;
      this.dash = cast;
      packets.push(scene({ moves: [this._moveEvent(this.motion[1], 960, 3)] }));
      this._queue(now + Math.min(20, elapsed), 'shadow_dash', cast);
      return packets;
    }
    if (kind === 'shadow_dash') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive) return [];
      if (!this.motion || now >= this.motion[3]) return this._arrive(cast, now);
      this._queue(Math.min(now + 20, this.motion[3]), kind, cast);
      return [];
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if ((slot === 1 && !this.e_count)
      || (slot === 0 && start[0] === dest[0] && start[1] === dest[1])) return [];
    const power = this.combatStat('iEgAtk', now).mul(this._factor());
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 3000, 2: 25000, 10: 10000 }[slot], slot);
    if (slot === 0) {
      if (!this.hasBuff(383203, now)) {
        return this.shoot(383100, start, dest, now, power,
          { school: 'energy', basic: true }).concat([this._cooldown(0)]);
      }
      const cast = { power, generation: this.generation, hits: new Set(), index: 0 };
      const packets = this.shoot(383211, start, dest, now, D(0), {
        school: 'energy', basic: true, through_walls: true, context: cast,
      });
      for (const template of [383203, 383204]) packets.push(...this.removeBuff(template, now));
      return packets.concat([this._cooldown(0)]);
    }
    if (slot === 1 || slot === 2) {
      const pos = aimed(start, dest, slot === 1 ? 240 : 720);
      let body, stopped;
      [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      this.position = stopped.length ? body : start;
      this.motion = null;
      const cast = { slot, dest: pos, power, generation: this.generation };
      this.ready = cast;
      const packets = [scene({
        skills: [this._skillEvent(SLOTS[slot], start, pos, 0, { ready: 1 })],
      })];
      if (slot === 1) {
        this.e_count -= 1;
        if (!this.e_next_charge) this.e_next_charge = now + this.skillCooldown(8000);
      } else {
        this.info.untargetable = this.info.damage_immune = true;
        const [ident, packet] = this.addObject(383311, pos);
        packets.push(packet);
        this._queue(now + 1000, 'object_expire', ident);
        for (const template of [383312, 383313, 383314]) packets.push(...this._buff(template, now));
      }
      this._queue(now + (slot === 1 ? 100 : 500), 'shadow_ready', cast);
      return packets.concat([this._cooldown(slot)], this.syncSpeed(now), stopped);
    }
    const packets = [scene({ skills: [this._skillEvent(383401, start, start)] })];
    let lostAny = false;
    for (const target of enemies(this, { area: true })) {
      if (Math.hypot(start[0] - target.positionAt(now)[0],
        start[1] - target.positionAt(now)[1]) > 216) continue;
      const [hit, lost] = this._deal(target, power.mul(D('1.5')), now, this.generation,
        { school: 'energy' });
      packets.push(...hit);
      lostAny = lostAny || lost;
      if (!target.alive) continue;
      for (const template of [383403, 383404, 383405]) {
        packets.push(...this._buff(template, now, target.id));
      }
      if (!target.hasBuff(383403, now)) continue;
      const cast = {
        target: target.id, target_generation: target.generation,
        generation: this.generation, power, end: now + 3000, next_tick_at: now + 1000,
        version: target.buffVersions.get(383403),
        debuff_version: target.buffVersions.get(383404),
      };
      this.links.set(target.id, cast);
      this._queue(now + 100, 'shadow_link', cast);
    }
    if (this.links.size) packets.push(...this._buff(383406, now));
    if (lostAny) packets.push(...this._buff(383402, now));
    return packets.concat([this._cooldown(10)]);
  }
}

export { SLOTS as SHADOWBLADE_SLOTS };
