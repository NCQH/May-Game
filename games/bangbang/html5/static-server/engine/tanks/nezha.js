/* Na Tra (tank 10000082): returning rings, root spread, three-head form.
 * Port of server/nezha_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. Form max HP uses the missing S1560 attr 3.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, circleContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1562, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, packII, piercingStep, prepareDisplacement } from './melee.js';
import { maxHpPacket } from './batch-e-common.js';

const SLOTS = { 0: 356100, 1: 356201, 2: 356301, 10: 356401 };
const FORM_BUFFS = [356303, 356305, 356306, 356307, 356308, 356309, 356310, 356311,
  356324, 356325];

export class NezhaActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = this.form = this.e_follow = null;
    this.passive_ready_at = 0;
  }

  _skill(slot) {
    if (slot === 1 && this.e_follow) return 356211;
    if (this.form && this.form.landed) {
      return { 0: 356601, 1: 356221, 2: 356301, 10: 356411 }[slot];
    }
    return SLOTS[slot];
  }

  _cooldown(slot, changed = false) {
    const end = (slot === 1 && this.e_follow) || (slot === 2 && this.form)
      ? 0 : this.cooldowns[slot] ?? 0;
    const info = { skillId: this._skill(slot), slot, count: -1, end, nextCharge: 0 };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.ready = this.form = this.e_follow = null;
    this.passive_ready_at = 0;
    const packets = [];
    for (const template of [356101, 356102, 356103]) packets.push(...this._buff(template, now));
    for (const slot of [0, 1, 10]) packets.push(this._cooldown(slot, true));
    return packets;
  }

  attrBonus(attributes, now) {
    let value = super.attrBonus(attributes, now);
    if (attributes.includes(1) && this.hasBuff(356325, now)) {
      value = value.sub(D('.1').mul(D(this.buffStacks.get(356325) ?? 1)));
    }
    return value;
  }

  combatStat(key, now) {
    let value = super.combatStat(key, now);
    if (key === 'iAttack' && this.form && this.form.landed && this.hasBuff(356325, now)) {
      value = value.add(this.form.power.mul(D('.15')).mul(D(this.form.count)));
    }
    return value;
  }

  damage(raw, now, options = {}) {
    if (this.hasBuff(356121, now)) {
      raw = raw.mul(D(1).add(D('.1').mul(D(this.buffStacks.get(356121) ?? 0))));
    }
    return super.damage(raw, now, options);
  }

  onDamage(source, hit, now) {
    return this.alive && hit.hp_loss.gt(0) ? this._buff(356121, now) : [];
  }

  onControl(source, template, now) {
    if (!this.alive || now < this.passive_ready_at) return [];
    this.passive_ready_at = now + 3000;
    const packets = this.restoreHp(this.maxHp.sub(this.hp).mul(D('.1')), now);
    for (const [slot, amount] of [[1, 800], [10, 800], [2, 3000]]) {
      this.cooldowns[slot] = Math.max(now, this.cooldowns[slot] - amount);
      packets.push(this._cooldown(slot));
    }
    return packets;
  }

  _protection(now) { return this._buff(356111, now).concat(this._buff(356112, now)); }

  _vanished() { return Boolean(this.form && !this.form.landed); }

  blocked(action, now) {
    return this._vanished() || Boolean(this.ready) || super.blocked(action, now);
  }

  _speed(now) { return this._vanished() ? 0 : super._speed(now); }

  cc_immune(now, options) { return this.ccImmune(now, options); }

  ccImmune(now, options) { return this._vanished() || super.ccImmune(now, options); }

  rejectBuff(row, source, now) { return this._vanished() && source.camp !== this.camp; }

  _max_hp_packet() { return this._maxHpPacket(); }

  _maxHpPacket() {
    this.info.max_hp = this.maxHp.ceil();
    return maxHpPacket(this);
  }

  _endForm(now) {
    const form = this.form;
    this.form = null;
    if (!form) return [];
    this.info.untargetable = form.was_untargetable;
    this.info.damage_immune = form.was_immune;
    this.maxHp = form.max_hp;
    this.cooldowns[2] = now + this.skillCooldown(30000, 2);
    const packets = this.removeObject(form.object).concat([this._maxHpPacket()]);
    if (this.hp.gt(this.maxHp)) packets.push(...this.commitHp(this.maxHp, now));
    for (const template of FORM_BUFFS.concat([356302])) packets.push(...this.removeBuff(template, now));
    for (const slot of [0, 1, 2, 10]) packets.push(this._cooldown(slot, true));
    return packets.concat(this.syncSpeed(now));
  }

  _endFollow(now) {
    this.e_follow = null;
    return this.removeBuff(356205, now).concat([this._cooldown(1, true), this._cooldown(1)]);
  }

  interrupt(now) {
    if (this._vanished() && this.alive) return [];
    let packets = [];
    if (this.ready && this.ready.object !== undefined) {
      packets.push(...this.removeObject(this.ready.object));
    }
    if (this.ready) packets.push([1583, packII(this.id, this.ready.skill)]);
    this.ready = null;
    if (!this.alive) packets = packets.concat(this._endForm(now), this._endFollow(now));
    return packets;
  }

  _directions(start, dest, angles) {
    const angle = Math.atan2(dest[1] - start[1], dest[0] - start[0]);
    return angles.map(offset => [
      Math.round(start[0] + 480 * Math.cos(angle + offset * Math.PI / 180)),
      Math.round(start[1] + 480 * Math.sin(angle + offset * Math.PI / 180)),
    ]);
  }

  _root(target, now, chain) {
    const key = `${target.id},${target.generation}`;
    if (chain.visited.has(key) || target.hasBuff(356403, now)) return [];
    const packets = this._buff(356402, now, target.id);
    if (!target.hasBuff(356402, now) || target.buffSources.get(356402) !== this.id) return packets;
    chain.visited.add(key);
    packets.push(...this._buff(356403, now, target.id));
    this._queue(now + 1000, 'nezha_spread', chain, target.id, target.generation,
      target.buffVersions.get(356402));
    return packets;
  }

  _bulletHit(flight, target, now) {
    if (flight.basic) {
      const crit = flight.template === 356601;
      return this.damage(flight.raw, now, {
        target, basic: true, critical_handled: crit, critical_display: crit,
      })[0];
    }
    if (flight.template === 356401 || flight.template === 356411) {
      return this.damage(flight.raw, now, { target })[0]
        .concat(this._root(target, now, flight.context));
    }
    const cast = flight.context;
    const key = `${target.id},${target.generation}`;
    const raw = flight.raw.mul(cast.hits.has(key) ? D('.2') : D(1));
    cast.hits.add(key);
    return this.damage(raw, now, { target })[0].concat(this._buff(356202, now, target.id));
  }

  _returnRing(flight, pos, now) {
    if (!this.alive || this.generation !== flight.source_generation) return [];
    return this.shoot(356501, pos, this.positionAt(now), now, D(0), {
      school: 'physical', through_walls: true, target: this, context: flight.context,
    });
  }

  _flight(flight, now) {
    if (flight.template === 356501) {
      if (!this.alive || this.generation !== flight.source_generation) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      const start = flight.pos, dest = this.positionAt(now);
      const end = pointAt(start, dest, Math.min(1, flight.speed * (now - flight.previous)
        / 1000 / Math.max(1, Math.hypot(start[0] - dest[0], start[1] - dest[1]))));
      const packets = [];
      if (dest[0] !== flight.end[0] || dest[1] !== flight.end[1]) {
        packets.push([1562, encodeS1562(flight.id, start, dest)]);
      }
      flight.pos = end;
      flight.end = dest;
      const caught = circleContact(start, end, this.positionAt(flight.previous), dest, 48) !== null;
      if (caught || now >= flight.finish) {
        packets.push(scene({ expiredBullets: [flight.id] }));
        const cast = flight.context;
        if (caught && !cast.caught) {
          cast.caught = true;
          this.cooldowns[1] = now + this.skillCooldown(1500, 1);
          packets.push(...this._buff(356501, now));
          packets.push(this._cooldown(1));
        }
        return packets;
      }
      flight.previous = now;
      this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
      return packets;
    }
    if (flight.template !== 356201 && flight.template !== 356221) {
      return piercingStep(this, flight, now, (f, t, n) => this._bulletHit(f, t, n),
        { pierce: false });
    }
    const start = pointAt(flight.start, flight.end,
      (flight.previous - flight.begin) / (flight.finish - flight.begin));
    let end = pointAt(flight.start, flight.end,
      Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
    const contacts = [];
    for (const target of enemies(this)) {
      const hit = actorContact(start, end, target, flight.previous, now);
      if (hit !== null) contacts.push([hit, target.id, target]);
    }
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const packets = [];
    if (contacts.length) {
      const [hit, , target] = contacts[0];
      if (this.projectileBlocked(target, now)) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      packets.push(...this._bulletHit(flight, target, now));
      end = pointAt(start, end, hit);
    }
    if (contacts.length || now >= flight.finish) {
      packets.push(scene({ blownBullets: [flight.id] }));
      return packets.concat(this._returnRing(flight, end.map(pyRound), now));
    }
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'nezha_follow_end') {
      return this.e_follow === data[0] ? this._endFollow(now) : [];
    }
    if (kind === 'nezha_e') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      const start = this.positionAt(now);
      const skill = cast.skill;
      const packets = [scene({ skills: [this._skillEvent(skill, start, cast.dest)] })];
      const angles = skill === 356221 ? [0, 120, -120] : [0];
      for (const dest of this._directions(start, cast.dest, angles)) {
        packets.push(...this.shoot(skill, start, dest, now, cast.power.mul(D('2.12')), {
          school: 'physical', through_walls: true, context: cast,
        }));
      }
      return packets;
    }
    if (kind === 'nezha_spread') {
      const [chain, ident, generation, version] = data;
      const target = this.arena.actors.get(ident);
      if (!target || !target.alive || target.generation !== generation
        || target.buffVersions.get(356402) !== version) return [];
      const packets = [];
      for (const other of enemies(this, { area: true })) {
        if (Math.hypot(target.positionAt(now)[0] - other.positionAt(now)[0],
          target.positionAt(now)[1] - other.positionAt(now)[1]) <= 144) {
          packets.push(...this._root(other, now, chain));
        }
      }
      return packets;
    }
    if (kind === 'nezha_form_start') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive) return [];
      this.ready = null;
      this.form = cast;
      Object.assign(cast, {
        landed: false, count: 0, max_hp: this.maxHp,
        was_immune: this.info.damage_immune ?? false,
        was_untargetable: this.info.untargetable ?? false,
        end: now + 13000,
      });
      const packets = this.cleanse(now)
        .concat(this.restoreHp(this.maxHp.sub(this.hp).mul(D('.4')), now));
      this.info.untargetable = this.info.damage_immune = true;
      this.position = cast.dest;
      this.motion = null;
      packets.push(...this._buff(356302, now));
      this._queue(now + 1000, 'nezha_land', cast);
      this._queue(cast.end, 'nezha_form_end', cast);
      return packets.concat([scene({ moves: [this._moveEvent(this.position, 0, 5)] })],
        this.syncSpeed(now));
    }
    if (kind === 'nezha_land') {
      const [cast] = data;
      if (this.form !== cast || !this.alive) return [];
      this.info.untargetable = cast.was_untargetable;
      this.info.damage_immune = cast.was_immune;
      const packets = this.removeObject(cast.object, { destroyed: true })
        .concat(this.removeBuff(356302, now));
      const targets = enemies(this, { area: true }).filter(target =>
        Math.hypot(cast.dest[0] - target.positionAt(now)[0],
          cast.dest[1] - target.positionAt(now)[1]) <= 216);
      cast.count = Math.min(3, targets.filter(target => !target.info.npc_template).length);
      for (const target of targets) {
        packets.push(...this.damage(cast.power.mul(D('2.1')), now, { target })[0]);
        packets.push(...this._buff(356322, now, target.id));
      }
      cast.landed = true;
      const bonus = cast.max_hp.mul(D('.15')).mul(D(cast.count));
      this.maxHp = cast.max_hp.add(bonus);
      packets.push(this._maxHpPacket());
      packets.push(...this.commitHp(this.maxHp.min(this.hp.add(bonus)), now));
      for (const template of FORM_BUFFS) {
        if ([356324, 356325].includes(template) && !cast.count) continue;
        packets.push(...this._buff(template, now, null, {
          duration: 12000,
          stacks: [356324, 356325].includes(template) ? cast.count : null,
        }));
      }
      for (const slot of [0, 1, 10]) packets.push(this._cooldown(slot, true));
      return packets.concat(this.syncSpeed(now));
    }
    if (kind === 'nezha_form_end') {
      return this.form === data[0] ? this._endForm(now) : [];
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)) return [];
    const follow = slot === 1 && this.e_follow;
    if (!follow && this.cooldowns[slot] > now) return [];
    if (start[0] === dest[0] && start[1] === dest[1]) return [];
    if (slot === 2 && (this.form || !this._inside(dest)
      || Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 720)) return [];
    const skill = this._skill(slot), power = this.combatStat('iAttack', now);
    const packets = [];
    if (slot === 0) {
      this.cooldowns[0] = now + this.fireInterval(now);
      const angles = skill === 356601
        ? Array.from({ length: 9 }, (_, i) => -160 + i * 40) : [0];
      for (const aim of this._directions(start, dest, angles)) {
        packets.push(...this.shoot(skill, start, aim, now, power,
          { school: 'physical', basic: true }));
      }
    } else if (follow) {
      packets.push(...this._endFollow(now), ...this._protection(now));
      const duration = this._setMotion(start, aimed(start, dest, 240, { fixed: true }),
        720, now, 3);
      this.forcedUntil = now + duration;
      packets.push(scene({
        skills: [this._skillEvent(356211, start, this.motion[1])],
        moves: [this._moveEvent(this.motion[1], 720, 3)],
      }));
    } else if (slot === 1) {
      this.cooldowns[1] = now + this.skillCooldown(8000, 1);
      this.e_follow = { end: now + 3000 };
      packets.push(...this._protection(now), ...this._buff(356205, now));
      const cast = { slot: 1, skill, power, dest, hits: new Set(), caught: false };
      this.ready = cast;
      this._queue(now + 50, 'nezha_e', cast);
      packets.push(scene({ skills: [this._skillEvent(skill, start, dest, 0, { ready: 1 })] }));
      this._queue(now + 3000, 'nezha_follow_end', this.e_follow);
      packets.push(this._cooldown(1, true));
    } else if (slot === 10) {
      this.cooldowns[10] = now + this.skillCooldown(8000, 10);
      packets.push(...this._protection(now));
      const chain = { visited: new Set() };
      const angles = skill === 356411 ? [0, 120, -120] : [0];
      for (const aim of this._directions(start, dest, angles)) {
        packets.push(...this.shoot(skill, start, aim, now, power.mul(D('1.69')), {
          school: 'physical', through_walls: true, context: chain,
        }));
      }
    } else {
      const pos = this.blinkDestination(start, dest);
      const [ident, packet] = this.addObject(356314, pos);
      this.ready = { slot: 2, skill: 356301, dest: pos, object: ident, power };
      this.cooldowns[2] = now + this.skillCooldown(30000, 2);
      packets.push(packet, scene({
        skills: [this._skillEvent(356301, start, pos, 0, { ready: 1 })],
      }), ...this._protection(now));
      this._queue(now + 100, 'nezha_form_start', this.ready);
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as NEZHA_SLOTS, FORM_BUFFS as NEZHA_FORM_BUFFS };
