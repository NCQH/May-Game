/* Dracula (tank 10000057): damage, healing, stat loans and HP-ratio changes
 * kept separate. Port of server/dracula_actions.py.
 *
 * Stubs: presentation/skin only. Stat loans use the core's statLoans map; its
 * key selects the gating buff, so the shared token key uses the attack grant
 * (both grants succeed or fail together).
 */
import { TankActions } from '../arena.js';
import { D, quantize } from '../math.js';
import { scene, encodeS1572, encodeS1579 } from '../protocol.js';
import { enemies, packII, prepareDisplacement } from './melee.js';
import { teamVisible } from './batch-c-common.js';

const SLOTS = { 0: 332100, 1: 332201, 2: 332301, 10: 332401 };

export class DraculaActions extends TankActions {
  constructor(arena, ident, info, camp, spawn) {
    super(arena, ident, info, camp, spawn);
    this.ready = this.bat = this.link = this.regen = null;
    this.dots = new Map();
  }

  _cooldown(slot, changed = false) {
    const skill = slot === 1 && this.bat ? 332221 : SLOTS[slot];
    const end = slot === 1 && this.bat
      ? this.bat.begin + 500 : this.cooldowns[slot];
    const info = { skillId: skill, slot, count: -1, end, nextCharge: 0 };
    return changed && this.id === 1
      ? [1579, encodeS1579(info)] : [1572, encodeS1572(this.id, info)];
  }

  on_spawn(now) {
    this.ready = this.bat = this.link = this.regen = null;
    const packets = [this._cooldown(1, true)];
    for (const template of [332101, 332102, 332103]) packets.push(...this._buff(template, now));
    return packets;
  }

  _speed(now) { return this.ready ? 0 : super._speed(now); }

  blocked(action, now) { return Boolean(this.ready) || super.blocked(action, now); }

  _dot(target, now) {
    if (this.arena.pk && this.arena.pk.finished) return [];
    const packets = this._buff(332111, now, target.id).concat(this._buff(332112, now));
    if (this.regen && this.regen.generation === this.generation && this.regen.end > now) {
      this.regen.end = now + 3000;
    } else {
      this.regen = { end: now + 3000, generation: this.generation };
      this._queue(now + 1000, 'dracula_regen', this.regen);
    }
    if (!target.alive || !target.hasBuff(332111, now)) return packets;
    const key = `${target.id},${target.generation},${this.generation}`;
    let mark = this.dots.get(key);
    if (mark && mark.end > now
      && mark.version === (target.buffVersions.get(332111) ?? 0) - 1) {
      mark.end = now + 3000;
      mark.version = target.buffVersions.get(332111);
    } else {
      mark = {
        target: target.id, target_generation: target.generation, generation: this.generation,
        end: now + 3000, version: target.buffVersions.get(332111),
      };
      this.dots.set(key, mark);
      this._queue(now + 1000, 'dracula_dot', mark);
    }
    return packets;
  }

  _hit(target, raw, now, generation, { basic = false } = {}) {
    const current = this.alive && this.generation === generation;
    const vampire = current && !basic
      ? D('.25').add(D(1).sub(this.hp.div(this.maxHp))) : D(0);
    const [packets, lost] = this.damage(raw, now, {
      target, school: 'physical', basic, lifesteal: vampire,
    });
    if (current && lost) packets.push(...this._dot(target, now));
    return packets;
  }

  _end_bat(now, burst = true) {
    const cast = this.bat;
    if (!cast) return [];
    this.bat = null;
    const packets = [];
    for (let template = 332202; template < 332211; template += 1) {
      packets.push(...this.removeBuff(template, now));
    }
    if (this.alive && cast.generation === this.generation) {
      packets.push(...this._buff(332221, now));
      if (burst) {
        for (const target of enemies(this, { area: true })) {
          const pos = this.positionAt(now), tpos = target.positionAt(now);
          if (Math.hypot(pos[0] - tpos[0], pos[1] - tpos[1]) <= 120) {
            packets.push(...this._hit(target, cast.power.mul(D('.95')), now, cast.generation));
          }
        }
      }
    }
    return packets.concat([this._cooldown(1, true)], this.syncSpeed(now));
  }

  _loan(link, target, now) {
    const key = `dracula:${this.id}:${link.token}`;
    const values = link.values ?? new Map([
      ['iAttack', target.combatStat('iAttack', now).max(D(0)).mul(D('.1'))],
      ['iArmor', target.combatStat('iArmor', now).max(D(0)).mul(D('.1'))],
    ]);
    const grants = [[332413, this], [332415, this], [332414, target], [332416, target]];
    const before = grants.map(([template, actor]) => actor.buffVersions.get(template));
    const packets = [];
    for (const [template, actor] of grants) packets.push(...this._buff(template, now, actor.id));
    const versions = {};
    for (const [template, actor] of grants) versions[template] = actor.buffVersions.get(template);
    // Borrowing is bilateral: a counter or stasis may reject either side.
    if (grants.some(([template, actor], index) => versions[template] === before[index]
      || !actor.hasBuff(template, now) || actor.buffSources.get(template) !== this.id)) {
      return packets.concat(this._end_link(now, true));
    }
    link.values = values;
    link.versions = versions;
    const end = now + 1500;
    const negatives = new Map();
    for (const [name, value] of values) negatives.set(name, value.neg());
    this.statLoans.set(key, {
      values, end, armor_buff: 332415, attack_buff: 332413,
    });
    target.statLoans.set(key, {
      values: negatives, end, armor_buff: 332416, attack_buff: 332414,
    });
    return packets;
  }

  _end_link(now, immediate = false) {
    const link = this.link;
    if (!link) return [];
    this.link = null;
    this.cooldowns[10] = now + this.skillCooldown(6000, 10);
    const packets = (this.buffSources.get(332401) === this.id
      ? this.removeBuff(332401, now) : [])
      .concat(this.removeBuff(332402, now), [this._cooldown(10)]);
    const target = this.arena.actors.get(link.target);
    if (target && target.buffSources.get(332401) === this.id) {
      packets.push(...target.removeBuff(332401, now));
    }
    const key = `dracula:${this.id}:${link.token}`;
    for (const [actor, templates] of [[this, [332413, 332415]], [target, [332414, 332416]]]) {
      if (!actor) continue;
      if (immediate) {
        actor.statLoans.delete(key);
        for (const template of templates) {
          if (actor.buffSources.get(template) === this.id) {
            packets.push(...actor.removeBuff(template, now));
          }
        }
      } else if (actor.statLoans.has(key)) {
        actor.statLoans.get(key).end = now + 1500;
        for (const template of templates) {
          if (actor.buffSources.get(template) === this.id) {
            packets.push(...this._buff(template, now, actor.id, { duration: 1500 }));
          }
        }
      }
    }
    return packets;
  }

  clear_loans(target, now) {
    const keys = [...target.statLoans.keys()].filter(key => {
      const [scope, owner] = key.split(':');
      return scope === 'dracula' && Number(owner) === this.id;
    });
    const packets = [];
    for (const actor of this.arena.actors.values()) {
      for (const key of keys) {
        const loan = actor.statLoans.get(key);
        if (!loan) continue;
        actor.statLoans.delete(key);
        for (const template of [loan.armor_buff, loan.attack_buff]) {
          packets.push(...actor.removeBuff(template, now));
        }
      }
    }
    return packets;
  }

  _unlock(cast, now) {
    const packets = [];
    for (const ident of [this.id, cast.target]) {
      const actor = this.arena.actors.get(ident);
      if (actor && actor.dracula_ritual === cast) {
        actor.dracula_ritual = null;
        for (const template of [332311, 332312, 332313]) {
          packets.push(...actor.removeBuff(template, now));
        }
        packets.push(...actor.syncSpeed(now));
      }
    }
    return packets;
  }

  interrupt(now) {
    const packets = [];
    if (this.ready) {
      const cast = this.ready;
      this.ready = null;
      this.cooldowns[2] = now + this.skillCooldown(6000, 2);
      packets.push(...this._unlock(cast, now), [1583, packII(this.id, 332301)], this._cooldown(2));
    }
    if (!this.alive) packets.push(...this._end_link(now, true), ...this._end_bat(now, false));
    return packets.concat(this.syncSpeed(now));
  }

  on_control(source, template, now) {
    const row = this.arena.data.tableRow('BuffTemplate_table.xml', { nBuffId: template });
    const mask = Number(row.get('fEffectValB', 0));
    return this.ready && ['35', '66'].includes(row.get('nEffectType'))
      && (!mask || (mask & 4)) ? this.interrupt(now) : [];
  }

  on_target_death(target, now) {
    const packets = this.clear_loans(target, now);
    if (this.link && this.link.target === target.id) packets.push(...this._end_link(now, true));
    if (this.ready && this.ready.target === target.id) packets.push(...this.interrupt(now));
    return packets;
  }

  update(now) { return super.update(now); }

  _flight(flight, now) {
    // The base homing executor owns collision; this supplies the HP spell-vamp.
    if (flight.template === 332211) {
      flight.lifesteal = this.alive && this.generation === flight.source_generation
        ? D('.25').add(D(1).sub(this.hp.div(this.maxHp))) : D(0);
    }
    return super._flight(flight, now);
  }

  on_bullet_hit(flight, target, now) {
    return this.alive && this.generation === flight.source_generation && this.last_hp_loss
      ? this._dot(target, now) : [];
  }

  damage(raw, now, options = {}) {
    const [packets, lost] = super.damage(raw, now, options);
    this.last_hp_loss = lost;
    return [packets, lost];
  }

  _event(now, kind, data) {
    if (kind === 'dracula_dot') {
      const [mark] = data;
      const target = this.arena.actors.get(mark.target);
      if (!target || !target.alive || target.generation !== mark.target_generation
        || target.buffVersions.get(332111) !== mark.version || now > mark.end) return [];
      const packets = this.damage(target.maxHp.mul(D('.01')), now, {
        target, school: 'true', periodic: true, crystal_vamp: false,
      })[0];
      if (now + 1000 <= mark.end) this._queue(now + 1000, kind, mark);
      return packets;
    }
    if (kind === 'dracula_regen') {
      const [cast] = data;
      if (this.regen !== cast || !this.alive || this.generation !== cast.generation
        || now > cast.end) return [];
      const packets = this.restoreHp(this.maxHp.mul(D('.01')), now);
      if (now + 1000 <= cast.end) this._queue(now + 1000, kind, cast);
      return packets;
    }
    if (kind === 'dracula_bat') {
      const [cast, index] = data;
      if (this.bat !== cast || !this.alive || this.generation !== cast.generation) return [];
      const start = this.positionAt(now);
      const targets = enemies(this).filter(t => {
        const tpos = t.positionAt(now);
        return Math.hypot(start[0] - tpos[0], start[1] - tpos[1]) <= 360
          && teamVisible(this, t, now);
      });
      const packets = [];
      if (targets.length) {
        targets.sort((a, b) => {
          const da = Math.hypot(start[0] - a.positionAt(now)[0], start[1] - a.positionAt(now)[1]);
          const db = Math.hypot(start[0] - b.positionAt(now)[0], start[1] - b.positionAt(now)[1]);
          return da - db || a.id - b.id;
        });
        const target = targets[0];
        packets.push(...this.shoot(332211, start, target.positionAt(now), now,
          cast.power.mul(D('.66')), {
            school: 'physical', target, through_walls: true,
          }));
      }
      if (index === 6) packets.push(...this._end_bat(now));
      else this._queue(now + 500, kind, cast, index + 1);
      return packets;
    }
    if (kind === 'dracula_link') {
      const [link] = data;
      if (this.link !== link) return [];
      const target = this.arena.actors.get(link.target);
      if (!this.alive || this.generation !== link.generation || this.inStasis()
        || !target || !target.alive || target.generation !== link.target_generation) {
        return this._end_link(now, true);
      }
      if (link.versions) {
        for (const [actor, templates] of [[this, [332413, 332415]], [target, [332414, 332416]]]) {
          for (const template of templates) {
            if (actor.buffVersions.get(template) !== link.versions[template]) {
              return this._end_link(now, true);
            }
          }
        }
      }
      const pos = this.positionAt(now), tpos = target.positionAt(now);
      if (target.isUntargetable()
        || Math.hypot(pos[0] - tpos[0], pos[1] - tpos[1]) > 360) return this._end_link(now);
      const packets = [];
      if (now >= link.next_tick_at) {
        const raw = this.combatStat('iAttack', now);
        packets.push(...this._loan(link, target, now));
        if (this.link !== link) return packets;
        packets.push(...this._hit(target, raw, now, link.generation));
        link.next_tick_at += 1000;
      }
      if (this.link !== link) return packets;
      if (now >= link.end) return packets.concat(this._end_link(now));
      this._queue(Math.min(now + 50, link.end), kind, link);
      return packets;
    }
    if (kind === 'dracula_swap') {
      const [cast] = data;
      if (this.ready !== cast) return [];
      const target = this.arena.actors.get(cast.target);
      if (!this.alive || !target || !target.alive
        || target.generation !== cast.target_generation || target.isUntargetable()) {
        return this.interrupt(now);
      }
      const ch = this.hp, th = target.hp, cm = this.maxHp, tm = target.maxHp;
      const vampire = D('.25').add(D(1).sub(ch.div(cm)));
      this.ready = null;
      const packets = this._unlock(cast, now);
      packets.push(scene({
        skills: [this._skillEvent(332301, this.positionAt(now), target.positionAt(now), target.id)],
      }));
      const candidate = D(1).min(tm).max(tm.min(quantize(ch.div(cm).mul(tm))));
      const after = D(1).min(cm).max(cm.min(quantize(th.div(tm).mul(cm))));
      if (target.camp === this.camp) {
        packets.push(...target.commitHp(candidate, now), ...this.commitHp(after, now));
      } else {
        const floor = th.min(D(Number(target.info.death_floor ?? 0))
          .max(target.hasBuff(359301, now) ? D(1) : D(0)));
        const loss = D(0).max(th.sub(candidate)).min(D(0).max(th.sub(floor)));
        packets.push(...target.commitHp(th.sub(loss), now), ...this.commitHp(ch.max(after), now));
        const [hit, lost] = this.damage(cast.power.mul(D('3.58')), now, {
          target, school: 'physical', lifesteal: vampire, hp_swap_loss: loss,
        });
        packets.push(...hit);
        if (lost) packets.push(...this._dot(target, now));
      }
      return packets.concat(this.syncSpeed(now));
    }
    return super._event(now, kind, data);
  }

  cast(slot, start, dest, target_id, now) {
    if (slot === 1 && this.bat) {
      return now >= this.bat.begin + 500 && !this.blocked('attack', now)
        && !this.skillSealed(1, now) ? this._end_bat(now) : [];
    }
    if (!(slot in SLOTS) || this.blocked('attack', now)
      || this.skillSealed(slot, now) || this.cooldowns[slot] > now) return [];
    const target = this.arena.actors.get(target_id);
    if ((slot === 2 || slot === 10) && (!target || target === this || !target.alive
      || target.isUntargetable() || target.info.npc_template
      || Math.hypot(start[0] - target.positionAt(now)[0],
        start[1] - target.positionAt(now)[1]) > { 2: 264, 10: 360 }[slot]
      || (slot === 10 && target.camp === this.camp))) return [];
    if ((slot === 2 || slot === 10) && target.camp !== this.camp
      && !teamVisible(this, target, now)) return [];
    if (slot === 2 && this.link) return [];
    if (slot === 0 && start[0] === dest[0] && start[1] === dest[1]) return [];
    const power = this.combatStat('iAttack', now);
    this.cooldowns[slot] = now + this.skillCooldown(
      { 0: this.fireInterval(now), 1: 8000, 2: 30000, 10: 5000 }[slot], slot);
    if (slot === 0) {
      return this.shoot(332100, start, dest, now, power, {
        school: 'physical', basic: true,
      }).concat([this._cooldown(slot)]);
    }
    const cast = {
      slot, skill: SLOTS[slot], dest, power, generation: this.generation,
      begin: now, token: this._newId(2),
    };
    const packets = [scene({
      skills: [this._skillEvent(SLOTS[slot], start, dest, target_id, { ready: slot === 2 ? 1 : 0 })],
    })];
    if (slot === 1) {
      this.bat = cast;
      for (const enemy of enemies(this, { area: true })) {
        const pos = enemy.positionAt(now);
        if (Math.hypot(start[0] - pos[0], start[1] - pos[1]) <= 120) {
          packets.push(...this._hit(enemy, power.mul(D('.68')), now, this.generation));
        }
      }
      for (let template = 332202; template < 332211; template += 1) {
        packets.push(...this._buff(template, now));
      }
      this._queue(now + 500, 'dracula_bat', cast, 1);
    } else if (slot === 10) {
      cast.target = target.id;
      cast.target_generation = target.generation;
      cast.end = now + 5000;
      cast.next_tick_at = now + 1000;
      this.link = cast;
      packets.push(...this._buff(332401, now, target.id), ...this._buff(332402, now));
      this._queue(now + 50, 'dracula_link', cast);
    } else {
      cast.target = target.id;
      cast.target_generation = target.generation;
      cast.dest = target.positionAt(now);
      this.ready = cast;
      for (const [actor, template] of [[this, 332311], [target, 332313]]) {
        if (actor.camp !== this.camp && actor.ccImmune(now)) continue;
        const [origin, stopped] = prepareDisplacement(actor, now, { interrupt: false });
        packets.push(...stopped);
        actor.position = origin;
        actor.motion = null;
        packets.push(...this._buff(template, now, actor.id));
        actor.dracula_ritual = cast;
        packets.push(...actor.syncSpeed(now));
      }
      this._queue(now + 1500, 'dracula_swap', cast);
    }
    return packets.concat([this._cooldown(slot, slot === 1)], this.syncSpeed(now));
  }
}

export { SLOTS as DRACULA_SLOTS };
