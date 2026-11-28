// Runnable self-check for the PvP engine on the real browser catalogs.
// Run: node games/bangbang/html5/static-server/engine/pvp/pvp-engine.test.js
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { M6_PARTS } from '../pve-data.js';
import { createData } from '../data.js';
import { D } from '../math.js';
import { decodeCombatPacket } from '../../../combat_protocol.js';
import { decodeScenePacket } from '../../../scene_protocol.js';
import { PvpEngine } from './pvp-engine.js';
import { modeForMap } from './modes.js';

// --------------------------------------------------------------- catalogs
const html5 = new URL('../../../', import.meta.url);
const read = (name) => readFile(new URL(name, html5), 'utf8');
const readJson = async (name) => JSON.parse(await read(name));

const m6 = JSON.parse((await Promise.all(M6_PARTS.map((name) => read(name)))).join(''));
const garage = await readJson('m8_garage_catalog.json');
const pk = await readJson('m89_pk_catalog.json');
const modes = await readJson('m810_modes_catalog.json');
const death = await readJson('m811_death_catalog.json');
const worldboss = await readJson('m81330_worldboss_catalog.json');

/** Same merge shape as m89/m810's merge*Catalog: bindings + maps only. */
function merge(assets, catalog) {
  for (const [table, rows] of Object.entries(catalog.bindings || {})) {
    assets[table] = { ...(assets[table] || {}), ...rows };
  }
  for (const [id, map] of Object.entries(catalog.maps || {})) assets.maps[id] = map;
}
merge(m6, pk);
merge(m6, modes);
merge(m6, death);
merge(m6, worldboss);
const data = createData({ garage, assets: m6 });

function lcg(seed) {
  let state = seed >>> 0;
  return {
    next() { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; },
    uniform(low, high) { return low + this.next() * (high - low); },
    gauss(mean, sd) { return mean + sd * Math.sqrt(-2 * Math.log(1 - this.next())); },
    choice(list) { return list[Math.floor(this.next() * list.length)]; },
  };
}

const teams = (camp1, camp2) => ({
  1: camp1.map((tankId) => ({ tankId, tankLevel: 1, human: false })),
  2: camp2.map((tankId) => ({ tankId, tankLevel: 1, human: false })),
});
const ids = (frames) => frames.map((frame) => frame[0]);
const has = (frames, id) => frames.some((frame) => frame[0] === id);
const only = (frames, id) => frames.filter((frame) => frame[0] === id);
const SCENE_IDS = new Set([1550, 1551, 1552, 1554, 1564, 1586]);
const decode = (msgId, body) => (SCENE_IDS.has(msgId)
  ? decodeScenePacket(msgId, body) : decodeCombatPacket(msgId, body));

// -------------------------------------------------------- 1. mode catalog
assert.equal(modeForMap(4).kind, 'kill');
assert.equal(modeForMap(4).killScore, 25);
assert.equal(modeForMap(9).kind, 'occupy');
assert.equal(modeForMap(9).winScore, 1000);
assert.equal(modeForMap(70).kind, 'escort');
assert.equal(modeForMap(12).kind, 'base');
assert.equal(modeForMap(30).kind, 'death');
assert.equal(modeForMap(30).rounds, 2);
assert.equal(modeForMap(40002).kind, 'world_boss');
assert.equal(modes.maps['9'].flags.length, 3);
assert.equal(modes.maps['70'].bombCarts.length, 2);
assert.ok(modes.maps['12'].staticNPCs.some((npc) => npc.base));

// ----------------------------------------------- 2. 5v5 bot deathmatch
const deathmatch = new PvpEngine({
  map: m6.maps['4'], data, rng: lcg(11), sceneId: 904, runId: 'pvp-dm',
  mode: { killScore: 2 },
  teams: teams(
    [10000001, 10000003, 10000019, 10000056, 10000044],
    [10000031, 10000065, 10000034, 10000042, 10000041],
  ),
});
assert.equal(deathmatch.mapId, 4);
assert.equal(deathmatch.modeDef.kind, 'kill');
assert.equal(deathmatch.arena.actors.size >= 10, true);
assert.equal(deathmatch.pk.stats.size, 10);
assert.equal(deathmatch.botIds.size, 10, 'all ten slots are bots');
assert.equal(deathmatch.teams[1].length, 5);
assert.equal(deathmatch.teams[2].length, 5);
assert.equal(deathmatch.player.camp, 1);
assert.deepEqual(deathmatch.player.position,
  deathmatch.arena.geometry.spawn(1, 0));
for (const camp of [1, 2]) {
  for (const actor of deathmatch.teams[camp]) {
    assert.ok(actor.hp.ceil() > 0, `actor ${actor.id} spawned with HP`);
    assert.equal(actor.alive, true);
  }
}

const init = deathmatch.drain();
assert.ok(has(init, 1550), 'S1550 self snapshot');
assert.ok(has(init, 1551), 'S1551 roster');
assert.ok(has(init, 1561), 'S1561 scoreboard stats');
const others = decode(1551, only(init, 1551)[0][1]).actors;
assert.equal(others.length, 9, 'S1551 carries the other nine slots');
const stats = decode(1561, only(init, 1561)[0][1]).actors;
assert.equal(stats.length, 10);
assert.ok(stats.every((row) => row.stats.length === 21));

assert.deepEqual(deathmatch.tick(0), [], 'intro gate');
assert.equal(deathmatch.advance(2950).filter((f) => f[0] === 1564).length, 0,
  'no battle tick before the intro gate');
deathmatch.advance(50);
assert.equal(deathmatch.now, 3000);

const active = deathmatch.advance(7000);
const scenes = only(active, 1564);
assert.ok(scenes.length > 0, 'active sim emits S1564');
let moves = 0, fires = 0, skills = 0;
for (const [, body] of scenes) {
  const decoded = decode(1564, body);
  moves += decoded.moves.length;
  fires += decoded.fires.length;
  skills += decoded.skills.length;
}
assert.ok(moves > 0, 'bots walk toward the enemy');
assert.ok(fires + skills > 0, 'bots cast through real tank kits');
for (const [, body] of scenes) {
  const decoded = decode(1564, body);
  assert.ok(decoded.trailingBytes === 0, 'S1564 body length matches vectors');
}

// Force two credited finishes so the score/result path is deterministic.
const killer = deathmatch.arena.actors.get(2);
assert.ok(killer && killer.alive);
const killOne = (victimId) => {
  const victim = deathmatch.arena.actors.get(victimId);
  assert.ok(victim && victim.alive);
  return killer.damage(D('9999999'), deathmatch.now,
    { target: victim, school: 'true' })[0];
};
const first = killOne(7);
assert.equal(deathmatch.arena.actors.get(7).alive, false);
assert.equal(deathmatch.pk.scores[1], 1, 'first kill scores camp 1');
const victimStats = deathmatch.pk.stats.get(7);
const killerStats = deathmatch.pk.stats.get(2);
assert.equal(victimStats[0], 1, 'victim death stat');
assert.equal(killerStats[1], 1, 'killer kill stat');
assert.equal(killerStats[6] > 0, true, 'killer damage stat');
assert.ok(has(first, 1566), 'S1566 kill info');
assert.ok(has(first, 1710), 'S1710 camp score');
assert.ok(has(first, 1561), 'S1561 refreshed stats');
const kill = decode(1566, only(first, 1566)[0][1]);
assert.equal(kill.killerId, 2);
assert.equal(kill.victimId, 7);
assert.equal(kill.firstBlood, 1);
assert.equal(deathmatch.finished, false);

const second = killOne(8);
assert.equal(deathmatch.pk.scores[1], 2);
assert.equal(deathmatch.finished, true, 'kill limit ends the match');
assert.equal(deathmatch.pk.winner, 1);
assert.ok(has(second, 1707), 'S1707 scene exit');
assert.ok(has(second, 1708), 'S1708 settlement');
const settlement = decode(1708, only(second, 1708)[0][1]);
assert.equal(settlement.winCamp, 1);
assert.equal(settlement.mapId, 4);
assert.equal(settlement.actors.length, 10);
assert.equal(settlement.redLifeCount, 2);
assert.ok(settlement.victoryMvpId > 0);
assert.ok(settlement.actors.some((row) => row.isWin === 1 && row.camp === 1));
assert.ok(settlement.actors.every((row) => row.stats.length === 21));
assert.deepEqual(deathmatch.advance(500), [], 'finished engine is inert');

// ------------------------------------- 2b. kill -> 5s respawn packets
const respawn = new PvpEngine({
  map: m6.maps['4'], data, rng: lcg(15), sceneId: 905, runId: 'pvp-respawn',
  botsEnabled: false, mode: { introMs: 0 },
  teams: teams([10000001], [10000003]),
});
respawn.drain();
respawn.advance(50);
const downed = respawn.arena.actors.get(2);
const deathFrames = downed.commitHp(D('0'), respawn.now);
respawn.advance(50);
assert.equal(downed.alive, false);
assert.ok(has(deathFrames, 1553), 'S1553 relive delay');
const respawned = respawn.advance(5100);
assert.equal(downed.alive, true, 'bot respawns after 5s');
assert.ok(has(respawned, 1552), 'S1552 tank add on respawn');
assert.ok(downed.hp.ceil() > 0);

// ------------------------------------------------- 3. occupy objective mode
const occupy = new PvpEngine({
  map: m6.maps['9'], data, rng: lcg(21), sceneId: 909, runId: 'pvp-occupy',
  botsEnabled: false,
  teams: teams([10000019], [10000001]),
});
assert.equal(occupy.modeDef.kind, 'occupy');
const occupyInit = occupy.drain();
const flagsInit = decode(1565, only(occupyInit, 1565)[0][1]);
assert.equal(flagsInit.flags.length, 3);
assert.ok(flagsInit.flags.every((flag) => flag.camp === 0));
occupy.advance(3000);
const flag = occupy.mode.flags[0];
const holder = occupy.arena.actors.get(1);
holder.position = [...flag.position];
holder.motion = null;
const enemy = occupy.arena.actors.get(2);
enemy.position = [...occupy.arena.geometry.spawn(2, 0)];
enemy.motion = null;
const capture = occupy.advance(6500);
assert.equal(flag.camp, 1, 'flag captured after capture_ms');
assert.ok(has(capture, 1565), 'S1565 occupy snapshot');
assert.ok(has(capture, 1732), 'S1732 add-score');
const added = decode(1732, only(capture, 1732)[0][1]);
assert.equal(added.camp, 1);
assert.equal(added.index, flag.index);
assert.ok(added.score > 0);
assert.ok(occupy.pk.scores[1] > 0);
const lastFlags = decode(1565, only(capture, 1565).at(-1)[1]).flags;
assert.equal(lastFlags.find((row) => row.index === flag.index).camp, 1);

// -------------------------------------------- 4. death rounds and reset
const deathMode = new PvpEngine({
  map: m6.maps['30'], data, rng: lcg(31), sceneId: 930, runId: 'pvp-death',
  botsEnabled: false,
  teams: teams([10000001], [10000003]),
});
assert.equal(deathMode.modeDef.kind, 'death');
assert.equal(deathMode.pk.round_phase, 'playing');
deathMode.advance(3000);
const loser = deathMode.arena.actors.get(2);
loser.commitHp(D('0'), deathMode.now);
const roundEnd = deathMode.advance(100);
assert.equal(deathMode.pk.round_phase, 'result');
assert.equal(deathMode.pk.scores[1], 1);
assert.ok(has(roundEnd, 1735), 'S1735 round result');
assert.ok(has(roundEnd, 1736), 'S1736 alive counts');
const roundReset = deathMode.advance(5000);
assert.equal(deathMode.pk.round_phase, 'playing');
assert.ok(has(roundReset, 1734), 'S1734 next round');
assert.equal(deathMode.pk.round_number, 2);

// ---------------------------------------------- 4b. base mode map objects
const base = new PvpEngine({
  map: m6.maps['12'], data, rng: lcg(35), sceneId: 912, runId: 'pvp-base',
  mode: { introMs: 0 },
  teams: teams([10000001], [10000003]),
});
assert.equal(base.modeDef.kind, 'base');
assert.equal(base.mode.bases.length, 2, 'both bases instantiated');
assert.ok(base.mode.bases.every((actor) => actor.info.base && actor.alive));
assert.ok(base.mode.turrets.length > 0, 'base turrets instantiated');
const baseInit = base.drain();
assert.ok(only(baseInit, 1556).length >= 4, 'S1556 base/turret objects');
assert.equal(base.mode.winner(base.now), 0, 'equal base HP is a draw');
const baseFight = base.advance(4000);
assert.ok(only(baseFight, 1564).length > 0, 'base bots run the sieging policy');
assert.ok(base.mode.bases.some((actor) => actor.info.base));

// ------------------------------------------------- 5. escort mode install
const escort = new PvpEngine({
  map: m6.maps['70'], data, rng: lcg(41), sceneId: 970, runId: 'pvp-escort',
  botsEnabled: false, mode: { introMs: 0 },
  teams: teams([10000001], [10000003]),
});
assert.equal(escort.modeDef.kind, 'escort');
assert.equal(escort.mode.carts.length, 2);
assert.equal(escort.mode.missing.length, 0);
const escortInit = escort.drain();
assert.ok(only(escortInit, 1556).length >= 2, 'S1556 for both bomber carts');

// ---------------------------------------- 5b. room roster config (bot_setup)
const room = new PvpEngine({
  map: m6.maps['4'], data, rng: lcg(45), sceneId: 945, runId: 'pvp-room',
  botsEnabled: false, mode: { introMs: 0 },
  bots: [
    { object_id: 1, camp: 1, tank_id: 10000056, tank_level: 5, human: false },
    { object_id: 2, camp: 2, tank_id: 10000031, tank_level: 4 },
  ],
});
assert.equal(room.player.id, 1);
assert.equal(room.player.info.tank_id, 10000056);
assert.equal(room.teams[1].length, 1);
assert.equal(room.teams[2].length, 1);
assert.equal(room.teams[2][0].info.tank_id, 10000031);
assert.equal(room.botIds.size, 2);

// ------------------------------------ 6. world-boss geometry + data guard
const boss = new PvpEngine({
  map: m6.maps['40002'], data, rng: lcg(51), sceneId: 9002, runId: 'pvp-boss',
  botsEnabled: false,
  teams: { 1: [{ tankId: 10000001, tankLevel: 1, human: false }], 2: [] },
});
assert.equal(boss.mapId, 40002);
assert.equal(boss.modeDef.kind, 'world_boss');
assert.equal(boss.modeDef.settlement, false);
assert.deepEqual(boss.player.position, [636, 756]);
assert.ok(boss.mode.missing.length > 0,
  'boss spawn graph/shared HP ledger is a documented server-only gap');
assert.ok(has(boss.drain(), 1550));

console.log('PvP engine self-check OK');
console.log(JSON.stringify({
  modes: [...new Set([1, 4, 7, 9, 10, 12, 14, 17, 18, 19, 20, 21, 30, 34,
    35, 36, 37, 40, 50, 70, 169, 170, 40002].map((id) => modeForMap(id).kind))],
  deathmatch: {
    actors: deathmatch.arena.actors.size,
    sceneFrames: scenes.length,
    moves, fires, skills,
    kills: deathmatch.pk.scores,
    winner: deathmatch.pk.winner,
  },
  occupy: { flags: occupy.mode.flags.length, scores: occupy.pk.scores },
  death: { rounds: deathMode.pk.round_number, scores: deathMode.pk.scores },
  escort: { carts: escort.mode.carts.length },
}));
