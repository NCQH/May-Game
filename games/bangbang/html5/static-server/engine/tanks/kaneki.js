/* Kaneki (tank 10000076): explicit HP costs, healing stacks, one cap per hit.
 * Port of server/kaneki_actions.py onto the JS battle core.
 *
 * Stubs: no presentation/skin. `hit_caps` keys are the damage-context arrays
 * stringified, because JS carries arrays where Python used tuple keys.
 */
import { TankActions } from '../arena.js';
import { D, quantize } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { enemies, inCone, piercingStep } from './melee.js';
import { keyOf } from './batch-e-common.js';

const SLOTS = { 0: 350100, 1: 350201, 2: 350301, 10: 350401 };

export class KanekiActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.r_count = 2;
    this.r_next_charge = 0;
    this.passive_ready_at = 0;
    this.hit_caps = new Map();
  }

  _cooldown(slot, changed = false) {
    const info = {
      skillId: SLOTS[slot], slot, count: slot === 10 ? this.r_count : -1,
      end: this.cooldowns[slot] ?? 0, nextCharge: slot === 10 ? this.r_next_charge : 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.hit_caps.clear();
    this.passive_ready_at = 0;
    return this._buff(350101, now);
  }

  limitHit(key, amount, now) {
    if (!this.hasBuff(350302, now)) return amount;
    const name = keyOf(key);
    const remaining = this.hit_caps.get(name) ?? quantize(this.maxHp.mul(D('.05')));
    const allowed = amount.min(remaining);
    this.hit_caps.set(name, remaining.sub(allowed));
    return allowed;
  }

  _proc(now, generation) {
    if (!this.alive || generation !== this.generation || now < this.passive_ready_at) return [];
    this.passive_ready_at = now + 100;
    return this._buff(350111, now).concat(this._buff(350112, now));
  }

  update(now) {
    const packets = [];
    while (this.r_next_charge && this.r_next_charge <= now) {
      this.r_count = Math.min(2, this.r_count + 1);
      this.r_next_charge = this.r_count < 2
        ? this.r_next_charge + this.skillCooldown(10000) : 0;
      packets.push(this._cooldown(10));
    }
    const live = new Set();
    for (const entry of this.arena.pending) {
      const [kind, data] = entry.args || [];
      if (kind === 'flight' && data?.[0]?.attack_key) live.add(keyOf(data[0].attack_key));
    }
    for (const key of [...this.hit_caps.keys()]) if (!live.has(key)) this.hit_caps.delete(key);
    return packets.concat(super.update(now));
  }

  _e_hit(flight, target, now) {
    const current = this.alive && this.generation === flight.source_generation;
    const raw = flight.power.mul(D('1.47')).add(this.maxHp.sub(this.hp).mul(D('.1')));
    const [packets, lost] = this.damage(raw, now, { target });
    if (lost) packets.push(...this._proc(now, flight.source_generation));
    if (current) {
      packets.push(...this.restoreHp(this.maxHp.mul(D('.1')), now));
      this.cooldowns[1] = now + this.skillCooldown(1500, 1);
      packets.push(this._cooldown(1));
    }
    return packets.concat(this._buff(350215, now, target.id));
  }

  _flight(flight, now) {
    if (flight.template === 350211) {
      if (!this.alive || this.generation !== flight.source_generation) {
        return [scene({ expiredBullets: [flight.id] })];
      }
      return piercingStep(this, flight, now, (f, t, n) => this._e_hit(f, t, n), { pierce: false });
    }
    return super._flight(flight, now);
  }

  _event(now, kind, data) {
    if (kind === 'kaneki_regen') {
      const [generation, version, index] = data;
      if (!this.alive || this.generation !== generation
        || this.buffVersions.get(350301) !== version) return [];
      const packets = this.restoreHp(this.maxHp.sub(this.hp).mul(D('.05')), now);
      if (index < 10) this._queue(now + 500, 'kaneki_regen', generation, version, index + 1);
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, targetId, now) {
    if (!(slot in SLOTS) || !this.alive || this.skillSealed(slot, now)
      || this.cooldowns[slot] > now) return [];
    // Space's native iUseInStun permits activation during stun.
    if ((slot !== 2 && this.blocked('attack', now)) || (slot === 10 && !this.r_count)) return [];
    if ([0, 1, 10].includes(slot) && start[0] === dest[0] && start[1] === dest[1]) return [];
    const power = this.combatStat('iAttack', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 6000, 2: 20000, 10: 5000 }[slot], slot);
    if (slot === 0) {
      return this.shoot(350100, start, dest, now, power,
        { school: 'physical', basic: true }).concat([this._cooldown(0)]);
    }
    const packets = [scene({ skills: [this._skillEvent(SLOTS[slot], start, dest)] })];
    if (slot === 1 || slot === 10) {
      const ratio = slot === 1 ? D('.85') : D('.8');
      packets.push(...this.commitHp(this.hp.min(D(1).max(this.hp.mul(ratio))), now));
    }
    if (slot === 1) {
      packets.push(...this.shoot(350211, start, dest, now, D(0),
        { school: 'physical', through_walls: true, power }));
    } else if (slot === 10) {
      this.r_count -= 1;
      if (!this.r_next_charge) this.r_next_charge = now + this.skillCooldown(10000);
      const raw = power.mul(D('1.64')).add(this.maxHp.sub(this.hp).mul(D('.1')));
      for (const target of enemies(this, { area: true })) {
        if (!inCone(target.positionAt(now), start, dest, 408, 60)) continue;
        const [hit, lost] = this.damage(raw, now, { target });
        packets.push(...hit);
        if (lost) packets.push(...this._proc(now, this.generation));
        packets.push(...this.restoreHp(this.maxHp.mul(D('.1')), now));
        packets.push(...this._buff(350405, now, target.id));
      }
    } else {
      this.hit_caps.clear();
      for (const template of [350301, 350302, 350303]) packets.push(...this._buff(template, now));
      this._queue(now + 500, 'kaneki_regen', this.generation,
        this.buffVersions.get(350301), 1);
    }
    return packets.concat([this._cooldown(slot)]);
  }
}

export { SLOTS as KANEKI_SLOTS };
