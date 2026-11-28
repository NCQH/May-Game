// Runnable self-check for engine/pve-engine.js on the real map-201 catalogs.
// Run: node games/bangbang/html5/static-server/engine/pve-engine.test.js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  M81314_PARTS, M6_PARTS, parseCatalogText, buildPveIndex,
} from './pve-data.js';
import { MAP201, rulesForMap } from './pve-rules.js';
import { createData } from './data.js';
import { ZERO } from './math.js';
import { PveEngine } from './pve-engine.js';

// --------------------------------------------------------------- catalogs
const html5 = new URL('../../', import.meta.url);
const read = (names) => Promise.all(names.map((name) => readFile(new URL(name, html5), 'utf8')));

const pveCatalog = JSON.parse((await read(M81314_PARTS)).join(''));
const index = buildPveIndex(pveCatalog);
const m201 = index.maps.get(201);
const m6 = JSON.parse((await read(M6_PARTS)).join(''));
const garage = JSON.parse(await readFile(new URL('m8_garage_catalog.json', html5), 'utf8'));
const data = createData({ garage, assets: m6, pve: pveCatalog });

function lcg(seed) {
  let state = seed >>> 0;
  return {
    next() { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; },
    choice(list) { return list[Math.floor(this.next() * list.length)]; },
  };
}
const makeEngine = (overrides = {}) => new PveEngine({
  map: m201, data, npcProfiles: index.npcProfiles, tank: { tankId: 10000001, level: 1 },
  sceneId: 901, runId: 'test-run', rng: lcg(7), now: 0, ...overrides,
});

const ids = (frames) => frames.map((frame) => frame[0]);
const has = (frames, id) => frames.some((frame) => frame[0] === id);

// S1564 body layout: ten vectors, each u16 count followed by count * size.
const SCENE_SIZES = [12, 22, 22, 8, 8, 8, 4, 4, 4, 8]; // moves..shields
function sceneCounts(body) {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const counts = [];
  let total = 0;
  for (let i = 0; i < 10; i += 1) {
    const count = view.getUint16(total, true);
    counts.push(count);
    total += 2 + count * SCENE_SIZES[i];
  }
  return { counts, total, length: body.byteLength };
}

// --------------------------------------------------- 1. spawns and templates
assert.equal(m201.id, 201);
assert.deepEqual(m201.spawnPoints, { 1: [[684, 2316]] });
const spec = rulesForMap(m201);
assert.equal(spec.introMs, 3000);
assert.equal(spec.timeLimitMs, 900000);
assert.equal(spec.lives, 3);
assert.deepEqual(spec.waves.map((w) => w.point), [10, 12, 6]);
assert.deepEqual(spec.waves.flatMap((w) => w.spawns.map((s) => [w.point, s.template, s.delayMs])), [
  [10, 1102, 1000], [10, 1115, 2000],
  [12, 1102, 1000], [12, 1115, 2000],
  [6, 1120, 5000],
]);
for (const template of [1102, 1109, 1115, 1120]) {
  const profile = index.npcProfiles.get(template);
  assert.ok(profile, `npc profile ${template}`);
  assert.ok(profile.fireRange > 0);
}
assert.equal(index.npcProfiles.get(1102).skill, 1000020);
assert.equal(index.npcProfiles.get(1109).skill, 1000012);
assert.equal(index.npcProfiles.get(1115).skill, 1000009);
assert.equal(index.npcProfiles.get(1120).skill, 52);

const engine = makeEngine();
assert.deepEqual(engine.player.position, [684, 2316]);
assert.equal(engine.player.hp.ceil() > 0, true);
assert.equal(engine.lives, 3);
assert.equal(engine.introUntil, 3000);
assert.equal(engine.stage, 'ambush');
assert.equal(engine.gateIds.length, 3);

// -------------------------------------------------------------- 2. intro
const init = engine.drain();
assert.ok(has(init, 1550), 'S1550 self snapshot');
assert.ok(has(init, 1551), 'S1551 other list');
assert.ok(has(init, 1561), 'S1561 actor stats');
assert.equal(init.filter((frame) => frame[0] === 1556).length, 3, 'three gate objects');
assert.deepEqual(engine.tick(0), [], 'no battle tick during intro');
const intro = engine.advance(3000);
assert.equal(engine.now, 3000);
assert.equal(engine.npcs.size, 0, 'no npc before the ambush zone');
assert.equal(intro.filter((frame) => frame[0] === 1564).length, 0, 'no scene tick in quiet intro');

// -------------------------------------------------------------- 3. ambush
engine.player.position = [900, 1500]; // inside pve_ambush_zone [840,1464,456,168]
engine.player.motion = null;
const ambushFrames = engine.advance(50);
assert.equal(engine.ambushTriggered, true);
assert.equal(engine.npcs.size, 1);
const ambush = [...engine.npcs.values()][0];
assert.equal(ambush.template, 1109);
assert.equal(ambush.point, 27);
const ambushSpawn = ambushFrames.find((frame) => frame[0] === 1556);
assert.ok(ambushSpawn, 'S1556 for the ambush npc');
assert.equal(new DataView(ambushSpawn[1].buffer, ambushSpawn[1].byteOffset, ambushSpawn[1].byteLength)
  .getUint32(4 + 4, true), 1109, 'S1556 template id 1109');

// ------------------------------------------------- 4. waves 10/12 and boss
ambush.commitHp(ZERO, engine.now); // lethal, as the player would
const deathFrames = engine.advance(50);
assert.equal(engine.stage, 'waves');
assert.equal(engine.pendingSpawns.length, 5, 'two waves + boss');
assert.equal(engine.gatesOpen, true);
assert.ok(has(deathFrames, 1566), 'S1566 ambush kill');
const gateScene = deathFrames.filter((frame) => frame[0] === 1564)
  .map((frame) => sceneCounts(frame[1])).find((scene) => scene.counts[7] > 0);
assert.ok(gateScene && gateScene.counts[7] === 3, 'gate objects removed in S1564');

engine.advance(1000); // +1s: 1102 at points 10 and 12
let atPoint = (point, template) => engine.spawned.some(
  (record) => record.point === point && record.template === template);
assert.ok(atPoint(10, 1102), 'wave 10 first npc');
assert.ok(atPoint(12, 1102), 'wave 12 first npc');
engine.advance(1000); // +2s: 1115 at points 10 and 12
assert.ok(atPoint(10, 1115), 'wave 10 second npc');
assert.ok(atPoint(12, 1115), 'wave 12 second npc');
assert.equal([...engine.npcs.values()].filter((npc) => npc.alive).length, 4, 'four live wave npcs');
engine.advance(3000); // +5s: boss 1120 at point 6
assert.ok(atPoint(6, 1120), 'boss spawn');
assert.ok(engine.boss, 'boss actor tracked');
assert.equal(engine.boss.template, MAP201.bossTemplate);
assert.equal(engine.spawned.length, 6, 'ambush + two waves + boss');

// ------------------------------------ 5. active tick emits sane S1564 frames
const target = [...engine.npcs.values()].find((npc) => npc.template === 1102 && npc.alive);
assert.ok(target, 'a live 1102 for the combat tick');
const geometry = engine.arena.geometry;
const from = target.positionAt(engine.now);
const candidate = [[from[0], from[1] + 240], [from[0] + 240, from[1]],
  [from[0] - 240, from[1]], [from[0], from[1] - 240]]
  .find((point) => geometry.canWalkTo(point)
    && geometry.wallContact(from, point, 0) === null);
assert.ok(candidate, 'clear firing position near the npc');
engine.player.position = candidate;
engine.player.motion = null;
const combat = engine.advance(1600);
const scenes = combat.filter((frame) => frame[0] === 1564);
assert.ok(scenes.length > 0, 'combat tick emits S1564');
for (const [, body] of scenes) {
  assert.ok(body instanceof Uint8Array);
  const parsed = sceneCounts(body);
  assert.equal(parsed.total, parsed.length, 'S1564 vector counts match body length');
  assert.ok(parsed.counts.every((count) => count < 1024), 'S1564 counts are sane');
}
const fired = scenes.some(([, body]) => sceneCounts(body).counts[1] > 0);
assert.ok(fired, 'ai intent produced at least one projectile/laser');

// ---------------------------------------------- 6. scripted win settlement
assert.equal(engine.finished, false);
engine.boss.commitHp(ZERO, engine.now);
const winFrames = engine.advance(50);
assert.equal(engine.finished, true);
assert.equal(engine.won, true);
const winIds = ids(winFrames);
for (const id of [1707, 1104, 1708]) assert.ok(winIds.includes(id), `win frame ${id}`);
assert.ok(winIds.indexOf(1707) < winIds.indexOf(1104));
assert.ok(winIds.indexOf(1104) < winIds.indexOf(1708));
const settlement = winFrames.find((frame) => frame[0] === 1708);
assert.ok(settlement[1].byteLength > 40, 'S1708 carries player stats');
assert.deepEqual(engine.advance(500), [], 'finished engine is inert');
assert.deepEqual(engine.finish(true), [], 'finish is idempotent');
assert.equal(engine.drain().filter((frame) => frame[0] === 1708).length, 1,
  'settlement is recorded once');

// ---------------------------------------------- 7. scripted lose settlement
const loser = makeEngine({ runId: 'lose-run' });
loser.drain();
loser.advance(3000);
let loseFrames = [];
for (let life = 0; life < 3; life += 1) {
  loser.player.commitHp(ZERO, loser.now);
  loseFrames = loser.advance(50);
  if (life < 2) {
    assert.equal(loser.finished, false);
    assert.equal(loser.lives, 2 - life);
    loser.advance(5100); // Common PvE respawn is 5s
    assert.equal(loser.player.alive, true);
  }
}
assert.equal(loser.finished, true);
assert.equal(loser.won, false);
assert.equal(loser.lives, 0);
const loseIds = ids(loseFrames);
for (const id of [1707, 1104, 1708]) assert.ok(loseIds.includes(id), `lose frame ${id}`);
assert.ok(has(loseFrames, 1708));

console.log('PvE engine self-check OK');
console.log(JSON.stringify({
  map: m201.id,
  introMs: spec.introMs,
  lives: spec.lives,
  spawned: engine.spawned.map((s) => [s.point, s.template]),
  npcDeaths: engine.npcDeaths,
  playerDeaths: loser.deaths,
  win: engine.won,
  lose: loser.won,
}));
