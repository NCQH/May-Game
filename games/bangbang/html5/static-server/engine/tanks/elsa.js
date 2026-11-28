/* Elsa (tank 10000106): marked hits, capped incoming attacks and five
 * cancellable waves. Port of server/elsa_actions.py.
 *
 * Stubs: presentation/skin only.
 */
import { TankActions } from '../arena.js';
import { D, quantize } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { aimed, enemies, inCone, packII, prepareDisplacement } from './melee.js';
import { keyOf } from './batch-f2-common.js';

const SLOTS = { 0: 381100, 1: 381201, 2: 381301, 10: 381401 };

export class ElsaActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = this.channel = null;
    this.r_count = 2;
    this.r_next_charge = 0;
    this.hit_caps = new Map();
  }

  _cooldown(slot, changed = false) {
    const skill = slot === 2 && this.channel ? 381501 : SLOTS[slot];
    const end = slot === 2 && this.channel ? this.channel.begin + 1000 : this.cooldowns[slot];
    const info = {
      skillId: skill, slot, count: slot === 10 ? this.r_count : -1, end,
      nextCharge: slot === 10 ? this.r_next_charge : 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.ready = this.channel = null;
    this.hit_caps = new Map();
    const packets = [this._cooldown(2, true)];
    for (let template = 381101; template < 381106; template += 1) {
      packets.push(...this._buff(template, now));
    }
    return packets;
  }

  limit_hit(key, amount, now) {
    const k = keyOf(key);
    const remaining = this.hit_caps.get(k) ?? quantize(this.maxHp.mul(D('.15')));
    const allowed = amount.min(remaining);
    this.hit_caps.set(k, remaining.sub(allowed));
    return allowed;
  }

  _mark(target, now) {
    const packets = [];
    for (let template = 381111; template < 381117; template += 1) {
      packets.push(...this._buff(template, now, target.id, { duration: 2000 }));
    }
    return packets;
  }

  on_skill_damage(source, hit, now) {
    if (!this.alive || hit.hp_loss.le(0)) return [];
    return this._mark(source, now).concat(this._buff(381121, now), this._buff(381122, now));
  }

  _hit(target, raw, now) {
    const marked = target.hasBuff(381114, now) && target.buffSources.get(381114) === this.id;
    const [packets, lost] = this.damage(raw.mul(marked ? D('1.5') : D(1)), now, {
      target, school: 'energy',
    });
    if (lost) {
      packets.push(...this._mark(target, now));
      if (marked && this.arena.rng() < 0.25) {
        packets.push(...this._buff(381131, now, target.id));
        if (target.hasBuff(381131, now)) {
          packets.push(...this._buff(381132, now, target.id, { duration: 500 }));
        }
      }
    }
    return packets;
  }

  _speed(now) { return this.ready || this.channel ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready || this.channel) || super.blocked(action, now); }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      packets.push([1583, packII(this.id, 381201)]);
      this.ready = null;
    }
    if (this.channel) {
      packets.push(...this.removeObject(this.channel.id));
      this.channel = null;
      packets.push([1583, packII(this.id, 381301)]);
      for (const template of [381303, 381305, 381306, 381307, 381308]) {
        packets.push(...this.removeBuff(template, now));
      }
      packets.push(this._cooldown(2, true));
    }
    return packets.concat(this.syncSpeed(now));
  }

  on_control(source, template, now) {
    const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
    const mask = Number(row.get('fEffectValB', 0));
    const blocked = (this.ready && (!mask || (mask & 2)))
      || (this.channel && (!mask || (mask & 4)));
    return ['35', '66'].includes(row.get('nEffectType')) && blocked ? this.interrupt(now) : [];
  }

  update(now) {
    const packets = [];
    while (this.r_next_charge && this.r_next_charge <= now) {
      this.r_count = Math.min(2, this.r_count + 1);
      this.r_next_charge = this.skillCooldown(8000) + this.r_next_charge;
      if (this.r_count >= 2) this.r_next_charge = 0;
      packets.push(this._cooldown(10));
    }
    if (this.ready && this.skillSealed(1, now)) packets.push(...this.interrupt(now));
    // The first-second self lock must not cancel the channel itself.
    if (this.channel) {
      for (const [key, [, end]] of this.activeBuffs) {
        const [owner, template] = key.split(',').map(Number);
        if (owner === this.id && end > now && ![381305, 381308].includes(template)
          && this._silences_space(template)) {
          packets.push(...this.interrupt(now));
          break;
        }
      }
    }
    const live = new Set();
    for (const entry of this.arena.pending) {
      if (entry.args?.[0] === 'flight' && entry.args[1]?.[0]?.attack_key) {
        live.add(keyOf(entry.args[1][0].attack_key));
      }
    }
    for (const key of [...this.hit_caps.keys()]) if (!live.has(key)) this.hit_caps.delete(key);
    return packets.concat(super.update(now));
  }

  _silences_space(template) {
    const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
    const bits = Number(row.get('fEffectValB', 0));
    return ['35', '66'].includes(row.get('nEffectType')) && (!bits || (bits & 4));
  }

  _event(now, kind, data) {
    if (kind === 'elsa_e') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || this.generation !== cast.generation) return [];
      this.ready = null;
      const start = this.positionAt(now);
      const packets = this.syncSpeed(now).concat([
        scene({ skills: [this._skillEvent(381201, start, cast.dest)] }),
      ]);
      for (const target of enemies(this, { area: true })) {
        if (!inCone(target.positionAt(now), start, cast.dest, 360, 60)) continue;
        packets.push(...this._hit(target, cast.power.mul(D('1.88')), now));
        if (this.arena.pk && this.arena.pk.finished) return packets;
        if (target.alive) {
          const pos = target.positionAt(now);
          const dest = aimed(start, pos,
            Math.hypot(start[0] - pos[0], start[1] - pos[1]) + 216, { fixed: true });
          if (!target.ccImmune(now)) {
            target._setMotion(pos, dest, 480, now, 1);
            target.forcedUntil = target.motion[3];
            packets.push(scene({ moves: [target._moveEvent(target.motion[1], 480, 1)] }));
          }
          packets.push(...this._buff(381203, now, target.id), ...this._buff(381204, now, target.id));
        }
      }
      return packets;
    }
    if (kind === 'elsa_ring') {
      const [cast] = data;
      const packets = this.removeObject(cast.id);
      const [ident, packet] = this.addObject(381403, cast.pos);
      packets.push(packet);
      this._queue(now + 1000, 'object_expire', ident);
      for (const target of enemies(this, { area: true })) {
        const tpos = target.positionAt(now);
        const dist = Math.hypot(cast.pos[0] - tpos[0], cast.pos[1] - tpos[1]);
        if (dist > 168) continue;
        if (dist > 72) packets.push(...this._buff(381412, now, target.id));
        packets.push(...this._hit(target, cast.power.mul(D('2.37')), now));
        if (dist > 72 && target.hasBuff(381412, now)) {
          packets.push(...this._buff(381415, now, target.id));
        }
      }
      return packets;
    }
    if (kind === 'elsa_wave') {
      const [cast, index] = data;
      if (this.channel !== cast || !this.alive || this.generation !== cast.generation) return [];
      const packets = [];
      if (index === 1) {
        packets.push(...this.removeObject(cast.id));
        const [ident, packet] = this.addObject(381302, cast.pos);
        cast.id = ident;
        packets.push(packet);
      }
      for (const target of enemies(this, { area: true })) {
        const tpos = target.positionAt(now);
        if (Math.hypot(cast.pos[0] - tpos[0], cast.pos[1] - tpos[1]) > 216) continue;
        const building = [20017, 20006].includes(target.info.npc_template);
        packets.push(...this._hit(target,
          cast.power.mul(D('1.77')).mul(building ? D('.25') : D(1)), now));
      }
      if (index === 5) packets.push(...this.interrupt(now));
      else this._queue(now + 750, kind, cast, index + 1);
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (slot === 2 && this.channel) {
      return now >= this.channel.begin + 1000 ? this.interrupt(now) : [];
    }
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.skillSealed(slot, now)
      || now < this.cooldowns[slot]) return [];
    if ((slot === 10 && !this.r_count)
      || ((slot === 0 || slot === 1) && start[0] === dest[0] && start[1] === dest[1])) return [];
    const power = this.combatStat('iEgAtk', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 6000, 2: 25000, 10: 4000 }[slot], slot);
    if (slot === 0) {
      return this.shoot(381100, start, dest, now, power, {
        school: 'energy', basic: true,
      }).concat([this._cooldown(0)]);
    }
    const cast = {
      slot, skill: SLOTS[slot], pos: aimed(start, dest, 600), dest, power,
      begin: now, generation: this.generation,
    };
    if (slot === 10) {
      this.r_count -= 1;
      if (!this.r_next_charge) this.r_next_charge = now + this.skillCooldown(8000);
      const [ident, packet] = this.addObject(381401, cast.pos);
      cast.id = ident;
      this._queue(now + 650, 'elsa_ring', cast);
      return [packet, this._cooldown(10)];
    }
    const [body, handoff] = prepareDisplacement(this, now, { interrupt: false });
    this.position = handoff.length ? body : start;
    this.motion = null;
    const packets = [scene({
      skills: [this._skillEvent(SLOTS[slot], start, dest, 0, { ready: 1 })],
    })];
    if (slot === 1) {
      this.ready = cast;
      this._queue(now + 200, 'elsa_e', cast);
    } else {
      this.channel = cast;
      const [ident, packet] = this.addObject(381301, cast.pos);
      cast.id = ident;
      packets.push(packet);
      for (const template of [381303, 381305, 381306, 381307, 381308]) {
        packets.push(...this._buff(template, now));
      }
      this._queue(now + 750, 'elsa_wave', cast, 1);
    }
    return packets.concat([this._cooldown(slot, slot === 2)], this.syncSpeed(now), handoff);
  }
}

export { SLOTS as ELSA_SLOTS };
