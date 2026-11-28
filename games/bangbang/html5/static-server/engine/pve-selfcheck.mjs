// Runnable self-check for the PvE data/rules/AI layers.
// Run: node games/bangbang/html5/static-server/engine/pve-selfcheck.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  M81314_PARTS, MAP_IDS, CHAPTER_IDS, chapterOf, parseCatalogText, buildPveIndex,
  pathBetween, patrolNeighbors, classifyNpc, REWARDS,
} from './pve-data.js';
import { MAP201, MAP_BOSSES, CHAPTER_RULES, rulesForMap, GRADING } from './pve-rules.js';
import {
  createBrain, tickNpc, chooseGoal, nextWalkStep, applyMove, DIRECTIONS,
} from './pve-ai.js';

const html5 = new URL('../../', import.meta.url);
const texts = await Promise.all(M81314_PARTS.map(
  (name) => readFile(new URL(name, html5), 'utf8')));
const index = buildPveIndex(parseCatalogText(texts));
const { maps, npcProfiles } = index;

// ------------------------------------------------------------------ 1. maps
assert.equal(maps.size, 49, '49 PvE maps');
assert.equal(MAP_IDS.length, 49);
for (const id of MAP_IDS) {
  const map = maps.get(id);
  assert.ok(map, `map ${id} loaded`);
  assert.equal(map.id, id);
  assert.equal(map.chapter, chapterOf(id));
  assert.ok(map.spawns.length > 0, `map ${id} has pve_spawns`);
  assert.ok(map.walls.length > 0, `map ${id} has walls`);
  assert.equal(map.bounds.length, 4, `map ${id} bounds`);
  assert.ok(Number.isFinite(map.native.iTime), `map ${id} native iTime`);
  assert.equal(map.boss ? map.boss.template : null, MAP_BOSSES[id] ?? null,
    `map ${id} boss template`);
  const rules = rulesForMap(map);
  assert.equal(rules.mapId, id);
  assert.equal(rules.introMs, 3000);
  assert.equal(rules.timeLimitMs, 900000);
  assert.ok(rules.lives >= 1);
  if (['boss', 'bossTwice', 'bossThenClear', 'bossThenEngine', 'escortsThenBoss']
    .includes(rules.completion)) {
    assert.ok(map.boss, `map ${id} completion needs its authored boss`);
  }
}
assert.ok(npcProfiles.size > 100, 'full PvE NPC profile index');
for (const template of [1102, 1109, 1115, 1120]) {
  const flags = classifyNpc(201, 1, template, npcProfiles.get(template).arms);
  assert.deepEqual(flags, { hostage: false, flying: false, stationary: false, trap: false });
}
assert.deepEqual(classifyNpc(211, 2, 409, { iSpeed: 0 }),
  { hostage: true, flying: false, stationary: true, trap: false });
assert.deepEqual(classifyNpc(211, 2, 612, { iSpeed: 0 }),
  { hostage: true, flying: false, stationary: true, trap: false });
assert.equal(classifyNpc(212, 2, 300, { iSpeed: 60 }).trap, false);
// Chapter membership is exactly the Python catalog order.
const seen = Object.values(CHAPTER_IDS).flatMap((ids) => ids);
assert.deepEqual(seen, [...MAP_IDS]);

// --------------------------------------------------------- 2. map 201 data
const m201 = maps.get(201);
assert.deepEqual(m201.spawns.map((s) => s.point).sort((a, b) => a - b), [6, 10, 12, 27]);
const byPoint = (p) => m201.spawns.find((s) => s.point === p);
assert.deepEqual(byPoint(6).templates, [1120]);
assert.deepEqual(byPoint(6).position, [852, 252]);
assert.deepEqual(byPoint(10).templates, [1102, 1115]);
assert.deepEqual(byPoint(10).position, [804, 252]);
assert.deepEqual(byPoint(12).templates, [1102, 1115]);
assert.deepEqual(byPoint(12).position, [900, 252]);
assert.deepEqual(byPoint(27).templates, [1109]);
assert.deepEqual(byPoint(27).position, [1092, 1236]);
assert.deepEqual(m201.ambushZone, [840, 1464, 456, 168]);
assert.deepEqual(m201.boss, {
  template: 1120, point: 6, position: [852, 252], spawnIndex: 0, tactics: null,
});
assert.deepEqual(m201.npcs.filter((n) => n.pve_gate).map((n) => n.instance), [22, 23, 24]);
assert.deepEqual(m201.npcs.filter((n) => n.pve_ambush).map((n) => n.instance), [27]);
assert.deepEqual(patrolNeighbors(m201, null, 7), [8, 9]);
assert.deepEqual(pathBetween(m201, 3, 4).slice(0, 2), [[444, 1356], [468, 1356]]);

const spec = rulesForMap(m201);
assert.equal(spec.introMs, 3000);
assert.equal(spec.timeLimitMs, 900000);
assert.equal(spec.lives, 3);
assert.equal(spec.ambush.point, 27);
assert.equal(spec.ambush.template, 1109);
assert.deepEqual(spec.ambush.zone, [840, 1464, 456, 168]);
assert.deepEqual(spec.gates.instances, [22, 23, 24]);
assert.deepEqual(spec.damageTemplates, [1109, 1102, 1115, 1102, 1115, 1120]);
assert.deepEqual(spec.waves.map((w) => w.point), [10, 12, 6]);
assert.deepEqual(spec.waves.map((w) => w.spawns.map((s) => [s.template, s.delayMs])), [
  [[1102, 1000], [1115, 2000]],
  [[1102, 1000], [1115, 2000]],
  [[1120, 5000]],
]);
assert.equal(spec.boss.template, 1120);
assert.equal(spec.boss.winOnDeath, true);
assert.equal(spec.laser.template, 1115);
assert.equal(MAP201.bossSkill, 52);
assert.deepEqual(REWARDS.win, [3700002, 3700002, 3800001, 3800002, 4400001, 4400002, 3900002, 4000001]);
assert.equal(GRADING.targetSeconds(900), 360);
assert.equal(GRADING.targetSeconds(120), 180);

// ------------------------------------------------------- 3. NPC profiles
const p = (t) => npcProfiles.get(t);
assert.ok(p(1102) && p(1109) && p(1115) && p(1120), 'map-201 templates profiled');
assert.deepEqual([p(1102).speed, p(1102).fireRange, p(1102).fireInterval], [90, 480, 2000]);
assert.deepEqual([p(1109).speed, p(1109).fireRange, p(1109).fireInterval], [75, 480, 3000]);
assert.deepEqual([p(1115).speed, p(1115).fireRange, p(1115).fireInterval, p(1115).skill],
  [55, 360, 3000, 1000009]);
assert.deepEqual([p(1120).speed, p(1120).fireRange, p(1120).fireInterval,
  p(1120).fireCount, p(1120).fireBreak, p(1120).skill], [60, 400, 2000, 3, 1000, 52]);

// ----------------------------------------------------------- world stub
const walls = m201.walls;
const moveWalls = m201.movementWalls;
const bounds = m201.bounds;
const TANK_HALF = 36;
// catalog geometry rects are [x1, y1, x2, y2] (zone fields are [id,x,y,w,h]).
function inRect(pt, r, pad = 0) {
  return pt[0] > r[0] - pad && pt[0] < r[2] + pad
    && pt[1] > r[1] - pad && pt[1] < r[3] + pad;
}
function inPlayable(pt) {
  return pt[0] >= bounds[0] && pt[0] <= bounds[2]
    && pt[1] >= bounds[1] && pt[1] <= bounds[3];
}
function walkable(actor, pt) {
  if (!inPlayable(pt)) return false;
  return !moveWalls.some((r) => inRect(pt, r, TANK_HALF));
}
function sampleClear(from, to, test) {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(1, Math.ceil(d / 4));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const pt = [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
    if (!test(pt)) return false;
  }
  return true;
}
function lcg(seed) {
  let state = seed >>> 0;
  return {
    next() { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; },
    choice(list) { return list[Math.floor(this.next() * list.length)]; },
  };
}
function world(actors, seed = 7) {
  return {
    map: m201, actors, playerCamp: 1, rng: lcg(seed),
    inPlayable, clamp: (pt) => [
      Math.max(bounds[0], Math.min(bounds[2], pt[0])),
      Math.max(bounds[1], Math.min(bounds[3], pt[1])),
    ],
    walkable,
    walkEnd(actor, from, to) {
      if (!walkable(actor, to)) return null;
      if (!sampleClear(from, to, (pt) => !moveWalls.some((r) => inRect(pt, r, TANK_HALF)))) return null;
      return [...to];
    },
    lineClear(actor, from, to) {
      return sampleClear(from, to, (pt) => !walls.some((r) => inRect(pt, r, 0)));
    },
    waterRects: () => [],
    blocked: () => false,
    skillSealed: () => false,
  };
}
function npc(template, x, y, overrides = {}) {
  const prof = p(template);
  return {
    id: 5000 + template, generation: 1, template, camp: 0, pveNpc: true,
    alive: true, x, y, speed: prof.speed, fireRange: prof.fireRange,
    fireInterval: prof.fireInterval, fireCount: prof.fireCount,
    fireBreak: prof.fireBreak, skill: prof.skill, cooldowns: { 0: 0 },
    motionUntil: 0, routePoint: 3, routePrevious: null, routeQueue: [], logic: null,
    ...overrides,
  };
}
const player = { id: 1000, generation: 1, template: 1, camp: 1, alive: true, x: 804, y: 1356 };

// ----------------------------------------------------- 4. AI dry-run ticks
// A) 1102 in range: must cast its authored weapon at the player.
{
  const enemy = npc(1102, 684, 1356);
  const result = tickNpc(enemy, createBrain(), world([enemy, player]), 1000);
  const cast = result.actions.find((a) => a.type === 'cast');
  assert.ok(cast, '1102 casts in range');
  assert.equal(cast.skillId, 1000020);
  assert.equal(cast.targetId, player.id);
  for (const action of result.actions.filter((a) => a.type === 'move')) {
    assert.ok(walkable(enemy, action.to), 'move endpoint is walkable');
    assert.ok(Math.abs(action.to[0] - action.from[0]) <= 24
      && Math.abs(action.to[1] - action.from[1]) <= 24, 'native 24px component step');
  }
}
// B) 1109 out of range: move reduces distance and stays on legal 24px steps.
{
  const enemy = npc(1109, 444, 1356);
  const far = { ...player, x: 1140, y: 1356 };
  const result = tickNpc(enemy, createBrain(), world([enemy, far]), 1000);
  const move = result.actions.find((a) => a.type === 'move');
  assert.ok(move, '1109 advances toward a distant target');
  assert.ok(walkable(enemy, move.to), '1109 step walkable');
  const before = Math.hypot(1140 - enemy.x, 1356 - enemy.y);
  const after = Math.hypot(1140 - move.to[0], 1356 - move.to[1]);
  assert.ok(after < before, '1109 closes distance');
  assert.ok(move.duration > 0);
  const applied = applyMove(enemy, move, 1000);
  assert.equal(enemy.motionUntil, 1000 + applied.duration);
}
// C) No target: patrol the authored route edge 3 -> 4.
{
  const enemy = npc(1102, 444, 1356);
  const result = tickNpc(enemy, createBrain(), world([enemy]), 1000);
  assert.equal(result.patrolling, true, 'patrols without targets');
  const move = result.actions.find((a) => a.type === 'move');
  assert.ok(move, 'patrol move emitted');
  assert.deepEqual(move.to, [468, 1356]);
  assert.deepEqual(enemy.routeQueue[0], [468, 1356]);
}
// D) 1115 laser: instant 360px strip intent.
{
  const enemy = npc(1115, 684, 1356);
  const near = { ...player, x: 804, y: 1356 };
  const result = tickNpc(enemy, createBrain(), world([enemy, near]), 1000);
  const cast = result.actions.find((a) => a.type === 'cast');
  assert.ok(cast && cast.laser, '1115 emits a laser cast');
  assert.equal(cast.skillId, 1000009);
  assert.deepEqual(cast.dest, [1044, 1356]);
}
// E) 1120 boss: cast now, then bursts at +1s and +2s, nothing after.
{
  const enemy = npc(1120, 684, 1356);
  const near = { ...player, x: 804, y: 1356 };
  const w = world([enemy, near]);
  const brain = createBrain();
  const first = tickNpc(enemy, brain, w, 1000);
  const cast = first.actions.find((a) => a.type === 'cast');
  assert.ok(cast && cast.burstCount === 2, '1120 opens with a 2-burst cast');
  assert.equal(cast.skillId, 52);
  assert.equal(enemy.cooldowns[0], 5000);
  const second = tickNpc(enemy, brain, w, 2000);
  assert.equal(second.actions.filter((a) => a.type === 'cast' && a.burst).length, 1, 'burst at +1s');
  const third = tickNpc(enemy, brain, w, 3000);
  assert.equal(third.actions.filter((a) => a.type === 'cast' && a.burst).length, 1, 'burst at +2s');
  const fourth = tickNpc(enemy, brain, w, 4000);
  assert.equal(fourth.actions.filter((a) => a.type === 'cast').length, 0, 'queue drained');
}
// F) Memory: a lost target is approached via the last observed point, not live pos.
{
  const enemy = npc(1109, 444, 1356);
  const target = { ...player, x: 900, y: 1356 };
  const w = world([enemy, target]);
  const brain = createBrain();
  tickNpc(enemy, brain, w, 1000);
  target.x = 1400; target.y = 2000; // alive but outside the 600px perception
  const result = tickNpc(enemy, brain, w, 1200);
  assert.equal(result.state.target, target.id, 'target retained inside memory window');
  assert.ok(result.state.position, 'observed point retained');
}
// G) chooseGoal candidate must be a legal reachable point.
{
  const enemy = npc(1102, 684, 1356);
  const goal = chooseGoal(world([enemy]), enemy, [1140, 1356], 1000);
  assert.ok(walkable(enemy, goal) || (goal[0] === enemy.x && goal[1] === enemy.y));
  assert.equal(DIRECTIONS.length, 8);
}
// H) nextWalkStep never crosses a wall.
{
  const enemy = npc(1102, 444, 1356);
  const step = nextWalkStep(world([enemy]), enemy, [444, 1800], 1000);
  if (step) assert.ok(walkable(enemy, step.to), 'walk step stays clear');
}

// ------------------------------------------------------------ coverage log
const stats = { spawns: 0, paths: 0, zones: 0, waves: 0, hazards: 0, bosses: 0, noPaths: [] };
for (const map of maps.values()) {
  stats.spawns += map.spawns.length;
  stats.paths += map.paths.length;
  stats.zones += map.zones.length;
  stats.waves += map.waves.length;
  stats.hazards += map.hazards.length;
  if (map.boss) stats.bosses += 1;
  if (!map.paths.length) stats.noPaths.push(map.id);
}
console.log('PvE self-check OK');
console.log(`maps=${maps.size} chapters=${Object.keys(CHAPTER_RULES).length} ` +
  `spawns=${stats.spawns} paths=${stats.paths} zones=${stats.zones} ` +
  `waves=${stats.waves} hazards=${stats.hazards} bosses=${stats.bosses}`);
console.log('maps without patrol paths (zone/wave-driven):', stats.noPaths.join(', ') || 'none');
console.log('map201:', JSON.stringify({
  spawns: m201.spawns.map((s) => [s.point, s.templates]),
  ambushZone: m201.ambushZone,
  boss: m201.boss.template,
  waves: spec.waves.map((w) => [w.point, w.spawns.map((s) => [s.template, s.delayMs])]),
}));
