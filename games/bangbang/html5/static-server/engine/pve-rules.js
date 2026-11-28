// PvE rule specs for the 49 normal solo maps.
// Ported from BangBang_Offline server/pve_rules.py + pve_chapter1..9.py.
// Map 201 is the reviewed controller and is fully data-driven below.
// Chapters 2-9 keep their Python-authored stage/boss/objective constants;
// per-map spawn/zone/wave data comes from the client catalog (pve-data.js).

export const INTRO_MS = 3000;             // install(): ready = now + 3000
export const BATTLE_MS = 900000;          // end = ready + 900000
export const PLAYER_RESPAWN_MS = 5000;    // Common TankActions one 5s respawn

// ---------------------------------------------------------------- map 201
export const MAP201 = Object.freeze({
  mapId: 201,
  chapter: 1,
  lives: 3,
  introMs: INTRO_MS,
  timeLimitMs: BATTLE_MS,
  ambushPoint: 27,
  ambushTemplate: 1109,
  gateInstances: Object.freeze([22, 23, 24]),
  bossPoint: 6,
  bossTemplate: 1120,
  bossDelayMs: 5000,
  // pve_rules.install() grading denominator: ambush + two 2-NPC waves + boss.
  damageTemplates: Object.freeze([1109, 1102, 1115, 1102, 1115, 1120]),
  // pve_rules.death(): on ambush death, points 10/12 spawn 1102 then 1115
  // at +1s/+2s; point 6 spawns the boss at +5s.
  waves: Object.freeze([
    Object.freeze({ point: 10, spawns: Object.freeze([
      Object.freeze({ template: 1102, delayMs: 1000 }),
      Object.freeze({ template: 1115, delayMs: 2000 })]) }),
    Object.freeze({ point: 12, spawns: Object.freeze([
      Object.freeze({ template: 1102, delayMs: 1000 }),
      Object.freeze({ template: 1115, delayMs: 2000 })]) }),
    Object.freeze({ point: 6, spawns: Object.freeze([
      Object.freeze({ template: 1120, delayMs: 5000 })]) }),
  ]),
  // pve_npc.cast() map-201 special cases.
  bossIntervalMs: 4000,
  bossBurstDelaysMs: Object.freeze([1000, 2000]),
  bossSkill: 52,
  laserSkill: 1000009,
  laserLength: 360,
});

// Boss / goal NPC per normal map (pve_chapter1..8_9 BOSSES dicts).
// Maps absent here finish by wave/zone/all-rules objectives instead.
export const MAP_BOSSES = Object.freeze({
  201: 1120,
  211: 614, 212: 625, 213: 633, 401: 413, 403: 422,
  304: 1331, 306: 1332, 702: 2641, 703: 2610,
  503: 515, 506: 566,
  602: 710, 603: 715, 30101: 3110108, 30102: 3110211, 30103: 3110312,
  31201: 3120106, 31202: 3120209, 31203: 3120309,
  31302: 3130209, 31303: 3130313,
  31401: 3140111, 31402: 3140209, 31403: 3140314, 31501: 3150109,
  31502: 3150208, 31503: 3150314, 31601: 3160111, 31602: 3160211,
});

// pve_boss_tactics_v2.BINDINGS: map+template -> authored boss controller.
export const BOSS_TACTICS = Object.freeze({
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

// ------------------------------------------------------------ chapters 2-9
const LATE = {
  bosses: {
    31401: 3140111, 31402: 3140209, 31403: 3140314, 31501: 3150109,
    31502: 3150208, 31503: 3150314, 31601: 3160111, 31602: 3160211,
  },
  lasers: { 3150209: [-360, 0], 3150210: [360, 0] },
  saws: [3160112],
  teleportTraps: [3160113, 3160115, 3160116],
  escorts: [3140212, 3160203],
  escortEnds: {
    '31402:901': [1898, 1395], '31402:902': [1088, 505],
    '31602:301': [1026, 933],
  },
  completion: { default: 'boss', 31402: 'escortsThenBoss' },
};

export const CHAPTER_RULES = Object.freeze({
  1: {
    maps: [201, 204, 205, 203, 206],
    stages: { 204: [1, 2, 3, 5, 6, 7, 8], 205: [1, 3, 4, 5], 203: [1, 2, 3], 206: [1, 2, 3, 4, 5] },
    decor: [], helpers: [261, 263, 264], hostages: [265, 266],
    completion: { 201: 'map201', 204: 'finalZone', 205: 'bridgeZone', 206: 'rescueThree', default: 'waves' },
    // map201 is special-cased by rulesForMap; the other four run chapter1.py.
  },
  2: {
    maps: [211, 212, 213, 401, 402, 403],
    stages: { 401: [1, 2, 3, 4, 5], 402: [1, 2, 3, 4, 5], 403: [1, 2, 3, 4] },
    decor: [409, 414, 415, 416, 440, 612, 613],
    bosses: { 211: 614, 212: 625, 213: 633, 401: 413, 403: 422 },
    switches: { 402: { 67: 3 }, 403: { 63: 2, 62: 3, 61: 4, 68: 65 } },
    switchRadius: 72, wideSwitchRadius: 96, wideSwitches: ['402:67', '403:68'],
    turrets: { 612: [-360, 0], 613: [360, 0] }, turretIntervalMs: 5000,
    completion: { 211: 'boss', 212: 'escapeAfterBoss', 213: 'bossTwice', 401: 'boss', 402: 'allRules', 403: 'boss' },
  },
  3: {
    maps: [404, 405, 406, 301, 302, 303],
    stages: { 404: [1, 2, 3, 4, 5, 6], 405: [1, 2, 3, 4, 5], 406: [1, 2, 3, 4] },
    decor: [1409, 1414, 1416, 1440, 353, 342],
    goals: { 405: { 1437: 2 }, 406: { 1430: 1 }, 301: { 322: 4 }, 302: { 346: 4 }, 303: { 347: 1, 359: 1 } },
    gunClaimRadius: 100, switchRadius: 96, switchTemplate: 1416, switchDoor: 48,
    turrets: { 342: [0, -360] }, turretIntervalMs: 5000,
    completion: { 404: 'waves', 405: 'goals', 406: 'goals', 301: 'goals', 302: 'goals', 303: 'goals' },
  },
  4: {
    maps: [701, 702, 703, 304, 305, 306],
    stages: { 701: [1, 2, 3, 4, 5], 702: [1, 2, 3, 4], 703: [1, 2] },
    decor: [1350, 1351, 1353, 2612, 2613, 2673, 2676],
    bosses: { 304: 1331, 306: 1332, 702: 2641, 703: 2610 },
    tanks305: [1321, 1322, 1323, 1324], factories305: [33, 34, 35, 36],
    switchRadius: 96, disabledLaserPoint: 145,
    completion: { 701: 'allRules', 702: 'bossThenClear', 703: 'allRules', 304: 'boss', 305: 'factoriesAndTanks', 306: 'boss' },
  },
  5: {
    maps: [501, 502, 503, 504, 505, 506],
    stages: { 501: 6, 502: 7, 503: 6 },
    decor: [517, 518, 519, 520, 522, 524, 525, 526, 527, 567, 578],
    lasers: { 524: [0, 360], 525: [-360, 0], 526: [360, 0] },
    bosses: { 503: 515, 506: 566 },
    crossings: { 501: [[588, 1548], [540, 1500]], 502: [[1116, 900], [1092, 828]] },
    crossingRadius: 24,
    // factory (instance, exit point) pairs whose exit point starts blocked.
    factoryExits: {
      '501:9': [83, 2052, 1764], '502:9': [46, 804, 1572], '502:39': [120, 1668, 300],
      '502:30': [193, 1836, 1188], '503:9': [99, 1956, 1092], '503:67': [268, 516, 324],
    },
    completion: { 501: 'allRulesAndSixRescues', 502: 'allRulesAndSixRescues', 503: 'boss', 504: 'exit', 505: 'factory', 506: 'switchesThenBoss' },
  },
  6: {
    maps: [601, 602, 603, 30101, 30102, 30103],
    stages: { 601: 5, 602: 2, 603: 5 },
    decor: [717, 718, 719, 720, 721, 3110112, 3110113],
    lasers: { 719: [-360, 0], 720: [360, 0], 721: [0, -300], 3110112: [0, 300] },
    bosses: { 602: 710, 603: 715, 30101: 3110108, 30102: 3110211, 30103: 3110312 },
    crossings: { 603: [[1188, 2916], [996, 2892]] },
    crossingRadius: 24,
    completion: { 601: 'rescue', 602: 'bossThenEngine', 603: 'boss', 30101: 'boss', 30102: 'boss', 30103: 'dooku' },
  },
  7: {
    maps: [31201, 31202, 31203, 31301, 31302, 31303],
    decor: [3130210, 3130211, 3130108],
    lasers: { 3130210: [-360, 0], 3130211: [360, 0] },
    saws: [3130108],
    bosses: { 31201: 3120106, 31202: 3120209, 31203: 3120309, 31302: 3130209, 31303: 3130313 },
    crossings: { 31302: [[348, 324], [468, 324]] },
    crossingRadius: 24,
    completion: { 31301: 'allRules', default: 'boss' },
  },
  8: { ...LATE, maps: [31401, 31402, 31403, 31501, 31502, 31503] },
  9: { ...LATE, maps: [31601, 31602] },
});

// pve_scoring.RULES (M29 frozen grading, helper-weighted v1).
export const GRADING = Object.freeze({
  policy: 'm29_helper_weighted_v1',
  helper: [[125, 7, 20], [100, 6, 18], [80, 5, 14], [50, 4, 10], [0, 3, 5]],
  noHelper: [3, 0],
  harm: [[85, 5, 35], [65, 4, 25], [0, 3, 10]],
  dead: [[0, 5, 25], [1, 4, 12], [2, 3, 0]],
  time: [[100, 5, 20], [150, 4, 16], [200, 3, 8]],
  slowTime: [3, 0],
  total: [[90, 7], [80, 6], [65, 5], [50, 4], [0, 3]],
  sss: { damagePercent: 85, maxDeaths: 0, timePercent: 150 },
  // pve_scoring.profile_for_run
  targetSeconds: (nativePassTime) => Math.max(180, Math.min(360, Number(nativePassTime) || 900)),
});

/** Resolve the rule spec for a normalized map definition (pve-data.js). */
export function rulesForMap(mapDef) {
  const raw = mapDef && mapDef.native ? mapDef.native : {};
  const id = Number(mapDef && mapDef.id);
  const timeLimitMs = Math.max(1, Number(raw.iTime || raw.nPassTime || 900)) * 1000;
  const nativeLives = Number(raw.iLifeCount);
  const lives = id === 201 ? MAP201.lives : (nativeLives > 0 ? nativeLives : MAP201.lives);
  const common = {
    mapId: id, chapter: mapDef && mapDef.chapter, mode: 'solo_pve',
    introMs: INTRO_MS, timeLimitMs, lives, playerRespawnMs: PLAYER_RESPAWN_MS,
    tickMs: 200,
    boss: mapDef ? mapDef.boss : null,
    targetSeconds: GRADING.targetSeconds(raw.nPassTime),
  };
  if (id === MAP201.mapId) return { ...common, ...map201Spec(mapDef) };
  const chapter = CHAPTER_RULES[common.chapter] || {};
  return {
    ...common,
    stages: chapter.stages || null,
    decor: chapter.decor || [],
    lasers: chapter.lasers || chapter.turrets || {},
    saws: chapter.saws || [],
    switches: chapter.switches || null,
    goals: chapter.goals || null,
    crossings: chapter.crossings || null,
    completion: (chapter.completion && chapter.completion[id]) || (chapter.completion && chapter.completion.default) || 'waves',
    chapterRules: chapter,
  };
}

/**
 * Map 201 spec, taking positions/templates from the catalog definition so a
 * catalog change is caught rather than silently diverging from Python.
 */
export function map201Spec(mapDef) {
  const spawns = mapDef && Array.isArray(mapDef.spawns) ? mapDef.spawns : [];
  const byPoint = (point) => spawns.find((s) => s.point === point) || null;
  const ambush = byPoint(MAP201.ambushPoint);
  const gateNpcs = (mapDef && mapDef.npcs ? mapDef.npcs : []).filter(
    (n) => MAP201.gateInstances.includes(n.instance));
  return {
    stageFlow: ['ambush', 'boss'],
    ambush: {
      zone: mapDef ? mapDef.ambushZone : null,
      point: MAP201.ambushPoint,
      template: ambush && ambush.templates[0] ? ambush.templates[0] : MAP201.ambushTemplate,
      position: ambush ? ambush.position : null,
      requirePlayerAlive: true,
    },
    gates: {
      instances: gateNpcs.map((n) => n.instance),
      templates: [...new Set(gateNpcs.map((n) => n.template))],
    },
    waves: MAP201.waves.map((w) => {
      const rec = byPoint(w.point);
      return {
        point: w.point,
        position: rec ? rec.position : null,
        spawns: w.spawns.map((s) => ({ ...s })),
      };
    }),
    boss: {
      template: MAP201.bossTemplate,
      point: MAP201.bossPoint,
      position: byPoint(MAP201.bossPoint) ? byPoint(MAP201.bossPoint).position : null,
      delayMs: MAP201.bossDelayMs,
      intervalMs: MAP201.bossIntervalMs,
      burstDelaysMs: [...MAP201.bossBurstDelaysMs],
      skill: MAP201.bossSkill,
      winOnDeath: true,
    },
    laser: { template: 1115, skill: MAP201.laserSkill, length: MAP201.laserLength },
    damageTemplates: [...MAP201.damageTemplates],
  };
}
