/* Son Tinh (tank 10000051): rage fan, separate stone form HP, curses.
 * Port of server/sontinh_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. The stone form is a heap swap on the same
 * actor with a saved HP value and info.death_floor, exactly as the Python kit.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound } from '../math.js';
import { scene, stop_move, encodeS1562, encodeS1572, encodeS1579 } from '../protocol.js';
import { packII, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 326100, 1: 326201, 2: 326301, 10: 326401 };
const RAGE = [326201, 326202, 326203, 326204, 326205];
const FORM = [326301, 326304, 326305, 326306, 326307, 326308, 326309, 326310,
  326316, 326321, 326322];

export class SonTinhActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = this.form = null;
    this.rage_until = 0;
    this.curses = new Map();
  }

  _cooldown(slot, changed = false) {
    const active = this.form && this.form.phase === 'active';
    const skill = slot === 0 && active ? 326331
      : slot === 2 && this.form ? 326371 : SLOTS[slot];
    const info = { skillId: skill, slot, count: -1, end: this.cooldowns[slot] ?? 0, nextCharge: 0 };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  _slots() {
    return [0, 2].flatMap(slot => [this._cooldown(slot, true), this._cooldown(slot)]);
  }

  on_spawn(now) { return this._buff(326101, now); }

  blocked(action, now) {
    return super.blocked(action, now) || this.ready !== null
      || Boolean(this.form && this.form.phase === 'gathering');
  }

  _speed(now) {
    return this.ready || (this.form && this.form.phase === 'gathering') ? 0 : super._speed(now);
  }

  interrupt(now) {
    const packets = !this.alive ? this._end_rage(now) : [];
    if (!this.ready) return packets;
    const ready = this.ready;
    this.ready = null;
    if (ready.slot === 2) this.cooldowns[2] = now + this.skillCooldown(30000, 2);
    return packets.concat([[1583, packII(this.id, ready.slot === 2 ? 326301 : 326331)],
      this._cooldown(ready.slot)]);
  }

  _end_form(now) {
    const form = this.form;
    this.form = null;
    if (form === null) return [];
    const [position] = prepareDisplacement(this, now, { interrupt: false });
    delete this.info.death_floor;
    this.info.untargetable = false;
    this.position = position;
    this.motion = null;
    this.forcedUntil = now;
    this.cooldowns[2] = now + this.skillCooldown(30000, 2);
    const packets = [stop_move(this.sceneId, this.id, this.position)];
    for (const template of FORM) packets.push(...this.removeBuff(template, now));
    // User: this returns the original HP, including after lethal form damage.
    packets.push(...super.commitHp(form.saved_hp, now));
    packets.push(...this._slots());
    for (const template of [326341, 326343, 326344]) packets.push(...this._buff(template, now));
    return packets.concat(this.syncSpeed(now));
  }

  commitHp(hp, now, { critical = false } = {}) {
    if (this.form && this.form.phase === 'active' && D(hp).le(0)) {
      return this._end_form(now); // No death/respawn/kill reward for destroying the form.
    }
    return super.commitHp(hp, now, { critical });
  }

  _end_rage(now) {
    if (!this.rage_until) return [];
    this.rage_until = 0;
    this.cooldowns[1] = now + this.skillCooldown(8000, 1);
    const packets = [];
    for (const template of RAGE) packets.push(...this.removeBuff(template, now));
    return packets.concat(this._buff(326211, now), [this._cooldown(1)]);
  }

  on_death() { this.ready = null; }

  on_target_death(target) {
    for (const [token, curse] of [...this.curses]) {
      if (curse.target === target.id) this.curses.delete(token);
    }
    return [];
  }

  _fire(start, dest, now, power) {
    const stone = Boolean(this.form && this.form.phase === 'active');
    const template = stone ? 326331 : 326100;
    const rage = this.rage_until > now;
    const shared = new Set();
    const packets = [];
    const angle = Math.atan2(dest[1] - start[1], dest[0] - start[0]);
    // User-approved temporary fan; one victim can be damaged once per volley.
    for (const offset of rage ? [0, -15, 15] : [0]) {
      const direction = angle + offset * Math.PI / 180;
      const aim = [pyRound(start[0] + 600 * Math.cos(direction)),
        pyRound(start[1] + 600 * Math.sin(direction))];
      packets.push(...this.shoot(template, start, aim, now,
        stone ? power : power.mul(D('1.5')), {
          school: 'physical', basic: true, power, speed_multiplier: 1.5,
          lifesteal: rage ? D('.5') : D('.25'), shared_hits: rage ? shared : null,
        }));
    }
    return packets;
  }

  _hit(flight, target, now) {
    const key = `${target.id},${target.generation}`;
    if (flight.hits.has(key) || !target.alive) return [];
    flight.hits.add(key);
    const steal = flight.source_generation === this.generation ? flight.lifesteal : 0;
    const packets = this.damage(flight.raw, now, {
      target, basic: true, ignore_armor: flight.template === 326331, lifesteal: steal,
    })[0];
    if (target.alive) {
      // Passive follows the primary hit; V1 keeps physical defenses except armor.
      const bonus = target.maxHp.sub(target.hp).mul(D('.03'));
      packets.push(...this.damage(bonus, now,
        { target, basic: true, ignore_armor: true, lifesteal: steal })[0]);
      packets.push(...this._buff(326112, now, target.id));
      if (flight.template === 326331) packets.push(...this._buff(326332, now, target.id));
    }
    return packets;
  }

  _flight(flight, now) {
    if (![326100, 326331].includes(flight.template)) return super._flight(flight, now);
    const start = pointAt(flight.start, flight.end,
      (flight.previous - flight.begin) / (flight.finish - flight.begin));
    const end = pointAt(flight.start, flight.end,
      Math.min(1, (now - flight.begin) / (flight.finish - flight.begin)));
    const contacts = [];
    for (const target of this.arena.actors.values()) {
      if (target.alive && target.camp !== this.camp) {
        const hit = actorContact(start, end, target, flight.previous, now);
        if (hit !== null) contacts.push([hit, target.id]);
      }
    }
    contacts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const wall = this.arena.geometry.wallContact(start, end); // both spear and stone stop
    if (contacts.length && (wall === null || contacts[0][0] < wall)) {
      const target = this.arena.actors.get(contacts[0][1]);
      if (this.projectileBlocked(target, now)) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      let targets = [target];
      if (flight.template === 326331) {
        targets = [...this.arena.actors.values()].filter(a => a.alive && a.camp !== this.camp
          && Math.hypot(a.positionAt(now)[0] - target.positionAt(now)[0],
            a.positionAt(now)[1] - target.positionAt(now)[1]) <= 120);
      }
      const packets = [];
      for (const victim of targets) packets.push(...this._hit(flight, victim, now));
      return packets.concat([scene({ blownBullets: [flight.id] })]);
    }
    if (wall !== null || now >= flight.finish) {
      return [scene(wall !== null ? { blownBullets: [flight.id] } : { expiredBullets: [flight.id] })];
    }
    flight.previous = now;
    this._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    return [];
  }

  _event(now, kind, data) {
    if (kind === 'son_rage_end') {
      const [generation] = data;
      return generation === this.generation && this.rage_until === now ? this._end_rage(now) : [];
    }
    if (kind === 'son_ready') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.generation !== cast.generation) return [];
      this.ready = null;
      if (cast.slot === 0) return this._fire(this.positionAt(now), cast.dest, now, cast.power);
      this.form = { phase: 'gathering', saved_hp: this.hp, generation: this.generation,
        end: now + 14600 };
      const packets = super.commitHp(this.maxHp, now);
      this.info.death_floor = 1; // original HP_KEEP while vanished
      this.info.untargetable = true;
      cast.dest = this.blinkDestination(this.positionAt(now), cast.dest);
      this.position = cast.dest;
      this.motion = null;
      packets.push(scene({ moves: [this._moveEvent(cast.dest, 0, 5)] }));
      for (const template of [326301, 326304, 326305, 326306, 326307, 326308, 326316]) {
        packets.push(...this._buff(template, now));
      }
      const [ident, packet] = this.addObject(326309, cast.dest);
      this._queue(now + 1000, 'son_land',
        { form: this.form, id: ident, pos: cast.dest, power: cast.power });
      return packets.concat([packet], this._slots(), this.syncSpeed(now));
    }
    if (kind === 'son_land') {
      const [cast] = data;
      const packets = this.removeObject(cast.id);
      if (this.form !== cast.form) return packets;
      for (const target of [...this.arena.actors.values()]) {
        if (target.alive && target.camp !== this.camp
          && Math.hypot(cast.pos[0] - target.positionAt(now)[0],
            cast.pos[1] - target.positionAt(now)[1]) <= 168) {
          packets.push(...this.damage(cast.power.mul(D('3.51')), now, { target })[0]);
          packets.push(...this._buff(326312, now, target.id));
        }
      }
      const [ident, packet] = this.addObject(326313, cast.pos);
      this._queue(now + 1600, 'son_form', cast.form, ident);
      return packets.concat([packet]);
    }
    if (kind === 'son_form') {
      const [form, ident] = data;
      const packets = this.removeObject(ident);
      if (this.form !== form) return packets;
      form.phase = 'active';
      delete this.info.death_floor;
      this.info.untargetable = false;
      for (const template of [326304, 326305]) packets.push(...this.removeBuff(template, now));
      for (const template of [326309, 326310, 326316, 326321, 326322]) {
        packets.push(...this._buff(template, now, null, { duration: 12000 }));
      }
      this._queue(now + 12000, 'son_form_end', form);
      return packets.concat(this._slots(), this.syncSpeed(now));
    }
    if (kind === 'son_form_end') {
      return this.form === data[0] ? this._end_form(now) : [];
    }
    if (kind === 'son_curse_area') {
      const [cast] = data;
      const packets = this.removeObject(cast.id, { destroyed: true });
      for (const target of this.arena.actors.values()) {
        if (!target.alive || target.camp === this.camp
          || Math.hypot(cast.pos[0] - target.positionAt(now)[0],
            cast.pos[1] - target.positionAt(now)[1]) > 168) continue;
        for (const template of [326402, 326403, 326404]) {
          packets.push(...this._buff(template, now, target.id));
        }
        if (!target.hasBuff(326403, now)) continue;
        const token = this.activeBuffs.get(`${target.id},326403`)[0];
        const curse = {
          target: target.id, target_generation: target.generation, power: cast.power,
          source_generation: cast.generation, token,
          version: target.buffVersions.get(326403),
        };
        this.curses.set(token, curse);
        this._queue(now + 2500, 'son_petrify', curse);
        this._queue(now + 3000, 'son_curse_end', curse);
      }
      return packets;
    }
    if (kind === 'son_petrify' || kind === 'son_curse_end') {
      const [curse] = data;
      const target = this.arena.actors.get(curse.target);
      if (this.curses.get(curse.token) !== curse || !target.alive
        || target.generation !== curse.target_generation
        || target.buffVersions.get(326403) !== curse.version) {
        this.curses.delete(curse.token);
        return [];
      }
      if (kind === 'son_petrify') return this._buff(326411, now, target.id);
      this.curses.delete(curse.token);
      return this.damage(curse.power.mul(D('2.23')), now, { target })[0]
        .concat(this._buff(326422, now, target.id));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if (slot === 1) {
      if (this.rage_until) return [];
      this.rage_until = now + 4000;
      this._queue(this.rage_until, 'son_rage_end', this.generation);
      const packets = [];
      for (const template of RAGE) packets.push(...this._buff(template, now));
      return packets;
    }
    if (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1])) return [];
    const power = this.combatStat('iAttack', now);
    if (slot === 0) {
      this.cooldowns[0] = now + this.fireInterval(now);
      if (!this.form) return this._fire(start, dest, now, power);
      this.ready = { slot: 0, skill: 326331, dest, power, generation: this.generation };
      this._queue(now + 100, 'son_ready', this.ready);
      const [ident, packet] = this.addObject(326351, dest);
      this._queue(now + 500, 'object_expire', ident);
      return [packet, scene({ skills: [this._skillEvent(326331, start, dest, 0, { ready: 1 })] })]
        .concat(this.syncSpeed(now));
    }
    if (slot === 2 && this.form) return [];
    const span = Math.hypot(start[0] - dest[0], start[1] - dest[1]);
    dest = pointAt(start, dest, Math.min(1, 480 / span)).map(pyRound);
    if (slot === 2) {
      dest = this.blinkDestination(start, dest);
      let [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
      this.ready = { slot: 2, dest, power, generation: this.generation };
      this.position = stopped.length ? body : start;
      this.motion = null;
      this._queue(now + 100, 'son_ready', this.ready);
      return [scene({ skills: [this._skillEvent(326301, start, dest, 0, { ready: 1 })] })]
        .concat(this.syncSpeed(now), stopped);
    }
    this.cooldowns[10] = now + this.skillCooldown(10000, 10);
    const [ident, packet] = this.addObject(326401, dest);
    this._queue(now + 1000, 'son_curse_area',
      { id: ident, pos: dest, power, generation: this.generation });
    return [packet, this._cooldown(10)];
  }
}

export { SLOTS as SONTINH_SLOTS, RAGE as SONTINH_RAGE };
