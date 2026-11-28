/* Thach Sanh (tank 10000063): arrow budget, crit basics, extended Space.
 * Port of server/thachsanh_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. The E volley shares one raw budget per victim;
 * Space arrows still stop on inner walls (user rule).
 */
import { TankActions, parseBkey } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { prepareDisplacement } from './melee.js';

const SLOTS = { 0: 338100, 1: 338201, 2: 338301, 10: 338101 };
const SPACE = [338302, 338303, 338304, 338305, 338306];

export class ThachSanhActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.roll = null;
  }

  _cooldown(slot, changed = false) {
    const skill = slot === 0 && this.hasBuff(338302, this.clock()) ? 338311 : SLOTS[slot];
    const info = { skillId: skill, slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0 };
    return changed ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _basic_slot() {
    // S1579 has no owner ID: it changes only the local player's button.
    return (this.id === 1 ? [this._cooldown(0, true)] : []).concat([this._cooldown(0)]);
  }

  on_spawn(now) {
    const packets = [];
    for (const template of [338411, 338412, 338413]) packets.push(...this._buff(template, now));
    return packets.concat(this._basic_slot());
  }

  removeBuff(template, now, { expired = false } = {}) {
    const existed = this.activeBuffs.has(`${this.id},${template}`);
    const packets = super.removeBuff(template, now, { expired });
    if (template === 338302 && existed) packets.push(...this._basic_slot());
    return packets;
  }

  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  blocked(action, now) { return super.blocked(action, now) || this.roll !== null; }

  interrupt(now) {
    if (this.roll === null) return [];
    this.roll = null;
    this.position = this.positionAt(now);
    this.motion = null;
    this.forcedUntil = now;
    return [scene({ moves: [this._moveEvent(this.position, 0, 5)] })]
      .concat(this.removeBuff(338106, now));
  }

  _reward(now, generation) {
    if (!this.alive || this.generation !== generation) return [];
    const packets = this._buff(338421, now);
    if (this.hasBuff(338305, now)) {
      // User: +5 s to the existing remaining duration, not a second form.
      for (const template of SPACE) {
        const end = (this.activeBuffs.get(`${this.id},${template}`) ?? [0, 0])[1];
        if (end > now) packets.push(...this._buff(template, now, null, { duration: end - now + 5000 }));
      }
      packets.push(...this._buff(338405, now), ...this._buff(338406, now));
      this.cooldowns[10] = 0;
      packets.push(this._cooldown(10));
    }
    return packets;
  }

  _hit(flight, target, now) {
    const key = `${target.id},${target.generation}`;
    let raw = flight.raw;
    if (flight.template === 338201) {
      const used = flight.context.get(key) ?? D(0);
      const limit = flight.power.mul(D('2.25')).sub(used);
      raw = raw.min(limit.lt(0) ? D(0) : limit);
      flight.context.set(key, used.add(raw)); // consume raw budget before defenses
    }
    const packets = [];
    if (!raw.isZero()) {
      const was_alive = target.alive;
      const steal = flight.source_generation === this.generation ? flight.lifesteal : 0;
      packets.push(...this.damage(raw, now, {
        target, basic: flight.basic, lifesteal: steal,
        critical_handled: flight.basic, crystal_vamp: !flight.basic,
        critical_display: flight.critical_display,
      })[0]);
      if (was_alive && !target.alive) packets.push(...this._reward(now, flight.source_generation));
    }
    if (flight.template === 338201) packets.push(...this._buff(338202, now, target.id));
    return packets;
  }

  _flight(flight, now) {
    const start = pointAt(flight.start, flight.end,
      (flight.previous - flight.begin) / (flight.finish - flight.begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
    const contacts = [];
    for (const target of this.arena.actors.values()) {
      if (target.alive && target.camp !== this.camp
        && !flight.hits.has(`${target.id},${target.generation}`)) {
        const hit = actorContact(start, end, target, flight.previous, now);
        if (hit !== null) contacts.push([hit, target.id]);
      }
    }
    const wall = this.arena.geometry.wallContact(start, end); // even Space arrows stop
    const packets = [];
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [contact, ident] of contacts) {
      if (wall !== null && contact >= wall) break;
      const target = this.arena.actors.get(ident);
      flight.hits.add(`${ident},${target.generation}`);
      if (this.projectileBlocked(target, now)) {
        return packets.concat([scene({ expiredBullets: [flight.id] })]);
      }
      packets.push(...this._hit(flight, target, now));
      if (flight.template !== 338311) {
        return packets.concat([scene({ blownBullets: [flight.id] })]);
      }
    }
    if (now >= flight.finish || wall !== null) {
      return packets.concat([scene(wall !== null
        ? { blownBullets: [flight.id] } : { expiredBullets: [flight.id] })]);
    }
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return packets;
  }

  _event(now, kind, data) {
    if (kind === 'thach_roll_end') {
      const [roll] = data;
      if (this.roll !== roll) return [];
      const [, stopped] = prepareDisplacement(this, now, { interrupt: false });
      return stopped.concat(this.interrupt(now));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || !this.alive || this.roll !== null || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now || (slot !== 10 && this.blocked('attack', now))) return [];
    if (slot !== 2 && (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1]))) return [];
    this.cooldowns[slot] = now + this.skillCooldown(
      slot === 0 ? this.fireInterval(now) : slot === 2 ? 30000 : 8000, slot);
    const packets = [this._cooldown(slot)];
    const power = this.combatStat('iAttack', now);
    if (slot === 0) {
      const critical = this.arena.rng() < Math.min(1, this.attrBonus([27], now).toNumber());
      const ratio = critical ? D(2).add(this.attrBonus([31], now)).max(D(1)) : D(1);
      const template = this.hasBuff(338302, now) ? 338311 : 338100;
      return packets.concat(this.shoot(template, start, dest, now,
        power.mul(D('1.5')).mul(ratio), {
          school: 'physical', basic: true, power, speed_multiplier: 1.5,
          lifesteal: this.attrBonus([28], now), critical_display: critical,
        }));
    }
    if (slot === 1) {
      // Client draws a 30-degree sector; five arrows share one raw budget.
      const budget = new Map();
      const angle = Math.atan2(dest[1] - start[1], dest[0] - start[0]);
      for (const offset of [-15, -7.5, 0, 7.5, 15]) {
        const rad = angle + offset * Math.PI / 180;
        const aim = [pyRound(start[0] + 600 * Math.cos(rad)),
          pyRound(start[1] + 600 * Math.sin(rad))];
        packets.push(...this.shoot(338201, start, aim, now, power.mul(D('1.5')),
          { school: 'physical', power, context: budget }));
      }
      return packets;
    }
    if (slot === 2) {
      packets.push(...this.restoreHp(this.maxHp.mul(D('.25')), now));
      for (const template of SPACE) packets.push(...this._buff(template, now));
      return packets.concat(this._basic_slot());
    }
    let [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
    body = stopped.length ? body : start;
    // V1 permits rolling under hard CC; clear crowd control only.
    for (const key of [...this.activeBuffs.keys()]) {
      const [owner, template] = parseBkey(key);
      if (owner !== this.id) continue;
      const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
      const effect = Number(row.nEffectType);
      if (row.get('iAspect') === '-1'
        && ([30, 35, 36, 66].includes(effect)
          || (effect === 201 && row.get('nTypeParam') === '11' && D(row.get('fEffectValA', '0')).lt(0)))) {
        packets.push(...this.removeBuff(template, now));
      }
    }
    this.cooldowns[1] = 0;
    packets.push(this._cooldown(1));
    for (const template of [338103, 338104, 338105, 338106]) packets.push(...this._buff(template, now));
    const span = Math.hypot(start[0] - dest[0], start[1] - dest[1]);
    dest = pointAt(start, dest, 264 / span);
    const duration = this._setMotion(body, dest, 720, now, 4);
    this.forcedUntil = this.motion[3];
    this.roll = { generation: this.generation };
    this._queue(now + duration, 'thach_roll_end', this.roll);
    return packets.concat(stopped, [scene({
      moves: [this._moveEvent(this.motion[1], 720, 4)],
      skills: [this._skillEvent(338101, start, this.motion[1])],
    })]);
  }
}

export { SLOTS as THACHSANH_SLOTS, SPACE as THACHSANH_SPACE };
