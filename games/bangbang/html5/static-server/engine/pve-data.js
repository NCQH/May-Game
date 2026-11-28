// PvE catalog loader / normalizer for all 49 normal solo maps.
//
// Source of truth:
//   m81314_assets_catalog.json.part0..3.json  (one 62.7 MB JSON split mid-token)
//   m6_asset_catalog.json.part0..2.json      (AINpc / arms / skill / buff, optional)
//
// Parse plan: the .partN.json files are NOT separate JSON documents. They must
// be concatenated in part order and parsed once. loadPveCatalog() does that,
// keeps only {maps, bindings, templates} via buildPveIndex(), and lets the
// multi-hundred-MB catalog object become garbage. A production server should
// pre-extract `maps` + `bindings.aiNPCs/aiArms` into a compact file; the
// extractor hook below (`parseCatalogText`) is where that swap would land.
//
// Map definition fields (catalog -> normalized):
//   authoritativeDefinition.pve_spawns    -> spawns
//   authoritativeDefinition.pve_paths     -> paths
//   authoritativeDefinition.pve_logic     -> logic.nodes      (map 201, flat)
//   authoritativeDefinition.pve_logics    -> logic.graphs     (maps 202-31602)
//   authoritativeDefinition.pve_zones     -> zones
//   authoritativeDefinition.pve_waves     -> waves
//   authoritativeDefinition.pve_respawns  -> respawns
//   authoritativeDefinition.pve_props     -> hazards
//   authoritativeDefinition.pve_ambush_zone -> ambushZone    (map 201)
//   .raw (MapTemplate_table row)          -> native (time, lives, drops, quality)
//   .staticNPCs / .npcTemplates / .blocks -> npcs / npcTemplates / blocks
//
// Rect format warning: walls, movementWalls, blocks and static NPC rectangles
// are [x1,y1,x2,y2] (TankLib bounds), while pve_zones fields are
// [zoneId,x,y,width,height] and pve_props are [id,template,camp,x,y].

import { MAP_BOSSES, BOSS_TACTICS } from './pve-rules.js';

export const M81314_PARTS = Object.freeze([
  'm81314_assets_catalog.json.part0.json',
  'm81314_assets_catalog.json.part1.json',
  'm81314_assets_catalog.json.part2.json',
  'm81314_assets_catalog.json.part3.json',
]);
export const M6_PARTS = Object.freeze([
  'm6_asset_catalog.json.part0.json',
  'm6_asset_catalog.json.part1.json',
  'm6_asset_catalog.json.part2.json',
]);
export const DEFAULT_BASE = new URL('../../', import.meta.url); // /html5/

// pve_catalog.py, in progression order.
export const CHAPTER_IDS = Object.freeze({
  1: [201, 204, 205, 203, 206],
  2: [211, 212, 213, 401, 402, 403],
  3: [404, 405, 406, 301, 302, 303],
  4: [701, 702, 703, 304, 305, 306],
  5: [501, 502, 503, 504, 505, 506],
  6: [601, 602, 603, 30101, 30102, 30103],
  7: [31201, 31202, 31203, 31301, 31302, 31303],
  8: [31401, 31402, 31403, 31501, 31502, 31503],
  9: [31601, 31602],
});
export const MAP_IDS = Object.freeze(
  Object.values(CHAPTER_IDS).flatMap((ids) => ids));
const CHAPTER_OF = new Map();
for (const [chapter, ids] of Object.entries(CHAPTER_IDS)) {
  for (const id of ids) CHAPTER_OF.set(id, Number(chapter));
}
export function chapterOf(mapId) {
  return CHAPTER_OF.get(Number(mapId)) ?? null;
}

export const CITIES = Object.freeze({
  201: 10100, 204: 10200, 205: 10300, 203: 10400, 206: 10500,
  211: 20100, 212: 20200, 213: 20300, 401: 20400, 402: 20500, 403: 20600,
  404: 30100, 405: 30200, 406: 30300, 301: 30400, 302: 30500, 303: 30600,
  701: 40100, 702: 40200, 703: 40300, 304: 40400, 305: 40500, 306: 40600,
  501: 50100, 502: 50200, 503: 50300, 504: 50400, 505: 50500, 506: 50600,
  601: 60100, 602: 60200, 603: 60300, 30101: 60400, 30102: 60500, 30103: 60600,
  31201: 70100, 31202: 70200, 31203: 70300, 31301: 70400, 31302: 70500, 31303: 70600,
  31401: 80100, 31402: 80200, 31403: 80300, 31501: 80400, 31502: 80500, 31503: 80600,
  31601: 90100, 31602: 90200,
});

export const NAMES = Object.freeze({
  201: 'Lính đánh thuê gian ác', 204: 'Đột kích sấm sét', 205: 'Trận chiến quyết liệt',
  203: 'Mỏ vàng', 206: 'Anh hùng cứu mỹ nhân',
  211: 'Thoát khỏi trại giam', 212: 'Nhảy vực cầu sinh', 213: 'Thoát khỏi miệng hổ',
  401: 'Tàu ngầm đáng sợ', 402: 'Con đường dũng sĩ', 403: 'Nhện đấu Tank Siêu Cấp',
  404: 'Truy kích cường địch', 405: 'Bảo vệ cầu', 406: 'Xe lửa cuồng bạo',
  301: 'Cuộc chiến bờ biển', 302: 'Phá hủy đạn đạo', 303: 'Chiến hạm trọng yếu',
  701: 'Sân bay gặp nạn', 702: 'Nhà ga phục kích', 703: 'Chiến hạm cuồng phong',
  304: 'Rừng dã chiến', 305: 'Công xưởng tank', 306: 'Tank cuồng bạo',
  501: 'Người ngoài hành tinh xâm lược', 502: 'Giải cứu sinh tử',
  503: 'Thu hồi trạm không gian', 504: 'Phản công tuyệt địa',
  505: 'Đại chiến người ngoài hành tinh', 506: 'Trận chiến thủ lĩnh',
  601: 'Giải cứu nữ vương', 602: 'Thu hồi động cơ', 603: 'Chiến binh Sith',
  30101: 'Người phán quyết', 30102: 'Behemoth Tinh Không', 30103: 'Bá Tước Dooku',
  31201: 'Resident Evil', 31202: 'Tìm kiếm bệnh dịch', 31203: 'Lính sinh hóa',
  31301: 'Thành phố chết', 31302: 'Red Bee', 31303: 'Sống hay chết',
  31401: 'Hoang mạc chết chóc', 31402: 'Căn cứ hoang mạc', 31403: 'Bình minh đẫm máu',
  31501: 'Trở lại thành phố', 31502: 'Bóng ma căn cứ', 31503: 'Nguồn gốc tận thế',
  31601: 'Mê cung kinh hoàng', 31602: 'Nữ thần báo thù',
});

// pve_catalog.HARD_TO_NORMAL (literal nHeroMapId -> nMapId pairs).
export const HARD_TO_NORMAL = Object.freeze({
  5211: 211, 5212: 212, 5213: 213, 5401: 401, 5402: 402, 5403: 403,
  5404: 404, 5405: 405, 5406: 406, 5301: 301, 5302: 302, 5303: 303,
  5701: 701, 5702: 702, 5703: 703, 5304: 304, 5305: 305, 5306: 306,
  5501: 501, 5502: 502, 5503: 503, 5504: 504, 5505: 505, 5506: 506,
  5601: 601, 5602: 602, 5603: 603, 31101: 30101, 31102: 30102, 31103: 30103,
  32201: 31201, 32202: 31202, 32203: 31203, 32301: 31301, 32302: 31302, 32303: 31303,
  32401: 31401, 32402: 31402, 32403: 31403, 32501: 31501, 32502: 31502, 32503: 31503,
  32601: 31601, 32602: 31602,
});
export const NORMAL_TO_HARD = Object.freeze(Object.fromEntries(
  Object.entries(HARD_TO_NORMAL).map(([hard, normal]) => [normal, Number(hard)])));

/** pve_catalog.resolve_request: {mapId, requestedMapId, difficulty}. */
export function resolveRequest(requestedMapId) {
  if (!Number.isInteger(requestedMapId)) throw new Error('Mã màn PvE không hợp lệ.');
  if (MAP_IDS.includes(requestedMapId)) {
    return { mapId: requestedMapId, requestedMapId, difficulty: 0 };
  }
  if (Object.hasOwn(HARD_TO_NORMAL, requestedMapId)) {
    return { mapId: HARD_TO_NORMAL[requestedMapId], requestedMapId, difficulty: 1 };
  }
  throw new Error('Màn PvE chưa được hỗ trợ; chỉ mở 49 màn thường và 44 màn khó đơn.');
}

// pve_progress.REWARD / REWARD_V3 / SECOND_PET.
export const REWARDS = Object.freeze({
  policy: 'offline_v3',
  win: Object.freeze([3700002, 3700002, 3800001, 3800002, 4400001, 4400002, 3900002, 4000001]),
  legacyWin: Object.freeze([3700002, 3700002, 3800001]),
  secondPet: Object.freeze({ mapId: 201, item: 4300000, firstClearOnly: true }),
});

// pve_stamina.py: C78 purchase only. Offline PvE entry spends no thew and the
// MapTemplate iConsumeItem/iConsumeCount fields are null on all 49 maps.
export const STAMINA = Object.freeze({
  request: 78, notify: 1027, cashType: 1, price: 1, gain: 100, max: 32767,
  offlineSpendsOnEntry: false,
});

// Skill iRange fallback for the four map-201 templates. Full skills come from
// m6_asset_catalog when buildPveIndex({m6}) is used.
const SKILL_RANGE_FALLBACK = Object.freeze({
  52: 600, 1000009: 360, 1000012: 480, 1000020: 480,
});

const SUPPORT_MAPS = new Set([701, 702, 703, 304, 305, 306]);
const CH3_HOSTAGES = new Set([1409, 1414, 353, 342]);
const CH3_FLYING = new Set([311, 312, 313, 1436]);
const SUPPORT_HOSTAGES = new Set([1350, 1351, 1353, 2612, 2613, 2673, 2676]);
const SUPPORT_TRAPS = new Set([1350, 1351, 2612, 2613, 2673, 2676]);
const SUPPORT_FLYING = new Set([1331, 2635, 2609, 2610]);
const BASE_HOSTAGES = new Set([265, 266, 409, 414, 415, 612, 613]);
const BASE_FLYING = new Set([260, 626, 633, 413]);
const BASE_STATIONARY = new Set([224, 265, 409, 414, 415, 605, 610, 612, 613, 632, 410, 411, 419, 420]);
const CH5_TRAPS = new Set([517, 518, 519, 520, 524, 525, 526, 567]);
const CH6_TRAPS = new Set([718, 719, 720, 721, 3110112]);
const CH7_TRAPS = new Set([3130108, 3130210, 3130211]);
const LATE_TRAPS = new Set([3150209, 3150210, 3160112, 3160113, 3160115, 3160116]);

const point = (p) => [Number(p[0]), Number(p[1])];

/** Normalize one catalog map entry (catalog object, not PvE map object). */
export function normalizeMap(mapId, rawMap) {
  const id = Number(mapId);
  const ad = rawMap.authoritativeDefinition || {};
  const chapter = chapterOf(id);
  const native = rawMap.raw || {};
  const bossTemplate = MAP_BOSSES[id];
  const spawns = (ad.pve_spawns || []).map((rec, index) => ({
    index: rec.index ?? index,
    point: rec.point,
    position: point(rec.position || [0, 0]),
    templates: [...(rec.templates || [])],
    wave: Number(rec.wave || 0),
    delay: Number(rec.delay ?? 0),
    interval: Math.max(1, Number(rec.interval || 1)),
    repeat: Number(rec.repeat ?? 0),
    camp: Number(rec.camp ?? 0),
    logic: rec.logic ?? null,
    map: rec.map ?? id,
  }));
  const bossSpawn = bossTemplate == null ? null
    : spawns.find((s) => s.templates.includes(bossTemplate)) || null;
  const boss = bossTemplate == null ? null : {
    template: bossTemplate,
    point: bossSpawn ? bossSpawn.point : null,
    position: bossSpawn ? [...bossSpawn.position] : null,
    spawnIndex: bossSpawn ? bossSpawn.index : null,
    tactics: BOSS_TACTICS[`${id}:${bossTemplate}`] || null,
  };
  const assets = {
    background: rawMap.background || null,
    sky: rawMap.sky || null,
    minimap: rawMap.minimap || null,
    gui: rawMap.gui || null,
  };
  return {
    id,
    name: rawMap.name || NAMES[id] || String(id),
    mode: rawMap.mode || 'solo_pve',
    chapter,
    cityId: Number(rawMap.cityId ?? CITIES[id]),
    previousMapId: rawMap.previousMapId ?? null,
    width: Number(ad.width ?? rawMap.width ?? 0),
    height: Number(ad.height ?? rawMap.height ?? 0),
    bounds: (ad.bounds || rawMap.bounds || []).map(Number),
    cellSize: Number(rawMap.cellSize || 24),
    columns: Number(rawMap.columns || 0),
    gridCells: Array.isArray(rawMap.gridCells) ? rawMap.gridCells : [],
    gridSemantics: rawMap.gridSemantics || null,
    tankCollisionSize: (rawMap.tankCollisionSize || [72, 72]).map(Number),
    rectangleFormat: 'x1,y1,x2,y2',
    walls: (ad.walls || []).map((w) => w.map(Number)),
    movementWalls: (ad.movement_walls || []).map((w) => w.map(Number)),
    blocks: (rawMap.blocks || []).map((w) => w.map(Number)),
    spawnPoints: ad.spawns || rawMap.spawns || {},
    respawnPoints: ad.respawns || rawMap.respawns || {},
    npcs: (ad.npcs || rawMap.staticNPCs || []).map((n) => ({
      ...n,
      position: [Number(n.x), Number(n.y)],
      scripts: n.pve_scripts || [],
    })),
    npcTemplates: rawMap.npcTemplates || {},
    robos: ad.robos || rawMap.robos || [],
    spawns,
    paths: (ad.pve_paths || []).map((p) => ({
      ends: (p.ends || []).map(Number),
      points: (p.points || []).map(point),
    })),
    logic: {
      flat: Array.isArray(ad.pve_logic) ? ad.pve_logic.map((n) => ({ id: Number(n.id), next: (n.next || []).map(Number) })) : null,
      graphs: Array.isArray(ad.pve_logics) ? ad.pve_logics.map((g) => ({
        id: Number(g.id),
        points: (g.points || []).map((n) => ({ id: Number(n.id), next: (n.next || []).map(Number) })),
      })) : null,
    },
    zones: (ad.pve_zones || []).map((z, index) => ({
      index,
      fields: (z.fields || []).map(Number),
      scripts: z.scripts || [],
    })),
    waves: (ad.pve_waves || []).map((w) => ({
      fields: Number(w.fields),
      scripts: w.scripts || [],
    })),
    respawns: (ad.pve_respawns || []).map((r) => r.map(Number)),
    barriers: ad.pve_barriers || [],
    hazards: (ad.pve_props || []).map((p) => ({
      id: Number(p[0]), template: Number(p[1]), camp: Number(p[2]),
      position: [Number(p[3]), Number(p[4])],
    })),
    ambushZone: ad.pve_ambush_zone ? ad.pve_ambush_zone.map(Number) : null,
    boss,
    rewards: {
      offline: REWARDS,
      nativeDrops: {
        easy: native.iEasyDropId ?? null,
        normal: native.nNormalDropId ?? null,
        elite: native.nEliteDropId ?? null,
        normalBoss: native.nNormalBossDropId ?? null,
        rareBoss: native.nRareBossDropId ?? null,
      },
    },
    stamina: {
      entryItem: native.iConsumeItem ?? null,
      entryCount: native.iConsumeCount ?? null,
      spendsOnEntry: STAMINA.offlineSpendsOnEntry,
      purchase: STAMINA,
    },
    native,
    source: ad.source || rawMap.source || null,
    assets,
  };
}

/** Authored patrol edge between two point ids, oriented from `from`. */
export function pathBetween(mapDef, from, to) {
  if (!mapDef || !Array.isArray(mapDef.paths)) return null;
  const edge = mapDef.paths.find(
    (p) => p.ends.length === 2 && p.ends.includes(from) && p.ends.includes(to));
  if (!edge) return null;
  return edge.ends[0] === from ? edge.points : [...edge.points].reverse();
}

/** Next-point list for a patrol node (flat map 201 or a numbered graph). */
export function patrolNeighbors(mapDef, logicId, pointId) {
  const logic = mapDef && mapDef.logic;
  if (!logic) return [];
  if (logic.flat && (logicId == null || logicId === 0)) {
    const node = logic.flat.find((n) => n.id === pointId);
    return node ? [...node.next] : [];
  }
  const graph = (logic.graphs || []).find((g) => g.id === logicId);
  const node = graph && graph.points.find((n) => n.id === pointId);
  return node ? [...node.next] : [];
}

/** Build NPC profiles from m81314 bindings.aiNPCs / aiArms (+ optional m6 skills). */
export function buildNpcProfiles(bindings, skills = null) {
  const out = new Map();
  if (!bindings || !bindings.aiNPCs) return out;
  for (const [key, npc] of Object.entries(bindings.aiNPCs)) {
    const arms = (bindings.aiArms || {})[String(npc.nArmsId)] || {};
    const skill = Number(arms.nSkillId || 0);
    const skillRow = skills ? skills[String(skill)] : null;
    const skillRange = Number((skillRow && skillRow.iRange) || SKILL_RANGE_FALLBACK[skill] || 0);
    let fireRange = Number(arms.iFireRange || 0);
    if (skill === 1000009) fireRange = fireRange ? Math.min(fireRange, 360) : 360;
    else if (fireRange && skillRange) fireRange = Math.min(fireRange, skillRange);
    else fireRange = fireRange || skillRange;
    out.set(Number(key), {
      template: Number(key),
      name: npc.szName || null,
      armsId: Number(npc.nArmsId),
      levelId: Number(npc.nLevelId || 0),
      reliveMs: Number(npc.iRelive || 0),
      speed: Number(arms.iSpeed || 0),
      fireRange,
      fireInterval: Number(arms.iFireInterv || 1000),
      fireCount: Number(arms.iFireCount || 1),
      fireBreak: Number(arms.iFireBreak || 0),
      skill,
      scatter: Number(arms.iBuffId1) === 30107,
      arms,
      skillRow,
    });
  }
  return out;
}

/** pve_npc.py classification for a spawn template. */
export function classifyNpc(mapId, chapter, template, arms = {}) {
  const tpl = Number(template);
  const speed = Number(arms.iSpeed || 0);
  const hpCoef = Number(arms.fHpCoef ?? 1);
  let hostage = BASE_HOSTAGES.has(tpl);
  let flying = BASE_FLYING.has(tpl);
  let stationary = BASE_STATIONARY.has(tpl);
  let trap = false;
  if (chapter === 3) {
    hostage = hostage || CH3_HOSTAGES.has(tpl);
    flying = CH3_FLYING.has(tpl);
    stationary = speed <= 0 || hostage;
  }
  if (SUPPORT_MAPS.has(mapId)) {
    hostage = hostage || SUPPORT_HOSTAGES.has(tpl);
    trap = trap || SUPPORT_TRAPS.has(tpl);
    flying = SUPPORT_FLYING.has(tpl);
    stationary = speed <= 0 || tpl === 1353 || tpl === 2612 || tpl === 2613;
  }
  if (chapter >= 5 && chapter <= 9) {
    hostage = hostage || hpCoef < 0;
    trap = trap || CH5_TRAPS.has(tpl);
    stationary = speed <= 0 || tpl === 522;
  }
  if (chapter === 6) {
    trap = CH6_TRAPS.has(tpl);
    stationary = speed <= 0 || tpl === 717 || tpl === 3110113;
    flying = tpl === 716;
  }
  if (chapter === 7) trap = CH7_TRAPS.has(tpl);
  if (chapter >= 8) trap = LATE_TRAPS.has(tpl);
  return { hostage, flying, stationary, trap };
}

/** Parse concatenated catalog part texts. Hook point for a compact extractor. */
export function parseCatalogText(texts) {
  return JSON.parse(Array.isArray(texts) ? texts.join('') : String(texts));
}

export function buildPveIndex(catalog, { m6 = null } = {}) {
  if (!catalog || typeof catalog.maps !== 'object') {
    throw new Error('PvE catalog is missing the maps object');
  }
  const maps = new Map();
  for (const [id, raw] of Object.entries(catalog.maps)) {
    maps.set(Number(id), normalizeMap(id, raw));
  }
  const missing = MAP_IDS.filter((id) => !maps.has(id));
  if (missing.length) throw new Error('PvE catalog missing maps: ' + missing.join(','));
  return {
    maps,
    npcProfiles: buildNpcProfiles(catalog.bindings, m6 ? m6.skills : null),
    meta: {
      schemaVersion: catalog.schemaVersion ?? null,
      scope: catalog.scope ?? null,
      source: catalog.source ?? null,
      mapCount: maps.size,
    },
  };
}

async function readPartTexts(parts, { baseUrl, readPart, fetchImpl }) {
  return Promise.all(parts.map(async (name) => {
    if (readPart) return readPart(name);
    if (typeof fetchImpl !== 'function') throw new Error('No fetch implementation for ' + name);
    const response = await fetchImpl(new URL(name, baseUrl));
    if (!response.ok) throw new Error(`PvE catalog part ${name}: HTTP ${response.status}`);
    return response.text();
  }));
}

/**
 * Fetch + concatenate + parse the catalog parts.
 * opts: { baseUrl, parts, m6Parts, readPart(name)->Promise<string>,
 *         fetchImpl, withM6, parse }
 */
export async function loadPveCatalog(opts = {}) {
  const {
    baseUrl = DEFAULT_BASE, parts = M81314_PARTS, m6Parts = M6_PARTS,
    readPart = null, fetchImpl = globalThis.fetch, withM6 = false,
    parse = parseCatalogText,
  } = opts;
  const catalog = parse(await readPartTexts(parts, { baseUrl, readPart, fetchImpl }));
  const m6 = withM6 ? parse(await readPartTexts(m6Parts, { baseUrl, readPart, fetchImpl })) : null;
  return buildPveIndex(catalog, { m6 });
}

/** Load and return one normalized map definition. */
export async function loadMap(mapId, opts = {}) {
  const index = await loadPveCatalog(opts);
  const id = Number(mapId);
  if (HARD_TO_NORMAL[id] != null) return index.maps.get(HARD_TO_NORMAL[id]);
  const map = index.maps.get(id);
  if (!map) throw new Error('Unknown PvE map: ' + mapId);
  return map;
}
