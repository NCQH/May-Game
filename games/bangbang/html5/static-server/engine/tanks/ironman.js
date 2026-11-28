/* Iron Man (tank 10000001): passive shield, rocket area, channelled beam.
 * Port of server/ironman_actions.py onto the JS battle core.
 *
 * Stubs: no skin/presentation. The beam keeps the original 2000-unit aiming
 * projection (coordinates, never movement) and the bot rotation limiter.
 */
import { TankActions, human } from '../arena.js';
import { D, pyRound } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { packII, packIhh, prepareDisplacement } from './melee.js';

const SLOTS = { 0: 363100, 1: 363201, 2: 363301, 10: 363401 };
// Original effect chain applies silence/root before control immunity.
const CHANNEL_BUFFS = [363301, 363303, 363304, 363302, 363308, 363309];

export class IronManActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    const data = arena.data;
    this.skills = Object.fromEntries(Object.values(SLOTS)
      .map(id => [id, data.tableRow('SkillTemplate_table.xml', { nId: id })]));
    this.ready = this.channel = null;
    this.shield_epoch = 0;
    this.cancel_available = false;
  }

  _cooldown(slot, changed = false) {
    const cancel = slot === 2 && this.cancel_available;
    const info = {
      skillId: cancel ? 363601 : SLOTS[slot], slot, count: -1,
      end: cancel ? 0 : (this.cooldowns[slot] ?? 0), nextCharge: 0,
    };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.shield_epoch += 1;
    return this.addShield(363102, this.maxHp.mul(D('.3')), now);
  }

  blocked(action, now) {
    return super.blocked(action, now) || this.ready !== null || this.channel !== null;
  }

  _speed(now) { return this.channel !== null ? 0 : super._speed(now); }

  on_shield_break(template, now) {
    if (template !== 363102) return [];
    this.shield_epoch += 1;
    const packets = this._buff(363104, now);
    if (this.alive) {
      packets.push(...this._buff(363103, now));
      this._queue(now + 15000, 'shield_return', this.generation, this.shield_epoch);
    }
    for (const target of [...this.arena.actors.values()]) {
      if (target.alive && target.camp !== this.camp && target.isAreaTargetable()
        && Math.hypot(this.positionAt(now)[0] - target.positionAt(now)[0],
          this.positionAt(now)[1] - target.positionAt(now)[1]) <= 300) {
        packets.push(...this.damage(this.combatStat('iAttack', now).mul(D('2.36')),
          now, { target })[0]);
      }
    }
    return packets;
  }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      const slot = this.ready.slot;
      this.ready = null;
      packets.push([1583, packII(this.id, SLOTS[slot])]);
    }
    if (this.channel) {
      this.channel = null;
      this.cancel_available = false;
      for (const template of [...CHANNEL_BUFFS, 363601]) {
        packets.push(...this.remove_buff(template, now));
      }
      packets.push(this._cooldown(2, true), this._cooldown(2));
    }
    return packets;
  }

  on_death() {
    this.ready = this.channel = null;
    this.cancel_available = false;
    this.shield_epoch += 1;
  }

  on_bullet_hit(flight, target, now) {
    if (flight.template !== 363401) return [];
    const packets = [];
    if (target.hasBuff(363206, now)) packets.push(...this._buff(363203, now, target.id));
    packets.push(...this._buff(363402, now, target.id), ...this._buff(363403, now, target.id));
    return packets;
  }

  handle(message, payload) {
    if (message === 514) {
      const now = this.clock();
      const packets = this.arena.tick(now);
      if (!this.arena.inputOpen(now, this)) return packets;
      if (payload.length === 8 && this.channel && this.alive) {
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        const sceneId = view.getUint32(0, true);
        const x = view.getInt16(4, true), y = view.getInt16(6, true);
        const position = this.positionAt(now);
        // Original timming caster projects 2000 units; these are aim coords.
        if (sceneId === this.sceneId && (x !== position[0] || y !== position[1])) {
          this.channel.dest = [x, y];
        }
      }
      return packets;
    }
    return super.handle(message, payload);
  }

  bot_beam_dest(now) {
    const cast = this.channel, start = this.positionAt(now);
    let angle = cast.beam_angle
      ?? Math.atan2(cast.dest[1] - start[1], cast.dest[0] - start[0]);
    const goal = cast.beam_goal ?? angle;
    const delta = ((goal - angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    // CTank.addTimmingSkillBuff -> UniformRotater: fEffectValB degrees/sec.
    const speed = Number(this.arena.data.tableRow('BuffTemplate_table.xml',
      { nBuffId: 363301 }).get('fEffectValB')) * Math.PI / 180;
    const step = speed * Math.max(0, now - (cast.beam_aim_at ?? cast.began)) / 1000;
    angle += Math.max(-step, Math.min(step, delta));
    Object.assign(cast, { beam_angle: angle, beam_goal: goal, beam_aim_at: now });
    return [pyRound(start[0] + 2000 * Math.cos(angle)),
      pyRound(start[1] + 2000 * Math.sin(angle))];
  }

  aim_bot_channel(dest, now) {
    if (!this.channel) return [];
    this.bot_beam_dest(now);
    const start = this.positionAt(now);
    this.channel.beam_goal = Math.atan2(dest[1] - start[1], dest[0] - start[0]);
    return [[1603, packIhh(this.id, pyRound(dest[0]), pyRound(dest[1]))]];
  }

  _area_object(template, position) {
    // Base addObject already writes the exact ObjInfo checkpoint shape.
    return this.addObject(template, position);
  }

  _event(now, kind, data) {
    if (kind === 'shield_return') {
      const [generation, epoch] = data;
      return this.alive && this.generation === generation && this.shield_epoch === epoch
        ? this.on_spawn(now) : [];
    }
    if (kind === 'prepared') {
      const [cast] = data;
      if (this.ready !== cast || !this.alive || cast.generation !== this.generation) return [];
      this.ready = null;
      const { slot, start, dest, power } = cast;
      const packets = [scene({ skills: [this._skillEvent(SLOTS[slot], start, dest)] })];
      if (slot === 1) {
        const [ident, packet] = this._area_object(363201, dest);
        packets.push(packet);
        this._queue(now + 50, 'area_start', ident, dest, power);
      } else if (slot === 10) {
        packets.push(...this.shoot(363401, start, dest, now, power.mul(D('2.67')),
          { school: 'physical' }));
      } else {
        this.channel = cast;
        cast.began = now;
        if (!human(this)) {
          this.bot_beam_dest(now);
          packets.push([1603, packIhh(this.id, pyRound(dest[0]), pyRound(dest[1]))]);
        }
        this.shield_epoch += 1; // Space refreshes the single passive shield.
        packets.push(...this.remove_buff(363103, now));
        packets.push(...this.addShield(363102, this.maxHp.mul(D('.3')), now));
        for (const buff of CHANNEL_BUFFS) packets.push(...this._buff(buff, now));
        for (let offset = 200; offset <= 4000; offset += 200) {
          this._queue(now + offset, 'beam_tick', cast);
        }
        this._queue(now + 1000, 'enable_cancel', cast);
        this._queue(now + 4000, 'channel_end', cast);
      }
      return packets;
    }
    if (kind === 'area_start') {
      const [old, dest, power] = data;
      this.arena.objects.delete(old);
      const [ident, packet] = this._area_object(363204, dest);
      for (let offset = 500; offset <= 3000; offset += 500) {
        this._queue(now + offset, 'area_tick', dest, power);
      }
      this._queue(now + 3000, 'area_end', ident);
      return [scene({ removedObjects: [old] }), packet];
    }
    if (kind === 'area_end') {
      this.arena.objects.delete(data[0]);
      return [scene({ removedObjects: [data[0]] })];
    }
    if (kind === 'area_tick') {
      const [dest, power] = data;
      const packets = [];
      for (const target of [...this.arena.actors.values()]) {
        if (!target.alive || target.camp === this.camp || !target.isAreaTargetable()
          || Math.hypot(dest[0] - target.positionAt(now)[0],
            dest[1] - target.positionAt(now)[1]) > 144) continue;
        packets.push(...this.damage(power.mul(D('.75')), now, { target })[0]);
        if (target.hasBuff(363402, now)) packets.push(...this._buff(363203, now, target.id));
        packets.push(...this._buff(363206, now, target.id));
      }
      return packets;
    }
    if (kind === 'beam_tick' || kind === 'enable_cancel' || kind === 'channel_end') {
      const [cast] = data;
      if (this.channel !== cast || !this.alive) return [];
      if (kind === 'channel_end') return this.interrupt(now);
      if (kind === 'enable_cancel') {
        this.cancel_available = true;
        return [this._cooldown(2, true), this._cooldown(2)];
      }
      const start = this.positionAt(now);
      const dest = human(this) ? cast.dest : this.bot_beam_dest(now);
      const dx = dest[0] - start[0], dy = dest[1] - start[1];
      const length = Math.hypot(dx, dy);
      if (!length) return [];
      const packets = [scene({ skills: [this._skillEvent(363501, start, dest)] })];
      for (const target of [...this.arena.actors.values()]) {
        if (!target.alive || target.camp === this.camp || !target.isAreaTargetable()) continue;
        const [tx, ty] = target.positionAt(now);
        const ax = tx - start[0], ay = ty - start[1];
        const along = (ax * dx + ay * dy) / length, side = (-ax * dy + ay * dx) / length;
        if (Math.hypot(Math.max(0, -along, along - 600), Math.max(0, Math.abs(side) - 24))
          <= 36) {
          packets.push(...this.damage(cast.power.mul(D('1.25')), now,
            { target, lifesteal: D('.25') })[0]);
        }
      }
      return packets;
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target, now) {
    if (slot === 2 && this.channel && this.cancel_available && this.alive) return this.interrupt(now);
    if (!(slot in SLOTS) || this.blocked('attack', now) || this.cooldowns[slot] > now) return [];
    if (!this._inside(dest) || (start[0] === dest[0] && start[1] === dest[1] && slot !== 1)) return [];
    const row = this.skills[SLOTS[slot]];
    if (slot === 1 && Math.hypot(start[0] - dest[0], start[1] - dest[1]) > Number(row.get('iRange'))) {
      return [];
    }
    this.cooldowns[slot] = now + this.skillCooldown(
      slot === 0 ? this.fireInterval(now) : Number(row.get('iCoolTime')), slot);
    const power = this.combatStat('iAttack', now);
    if (slot === 0) {
      return this.shoot(363100, start, dest, now, power,
        { school: 'physical', basic: true }).concat([this._cooldown(0)]);
    }
    let body, stopped;
    [body, stopped] = prepareDisplacement(this, now, { interrupt: false });
    this.position = stopped.length ? body : start;
    this.motion = null;
    this.ready = { slot, start, dest, power, generation: this.generation };
    this._queue(now + Number(row.get('iReadyTime')), 'prepared', this.ready);
    return [scene({
      moves: [this._moveEvent(start, 0, 5)],
      skills: [this._skillEvent(SLOTS[slot], start, dest, 0, { ready: 1 })],
    }), this._cooldown(slot)].concat(stopped);
  }
}

export { SLOTS as IRONMAN_SLOTS, CHANNEL_BUFFS };
