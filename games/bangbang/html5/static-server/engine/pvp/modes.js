/* PvP mode rules, ported from server/pk_rules.py, occupy_rules.py,
 * escort_mode.py, cow_objectives.py, base_mode.py, death_mode.py and
 * world_boss_mode.py.
 *
 * Data-driven: map catalogs (m89 pk, m810 objectives, m811 death, m81330 world
 * boss, m6 map 19) supply flags / bomber carts / static NPCs. The server-only
 * `barns`/`cows` setting and world-boss spawn/logic graph are not in the
 * browser catalogs; those controllers expose `missing` and stay inert unless
 * the caller passes `options.cows`, `options.barns` or `options.worldBoss`.
 *
 * Packet-only helpers here keep S1565/S1710/S1731..1736 out of the shared core
 * protocol module (no core edits).
 */
import { TankActions, scenePacket } from '../arena.js';
import { D, ZERO, distance, pointAt, pyRound } from '../math.js';
import { Writer } from '../../../protocol.js';
import { encodeS1556, encodeS1558, encodeS1554 } from '../protocol.js';

// --------------------------------------------------------------- wire helpers
const pack = (build) => { const w = new Writer(); build(w); return w.finish(); };

/** SendS1565 NotifyOccupyInfo: uint16 count + per-flag <4iI>. */
export function encodeS1565(flags, now) {
  return pack((w) => {
    w.u16(flags.length);
    for (const flag of flags) {
      const seconds = flag.capture_camp
        ? Math.min(Math.floor(flag.capture_ms / 1000),
          Math.max(0, Math.floor((now - flag.capture_started_at) / 1000)))
        : 0;
      const progress = flag.capture_camp === 1 ? -seconds : seconds;
      w.i32(flag.index).i32(flag.camp).i32(flag.locked)
        .i32(progress).u32(0);
    }
  });
}

/** S1732 NotifyAddScore: <3i>. */
export function encodeS1732(index, camp, gain) {
  return pack((w) => w.i32(index).i32(camp).i32(gain));
}

/** S1710 / S1731 camp score: <II>. */
export function encodeS1710(camp1, camp2) { return pack((w) => w.u32(camp1).u32(camp2)); }
export const encodeS1731 = encodeS1710;

/** S1733 round score: <II>. */
export function encodeS1733(camp1, camp2) { return pack((w) => w.u32(camp1).u32(camp2)); }

/** S1734 round start: <III>. */
export function encodeS1734(startTime, number, sceneId) {
  return pack((w) => w.u32(startTime).u32(number).u32(sceneId));
}

/** S1735 round win: <i>. */
export function encodeS1735(winner) { return pack((w) => w.i32(winner)); }

/** S1736 round alive counts: <II>. */
export function encodeS1736(camp1, camp2) { return pack((w) => w.u32(camp1).u32(camp2)); }

const NOTICE_ID = 3996;
/** S1501 battle text (quicksand_map.notice). */
export function encodeNotice(text) {
  const raw = new TextEncoder().encode(String(text));
  return pack((w) => w.u32(0).i32(NOTICE_ID).u16(1).u16(raw.length).add(raw));
}

// ------------------------------------------------------------------- maps
export const MODE_MAPS = Object.freeze({
  1: 'pk_maya', 4: 'pk_snow', 7: 'occupy_desert', 9: 'occupy_tomb',
  10: 'occupy_freight', 12: 'base_mineral', 14: 'base_ruins', 17: 'pk_fastfood',
  18: 'pk_totem', 19: 'pk_robo', 20: 'pk_cow', 21: 'pk_lightning',
  30: 'death_mine', 34: 'pk_polar', 35: 'pk_fortress', 36: 'pk_mine',
  37: 'occupy_military', 40: 'death_city', 50: 'base_town', 70: 'escort_bomb',
  101: 'test', 169: 'base_polar', 170: 'occupy_quicksand', 40002: 'world_boss',
});

export const OCCUPY_MAPS = Object.freeze(new Set([7, 9, 10, 37, 170]));
export const BASE_MAPS = Object.freeze(new Set([12, 14, 50, 169]));
export const ESCORT_MAPS = Object.freeze(new Set([70]));
export const COW_MAPS = Object.freeze(new Set([20, 36]));
export const DEATH_MAPS = Object.freeze(new Set([30, 40]));
export const KILL_MAPS = Object.freeze(new Set([1, 4, 17, 18, 19, 21, 34, 35, 36, 20, 101]));
/** pk_rules.death does not add a team kill point on these maps. */
export const NO_KILL_SCORE = Object.freeze(new Set([7, 9, 10, 12, 14, 30, 40, 37, 50, 70, 169, 170, 40002]));
/** pk_rules.initialize durations in seconds. */
export const DURATION_SECONDS = Object.freeze({
  30: 150, 40: 150, 12: 900, 14: 900, 50: 900, 70: 900, 169: 900,
  7: 600, 9: 600, 10: 600, 37: 600, 170: 600, 18: 210, 34: 210,
});
/** Maps whose pk intro gate is 3s (battle_runtime map list). */
const INTRO_MAPS = new Set([1, 4, 9, 10, 12, 14, 17, 21, 30, 40, 34, 35, 36,
  37, 50, 70, 169, 170]);

export function durationSeconds(mapId) {
  return DURATION_SECONDS[Number(mapId)] ?? (Number(mapId) === 40002 ? 1800 : 240);
}

export function introMs(mapId) {
  return INTRO_MAPS.has(Number(mapId)) ? 3000 : 0;
}

/** Classify a map, then merge caller overrides (test/room rules). */
export function modeForMap(mapId, override = null) {
  const id = Number(mapId);
  const kind = id === 40002 ? 'world_boss'
    : ESCORT_MAPS.has(id) ? 'escort'
      : OCCUPY_MAPS.has(id) ? 'occupy'
        : BASE_MAPS.has(id) ? 'base'
          : DEATH_MAPS.has(id) ? 'death'
            : COW_MAPS.has(id) ? 'cow' : 'kill';
  const base = {
    kind, mapId: id, name: MODE_MAPS[id] || `map-${id}`,
    durationMs: durationSeconds(id) * 1000,
    introMs: introMs(id),
    killScoring: !NO_KILL_SCORE.has(id),
    killScore: !NO_KILL_SCORE.has(id) ? 25 : 0,
    winScore: OCCUPY_MAPS.has(id) ? 1000 : 0,
    scoreIntervalMs: 3000,
    flagRadius: 60,
    rounds: DEATH_MAPS.has(id) ? 2 : 0,
    roundResultMs: 5000,
    settlement: id !== 40002,
  };
  if (override == null) return base;
  if (typeof override === 'string') return { ...base, kind: override };
  return { ...base, ...override, kind: override.kind || base.kind };
}

// ------------------------------------------------------------------ helpers
const alive = (a) => Boolean(a && a.alive);
const isTank = (a) => Boolean(a && !a.info.npc_template);
const ratioOf = (a) => (a.maxHp && !a.maxHp.isZero() ? a.hp.div(a.maxHp).toNumber() : 0);

function eligible(actor, now) {
  return alive(actor) && (actor.camp === 1 || actor.camp === 2)
    && !actor.info.npc_template && !actor.isUntargetable() && !actor.inStasis()
    && !actor.buffTypes(now).has(26);
}

function tankActors(engine) {
  return [...engine.arena.actors.values()].filter((a) => a.info && !a.info.npc_template);
}

function statsActors(engine) {
  return [...engine.pk.stats.keys()].map((id) => engine.arena.actors.get(id))
    .filter(Boolean);
}

function removeOwnedRespawn(arena, actor) {
  arena.pending = arena.pending.filter((entry) => !(
    entry.callback && entry.callback.__owner === actor
    && entry.args && entry.args[0] === 'respawn'));
}

// ------------------------------------------------------- destructible objects
const ORDINARY_TEMPLATES = new Set([
  ...Array.from({ length: 42 }, (_, i) => 2000 + i),
  ...Array.from({ length: 6 }, (_, i) => 3004 + i), 5030, 5031, 9003,
]);

/** server/map_objects.py MapObject, reduced to PvP-visible rules. */
export class MapObjectiveActor extends TankActions {
  constructor(arena, definition) {
    const ident = ((3 << 26) | Number(definition.instance)) >>> 0;
    let row = null;
    try {
      row = arena.data.tableRow('NpcTemplate_table.xml',
        { nTemplateId: definition.template });
    } catch { row = null; }
    const info = {
      map_object: true, npc_template: Number(definition.template),
      tank_id: 10000019, tank_level: 1, acct_id: 0,
      name: (row && row.get('szName')) || `Object ${definition.template}`,
      in_room: true,
    };
    super(arena, ident, info, Number(definition.camp ?? 0),
      [Number(definition.x), Number(definition.y)]);
    const hp = Math.max(1, Number(definition.hp ?? (row && row.get('iHp')) ?? 1));
    this.stats = {
      ...this.stats,
      iHp: String(hp),
      iArmor: String((row && row.get('iBdArmor')) || 0),
      iEgArmor: '0', iAttack: '0', iEgAtk: '0', iCentesis: '0', iEgCtsis: '0',
      iSpeed: '0', iMp: '0',
    };
    this.hp = this.maxHp = D(hp);
    this.info.hp = this.info.max_hp = this.hp.ceil();
    const w = Number(definition.width ?? (row && row.get('iWidth')) ?? 0);
    const h = Number(definition.height ?? (row && row.get('iHeight')) ?? 0);
    this.map_rect = Array.isArray(definition.rectangle) ? [...definition.rectangle]
      : [this.position[0] - w / 2, this.position[1] - h / 2,
        this.position[0] + w / 2, this.position[1] + h / 2];
    this.info.base = Boolean(definition.base);
    this.info.map_turret = Number(row && row.get('iType')) === 4 || Boolean(definition.unlocks);
    this.skill_damage_multiplier = Number(definition.skill_damage_multiplier ?? 1);
    this.repair_box = Number(row && row.get('iType')) === 6;
    this.explosion = definition.explosion || null;
    this.script_removes = definition.removes || [];
    this.ordinary_obstacle = Number(row && row.get('iType')) === 1
      && ORDINARY_TEMPLATES.has(Number(definition.template))
      && !this.explosion && !this.info.base;
    if (this.ordinary_obstacle) this.camp = 0;
    // Definition.unlocks carries instance ids in the catalog. `unlock_instances`
    // are the objects this one unlocks; `unlocked_by` are the objects that must
    // still be alive before this turret becomes damageable (map_objects.py).
    this.unlock_instances = (definition.unlocks || [])
      .map((n) => ((3 << 26) | Number(n)) >>> 0);
    const allDefs = arena.engine ? (arena.engine.rawMap.staticNPCs
      || arena.engine.rawMap.npcs || []) : [];
    this.unlocked_by = allDefs
      .filter((n) => (n.unlocks || []).includes(Number(definition.instance)))
      .map((n) => ((3 << 26) | Number(n.instance)) >>> 0);
    this.cooldowns = {};
  }

  snapshot() {
    return [1556, encodeS1556(this.arena.sceneId, {
      objectId: this.id, templateId: this.info.npc_template,
      x: this.positionAt(this.arena.engine.now)[0],
      y: this.positionAt(this.arena.engine.now)[1],
      hp: this.hp.ceil(), camp: this.camp, maxHp: this.maxHp.ceil(), ownerId: 0,
    })];
  }

  syncSpeed() { return []; }
  update() { return []; }
  cast() { return []; }
  turret_locked() {
    return this.unlock_instances.some((id) => {
      const actor = this.arena.actors.get(id);
      return actor && actor.alive;
    });
  }
  ccImmune() { return true; }
  damageImmune(school, now, periodic = false) {
    return this.turret_locked() || super.damageImmune(school, now, periodic);
  }
  restoreHp() { return []; }
  addShield() { return []; }
  moveDestination() { return [...this.spawn]; }
  blinkDestination() { return [...this.spawn]; }
  _setMotion() { return 1; }
  rejectBuff(row, source) {
    return !(this.repair_box && source === this
      && Number(row && row.nBuffId) === 40001);
  }

  commitHp(hp, now, opts = {}) {
    if (!this.alive || (this.arena.pk && this.arena.pk.finished)) return [];
    if (this.turret_locked() && hp.lt(this.hp)) return [];
    if (this.ordinary_obstacle && hp.lt(this.hp)) {
      hp = this.hp.sub(this.maxHp.div(4)).max(0);
    }
    const packets = super.commitHp(hp, now, opts);
    if (!this.alive) removeOwnedRespawn(this.arena, this);
    return packets;
  }

  deathHook() {
    const packets = [scenePacket({ removedObjects: [this.id] })];
    if (this.info.base && this.arena.engine) packets.push(...this.arena.engine._finish(true));
    return packets;
  }
}

// ------------------------------------------------------------- bomber carts
export const CART_SPEEDS = Object.freeze([0, 50, 60, 70, 75, 80]);

export class BombCart extends TankActions {
  constructor(arena, ident, definition) {
    const info = {
      ...definition, npc_template: 1601, bomb_cart: true,
      tank_id: 10000019, tank_level: 1, acct_id: 0, name: 'Xe Bom', in_room: true,
    };
    super(arena, ident, info, Number(definition.camp),
      [definition.position[0], definition.position[1]]);
    this.stats = { ...this.stats, iHp: '7500', iArmor: '113', iEgArmor: '113',
      iSpeed: '20', iAttack: '0', iEgAtk: '0', iMp: '0', iCentesis: '0', iEgCtsis: '0' };
    this.hp = this.maxHp = D(7500);
    this.info.hp = this.info.max_hp = 7500;
    this.cooldowns = {};
    this.cart_speed = 0;
    const points = (definition.route || []).map((p) => [Number(p[0]), Number(p[1])]);
    this.route = points.slice(0, 1);
    for (let i = 1; i < points.length - 1; i += 1) {
      const a = points[i - 1], p = points[i], b = points[i + 1];
      if ((p[0] - a[0]) * (b[1] - p[1]) !== (p[1] - a[1]) * (b[0] - p[0])) this.route.push(p);
    }
    if (points.length) this.route.push(points[points.length - 1]);
    this.route_index = 1;
    this.route_lengths = this.route.slice(1)
      .map((p, i) => distance(this.route[i], p));
  }

  snapshot() {
    return [1556, encodeS1556(this.arena.sceneId, {
      objectId: this.id, templateId: 1601,
      x: this.positionAt(this.arena.engine.now)[0],
      y: this.positionAt(this.arena.engine.now)[1],
      hp: this.hp.ceil(), camp: this.camp, maxHp: 7500, ownerId: 0,
    })];
  }

  onSpawn() { return [this.snapshot()]; }
  update() { return []; }
  syncSpeed() { return []; }
  cast() { return []; }
  restoreHp() { return []; }
  addShield() { return []; }
  ccImmune() { return true; }
  _setMotion() { return 0; }
  moveDestination() { return this.positionAt(this.clock()); }
  blinkDestination() { return this.positionAt(this.clock()); }
  rejectBuff(row, source) { return source !== this && source.camp === this.camp; }

  nearby(now) {
    const pos = this.positionAt(now);
    return [...this.arena.actors.values()].filter((a) => eligible(a, now)
      && distance(pos, a.positionAt(now)) <= 200);
  }

  escorted(now) {
    return this.nearby(now).some((a) => a.camp === this.camp);
  }

  stop(now) {
    this.cart_speed = 0;
    if (!this.motion) return [];
    this.position = this.positionAt(now);
    this.motion = null;
    return [[1554, encodeS1554(this.arena.sceneId, this.id, this.position)]];
  }

  advance(now) {
    if (!this.alive) return [];
    if (this.motion && now >= this.motion[3]) {
      this.position = [...this.motion[1]];
      this.motion = null;
      this.route_index += 1;
    }
    if (this.route_index >= this.route.length) return [];
    const nearby = this.nearby(now);
    const friends = nearby.filter((a) => a.camp === this.camp);
    const opponents = nearby.length - friends.length;
    const speed = friends.length > opponents
      ? CART_SPEEDS[Math.min(5, friends.length)] : 0;
    const packets = [];
    if (speed !== this.cart_speed) packets.push(...this.stop(now));
    if (!speed || this.motion) return packets;
    const start = this.positionAt(now);
    const dest = this.route[this.route_index];
    if (!dest) return packets;
    this.cart_speed = speed;
    this.motion_kind = 3;
    this.motion = [start, dest, now, now + Math.max(1,
      pyRound(distance(start, dest) * 1000 / speed))];
    return packets.concat([scenePacket({
      moves: [{ owner: this.id, position: dest, speed, kind: 3 }],
    })]);
  }

  commitHp(hp, now, opts = {}) {
    if (!this.alive || hp.ge(this.hp)) return [];
    const packets = super.commitHp(hp, now, opts);
    if (!this.alive) {
      removeOwnedRespawn(this.arena, this);
      this.cart_speed = 0;
      this.route_index = 1;
      this.position = [...this.spawn];
      this.motion = null;
      packets.push(scenePacket({ removedObjects: [this.id] }));
    }
    return packets;
  }

  _respawn(now, generation) {
    if (this.alive || generation !== this.generation) return [];
    this.generation += 1;
    this.hp = this.maxHp;
    this.info.hp = 7500;
    this.respawn_at = 0;
    this.position = [...this.spawn];
    this.motion = null;
    this.forcedUntil = 0;
    this.damageCredit = null;
    return this.onSpawn(now);
  }
}

export function cartProgress(cart, now) {
  if (!cart.alive) return 0;
  if (cart.route_index >= cart.route.length) return 1;
  if (!cart.route.length) return 0;
  let travelled = 0;
  for (let i = 0; i < cart.route_index - 1; i += 1) travelled += cart.route_lengths[i];
  travelled += distance(cart.route[cart.route_index - 1], cart.positionAt(now));
  const total = cart.route_lengths.reduce((a, b) => a + b, 0) || 1;
  return Math.min(1, travelled / total);
}

// -------------------------------------------------------- cows / mine carts
export class CowObject extends TankActions {
  constructor(arena, ident, definition) {
    const info = {
      ...definition, npc_template: Number(definition.template), cow_object: true,
      tank_id: 10000019, tank_level: 1, acct_id: 0,
      name: definition.name || 'Bò Sữa', in_room: true,
      untargetable: true, damage_immune: true,
    };
    super(arena, ident, info, Number(definition.camp),
      [definition.position[0], definition.position[1]]);
    this.stats = { ...this.stats, iHp: '1', iSpeed: '0', iMp: '0' };
    this.hp = this.maxHp = D(1);
    this.cooldowns = {};
    this.route_index = 1;
    this.cow_speed = 0;
    const points = (definition.route || []).map((p) => [Number(p[0]), Number(p[1])]);
    this.route = points.slice(0, 1);
    for (let i = 1; i < points.length - 1; i += 1) {
      const before = points[i - 1], p = points[i], after = points[i + 1];
      if (p[0] - before[0] !== after[0] - p[0]
        || p[1] - before[1] !== after[1] - p[1]) this.route.push(p);
    }
    if (points.length) this.route.push(points[points.length - 1]);
  }

  snapshot() {
    return [1556, encodeS1556(this.arena.sceneId, {
      objectId: this.id, templateId: this.info.npc_template,
      x: this.position[0], y: this.position[1],
      hp: -1, camp: this.camp, maxHp: -1, ownerId: 0,
    })];
  }
  onSpawn() { return [this.snapshot()]; }
  update() { return []; }
  syncSpeed() { return []; }
  commitHp() { return []; }
  restoreHp() { return []; }
  addShield() { return []; }
  ccImmune() { return true; }
  _setMotion() { return 0; }
  moveDestination() { return this.positionAt(this.clock()); }
  rejectBuff(row, source) {
    return !(source === this && Number(row && row.nBuffId) === 50315);
  }
  stop(now) {
    const packets = [];
    if (this.motion) {
      this.position = this.positionAt(now);
      this.motion = null;
      packets.push([1554, encodeS1554(this.arena.sceneId, this.id, this.position)]);
    }
    this.cow_speed = 0;
    return packets;
  }
  advance(now) {
    if (!this.route.length) return [];
    if (!this.alive) {
      if (now < (this.respawn_at || 0)) return [];
      this.hp = D(1);
      this.generation += 1;
      this.respawn_at = 0;
      this.position = [...this.spawn];
      this.route_index = 1;
      return [this.snapshot()];
    }
    const packets = [];
    if (this.motion && now >= this.motion[3]) {
      this.position = [...this.motion[1]];
      this.motion = null;
      this.route_index += 1;
      if (this.route_index === this.route.length) {
        this.hp = ZERO;
        this.cow_speed = 0;
        this.respawn_at = now + 3000;
        packets.push(scenePacket({ removedObjects: [this.id] }));
        const camp = Number(this.info.barn_camp || 3 - this.camp);
        packets.push(...this.arena.engine.addScore(camp, 1, now));
        if (this.arena.engine.pk.scores[camp] >= 25) {
          packets.push(...this.arena.engine._finish(true, now));
        }
        return packets;
      }
    }
    const pos = this.positionAt(now);
    const herders = [...this.arena.actors.values()].filter((a) => eligible(a, now)
      && a.camp !== this.camp && distance(pos, a.positionAt(now)) <= 240);
    const speed = herders.length ? 100 + 12 * (herders.length - 1) : 0;
    if (!speed) return packets.concat(this.stop(now));
    if (this.motion && speed === this.cow_speed) return packets;
    if (this.motion) packets.push(...this.stop(now));
    const start = this.positionAt(now);
    const dest = this.route[this.route_index];
    this.cow_speed = speed;
    this.motion = [start, dest, now, now + Math.max(1,
      pyRound(distance(start, dest) * 1000 / speed))];
    this.motion_kind = 3;
    packets.push(scenePacket({ moves: [{ owner: this.id, position: dest, speed, kind: 3 }] }));
    return packets;
  }
}

// -------------------------------------------------------------- controllers
class ModeController {
  constructor(engine, def) {
    this.engine = engine;
    this.def = def;
    this.kind = def.kind;
    this.missing = [];
  }
  install() { return []; }
  tick() { return []; }
  goal() { return null; }
  targets() { return null; }
  checkRound() { return []; }
  roundTransition() { return []; }
  winner() {
    const { scores } = this.engine.pk;
    return scores[1] > scores[2] ? 1 : scores[2] > scores[1] ? 2 : 0;
  }
  finishPackets() { return []; }
}

class KillMode extends ModeController {
  goal(actor, brain, seen, now) {
    if (this.engine.modeDef.killScore) return null;
    return null;
  }
}

class OccupyMode extends ModeController {
  install() {
    const rawFlags = this.engine.rawMap.flags || [];
    this.flags = rawFlags.map((flag) => ({
      index: Number(flag.index), position: [...flag.position],
      camp: Number(flag.camp || 0), locked: Number(flag.locked || 0),
      capture_ms: Number(flag.capture_ms || 2000), score: Number(flag.score || 0),
      capture_camp: 0, capture_started_at: 0, score_due_at: 0, wire: null,
    }));
    this.orders = new Map();
    if (!this.flags.length) { this.missing.push('flags'); return []; }
    return [[1565, encodeS1565(this.flags, this.engine.now)]];
  }

  tick(now) {
    const engine = this.engine;
    if (!this.flags.length || engine.pk.finished || now < (engine.introUntil || 0)) return [];
    const tanks = [...engine.arena.actors.values()].filter((a) => eligible(a, now));
    const packets = [];
    let changed = false;
    for (const flag of this.flags) {
      const counts = { 1: 0, 2: 0 };
      for (const a of tanks) {
        if (distance(a.positionAt(now), flag.position) <= this.def.flagRadius) counts[a.camp] += 1;
      }
      const leading = counts[1] > counts[2] ? 1 : counts[2] > counts[1] ? 2 : 0;
      if (flag.locked || !leading || leading === flag.camp) {
        flag.capture_camp = 0; flag.capture_started_at = 0;
      } else if (leading !== flag.capture_camp) {
        flag.capture_camp = leading; flag.capture_started_at = now;
      } else if (now - flag.capture_started_at >= flag.capture_ms) {
        flag.camp = leading; flag.capture_camp = 0; flag.capture_started_at = 0;
        flag.score_due_at = now + this.def.scoreIntervalMs;
      }
      const wire = `${flag.index},${flag.camp},${flag.locked},${flag.capture_camp},${flag.capture_started_at}`;
      if (wire !== flag.wire) { flag.wire = wire; changed = true; }
    }
    const owners = new Set(this.flags.map((f) => f.camp));
    const double = this.flags.length === 3 && owners.size === 1 && !owners.has(0);
    for (const flag of this.flags) {
      if (flag.camp && flag.score_due_at && now >= flag.score_due_at) {
        const camp = flag.camp;
        const gain = Math.min(flag.score * (double ? 2 : 1),
          this.def.winScore - engine.pk.scores[camp]);
        if (gain > 0) {
          engine.pk.scores[camp] += gain;
          packets.push([1732, encodeS1732(flag.index, camp, gain)]);
        }
        flag.score_due_at = now + this.def.scoreIntervalMs;
      }
    }
    if (changed) packets.unshift([1565, encodeS1565(this.flags, now)]);
    if (Math.max(engine.pk.scores[1], engine.pk.scores[2]) >= this.def.winScore) {
      packets.push(...engine._finish(true, now));
    }
    return packets;
  }

  /** occupy_rules.assignments, using only public flags + sampled reports. */
  assignments(actor, seen, now) {
    const engine = this.engine;
    const flags = this.flags;
    if (!flags.length) return null;
    const camp = actor.camp;
    const friends = [...engine.arena.actors.values()].filter((a) => !engine.isHuman(a)
      && a.camp === camp && eligible(a, now)
      && !engine.arena.botBrains.get(a.id)?.repair_goal);
    const signature = `${flags.map((f) => f.camp).join(',')}|${friends.map((a) => a.id).join(',')}`;
    const previous = this.orders.get(camp);
    if (previous && previous.signature === signature && now < previous.until) {
      return previous.assignments;
    }
    const reports = new Map();
    for (const a of friends) {
      for (const s of engine.arena.botBrains.get(a.id)?.observations || []) reports.set(s.id, s);
    }
    for (const s of seen) reports.set(s.id, s);
    const enemies = [...reports.values()].filter((s) => !s.objective
      && now - (s.observed_at || now) <= 700);
    const tasks = [];
    for (const flag of flags) {
      const near = enemies.filter((s) => distance(s.pos, flag.position) < 240).length;
      const present = [...engine.arena.actors.values()].filter((a) => engine.isHuman(a)
        && a.camp === camp && eligible(a, now)
        && distance(a.positionAt(now), flag.position) <= this.def.flagRadius).length;
      const count = (flag.camp !== camp || near)
        ? Math.max(0, Math.min(4, near + 1) - present) : 0;
      if (count) tasks.push({ flag, count, near });
    }
    const available = [...friends];
    const result = {};
    while (tasks.length && available.length) {
      tasks.sort((x, y) => {
        const nearest = (task) => Math.min(...available.map((a) => distance(a.positionAt(now), task.flag.position)));
        return (nearest(x) - x.flag.score * 12 + (x.near >= available.length ? 450 : 0))
          - (nearest(y) - y.flag.score * 12 + (y.near >= available.length ? 450 : 0));
      });
      const task = tasks.shift();
      const squad = [...available].sort((a, b) => distance(a.positionAt(now), task.flag.position)
        - distance(b.positionAt(now), task.flag.position) || a.id - b.id).slice(0, task.count);
      for (const a of squad) {
        result[a.id] = task.flag.index;
        available.splice(available.indexOf(a), 1);
      }
    }
    for (const a of available) {
      let best = null;
      for (const flag of flags) {
        const holders = [...Object.values(result)].filter((i) => i === flag.index).length;
        const cost = distance(a.positionAt(now), flag.position) + holders * 450
          + (flag.camp === camp ? 450 : 0) - flag.score * 12;
        if (!best || cost < best.cost) best = { flag, cost };
      }
      if (best) result[a.id] = best.flag.index;
    }
    this.orders.set(camp, { signature, until: now + 2400, assignments: result });
    return result;
  }

  goal(actor, brain, seen, now) {
    const flags = this.flags;
    if (!flags.length) return null;
    const orders = flags.length > 1 ? this.assignments(actor, seen, now) : null;
    const flag = (orders && flags.find((f) => f.index === orders[actor.id])) || flags[0];
    const center = flag.position;
    const pos = actor.positionAt(now);
    const enemies = seen.filter((s) => distance(s.pos, center) < 480);
    const onFlag = enemies.filter((s) => distance(s.pos, center) <= this.def.flagRadius).length;
    const friends = [...this.engine.arena.actors.values()].filter((a) => a.camp === actor.camp
      && eligible(a, now)
      && (!this.engine.isHuman(a) || distance(a.positionAt(now), center) <= this.def.flagRadius)
      && (!orders || this.engine.isHuman(a) || orders[a.id] === flag.index)
      && !this.engine.arena.botBrains.get(a.id)?.repair_goal);
    friends.sort((a, b) => (Number(distance(a.positionAt(now), center) > this.def.flagRadius)
      - Number(distance(b.positionAt(now), center) > this.def.flagRadius))
      || (Number(ratioOf(a) < 0.4) - Number(ratioOf(b) < 0.4))
      || (Number(![10000056, 10000031].includes(a.info.tank_id))
        - Number(![10000056, 10000031].includes(b.info.tank_id)))
      || distance(a.positionAt(now), center) - distance(b.positionAt(now), center)
      || a.id - b.id);
    let needed = Math.min(4, Math.max(1, onFlag + 1));
    if (orders && flag.camp === actor.camp && !enemies.length) needed = 0;
    const holders = friends.slice(0, needed);
    if (holders.includes(actor)) {
      const slot = holders.indexOf(actor);
      const offsets = [[-48, 0], [48, 0], [0, -48], [0, 48]];
      const offset = needed > 1 ? offsets[slot] : [0, 0];
      let dest = [center[0] + offset[0], center[1] + offset[1]];
      if (distance(pos, center) > this.def.flagRadius && distance(pos, dest) <= 24) dest = [...center];
      return { kind: 'flag_hold', dest };
    }
    let angle;
    if (enemies.length) {
      const nearest = enemies.reduce((best, s) =>
        (distance(s.pos, center) < distance(best.pos, center) ? s : best), enemies[0]);
      angle = Math.atan2(nearest.pos[1] - center[1], nearest.pos[0] - center[0]);
    } else {
      const start = this.engine.arena.geometry.spawn(actor.camp);
      angle = Math.atan2(start[1] - center[1], start[0] - center[0]);
    }
    const covers = friends.filter((a) => !holders.includes(a));
    const slot = covers.includes(actor) ? covers.indexOf(actor) : actor.id % 4;
    angle += (slot - (covers.length - 1) / 2) * 0.65;
    const radius = actor.info.tank_id === 10000056 ? 180 : 240;
    return { kind: 'flag_cover',
      dest: [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius] };
  }
}

class EscortMode extends ModeController {
  install() {
    const defs = this.engine.rawMap.bombCarts || [];
    this.carts = [];
    if (!defs.length) { this.missing.push('bombCarts'); return []; }
    for (const definition of defs) {
      const cart = new BombCart(this.engine.arena, this.engine.arena.newId(5), definition);
      this.engine.arena.actors.set(cart.id, cart);
      this.carts.push(cart);
    }
    return this.carts.map((cart) => cart.snapshot());
  }

  tick(now) {
    const packets = [];
    for (const cart of this.carts) packets.push(...cart.advance(now));
    if (this.carts.some((cart) => cartProgress(cart, now) >= 1)) {
      packets.push(...this.engine._finish(true, now));
    }
    return packets;
  }

  winner(now = this.engine.now) {
    const [a, b] = [1, 2].map((camp) => {
      const cart = this.carts.find((c) => c.camp === camp);
      return cart ? cartProgress(cart, now) : 0;
    });
    return a > b ? 1 : b > a ? 2 : 0;
  }

  goal(actor, brain, seen, now) {
    if (!this.carts.length) return null;
    const carts = new Map(this.carts.filter((c) => c.alive).map((c) => [c.camp, c]));
    const own = carts.get(actor.camp) || this.carts.find((c) => c.camp === actor.camp);
    const enemy = carts.get(3 - actor.camp) || this.carts.find((c) => c.camp === 3 - actor.camp);
    if (!own || !enemy) return null;
    const pos = own.alive ? own.positionAt(now) : own.spawn;
    const friends = [...this.engine.arena.actors.values()].filter((a) => a.camp === actor.camp
      && eligible(a, now) && (ratioOf(a) >= 0.4 || a === actor));
    const volunteers = friends.filter((a) => !this.engine.isHuman(a)
      || distance(a.positionAt(now), pos) <= 200);
    const opposition = seen.filter((s) => !s.objective && distance(s.pos, pos) <= 300).length;
    const count = Math.min(volunteers.length,
      Math.max(1, opposition ? Math.min(3, opposition + 1) : 2));
    const escorts = [...volunteers].sort((a, b) =>
      distance(a.positionAt(now), pos) - (this.herders?.has(a.id) ? 180 : 0)
      - (distance(b.positionAt(now), pos) - (this.herders?.has(b.id) ? 180 : 0))
      || a.id - b.id).slice(0, count);
    const pushing = escorts.includes(actor) || !enemy.alive;
    const cart = pushing ? own : enemy;
    const center = cart.alive ? cart.positionAt(now) : cart.spawn;
    const dest = cart.route[Math.min(cart.route_index, cart.route.length - 1)] || center;
    const length = Math.max(1, distance(center, dest));
    const dx = (dest[0] - center[0]) / length;
    const dy = (dest[1] - center[1]) / length;
    const team = pushing ? escorts : volunteers.filter((a) => !escorts.includes(a));
    const slot = team.includes(actor) ? team.indexOf(actor) : 0;
    const side = (slot % 2 === 0 ? -1 : 1) * (slot < 2 ? 64 : 120);
    const ahead = pushing ? 48 : 96;
    let wanted = [center[0] + dx * ahead - dy * side,
      center[1] + dy * ahead + dx * side];
    const nav = this.engine.navigation;
    const source = nav.nearest(actor.positionAt(now));
    if (source) {
      const cells = [...nav.reachable(source)]
        .map((key) => key.split(',').map(Number))
        .filter((p) => distance(p, center) <= 180)
        .sort((a, b) => distance(a, wanted) - distance(b, wanted)
          || a[0] - b[0] || a[1] - b[1]);
      if (cells.length) wanted = cells[0];
    }
    return { kind: pushing ? 'bomb_escort' : 'bomb_intercept',
      dest: this.engine.arena.geometry.clampTankPosition(wanted) };
  }

  targets(actor, brain, seen, tanks, allies, objective) {
    const pos = actor.positionAt(this.engine.now);
    const relevant = tanks.filter((s) => distance(s.pos, pos) <= 360
      || (objective && distance(s.pos, objective.dest) <= 300));
    if (relevant.length) return relevant;
    return seen.filter((s) => s.barrier || s.bomb_cart
      || (s.structure && (distance(s.pos, pos) <= 360
        || (objective && distance(s.pos, objective.dest) <= 360))));
  }
}

class CowMode extends ModeController {
  install() {
    const raw = this.engine.rawMap;
    const defs = [...(raw.cows || []), ...(raw.barns || [])];
    const options = this.engine.options;
    if (options && Array.isArray(options.cows)) defs.push(...options.cows);
    if (options && Array.isArray(options.barns)) defs.push(...options.barns);
    this.cows = [];
    if (!defs.length) { this.missing.push('cows/barns'); return []; }
    for (const definition of defs) {
      const cow = new CowObject(this.engine.arena, this.engine.arena.newId(5), definition);
      this.engine.arena.actors.set(cow.id, cow);
      this.cows.push(cow);
    }
    return this.cows.map((cow) => cow.snapshot());
  }

  tick(now) {
    const packets = [];
    for (const cow of this.cows) {
      packets.push(...cow.advance(now));
      if (this.engine.pk.finished) break;
    }
    return packets;
  }

  goal(actor, brain, seen, now) {
    const cows = this.cows.filter((c) => c.route && c.route.length);
    if (!cows.length) return null;
    const offensive = cows.find((c) => c.camp !== actor.camp);
    const defensive = cows.find((c) => c.camp === actor.camp);
    if (!offensive) return null;
    const friends = [...this.engine.arena.actors.values()].filter((a) => a.camp === actor.camp
      && eligible(a, now) && ratioOf(a) >= 0.4);
    const target = offensive.alive ? offensive.positionAt(now) : offensive.spawn;
    const volunteers = friends.filter((a) => !this.engine.isHuman(a)
      || distance(a.positionAt(now), target) <= 240);
    const escorts = [...volunteers].sort((a, b) =>
      distance(a.positionAt(now), target) - (a.id === actor.id ? 0 : 0)
      - (distance(b.positionAt(now), target)) || a.id - b.id).slice(0, 2);
    if (escorts.includes(actor) && offensive.alive) {
      const dest = offensive.route[Math.min(offensive.route_index,
        offensive.route.length - 1)];
      const length = Math.max(1, distance(target, dest));
      const ahead = pointAt(target, dest, Math.min(96 / length, 1));
      const dx = dest[0] - target[0], dy = dest[1] - target[1];
      const side = escorts.indexOf(actor) === 0 ? -1 : 1;
      return { kind: 'escort', dest: this.engine.arena.geometry.clampTankPosition(
        [ahead[0] - (dy / length) * 72 * side, ahead[1] + (dx / length) * 72 * side]) };
    }
    if (defensive) {
      const defend = defensive.alive ? defensive.positionAt(now) : defensive.spawn;
      if (defensive.alive && (defensive.motion
        || seen.some((s) => distance(s.pos, defend) < 480))) {
        return { kind: 'defend', dest: this.engine.arena.geometry.clampTankPosition(defend) };
      }
    }
    return null;
  }
}

class BaseMode extends ModeController {
  install() {
    this.bases = [...this.engine.arena.actors.values()]
      .filter((a) => a.info && a.info.base);
    this.turrets = [...this.engine.arena.actors.values()]
      .filter((a) => a.info && a.info.map_turret);
    if (!this.bases.length) this.missing.push('base actors');
    return [];
  }

  tick(now) {
    if (this.engine.pk.finished) return [];
    if (this.bases.some((base) => !base.alive)) {
      return this.engine._finish(true, now);
    }
    if (this.engine.timeLimitHit(now)) return this.engine._finish(true, now);
    return [];
  }

  winner(now = this.engine.now) {
    const dead = this.bases.find((base) => !base.alive);
    if (dead) return 3 - dead.camp;
    const values = [1, 2].map((camp) => {
      const base = this.bases.find((b) => b.camp === camp);
      return base ? base.hp.div(base.maxHp).toNumber() : 0;
    });
    return values[0] > values[1] ? 1 : values[1] > values[0] ? 2 : 0;
  }

  goal(actor, brain, seen, now) {
    const pos = actor.positionAt(now);
    const homes = new Map(this.bases.map((b) => [b.camp, b]));
    const home = homes.get(actor.camp);
    if (home) {
      const threats = seen.filter((s) => !s.barrier && !s.structure
        && distance(s.pos, home.position) < 660);
      if (threats.length) {
        const team = [...this.engine.arena.actors.values()]
          .filter((a) => a.camp === actor.camp && !a.info.npc_template)
          .sort((a, b) => distance(a.positionAt(now), home.position)
            - distance(b.positionAt(now), home.position) || a.id - b.id);
        if (team.slice(0, Math.min(3, threats.length + 1)).includes(actor)) {
          const threat = threats.reduce((best, s) =>
            (distance(pos, s.pos) < distance(pos, best.pos) ? s : best), threats[0]);
          return { kind: 'base_defend', dest: threat.pos };
        }
      }
    }
    const structures = [...this.engine.arena.actors.values()].filter((a) => a.alive
      && a.camp !== actor.camp && (a.info.base || a.info.map_turret)
      && !(a.turret_locked && a.turret_locked()));
    const enemyHome = homes.get(3 - actor.camp);
    structures.sort((a, b) => (Number(!a.info.base) - Number(!b.info.base))
      || (Number(enemyHome && !enemyHome.unlocked_by.includes(a.id))
        - Number(enemyHome && !enemyHome.unlocked_by.includes(b.id)))
      || distance(pos, a.position) - distance(pos, b.position) || a.id - b.id);
    const target = structures[0] || enemyHome;
    if (!target) return null;
    brain.siege_target = target.id;
    return { kind: 'base_push', dest: [...target.position], target: target.id };
  }

  targets(actor, brain, seen, tanks, allies, objective) {
    const pos = actor.positionAt(this.engine.now);
    if (objective && objective.kind === 'base_defend') {
      return seen.filter((s) => !s.barrier && !s.structure
        && distance(s.pos, objective.dest) <= 360);
    }
    const close = tanks.filter((s) => distance(pos, s.pos) <= 360
      || (distance(pos, s.pos) <= 600 && allies.some((a) => ratioOf(a) < 0.6
        && distance(a.positionAt(this.engine.now), s.pos) <= 240)));
    if (close.length) return close;
    const siege = seen.filter((s) => s.id === brain.siege_target);
    if (siege.length) return siege;
    return seen.filter((s) => s.barrier
      || (s.objective && !s.structure && distance(pos, s.pos) <= 360));
  }
}

const DEATH_CENTER = Object.freeze([1092, 852]);
const DEATH_RADIUS = 250;
const DEATH_ZONE_TEMPLATE = 9000030;

class DeathMode extends ModeController {
  install(now = this.engine.now) {
    const pk = this.engine.pk;
    pk.round_phase = 'playing';
    pk.match_started_at = pk.match_started_at ?? now;
    pk.round_number = 1;
    pk.collapse_at = (this.engine.introUntil || now) + 60000;
    pk.collapse_tick_at = pk.collapse_at + 500;
    pk.begin = this.engine.introUntil || now;
    pk.end = pk.begin + 150000;
    pk.air_drop_due_at = pk.begin + 60000;
    pk.result_locks = [];
    pk.initial_bots = [];
    return [];
  }

  center() { return this.engine.mapId === 40 ? [1092, 840] : [...DEATH_CENTER]; }

  tick(now) {
    const pk = this.engine.pk;
    if (pk.finished || pk.round_phase !== 'playing') return [];
    const packets = [];
    const center = this.center();
    if (now >= pk.collapse_at - 5000 && !pk.collapse_warned) {
      pk.collapse_warned = true;
      const id = this.engine.arena.newId(4);
      this.engine.arena.objects.set(id, { template: DEATH_ZONE_TEMPLATE, position: center });
      packets.push([1556, encodeS1556(this.engine.arena.sceneId, {
        objectId: id, templateId: DEATH_ZONE_TEMPLATE,
        x: center[0], y: center[1], hp: 0, camp: 0, maxHp: 0, ownerId: 0,
      })]);
      packets.push([1501, encodeNotice(
        'Sụp mỏ sau 5 giây! Về vùng bảo vệ giữa bản đồ (bán kính 250).')]);
    }
    if (now < pk.collapse_at) return packets;
    if (!pk.collapse_started) {
      pk.collapse_started = true;
      packets.push([1501, encodeNotice(
        'Mỏ đang sụp: ngoài vùng giữa mất 4% HP tối đa mỗi giây.')]);
    }
    const due = now >= pk.collapse_tick_at;
    if (due) pk.collapse_tick_at += 500;
    if (!due) return packets;
    for (const actor of tankActors(this.engine)) {
      if (!alive(actor) || actor.inStasis()) continue;
      const safe = distance(actor.positionAt(now), center) <= DEATH_RADIUS;
      if (safe || actor.damageImmune('true', now, true)) continue;
      const amount = actor.maxHp.mul(D('.02'));
      const before = actor.hp;
      actor.damageCredit = null;
      packets.push(...actor.commitHp(before.sub(amount).max(0), now));
    }
    return packets;
  }

  checkRound(now) {
    const engine = this.engine;
    const pk = engine.pk;
    if (pk.finished || pk.round_phase !== 'playing'
      || now < (engine.introUntil || 0)) return [];
    const tanks = statsActors(engine);
    const groups = [1, 2].map((camp) => tanks.filter((a) => a.alive && a.camp === camp));
    if (groups[0].length && groups[1].length && now < pk.end) return [];
    const values = groups.map((group) => [group.length,
      group.reduce((total, a) => total + ratioOf(a), 0)]);
    const winner = values[0][0] !== values[1][0]
      ? (values[0][0] > values[1][0] ? 1 : 2)
      : (values[0][1] > values[1][1] ? 1 : values[1][1] > values[0][1] ? 2 : 0);
    pk.round_phase = 'result';
    pk.round_winner = winner;
    pk.round_reset_at = now + this.def.roundResultMs;
    if (winner) pk.scores[winner] += 1;
    const packets = [];
    for (const actor of tanks) {
      actor.position = actor.positionAt(now);
      actor.motion = null;
      packets.push([1554, encodeS1554(engine.arena.sceneId, actor.id, actor.position)]);
      for (const template of [50353, 336302, 4083]) {
        const ident = engine.arena.newId(6);
        pk.result_locks.push([actor.id, ident, template]);
        packets.push([1558, encodeS1558(actor.id, {
          templateId: template, instanceId: ident, stackCount: 1, casterId: actor.id,
        }, this.def.roundResultMs)]);
      }
    }
    if (winner) packets.push([1735, encodeS1735(winner)]);
    else packets.push([1501, encodeNotice('Hòa vòng — không cộng cúp. Vòng này sẽ đấu lại sau 5 giây.')]);
    packets.push([1736, encodeS1736(
      groups[0].length, groups[1].length)]);
    return packets;
  }

  roundTransition(now) {
    const pk = this.engine.pk;
    if (now < pk.round_reset_at) return [];
    if (Math.max(pk.scores[1], pk.scores[2]) >= this.def.rounds) {
      return this.engine._finish(true, now);
    }
    return this.resetRound(now);
  }

  resetRound(now) {
    const engine = this.engine;
    const arena = engine.arena;
    const pk = engine.pk;
    const old = { scores: { ...pk.scores }, stats: pk.stats, first_blood: pk.first_blood };
    const packets = [];
    for (const [key, [ident]] of arena.activeBuffs) {
      const owner = Number(key.split(',')[0]);
      packets.push([1559, pack((w) => w.u32(owner).u32(ident))]);
    }
    // Clear simulation callbacks and buffs. Kits re-run onSpawn below.
    arena.pending.length = 0;
    arena.activeBuffs.clear();
    for (const actor of [...arena.actors.values()]) {
      if (!actor.info || actor.info.npc_template) {
        if (actor.info && actor.info.map_object) {
          actor.hp = actor.maxHp;
          actor.info.hp = actor.hp.ceil();
          actor.position = [...actor.spawn];
          actor.motion = null;
        }
        continue;
      }
      actor.generation += 1;
      actor.hp = actor.maxHp;
      actor.info.hp = actor.hp.ceil();
      actor.position = [...(actor.spawn || actor.position)];
      actor.motion = null;
      actor.forcedUntil = 0;
      actor.lastSpeed = Number(actor.stats.iSpeed ?? 0);
      actor.shields = [];
      actor.athenaShield = null;
      actor.buffStarted.clear();
      actor.buffStacks.clear();
      actor.buffVersions?.clear();
      actor.buffSources?.clear();
      actor.damageCredit = null;
      actor.cooldowns = { 0: 0, 1: 0, 2: 0, 10: 0 };
      arena.queue(now, actor.onSpawn.bind(actor));
    }
    pk.scores = old.scores;
    pk.stats = old.stats;
    pk.contributors.clear();
    pk.streaks.clear();
    pk.multi.clear();
    pk.structure_damage.clear();
    if (old.first_blood !== undefined) pk.first_blood = old.first_blood;
    pk.round_phase = 'playing';
    pk.round_number = pk.scores[1] + pk.scores[2] + 1;
    pk.begin = now;
    pk.end = now + 150000;
    pk.intro_until = now;
    pk.collapse_at = now + 60000;
    pk.collapse_tick_at = now + 60500;
    pk.collapse_warned = false;
    pk.collapse_started = false;
    pk.result_locks = [];
    pk.round_reset_at = 0;
    packets.push(...engine.roundResetPackets());
    packets.push([1734, encodeS1734(Math.floor(now / 1000), pk.round_number, arena.sceneId)]);
    return packets;
  }
}

class WorldBossMode extends ModeController {
  install(now = this.engine.now) {
    const config = (this.engine.options && this.engine.options.worldBoss)
      || this.engine.rawMap.worldBoss || null;
    this.config = config;
    if (!config || !config.boss) {
      // world_boss_store/boss spawn paths are server-side only; the browser
      // catalog has geometry and binds but no spawn graph or shared HP ledger.
      this.missing.push('worldBoss spawn/ledger data');
      return [];
    }
    this.energy = 0;
    this.energyEndAt = 0;
    return [];
  }
  tick(now) {
    const pk = this.engine.pk;
    if (now >= pk.end) return this.engine._finish(false, now);
    if (!this.config) return [];
    return [];
  }
  winner() { return 1; }
}

export function createMode(engine) {
  const def = engine.modeDef;
  switch (def.kind) {
    case 'occupy': return new OccupyMode(engine, def);
    case 'escort': return new EscortMode(engine, def);
    case 'cow': return new CowMode(engine, def);
    case 'base': return new BaseMode(engine, def);
    case 'death': return new DeathMode(engine, def);
    case 'world_boss': return new WorldBossMode(engine, def);
    default: return new KillMode(engine, def);
  }
}

export { ModeController };
