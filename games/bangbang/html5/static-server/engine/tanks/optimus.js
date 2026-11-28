/* Optimus (tank 10000062): live rage, independent sword area, timed melee form.
 * Port of server/optimus_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. Rage is an integer 0..200 like the source.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pyRound } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, inCone, inStrip, piercingStep } from './melee.js';

const SLOTS = { 0: 819010, 1: 819021, 2: 819031, 10: 819041 };
const FORM_SLOTS = [8190311, 8190312, 8190315, 8190316, 8190114, 8190115];

export class OptimusActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.mp = 0;
    this.form = null;
    this.swing = 819012;
    this.swords = [];
    this.proc_locks = new Map();
    this.dash = null;
  }

  _cooldown(slot, changed = false) {
    const skill = slot === 0 && this.form ? this.swing : SLOTS[slot];
    const info = {
      skillId: skill, slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _resource(delta, now = null) {
    now = now === null ? this.clock() : now;
    if (this.noel_box) return [];
    const old = this.mp;
    this.mp = Math.max(0, Math.min(200, this.mp + delta));
    return old !== this.mp
      ? [scene({ mp: [{ objectId: this.id, mp: this.mp }] })].concat(this.syncSpeed(now)) : [];
  }

  attrBonus(attributes, now) {
    let value = super.attrBonus(attributes, now);
    if (attributes.includes(10) && this.hasBuff(8190101, now)) {
      value = value.add(D('.5').mul(D(this.mp)).div(D(200)));
    }
    return value;
  }

  _speed(now) {
    let base = super._speed(now);
    if (!this.buffTypes(now).has(36) && this.hasBuff(8190102, now)) {
      base += pyRound(D(this.stats.iSpeed).mul(D('.5')).mul(D(this.mp)).div(D(200)));
    }
    return base;
  }

  on_spawn(now) {
    this.mp = 0;
    this.form = this.dash = null;
    this.swing = 819012;
    this.proc_locks.clear();
    this._queue(now + 600, 'optimus_rage', this.generation);
    const packets = [scene({ mp: [{ objectId: this.id, mp: 0 }] }), this._cooldown(0, true)];
    for (let template = 8190101; template < 8190108; template += 1) {
      packets.push(...this._buff(template, now));
    }
    return packets;
  }

  onDamage(source, hit, now) {
    return this.alive && hit.hp_loss.gt(0) ? this._resource(5, now) : [];
  }

  _hit(target, power, now, { basic = false, school = 'physical', current = true } = {}) {
    const before = target.hp;
    const key = `${target.id},${target.generation}`;
    const lock = this.proc_locks.get(key);
    const proc = basic && (lock?.end ?? 0) <= now;
    const [packets, lost] = this.damage(power, now, { target, basic, school });
    if (lost && current && this.alive) packets.push(...this._resource(basic ? 5 : 25, now));
    if (proc && lost) {
      this.proc_locks.set(key, { end: now + 6000 });
      packets.push(...this.damage(before.mul(D('.1')), now,
        { target, school: 'true', basic: true })[0]);
      packets.push(...this._buff(8190113, now, target.id));
    }
    return packets;
  }

  onBulletHit() { return []; }

  _flight(flight, now) {
    return piercingStep(this, flight, now, (f, t, n) => this._hit(t, f.raw, n, {
      basic: true,
      current: this.alive && this.generation === f.source_generation,
    }), { pierce: false });
  }

  _endForm(now) {
    if (!this.form) return [];
    this.form = null;
    this.cooldowns[2] = now + this.skillCooldown(25000, 2);
    const packets = [];
    for (const template of FORM_SLOTS) packets.push(...this.removeBuff(template, now));
    packets.push(...this._buff(8190321, now));
    return packets.concat([this._cooldown(0, true), this._cooldown(2)]);
  }

  interrupt(now) {
    this.dash = null;
    return this.alive ? [] : this._endForm(now);
  }

  _swordArea(cast, now) {
    const packets = [];
    for (const target of [...this.arena.actors.values()]) {
      if (!target.alive || Math.hypot(cast.pos[0] - target.positionAt(now)[0],
        cast.pos[1] - target.positionAt(now)[1]) > 192) continue;
      const template = target.id === this.id && this.generation === cast.generation ? 8190421
        : target.camp === this.camp ? 8190422 : 8190423;
      packets.push(...this._buff(template, now, target.id,
        { duration: Math.min(550, cast.end - now) }));
    }
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'optimus_rage') {
      if (!this.alive || data[0] !== this.generation) return [];
      this._queue(now + 600, kind, ...data);
      return this._resource(-5, now);
    }
    if (kind === 'optimus_sword_land') {
      const [cast] = data;
      const packets = this.removeObject(cast.id);
      let packet;
      [cast.id, packet] = this.addObject(8190412, cast.pos);
      cast.end = now + 2000;
      packets.push(packet);
      for (const target of enemies(this, { area: true })) {
        if (Math.hypot(cast.pos[0] - target.positionAt(now)[0],
          cast.pos[1] - target.positionAt(now)[1]) <= 192) {
          packets.push(...this._hit(target, cast.power.mul(D('1.88')), now,
            { current: this.alive && this.generation === cast.generation }));
        }
      }
      packets.push(...this._swordArea(cast, now));
      this._queue(now + 500, 'optimus_area', cast);
      return packets;
    }
    if (kind === 'optimus_area') {
      const [cast] = data;
      if (now >= cast.end) {
        this.swords = this.swords.filter(sword => sword !== cast);
        return this.removeObject(cast.id);
      }
      this._queue(now + 500, kind, cast);
      return this._swordArea(cast, now);
    }
    if (kind === 'optimus_form_end') return this.form === data[0] ? this._endForm(now) : [];
    if (kind === 'optimus_dash') {
      const [cast] = data;
      if (this.dash !== cast || !this.alive) return [];
      const start = this.positionAt(cast.previous), end = this.positionAt(now);
      const packets = [];
      for (const target of enemies(this)) {
        const key = `${target.id},${target.generation}`;
        if (cast.hits.has(key)
          || actorContact(start, end, target, cast.previous, now) === null) continue;
        cast.hits.add(key);
        packets.push(...this._buff(8190222, now, target.id));
        packets.push(...this._hit(target, cast.power.mul(D('1.96')), now));
      }
      if (!this.motion || now >= this.motion[3]) this.dash = null;
      else {
        cast.previous = now;
        this._queue(Math.min(now + 20, this.motion[3]), kind, cast);
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (([0, 1].includes(slot) && start[0] === dest[0] && start[1] === dest[1])
      || (slot === 2 && (this.form || this.mp < 100))) return [];
    if (slot === 10 && (!this._inside(dest) || Math.hypot(start[0] - dest[0],
      start[1] - dest[1]) > 480)) return [];
    const power = this.combatStat('iAttack', now);
    const packets = [];
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 6000, 2: 0, 10: 8000 }[slot], slot);
    if (slot === 0) {
      if (!this.form) {
        return this.shoot(819010, start, dest, now, power,
          { school: 'physical', basic: true }).concat([this._cooldown(0)]);
      }
      const skill = this.swing;
      packets.push(scene({ skills: [this._skillEvent(skill, start, dest)] }));
      for (const target of enemies(this, { area: true })) {
        if (inCone(target.positionAt(now), start, dest, 216, 180)) {
          packets.push(...this._hit(target, power, now, { basic: true, school: 'true' }));
          packets.push(...this._buff(8190116, now, target.id));
        }
      }
      this.swing = skill === 819012 ? 819013 : 819012;
      packets.push(this._cooldown(0, true));
    } else if (slot === 1) {
      packets.push(scene({ skills: [this._skillEvent(819021, start, dest)] }));
      for (const target of enemies(this, { area: true })) {
        if (inStrip(target.positionAt(now), start, dest, 480, 72)) {
          packets.push(...this._hit(target, power.mul(D('1.46')), now));
          packets.push(...this._buff(8190214, now, target.id));
        }
      }
      packets.push(...this._buff(8190215, now));
      const swords = this.swords.filter(sword => sword.end > now
        && sword.generation === this.generation && inStrip(sword.pos, start, dest, 480, 72));
      if (swords.length && !(this.arena.pk && this.arena.pk.finished)) {
        const chosen = swords.reduce((best, sword) => (Math.hypot(start[0] - sword.pos[0],
          start[1] - sword.pos[1]) < Math.hypot(start[0] - best.pos[0],
          start[1] - best.pos[1]) ? sword : best));
        const duration = this._setMotion(start, chosen.pos, 960, now, 3);
        this.forcedUntil = now + duration;
        this.dash = { previous: now, hits: new Set(), power };
        packets.push(...this._buff(8190221, now, null, { duration }));
        packets.push(scene({ moves: [this._moveEvent(this.motion[1], 960, 3)] }));
        this._queue(now + Math.min(20, duration), 'optimus_dash', this.dash);
      }
    } else if (slot === 10) {
      let ident, packet;
      [ident, packet] = this.addObject(8190411, dest);
      const cast = { id: ident, pos: dest, power, generation: this.generation, end: now + 2500 };
      this.swords.push(cast);
      packets.push(packet);
      this._queue(now + 500, 'optimus_sword_land', cast);
    } else {
      packets.push(...this._resource(-100, now));
      this.form = { end: now + 8000 };
      this.swing = 819012;
      packets.push(scene({ skills: [this._skillEvent(819031, start, start, this.id)] }));
      for (const target of enemies(this, { area: true })) {
        const span = Math.hypot(start[0] - target.positionAt(now)[0],
          start[1] - target.positionAt(now)[1]);
        if (span <= 216) {
          packets.push(...this._hit(target, power.mul(D('3.37').sub(
            D('1.685').mul(D(String(span))).div(D(216)))), now));
          for (const template of [8190313, 8190317]) {
            packets.push(...this._buff(template, now, target.id));
          }
        }
      }
      for (const template of [8190311, 8190312, 8190315, 8190316]) {
        packets.push(...this._buff(template, now));
      }
      packets.push(this._cooldown(0, true));
      this._queue(now + 8000, 'optimus_form_end', this.form);
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as OPTIMUS_SLOTS };
