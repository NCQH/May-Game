/* Kakashi (tank 10000055): chakra, substitution wood, Kamui field and dash.
 * Port of server/kakashi_actions.py.
 *
 * Stubs: the borrowed-kit executor (kakashi_borrowing.py) is not ported, so E
 * returns nothing; the wood clone reuses StrangeShadow. No skin effects.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, stop_move, encodeS1556, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, packII, prepareDisplacement } from './melee.js';
import { StrangeShadow } from './strange.js';

const SLOTS = { 0: 330100, 1: 330201, 2: 330301, 10: 330401 };

export class KakashiActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = 150;
    this.ready = this.dash = this.vanish = this.kamui = null;
    this.passive_ready_at = 0;
    this._cast_pen = D(0);
    this._borrow_damage_multiplier = null;
  }

  _cooldown(slot, changed = false) {
    let skill = slot === 0 && this.hasBuff(330111, this.clock()) ? 330141 : SLOTS[slot];
    let end = this.cooldowns[slot];
    if (slot === 2 && this.kamui) { skill = 330311; end = this.kamui.begin + 1000; }
    const info = { skillId: skill, slot, count: -1, end, nextCharge: 0 };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _resource(amount) {
    if (!this.alive || this.inStasis()) return [];
    this.mp = Math.min(150, Math.max(0, this.mp + amount));
    return [scene({ mp: [{ objectId: this.id, mp: pyRound(this.mp) }] })];
  }

  on_spawn(now) {
    this.mp = 150;
    this.ready = this.dash = this.vanish = this.kamui = null;
    this.passive_ready_at = 0;
    this._queue(now + 1000, 'kakashi_regen', this.generation);
    const packets = this._resource(0);
    for (const template of [330101, 330102, 330103]) packets.push(...this._buff(template, now));
    for (const slot of [0, 1, 2, 10]) packets.push(this._cooldown(slot, true));
    return packets;
  }

  damage_bonus(target) {
    if (this._borrow_damage_multiplier !== null) return this._borrow_damage_multiplier;
    const now = this.arena.eventNow || this.clock();
    return this.hasBuff(330122, now)
      ? D(1).add(D('.1').mul(D(this.buffStacks.get(330122) ?? 0))) : D(1);
  }

  damage(raw, now, options = {}) {
    const triggerPassive = options.trigger_passive ?? true;
    const { trigger_passive, pen_snapshot, ...rest } = options;
    const previous = this._borrow_pen;
    this._borrow_pen = pen_snapshot
      ?? this.arena.currentFlight?.kakashi_pen ?? previous;
    let packets, lost;
    try { [packets, lost] = super.damage(raw, now, rest); }
    finally { this._borrow_pen = previous; }
    if (this.arena.pk && this.arena.pk.finished) return [packets, lost];
    const target = rest.target || this.enemy;
    const generation = rest.source_generation ?? this.generation;
    if (triggerPassive && lost && !rest.basic && !rest.reflected
      && target && !target.info.npc_template && target.camp !== this.camp
      && this.alive && this.generation === generation) {
      packets.push(...this._resource(10), ...this._buff(330122, now));
    }
    return [packets, lost];
  }

  _empower(now) { return this._buff(330111, now).concat([this._cooldown(0, true)]); }

  _break_stealth(now) {
    return this.hasBuff(330131, now) ? this.removeBuff(330131, now) : [];
  }

  isUntargetable() {
    const now = this.arena.eventNow || this.clock();
    return Boolean(this.vanish)
      || (this.hasBuff(330131, now) && !this.buffTypes(now).has(32))
      || super.isUntargetable();
  }

  is_untargetable() { return this.isUntargetable(); }

  isAreaTargetable() { return !this.vanish && super.isAreaTargetable(); }

  is_area_targetable() { return this.isAreaTargetable(); }

  ccImmune(now, { slow = false } = {}) {
    return Boolean(this.vanish) || super.ccImmune(now, { slow });
  }

  cc_immune(now, options) { return this.ccImmune(now, options); }

  damageImmune(school, now, periodic = false) {
    return Boolean(this.vanish) || super.damageImmune(school, now, periodic);
  }

  blocked(action, now) {
    return Boolean(this.ready || this.dash || this.vanish) || super.blocked(action, now);
  }

  _speed(now) {
    return this.ready || this.dash || this.vanish ? 0 : super._speed(now);
  }

  _stop_packets(packets, position, movement = []) {
    // Install ready/disappear/auto-move before S1554's held-key retry.
    const attrs = packets.filter(p => p[0] === 1560);
    const stop = stop_move(this.sceneId, this.id, position);
    const rest = packets.filter(p => p[0] !== 1560 && p !== stop && !movement.includes(p));
    return rest.concat([stop], movement, attrs);
  }

  removeBuff(template, now, { expired = false } = {}) {
    const packets = super.removeBuff(template, now, { expired });
    if (template === 330111) packets.push(this._cooldown(0, true));
    return packets;
  }

  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  _substitute(now, { lethal = false } = {}) {
    if (lethal) {
      this.passive_ready_at = now + 30000;
      this.hp = D(1);
      this.info.hp = 1;
    }
    const packets = lethal ? this.cleanse(now) : [];
    packets.push(this._hpPacket(this.id, this.hp));
    packets.push(scene({
      skills: [this._skillEvent(330101, this.positionAt(now), this.positionAt(now))],
    }));
    for (const template of [330131, 330132, 330133, 330135]) {
      packets.push(...this._buff(template, now));
    }
    const stats = { ...this.stats };
    for (const key of ['iAttack', 'iEgAtk', 'iArmor', 'iEgArmor', 'iCentesis', 'iEgCtsis']) {
      stats[key] = this.combatStat(key, now).toString();
    }
    stats.iHp = this.maxHp.toString();
    const info = {
      acct_id: this.info.acct_id, tank_id: this.info.tank_id,
      tank_level: this.info.tank_level, npc_template: 20003, owner: this.id,
      source_generation: this.generation, name: this.info.name, in_room: true,
      summon_stats: stats, summon_hp: this.maxHp.toString(),
    };
    const wood = new KakashiWood(this.arena, this._newId(5), info, this.camp,
      this.positionAt(now));
    this.arena.actors.set(wood.id, wood);
    wood._queue(now + 2500, 'kakashi_wood_end');
    return packets.concat([wood.snapshot(now)]);
  }

  preventLethalHit(hit, now) {
    if (this.alive && hit.hp_after.isZero() && now >= this.passive_ready_at) {
      this.shields = hit.shields;
      return this._substitute(now, { lethal: true }).concat([this.shieldPacket(now)]);
    }
    return null;
  }

  commitHp(hp, now, { critical = false } = {}) {
    if (this.alive && D(hp).isZero() && now >= this.passive_ready_at) {
      return this._substitute(now, { lethal: true });
    }
    return super.commitHp(hp, now, { critical });
  }

  on_damage(source, hit, now, school, reflected, attacker_ap) {
    const packets = super.onDamage(source, hit, now, school, reflected, attacker_ap);
    return packets.concat(this.alive && hit.hp_loss.gt(0) ? this._break_stealth(now) : []);
  }

  on_skill_damage(source, hit, now) {
    const packets = super.onSkillDamage(source, hit, now);
    if (this.alive && hit.hp_loss.gt(0) && this.hasBuff(330403, now)) {
      return packets.concat(this.removeBuff(330403, now), this._substitute(now));
    }
    return packets;
  }

  on_control(source, template, now) {
    const packets = super.onControl(source, template, now);
    const effect = this.arena.data
      .tableRow('BuffTemplate_table.xml', { nBuffId: template }).get('nEffectType');
    return ['30', '35', '66'].includes(effect) && template !== 330304
      ? packets.concat(this.interrupt(now)) : packets;
  }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      packets.push([1583, packII(this.id, this.ready.skill)]);
      this.ready = null;
    }
    if (this.dash) {
      // CC/death may have cleared motion before calling interrupt.
      const origin = this.motion ? this.motion[0] : (this.dash.start ?? this.position);
      this.position = this.moveDestination(origin, this.positionAt(now));
      this.motion = null;
      this.dash = null;
      packets.push(stop_move(this.sceneId, this.id, this.position));
      packets.push(...this.removeBuff(330402, now), ...this.removeBuff(50353, now));
    }
    if (!this.alive) {
      this.vanish = null;
      if (this.kamui) packets.push(...this._end_kamui(now, { explode: false }));
    }
    return packets.concat(super.interrupt(now), this.syncSpeed(now));
  }

  _end_kamui(now, { explode }) {
    const cast = this.kamui;
    this.kamui = null;
    if (!cast) return [];
    const packets = [];
    const blast = explode && this.alive && this.generation === cast.generation;
    // Only the completed Kamui field owns the native remove movie.
    for (let index = 0; index < cast.objects.length; index += 1) {
      packets.push(...this.removeObject(cast.objects[index],
        { destroyed: blast && index === 0 }));
    }
    for (const target of this.arena.actors.values()) {
      for (const template of [330304, 330305]) {
        if (target.buffSources.get(template) === this.id) {
          packets.push(...target.removeBuff(template, now));
        }
      }
    }
    for (const template of [330307, 330308, 330310]) packets.push(...this.removeBuff(template, now));
    packets.push(this._cooldown(2, true));
    if (blast) {
      for (const target of enemies(this, { area: true })) {
        const tpos = target.positionAt(now);
        if (Math.hypot(cast.pos[0] - tpos[0], cast.pos[1] - tpos[1]) <= 192) {
          packets.push(...this.damage(cast.power.mul(D('3.39')), now, {
            target, school: 'energy', pen_snapshot: cast.pen,
          })[0]);
        }
      }
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'kakashi_regen') {
      if (!this.alive || this.generation !== data[0]) return [];
      this._queue(now + 1000, kind, this.generation);
      return this._resource(5);
    }
    if (kind === 'kakashi_ready') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.generation !== cast.generation) return [];
      this.ready = null;
      const start = this.positionAt(now);
      let packets = [scene({ skills: [this._skillEvent(cast.skill, start, cast.dest)] })];
      if (cast.skill === 330141) {
        const dest = this.blinkDestination(start, aimed(start, cast.dest, 300));
        this.position = dest;
        this.motion = null;
        this.vanish = cast;
        cast.pos = dest;
        packets.push(...this._buff(330143, now));
        packets = this._stop_packets(packets, dest);
        for (const [template, pos, duration] of
          [[330142, start, 700], [330144, dest, 500]]) {
          const [ident, packet] = this.addObject(template, pos);
          packets.push(packet);
          this._queue(now + duration, 'object_expire', ident);
        }
        this._queue(now + 500, 'kakashi_thunder', cast);
      } else {
        cast.pos = start;
        cast.objects = [];
        const [ident, packet] = this.addObject(330301, start);
        cast.objects.push(ident);
        packets.push(packet);
        this._queue(now + 250, 'kakashi_open', cast);
      }
      return packets.concat(this.syncSpeed(now));
    }
    if (kind === 'kakashi_thunder') {
      const [cast] = data;
      if (this.vanish !== cast || !this.alive || this.generation !== cast.generation) return [];
      this.vanish = null;
      const packets = this.removeBuff(330143, now);
      for (const target of enemies(this, { area: true })) {
        const tpos = target.positionAt(now);
        if (Math.hypot(cast.pos[0] - tpos[0], cast.pos[1] - tpos[1]) <= 120) {
          packets.push(...this._buff(330145, now, target.id));
          packets.push(...this.damage(cast.power, now, {
            target, school: 'true', basic: true,
          })[0]);
        }
      }
      return packets.concat(this.syncSpeed(now));
    }
    if (kind === 'kakashi_open') {
      const [cast] = data;
      const packets = [];
      for (const ident of cast.objects) packets.push(...this.removeObject(ident));
      if (!this.alive || this.generation !== cast.generation) return packets;
      cast.begin = now;
      cast.end = now + 3000;
      cast.objects = [];
      this.kamui = cast;
      for (const template of [330302, 330303]) {
        const [ident, packet] = this.addObject(template, cast.pos);
        cast.objects.push(ident);
        packets.push(packet);
      }
      packets.push(...this._buff(330307, now), ...this._buff(330308, now),
        this._cooldown(2, true));
      for (const i of [1, 2, 3]) this._queue(now + 1000 * i, 'kakashi_heal', cast);
      packets.push(...this._event(now, 'kakashi_field', [cast]));
      return packets;
    }
    if (kind === 'kakashi_field') {
      const [cast] = data;
      if (this.kamui !== cast) return [];
      if (!this.alive || this.generation !== cast.generation) {
        return this._end_kamui(now, { explode: false });
      }
      if (now >= cast.end) return this._end_kamui(now, { explode: true });
      const packets = [];
      for (const target of [...this.arena.actors.values()]) {
        const tpos = target.positionAt(now);
        if (!target.alive || !target.isAreaTargetable()
          || Math.hypot(cast.pos[0] - tpos[0], cast.pos[1] - tpos[1]) > 192) continue;
        const duration = Math.min(300, cast.end - now);
        if (!target.ccImmune(now)) {
          packets.push(...this._buff(330304, now, target.id, { duration }));
        }
        packets.push(...this._buff(330305, now, target.id, { duration }));
      }
      this._queue(Math.min(now + 250, cast.end), kind, cast);
      return packets;
    }
    if (kind === 'kakashi_heal') {
      const [cast] = data;
      const pos = this.positionAt(now);
      return this.kamui === cast && this.alive
        && Math.hypot(pos[0] - cast.pos[0], pos[1] - cast.pos[1]) <= 192
        ? this.restoreHp(cast.power.mul(D('.75')), now) : [];
    }
    if (kind === 'kakashi_dash') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive) return [];
      // Roots can stop motion without interrupting attack-capable casts.
      if (this.motion === null) {
        this.dash = null;
        return [stop_move(this.sceneId, this.id, this.position)]
          .concat(this.removeBuff(330402, now), this.removeBuff(50353, now), this.syncSpeed(now));
      }
      const start = this.positionAt(cast.previous), end = this.positionAt(now);
      const contacts = [];
      for (const target of enemies(this)) {
        const hit = actorContact(start, end, target, cast.previous, now);
        if (hit !== null) contacts.push([hit, target.id, target]);
      }
      contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const packets = [];
      if (contacts.length) {
        const [hit, , target] = contacts[0];
        const pos = this.moveDestination(this.motion[0],
          pointAt(start, end, hit).map(pyRound));
        this.position = pos;
        this.motion = null;
        packets.push(stop_move(this.sceneId, this.id, pos));
        packets.push(scene({ skills: [this._skillEvent(330411, pos, pos, target.id)] }));
        for (const other of enemies(this, { area: true })) {
          const tpos = other.positionAt(now);
          if (Math.hypot(pos[0] - tpos[0], pos[1] - tpos[1]) > 144) continue;
          packets.push(...this.damage(cast.power.mul(D('1.75')), now, {
            target: other, school: 'energy', pen_snapshot: cast.pen,
          })[0]);
          if (this.arena.pk && this.arena.pk.finished) break;
          packets.push(...this._buff(330412, now, other.id));
          if (other.alive && !other.ccImmune(now)) {
            const p = other.positionAt(now);
            const dest = p[0] !== pos[0] || p[1] !== pos[1]
              ? aimed(pos, p, Math.hypot(pos[0] - p[0], pos[1] - p[1]) + 72, { fixed: true })
              : [p[0] + 72, p[1]];
            other._setMotion(p, dest, 480, now, 1);
            other.forcedUntil = other.motion[3];
            packets.push(scene({ moves: [other._moveEvent(other.motion[1], 480, 1)] }));
          }
        }
      }
      if (contacts.length || !this.motion || now >= this.motion[3]) {
        if (!contacts.length) {
          this.position = this.positionAt(now);
          this.motion = null;
          packets.push(stop_move(this.sceneId, this.id, this.position));
        }
        this.dash = null;
        packets.push(...this.removeBuff(330402, now), ...this.removeBuff(50353, now));
        return packets.concat(this.syncSpeed(now));
      }
      cast.previous = now;
      this._queue(Math.min(now + 20, this.motion[3]), kind, cast);
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (slot === 1) return []; // Borrowed-kit executor not ported (kakashi_borrowing.py).
    if (slot === 2 && this.kamui) {
      if (!this.alive || this.inStasis() || now < this.kamui.begin + 1000) return [];
      return this._end_kamui(now, { explode: false });
    }
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || now < this.cooldowns[slot]) return [];
    const fee = { 0: 0, 2: 75, 10: 25 }[slot];
    if (this.mp < fee
      || ((slot === 0 || slot === 10) && start[0] === dest[0] && start[1] === dest[1])) return [];
    const power = this.combatStat('iEgAtk', now);
    this._cast_pen = this.hasBuff(305201, now) ? D('.25') : D(0);
    const packets = this._resource(-fee);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 2: 30000, 10: 8000 }[slot], slot);
    let skill;
    let movement = [];
    if (slot === 0 && !this.hasBuff(330111, now)) {
      return packets.concat(this.shoot(330100, start, dest, now, power, {
        school: 'energy', basic: true,
      }), [this._cooldown(0)]);
    }
    if (slot === 0) {
      packets.push(...this.removeBuff(330111, now));
      skill = 330141;
      const [warning, packet] = this.addObject(330151,
        this.blinkDestination(start, aimed(start, dest, 300)));
      packets.push(packet);
      this._queue(now + 450, 'object_expire', warning);
    } else {
      packets.push(...this._empower(now));
      skill = SLOTS[slot];
    }
    const [body, handoff] = prepareDisplacement(this, now, { interrupt: false });
    const origin = handoff.length ? body : start;
    if (slot === 10) {
      const duration = this._setMotion(origin, aimed(start, dest, 480), 720, now, 3);
      this.dash = {
        start, previous: now, generation: this.generation, power, pen: this._cast_pen,
      };
      this._queue(now + Math.min(20, duration), 'kakashi_dash', this.dash);
      // BUT_AUTO_MOVE/MOVE_DASH marker: held movement keys must stop.
      packets.push(...this._buff(50353, now), ...this._buff(330402, now),
        ...this._buff(330403, now));
      movement = [scene({
        moves: [this._moveEvent(this.motion[1], 720, 3)],
        skills: [this._skillEvent(skill, start, dest)],
      })];
    } else {
      this.position = origin;
      this.motion = null;
      this.ready = {
        slot, skill, dest, power, generation: this.generation, pen: this._cast_pen,
      };
      this._queue(now + 50, 'kakashi_ready', this.ready);
      packets.push(scene({ skills: [this._skillEvent(skill, start, dest, 0, { ready: 1 })] }));
    }
    return this._stop_packets(packets.concat([this._cooldown(slot)], this.syncSpeed(now),
      handoff), origin, movement);
  }
}

export class KakashiWood extends StrangeShadow {
  snapshot(now) {
    const [x, y] = this.positionAt(now);
    return [1556, encodeS1556(this.sceneId, {
      objectId: this.id, templateId: 20003, x, y, hp: this.hp.ceil(), camp: this.camp,
      maxHp: this.maxHp.ceil(), ownerId: this.info.owner, shield: 0, buffs: [],
    })];
  }

  _event(now, kind, data) {
    if (kind === 'kakashi_wood_end') return this.alive ? this.commitHp(D(0), now) : [];
    return super._event(now, kind, data);
  }
}

export { SLOTS as KAKASHI_SLOTS };
