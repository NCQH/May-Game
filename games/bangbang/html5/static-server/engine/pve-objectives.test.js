// Assert-based M4 self-check for engine/pve-objectives.js.
// Run: node games/bangbang/html5/static-server/engine/pve-objectives.test.js
//
// Uses the real m81314 catalog through pve-data.js (one representative map per
// chapter 2-9), with a small PveEngine-shaped stub. Every case checks authored
// spawn/zone/objective data, script kinds and the win path; boss/hazard helpers
// are exercised directly so no rendering or timer loop is needed.

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { M81314_PARTS, buildPveIndex } from './pve-data.js';
import { MAP_BOSSES } from './pve-rules.js';
import {
  createObjectives, bossArchetype, bossTacticsV2Tick, bossV1Tick, bossV1Phase,
  bossV1Release, dookuTick, BOSS_V1, DOOKU, FACTORIES_305, TANKS_305, ESCORT_ENDS,
  TRANSPORT_SOURCES, TRANSPORT_LANDINGS, LASERS, DECOR, PUZZLES,
} from './pve-objectives.js';

const html5 = new URL('../../', import.meta.url);
const catalog = JSON.parse((await Promise.all(
  M81314_PARTS.map((name) => readFile(new URL(name, html5), 'utf8')))).join(''));
const index = buildPveIndex(catalog);

// ------------------------------------------------------------------- stubs
function makeNpc(id, template, position, camp, info = {}) {
  return {
    id, generation: 1, template: Number(template), camp: Number(camp),
    position: [...position], spawn: [...position], x: position[0], y: position[1],
    motion: null, motionKind: 0, alive: true, hp: 100, maxHp: 100,
    info: { npc_template: Number(template), ...info },
    stats: { iFireInterv: '1000', nFireRange: '600' },
    buffVersions: new Map(), buffSources: new Map(), cooldowns: { 0: 0 },
    lastBuff: null,
    positionAt() { return [...this.position]; },
    blocked() { return false; },
    skillSealed() { return false; },
    isAreaTargetable() { return true; },
    isUntargetable() { return false; },
    fireProjectile() { return []; },
    shoot() { return []; },
    cast() { return []; },
    damage() { return [[]]; },
    commitHp() { return []; },
    restoreHp() { return []; },
    _buff(template) { this.lastBuff = template; return []; },
    _queue() {},
    addObject() { return [1, []]; },
    removeObject() { return []; },
  };
}

function makeEngine(mapId, { now = 0 } = {}) {
  const map = index.maps.get(Number(mapId));
  assert.ok(map, `catalog map ${mapId}`);
  const player = makeNpc(1, 0, [0, 0], 1, { in_room: true, npc_template: 0 });
  player.info.npc_template = 0;
  player.maxHp = 5000; player.hp = 5000;
  const arena = {
    actors: new Map([[player.id, player]]),
    waterRects: () => [],
    geometry: {
      id: map.id, movementWalls: [],
      canWalkTo: () => true, wallContact: () => null,
      walkEnd: (start, dest) => [...dest], clampTankPosition: (p) => [...p],
      inPlayableRegion: () => true,
    },
  };
  let serial = 100;
  const engine = {
    map, arena, player, now, sceneId: 901, npcs: new Map(), spawned: [],
    pveBalance: {}, genericStarted: false, pendingSpawns: [], outbox: [], boss: null,
    nextId() { serial += 1; return serial; },
    _profile(template) { return index.npcProfiles.get(Number(template)) || null; },
    hpFor() { return 100; },
    spawnNpc(rec, template, at, ctx = {}) {
      const npc = makeNpc(engine.nextId(), template,
        ctx.position || rec.position || [0, 0], ctx.camp ?? rec.camp ?? 0, ctx.info || {});
      engine.npcs.set(npc.id, npc);
      arena.actors.set(npc.id, npc);
      engine.spawned.push({ point: rec.point, template: Number(template), npc });
      return { npc, packets: [] };
    },
  };
  return engine;
}

function harness(mapId, options = {}) {
  const engine = makeEngine(mapId, options);
  const controller = createObjectives(engine, options);
  engine.objectives = controller;
  engine.hooks = controller.hooks;
  return { engine, c: controller };
}

function tick(c, engine, now) {
  engine.now = now;
  return c.hooks.tick(engine, now);
}

function attach(engine, c, rec, template, position, info = {}, camp = 0) {
  const npc = makeNpc(engine.nextId(), template, position, camp, {
    point: rec.point, pve_rule: rec.index, ...info,
  });
  engine.npcs.set(npc.id, npc);
  engine.arena.actors.set(npc.id, npc);
  const entry = { rule: rec.index, template: Number(template), point: rec.point, npc };
  c.state.spawned.push(entry);
  return entry;
}

function record(map, pred) {
  const rec = (map.spawns || []).find(pred);
  assert.ok(rec, 'authored spawn record');
  return rec;
}

function kill(engine, c, entry, now = engine.now) {
  entry.npc.alive = false;
  entry.npc.hp = 0;
  entry.npc.info.in_room = false;
  return c.hooks.npcDeath(engine, entry.npc, now);
}

function makeWorld(engine, actor, target) {
  return {
    map: engine.map, playerCamp: 1,
    actors: [actor, target], rng: { next: () => 0.5, choice: (list) => list[0] },
    finished: false, tactics: true,
    lineClear: () => true, walkable: () => true, inPlayable: () => true,
    walkEnd: (actorIn, start, dest) => [...dest], clamp: (p) => [...p],
    waterRects: () => [], weaponLine: () => true,
    blocked: () => false, skillSealed: () => false,
  };
}

let checks = 0;
const ok = (condition, message) => { assert.ok(condition, message); checks += 1; };
const equal = (a, b, message) => { assert.equal(a, b, message); checks += 1; };

// ---------------------------------------------------------------- chapter 2
{
  const { engine, c } = harness(211, { bombPuzzlesVersion: 1 });
  equal(c.state.stage, 0, '211 starts at stage 0');
  ok(c.state.damageTotal > 0, '211 damage denominator from authored objective spawns');
  c.hooks.start(engine, 0);
  tick(c, engine, 0);
  ok(c.state.spawned.some((entry) => entry.template === 602 && entry.point === 21),
    '211 wave-0 guards spawn');
  equal(c.state.hazards.length, 1, '211 bomb prop 800 becomes a hazard');
  equal(c.state.hazards[0].template, 800, '211 hazard template');

  // Zone 6 is the final ambush zone: it opens stage 1 and triggers the boss.
  const zone6 = c.map.zones.find((zone) => zone.fields[0] === 6);
  assert.ok(zone6, '211 zone 6');
  engine.player.position = [zone6.fields[1] + 10, zone6.fields[2] + 10];
  tick(c, engine, 0);
  equal(c.state.stage, 1, '211 zone 6 advances to stage 1');
  const bossEntry = c.state.spawned.find((entry) => entry.template === MAP_BOSSES[211]);
  ok(bossEntry, '211 boss 614 spawned by zone script kind 7');
  equal(bossArchetype(211, MAP_BOSSES[211]), 'heavy', '211 boss archetype v2 heavy');

  kill(engine, c, bossEntry, 0);
  equal(c.state.bossKills, 1, '211 boss counted');
  equal(c.state.won, true, '211 boss death wins');
  equal(c.hooks.complete(engine, 0), 'win', '211 complete hook');

  // Boss v2 decision path (local tactic bonuses, no native stat change).
  const actor = makeNpc(1200, MAP_BOSSES[211], [1000, 1000], 0,
    { npc_template: MAP_BOSSES[211] });
  actor.skill = 1000004;
  actor.fireRange = 400;
  const target = makeNpc(999, 0, [actor.position[0] + 300, actor.position[1]], 1);
  target.info.npc_template = 0;
  const world = makeWorld(engine, actor, target);
  const brain = { path: [], repathAt: 0, noticeAt: 0, goal: null, patrolling: false };
  const packets = bossTacticsV2Tick(actor, brain, world, 200, { enabled: true });
  ok(Array.isArray(packets), 'boss v2 owns the tick');
  ok(Array.isArray(brain.goal), 'boss v2 selects a goal');
  equal(brain.bossTacticsV2.phase, 1, 'boss v2 phase 1');
}

{
  // 211 bomb puzzle: five-second fuse opens the authored brick group.
  const { engine, c } = harness(211, { bombPuzzlesVersion: 1 });
  c.hooks.start(engine, 0);
  const bomb = c.state.hazards.find((hazard) => hazard.template === 800);
  engine.player.position = [...bomb.position];
  tick(c, engine, 0);
  equal(bomb.active, true, 'bomb arms on player proximity');
  tick(c, engine, 5000);
  equal(bomb.done, true, 'bomb detonates after 5000 ms');
  for (const brick of PUZZLES[211][0][2]) {
    ok(c.state.objectKills.has(brick), `bomb removes brick ${brick}`);
  }
}

// ---------------------------------------------------------------- chapter 3
{
  const { engine, c } = harness(404);
  c.hooks.start(engine, 0);
  equal(c.state.stage, 1, '404 starts at stage 1');
  ok(c.state.spawns.some((event) => {
    const rec = c.map.spawns.find((r) => r.index === event.rule);
    return rec && rec.wave === 1;
  }), '404 schedules wave-1 authored spawns');
  equal(c.state.won, false, '404 not won at start');
}

{
  // 301 goals: four authored 322 kills finish the map.
  const { engine, c } = harness(301);
  c.hooks.start(engine, 0);
  const goalRecords = c.map.spawns.filter((rec) => rec.templates.includes(322));
  equal(goalRecords.length, 4, '301 has four goal 322 records');
  for (const rec of goalRecords) {
    const entry = attach(engine, c, rec, 322, rec.position);
    kill(engine, c, entry, 0);
  }
  equal(c.state.won, true, '301 goal kills win');
  equal(c.hooks.complete(engine, 0), 'win', '301 complete hook');
}

// ---------------------------------------------------------------- chapter 4
{
  const { engine, c } = harness(305);
  c.hooks.start(engine, 0);
  equal(c.state.stage, 1, '305 starts at stage 1');
  for (const instance of FACTORIES_305) c.state.objectKills.add(instance);
  const tankRec = record(c.map, (rec) => rec.templates.some((tpl) => TANKS_305.includes(tpl)));
  const tank = attach(engine, c, tankRec, TANKS_305[0], tankRec.position);
  tick(c, engine, 0);
  equal(c.state.won, false, '305 tank keeps the factory map open');
  kill(engine, c, tank, 0);
  tick(c, engine, 0);
  equal(c.state.won, true, '305 wins after factories and tanks are gone');
}
{
  const { engine, c } = harness(703);
  c.hooks.start(engine, 0);
  equal(c.state.laserDisabled, false, '703 laser starts enabled');
  engine.player.position = [540, 2820];
  tick(c, engine, 0);
  equal(c.state.laserDisabled, true, '703 switch disables the laser');
  ok(c.state.stoppedRules.includes(56) && c.state.stoppedRules.includes(57)
    && c.state.stoppedRules.includes(58), '703 stop rules for the 145/146 spawns');
  const disabled = c.state.spawned.filter((entry) => [2612, 2613].includes(entry.template));
  ok(disabled.every((entry) => entry.npc.info.in_room === false),
    '703 removes the shotgun emitters');
}

// ---------------------------------------------------------------- chapter 5
{
  const { engine, c } = harness(506);
  c.hooks.start(engine, 0);
  equal(c.state.stage, 1, '506 starts at stage 1');
  for (const zone of c.map.zones) {
    engine.player.position = [zone.fields[1] + 1, zone.fields[2] + 1];
    tick(c, engine, 0);
  }
  equal(new Set(c.state.switches).size, 3, '506 records all three zone switches');
  equal(c.state.stage, 2, '506 switches open stage 2');
  const bossRec = record(c.map, (rec) => rec.templates.includes(566));
  tick(c, engine, 9000);
  const bossEntry = c.state.spawned.find((entry) => entry.template === 566);
  ok(bossEntry, '506 boss 566 spawns after the switch stage');
  kill(engine, c, bossEntry, 9000);
  equal(c.state.won, true, '506 boss death wins');

  const crossing = harness(501);
  crossing.c.hooks.start(crossing.engine, 0);
  crossing.engine.player.position = [588, 1548];
  tick(crossing.c, crossing.engine, 0);
  assert.deepEqual(crossing.engine.player.position, [540, 1500]);
  checks += 1;
  equal(crossing.c.state.crossingLatched, true, '501 temporary crossing latches');
}

// ---------------------------------------------------------------- chapter 6
{
  const { engine, c } = harness(601);
  c.hooks.start(engine, 0);
  const rescueRec = record(c.map, (rec) => rec.templates.includes(717));
  const hostage = attach(engine, c, rescueRec, 717, rescueRec.position);
  engine.player.position = [...hostage.npc.position];
  tick(c, engine, 0);
  equal(c.state.rescued.length, 1, '601 rescue 717 on proximity');
  equal(hostage.npc.info.in_room, false, '601 hostage removed');
  c.state.stage = 5;
  tick(c, engine, 0);
  equal(c.state.won, true, '601 rescue objective wins at stage 5');
}
{
  const { engine, c } = harness(602);
  c.hooks.start(engine, 0);
  const bossRec = record(c.map, (rec) => rec.templates.includes(710));
  const boss = attach(engine, c, bossRec, 710, bossRec.position);
  kill(engine, c, boss, 0);
  equal(c.state.stage, 3, '602 boss death announces engine stage 3');
  equal(c.state.won, true, '602 boss death wins');
}
{
  // 30101 zone 1 is extended 24px toward the reachable approach.
  const { engine, c } = harness(30101);
  c.hooks.start(engine, 0);
  const zone = c.map.zones.find((z) => z.fields[0] === 1);
  engine.player.position = [zone.fields[1] - 23, zone.fields[2] + 10];
  tick(c, engine, 0);
  ok(c.state.zoneDone.length >= 1, '30101 extended switch zone is reachable');
}
{
  // Dooku deterministic laser/debuff cycle.
  const { engine } = harness(30103);
  const actor = makeNpc(500, DOOKU.TEMPLATE, [1000, 1000], 0, { npc_template: DOOKU.TEMPLATE });
  actor.arena = engine.arena;
  const target = makeNpc(501, 0, [1400, 1000], 1);
  engine.arena.actors.set(actor.id, actor);
  engine.arena.actors.set(target.id, target);
  let result = dookuTick(actor, 0, { enabled: true });
  equal(result.busy, false, 'Dooku waits for a target decision');
  result = dookuTick(actor, 6000, { enabled: true });
  equal(result.actions[0].type, 'warning', 'Dooku warns before the laser');
  equal(actor.pveDooku.phase, 'laser_warning', 'Dooku laser warning phase');
  result = dookuTick(actor, 7200, { enabled: true });
  equal(result.actions[0].type, 'laser', 'Dooku fires the warned laser');
}

// ---------------------------------------------------------------- chapter 7
{
  const { engine, c } = harness(31202);
  c.hooks.start(engine, 0);
  const bossRec = record(c.map, (rec) => rec.templates.includes(3120209));
  const boss = attach(engine, c, bossRec, 3120209, bossRec.position);
  kill(engine, c, boss, 0);
  equal(c.state.won, true, '31202 legacy boss death wins');
}
{
  // 31301 has no boss: every authored rule must complete.
  const { engine, c } = harness(31301);
  c.hooks.start(engine, 0);
  for (const rec of c.map.spawns) {
    const expected = rec.templates.filter((tpl) => !DECOR[7].includes(Number(tpl)))
      .length * (Number(rec.repeat) + 1);
    c.state.ruleKills[rec.index] = expected;
  }
  tick(c, engine, 2500);
  equal(c.state.won, true, '31301 all-rules completion wins');
  ok(TRANSPORT_SOURCES['31601:711'], 'maze transport source table present');
  ok(LASERS[7]['3130210'], 'chapter-7 laser table present');
}

// ---------------------------------------------------------------- chapter 8
{
  const { engine, c } = harness(31402);
  c.hooks.start(engine, 0);
  const bossRec = record(c.map, (rec) => rec.templates.includes(3140209));
  const bossPoint = bossRec.point;
  const triggerZone = c.map.zones.find((zone) => zone.scripts
    .some((script) => script[0] === 7 && script[1] === bossPoint));
  assert.ok(triggerZone, '31402 boss trigger zone');
  engine.player.position = [triggerZone.fields[1] + 1, triggerZone.fields[2] + 1];
  tick(c, engine, 0);
  tick(c, engine, 2500);
  ok(!c.state.spawned.some((entry) => entry.template === 3140209),
    '31402 boss deferred until both escorts arrive');
  ok(c.state.deferredBoss.includes(bossRec.index), '31402 boss record deferred');

  const escorts = [];
  for (const [point, end] of Object.entries(ESCORT_ENDS)) {
    if (!point.startsWith('31402:')) continue;
    const rec = record(c.map, (r) => r.templates.includes(3140212)
      && Number(r.point) === Number(point.split(':')[1]));
    escorts.push([end, attach(engine, c, rec, 3140212, end,
      { point: Number(point.split(':')[1]) }, 1)]);
  }
  for (const [end] of escorts) {
    engine.player.position = [...end];
    tick(c, engine, 2600);
  }
  equal(c.state.escortDone.length, 2, '31402 both escorts reach their ends');
  tick(c, engine, 5000);
  const bossEntry = c.state.spawned.find((entry) => entry.template === 3140209);
  ok(bossEntry, '31402 boss spawns after escorts');
  kill(engine, c, bossEntry, 5000);
  equal(c.state.won, true, '31402 boss death wins');
}

// ---------------------------------------------------------------- chapter 9
{
  const { engine, c } = harness(31602);
  c.hooks.start(engine, 0);
  const escortRec = record(c.map, (rec) => rec.templates.includes(3160203));
  const escort = attach(engine, c, escortRec, 3160203, ESCORT_ENDS['31602:301'],
    { point: 301 }, 1);
  tick(c, engine, 0);
  ok(c.state.escortDone.includes(301), '31602 Alice escort marks its end');
  equal(escort.npc.info.in_room !== false, true, '31602 escort is not force-removed');

  const boss = makeNpc(700, 3160211, [600, 900], 0, { npc_template: 3160211 });
  boss.arena = engine.arena;
  engine.arena.actors.set(boss.id, boss);
  const target = makeNpc(701, 0, [900, 900], 1);
  engine.arena.actors.set(target.id, target);
  const world = makeWorld(engine, boss, target);
  bossV1Tick(boss, { noticeAt: 0 }, world, 1400, { enabled: true });
  const warn = bossV1Tick(boss, { noticeAt: 0 }, world, 2600, { enabled: true });
  ok(Array.isArray(warn) && warn[0]?.type === 'boss-ray-warning',
    '31602 v1 boss warns before the eye ray');
  ok(boss.pveBossCast, '31602 v1 boss stores the warned cast');
  const release = bossV1Release(boss, boss.pveBossCast.finish);
  ok(Array.isArray(release) && release[0]?.type === 'boss-ray-release',
    '31602 v1 boss releases the warned eye ray');
  equal(boss.pveBossCast, null, '31602 v1 cast is consumed on release');
  equal(bossV1Phase({ hp: 30, maxHp: 100 }), 3, '31602 v1 phase 3 at 30% HP');
  equal(BOSS_V1.WARNING_MS, 2000, 'v1 warning is 2s');

  const bossRec = record(c.map, (rec) => rec.templates.includes(3160211));
  const bossEntry = attach(engine, c, bossRec, 3160211, bossRec.position);
  kill(engine, c, bossEntry, 9000);
  equal(c.state.won, true, '31602 final boss death wins');
  equal(c.hooks.complete(engine, 9000), 'win', '31602 complete hook');
}

// ------------------------------------------------------- chapter 9 transport
{
  const { engine, c } = harness(31601, { localMechanics: true });
  c.hooks.start(engine, 0);
  const point = Object.entries(TRANSPORT_SOURCES)
    .find(([id]) => id.startsWith('31601:'))[0].split(':')[1];
  const rec = record(c.map, (r) => r.templates.includes(3160116)
    && Number(r.point) === Number(point));
  const emitter = attach(engine, c, rec, 3160116, rec.position,
    { point: Number(point), pve_trap: true });
  tick(c, engine, 0); // first tick arms the authored emitter cadence
  c.state.spawned = [emitter];
  c.state.spawns = [];
  engine.arena.actors.clear();
  engine.arena.actors.set(engine.player.id, engine.player);
  engine.arena.actors.set(emitter.npc.id, emitter.npc);
  engine.player.position = [rec.position[0] + 120, rec.position[1]];
  tick(c, engine, 2000);
  const landing = TRANSPORT_LANDINGS[`31601:${point}`] || rec.position;
  assert.deepEqual(engine.player.position, landing);
  checks += 1;
  equal(c.state.transportLatches.size, 1, 'maze emitter latches its pull target');
}

console.log('PvE objectives self-check OK');
console.log(JSON.stringify({
  maps: [211, 404, 301, 305, 703, 506, 601, 602, 30101, 30103, 31202, 31301, 31402, 31602],
  chapters: [2, 3, 4, 5, 6, 7, 8, 9],
  checks,
  bossArchetypes: Object.keys({ 211: 1 }).length,
}));
