// PvE chapter 2-9 objectives and scripted controllers (M4 port of
// server/pve_chapter2.py ... pve_chapter8_9.py, pve_hazards.py, pve_bosses.py,
// pve_boss_tactics.py, pve_boss_tactics_v2.py, pve_dooku.py, pve_support.py,
// pve_shots.py, pve_bomb_puzzles.py, pve_spawn_exits.py, pve_local_late.py).
//
// Data-driven: spawns/zones/waves/paths/hazards/npcs come from the normalized
// pve-data map (map.spawns, map.zones, map.waves, map.hazards, map.npcs).
// Only the authored per-map constants that the Python modules hardcode are
// repeated here (stage lists, decor templates, boss ids, switches, crossings,
// factory exits, escorts, local forklift/fortification layout).
//
// Integration with PveEngine (no core edits):
//   const controller = installObjectives(engine);
//   // PveEngine calls hooks.start, hooks.spawn, hooks.npcDeath,
//   // hooks.complete and hooks.tick. installObjectives also sets
//   // engine.genericStarted=true so the generic all-spawns loop stays off.
// A caller that destroys map objects must call controller.objectDestroyed(...)
// because PveEngine does not simulate static map objects as actors.
//
// Presentation-only packets (hazard/scene visuals) are skipped; NPC buffs,
// turret shots, rescues, switches, hazards and scripted births are simulated.

import { CHAPTER_RULES, MAP_BOSSES } from './pve-rules.js';
import { D, distance, rectContact } from './math.js';
import { scenePacket } from './arena.js';
import { encodeS1556 } from './protocol.js';
import {
  chooseGoal, chooseAirGoal, patrolGoal, observable, weaponLine, DIRECTIONS,
} from './pve-ai.js';

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const dnum = (value) => (value && typeof value.toNumber === 'function'
  ? value.toNumber() : num(value));
const hpRatio = (actor) => Math.max(0, dnum(actor?.hp))
  / Math.max(1, dnum(actor?.maxHp));
const arr = (value) => (Array.isArray(value) ? value : []);
const key = (a, b) => `${a}:${b}`;
const posOf = (actor, now = 0) => (typeof actor?.positionAt === 'function'
  ? actor.positionAt(now) : [num(actor?.x), num(actor?.y)]);

// ------------------------------------------------------------------ constants
export const STAGES = Object.freeze({
  401: [1, 2, 3, 4, 5], 402: [1, 2, 3, 4, 5], 403: [1, 2, 3, 4],
  404: [1, 2, 3, 4, 5, 6], 405: [1, 2, 3, 4, 5], 406: [1, 2, 3, 4],
  701: [1, 2, 3, 4, 5], 702: [1, 2, 3, 4], 703: [1, 2],
});
export const STAGE_COUNT = Object.freeze({ 501: 6, 502: 7, 503: 6, 601: 5, 602: 2, 603: 5 });
export const DECOR = Object.freeze({
  2: [409, 414, 415, 416, 440, 612, 613],
  3: [1409, 1414, 1416, 1440, 353, 342],
  4: [1350, 1351, 1353, 2612, 2613, 2673, 2676],
  5: [517, 518, 519, 520, 522, 524, 525, 526, 527, 567, 578],
  6: [717, 718, 719, 720, 721, 3110112, 3110113],
  7: [3130108, 3130210, 3130211],
  8: [3150209, 3150210, 3160112, 3160113, 3160115, 3160116],
  9: [3150209, 3150210, 3160112, 3160113, 3160115, 3160116],
});
export const LASERS = Object.freeze({
  2: { 612: [-360, 0], 613: [360, 0] },
  3: { 342: [0, -360] },
  4: { 1350: [-360, 0], 1351: [360, 0], 2612: [300, 0], 2673: [0, -360] },
  5: { 524: [0, 360], 525: [-360, 0], 526: [360, 0] },
  6: { 719: [-360, 0], 720: [360, 0], 721: [0, -300], 3110112: [0, 300] },
  7: { 3130210: [-360, 0], 3130211: [360, 0] },
  8: { 3150209: [-360, 0], 3150210: [360, 0] },
  9: { 3150209: [-360, 0], 3150210: [360, 0] },
});
export const SWITCHES = Object.freeze({
  402: { 67: 3 },
  403: { 63: 2, 62: 3, 61: 4, 68: 65 },
});
export const GOALS = Object.freeze({
  405: { 1437: 2 }, 406: { 1430: 1 }, 301: { 322: 4 }, 302: { 346: 4 },
  303: { 347: 1, 359: 1 },
});
export const CROSSINGS = Object.freeze({
  501: [[588, 1548], [540, 1500]],
  502: [[1116, 900], [1092, 828]],
  603: [[1188, 2916], [996, 2892]],
  31302: [[348, 324], [468, 324]],
});
export const FACTORY_EXITS = Object.freeze({
  '501:9': [83, 2052, 1764], '502:9': [46, 804, 1572], '502:39': [120, 1668, 300],
  '502:30': [193, 1836, 1188], '503:9': [99, 1956, 1092], '503:67': [268, 516, 324],
});
export const FACTORY_505 = Object.freeze({
  source: [2052, 1956], outlet: [1980, 1956], factory: 20187, templates: [555, 556],
});
export const SPAWN_EXITS = Object.freeze({
  '603:301': { origin: [250, 1000], wave: 3, repeat: 0,
    births: { 702: [324, 996], 703: [324, 1068] } },
  '30102:211': { origin: [359, 1418], wave: 1, repeat: 1,
    births: { 3110201: [348, 1380], 3110202: [420, 1380] } },
});
export const ESCORTS = Object.freeze([3140212, 3160203]);
export const ESCORT_ENDS = Object.freeze({
  '31402:901': [1898, 1395], '31402:902': [1088, 505], '31602:301': [1026, 933],
});
export const TANKS_305 = Object.freeze([1321, 1322, 1323, 1324]);
export const FACTORIES_305 = Object.freeze([33, 34, 35, 36]);
export const PUZZLES = Object.freeze({
  211: [[4, [708, 1356], [349, 350, 352, 353]]],
  212: [[3, [1020, 1044], [308, 309, 310, 311]], [4, [852, 2268], [324, 325, 326, 327]]],
  301: [[1, [564, 660], [158, 159, 160, 161, 162, 163]],
    [2, [372, 2076], [110, 111, 112, 113, 166, 167]]],
  302: [[1, [972, 3516], [20, 21]],
    [18, [804, 1980], [117, 118, 119, 120, 121, 122, 131, 132]],
    [19, [804, 1692], [144, 145, 146, 147, 148, 149, 150, 151, 152, 153, 154, 155,
      156, 157, 158, 159, 160, 161, 162]],
    [20, [804, 1332], [177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188,
      189, 198, 199, 209]],
    [64, [852, 684], [351, 352, 353, 354]]],
  303: [[5, [420, 1764], [87, 88, 89, 90]]],
  304: [[23, [468, 2076], [139, 140, 141, 142, 143]], [24, [828, 1260], [150, 151]]],
  305: [[15, [852, 1740], [14, 15, 16, 17]]],
  306: [[21, [852, 3132], [109, 110, 113, 114]], [22, [516, 2196], [46, 47]]],
  703: [[1, [1788, 1932], [100, 101, 102, 103, 104, 105]],
    [2, [1788, 2364], [93, 94, 95, 96, 97, 98]]],
});
export const BOSS_TACTICS_V2 = Object.freeze({
  '211:614': 'heavy', '212:625': 'skirmisher', '213:633': 'air',
  '401:413': 'air', '403:422': 'skirmisher',
  '405:1437': 'skirmisher', '406:1430': 'heavy',
  '302:346': 'siege', '303:347': 'siege', '303:359': 'siege',
  '304:1331': 'air', '306:1332': 'heavy',
  '702:2641': 'heavy', '703:2610': 'air',
  '503:515': 'hunter', '506:566': 'skirmisher',
  '602:710': 'heavy', '603:715': 'skirmisher',
  '30101:3110108': 'skirmisher', '30102:3110211': 'skirmisher',
  '31201:3120106': 'hunter', '31202:3120209': 'skirmisher',
  '31203:3120309': 'skirmisher', '31302:3130209': 'skirmisher',
  '31303:3130313': 'skirmisher', '31401:3140111': 'hunter',
  '31402:3140209': 'skirmisher', '31403:3140314': 'skirmisher',
  '31501:3150109': 'skirmisher', '31502:3150208': 'skirmisher',
  '31503:3150314': 'skirmisher',
});
export const BOSS_V1 = Object.freeze({
  MAPS: { 31601: 3160111, 31602: 3160211 },
  SKILL: 1000150, RADIUS: 300, RANGE: 800, WARNING_MS: 2000, GAP_MS: 450,
  RECOVERY_MS: { 1: 2500, 2: 2300, 3: 1800 },
  GUARD_WAVES: { 1: [3160201, 3160210], 2: [3160210, 3160202], 3: [3160201, 3160202] },
  GUARD_CAP: 3, GUARD_GRACE_MS: 1200,
});
export const DOOKU = Object.freeze({
  MAP: 30103, TEMPLATE: 3110312, LASER: 50334,
  DEBUFFS: [[50335, 50346], [50338, 50347], [50339, 50348], [50340, 50349]],
  CYCLE: 15000, LASER_WARNING: 1200, DEBUFF_WARNING: 1500, RECOVERY: 1000, RANGE: 600,
});
export const SUPPORT = Object.freeze({ MAPS: [701, 702, 703, 304, 305, 306],
  SKILLS: [1000057, 1000060, 1000061] });
export const TRANSPORT_SOURCES = Object.freeze({
  '501:6': [519, [1740, 1572]], '501:8': [519, [1740, 2052]], '501:16': [520, [996, 1188]],
  '502:54': [520, [804, 1476]], '502:36': [519, [1572, 900]], '502:38': [518, [2052, 516]],
  '502:68': [520, [420, 2052]], '503:8': [520, [900, 1764]], '503:20': [517, [1668, 1356]],
  '503:38': [519, [1500, 900]], '503:40': [520, [1380, 324]],
  '31601:711': [3160116, [843, 430]], '31601:712': [3160113, [442, 650]],
  '31601:713': [3160115, [1356, 765]],
});
export const TRANSPORT_DIRECTIONS = Object.freeze({
  517: [0, -1], 518: [0, 1], 519: [-1, 0], 520: [1, 0],
  3160113: [0, -1], 3160115: [-1, 0], 3160116: [1, 0],
});
export const TRANSPORT_LANDINGS = Object.freeze({ '31601:712': [442, 636] });
export const FORKLIFT = Object.freeze({
  MAP: 31202, TEMPLATE: 3120209, GATE_IDS: [29950, 29951, 29952, 29953, 29954],
  GATE_POSITIONS: [[2818, 795], [2818, 867], [2818, 939], [2818, 1011], [2818, 1083]],
  GOAL: [2700, 939], EXIT: [2870, 800, 70, 310],
  CAPTURE_RADIUS: 144, CAPTURE_MS: 1000, CLEAR_RADIUS: 180, CLEAR_MS: 1500,
});
export const FORT_ROWS = Object.freeze([
  [1665, [3140311, 3140312]], [1230, [3140313, 3140308]], [735, [3140312, 3140311]],
]);
export const FORT_HOLD_MS = 1000;
export const FACTORY = Object.freeze({ 505: 20187 });
export const HAZARD_RADIUS = Object.freeze({
  trigger: 60, mine: 120, airstrike: 192, bomb: 216, bombActivation: 72,
});

// --------------------------------------------------------------- base helpers
export function inside(pos, fields) {
  if (!fields || fields.length < 5) return false;
  const [, x, y, w, h] = fields;
  return x <= pos[0] && pos[0] <= x + w && y <= pos[1] && pos[1] <= y + h;
}

export function chapterFor(map) {
  const id = num(map?.id);
  return num(map?.chapter, num(CHAPTER_RULES && Object.keys(CHAPTER_RULES)
    .find((chapter) => (CHAPTER_RULES[chapter].maps || []).includes(id)), 0));
}

export function switchRadius(mapId, point) {
  return ((mapId === 402 && point === 67) || (mapId === 403 && point === 68)) ? 96 : 72;
}

export function bossArchetype(mapId, template) {
  return BOSS_TACTICS_V2[key(num(mapId), num(template))] || null;
}

export function isPlayerPresent(engine) {
  const p = engine?.player;
  if (!p || p.alive === false) return false;
  if (typeof p.inStasis === 'function') return !p.inStasis();
  if (typeof p.in_stasis === 'function') return !p.in_stasis();
  return p.info?.in_room !== false;
}

function isAlive(actor) {
  if (!actor) return false;
  if (actor.info?.in_room === false) return false;
  if (typeof actor.alive === 'boolean') return actor.alive;
  if (actor.hp && typeof actor.hp.gt === 'function') return actor.hp.gt(0);
  return num(actor.hp, 1) > 0;
}

function liveSpawned(state) {
  return state.spawned.filter((entry) => isAlive(entry.npc));
}

function mapObjectId(instance) {
  return ((3 << 26) | num(instance)) >>> 0;
}

function mapObjectAlive(engine, instance) {
  const actor = engine?.arena?.actors?.get?.(mapObjectId(instance));
  return actor ? isAlive(actor) : true; // not simulated => the script owns it
}

function mapObjectDead(c, instance) {
  return c.state.objectKills.has(num(instance)) || !mapObjectAlive(c.engine, instance);
}

function defaultHpFor(engine, template) {
  const profile = engine?._profile?.(template)
    || engine?.npcProfiles?.get?.(Number(template)) || null;
  return Math.max(1, num(profile?.stats?.iHp,
    num(profile?.arms?.fHpCoef, 1) > 0 ? 1600 : 1));
}

function objectiveFor(c, rec, template) {
  const tpl = num(template);
  const repeat = num(rec.repeat);
  const camp = num(rec.camp);
  const decor = DECOR[c.chapter] || [];
  if (c.chapter === 2) {
    return camp === 0 && repeat >= 0 && !decor.includes(tpl);
  }
  if (c.chapter === 3) {
    return camp !== 1 && repeat >= 0 && !decor.includes(tpl)
      && (camp === 0 || (c.id === 405 && [1408, 1421, 1437].includes(tpl)));
  }
  if (c.chapter === 4) {
    if (c.id === 703 && num(rec.point) === 105) return false;
    if (c.id === 305) return repeat === 0 && TANKS_305.includes(tpl);
    return camp === 0 && repeat >= 0 && !decor.includes(tpl);
  }
  if (c.chapter === 5) {
    if ((c.id === 502 && num(rec.point) === 33)
      || (c.id === 503 && num(rec.point) === 15)) return false;
    return camp === 0 && repeat >= 0 && !decor.includes(tpl);
  }
  if (c.chapter === 6) {
    if (c.id === 601 && num(rec.point) === 53) return false;
    if (c.id === 602 && num(rec.point) === 171 && tpl !== 710) return false;
    return camp === 0 && repeat >= 0 && !decor.includes(tpl);
  }
  if (c.chapter >= 7) return camp === 0 && repeat >= 0 && !decor.includes(tpl);
  return false;
}

function computeDamageTotal(c) {
  let total = 0;
  for (const rec of c.map.spawns || []) {
    for (const tpl of rec.templates || []) {
      if (objectiveFor(c, rec, tpl)) total += c.hpFor(tpl) * (num(rec.repeat) + 1);
    }
  }
  return total;
}

function recordOf(c, rule) {
  return (c.map.spawns || []).find((rec) => num(rec.index) === num(rule)) || null;
}

// ------------------------------------------------------------- spawn adapter
function spawnAt(c, rec, template, now, ctx) {
  const engine = c.engine;
  if (typeof engine.spawnNpc === 'function') {
    const result = engine.spawnNpc(rec, template, now, ctx) || {};
    const npc = result.npc || (result.id != null ? result : null);
    const packets = arr(result.packets);
    if (npc) applySpawn(c, npc, now, ctx);
    return { npc, packets };
  }
  if (typeof engine._spawnPoint === 'function') {
    const before = new Set(engine.npcs ? engine.npcs.keys() : []);
    // Synthetic local units have no catalog record; _spawnPoint only needs a
    // point that resolves to some position, then ctx.position patches it.
    const known = (c.map.spawns || []).some((spawn) => num(spawn.point) === num(rec.point));
    const point = known ? rec.point : num((c.map.spawns || [])[0]?.point, 1);
    c.state.spawnContext = ctx;
    let packets = [];
    try {
      packets = engine._spawnPoint(point, template, now) || [];
    } finally {
      c.state.spawnContext = null;
    }
    const npc = engine.npcs
      ? [...engine.npcs.values()].find((entry) => !before.has(entry.id)) || null
      : null;
    return { npc, packets: arr(packets) };
  }
  c.state.spawnRequests.push({ rec, template, now, ...ctx });
  return { npc: null, packets: [] };
}

function correctedSpawnPacket(c, npc, changed) {
  if (!changed || !c.engine.sceneId) return [];
  return [[1556, encodeS1556(c.engine.sceneId, {
    objectId: npc.id, templateId: num(npc.info?.npc_template, npc.template),
    x: num(npc.x ?? npc.position?.[0]), y: num(npc.y ?? npc.position?.[1]),
    hp: Math.ceil(num(npc.info?.hp, num(npc.hp, 1))),
    camp: num(npc.camp), maxHp: Math.ceil(num(npc.info?.max_hp, num(npc.maxHp, 1))),
    ownerId: 0,
  })]];
}

function applySpawn(c, npc, now, ctx = {}) {
  let changed = false;
  if (!npc.info) npc.info = {};
  if (ctx.info) Object.assign(npc.info, ctx.info);
  if (ctx.camp != null && num(npc.camp) !== num(ctx.camp)) {
    npc.camp = num(ctx.camp); changed = true;
  }
  if (ctx.position) {
    const current = posOf(npc, now);
    if (distance(current, ctx.position) > 0.01) {
      npc.position = [...ctx.position];
      npc.spawn = [...ctx.position];
      npc.x = ctx.position[0];
      npc.y = ctx.position[1];
      changed = true;
    }
  }
  const tpl = num(npc.info?.npc_template, npc.template);
  const buff = (template) => {
    if (typeof npc._buff !== 'function') return;
    npc._buff(template, now);
  };
  const queue = (due, kind, ...data) => {
    if (typeof npc._queue !== 'function') return;
    npc._queue(due, kind, ...data);
  };
  const turret = (delay) => {
    npc.turretNextShotAt = now + delay;
    npc.turret_next_shot_at = npc.turretNextShotAt;
  };

  if (c.chapter === 2 && [612, 613].includes(tpl)) turret(5000);
  if (c.chapter === 3 && tpl === 342) turret(5000);
  if (c.chapter === 4) {
    if ([1350, 1351, 2673].includes(tpl)) turret(5000);
    else if (tpl === 2612) turret(500);
    if (tpl === 2619) buff(50316);
  }
  if (c.chapter === 5) {
    if ([524, 525, 526].includes(tpl)) turret(3500);
    if ([514, 565].includes(tpl)) {
      buff(30101);
      npc.mapShieldHits = 3;
      npc.map_shield_hits = 3;
    }
    if (tpl === 577) c.state.alliesCalled = true;
  }
  if (c.chapter === 6) {
    if (tpl === 3110312) configureDooku(npc, now);
    if (tpl === 3110310) buff(50350);
    if (LASERS[6]?.[tpl]) turret(num(npc.fireInterval, 1000));
  }
  if (c.chapter === 7) {
    if (LASERS[7]?.[tpl]) turret(num(npc.fireInterval, 1000));
    if (tpl === 3130313) {
      buff(10001091);
      queue(now + 500, 'pve_plague', npc.generation);
    }
  }
  if (c.chapter >= 8 && c.chapter <= 9) {
    if (tpl === 3160211) {
      buff(15101);
      if (c.frozen) {
        npc.shotSkill = BOSS_V1.SKILL;
        npc.fireRange = BOSS_V1.RANGE;
        npc.pveFireRange = BOSS_V1.RANGE;
        if (npc.stats) npc.stats.nFireRange = String(BOSS_V1.RANGE);
      }
    }
    if (tpl === 3140314 && c.frozen) {
      buff(10001091);
      queue(now + 500, 'pve_plague', npc.generation);
    }
    if (LASERS[c.chapter]?.[tpl]) turret(num(npc.fireInterval, 1000));
  }
  return changed ? correctedSpawnPacket(c, npc, changed) : [];
}

// ------------------------------------------------------------- script engine
function stopPoints(c, points) {
  const set = new Set(points.map(num));
  const ids = new Set((c.map.spawns || [])
    .filter((rec) => set.has(num(rec.point))).map((rec) => num(rec.index)));
  c.state.activeRules = c.state.activeRules.filter((index) => !ids.has(index));
  c.state.spawns = c.state.spawns.filter((event) => !ids.has(event.rule));
}

function stop(c, points) {
  const set = new Set(points.map(num));
  const ids = (c.map.spawns || []).filter((rec) => set.has(num(rec.point)))
    .map((rec) => num(rec.index));
  c.state.stoppedRules = [...new Set([...c.state.stoppedRules, ...ids])].sort((a, b) => a - b);
  stopPoints(c, points);
}

function removeObjects(c, instances) {
  const packets = [];
  for (const raw of instances) {
    const instance = num(raw);
    const id = mapObjectId(instance);
    c.state.objectKills.add(instance);
    const actor = c.engine?.arena?.actors?.get?.(id);
    if (actor) {
      actor.hp = D(0);
      if (actor.info) { actor.info.hp = 0; actor.info.in_room = false; }
      actor.motion = null;
    }
    if (!c.state.removedOnce.has(instance)) {
      c.state.removedOnce.add(instance);
      packets.push(scenePacket({ removedObjects: [id] }));
    }
  }
  return packets;
}

function schedule(c, rec, now, { triggered = false } = {}) {
  if (!rec) return;
  if (c.state.activeRules.includes(num(rec.index))) return;
  if (c.state.stoppedRules.includes(num(rec.index))) return;
  const id = c.id;
  if (id === 703 && num(rec.point) === 105) return;
  c.state.activeRules.push(num(rec.index));
  const rawDelay = num(rec.delay);
  let delay;
  if (c.chapter === 3) {
    delay = triggered && id === 406 && rawDelay < -1 ? Math.abs(rawDelay) : Math.max(0, rawDelay);
  } else if (c.chapter === 5) {
    delay = id >= 504 ? Math.abs(rawDelay) : Math.max(0, rawDelay);
  } else if (c.chapter >= 6) {
    delay = Math.abs(rawDelay);
  } else {
    delay = Math.max(0, rawDelay);
  }
  const decor = DECOR[c.chapter] || [];
  const skip = c.chapter === 2 ? [416, 440]
    : c.chapter === 3 ? [1416, 1440]
      : c.chapter === 4 ? [2613]
        : c.chapter === 5 ? [578] : [];
  for (const [n, template] of (rec.templates || []).entries()) {
    const tpl = num(template);
    if (skip.includes(tpl)) continue;
    const isDecor = decor.includes(tpl);
    c.state.spawns.push({
      rule: num(rec.index), template: tpl,
      remaining: c.chapter >= 7 || !isDecor ? num(rec.repeat) : 0,
      loop: !isDecor && num(rec.repeat) < 0,
      due: now + (delay + n * Math.max(1, num(rec.interval, 1))) * 1000,
    });
  }
}

function triggerRecords(c, point, now) {
  for (const rec of c.map.spawns || []) {
    if (num(rec.point) !== num(point) || num(rec.delay) >= 0) continue;
    const wave = num(rec.wave);
    if (wave) {
      const gated = (c.chapter === 2 || c.chapter === 5 || c.chapter === 6)
        || (c.chapter === 3 && STAGES[c.id])
        || (c.chapter === 4 && STAGES[c.id]);
      if (gated && wave !== c.state.stage) continue;
    }
    schedule(c, rec, now, { triggered: true });
  }
}

function runScripts(c, script, now) {
  const packets = [];
  for (const entry of arr(script)) {
    const kind = num(entry[0]);
    const arg = entry[1];
    if (kind === 3) {
      const zoneId = num(arg);
      if (!c.state.disabledZones.includes(zoneId)) c.state.disabledZones.push(zoneId);
    } else if (kind === 4) {
      packets.push(...removeObjects(c, arr(arg)));
    } else if (kind === 5) {
      if ([4, 6, 7, 8, 9].includes(c.chapter)) {
        stop(c, arr(arg));
        if (c.chapter === 6) {
          // A laser's stop command also retires the existing immortal actor.
          for (const entry of liveSpawned(c.state)) {
            const npc = entry.npc;
            if ((LASERS[6] || {})[num(npc.template)]
              && num(npc.info?.point) === num(arg)) {
              packets.push(...removeActorPackets(c, npc));
            }
          }
        }
      } else {
        stopPoints(c, arr(arg));
      }
    } else if (kind === 7) {
      triggerRecords(c, arg, now);
    }
  }
  return packets;
}

export function objectDestroyed(c, objectOrInstance, now = c.engine?.now || 0) {
  const instance = num(typeof objectOrInstance === 'object'
    ? objectOrInstance.instance ?? objectOrInstance.info?.instance
    : objectOrInstance);
  const definition = (c.map.npcs || []).find((npc) => num(npc.instance) === instance);
  if (!definition) return [];
  // PveEngine does not model static map objects; the caller reports the kill.
  c.state.objectKills.add(instance);
  return runScripts(c, definition.scripts || definition.pve_scripts || [], now);
}

// ----------------------------------------------------------- stage/objective
function setStage(c, wave, now) {
  const next = num(wave);
  const old = c.state.stage;
  c.state.stage = next;
  if (old && old !== next) {
    for (const rec of c.map.spawns || []) {
      if (num(rec.wave) === old && num(rec.repeat) < 0) {
        if (c.chapter === 4) stop(c, [rec.point]);
        else stopPoints(c, [rec.point]);
      }
    }
  }
  for (const rec of c.map.spawns || []) {
    if (num(rec.wave) === next && num(rec.delay) >= 0) schedule(c, rec, now);
  }
  const packets = [];
  for (const record of c.map.waves || []) {
    if (num(record.fields) === next) packets.push(...runScripts(c, record.scripts, now));
  }
  if (c.chapter === 5 || c.chapter === 6) {
    // A zone entered earlier still activates its future-stage records.
    for (const index of c.state.zoneDone) {
      const zone = c.map.zones?.[index];
      if (!zone) continue;
      if (c.chapter === 5 && c.state.disabledZones.includes(num(zone.fields?.[0]))) continue;
      packets.push(...runScripts(c, zone.scripts, now));
    }
  }
  return packets;
}

function completed(c, rec) {
  if (!rec) return true;
  if (c.state.stoppedRules.includes(num(rec.index))) return true;
  if (c.chapter === 5 && !c.state.activeRules.includes(num(rec.index))
    && num(rec.delay) < 0) {
    const references = (c.map.zones || []).filter((zone) => arr(zone.scripts)
      .some((script) => num(script[0]) === 7 && num(script[1]) === num(rec.point)));
    if (references.length && references.every((zone) =>
      c.state.disabledZones.includes(num(zone.fields?.[0])))) return true;
  }
  const expected = (rec.templates || [])
    .filter((tpl) => objectiveFor(c, rec, tpl)).length * (num(rec.repeat) + 1);
  return num(c.state.ruleKills[num(rec.index)], 0) >= expected;
}

function allCompleted(c) {
  return (c.map.spawns || []).every((rec) => completed(c, rec));
}

function livingHostiles(c) {
  return liveSpawned(c.state).filter((entry) => {
    const npc = entry.npc;
    if (npc.info?.pve_unscored) return false;
    if (num(npc.camp) === num(c.engine.player?.camp, 1)) return false;
    if ((DECOR[c.chapter] || []).includes(num(npc.template))) return false;
    return true;
  });
}

function pendingHostiles(c) {
  return c.state.spawns.filter((event) => {
    const rec = recordOf(c, event.rule);
    return rec && num(rec.camp) === 0 && objectiveFor(c, rec, event.template);
  });
}

function progressStages(c, now) {
  const id = c.id;
  if (c.chapter === 2) {
    const stages = STAGES[id];
    if (!stages) return;
    const enemies = liveSpawned(c.state).some((entry) => num(entry.npc.camp) === 0
      && !(DECOR[2] || []).includes(num(entry.npc.template)));
    if (!enemies && !pendingHostiles(c).length) {
      const wave = c.state.stage;
      if (wave < stages[stages.length - 1]) setStage(c, stages[stages.indexOf(wave) + 1], now);
      else if (id === 402) c.state.won = true;
    }
  } else if (c.chapter === 3) {
    const stages = STAGES[id];
    if (!stages) return;
    const enemies = liveSpawned(c.state).some((entry) =>
      !entry.npc.info?.pve_unscored && num(entry.npc.camp) !== num(c.engine.player?.camp, 1));
    const waiting = c.state.spawns.some((event) => {
      const rec = recordOf(c, event.rule);
      return rec && objectiveFor(c, rec, event.template);
    });
    if (!enemies && !waiting) {
      const wave = c.state.stage;
      if (id === 405 && wave === 2 && c.state.claimedGuns.length < 2) return;
      if (wave < stages[stages.length - 1]) setStage(c, stages[stages.indexOf(wave) + 1], now);
      else if (id === 404) c.state.won = true;
    }
  } else if (c.chapter === 4) {
    const stages = STAGES[id];
    if (stages && c.state.stage < stages[stages.length - 1]
      && (c.map.spawns || []).filter((rec) => num(rec.wave) === c.state.stage)
        .every((rec) => completed(c, rec))) {
      setStage(c, c.state.stage + 1, now);
    }
    if ([701, 703].includes(id) && c.state.stage === stages?.[stages.length - 1]
      && allCompleted(c)) c.state.won = true;
    else if (id === 702 && c.state.bossKills
      && !livingHostiles(c).length) c.state.won = true;
    else if (id === 305
      && FACTORIES_305.every((instance) => mapObjectDead(c, instance))
      && !liveSpawned(c.state).some((entry) => TANKS_305.includes(num(entry.npc.template)))) {
      c.state.won = true;
    }
  } else if (c.chapter === 5) {
    const count = STAGE_COUNT[id];
    if (count && c.state.stage < count
      && (c.map.spawns || []).filter((rec) => num(rec.wave) === c.state.stage)
        .every((rec) => completed(c, rec))) {
      setStage(c, c.state.stage + 1, now);
    }
    const allClear = allCompleted(c) && !livingHostiles(c).length;
    if ([501, 502].includes(id) && c.state.stage === count && allClear
      && (id === 501 || c.state.rescued.length === 6)) c.state.won = true;
    else if (id === 504 && allClear && c.state.alliesCalled && c.state.atExit) c.state.won = true;
    else if (id === 505 && allClear && mapObjectDead(c, FACTORY[505])
      && !liveSpawned(c.state).some((entry) => num(entry.npc.camp) === 0
        && !(DECOR[5] || []).includes(num(entry.npc.template)))) c.state.won = true;
    else if (id === 506 && c.state.stage === 1
      && new Set(c.state.switches).size === 3) setStage(c, 2, now);
  } else if (c.chapter === 6) {
    const count = STAGE_COUNT[id];
    if (count && c.state.stage < count
      && (c.map.spawns || []).filter((rec) => num(rec.wave) === c.state.stage)
        .every((rec) => completed(c, rec))) {
      setStage(c, c.state.stage + 1, now);
    }
    if (id === 601 && c.state.stage === 5 && c.state.rescued.length) c.state.won = true;
  } else if (c.chapter === 7) {
    if (id === 31301 && allCompleted(c)) c.state.won = true;
  }
}

// ------------------------------------------------------------- death handling
function resolveRecordForNpc(c, npc) {
  const rule = npc.info?.pve_rule;
  if (rule != null) return recordOf(c, rule);
  const point = num(npc.info?.point, npc.point);
  const tpl = num(npc.info?.npc_template, npc.template);
  return (c.map.spawns || []).find((rec) => num(rec.point) === point
    && (rec.templates || []).map(num).includes(tpl)) || null;
}

function maybeRespawn(c, npc, rec, now) {
  if (!rec) return;
  const rule = num(rec.index);
  if (!c.state.activeRules.includes(rule)) return;
  if (!npc.info?.pve_loop && num(npc.info?.pve_remaining) <= 0) return;
  c.state.spawns.push({
    rule, template: num(npc.info?.npc_template, npc.template),
    remaining: Math.max(0, num(npc.info?.pve_remaining) - 1),
    loop: Boolean(npc.info?.pve_loop),
    due: now + Math.max(1, num(rec.interval, 1)) * 1000,
  });
}

export function onNpcDeath(c, npc, now = c.engine?.now || 0) {
  if (!npc) return [];
  const tpl = num(npc.info?.npc_template, npc.template);
  const rec = resolveRecordForNpc(c, npc);
  if (c.chapter >= 7 && (npc.info?.pve_local_forklift || npc.info?.pve_fortification
    || npc.info?.pve_boss_add)) return [];
  if (npc.info?.pve_fortification) return [];
  // Chapter 8/9 support/escort deaths are not life-loss or objective events.
  if (c.chapter >= 8) {
    if (tpl === 3160203) return [];
    if (tpl === 3140212) {
      if (rec) c.state.spawns.push({ rule: num(rec.index), template: tpl, remaining: 0,
        loop: false, due: now + 5000 });
      return [];
    }
  }
  const decor = DECOR[c.chapter] || [];
  if (!decor.includes(tpl)) {
    c.state.statKills = num(c.state.statKills) + 1;
    if (rec) c.state.ruleKills[num(rec.index)] = num(c.state.ruleKills[num(rec.index)]) + 1;
  } else if (rec) {
    c.state.ruleKills[num(rec.index)] = num(c.state.ruleKills[num(rec.index)]) + 1;
  }
  if (npc.info?.pve_boss_add) return [];

  if (c.chapter === 6 && c.id === 601 && tpl === 716 && rec) {
    stop(c, [num(rec.point) === 69 ? 56 : 53]);
  }
  maybeRespawn(c, npc, rec, now);

  const bossTemplate = MAP_BOSSES[c.id] != null ? num(MAP_BOSSES[c.id]) : null;
  if (bossTemplate != null && tpl === bossTemplate) {
    c.state.bossKills = num(c.state.bossKills) + 1;
    if (c.chapter === 2) {
      if (c.id !== 212 && c.state.bossKills >= (c.id === 213 ? 2 : 1)) {
        c.state.spawns = []; c.state.activeRules = []; c.state.won = true;
      }
    } else if (c.chapter === 4) {
      if ([304, 306].includes(c.id)) c.state.won = true;
      else if (c.id === 702) { c.state.spawns = []; c.state.activeRules = []; }
    } else if (c.chapter === 5) {
      c.state.won = true;
    } else if (c.chapter === 6) {
      if (c.id === 602) setStage(c, 3, now);
      if (tpl === 3110312) dookuInterrupt(npc, now);
      c.state.won = true;
    } else if (c.chapter === 7) {
      if (tpl === 3120209 && c.localMechanics) forkliftDefeated(c, npc, now);
      else c.state.won = true;
    } else if (c.chapter >= 8) {
      // Boss-owned guard adds despawn without death/reward side effects.
      for (const entry of liveSpawned(c.state)) {
        if (entry.npc.info?.pve_boss_add === npc.id) {
          entry.npc.info.in_room = false;
          entry.npc.hp = D(0);
        }
      }
      c.state.won = true;
    }
  }

  if (c.chapter === 3) {
    const goals = GOALS[c.id];
    if (goals && goals[tpl] != null && !npc.info?.pve_loop) {
      c.state.goalKills[tpl] = num(c.state.goalKills[tpl]) + 1;
      if (Object.entries(goals).every(([goal, count]) =>
        num(c.state.goalKills[goal]) >= num(count))) {
        c.state.spawns = []; c.state.activeRules = []; c.state.won = true;
      }
    }
  }
  return [];
}

// ----------------------------------------------------------- mechanisms/ticks
function playerPos(c, now) {
  return posOf(c.engine.player, now);
}

function fireFixed(c, npc, offset, now) {
  const pos = posOf(npc, now);
  const dest = [pos[0] + offset[0], pos[1] + offset[1]];
  if (typeof npc.fireProjectile === 'function') {
    return arr(npc.fireProjectile({ dest, template: npc.shotSkill }, now));
  }
  const skill = num(npc.shotSkill ?? npc.skill ?? npc.info?.shot_skill);
  if (skill && typeof npc.shoot === 'function') {
    const raw = typeof npc.combatStat === 'function' ? npc.combatStat('iAttack', now) : D(1);
    return arr(npc.shoot(skill, pos, dest, now, raw, { school: 'physical', basic: true }));
  }
  return [];
}

function removeActorPackets(c, npc) {
  if (!npc) return [];
  if (typeof npc.hp === 'object' && typeof npc.hp.isZero === 'function') npc.hp = D(0);
  else npc.hp = 0;
  if (npc.info) { npc.info.hp = 0; npc.info.in_room = false; }
  npc.motion = null;
  return [scenePacket({ removedObjects: [npc.id] })];
}

function rescueNear(c, templates, now, useRule) {
  if (!isPlayerPresent(c.engine)) return [];
  const packets = [];
  const pos = playerPos(c, now);
  for (const entry of liveSpawned(c.state)) {
    const npc = entry.npc;
    if (!templates.includes(num(npc.template))) continue;
    if (distance(pos, posOf(npc, now)) > 72) continue;
    const id = useRule ? num(npc.info?.pve_rule) : npc.id;
    c.state.rescued.push(id);
    packets.push(...removeActorPackets(c, npc));
  }
  return packets;
}

function turretTick(c, now) {
  const packets = [];
  const lasers = LASERS[c.chapter] || {};
  for (const entry of liveSpawned(c.state)) {
    const npc = entry.npc;
    const tpl = num(npc.template);
    if (!lasers[tpl]) continue;
    const next = num(npc.turretNextShotAt ?? npc.turret_next_shot_at);
    if (now < next) continue;
    const interval = c.chapter === 4 && tpl === 2612 ? 500 : 5000;
    npc.turretNextShotAt = now + interval;
    npc.turret_next_shot_at = npc.turretNextShotAt;
    packets.push(...fireFixed(c, npc, lasers[tpl], now));
  }
  return packets;
}

function laserBurstTick(c, now) {
  // Chapters 5-9 lasers: pve_count shots, pve_break apart, then interval pause.
  const packets = [];
  const lasers = LASERS[c.chapter] || {};
  for (const entry of liveSpawned(c.state)) {
    const npc = entry.npc;
    const tpl = num(npc.template);
    if (!lasers[tpl]) continue;
    const next = num(npc.turretNextShotAt ?? npc.turret_next_shot_at);
    if (now < next) continue;
    const count = Math.max(1, num(npc.pveCount ?? npc.pve_count ?? npc.fireCount, 1));
    const brk = Math.max(0, num(npc.pveBreak ?? npc.pve_break, num(npc.fireBreak, 0)));
    const interval = c.chapter === 5 ? 4400
      : (typeof npc.fireInterval === 'function'
        ? Math.max(1, num(npc.fireInterval(now), 1000))
        : Math.max(1, num(npc.fireInterval, 1000)));
    npc.turretNextShotAt = now + (count - 1) * brk + interval;
    npc.turret_next_shot_at = npc.turretNextShotAt;
    const pos = posOf(npc, now);
    const dest = [pos[0] + lasers[tpl][0], pos[1] + lasers[tpl][1]];
    packets.push(...fireFixed(c, npc, lasers[tpl], now));
    for (let n = 1; n < count; n += 1) {
      c.state.queuedShots.push({ due: now + n * brk, npc, dest });
    }
  }
  return packets;
}

function queuedShotTick(c, now) {
  const packets = [];
  const rest = [];
  for (const shot of c.state.queuedShots) {
    if (now >= shot.due) packets.push(...fireFixed(c, shot.npc, [
      shot.dest[0] - posOf(shot.npc, now)[0], shot.dest[1] - posOf(shot.npc, now)[1],
    ], now));
    else rest.push(shot);
  }
  c.state.queuedShots = rest;
  return packets;
}

function chapterMechanisms(c, now) {
  const packets = [];
  const id = c.id;
  if (c.chapter === 2) {
    packets.push(...rescueNear(c, [409], now, true));
    packets.push(...turretTick(c, now));
    if (isPlayerPresent(c.engine)) {
      const pos = playerPos(c, now);
      for (const [point, door] of Object.entries(SWITCHES[id] || {})) {
        const rec = (c.map.spawns || []).find((record) => num(record.point) === num(point)
          && (record.templates || []).map(num).includes(416));
        if (!rec || c.state.openDoors.includes(num(door))) continue;
        if (distance(pos, rec.position) > switchRadius(id, num(point))) continue;
        c.state.openDoors.push(num(door));
        for (const entry of liveSpawned(c.state)) {
          if ([414, 415].includes(num(entry.npc.template))
            && num(entry.npc.info?.point) === num(door)) {
            packets.push(...removeActorPackets(c, entry.npc));
          }
        }
        c.state.spawns = c.state.spawns.filter((event) => {
          if (![414, 415].includes(num(event.template))) return true;
          const record = recordOf(c, event.rule);
          return !record || num(record.point) !== num(door);
        });
      }
    }
  } else if (c.chapter === 3) {
    packets.push(...rescueNear(c, [1409, 353], now, true));
    packets.push(...turretTick(c, now));
    if (isPlayerPresent(c.engine)) {
      const pos = playerPos(c, now);
      if (id === 405 && c.state.stage === 2) {
        for (const point of [14, 15]) {
          const rec = (c.map.spawns || []).find((record) => num(record.point) === point
            && (record.templates || []).map(num).includes(1432));
          if (!rec || c.state.claimedGuns.includes(point)) continue;
          if (distance(pos, rec.position) > 100) continue;
          const enemyRules = new Set((c.map.spawns || [])
            .filter((record) => num(record.point) === point
              && (record.templates || []).map(num).includes(1427))
            .map((record) => num(record.index)));
          const pending = c.state.spawns.some((event) => enemyRules.has(event.rule));
          const living = liveSpawned(c.state).some((entry) => enemyRules.has(num(entry.npc.info?.pve_rule)));
          if (pending || living) continue;
          c.state.claimedGuns.push(point);
          schedule(c, rec, now, { triggered: true });
        }
      }
      if (id === 406 && !c.state.openDoors.includes(48)) {
        const rec = (c.map.spawns || []).find((record) =>
          (record.templates || []).map(num).includes(1416));
        if (rec && distance(pos, rec.position) <= 96) {
          c.state.openDoors.push(48);
          for (const entry of liveSpawned(c.state)) {
            if (num(entry.npc.template) === 1414) packets.push(...removeActorPackets(c, entry.npc));
          }
          c.state.spawns = c.state.spawns.filter((event) => num(event.template) !== 1414);
        }
      }
    }
  } else if (c.chapter === 4) {
    if (id === 703 && isPlayerPresent(c.engine) && !c.state.laserDisabled
      && distance(playerPos(c, now), [540, 2820]) <= 96) {
      c.state.laserDisabled = true;
      stop(c, [145, 146]);
      for (const entry of liveSpawned(c.state)) {
        if ([2612, 2613].includes(num(entry.npc.template))) {
          packets.push(...removeActorPackets(c, entry.npc));
        }
      }
    }
    packets.push(...rescueNear(c, [1353], now, true));
    packets.push(...turretTick(c, now));
  } else if (c.chapter === 5) {
    packets.push(...rescueNear(c, [522], now, true));
    packets.push(...laserBurstTick(c, now));
    packets.push(...transportEmitters(c, now));
  } else if (c.chapter === 6) {
    packets.push(...rescueNear(c, [717], now, false));
    packets.push(...laserBurstTick(c, now));
  } else if (c.chapter === 7) {
    packets.push(...forkliftTick(c, now));
    packets.push(...laserBurstTick(c, now));
  } else if (c.chapter >= 8) {
    if (c.id === 31403) packets.push(...fortificationTick(c, now));
    packets.push(...transportEmitters(c, now));
    for (const entry of liveSpawned(c.state)) {
      if (num(entry.npc.template) === 3160211 && typeof entry.npc._buff === 'function'
        && num(entry.npc.buffVersions?.get?.(15101)) === 0) {
        entry.npc._buff(15101, now);
      }
    }
    packets.push(...laserBurstTick(c, now));
  }
  packets.push(...queuedShotTick(c, now));
  return packets;
}

// ---------------------------------------------------------------- zone entry
function zoneFields(c, zone) {
  const fields = [...(zone.fields || [])];
  if (c.id === 30101 && num(fields[0]) === 1) {
    fields[1] -= 24; fields[3] += 24;
  } else if (c.id === 30101 && num(fields[0]) === 6) {
    fields[3] += 144;
  }
  return fields;
}

function zoneTick(c, now) {
  if (!isPlayerPresent(c.engine)) return [];
  const packets = [];
  const pos = playerPos(c, now);
  for (const [index, zone] of (c.map.zones || []).entries()) {
    const zoneId = num(zone.fields?.[0]);
    if (c.chapter === 5 && c.state.disabledZones.includes(zoneId)) continue;
    if (c.state.zoneDone.includes(index)) continue;
    if (!inside(pos, zoneFields(c, zone))) continue;
    c.state.zoneDone.push(index);
    if (c.chapter === 2 && c.state.stage === 0 && zoneId === { 211: 6, 212: 1, 213: 3 }[c.id]) {
      packets.push(...setStage(c, 1, now));
    }
    packets.push(...runScripts(c, zone.scripts, now));
    if (c.chapter === 5 && c.id === 506) c.state.switches.push(zoneId);
  }
  if (c.chapter === 5 && c.id === 504) {
    c.state.atExit = inside(pos, [0, 2030, 380, 80, 60]);
  }
  return packets;
}

// ----------------------------------------------------------------- crossings
function crossing(c, now, ends = CROSSINGS[c.id]) {
  if (!ends || !isPlayerPresent(c.engine)) return [];
  const player = c.engine.player;
  const pos = playerPos(c, now);
  if (ends.every((end) => distance(pos, end) > 24)) c.state.crossingLatched = false;
  if (c.state.crossingLatched) return [];
  if (player.blocked?.('move', now)) return [];
  const geometry = c.engine.arena?.geometry;
  const water = c.engine.arena?.waterRects?.(now) || [];
  for (let index = 0; index < ends.length; index += 1) {
    const start = ends[index], dest = ends[1 - index];
    if (distance(pos, start) > 24) continue;
    if (geometry?.wallContact && geometry.wallContact(pos, start) !== null) continue;
    const blocked = (geometry?.wallContact && geometry.wallContact(dest, dest, 35.999) !== null)
      || (geometry?.canWalkTo && !geometry.canWalkTo(dest))
      || rectContact(pos, dest, water, 35.999) !== null
      || [...c.engine.arena.actors.values()].some((actor) => actor !== player
        && isAlive(actor) && !actor.info?.map_object
        && !actor.isUntargetable?.() && distance(posOf(actor, now), dest) < 72);
    if (blocked) continue;
    player.position = [...dest];
    player.motion = null;
    player.motionKind = 0;
    c.state.crossingLatched = true;
    return [];
  }
  return [];
}

// ------------------------------------------------------------------- hazards
function hazardGroups(c) {
  if (!c.localBombPuzzles) return [];
  return PUZZLES[c.id] || [];
}

function hazardActivationRadius(c, hazard) {
  if (c.id === 302 && num(hazard.template) === 800 && num(hazard.source) === 20
    && hazard.position?.[0] === 804 && hazard.position?.[1] === 1332
    && hazardGroups(c).some((group) => num(group[0]) === 20
      && group[1][0] === 804 && group[1][1] === 1332)) return 144;
  return HAZARD_RADIUS.bombActivation;
}

function hazardContacts(c, rec, radius, now) {
  const result = [];
  for (const actor of c.engine.arena?.actors?.values?.() || []) {
    if (!isAlive(actor) || actor.info?.pve_hostage) continue;
    if ([600, 700].includes(rec.template)
      && (num(actor.camp) === num(rec.camp) || actor.info?.map_object)) continue;
    const dest = posOf(actor, now);
    if (distance(rec.position, dest) > radius) continue;
    if (typeof actor.isAreaTargetable === 'function' && !actor.isAreaTargetable()) continue;
    const ignore = actor.map_rect ? [actor.map_rect] : [];
    const geometry = c.engine.arena?.geometry;
    if (geometry?.wallContact && geometry.wallContact(rec.position, dest, 0, { exclude: ignore }) !== null) continue;
    if (rectContact(rec.position, dest, c.engine.arena?.waterRects?.(now) || []) !== null) continue;
    result.push(actor);
  }
  return result;
}

function detonate(c, hazard, now) {
  if (hazard.template !== 800) return [];
  const packets = [];
  const group = hazardGroups(c).find((entry) => num(entry[0]) === num(hazard.source)
    && entry[1][0] === hazard.position[0] && entry[1][1] === hazard.position[1]);
  if (!group) return [];
  for (const instance of group[2]) {
    packets.push(...removeObjects(c, [instance]));
    const object = { instance, id: mapObjectId(instance) };
    packets.push(...objectDestroyed(c, object, now));
  }
  return packets;
}

export function initHazards(c) {
  if (![2, 3, 4].includes(c.chapter)) return;
  const templates = c.chapter === 2 ? [700, 800] : [600, 700, 800];
  c.state.hazards = (c.map.hazards || []).filter((hazard) =>
    templates.includes(num(hazard.template))).map((hazard) => ({
    source: num(hazard.id), template: num(hazard.template), camp: num(hazard.camp),
    position: [...hazard.position], active: false, done: false, end: 0,
  }));
}

export function tickHazards(c, now) {
  const packets = [];
  for (const rec of c.state.hazards) {
    if (rec.done) continue;
    const mine = rec.template === 700;
    const airstrike = rec.template === 600;
    if (!rec.active) {
      const trigger = (mine || airstrike)
        ? hazardContacts(c, rec, HAZARD_RADIUS.trigger, now).length > 0
        : isPlayerPresent(c.engine)
          && distance(playerPos(c, now), rec.position) <= hazardActivationRadius(c, rec);
      if (!trigger) continue;
      rec.active = true;
      rec.end = now + (mine ? 1200 : airstrike ? 2000 : 5000);
    }
    if (now < rec.end) continue;
    rec.done = true;
    const victims = hazardContacts(c, rec, mine ? HAZARD_RADIUS.mine
      : airstrike ? HAZARD_RADIUS.airstrike : HAZARD_RADIUS.bomb, now);
    if (rec.template === 800) packets.push(...detonate(c, rec, now));
    for (const actor of victims) {
      const raw = mine ? num(actor.maxHp) * 0.25
        : airstrike ? num(actor.maxHp) * 0.4
          : 1000 + num(actor.maxHp) * 0.55;
      if (typeof actor.damage === 'function') {
        packets.push(...arr(actor.damage(D(raw), now, {
          target: actor, school: 'true', basic: true,
        })[0]));
      }
    }
  }
  return packets;
}

// -------------------------------------------------------------- escorts/local
function escortTick(c, now) {
  const packets = [];
  for (const entry of liveSpawned(c.state)) {
    const npc = entry.npc;
    const tpl = num(npc.template);
    if (!ESCORTS.includes(tpl)) continue;
    const point = num(npc.info?.point);
    const end = ESCORT_ENDS[key(c.id, point)];
    if (!end) continue;
    if (tpl === 3140212 && (!isPlayerPresent(c.engine)
      || distance(playerPos(c, now), posOf(npc, now)) > 200)) continue;
    if (distance(posOf(npc, now), end) > 24) continue;
    if (!c.state.escortDone.includes(point)) {
      c.state.escortDone.push(point);
      if (tpl === 3140212) packets.push(...removeActorPackets(c, npc));
    }
  }
  const needed = c.id === 31402 ? 2 : 0;
  if (needed && c.state.escortDone.length >= needed && c.state.deferredBoss.length) {
    const waiting = c.state.deferredBoss;
    c.state.deferredBoss = [];
    for (const index of waiting) schedule(c, recordOf(c, index), now);
  }
  return packets;
}

function spawnExitPosition(c, rec, template, now) {
  if (!c.localMechanics) return null;
  const rule = SPAWN_EXITS[key(c.id, num(rec.point))];
  if (!rule || num(rec.map) !== c.id || num(rec.wave) !== rule.wave
    || num(rec.repeat) !== rule.repeat || num(rec.camp) !== 0) return null;
  if (distance(rec.position, rule.origin) !== 0) return null;
  const birth = rule.births[template];
  if (!birth) return null;
  const geometry = c.engine.arena?.geometry;
  if (geometry?.canWalkTo && geometry.canWalkTo(rec.position)) return null;
  return birth;
}

function factoryExitPosition(c, rec, template, now) {
  if (c.id === 505) {
    if (!c.localMechanics || num(rec.point) !== 901
      || template !== 555 && template !== 556) return null;
    if (distance(rec.position, FACTORY_505.source) !== 0) return null;
    if (!mapObjectAlive(c.engine, FACTORY_505.factory)) return null;
    const geometry = c.engine.arena?.geometry;
    if (geometry?.canWalkTo && geometry.canWalkTo(FACTORY_505.source)) return null;
    return FACTORY_505.outlet;
  }
  const exit = FACTORY_EXITS[key(c.id, num(rec.point))];
  if (!exit) return null;
  const factory = c.engine.arena?.actors?.get?.(mapObjectId(exit[0]));
  if (factory && isAlive(factory)) {
    const geometry = c.engine.arena?.geometry;
    if (!geometry?.canWalkTo || !geometry.canWalkTo(rec.position)) return [exit[1], exit[2]];
  }
  return null;
}

// ------------------------------------------------------------- local fork/lift
function forkliftDefeated(c, npc, now) {
  c.state.localForklift = {
    phase: 'capture', spawn: posOf(npc, now), vehicle: null,
    capture: null, clear: null, nextTickAt: now,
  };
  return [];
}

function freePosition(c, center, now) {
  const arena = c.engine.arena;
  const occupied = [...(arena?.actors?.values?.() || [])]
    .filter((actor) => isAlive(actor) && !actor.info?.map_object)
    .map((actor) => posOf(actor, now));
  const geometry = arena?.geometry;
  const water = arena?.waterRects?.(now) || [];
  for (let radius = 0; radius <= 144; radius += 24) {
    for (let dx = -radius; dx <= radius; dx += 24) {
      for (let dy = -radius; dy <= radius; dy += 24) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const pos = [Math.round(center[0] + dx), Math.round(center[1] + dy)];
        if (geometry?.clampTankPosition
          && distance(geometry.clampTankPosition(pos), pos) > 0.01) continue;
        if (geometry?.canWalkTo && !geometry.canWalkTo(pos)) continue;
        if (geometry?.wallContact && geometry.wallContact(pos, pos, 35.999) !== null) continue;
        if (rectContact(pos, pos, water, 35.999) !== null) continue;
        if (occupied.some((other) => distance(pos, other) < 72)) continue;
        return pos;
      }
    }
  }
  return null;
}

function spawnLocalVehicle(c, now) {
  const state = c.state.localForklift;
  if (!state || state.vehicle != null || now < state.nextTickAt) return [];
  state.nextTickAt = now + 250;
  const pos = freePosition(c, state.spawn, now);
  if (!pos) return [];
  const result = spawnAt(c, { point: 602, position: pos, camp: 1, index: -1 }, 3120209, now, {
    camp: 1, position: pos,
    info: { point: 602, npc_template: 3120209, pve_rule: -1, pve_loop: false,
      pve_remaining: 0, pve_local_forklift: true, pve_hostage: true },
  });
  if (result.npc) {
    result.npc.info.pve_local_forklift = true;
    result.npc.info.pve_hostage = true;
    state.vehicle = result.npc.id;
  }
  return result.packets;
}

export function forkliftTick(c, now) {
  if (!c.localMechanics || c.id !== FORKLIFT.MAP || c.state.won) return [];
  const state = c.state.localForklift;
  if (!state || state.phase === 'boss') return [];
  const packets = spawnLocalVehicle(c, now);
  const vehicle = c.engine.arena?.actors?.get?.(state.vehicle);
  if (!vehicle) return packets;
  const player = c.engine.player;
  const pos = playerPos(c, now);
  if (state.phase === 'capture') {
    if (!isPlayerPresent(c.engine) || distance(pos, posOf(vehicle, now)) > FORKLIFT.CAPTURE_RADIUS) {
      state.capture = null; return packets;
    }
    if (!state.capture || state.capture.owner !== player.id) {
      state.capture = { owner: player.id, generation: player.generation, end: now + FORKLIFT.CAPTURE_MS };
      return packets;
    }
    if (now >= state.capture.end) { state.phase = 'driving'; state.capture = null; }
    return packets;
  }
  if (state.phase === 'exit') {
    if (isPlayerPresent(c.engine) && inside(pos, [0, ...FORKLIFT.EXIT])) c.state.won = true;
    return packets;
  }
  const guide = isPlayerPresent(c.engine) && distance(pos, posOf(vehicle, now)) <= 600;
  if (!guide) { state.clear = null; state.phase = 'driving'; return packets; }
  if (distance(posOf(vehicle, now), FORKLIFT.GOAL) > 36) {
    // Local rule: the vehicle follows the authored straight approach.
    vehicle.position = [...FORKLIFT.GOAL];
    vehicle.motion = null;
    state.phase = 'driving'; state.clear = null;
    return packets;
  }
  if (distance(pos, posOf(vehicle, now)) > FORKLIFT.CLEAR_RADIUS) {
    state.clear = null; state.phase = 'driving'; return packets;
  }
  if (state.phase !== 'clearing') state.phase = 'clearing';
  if (!state.clear || state.clear.owner !== player.id) {
    state.clear = { owner: player.id, generation: player.generation, end: now + FORKLIFT.CLEAR_MS };
    return packets;
  }
  if (now >= state.clear.end) {
    state.phase = 'exit'; state.clear = null;
    for (const instance of FORKLIFT.GATE_IDS) packets.push(...removeObjects(c, [instance]));
  }
  return packets;
}

function fortificationTick(c, now) {
  if (!c.localMechanics || c.id !== 31403 || !isPlayerPresent(c.engine)) return [];
  if (!c.state.localFortifications) {
    c.state.localFortifications = { choices: {}, pending: null };
  }
  const state = c.state.localFortifications;
  const player = c.engine.player;
  const pos = playerPos(c, now);
  for (const [index, row] of FORT_ROWS.entries()) {
    if (state.choices[index] != null) continue;
    const [y, templates] = row;
    for (const side of [0, 1]) {
      const front = side === 0 ? (pos[0] >= 480 && pos[0] <= 550) : (pos[0] >= 950 && pos[0] <= 1020);
      if (!front || Math.abs(pos[1] - y) > 64) continue;
      const pending = state.pending;
      if (!pending || pending.row !== index || pending.side !== side || pending.owner !== player.id) {
        state.pending = { row: index, side, owner: player.id, generation: player.generation,
          end: now + FORT_HOLD_MS };
        return [];
      }
      if (now < pending.end) return [];
      const spawn = freePosition(c, [side === 0 ? 600 : 900, y], now);
      if (!spawn) return [];
      const template = templates[side];
      const result = spawnAt(c, { point: 910 + index, position: spawn, camp: 1, index: -1 },
        template, now, { camp: 1, position: spawn,
          info: { point: 910 + index, npc_template: template, pve_rule: -1,
            pve_loop: false, pve_remaining: 0, pve_fortification: true } });
      if (!result.npc) return result.packets;
      state.choices[index] = { side, template, actor: result.npc.id };
      state.pending = null;
      return result.packets;
    }
  }
  return [];
}

// ------------------------------------------------------ transport emitters
function transportEmitter(c, now) {
  const packets = [];
  for (const entry of liveSpawned(c.state)) {
    const npc = entry.npc;
    const spec = TRANSPORT_SOURCES[key(c.id, num(npc.info?.point))];
    if (!spec || num(npc.template) !== spec[0] || !npc.info?.pve_trap) continue;
    if (!c.localMechanics) continue;
    if (npc.turretNextShotAt == null) {
      npc.turretNextShotAt = now + Math.max(1, num(npc.stats?.iFireInterv, 1000));
      continue;
    }
    if (now < npc.turretNextShotAt) continue;
    npc.turretNextShotAt = now + Math.max(1, num(npc.stats?.iFireInterv, 1000));
    const direction = TRANSPORT_DIRECTIONS[spec[0]] || [0, 0];
    const dest = [spec[1][0] + direction[0] * 600, spec[1][1] + direction[1] * 600];
    const pos = posOf(npc, now);
    packets.push(...fireFixed(c, npc, [dest[0] - pos[0], dest[1] - pos[1]], now));
    // Bounded local pull (pve_transport_traps._pull): only the authored
    // bearing, a safe landing with a real exit, and a per-target latch.
    const landing = TRANSPORT_LANDINGS[key(c.id, num(npc.info?.point))] || spec[1];
    for (const target of c.engine.arena?.actors?.values?.() || []) {
      if (target === npc || target === undefined || !isAlive(target)
        || target.info?.npc_template || num(target.camp) === num(npc.camp)) continue;
      const latchKey = `${npc.id}:${target.id}`;
      if (now < num(c.state.transportLatches.get(latchKey))) continue;
      const point = posOf(target, now);
      const dx = point[0] - spec[1][0], dy = point[1] - spec[1][1];
      const along = dx * direction[0] + dy * direction[1];
      const across = Math.abs(dx * direction[1] - dy * direction[0]);
      if (along < 0 || along > 636 || across > 36) continue;
      const geometry = c.engine.arena?.geometry;
      const water = c.engine.arena?.waterRects?.(now) || [];
      if (geometry?.clampTankPosition && distance(geometry.clampTankPosition(landing), landing) > 0.01) continue;
      if (geometry?.canWalkTo && !geometry.canWalkTo(landing)) continue;
      if (geometry?.wallContact && geometry.wallContact(landing, landing, 35.999) !== null) continue;
      if (rectContact(landing, landing, water, 35.999) !== null) continue;
      if ([...c.engine.arena.actors.values()].some((other) => other !== target && other !== npc
        && isAlive(other) && !other.info?.map_object
        && distance(posOf(other, now), landing) < 72)) continue;
      target.position = [...landing];
      target.motion = null;
      target.motionKind = 0;
      c.state.transportLatches.set(latchKey, now + 3000);
    }
  }
  return packets;
}

function transportEmitters(c, now) {
  if (![5, 8, 9].includes(c.chapter)) return [];
  return transportEmitter(c, now);
}

// --------------------------------------------------------- boss tactics (v2)
const BOSS_V2_MEMORY_MS = 1600;
const BOSS_V2_ORBIT_MS = 4000;
const BOSS_V2_NOTICE = 600;
const SPLASH = { 1000004: 144, 1000010: 108, 1000017: 108, 1000030: 216 };

export function bossV2State(actor, brain, now) {
  let state = brain.bossTacticsV2;
  if (!state || state.generation !== actor.generation) {
    state = {
      version: 1, generation: actor.generation, phase: 1, noticedAt: 0,
      nextTickAt: 0, end: 0, observedAt: 0, phaseEnd: now + BOSS_V2_ORBIT_MS,
      side: actor.id % 2 ? 1 : -1, target: null, targetGeneration: null,
    };
    brain.bossTacticsV2 = state;
    brain.path = []; brain.repathAt = 0; brain.goal = posOf(actor, now);
    brain.patrolling = false;
  }
  const ratio = hpRatio(actor);
  const phase = ratio <= 0.35 ? 3 : ratio <= 0.70 ? 2 : 1;
  if (phase > state.phase) { state.phase = phase; state.nextTickAt = now; }
  if (now >= state.phaseEnd) {
    const turns = 1 + Math.floor((now - state.phaseEnd) / BOSS_V2_ORBIT_MS);
    if (turns % 2) state.side = -state.side;
    state.phaseEnd += turns * BOSS_V2_ORBIT_MS;
  }
  return state;
}

function bossV2Target(actor, state, now, world) {
  const pos = posOf(actor, now);
  const visible = [...(world.actors || [])].filter((other) => other !== actor
    && other.alive !== false && !other.mapObject && !other.hostage
    && distance(pos, posOf(other, now)) <= BOSS_V2_NOTICE
    && observable(world, actor, other, now, BOSS_V2_NOTICE));
  if (!visible.length) return null;
  visible.sort((a, b) => distance(pos, posOf(a, now)) - distance(pos, posOf(b, now))
    || num(a.id) - num(b.id));
  const points = new Map(visible.map((other) => [other.id, posOf(other, now)]));
  const radius = SPLASH[Number(actor.skill || actor.shotSkill || 0)] || 0;
  const score = (target) => {
    const point = points.get(target.id);
    const gap = distance(pos, point);
    const blocked = weaponLine(world, actor, pos, point, now) ? 0 : 900;
    const outOfRange = gap > num(actor.fireRange) ? 180 : 0;
    const group = radius ? visible.filter((other) => other !== target
      && distance(point, points.get(other.id)) <= radius
      && weaponLine(world, actor, point, points.get(other.id), now)).length : 0;
    return blocked + outOfRange + gap + (target.template ? 48 : 0) - Math.min(3, group) * 56;
  };
  const selected = visible.reduce((best, target) =>
    (score(target) < score(best) || (score(target) === score(best) && target.id < best.id)
      ? target : best), visible[0]);
  const current = visible.find((target) => target.id === state.target
    && target.generation === state.targetGeneration);
  return current && score(current) <= score(selected) + 72 ? current : selected;
}

function leadPoint(actor, target, now, limit, horizon) {
  const point = posOf(target, now);
  const motion = target.motion;
  if (!limit || !motion || motion[3] <= now || motion[3] <= motion[2]) return point;
  const [start, end, began, finish] = motion;
  let dx = (end[0] - start[0]) * horizon / Math.max(1, finish - began);
  let dy = (end[1] - start[1]) * horizon / Math.max(1, finish - began);
  const length = Math.hypot(dx, dy);
  if (length > limit) { dx *= limit / length; dy *= limit / length; }
  const wish = [Math.round(point[0] + dx), Math.round(point[1] + dy)];
  const clamped = actor.arena?.geometry?.clampTankPosition?.(wish) || wish;
  return actor.arena?.geometry?.walkEnd
    ? actor.arena.geometry.walkEnd(point, clamped, actor.arena.waterRects?.(now) || [])
    : clamped;
}

export function bossV2Goal(actor, target, now, world, archetype, state) {
  const radius = num(actor.fireRange);
  const phase = state.phase;
  const point = posOf(target, now);
  if (archetype === 'siege') return posOf(actor, now);
  if (archetype === 'hunter') {
    const intercept = leadPoint(actor, target, now, [0, 48, 72][phase - 1], 240);
    return chooseGoal(world, actor, intercept, now, {
      preferredRange: Math.max(48, radius * [0.68, 0.60, 0.52][phase - 1]),
    });
  }
  if (archetype === 'air') {
    return chooseAirGoal(world, actor, point, now, {
      preferredRange: radius * [0.80, 0.68, 0.56][phase - 1],
      strafe: true, strafeSide: state.side,
    });
  }
  const factors = archetype === 'heavy' ? [0.78, 0.70, 0.60] : [0.76, 0.64, 0.52];
  const cooldown = num(actor.cooldowns?.[0]);
  return chooseGoal(world, actor, point, now, {
    preferredRange: Math.max(120, radius * factors[phase - 1]),
    strafe: archetype !== 'heavy' || cooldown > now + 200,
    strafeSide: state.side,
  });
}

export function bossTacticsV2Tick(actor, brain, world, now, { enabled = true } = {}) {
  const archetype = bossArchetype(world?.map?.id, actor.template);
  if (!enabled || !archetype) return null;
  if (world.finished || actor.alive === false) return [];
  const state = bossV2State(actor, brain, now);
  const packets = [];
  if (now >= state.noticedAt) {
    state.noticedAt = now + 200;
    brain.noticeAt = state.noticedAt;
    const target = bossV2Target(actor, state, now, world);
    const boundary = !(actor.motion && actor.motion[3] > now);
    if (target) {
      const changed = state.target !== target.id
        || state.targetGeneration !== target.generation;
      state.target = target.id; state.targetGeneration = target.generation;
      state.position = posOf(target, now); state.observedAt = now;
      state.end = now + BOSS_V2_MEMORY_MS;
      if (boundary && (changed || now >= state.nextTickAt)) {
        brain.goal = bossV2Goal(actor, target, now, world, archetype, state);
        state.nextTickAt = now + 600;
      }
      const pos = posOf(actor, now);
      if (distance(pos, state.position) <= num(actor.fireRange)
        && weaponLine(world, actor, pos, state.position, now)
        && typeof actor.cast === 'function') {
        packets.push(...arr(actor.cast(0, pos, state.position, target.id, now)));
      }
    } else {
      brain.goal = archetype === 'air'
        ? patrolGoal(world, actor, now, { airArrival: 24 })
        : patrolGoal(world, actor, now);
    }
  }
  return packets;
}

// --------------------------------------------------------- boss tactics (v1)
export function bossV1Enabled(actor, { version = null, mapSha = null, sourceSha = null } = {}) {
  const id = num(actor?.arena?.geometry?.id);
  const template = num(actor?.info?.npc_template, actor?.template);
  if (num(version) !== 1 || BOSS_V1.MAPS[id] !== template) return false;
  return !sourceSha || !mapSha || sourceSha === mapSha;
}

export function bossV1Phase(actor) {
  const ratio = num(actor.hp) / Math.max(1, num(actor.maxHp));
  return ratio <= 0.35 ? 3 : ratio <= 0.70 ? 2 : 1;
}

export function bossV1State(actor, now) {
  let state = actor.pveBossTactics;
  if (!state || state.generation !== actor.generation) {
    state = {
      version: 1, generation: actor.generation, phase: 1, remaining: 0,
      waveCursors: { 1: 0, 2: 0, 3: 0 }, nextTickAt: now + 1200,
      phaseEnd: now, phaseGap: now, waveDueAt: now, observedAt: now,
      lastTargetPos: null, cyclePhase: 1,
    };
    actor.pveBossTactics = state;
  }
  state.phase = Math.max(state.phase, bossV1Phase(actor));
  return state;
}

export function bossV1Tick(actor, brain, world, now, { enabled = true } = {}) {
  if (!enabled) return null;
  const template = num(actor.info?.npc_template, actor.template);
  const state = bossV1State(actor, now);
  if (template === BOSS_V1.MAPS[31601]) {
    // Maze boss: phase-scaled preferred range, native choice, predictive lead.
    if (now >= num(brain.noticeAt)) {
      brain.noticeAt = now + 200;
      brain.patrolling = false;
      const target = (world.actors || []).filter((other) => other !== actor
        && other.alive !== false && !other.mapObject && !other.hostage
        && observable(world, actor, other, now, 600))
        .sort((a, b) => distance(posOf(actor, now), posOf(a, now))
          - distance(posOf(actor, now), posOf(b, now)) || a.id - b.id)[0] || null;
      if (target) {
        const point = posOf(target, now);
        state.lastTargetPos = point; state.observedAt = now;
        if (now >= state.phaseGap) {
          brain.goal = chooseGoal(world, actor, point, now, {
            fireRange: 600, preferredRange: [384, 312, 240][state.phase - 1], strafe: true,
          });
          state.phaseGap = now + 900;
        }
        if (distance(posOf(actor, now), point) <= num(actor.fireRange)
          && typeof actor.cast === 'function') {
          return [...arr(actor.cast(0, posOf(actor, now), point, target.id, now))];
        }
        return [];
      }
      brain.goal = state.lastTargetPos && now - state.observedAt <= 1600
        ? state.lastTargetPos : patrolGoal(world, actor, now);
    }
    return [];
  }
  // Eye boss (31602): warned rays + bounded guard waves.
  const cast = actor.pveBossCast;
  const target = (world.actors || []).filter((other) => other !== actor
    && other.alive !== false && !other.mapObject && !other.hostage
    && observable(world, actor, other, now, BOSS_V1.RANGE))
    .sort((a, b) => distance(posOf(actor, now), posOf(a, now))
      - distance(posOf(actor, now), posOf(b, now)) || a.id - b.id)[0] || null;
  const packets = [];
  if (now >= state.waveDueAt) {
    state.waveDueAt = now + 1500;
    const phase = [1, 2, 3].find((candidate) => num(state.waveCursors[candidate]) < 2
      && candidate <= state.phase);
    if (phase != null && state.waveCursors[phase] < 2) state.waveCursors[phase] += 1;
  }
  if (target && !cast && now >= state.nextTickAt) {
    if (state.remaining <= 0) { state.remaining = state.phase; state.cyclePhase = state.phase; }
    const point = posOf(target, now);
    actor.pveBossCast = {
      start: posOf(actor, now), dest: point, target: target.id,
      targetGeneration: target.generation, generation: actor.generation,
      finish: now + BOSS_V1.WARNING_MS, tacticsVersion: 1,
    };
    state.remaining -= 1;
    state.nextTickAt = now + BOSS_V1.WARNING_MS + BOSS_V1.GAP_MS;
    packets.push({ type: 'boss-ray-warning', target: target.id, finish: now + BOSS_V1.WARNING_MS });
  }
  return packets;
}

// Released warned eye ray (pve_boss_tactics.eye_release). Presentation is
// the caller's; this applies the native radial damage once.
export function bossV1Release(actor, now) {
  const cast = actor.pveBossCast;
  if (!cast) return [];
  if (now < cast.finish) return [];
  actor.pveBossCast = null;
  if (!isAlive(actor) || actor.arena?.pk?.finished) return [];
  const state = bossV1State(actor, now);
  state.remaining = Math.max(0, num(state.remaining));
  state.nextTickAt = now + (state.remaining
    ? BOSS_V1.GAP_MS : BOSS_V1.RECOVERY_MS[state.phase] || BOSS_V1.RECOVERY_MS[1]);
  const packets = [{ type: 'boss-ray-release', start: cast.start, dest: cast.dest,
    target: cast.target }];
  for (const victim of shotTargets(actor, cast.dest, BOSS_V1.RADIUS, now)) {
    if (typeof actor.damage === 'function') {
      packets.push(...arr(actor.damage(cast.raw || D(1000), now, {
        target: victim, school: 'energy', source_generation: cast.generation,
      })[0]));
    }
  }
  return packets;
}

// --------------------------------------------------------------- Dooku
export function configureDooku(actor, now = 0) {
  if (num(actor.info?.npc_template, actor.template) !== DOOKU.TEMPLATE) return null;
  if (!actor.pveDooku) {
    actor.pveDooku = {
      version: 1, generation: actor.generation, phase: 'idle', cast: null,
      cursor: 0, poisons: [], phaseEnd: now, nextTickAt: now, phaseGap: now,
    };
  }
  return actor.pveDooku;
}

export function dookuInterrupt(actor, now) {
  const state = actor.pveDooku;
  if (!state || !state.cast) return [];
  const cast = state.cast;
  state.cast = null;
  state.phase = actor.alive === false || actor.arena?.pk?.finished ? 'stopped' : 'recovery';
  state.phaseEnd = now + DOOKU.RECOVERY;
  return [{ type: 'interrupt', skill: cast.skill }];
}

function dookuTarget(actor, now, radius = DOOKU.RANGE) {
  const pos = posOf(actor, now);
  return [...(actor.arena?.actors?.values?.() || [])]
    .filter((target) => target !== actor && isAlive(target)
      && num(target.camp) !== num(actor.camp) && !target.info?.npc_template
      && !target.info?.pve_hostage)
    .filter((target) => distance(pos, posOf(target, now)) <= radius)
    .sort((a, b) => distance(pos, posOf(a, now)) - distance(pos, posOf(b, now)) || a.id - b.id)[0]
    || null;
}

export function dookuTick(actor, now, { enabled = true } = {}) {
  if (!enabled) return { busy: false, actions: [] };
  const template = num(actor.info?.npc_template, actor.template);
  const mapId = num(actor.arena?.geometry?.id);
  if (template !== DOOKU.TEMPLATE || mapId !== DOOKU.MAP) return { busy: false, actions: [] };
  const state = configureDooku(actor, now);
  if (!isAlive(actor) || state.generation !== actor.generation) {
    return { busy: true, actions: dookuInterrupt(actor, now) };
  }
  const actions = [];
  // Poison DoT (buff 50346) recorded by the debuff step.
  if (state.poisons.length) {
    const keep = [];
    for (const dot of state.poisons) {
      const target = actor.arena?.actors?.get?.(dot.target);
      if (!target || !isAlive(target) || target.generation !== dot.generation) continue;
      if (now >= dot.nextTickAt) {
        if (typeof actor.damage === 'function') {
          actor.damage(D(20), now, { target, school: 'true', periodic: true });
        }
        dot.nextTickAt += 2000;
        dot.remaining -= 1;
      }
      if (dot.remaining > 0 && now < dot.end) keep.push(dot);
    }
    state.poisons = keep;
  }
  const cast = state.cast;
  if (cast) {
    if (now < cast.finish) return { busy: true, actions };
    if (cast.skill === DOOKU.LASER) {
      actions.push({ type: 'laser', skill: cast.skill, start: cast.start, dest: cast.dest,
        target: cast.target, width: cast.width, raw: cast.raw });
      for (const victim of shotTargets(actor, cast.dest, 144, now)) {
        if (typeof actor.damage === 'function') {
          actor.damage(cast.raw || D(1000), now, {
            target: victim, school: 'energy', source_generation: cast.generation,
          });
        }
      }
      cast.count -= 1;
      if (cast.count > 0) {
        cast.finish = now + cast.interval;
        state.phase = 'laser_gap';
        return { busy: true, actions: actions.concat([{ type: 'warning', skill: cast.skill,
          start: cast.start, dest: cast.dest, target: cast.target }]) };
      }
    } else {
      actions.push({ type: 'debuff', skill: cast.skill, buff: cast.buff,
        target: cast.target, start: cast.start, dest: cast.dest });
      if (typeof actor._buff === 'function') {
        actor._buff(cast.buff, now, cast.target);
        if (cast.buff === 50346) {
          state.poisons = state.poisons.filter((dot) => dot.target !== cast.target);
          state.poisons.push({ target: cast.target, generation: actor.generation,
            nextTickAt: now + 2000, end: now + 10000, remaining: 5 });
        }
      }
    }
    state.cast = null;
    state.phase = 'recovery';
    state.phaseEnd = now + DOOKU.RECOVERY;
    return { busy: true, actions };
  }
  if (state.phase === 'recovery') {
    if (now < state.phaseEnd) return { busy: true, actions };
    state.phase = 'barrage';
  }
  const target = dookuTarget(actor, now);
  if (state.phase === 'idle') {
    if (target) {
      state.phase = 'barrage';
      state.nextTickAt = now + 6000;
      state.phaseGap = now + DOOKU.CYCLE - DOOKU.DEBUFF_WARNING;
    }
    return { busy: false, actions };
  }
  if (!target) return { busy: false, actions };
  if (now >= state.phaseGap) {
    const pair = DOOKU.DEBUFFS[state.cursor % DOOKU.DEBUFFS.length];
    state.cursor += 1;
    const point = posOf(target, now);
    state.cast = { skill: pair[0], buff: pair[1], start: posOf(actor, now), dest: point,
      target: target.id, targetGeneration: target.generation,
      generation: actor.generation, finish: now + DOOKU.DEBUFF_WARNING };
    state.phase = 'debuff_warning';
    state.phaseGap = now + DOOKU.CYCLE;
    actions.push({ type: 'warning', skill: pair[0], start: state.cast.start,
      dest: point, target: target.id });
    return { busy: true, actions };
  }
  if (now >= state.nextTickAt) {
    const point = posOf(target, now);
    const start = posOf(actor, now);
    const length = Math.min(600, distance(start, point));
    const dest = [start[0] + (point[0] - start[0]) * length / Math.max(1, distance(start, point)),
      start[1] + (point[1] - start[1]) * length / Math.max(1, distance(start, point))];
    state.cast = { skill: DOOKU.LASER, start, dest: dest.map(Math.round),
      target: target.id, targetGeneration: target.generation,
      generation: actor.generation, finish: now + DOOKU.LASER_WARNING,
      count: 2, interval: 800, width: 24, raw: 1000 };
    state.phase = 'laser_warning';
    state.nextTickAt = now + DOOKU.CYCLE;
    actions.push({ type: 'warning', skill: DOOKU.LASER, start: state.cast.start,
      dest: state.cast.dest, target: target.id });
    return { busy: true, actions };
  }
  return { busy: false, actions };
}

// ---------------------------------------------------- support / shots / lobs
export function shotTargets(actor, pos, radius, now, exclude = []) {
  const out = [];
  const arena = actor.arena;
  for (const target of arena?.actors?.values?.() || []) {
    if (exclude.includes(target.id) || num(target.camp) === num(actor.camp)
      || !isAlive(target) || target.info?.pve_hostage) continue;
    if (typeof target.isAreaTargetable === 'function' && !target.isAreaTargetable()) continue;
    const dest = posOf(target, now);
    if (distance(pos, dest) > radius) continue;
    const ignore = target.map_rect ? [target.map_rect] : [];
    if (arena.geometry?.wallContact
      && arena.geometry.wallContact(pos, dest, 0, { exclude: ignore }) !== null) continue;
    if (rectContact(pos, dest, arena.waterRects?.(now) || []) !== null) continue;
    out.push(target);
  }
  return out;
}

function supportAllies(actor, radius, now, healing = false) {
  const out = [];
  const pos = posOf(actor, now);
  for (const target of actor.arena?.actors?.values?.() || []) {
    if (!target.info?.pve_npc || num(target.camp) !== num(actor.camp)
      || !isAlive(target) || target.info?.pve_hostage || target.info?.pve_trap) continue;
    if (healing && (target.info?.pve_stationary
      || target === actor || num(target.hp) >= num(target.maxHp))) continue;
    const dest = posOf(target, now);
    if (distance(pos, dest) > radius) continue;
    if (actor.arena.geometry?.wallContact
      && actor.arena.geometry.wallContact(pos, dest, 0) !== null) continue;
    if (rectContact(pos, dest, actor.arena.waterRects?.(now) || []) !== null) continue;
    out.push(target);
  }
  return out;
}

export function supportPulse(actor, now) {
  const packets = [];
  const skill = num(actor.shotSkill ?? actor.skill);
  for (const target of supportAllies(actor, skill === 1000057 ? 216 : 200, now,
    skill === 1000057)) {
    if (skill === 1000057) {
      if (typeof target.restoreHp === 'function') {
        const heal = D(300).add(target.maxHp.mul(D('.05')));
        packets.push(...arr(target.restoreHp(heal, now)));
      }
    } else if (typeof actor._buff === 'function') {
      if (skill === 1000061) packets.push(...arr(actor._buff(252, now, target.id)));
      else {
        packets.push(...arr(actor._buff(251, now, target.id)));
        packets.push(...arr(actor._buff(247, now, target.id)));
      }
    }
  }
  return packets;
}

export function castSupport(actor, now) {
  if (actor.blocked?.('attack', now) || actor.skillSealed?.(0, now)
    || now < num(actor.cooldowns?.[0])) return [];
  const skill = num(actor.shotSkill ?? actor.skill);
  if (skill === 1000057 && !supportAllies(actor, 216, now, true).length) return [];
  actor.cooldowns[0] = now + Math.max(1, num(actor.fireInterval, 1000));
  if (skill === 1000060) {
    for (let index = 1; index <= 4; index += 1) {
      if (typeof actor._queue === 'function') actor._queue(now + index * 1000,
        'pve_support_pulse', actor.generation);
    }
  }
  return supportPulse(actor, now);
}

export function explode(actor, now) {
  if (actor.pveExploded) return [];
  actor.pveExploded = true;
  const skill = num(actor.shotSkill ?? actor.skill);
  const oil = skill === 1000062;
  const attack = typeof actor.combatStat === 'function'
    ? actor.combatStat('iAttack', now) : D(1);
  const raw = oil ? D(100).add(attack) : attack.mul?.(10) || D(10);
  const packets = [];
  for (const target of shotTargets(actor, posOf(actor, now), oil ? 144 : 216, now)) {
    if (typeof actor.damage === 'function') {
      packets.push(...arr(actor.damage(raw, now, {
        target, school: oil ? 'true' : 'physical', basic: true,
      })[0]));
    }
  }
  if (isAlive(actor) && typeof actor.commitHp === 'function') actor.commitHp(D(0), now);
  return packets;
}

export function signal(actor, pos, now) {
  if (typeof actor.addObject !== 'function') return [];
  const [ident, packet] = actor.addObject(253, pos);
  if (typeof actor._queue === 'function') {
    actor._queue(now + 2000, 'pve_signal_blast', ident, pos, actor.generation);
  }
  return arr(packet);
}

export function shot(actor, dest, now, target = null) {
  const skill = num(actor.shotSkill ?? actor.skill);
  const start = posOf(actor, now);
  if (start[0] === dest[0] && start[1] === dest[1] && skill !== 1000034) return [];
  if ([1000034, 1000062].includes(skill)) return explode(actor, now);
  if (skill === 1000054) return signal(actor, dest, now);
  if ([1000057, 1000060, 1000061, 50332].includes(skill)) return castSupport(actor, now);
  if ([1000010, 1000017, 1000037, 1000065, 1000069].includes(skill)) {
    const ident = typeof actor._newId === 'function' ? actor._newId(2) : num(actor.id);
    const flight = {
      pveLob: true, kind: 'bullet', id: ident, start, end: dest, begin: now,
      finish: now + 1000, previous: now, template: skill, generation: actor.generation,
      raw: typeof actor.combatStat === 'function' ? actor.combatStat('iAttack', now) : D(1),
      sourceGeneration: actor.generation, school: [1000065, 1000069].includes(skill)
        ? 'energy' : 'physical', basic: true, throughWalls: true, target: null,
    };
    if (typeof actor._queue === 'function') actor._queue(now + 20, 'flight', flight);
    return [];
  }
  if (typeof actor.cast === 'function' && skill) {
    return arr(actor.cast(0, start, dest, target?.id || 0, now));
  }
  return [];
}

export function lob(actor, flight, now) {
  const start = flight.start;
  const end = flight.end;
  if (now < flight.finish) {
    flight.previous = now;
    if (typeof actor._queue === 'function') {
      actor._queue(Math.min(now + 20, flight.finish), 'flight', flight);
    }
    return [];
  }
  const packets = [];
  const nuclear = [1000065, 1000069].includes(num(flight.template));
  for (const target of shotTargets(actor, end, nuclear ? 144 : 108, now)) {
    const raw = nuclear ? D(1000).add(target.maxHp?.mul?.(D('.1')) || 0) : flight.raw;
    if (typeof actor.damage === 'function') {
      packets.push(...arr(actor.damage(raw, now, {
        target, school: nuclear ? 'energy' : 'physical', basic: true,
        source_generation: flight.generation,
      })[0]));
    }
  }
  if (nuclear) {
    packets.push(...radiation(actor, {
      id: num(actor.id), position: end, end: now + (flight.template === 1000065 ? 3000 : 5000),
      generation: flight.generation, nextTickAt: now + 1000,
    }, now));
  }
  return packets;
}

export function radiation(actor, zone, now) {
  const packets = [];
  for (const target of shotTargets(actor, zone.position, 144, now)) {
    if (typeof actor.damage === 'function') {
      packets.push(...arr(actor.damage(D(1), now, {
        target, school: 'energy', periodic: true,
        source_generation: zone.generation,
      })[0]));
    }
  }
  return packets;
}

export function poisonTick(actor, now, data) {
  const [ident, , , remaining, targetGeneration] = data;
  const target = actor.arena?.actors?.get?.(ident);
  if (!target || !isAlive(target) || target.generation !== targetGeneration) return [];
  const packets = [];
  if (typeof actor.damage === 'function') {
    packets.push(...arr(actor.damage(D(30), now, {
      target, school: 'true', periodic: true,
    })[0]));
  }
  if (remaining > 1 && typeof actor._queue === 'function') {
    actor._queue(now + 2000, 'pve_poison_tick', ident, null, null, remaining - 1, targetGeneration);
  }
  return packets;
}

// ---------------------------------------------------------------- controller
export function createObjectives(engine, options = {}) {
  if (!engine || !engine.map) throw new Error('createObjectives requires a PveEngine-like engine');
  const map = engine.map;
  const id = num(map.id);
  const chapter = num(map.chapter, chapterFor(map));
  const c = {
    engine, map, id, chapter, options,
    localMechanics: Boolean(options.localMechanics ?? engine.pveBalance?.local_mechanics_version),
    localBombPuzzles: Boolean(options.bombPuzzlesVersion
      ?? engine.pveBalance?.bomb_puzzles_version),
    frozen: Boolean(options.frozen ?? engine.frozenProfile),
    hpFor: (template) => (typeof options.hpFor === 'function'
      ? num(options.hpFor(template), 1)
      : (typeof engine.hpFor === 'function' ? num(engine.hpFor(template), 1)
        : defaultHpFor(engine, template))),
    state: null,
  };
  c.state = {
    stage: 0, started: false, damageTotal: computeDamageTotal(c),
    activeRules: [], stoppedRules: [], zoneDone: [], disabledZones: [],
    rescued: [], hazards: [], ruleKills: {}, bossKills: 0,
    openDoors: [], claimedGuns: [], goalKills: {}, switches: [],
    alliesCalled: false, atExit: false, crossingLatched: false,
    laserDisabled: false, escortDone: [], deferredBoss: [],
    localForklift: null, localFortifications: null,
    objectKills: new Set(), removedOnce: new Set(), spawned: [], spawns: [],
    spawnRequests: [], queuedShots: [], spawnContext: null,
    transportLatches: new Map(), statKills: 0, won: false,
  };

  c.hooks = {
    start: (instance, now = instance?.now ?? 0) => startObjectives(c, now),
    spawn: (instance, npc, now = instance?.now ?? 0) => onSpawn(c, npc, now),
    npcDeath: (instance, npc, now = instance?.now ?? 0) => onNpcDeath(c, npc, now),
    complete: () => (c.state.won ? 'win' : null),
    tick: (instance, now = instance?.now ?? 0) => tickObjectives(c, now),
  };
  return c;
}

function startObjectives(c, now) {
  if (c.state.started) return [];
  c.state.started = true;
  const engine = c.engine;
  // Keep PveEngine's generic "spawn every catalog record" loop out of the way.
  if (engine && 'genericStarted' in engine) engine.genericStarted = true;
  if (engine && Array.isArray(engine.pendingSpawns)) engine.pendingSpawns.length = 0;
  if (engine && engine.boss == null) engine.boss = { sentinel: true };
  const packets = [];
  if (c.chapter === 2) {
    if (STAGES[c.id]) packets.push(...setStage(c, 1, now));
    else c.state.stage = 0;
  } else if (c.chapter === 3) {
    if (STAGES[c.id]) packets.push(...setStage(c, 1, now));
    else c.state.stage = 0;
  } else if (c.chapter === 4 || c.chapter === 5) {
    packets.push(...setStage(c, 1, now));
  } else if (c.chapter === 6) {
    packets.push(...setStage(c, 1, now));
  } else if (c.chapter >= 7) {
    c.state.stage = 1;
    for (const rec of c.map.spawns || []) {
      if (num(rec.delay) >= 0) schedule(c, rec, now);
    }
  }
  if ([2, 3, 4, 5, 6].includes(c.chapter)) {
    for (const rec of c.map.spawns || []) {
      if (num(rec.wave) === 0 && num(rec.delay) >= 0) schedule(c, rec, now);
    }
  }
  if (c.chapter === 5 && c.id === 502) packets.push(...removeObjects(c, [177]));
  if (c.chapter === 7 || c.chapter >= 8) {
    if (c.localMechanics && c.id === FORKLIFT.MAP) {
      c.state.localForklift = { phase: 'boss', vehicle: null, capture: null, clear: null,
        nextTickAt: 0 };
    } else if (c.localMechanics && c.id === 31403) {
      c.state.localFortifications = { choices: {}, pending: null };
    }
  }
  initHazards(c);
  return packets;
}

function onSpawn(c, npc, now) {
  const ctx = c.state.spawnContext || {};
  const packets = applySpawn(c, npc, now, ctx);
  for (const event of c.state.spawns) {
    if (event.rule === ctx.rule && event.template === ctx.template) event.npc = npc;
  }
  return packets;
}

function spawnEvent(c, event, now) {
  const rec = recordOf(c, event.rule);
  const template = num(event.template);
  const position = [...(rec?.position || [0, 0])];
  const ctx = {
    info: rec ? {
      point: num(rec.point), npc_template: template, pve_rule: num(rec.index),
      pve_loop: Boolean(event.loop), pve_remaining: num(event.remaining),
      pve_logic: rec.logic, pve_unscored: !objectiveFor(c, rec, template),
    } : { npc_template: template },
    camp: rec ? num(rec.camp) : 0,
    position,
    rule: num(event.rule),
    template,
  };
  // Authored birth corrections.
  if (c.id === 213 && template === 631 && rec && num(rec.point) === 4
    && distance(position, [1188, 2436]) === 0) {
    const geometry = c.engine.arena?.geometry;
    if (geometry?.canWalkTo && !geometry.canWalkTo(position)
      && geometry.canWalkTo([1140, 2436])
      && (!geometry.wallContact || geometry.wallContact(position, [1140, 2436]) === null)) {
      ctx.position = [1140, 2436];
    }
  }
  const birth = c.chapter === 6
    ? spawnExitPosition(c, rec || { position, point: -1, map: c.id, wave: 0, repeat: 0 }, template, now)
    : (c.chapter === 5 ? factoryExitPosition(c, rec || { position, point: -1 }, template, now) : null);
  if (birth) ctx.position = birth;
  if (c.chapter === 8 && c.id === 31402
    && MAP_BOSSES[c.id] != null && template === num(MAP_BOSSES[c.id])
    && c.state.escortDone.length < 2) {
    if (!c.state.deferredBoss.includes(num(event.rule))) {
      c.state.deferredBoss.push(num(event.rule));
    }
    c.state.activeRules = c.state.activeRules.filter((index) => index !== num(event.rule));
    return [];
  }
  const { npc, packets } = spawnAt(c, rec || { point: -1, position: ctx.position }, template, now, ctx);
  if (npc) {
    applySpawn(c, npc, now, ctx);
    c.state.spawned.push({ rule: num(event.rule), template, point: num(rec?.point), npc });
  }
  return packets;
}

function processSpawns(c, now) {
  const packets = [];
  const rest = [];
  for (const event of c.state.spawns) {
    if (now >= event.due) packets.push(...spawnEvent(c, event, now));
    else rest.push(event);
  }
  c.state.spawns = rest;
  return packets;
}

function tickObjectives(c, now) {
  if (!c.state.started) return startObjectives(c, now);
  const packets = [];
  packets.push(...zoneTick(c, now));
  packets.push(...crossing(c, now));
  packets.push(...processSpawns(c, now));
  packets.push(...chapterMechanisms(c, now));
  packets.push(...tickHazards(c, now));
  packets.push(...escortTick(c, now));
  if (c.chapter === 2 && c.id === 212 && c.state.bossKills
    && isPlayerPresent(c.engine)
    && distance(playerPos(c, now), [852, 324]) <= 120) c.state.won = true;
  progressStages(c, now);
  return packets;
}

export function installObjectives(engine, options = {}) {
  if (engine.objectives) return engine.objectives;
  const controller = createObjectives(engine, options);
  engine.objectives = controller;
  const prior = engine.hooks || {};
  const merged = {};
  for (const name of ['start', 'spawn', 'npcDeath', 'tick']) {
    merged[name] = (instance, ...rest) => [
      ...arr(prior[name] ? prior[name](instance, ...rest) : []),
      ...arr(controller.hooks[name](instance, ...rest)),
    ];
  }
  merged.complete = (instance, ...rest) => {
    const old = prior.complete ? prior.complete(instance, ...rest) : null;
    if (old === 'win' || old === 'lose') return old;
    const outcome = controller.hooks.complete(instance, ...rest);
    return outcome === 'win' || outcome === 'lose' ? outcome : old;
  };
  engine.hooks = merged;
  // PveEngine has already run its constructor start? Run ours now if needed.
  if (!controller.state.started) {
    const packets = controller.hooks.start(engine, engine.now ?? 0);
    if (typeof engine._emit === 'function') engine._emit(packets);
    else if (engine.outbox) engine.outbox.push(...packets);
  }
  return controller;
}

export default createObjectives;
