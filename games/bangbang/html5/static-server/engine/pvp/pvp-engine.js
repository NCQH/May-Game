/* PvP arena/mode engine: 5v5 (or room-configured) bots on the shared battle
 * core. Ports server/multiplayer_battle.py's per-room arena loop and
 * pk_rules.py scoring/settlement onto BattleArena + the ported tank kits.
 *
 * Emits S1550 (self), S1551 (roster), S1556 (mode objects), S1561 (scoreboard
 * stats), S1564 (scene), S1566 (kills), S1707/S1708 (exit/settlement) and the
 * mode frames S1565, S1710/S1731/S1732/S1733/S1734/S1735/S1736.
 *
 * Skipped (kept as hooks): SQLite checkpoints, shared-room mailboxes/threads,
 * ranked Elo settlement, air-drops/items, per-kit bot_ai01..20 executors and
 * the server-only world-boss spawn ledger.
 */
import { BattleArena } from '../arena.js';
import { createData, normalizeMapDefinition } from '../data.js';
import {
  encodeS1550, encodeS1551, encodeS1561, encodeS1566, encodeS1707,
  encodeS1708,
} from '../protocol.js';
import { tankClass, TANK_CLASSES } from './tank-classes.js';
import { tickBots, makeRoster, Navigation } from './bots.js';
import {
  modeForMap, createMode, MapObjectiveActor,
  encodeS1710, encodeS1731, encodeS1733, encodeS1736,
} from './modes.js';

export const PVP_TICK_MS = 50; // 20 Hz
export const MULTI_KILL_WINDOW_MS = 8000;
const STATS = 21;
const BASE_MAPS = new Set([12, 14, 50, 169]);
const ROUND_MAPS = new Set([30, 40]);

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/** Tank kits call arena.rng() as random.random(); bots also want choice/gauss. */
function normalizeRng(rng) {
  if (typeof rng === 'function') return rng;
  const fn = () => (rng && typeof rng.next === 'function' ? rng.next() : Math.random());
  for (const key of ['next', 'uniform', 'gauss', 'choice', 'randint', 'randrange']) {
    if (rng && typeof rng[key] === 'function') fn[key] = rng[key].bind(rng);
  }
  return fn;
}

function spawnsFromNative(points) {
  const spawns = { 1: [], 2: [] };
  for (const row of points || []) {
    const [camp, x, y] = row;
    if (!spawns[camp]) spawns[camp] = [];
    spawns[camp].push([Number(x), Number(y)]);
  }
  for (const camp of [1, 2]) if (!spawns[camp].length) spawns[camp] = [[720, 720]];
  return spawns;
}

/** Catalog map row -> BattleMap definition (walls/npcs/spawns). */
export function pvpMapDefinition(raw) {
  if (!raw) throw new Error('PvpEngine requires a catalog map');
  const id = Number(raw.mapId ?? raw.id ?? 0);
  if (Array.isArray(raw.walls) && raw.walls.length) {
    // World-boss sidecar ships walls directly instead of blocks/gridCells.
    const spawns = raw.spawns || spawnsFromNative(raw.nativeSpawnPoints);
    return {
      id, width: num(raw.width), height: num(raw.height),
      bounds: raw.bounds || [36, 36, num(raw.width) - 36, num(raw.height) - 36],
      walls: raw.walls.map((r) => [...r]),
      movementWalls: (raw.movementWalls || raw.walls).map((r) => [...r]),
      npcs: raw.staticNPCs || raw.npcs || [],
      spawns,
      respawns: raw.respawns || spawnsFromNative(raw.nativeRespawnPoints) || spawns,
    };
  }
  return normalizeMapDefinition(raw, id);
}

function tankInfoOf(actor, now) {
  const pos = actor.positionAt(now);
  return {
    objectId: actor.id, accountId: actor.info.acct_id,
    x: pos[0], y: pos[1], hp: actor.hp.ceil(), maxHp: actor.maxHp.ceil(),
    camp: actor.camp, name: actor.info.name || '',
    battleLevel: actor.info.battle_level ?? 1,
    battleExp: actor.info.battle_exp ?? 0,
    tankLevel: actor.info.tank_level ?? 1,
    mp: Math.ceil(num(actor.mp)), maxMp: Math.ceil(num(actor.maxMp ?? actor.mp)),
    shield: actor.shieldAmount ? actor.shieldAmount(now).ceil() : 0,
  };
}

function statsRows(engine) {
  const rows = [];
  for (const [id, stats] of engine.pk.stats) {
    const actor = engine.arena.actors.get(id);
    if (!actor) continue;
    rows.push({
      accountId: actor.info.acct_id,
      stats: stats.length === STATS ? stats : stats.concat(Array(STATS).fill(0)).slice(0, STATS),
      tankLevel: actor.info.tank_level ?? 1,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------

export class PvpEngine {
  /**
   * map       raw catalog map (m89/m810/m811/m6/ m81330)
   * data      BattleData with garage + m6 + sidecar bindings/maps
   * mode      string or object override on modeForMap()
   * player    id-1 tank spec {tankId,level,human,name}
   * teams     {1:[specs],2:[specs]} room roster; first camp-1 entry is id 1
   * bots      room roster array (bot_setup fields)
   * classes   optional tank-id -> TankActions subclass overrides
   */
  constructor({
    map, data, mode = null, player = null, teams = null, bots = null,
    classes = null, rng = Math.random, now = 0, sceneId = null,
    runId = 'pvp-run', ranked = false, charId = 1, name = '',
    botsEnabled = true, options = null, hooks = null,
  } = {}) {
    if (!map) throw new Error('PvpEngine requires a catalog map');
    this.rawMap = map;
    this.map = pvpMapDefinition(map);
    this.mapId = this.map.id;
    this.modeDef = modeForMap(this.mapId, mode);
    this.now = Number(now);
    this.sceneId = sceneId == null ? (this.mapId || 1) : Number(sceneId);
    this.runId = String(runId);
    this.rng = normalizeRng(rng);
    this.options = options || {};
    this.hooks = hooks || {};
    this.botsEnabled = Boolean(botsEnabled);
    this.ranked = Boolean(ranked);
    this.charId = Number(charId);
    this.name = String(name);
    this.classes = { ...TANK_CLASSES, ...(classes || {}) };
    this.data = createData(data || {});
    this.outbox = [];
    this.finished = false;
    this.brains = new Map();
    this.botIds = new Set();
    this.humanIds = new Set();
    this.mapObjects = [];

    const introUntil = this.now + (this.modeDef.introMs || 0);
    this.introUntil = introUntil;
    this.pk = {
      begin: this.now, end: this.now + this.modeDef.durationMs,
      intro_until: introUntil, finished: false, winner: 0,
      scores: { 1: 0, 2: 0 }, stats: new Map(), streaks: new Map(),
      multi: new Map(), contributors: new Map(), first_blood: false,
      structure_damage: new Map(), elapsed: 0,
    };

    const fixed = this._splitRoster(teams, bots, player);
    this.playerSpec = fixed.player;
    const state = {
      char_id: this.charId, name: fixed.player.name || this.name,
      tank_id: Number(fixed.player.tankId),
      tank_level: Number(fixed.player.tankLevel ?? 5),
      tank_strength: Number(fixed.player.tankStrength ?? 0),
      tank_ext: Number(fixed.player.tankExt ?? 0),
      human: fixed.player.human !== false,
      battle: { scene_id: this.sceneId },
      scene_id: this.sceneId,
      room: {
        map_id: this.mapId, camp: 1,
        ranked: this.ranked, room_type: this.ranked ? 9 : 2,
      },
      pk: this.pk,
    };
    this.arena = new BattleArena(state, {
      clock: () => this.now, rng: this.rng, classes: this.classes,
      data: this.data, battleMap: this.map,
    });
    this.arena.engine = this;
    this.arena.botBrains = this.brains;
    this.player = this.arena.player;
    this.arena.checkRound = (n) => this._checkRound(n);
    this.arena.onRoundResultTick = (n) => this._roundTransition(n);
    this.arena.syncHint = () => [];
    this.navigation = null;

    const humanPlayer = fixed.player.human !== false;
    if (humanPlayer) this.humanIds.add(this.player.id);
    else this.botIds.add(this.player.id);
    this._attachHooks(this.player);

    this.teams = { 1: [this.player], 2: [] };
    this._addTeammates(fixed.others);
    this._installMapObjects();
    this.mode = createMode(this);
    const modePackets = this.mode.install(this.now) || [];
    this.modeInstallPackets = modePackets;
    for (const actor of this.arena.actors.values()) {
      if (actor.info && actor.info.npc_template && !this.pk.stats.has(actor.id)) {
        this._attachHooks(actor, { structureOnly: true });
      }
    }
    this._emit(this._startPackets());
    if (this.hooks.start) this._emit(this.hooks.start(this) || []);
  }

  // --------------------------------------------------------------- roster
  _splitRoster(teams, bots, player) {
    const firstTank = (spec) => Number(
      spec?.tankId ?? spec?.tank_id ?? 10000001);
    const normalize = (spec, camp, slot, isPlayer = false) => ({
      objectId: spec?.objectId ?? spec?.object_id ?? (isPlayer ? 1 : null),
      camp, slot,
      tankId: firstTank(spec),
      tankLevel: Number(spec?.tankLevel ?? spec?.tank_level ?? 5),
      tankStrength: Number(spec?.tankStrength ?? spec?.tank_strength ?? 0),
      tankExt: Number(spec?.tankExt ?? spec?.tank_ext ?? 0),
      human: spec?.human !== undefined ? spec.human === true : isPlayer,
      name: spec?.name || (isPlayer ? 'Player' : ''),
      side: spec?.side || (camp === 1 ? 'allies' : 'enemies'),
    });
    if (teams) {
      const c1 = [...(teams[1] || teams['1'] || [])];
      const c2 = [...(teams[2] || teams['2'] || [])];
      let playerSpec;
      if (player) playerSpec = normalize(player, 1, 0, true);
      else if (c1.length) playerSpec = normalize(c1.shift(), 1, 0, true);
      else playerSpec = normalize(null, 1, 0, true);
      if (playerSpec.objectId !== 1) playerSpec.objectId = 1;
      const others = [
        ...c1.map((s, i) => normalize(s, 1, i + 1)),
        ...c2.map((s, i) => normalize(s, 2, i)),
      ];
      return { player: playerSpec, others };
    }
    if (bots && bots.length) {
      const list = bots.map((b) => normalize(b,
        Number(b.camp ?? (b.side === 'enemies' ? 2 : 1)), 0));
      const host = list.find((b) => b.objectId === 1 && b.camp === 1);
      const playerSpec = player ? normalize(player, 1, 0, true)
        : host ? { ...host, objectId: 1 } : normalize(null, 1, 0, true);
      const others = list.filter((b) => b !== host);
      return { player: playerSpec, others };
    }
    const playerSpec = normalize(player, 1, 0, true);
    const roster = makeRoster({
      allies: 4, enemies: 5, rng: this.rng,
      playerTank: playerSpec.tankId, camp: 1,
    });
    return {
      player: playerSpec,
      others: roster.map((b) => normalize(b, b.camp, 0)),
    };
  }

  _addTeammates(specs) {
    const counts = { 1: 1, 2: 0 };
    const used = new Set([1]);
    let nextId = 2;
    for (const spec of specs) {
      let id = Number(spec.objectId);
      if (!Number.isInteger(id) || id < 2 || id > 10 || used.has(id)) {
        while (used.has(nextId)) nextId += 1;
        id = nextId;
      }
      used.add(id);
      const camp = spec.camp === 2 ? 2 : 1;
      const index = counts[camp] % Math.max(1,
        (this.map.spawns[String(camp)] || [[720, 720]]).length);
      counts[camp] += 1;
      const spawn = this.arena.geometry.spawn(camp, index);
      const human = Boolean(spec.human);
      const info = {
        acct_id: quietAccount(id, human, this.charId),
        name: spec.name || `Bot ${id - 1}`,
        tank_id: spec.tankId, tank_level: spec.tankLevel,
        tank_strength: spec.tankStrength, tank_ext: spec.tankExt,
        human, human_profile_id: quietAccount(id, human, this.charId),
        in_room: true, spawn_index: index,
      };
      const Cls = this.classes[spec.tankId] || tankClass(spec.tankId);
      const actor = new Cls(this.arena, id, info, camp, spawn);
      this.arena.actors.set(id, actor);
      this.teams[camp].push(actor);
      this.pk.stats.set(id, Array(STATS).fill(0));
      if (human) this.humanIds.add(id);
      else this.botIds.add(id);
      this._attachHooks(actor);
      this.arena.queue(this.introUntil, actor.onSpawn.bind(actor));
    }
    this.pk.stats.set(1, this.pk.stats.get(1) || Array(STATS).fill(0));
  }

  // --------------------------------------------------------------- hooks
  _attachHooks(actor, { structureOnly = false } = {}) {
    const originalRecord = actor.recordHp.bind(actor);
    actor.recordHp = (before, now) => {
      this._recordHp(actor, before, now);
      return originalRecord(before, now);
    };
    if (structureOnly) return;
    const originalDeath = actor.rewardDeath.bind(actor);
    actor.rewardDeath = (now) => {
      const packets = originalDeath(now) || [];
      if (!actor.info.npc_template) packets.push(...this._death(actor, now));
      return packets;
    };
    actor.respawnDelay = (now, delay) => this._respawnDelay(actor, now, delay);
  }

  _installMapObjects() {
    const defs = this.rawMap.staticNPCs || this.rawMap.npcs || [];
    for (const definition of defs) {
      if (definition.script_only) continue;
      if (definition.hp !== undefined && Number(definition.hp) <= 0) continue;
      const type = Number(definition.type ?? definition.iType ?? 0);
      if ([51, 52, 53].includes(type)) continue;
      try {
        const object = new MapObjectiveActor(this.arena, definition);
        this.arena.actors.set(object.id, object);
        this.mapObjects.push(object);
      } catch {
        // Missing NpcTemplate row: geometry still blocks the rectangle.
      }
    }
  }

  // --------------------------------------------------------------- frames
  _record(packets) {
    if (packets && packets.length) this.outbox.push(...packets);
    return packets;
  }

  _emit(packets) {
    if (packets && packets.length) this.outbox.push(...packets);
    return packets;
  }

  _startPackets() {
    const packets = [];
    try {
      packets.push(...this.player.selfSnapshotPackets());
    } catch {
      packets.push([1550, encodeS1550({
        tank: { objectId: this.player.id, accountId: this.player.info.acct_id,
          x: this.player.position[0], y: this.player.position[1],
          hp: this.player.hp.ceil(), maxHp: this.player.maxHp.ceil(),
          camp: this.player.camp, name: this.player.info.name || '' },
        speed: this.player._speed(this.now),
      })]);
    }
    const others = [...this.arena.actors.values()]
      .filter((a) => a.id !== this.player.id && !a.info.npc_template);
    packets.push([1551, encodeS1551(others.map((a) => tankInfoOf(a, this.now)))]);
    packets.push([1561, encodeS1561(statsRows(this))]);
    for (const object of this.mapObjects) packets.push(object.snapshot());
    packets.push(...(this.modeInstallPackets || []));
    return packets;
  }

  /** Used by death_mode.reset_round after actors respawn. */
  roundResetPackets() {
    const tanks = [...this.pk.stats.keys()]
      .map((id) => this.arena.actors.get(id)).filter(Boolean);
    const others = tanks.filter((a) => a.id !== this.player.id);
    const packets = [];
    try { packets.push(...this.player.selfSnapshotPackets()); } catch { /* optional */ }
    packets.push([1551, encodeS1551(others.map((a) => tankInfoOf(a, this.now)))]);
    packets.push([1561, encodeS1561(statsRows(this))]);
    packets.push(...this.mapObjects.map((o) => o.snapshot()));
    return packets;
  }

  _scorePackets(now = this.now) {
    const stat = [1561, encodeS1561(statsRows(this))];
    const id = this.mapId;
    if (ROUND_MAPS.has(id)) {
      const counts = [1, 2].map((camp) => [...this.pk.stats.keys()]
        .map((key) => this.arena.actors.get(key))
        .filter((a) => a && a.alive && a.camp === camp).length);
      return [
        [1733, encodeS1733(this.pk.scores[1], this.pk.scores[2])],
        [1736, encodeS1736(counts[0], counts[1])],
        stat,
      ];
    }
    if (id === 7 || id === 9 || id === 10 || id === 37 || id === 170) {
      return [[1731, encodeS1731(this.pk.scores[1], this.pk.scores[2])], stat];
    }
    if (id === 12 || id === 14 || id === 50 || id === 70 || id === 169) {
      return [stat];
    }
    return [[1710, encodeS1710(this.pk.scores[1], this.pk.scores[2])], stat];
  }

  // --------------------------------------------------------------- scoring
  _recordHp(target, before, now) {
    if (this.pk.finished) return;
    const loss = before.sub(target.hp).max(0).toNumber();
    if (loss <= 0) return;
    const rounded = Math.round(loss);
    const credit = target.damage_credit;
    const source = credit ? this.arena.actors.get(credit[0]) : null;
    const valid = source && credit && source.generation === credit[1];
    const targetStats = this.pk.stats.get(target.id);
    if (targetStats) targetStats[13] += rounded;
    // pk_rules.record_structure_hp: actual enemy base/turret HP loss.
    if (BASE_MAPS.has(this.mapId) && (target.info.base || target.info.map_turret)
      && (target.camp === 1 || target.camp === 2) && valid
      && source.camp !== target.camp && this.pk.stats.has(source.id)) {
      const total = (this.pk.structure_damage.get(source.id) || 0) + loss;
      this.pk.structure_damage.set(source.id, total);
      this.pk.stats.get(source.id)[7] = Math.round(total);
    }
    if (!targetStats || !valid || source.camp === target.camp) return;
    if (!this.pk.stats.has(source.id)) return;
    this.pk.stats.get(source.id)[6] += rounded;
    let records = this.pk.contributors.get(target.id);
    if (!records) { records = new Map(); this.pk.contributors.set(target.id, records); }
    records.set(source.id, {
      generation: source.generation, victim_generation: target.generation,
      hit_at: now,
    });
  }

  _killerSkill(killer) {
    const flight = this.arena.currentFlight;
    if (flight && flight.template) return Number(flight.template);
    const info = killer.info || {};
    if (info.electric_tower) return 1000114;
    if (info.map_spider) return 1000062;
    if (info.robo && killer.shot_skill) return Number(killer.shot_skill);
    try {
      return Number(this.arena.data.tableRow('TankBaseTemplate_table.xml',
        { nTankId: info.tank_id }).get('nBullet', 0));
    } catch { return 0; }
  }

  _death(victim, now) {
    if (this.pk.finished || !this.pk.stats.has(victim.id)) return [];
    const credit = victim.damage_credit;
    let killer = credit ? this.arena.actors.get(credit[0]) : null;
    if (killer && credit && killer.generation !== credit[1]) killer = null;
    const camp = 3 - victim.camp;
    if (camp !== 1 && camp !== 2) return [];
    if (this.modeDef.killScoring) this.pk.scores[camp] += 1;
    this.pk.stats.get(victim.id)[0] += 1;
    if (killer && killer.camp === camp && this.pk.stats.has(killer.id)) {
      const stats = this.pk.stats.get(killer.id);
      stats[1] += victim.info.npc_template ? 0 : 1;
      stats[2] += 1;
    }
    const packets = [];
    const deadStreak = this.pk.streaks.get(victim.id) || 0;
    this.pk.streaks.delete(victim.id);
    let assistants = [];
    let multi = 0, streak = 0, first = 0;
    if (!victim.info.npc_template) {
      const records = this.pk.contributors.get(victim.id) || new Map();
      this.pk.contributors.delete(victim.id);
      for (const [id, hit] of records) {
        const actor = this.arena.actors.get(id);
        if (actor && actor !== killer && actor.camp === camp
          && actor.generation === hit.generation
          && hit.victim_generation === victim.generation
          && now - hit.hit_at <= 5000) {
          assistants.push(id);
          this.pk.stats.get(id)[3] += 1;
        }
      }
      assistants = assistants.sort((a, b) => a - b);
      if (killer && this.pk.stats.has(killer.id)) {
        streak = (this.pk.streaks.get(killer.id) || 0) + 1;
        this.pk.streaks.set(killer.id, streak);
        const old = this.pk.multi.get(killer.id);
        multi = old && now - old.kill_at <= MULTI_KILL_WINDOW_MS ? old.count + 1 : 1;
        this.pk.multi.set(killer.id, { count: multi, kill_at: now });
        first = this.pk.first_blood ? 0 : 1;
        this.pk.first_blood = true;
      }
      this.pk.multi.delete(victim.id);
    }
    if (killer && killer.camp === camp) {
      const position = victim.positionAt(now);
      packets.push([1566, encodeS1566({
        killerId: killer.id, victimId: victim.id,
        skillId: this._killerSkill(killer),
        x: position[0], y: position[1],
        multiCount: Math.min(255, multi), killerStreak: Math.min(255, streak),
        victimStreak: Math.min(255, deadStreak), firstBlood: first,
        assists: assistants,
      })]);
    }
    packets.push(...this._scorePackets(now));
    if (this.modeDef.killScoring
      && Math.max(this.pk.scores[1], this.pk.scores[2]) >= this.modeDef.killScore) {
      packets.push(...this._finish(true, now));
    }
    return packets;
  }

  addScore(camp, amount, now = this.now) {
    if (camp !== 1 && camp !== 2) return [];
    this.pk.scores[camp] += Number(amount) || 0;
    return this._scorePackets(now);
  }

  _respawnDelay(actor, now, delay) {
    if (BASE_MAPS.has(this.mapId) && !actor.info.npc_template) {
      return Math.min(30000,
        5000 * (1 + Math.max(0, Math.floor((now - this.pk.begin) / 120000))));
    }
    if (!actor.info.npc_template) return 5000;
    return delay;
  }

  timeLimitHit(now = this.now) {
    return !this.pk.finished && now >= this.pk.end;
  }

  // ------------------------------------------------------------- lifecycle
  tick(now = this.now) {
    if (this.finished) return [];
    this.now = Number(now);
    if (this.now < this.introUntil) return [];
    const packets = [];
    packets.push(...this.arena.tick(this.now));
    if (this.pk.finished) return this._record(packets);
    if (this.pk.round_phase === 'result') {
      if (this.hooks.tick) packets.push(...(this.hooks.tick(this, this.now) || []));
      return this._record(packets);
    }
    if (this.botIds.size && !this.navigation) {
      this.navigation = new Navigation(this.arena.geometry);
    }
    packets.push(...tickBots(this, this.now));
    if (this.pk.finished) return this._record(packets);
    if (this.mode) packets.push(...(this.mode.tick(this.now) || []));
    if (this.hooks.tick) packets.push(...(this.hooks.tick(this, this.now) || []));
    if (!this.pk.finished && !ROUND_MAPS.has(this.mapId)
      && !['base', 'world_boss'].includes(this.modeDef.kind)
      && this.now >= this.pk.end) {
      packets.push(...this._finish(true, this.now));
    }
    return this._record(packets);
  }

  advance(ms, stepMs = PVP_TICK_MS) {
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

  handleFor(objectId, message, payload) {
    if (this.finished || this.now < this.introUntil) return [];
    return this._record(this.arena.handleFor(objectId, message, payload));
  }

  isHuman(actor) { return Boolean(actor && this.humanIds.has(actor.id)); }
  isBot(actor) { return Boolean(actor && this.botIds.has(actor.id)); }

  finish(won = true, now = this.now) {
    return this._record(this._finish(won, now));
  }

  _finish(won = true, now = this.now) {
    if (this.pk.finished) return [];
    this.pk.finished = true;
    this.finished = true;
    this.pk.winner = this.mode ? this.mode.winner(now) : (won ? 1 : 2);
    if (ROUND_MAPS.has(this.mapId)) {
      this.pk.elapsed = Math.max(0,
        Math.floor((now - (this.pk.match_started_at ?? this.pk.begin)) / 1000));
    } else {
      this.pk.elapsed = Math.max(0, Math.min(
        Math.floor((this.pk.end - this.pk.begin) / 1000),
        Math.floor((now - this.pk.begin) / 1000)));
    }
    for (const actor of this.arena.actors.values()) {
      actor.position = actor.positionAt(now);
      actor.motion = null;
    }
    this.arena.pending.length = 0;
    const packets = [[1707, encodeS1707({
      sceneId: this.sceneId, accountId: this.player.info.acct_id,
      exitType: 1, isObserver: 0,
    })]];
    if (this.mode) packets.push(...(this.mode.finishPackets(now) || []));
    if (this.modeDef.settlement !== false) {
      packets.push([1708, encodeS1708(this.settlement(now))]);
    }
    return packets;
  }

  _checkRound(now) {
    return this.mode ? this.mode.checkRound(now) : [];
  }

  _roundTransition(now) {
    return this.mode ? this.mode.roundTransition(now) : [];
  }

  // ------------------------------------------------------------- settlement
  settlement(now = this.now) {
    const pk = this.pk;
    const winner = pk.winner;
    const actors = [];
    for (const [id, stats] of pk.stats) {
      const actor = this.arena.actors.get(id);
      if (!actor) continue;
      const camp = actor.camp;
      const roomCount = [...pk.stats.keys()]
        .map((key) => this.arena.actors.get(key))
        .filter((a) => a && a.camp === camp && !a.info.npc_template).length;
      actors.push({
        accountId: actor.info.acct_id, tankId: actor.info.tank_id,
        stats: stats.length === STATS ? stats
          : stats.concat(Array(STATS).fill(0)).slice(0, STATS),
        isWin: winner === camp ? 1 : 0, camp,
        robotType: this.humanIds.has(id) ? 0 : 1,
        battleLevel: actor.info.battle_level ?? 1,
        roomCount,
        exp: [], coins: [], tankExp: [], items: [],
        pve: { total: 0, harm: 0, dead: 0, time: 0, booster: 0 },
      });
    }
    const best = (index) => {
      let bestId = null, bestStat = 0, bestDamage = 0;
      for (const [id, stats] of pk.stats) {
        if (!(stats[index] > 0)) continue;
        if (stats[index] > bestStat
          || (stats[index] === bestStat && stats[6] > bestDamage)
          || (stats[index] === bestStat && stats[6] === bestDamage
            && (bestId === null || id > bestId))) {
          bestId = id; bestStat = stats[index]; bestDamage = stats[6];
        }
      }
      return bestId;
    };
    const winnerIds = [...pk.stats.keys()]
      .filter((id) => this.arena.actors.get(id)?.camp === winner);
    let mvp = null;
    let mvpScore = -Infinity;
    for (const id of winnerIds) {
      const stats = pk.stats.get(id);
      const score = (stats[1] + stats[3]) / Math.max(1, stats[0]);
      if (score > mvpScore || (score === mvpScore && stats[6] > (pk.stats.get(mvp)?.[6] ?? -1))
        || (score === mvpScore && stats[6] === (pk.stats.get(mvp)?.[6] ?? -1)
          && (mvp === null || id > mvp))) {
        mvp = id; mvpScore = score;
      }
    }
    const account = (id) => (id == null ? 0 : this.arena.actors.get(id)?.info.acct_id ?? 0);
    const elapsed = pk.elapsed || Math.max(0, Math.floor((now - pk.begin) / 1000));
    return {
      sceneId: this.sceneId, mapId: this.mapId, battleTime: elapsed,
      roomType: this.ranked ? 9 : 2, winCamp: winner,
      winType: winner ? 1 : 4,
      redLifeCount: pk.scores[1], blueLifeCount: pk.scores[2],
      actors, escaped: [],
      killerId: account(best(1)), assisterId: account(best(3)),
      kdaId: account(mvp), destroyerId: account(best(7)),
      victoryMvpId: account(mvp), defeatMvpId: 0,
      sceneUuid: this.runId,
    };
  }
}

function quietAccount(id, human, charId) {
  if (human) return id === 1 ? charId : 70000000 + id;
  return 88888886 + id;
}

export default PvpEngine;
