/* Gilgamesh (tank 10000088): ten field ticks and forty individually colliding
 * weapons. Port of server/gilgamesh_actions.py.
 *
 * Stubs: no skin/presentation. arena.rng is a plain function here, so the
 * original rng.uniform(-48, 48) becomes rng() * 96 - 48.
 */
import { TankActions } from '../arena.js';
import { D, pyRound } from '../math.js';
import { scene, encodeS1572 } from '../protocol.js';
import { enemies, piercingStep } from './melee.js';

const SLOTS = { 0: 362100, 1: 362201, 2: 362301, 10: 362401 };
const SPACE_BUFFS = [362302, 362303, 362304, 362305];

export class GilgameshActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.fields = new Map();
    this.marks = new Map();
    this.sweep = null;
  }

  _cooldown(slot) {
    if (!(slot in SLOTS)) {
      return [1572, encodeS1572(this.id, {
        skillId: this.skillForSlot(slot) ?? 0, slot, count: -1,
        end: this.cooldowns[slot] ?? 0, nextCharge: 0,
      })];
    }
    return [1572, encodeS1572(this.id, {
      skillId: SLOTS[slot], slot, count: -1, end: this.cooldowns[slot], nextCharge: 0,
    })];
  }

  on_spawn(now) {
    this.marks = new Map();
    return this._buff(362101, now).concat(this._buff(362102, now));
  }

  cc_immune(now, { slow = false } = {}) {
    return Boolean(this.sweep && now < this.sweep.begin) || super.ccImmune(now, { slow });
  }

  _endSweep(now) {
    this.sweep = null;
    const packets = [];
    for (const template of SPACE_BUFFS) {
      if (this.activeBuffs.has(`${this.id},${template}`)) {
        packets.push(...this.removeBuff(template, now));
      }
    }
    return packets;
  }

  interrupt(now) {
    return !this.alive || (this.sweep && now >= this.sweep.begin) ? this._endSweep(now) : [];
  }

  update(now) {
    const packets = super.update(now);
    if (this.sweep && now >= this.sweep.begin && this.skillSealed(2, now)) {
      packets.push(...this._endSweep(now));
    }
    return packets;
  }

  on_target_death(target, now) {
    this.marks.delete(target.id);
    return [];
  }

  _hit(target, raw, generation, now, { periodic = false } = {}) {
    const [packets, lost] = this.damage(raw, now, { target, school: 'energy', periodic });
    if (!lost || !target.alive || !this.alive || this.generation !== generation) return packets;
    const mark = this.marks.get(target.id);
    const valid = mark && mark.target_generation === target.generation
      && target.hasBuff(362103, now)
      && target.buffVersions.get(362103) === mark.version;
    const hits = valid ? mark.hits.filter(h => h.begin >= now - 2000) : [];
    hits.push({ begin: now });
    if (hits.length >= 7) {
      this.marks.delete(target.id);
      packets.push(...target.removeBuff(362103, now));
      packets.push(...this._buff(362107, now, target.id, { duration: 2000 }));
      const [ident, packet] = this.addObject(362403, target.positionAt(now).map(pyRound));
      this._queue(now + 500, 'object_expire', ident);
      return packets.concat([packet]);
    }
    packets.push(...this._buff(362103, now, target.id));
    if (target.hasBuff(362103, now)) {
      this.marks.set(target.id, {
        hits, target_generation: target.generation,
        version: target.buffVersions.get(362103),
      });
    }
    return packets;
  }

  _flight(flight, now) {
    if (flight.template !== 362501) return super._flight(flight, now);
    return piercingStep(this, flight, now,
      (f, t, n) => this._hit(t, f.raw, f.source_generation, n), { pierce: false });
  }

  _event(now, kind, data) {
    if (kind === 'gil_field') {
      const [field, index] = data;
      if (this.fields.get(field.id) !== field) return [];
      const packets = [];
      for (const target of enemies(this, { area: true })) {
        const pos = target.positionAt(now);
        if (Math.hypot(field.pos[0] - pos[0], field.pos[1] - pos[1]) <= 144) {
          packets.push(...this._hit(target, field.power.mul(D('.6')), field.generation, now,
            { periodic: true }));
          packets.push(...this._buff(362203, now, target.id, { stacks: 1 }));
        }
      }
      if (index === 10) {
        this.fields.delete(field.id);
        packets.push(...this.removeObject(field.id));
      } else {
        this._queue(now + 300, kind, field, index + 1);
      }
      return packets;
    }
    if (kind === 'gil_weapon') {
      const [cast, index] = data;
      if (this.sweep !== cast || !this.alive || this.generation !== cast.generation) return [];
      if (this.skillSealed(2, now)) return this._endSweep(now);
      const [x, y] = this.positionAt(now);
      const [dx, dy] = cast.direction;
      const offset = this.arena.rng() * 96 - 48;
      const start = [pyRound(x - dy * offset), pyRound(y + dx * offset)];
      const dest = [pyRound(start[0] + dx * 840), pyRound(start[1] + dy * 840)];
      const packets = this.shoot(362501, start, dest, now,
        this.combatStat('iEgAtk', now).mul(D('.72')),
        { school: 'energy', through_walls: true });
      if (index < 39) this._queue(now + 100, kind, cast, index + 1);
      else packets.push(...this._endSweep(now));
      return packets;
    }
    if (kind === 'gil_sweep_end') return this.sweep === data[0] ? this._endSweep(now) : [];
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    if ((slot === 0 || slot === 2) && start[0] === dest[0] && start[1] === dest[1]) return [];
    if (slot === 1 && (!this._inside(dest)
      || Math.hypot(start[0] - dest[0], start[1] - dest[1]) > 600)) return [];
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 8000, 2: 25000, 10: 8000 }[slot], slot);
    let packets;
    if (slot === 0) {
      packets = this.shoot(362100, start, dest, now, this.combatStat('iEgAtk', now),
        { school: 'energy', basic: true });
    } else if (slot === 1) {
      const [ident, packet] = this.addObject(362201, dest.map(pyRound));
      const field = {
        id: ident, pos: dest, power: this.combatStat('iEgAtk', now),
        generation: this.generation, end: now + 3000,
      };
      this.fields.set(ident, field);
      this._queue(now + 300, 'gil_field', field, 1);
      packets = [scene({ skills: [this._skillEvent(362201, start, dest)] }), packet];
    } else if (slot === 2) {
      const length = Math.hypot(dest[0] - start[0], dest[1] - start[1]);
      const cast = {
        begin: now + 300, end: now + 4300, generation: this.generation,
        direction: [(dest[0] - start[0]) / length, (dest[1] - start[1]) / length],
      };
      this.sweep = cast;
      this._queue(now + 400, 'gil_weapon', cast, 0);
      packets = [scene({ skills: [this._skillEvent(362301, start, dest, 0, { ready: 1 })] })];
      for (const template of SPACE_BUFFS) packets.push(...this._buff(template, now));
    } else {
      packets = [scene({ skills: [this._skillEvent(362401, start, start)] })];
      packets.push(...this._buff(362401, now), ...this._buff(362403, now));
      packets.push(...this.addShield(362402, this.maxHp.mul(D('.2')), now));
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as GILGAMESH_SLOTS, SPACE_BUFFS as GILGAMESH_SPACE_BUFFS };
