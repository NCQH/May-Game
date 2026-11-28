/* Daredevil (tank 10000115): post-shield damage and adjusted healing in one
 * fixed ledger. Port of server/daredevil_actions.py.
 *
 * Stubs: presentation/skin only. The ledger uses the core's deferHeal/deferHit
 * hooks; `_erase` scans the JS arena pending heap.
 */
import { TankActions } from '../arena.js';
import { D, actorContact, pointAt, pyRound, quantize } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import {
  aimed, enemies, inStrip, piercingStep, packII, prepareDisplacement,
} from './melee.js';

const SLOTS = { 0: 391100, 1: 391201, 2: 391301, 10: 391401 };
const CHARGES = { 1: ['e', 2, 8000, 4000], 2: ['space', 3, 8000, 5000], 10: ['r', 2, 6000, 3000] };

export class DaredevilActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = this.dash = this.ledger = null;
    this.passive_ready_at = 0;
    for (const [name, count] of Object.values(CHARGES).map(c => [c[0], c[1]])) {
      this[`${name}_count`] = count;
      this[`${name}_next_charge`] = 0;
    }
  }

  _cooldown(slot, changed = false) {
    let skill = SLOTS[slot], count = -1, charge = 0;
    if (slot === 0) {
      if (this.hasBuff(391111, this.clock())) skill = 391111;
      else if (this.hasBuff(391307, this.clock())) skill = 391311;
    } else {
      const name = CHARGES[slot][0];
      count = this[`${name}_count`];
      charge = this[`${name}_next_charge`];
    }
    const info = { skillId: skill, slot, count, end: this.cooldowns[slot] ?? 0, nextCharge: charge };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.ready = this.dash = this.ledger = null;
    this.passive_ready_at = 0;
    const packets = [this._cooldown(0, true)];
    for (let template = 391101; template < 391106; template += 1) {
      packets.push(...this._buff(template, now));
    }
    return packets.concat(this.syncSpeed(now));
  }

  missing_bonus() { return D(1).sub(this.hp.div(this.maxHp)).max(D(0)); }

  attr_bonus(attributes, now) {
    return super.attr_bonus(attributes, now)
      .add(attributes.includes(10) ? this.missing_bonus() : D(0));
  }

  _speed(now) {
    if (this.ready || this.dash || this.blocked('move', now)) return 0;
    const bonus = pyRound(D(this.stats.iSpeed).mul(this.missing_bonus()).toNumber());
    return Math.max(0, super._speed(now) + bonus);
  }

  blocked(action, now) { return Boolean(this.ready || this.dash) || super.blocked(action, now); }

  restore_hp(amount, now) {
    return super.restore_hp(D(amount).mul(this.ledger ? D('1.25') : D(1)), now);
  }

  _new_ledger(now) {
    const self = this;
    return {
      end: now + 1000, damage: D(0), healing: D(0), source: null, generation: this.generation,
      deferHeal(amount) { this.healing = this.healing.add(amount); return []; },
      deferHit(hit, hitNow, source, school, sourceGeneration, opts = {}) {
        const amount = hit.potential_damage.sub(hit.shield_absorbed).max(D(0));
        if (!amount.isZero()) {
          this.damage = this.damage.add(quantize(amount.mul(opts.transferred ? D(1) : D('.75'))));
          const hold = self.caocao_hostage;
          this.source = hold && hold.end > hitNow
            ? [hold.owner, hold.generation]
            : (opts.credit_override
              || [source.id, sourceGeneration === null ? source.generation : sourceGeneration]);
        }
        return { ...hit, hp_loss: D(0), hp_after: self.hp, overkill: D(0), killed: false };
      },
    };
  }

  _cast_cost(now) {
    // HP costs are outside the ledger even when another cast is pending.
    const packets = this.commitHp(quantize(this.hp.mul(D('.85'))), now)
      .concat(this._buff(391111, now));
    if (!this.ledger) {
      this.ledger = this._new_ledger(now);
      this._queue(now + 1000, 'dare_settle', this.ledger);
      packets.push(...this._buff(391113, now));
    }
    return packets.concat([this._cooldown(0, true)], this.syncSpeed(now));
  }

  _settle(cast, now) {
    if (this.ledger !== cast) return [];
    this.ledger = null;
    if (!this.alive || cast.generation !== this.generation) return [];
    const packets = this.removeBuff(391113, now);
    if (this.inStasis()) return packets;
    const net = cast.healing.sub(cast.damage);
    const floor = this.hp.min(D(this.info.death_floor ?? 0)
      .max(this.hasBuff(359301, now) ? D(1) : D(0)));
    const hp = this.maxHp.min(floor.max(this.hp.add(net)));
    this.damageCredit = hp.lt(this.hp) ? cast.source : null;
    try { packets.push(...this.commitHp(hp, now)); }
    finally { this.damageCredit = null; }
    return packets.concat(this.syncSpeed(now));
  }

  dodge_projectile(now) {
    const flight = this.arena.currentFlight;
    if (!this.alive || !flight || this.inStasis() || now < this.passive_ready_at) return false;
    if (this.arena.rng() >= 0.25) return false;
    this.passive_ready_at = now + 250;
    this._queue(now, 'dare_dodge', this.generation);
    return true;
  }

  _refund(now) {
    const packets = [];
    for (const slot of [1, 2, 10]) {
      const [name, , duration] = CHARGES[slot];
      const field = `${name}_next_charge`;
      const end = this[field];
      if (end) {
        this[field] = Math.max(now, end - pyRound(duration * 0.05));
        packets.push(this._cooldown(slot));
      }
    }
    return packets;
  }

  update(now) {
    const packets = [];
    for (const slot of [1, 2, 10]) {
      const [name, maximum, duration] = CHARGES[slot];
      let count = this[`${name}_count`];
      let end = this[`${name}_next_charge`];
      while (end && end <= now) {
        count = Math.min(maximum, count + 1);
        end = count < maximum ? end + this.skillCooldown(duration) : 0;
      }
      if (count !== this[`${name}_count`]) {
        this[`${name}_count`] = count;
        this[`${name}_next_charge`] = end;
        packets.push(this._cooldown(slot));
      }
    }
    return packets.concat(super.update(now));
  }

  _spend(slot, now) {
    const [name, , duration, gap] = CHARGES[slot];
    this[`${name}_count`] -= 1;
    if (!this[`${name}_next_charge`]) {
      this[`${name}_next_charge`] = now + this.skillCooldown(duration);
    }
    this.cooldowns[slot] = now + gap;
    return this._cast_cost(now).concat([this._cooldown(slot)]);
  }

  interrupt(now, { stun = false } = {}) {
    const packets = [];
    // Slot iUseInStun preserves the Space preparation through stun.
    if (this.ready && (!stun || !this.alive || this.inStasis() || this.skillSealed(2, now))) {
      this.ready = null;
      packets.push([1583, packII(this.id, 391301)]);
    }
    if (this.dash) {
      packets.push(...this._remove_hook_line());
      // Keep the original pull segment until the interrupted landing is safe.
      this.position = this.stopPosition(now);
      this.motion = null;
      this.forcedUntil = 0;
      this.dash = null;
      packets.push(scene({ moves: [this._moveEvent(this.position, 0, 5)] }));
    }
    if (!this.alive) this.ledger = null;
    return packets.concat(this.syncSpeed(now));
  }

  on_control(source, template, now) {
    const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
    const mask = Number(row.get('fEffectValB', 0));
    if (this.dash && ['30', '35', '66'].includes(row.get('nEffectType'))
      && (!mask || (mask & 2))) return this.interrupt(now);
    if (this.ready && ['35', '66'].includes(row.get('nEffectType'))
      && (!mask || (mask & 4))) return this.interrupt(now);
    return [];
  }

  removeBuff(template, now, { expired = false } = {}) {
    const packets = super.removeBuff(template, now, { expired });
    if ([391111, 391307].includes(template)) packets.push(this._cooldown(0, true));
    return packets;
  }

  remove_buff(template, now, options) { return this.removeBuff(template, now, options); }

  _erase(now, predicate) {
    const keep = [];
    const ids = new Set();
    for (const entry of this.arena.pending) {
      const actor = entry.callback?.__owner;
      const flight = entry.args?.[0] === 'flight' ? entry.args[1]?.[0] : null;
      if (flight && flight.kind === 'bullet' && actor && actor.camp !== this.camp) {
        const pos = flight.target
          ? (flight.pos ?? flight.start)
          : pointAt(flight.start, flight.end,
            Math.max(0, Math.min(1, (now - flight.begin) / Math.max(1, flight.finish - flight.begin))));
        if (predicate(pos)) { ids.add(flight.id); continue; }
      }
      keep.push(entry);
    }
    this.arena._requeue(keep);
    return ids.size ? [scene({ expiredBullets: [...ids].sort((a, b) => a - b) })] : [];
  }

  _hit(flight, target, now) {
    const current = this.alive && flight.source_generation === this.generation;
    const basic = flight.basic;
    const vamp = basic && current
      ? this.missing_bonus().add(this.hasBuff(391306, now) ? D('.25') : D(0)) : D(0);
    let raw = flight.raw;
    const cast = flight.context ?? {};
    if (basic && target.hasBuff(391413, now) && target.buffSources.get(391413) === this.id) {
      raw = raw.mul(D('1.25'));
    }
    const [packets, lost] = this.damage(raw, now, {
      target, basic, lifesteal: vamp, source_generation: flight.source_generation,
    });
    if (this.arena.pk && this.arena.pk.finished) return packets;
    if (basic) {
      if (cast.empowered) {
        packets.push(...this._buff(391122, now, target.id));
        if (lost && current && !cast.rewarded) {
          cast.rewarded = true;
          packets.push(...this.restoreHp(this.maxHp.sub(this.hp).mul(D('.1')), now));
        }
      }
    } else if (flight.template === 391211) {
      packets.push(...this._buff(391212, now, target.id));
      if (current && !this.blocked('attack', now) && !this.skillSealed(1, now)) {
        const start = this.positionAt(now), dest = target.positionAt(now);
        this._setMotion(start, dest, 720, now, 3);
        this.dash = { end: this.motion[3], generation: this.generation, bullet: flight.id };
        this._queue(this.motion[3], 'dare_arrive', this.dash);
        packets.push(...this._buff(391214, now),
          scene({ moves: [this._moveEvent(this.motion[1], 720, 3)] }), ...this.syncSpeed(now));
      }
    } else {
      for (const template of [391412, 391413, 391414]) {
        packets.push(...this._buff(template, now, target.id));
      }
    }
    return packets;
  }

  _flight(flight, now) {
    const before = flight.hits.size;
    const packets = piercingStep(this, flight, now, (f, t, n) => this._hit(f, t, n), {
      pierce: flight.template === 391411,
      contactRadius: flight.template === 391411 ? 96 : flight.template === 391211 ? 48 : 36,
    });
    // Python inspects the returned blown-bullet scene; the JS core has no scene
    // reader here, so a newly consumed hit is the equivalent signal.
    if (flight.template === 391211
      && !(this.dash && this.dash.bullet === flight.id) && flight.hits.size > before) {
      packets.push(scene({ expiredBullets: [flight.id] }));
    }
    return packets;
  }

  _remove_hook_line() {
    // Keep the rope during travel, then release the same client object ID.
    if (!this.dash) return [];
    const ident = this.dash.bullet;
    delete this.dash.bullet;
    return ident !== undefined ? [scene({ expiredBullets: [ident] })] : [];
  }

  _event(now, kind, data) {
    if (kind === 'dare_settle') return this._settle(data[0], now);
    if (kind === 'dare_dodge') {
      if (!this.alive || this.generation !== data[0]) return [];
      return this._buff(391131, now).concat(this._buff(391143, now), this._refund(now),
        this.restoreHp(this.maxHp.sub(this.hp).mul(D('.05')), now),
        [scene({ skills: [this._skillEvent(391141, this.positionAt(now), this.positionAt(now))] })]);
    }
    if (kind === 'dare_arrive') {
      if (this.dash !== data[0]) return [];
      const packets = this._remove_hook_line();
      this.position = this.positionAt(now);
      this.motion = null;
      this.forcedUntil = 0;
      this.dash = null;
      return packets.concat(this.syncSpeed(now));
    }
    if (kind === 'dare_space') {
      const [cast] = data;
      if (this.ready !== cast) return [];
      this.ready = null;
      if (!this.alive) return [];
      const pos = this.positionAt(now);
      const packets = [scene({ skills: [this._skillEvent(391301, pos, pos)] })];
      for (const target of enemies(this, { area: true })) {
        const tpos = target.positionAt(now);
        if (Math.hypot(pos[0] - tpos[0], pos[1] - tpos[1]) <= 192) {
          packets.push(...this.damage(cast.power.mul(D('2.06')), now, { target })[0],
            ...this._buff(391302, now, target.id));
        }
      }
      packets.push(...this._erase(now, p => Math.hypot(pos[0] - p[0], pos[1] - p[1]) <= 240));
      for (const template of [391303, 391305, 391306, 391307, 391308]) {
        packets.push(...this._buff(template, now));
      }
      return packets.concat([this._cooldown(0, true)], this.syncSpeed(now));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target, now) {
    if (this.skillSealed(slot, now) || this.cooldowns[slot] > now) return [];
    if (slot === 2) {
      if (!this.alive || this.inStasis() || this.ready || this.dash
        || this.caocao_hostage || this.dracula_ritual) return [];
    } else if (this.blocked('attack', now)) return [];
    if (slot && !this[`${CHARGES[slot][0]}_count`]) return [];
    if (slot !== 2 && ((start[0] === dest[0] && start[1] === dest[1]) || !this._inside(dest))) return [];
    const power = this.combatStat('iAttack', now);
    if (slot === 0) {
      const empowered = this.hasBuff(391111, now);
      const spread = this.hasBuff(391307, now);
      const template = empowered ? 391111 : spread ? 391311 : 391100;
      this.cooldowns[0] = now + this.fireInterval(now);
      const packets = [];
      const cast = { empowered, rewarded: false };
      const hits = new Set();
      const angle = Math.atan2(dest[1] - start[1], dest[0] - start[0]);
      for (const delta of (spread ? [0, 15, -15] : [0])) {
        const a = angle + delta * Math.PI / 180;
        const end = [pyRound(start[0] + 480 * Math.cos(a)), pyRound(start[1] + 480 * Math.sin(a))];
        packets.push(...this.shoot(template, start, end, now,
          power.mul(empowered ? D('1.5') : D(1)), {
            school: 'physical', basic: true, shared_hits: spread ? hits : null, context: cast,
          }));
      }
      if (empowered) packets.push(...this.removeBuff(391111, now));
      return packets.concat([this._cooldown(0)]);
    }
    const packets = this._spend(slot, now);
    if (slot === 1) {
      return packets.concat(this._buff(391201, now),
        [scene({ skills: [this._skillEvent(391201, start, dest)] })],
        this.shoot(391211, start, dest, now, power.mul(D('1.58')), {
          school: 'physical', through_walls: true,
        }));
    }
    if (slot === 10) {
      packets.push(...this._erase(now, p => inStrip(p, start, dest, 480, 120)));
      return packets.concat([scene({ skills: [this._skillEvent(391401, start, dest)] })],
        this.shoot(391411, start, dest, now, power.mul(D('1.87')), {
          school: 'physical', through_walls: true,
        }));
    }
    this.ready = { slot: 2, skill: 391301, dest: start, power, generation: this.generation };
    this._queue(now + 100, 'dare_space', this.ready);
    return packets.concat([scene({
      skills: [this._skillEvent(391301, start, start, 0, { ready: 1 })],
    })], this.syncSpeed(now));
  }
}

export { SLOTS as DAREDEVIL_SLOTS, CHARGES as DAREDEVIL_CHARGES };
