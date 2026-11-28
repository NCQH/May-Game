// Full solo-PvE battle loop: BattleArena/BattleMap (core) + pve-data map +
// pve-rules spec + pve-ai intents -> protocol frames.
//
// Map 201 is wired exactly as server/pve_rules.py: 3s intro, 3 lives, ambush
// point 27 when the player enters pve_ambush_zone, gate instances 22/23/24
// open on ambush death, waves 10/12 (1102 @+1s, 1115 @+2s) and boss 1120 @+5s.
// Other maps use the generic hooks: spawns from the normalized catalog map,
// win when every spawned NPC is dead and nothing is pending.
//
// Not ported (kept as hooks): pve_balance level tables (absent from the
// browser catalogs), chapter 2-9 controllers, pve_shots/bosses/support/traps.
// `npcStats(template, profile)` and `hooks` are the extension points.
import {
  BattleArena, BattleMap, TankActions, scenePacket,
} from './arena.js';
import { createData } from './data.js';
import { D, ZERO, distance, rectContact } from './math.js';
import { rulesForMap, MAP201 } from './pve-rules.js';
import { REWARDS, classifyNpc } from './pve-data.js';
import { tickAll } from './pve-ai.js';
import {
  encodeS1550, encodeS1551, encodeS1556, encodeS1560, encodeS1561,
  encodeS1566, encodeS1707, encodeS1104, encodeS1708,
} from './protocol.js';

const NPC_TANK_ID = 10000019;      // PveNpc uses the catalog placeholder tank.
const GATE_OBJECT_TYPE = 3;        // map_objects instance ids: (3 << 26) | n
export const PVE_TICK_MS = 50;     // 20 Hz

// ponytail: AINpcLevelTemplate_table.xml is not in the browser catalogs, so
// role HP/attack/armor use a fixed curve (map quality 0). Pass npcStats() to
// plug the real pve_balance rows; per-template coefficients still apply.
const ROLE_BASE = {
  hp: [0, 1600, 2000, 2400, 2800, 3400],
  attack: [0, 190, 210, 230, 250, 300],
  armor: [0, 90, 100, 110, 120, 150],
};

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Catalog rects are [x1,y1,x2,y2]; BattleMap expects the same. */
export function battleMapDefinition(map, { openGates = false } = {}) {
  return {
    id: Number(map.id),
    width: num(map.width),
    height: num(map.height),
    bounds: [...map.bounds],
    walls: (map.walls || []).map((r) => [...r]),
    movementWalls: (map.movementWalls || []).map((r) => [...r]),
    npcs: (map.npcs || []).filter((n) => !(openGates && n.pve_gate)),
    pve_barriers: map.barriers || [],
    spawns: map.spawnPoints || { 1: [[36, 36]] },
    respawns: map.respawnPoints || map.spawnPoints || { 1: [[36, 36]] },
  };
}

/** Exactly 21 i32 values for S1561/S1708. */
export function stats21(actor) {
  const stats = actor.stats || {};
  const keys = ['iHp', 'iAttack', 'iEgAtk', 'iArmor', 'iEgArmor', 'iCentesis',
    'iEgCtsis', 'iFireInterv', 'iSpeed', 'nFireRange'];
  const out = keys.map((key) => Math.round(num(stats[key])));
  while (out.length < 21) out.push(0);
  return out.slice(0, 21);
}

/** melee_common.in_strip: point within `width` of the start->end segment. */
export function inStrip(point, start, end, length = distance(start, end), width = 24) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const seg = Math.hypot(dx, dy);
  if (!seg) return false;
  const x = point[0] - start[0], y = point[1] - start[1];
  const along = (x * dx + y * dy) / seg;
  return along >= 0 && along <= length && Math.abs(x * dy - y * dx) / seg <= width / 2;
}

export function defaultNpcStats(profile) {
  const arms = (profile && profile.arms) || {};
  const role = Math.max(1, Math.min(5, num(profile && profile.levelId, 1)));
  const base = (table, key) => (table[role] ?? table[1]);
  const hp = Math.max(1, Math.round(base(ROLE_BASE.hp) * num(arms.fHpCoef, 1)));
  return {
    iHp: String(hp),
    iAttack: String(Math.round(base(ROLE_BASE.attack) * num(arms.fBdAtkCoef, 1))),
    iEgAtk: String(Math.round(base(ROLE_BASE.attack) * num(arms.fEgAtkCoef, 1))),
    iArmor: String(Math.round(base(ROLE_BASE.armor) * num(arms.fBdArmorCoef, 1))),
    iEgArmor: String(Math.round(base(ROLE_BASE.armor) * num(arms.fEgArmorCoef, 1))),
    iCentesis: String(Math.round(20 * num(arms.fBdCtsisCoef, 1))),
    iEgCtsis: String(Math.round(20 * num(arms.fEgCtsisCoef, 1))),
    iFireInterv: String(num(profile && profile.fireInterval, 1000)),
    iSpeed: String(num(profile && profile.speed)),
    nFireRange: String(num(profile && profile.fireRange)),
    iMp: '0',
  };
}

function ensureNpcTankRow(data) {
  try {
    data.tableRow('TankUpTemplate_table.xml', { nTankId: NPC_TANK_ID, nLevel: 1 });
  } catch {
    data.addRows('TankUpTemplate_table.xml', [{
      nTankId: NPC_TANK_ID, nLevel: 1, iHp: '1', iAttack: '0', iEgAtk: '0',
      iArmor: '0', iEgArmor: '0', iCentesis: '0', iEgCtsis: '0',
      iFireInterv: '1000', iSpeed: '0', nFireRange: '0', iMp: '0',
    }]);
  }
}

// ---------------------------------------------------------------------------
// PvE actor. The base TankActions owns damage/buffs/projectiles; only the
// map-201 NPC cadence, laser and death-removal packets differ from the core.

export class PveNpcActor extends TankActions {
  constructor(arena, ident, info, camp, spawn, {
    profile = null, stats = null, mapId = 0, chapter = null, armorConstant = 300,
  } = {}) {
    super(arena, ident, {
      tank_id: NPC_TANK_ID, tank_level: 1, acct_id: 0, name: (profile && profile.name) || '',
      human: false, in_room: true, pve_npc: true, npc_template: info.npc_template,
      point: info.point,
    }, camp, spawn);
    this.stats = { ...this.stats, ...(stats || defaultNpcStats(profile)) };
    this.hp = this.maxHp = D(this.stats.iHp ?? '1');
    this.info.hp = this.hp.ceil();
    this.info.max_hp = this.maxHp.ceil();
    this.info.pve_npc = true;
    this.info.npc_template = info.npc_template;
    this.info.point = info.point;
    this.template = Number(info.npc_template);
    this.point = info.point;
    this.pveNpc = true;
    this.mapObject = false;
    this.speed = num(profile && profile.speed, num(this.stats.iSpeed));
    this.fireRange = num(profile && profile.fireRange, num(this.stats.nFireRange));
    this.fireInterval = num(profile && profile.fireInterval, num(this.stats.iFireInterv, 1000));
    this.fireCount = num(profile && profile.fireCount, 1);
    this.fireBreak = num(profile && profile.fireBreak);
    this.skill = num(profile && profile.skill);
    this.shotSkill = this.skill;
    this.cooldowns = { 0: 0 };
    this.routePoint = info.point;
    this.routePrevious = null;
    this.routeQueue = [];
    this.logic = null;
    this.motionUntil = 0;
    this.x = spawn[0];
    this.y = spawn[1];
    this.pve_armor_constant = D(armorConstant);
    this.pve_damage_multiplier = D(1);
    const flags = classifyNpc(mapId, chapter, this.template, (profile && profile.arms) || {});
    this.hostage = flags.hostage;
    this.flying = flags.flying;
    this.stationary = flags.stationary;
    this.trap = flags.trap;
    this.info.pve_hostage = flags.hostage;
    this.lastSpeed = Number(this.stats.iSpeed ?? 0);
  }

  syncSpeed() { return []; }

  deathHook() { return [scenePacket({ removedObjects: [this.id] })]; }

  /** Direct projectile shot used by pve-ai casts and boss bursts. */
  fireProjectile(action, now) {
    if (this.info.pve_hostage || !this.shotSkill) return [];
    if (this.blocked('attack', now) || this.skillSealed(0, now)) return [];
    const start = this.positionAt(now);
    const dest = action.dest;
    if (start[0] === dest[0] && start[1] === dest[1] && this.shotSkill !== 1000034) return [];
    return this.shoot(this.shotSkill, start, dest, now, this.combatStat('iAttack', now), {
      school: 'physical', basic: true,
    });
  }

  /** 1115 fixed laser: 360px instant strip, clipped by walls/water. */
  fireLaser(action, now) {
    if (this.info.pve_hostage || !this.shotSkill) return [];
    if (this.blocked('attack', now) || this.skillSealed(0, now)) return [];
    const start = this.positionAt(now);
    const end = action.dest;
    if (start[0] === end[0] && start[1] === end[1]) return [];
    const ident = this._newId(2);
    const packets = [scenePacket({
      fires: [{ bulletId: ident, ownerId: this.id, start, dest: end, speed: 32767, templateId: this.shotSkill }],
      blownBullets: [ident],
    })];
    const length = distance(start, end);
    for (const target of [...this.arena.actors.values()]) {
      if (!target.alive || target.camp === this.camp || !target.isAreaTargetable()) continue;
      const pos = target.positionAt(now);
      if (!inStrip(pos, start, end, length, 24)) continue;
      const exclude = target.map_rect ? [target.map_rect] : [];
      if (this.arena.geometry.wallContact(start, pos, 0, { exclude }) !== null) continue;
      if (this.projectileBlocked(target, now)) continue;
      packets.push(...this.damage(this.combatStat('iEgAtk', now), now, {
        target, school: 'energy', basic: true,
      })[0]);
    }
    return packets;
  }
}

// ---------------------------------------------------------------------------

export class PveEngine {
  /**
   * map         normalized pve-data map (buildPveIndex().maps.get(id))
   * data        BattleData (garage + m6 + pve catalogs) with player tank rows
   * npcProfiles Map<template, profile> from buildPveIndex()
   * npcStats    optional (template, profile) => stat strings
   * classes     optional tank_id -> TankActions subclass for the player
   * hooks       optional { start, spawn, npcDeath, complete, tick }
   */
  constructor({
    map, data, npcProfiles = null, npcProfile = null, npcStats = null,
    tank = {}, charId = 1, name = '', sceneId = null, runId = 'pve-run',
    now = 0, rng = Math.random, rules = null, classes = null, tactics = true,
    npcArmorConstant = 300, npcClass = PveNpcActor, hooks = null,
  } = {}) {
    if (!map) throw new Error('PveEngine requires a normalized pve-data map');
    this.map = map;
    this.rules = rules || rulesForMap(map);
    this.now = now;
    this.sceneId = sceneId == null ? Number(map.id) || 1 : sceneId;
    this.runId = String(runId);
    this.rng = rng;
    this.hooks = hooks || {};
    this.npcProfiles = npcProfiles;
    this.npcProfile = npcProfile;
    this.npcStatsHook = npcStats;
    this.npcClass = npcClass;
    this.armorConstant = npcArmorConstant;
    this.tactics = tactics;
    this.outbox = [];
    this.finished = false;
    this.won = null;

    this.data = createData(data || {});
    ensureNpcTankRow(this.data);

    const tankId = Number(tank.tankId ?? tank.tank_id ?? 10000001);
    const state = {
      char_id: charId, name, tank_id: tankId,
      tank_level: Number(tank.level ?? tank.tank_level ?? 1),
      tank_strength: Number(tank.strength ?? tank.tank_strength ?? 0),
      tank_ext: Number(tank.ext ?? tank.tank_ext ?? 0),
      battle: { scene_id: this.sceneId },
      scene_id: this.sceneId,
      room: { map_id: Number(map.id), camp: 1 },
    };
    this.arena = new BattleArena(state, {
      clock: () => this.now,
      rng,
      classes,
      data: this.data,
      battleMap: battleMapDefinition(map),
    });
    this.player = this.arena.player;
    this.accountId = this.player.info.acct_id;
    // Common PvE gets exactly one 5s respawn (pve_rules.PLAYER_RESPAWN_MS).
    this.player.respawnDelay = () => this.rules.playerRespawnMs ?? 5000;

    this.introUntil = this.now + (this.rules.introMs ?? 3000);
    this.battleEnd = this.introUntil + (this.rules.timeLimitMs ?? 900000);
    this.lives = this.rules.lives ?? 1;
    this.deaths = 0;
    this.npcDeaths = 0;
    this.stage = Number(map.id) === MAP201.mapId ? 'ambush' : 'generic';
    this.ambushTriggered = false;
    this.genericStarted = false;
    this.gatesOpen = false;
    this.boss = null;
    this.npcs = new Map();
    this.spawned = [];
    this.pendingSpawns = [];
    this.alive = new Map([[this.player.id, true]]);
    this.playerView = {
      id: this.player.id, generation: this.player.generation, camp: this.player.camp,
      alive: this.player.alive, template: 0, mapObject: false, hostage: false,
      x: this.player.position[0], y: this.player.position[1],
    };
    this.world = this._buildWorld();
    this.gateIds = (map.npcs || []).filter((n) => n.pve_gate)
      .map((n) => ((GATE_OBJECT_TYPE << 26) | num(n.instance)) >>> 0);

    this._emit(this._startPackets());
    if (this.hooks.start) this._emit(this.hooks.start(this) || []);
  }

  // --------------------------------------------------------------- lifecycle
  tick(now = this.now) {
    if (this.finished) return [];
    this.now = now;
    if (now < this.introUntil) return [];
    const packets = [];
    packets.push(...this.arena.tick(now));
    this._syncViews(now);

    packets.push(...this._checkPlayerDeath(now));
    if (this.finished) return this._record(packets);

    for (const npc of [...this.npcs.values()]) {
      if (this.alive.get(npc.id) && !npc.alive) {
        this.alive.set(npc.id, false);
        packets.push(...this._onNpcDeath(npc, now));
        if (this.finished) return this._record(packets);
      }
    }

    packets.push(...this._mapTick(now));
    packets.push(...this._spawnDue(now));
    if (this.finished) return this._record(packets);

    packets.push(...this._aiTick(now));
    if (this.hooks.tick) packets.push(...(this.hooks.tick(this, now) || []));
    packets.push(...this._complete(now));
    if (!this.finished && now >= this.battleEnd) packets.push(...this._finish(false, now));
    return this._record(packets);
  }

  /** Run in 20 Hz frames. Returns every packet produced. */
  advance(ms, stepMs = PVE_TICK_MS) {
    const start = this.now;
    const end = this.now + Math.max(0, ms);
    const packets = [];
    while (this.now < end && !this.finished) {
      const step = Math.min(stepMs, end - this.now);
      this.now += step;
      packets.push(...this.tick(this.now));
    }
    return packets;
  }

  drain() {
    const packets = this.outbox;
    this.outbox = [];
    return packets;
  }

  handle(message, payload) {
    if (this.finished || this.now < this.introUntil) return [];
    return this._record(this.arena.handle(message, payload));
  }

  /** Scripted end; also called by lives/boss/time checks. Emits 1707/1104/1708. */
  finish(won = true, now = this.now) {
    return this._record(this._finish(Boolean(won), now));
  }

  // ------------------------------------------------------------------ world
  _buildWorld() {
    return {
      map: this.map,
      actors: [],
      playerCamp: 1,
      rng: this.rng,
      brains: new Map(),
      tactics: this.tactics,
      finished: false,
      walkable: (actor, point) => this.arena.geometry.canWalkTo(point),
      walkEnd: (actor, from, to, water) => this.arena.geometry.walkEnd(
        from, to, water || this.arena.waterRects(this.now)),
      inPlayable: (point) => this.arena.geometry.inside(point)
        && this.arena.geometry.inPlayableRegion(point),
      clamp: (point) => this.arena.geometry.clampTankPosition(point),
      lineClear: (actor, from, to) => this.arena.geometry.wallContact(from, to, 0) === null,
      weaponLine: (actor, from, to, now) => this.arena.geometry.wallContact(from, to, 0) === null
        && rectContact(from, to, this.arena.waterRects(now)) === null,
      waterRects: (now) => this.arena.waterRects(now),
      blocked: (actor, kind, now) => (actor && typeof actor.blocked === 'function'
        ? actor.blocked(kind, now) : false),
      skillSealed: (actor, now) => (actor && typeof actor.skillSealed === 'function'
        ? actor.skillSealed(0, now) : false),
      clipFraction: (actor, start, end, now) => {
        let fraction = 1;
        const wall = this.arena.geometry.wallContact(start, end, 0);
        if (wall !== null) fraction = Math.min(fraction, wall);
        const water = rectContact(start, end, this.arena.waterRects(now));
        if (water !== null) fraction = Math.min(fraction, water);
        return fraction;
      },
      observableHook: null,
    };
  }

  _syncViews(now) {
    const player = this.player;
    this.playerView.id = player.id;
    this.playerView.generation = player.generation;
    this.playerView.camp = player.camp;
    this.playerView.alive = player.alive;
    this.playerView.x = player.positionAt(now)[0];
    this.playerView.y = player.positionAt(now)[1];
    for (const npc of this.npcs.values()) {
      if (npc.motion && npc.motion[3] <= now) npc.motion = null;
      npc.motionUntil = npc.motion ? npc.motion[3] : 0;
      const pos = npc.positionAt(now);
      npc.x = pos[0];
      npc.y = pos[1];
    }
    this.world.actors = [this.playerView, ...this.npcs.values()];
    this.world.finished = this.finished;
  }

  // ----------------------------------------------------------------- frames
  _record(packets) {
    if (packets.length) this.outbox.push(...packets);
    return packets;
  }

  _emit(packets) {
    if (packets.length) this.outbox.push(...packets);
    return packets;
  }

  _startPackets() {
    const packets = [];
    try {
      packets.push(...this.player.selfSnapshotPackets());
    } catch {
      packets.push([1550, encodeS1550({
        tank: {
          objectId: this.player.id, accountId: this.accountId, x: this.player.position[0],
          y: this.player.position[1], hp: this.player.hp.ceil(),
          maxHp: this.player.maxHp.ceil(), camp: this.player.camp, name: '',
        },
        speed: this.player._speed(this.now),
      })]);
    }
    packets.push([1551, encodeS1551([])]);
    packets.push([1561, encodeS1561([{
      accountId: this.accountId, stats: stats21(this.player),
      tankLevel: this.player.info.tank_level ?? 1,
    }])]);
    for (const npc of (this.map.npcs || []).filter((n) => n.pve_gate)) {
      const id = ((GATE_OBJECT_TYPE << 26) | num(npc.instance)) >>> 0;
      packets.push([1556, encodeS1556(this.sceneId, {
        objectId: id, templateId: num(npc.template), x: num(npc.x), y: num(npc.y),
        hp: num(npc.hp), camp: num(npc.camp), maxHp: num(npc.hp), ownerId: 0,
      })]);
    }
    return packets;
  }

  _profile(template) {
    if (this.npcProfile) return this.npcProfile(template) || null;
    return this.npcProfiles ? this.npcProfiles.get(Number(template)) || null : null;
  }

  _spawnPoint(point, template, now) {
    const record = (this.map.spawns || []).find((s) => s.point === point);
    const position = record && record.position
      ? [...record.position]
      : (this.map.boss && this.map.boss.position ? [...this.map.boss.position] : null);
    if (!position) throw new Error(`Map ${this.map.id} point ${point} has no spawn position`);
    const profile = this._profile(template);
    const stats = this.npcStatsHook
      ? this.npcStatsHook(template, profile)
      : defaultNpcStats(profile);
    const id = this.arena.newId(5);
    const npc = new this.npcClass(this.arena, id,
      { point, npc_template: Number(template) }, 0, position, {
        profile, stats, mapId: this.map.id, chapter: this.map.chapter,
        armorConstant: this.armorConstant,
      });
    this.arena.actors.set(id, npc);
    this.npcs.set(id, npc);
    this.alive.set(id, true);
    this.spawned.push({ id, template: Number(template), point, at: now });
    const bossTemplate = this.rules.boss ? Number(this.rules.boss.template)
      : (this.map.boss ? Number(this.map.boss.template) : null);
    if (bossTemplate !== null && Number(template) === bossTemplate && !this.boss) this.boss = npc;
    const packets = [
      [1556, encodeS1556(this.sceneId, {
        objectId: id, templateId: Number(template), x: position[0], y: position[1],
        hp: npc.hp.ceil(), camp: npc.camp, maxHp: npc.maxHp.ceil(), ownerId: 0,
      })],
      [1561, encodeS1561([{
        accountId: npc.info.acct_id, stats: stats21(npc), tankLevel: 1,
      }])],
    ];
    if (this.hooks.spawn) packets.push(...(this.hooks.spawn(this, npc, now) || []));
    return packets;
  }

  _spawnDue(now) {
    const packets = [];
    const remaining = [];
    for (const record of this.pendingSpawns) {
      if (record.due <= now) packets.push(...this._spawnPoint(record.point, record.template, now));
      else remaining.push(record);
    }
    this.pendingSpawns = remaining;
    return packets;
  }

  // -------------------------------------------------------------- map rules
  _mapTick(now) {
    if (this.finished) return [];
    if (Number(this.map.id) !== MAP201.mapId) return this._genericStart(now);
    const ambush = this.rules.ambush;
    if (!ambush || this.ambushTriggered || this.stage !== 'ambush') return [];
    if (!this.player.alive || !ambush.zone) return [];
    const [left, top, width, height] = ambush.zone;
    const [x, y] = this.player.positionAt(now);
    if (x < left || x > left + width || y < top || y > top + height) return [];
    this.ambushTriggered = true;
    return this._spawnPoint(ambush.point, ambush.template, now);
  }

  _genericStart(now) {
    if (this.genericStarted) return [];
    this.genericStarted = true;
    for (const record of this.map.spawns || []) {
      for (const template of record.templates || []) {
        const delay = Math.max(0, num(record.delay, 0)) * 1000;
        this.pendingSpawns.push({ point: record.point, template, due: now + delay });
      }
    }
    return [];
  }

  _onNpcDeath(npc, now) {
    this.npcDeaths += 1;
    const packets = [[1566, encodeS1566({
      killerId: this.player.id, victimId: npc.id, skillId: num(npc.shotSkill),
      x: npc.x, y: npc.y, firstBlood: this.npcDeaths === 1 ? 1 : 0, assists: [],
    })]];
    if (this.hooks.npcDeath) packets.push(...(this.hooks.npcDeath(this, npc, now) || []));
    if (this.finished) return packets;

    if (this.boss === npc) return packets.concat(this._finish(true, now));
    if (Number(this.map.id) === MAP201.mapId) {
      if (npc.point === MAP201.ambushPoint && this.stage === 'ambush') {
        this.stage = 'waves';
        packets.push(...this._openGates());
        for (const wave of this.rules.waves || []) {
          for (const spawn of wave.spawns) {
            this.pendingSpawns.push({
              point: wave.point, template: spawn.template, due: now + spawn.delayMs,
            });
          }
        }
      }
      return packets;
    }
    return packets.concat(this._complete(now));
  }

  _openGates() {
    if (this.gatesOpen) return [];
    this.gatesOpen = true;
    if (this.gateIds.length) {
      this.arena.geometry = new BattleMap(battleMapDefinition(this.map, { openGates: true }));
    }
    return this.gateIds.length ? [scenePacket({ removedObjects: this.gateIds })] : [];
  }

  _complete(now) {
    if (this.finished) return [];
    if (this.hooks.complete) {
      const result = this.hooks.complete(this, now);
      return result === 'win' ? this._finish(true, now) : result === 'lose' ? this._finish(false, now) : [];
    }
    if (Number(this.map.id) === MAP201.mapId) return [];
    const pending = this.pendingSpawns.length > 0;
    const living = [...this.npcs.values()].some((npc) => npc.alive);
    if (this.genericStarted && !pending && !living) return this._finish(true, now);
    return [];
  }

  _checkPlayerDeath(now) {
    const was = this.alive.get(this.player.id) ?? true;
    if (was && !this.player.alive) {
      this.alive.set(this.player.id, false);
      this.deaths += 1;
      this.lives = Math.max(0, this.lives - 1);
      const packets = [[1560, encodeS1560(this.accountId, 5, this.lives)]];
      if (this.lives <= 0) return packets.concat(this._finish(false, now));
      return packets;
    }
    if (!was && this.player.alive) this.alive.set(this.player.id, true);
    return [];
  }

  // ------------------------------------------------------------------- AI
  _aiTick(now) {
    this._syncViews(now);
    const packets = [];
    for (const group of tickAll(this.world, now, { modern: false })) {
      const npc = this.npcs.get(group.actorId);
      if (!npc || !npc.alive) continue;
      for (const action of group.actions) {
        if (action.type === 'move') {
          npc.position = [...action.to];
          npc.motion = [[...action.from], [...action.to], now, now + action.duration];
          npc.motionKind = 0;
          npc.motionUntil = now + action.duration;
          npc.x = action.to[0];
          npc.y = action.to[1];
          packets.push(scenePacket({
            moves: [{
              owner: npc.id, position: action.to, speed: action.speed,
              kind: 0, direction: action.direction,
            }],
          }));
        } else if (action.type === 'stop') {
          const pos = npc.stopPosition(now);
          npc.position = pos;
          npc.motion = null;
          npc.motionUntil = 0;
          packets.push(scenePacket({
            moves: [{ owner: npc.id, position: pos, speed: 0, kind: 5 }],
          }));
        } else if (action.type === 'cast') {
          packets.push(...(action.laser ? npc.fireLaser(action, now) : npc.fireProjectile(action, now)));
        }
      }
    }
    return packets;
  }

  // -------------------------------------------------------------- settlement
  _finish(won, now) {
    if (this.finished) return [];
    this.finished = true;
    this.won = Boolean(won);
    this.arena.pending.length = 0;
    this.pendingSpawns = [];
    for (const actor of this.arena.actors.values()) {
      actor.position = actor.positionAt(now);
      actor.motion = null;
    }
    const packets = [
      [1707, encodeS1707({
        sceneId: this.sceneId, accountId: this.accountId, exitType: 1, isObserver: 0,
      })],
      [1104, encodeS1104({
        kind: 1,
        award: won
          ? { groups: [{ type: 3, items: REWARDS.win.map((itemId) => ({ itemId, count: 1 })) }] }
          : { groups: [] },
      })],
      [1708, encodeS1708(this.settlement(won, now))],
    ];
    return packets;
  }

  settlement(won, now = this.now) {
    const player = this.player;
    return {
      sceneId: this.sceneId,
      mapId: Number(this.map.id),
      battleTime: Math.max(0, Math.floor((now - this.introUntil) / 1000)),
      roomType: 4,
      winCamp: won ? 1 : 0,
      winType: 1,
      redLifeCount: this.lives,
      blueLifeCount: 0,
      actors: [{
        accountId: this.accountId,
        tankId: player.info.tank_id,
        stats: stats21(player),
        isWin: won ? 1 : 0,
        battleLevel: player.info.battle_level ?? 1,
        camp: player.camp,
        exp: [], coins: [], tankExp: [], items: [],
        pve: { total: this.npcDeaths, harm: 1, dead: Math.min(255, this.deaths), time: 1, booster: 0 },
      }],
      escaped: [],
      sceneUuid: this.runId,
    };
  }
}

export default PveEngine;
