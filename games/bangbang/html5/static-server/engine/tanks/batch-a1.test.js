/* Runnable batch-A1 self-check: node engine/tanks/batch-a1.test.js
 *
 * Loads the native rows in batch-a1-data.json, spawns each kit on map 101,
 * casts all four slots (0/E/Space/R), and checks cooldown packets, buffs,
 * projectiles and (for Naruto) the full energy -> vortex -> dash loop.
 * No test framework, no core edits.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BattleData } from '../data.js';
import { BattleArena } from '../arena.js';
import { decodeScenePacket } from '../../../scene_protocol.js';
import { decodeCombatPacket } from '../../../combat_protocol.js';
import { NarutoActions } from './naruto.js';
import { QuanVuActions } from './quanvu.js';
import { GundamActions } from './gundam.js';
import { IronManActions } from './ironman.js';
import { PandaActions } from './panda.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./batch-a1-data.json', import.meta.url), 'utf8'));

const CLASSES = {
  10000001: IronManActions,
  10000003: PandaActions,
  10000019: GundamActions,
  10000044: NarutoActions,
  10000056: QuanVuActions,
};

let checks = 0;
function check(name, fn) {
  try { fn(); checks += 1; }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}

function makeData() {
  const data = new BattleData({});
  data.addRows('TankBaseTemplate_table.xml', fixture.tankBase);
  data.addRows('TankUpTemplate_table.xml', fixture.tankUp);
  data.addRows('SkillTemplate_table.xml', fixture.skills);
  data.addRows('BuffTemplate_table.xml', fixture.buffs);
  data.addRows('EffectTemplate_table.xml', fixture.effects);
  return data;
}

function makeArena(tankId) {
  const clock = { now: 100000 };
  const state = {
    battle: { scene_id: 1234 },
    room: { map_id: 101, camp: 1 },
    char_id: 555, name: 'Tester', tank_id: tankId, tank_level: 1,
    spawns: { 1: [600, 612], 2: [780, 804] },
    // A silent Panda opponent: its on_spawn is neutral and never auto-casts.
    bot: { acct_id: 556, name: 'Bot', tank_id: 10000003, tank_level: 1, human: false, in_room: true },
  };
  const arena = new BattleArena(state, {
    clock: () => clock.now, rng: () => 0.99, data: makeData(), classes: CLASSES,
  });
  return {
    arena,
    clock,
    player: arena.player,
    bot: arena.bot,
    now: () => clock.now,
    tick(ms = 0) { clock.now += ms; return arena.tick(clock.now); },
  };
}

function wellFormed(packets) {
  return packets.every(p => Array.isArray(p) && p.length === 2
    && typeof p[0] === 'number' && p[1] instanceof Uint8Array);
}
function has(packets, id) { return packets.some(p => p[0] === id); }

/** Decode every S1564 packet and flatten its fires/skills/mp/shields. */
function scenes(packets) {
  const out = { fires: [], skills: [], mp: [], shields: [], moves: [] };
  for (const p of packets) {
    if (p[0] !== 1564) continue;
    const d = decodeScenePacket(1564, p[1]);
    out.fires.push(...d.fires);
    out.skills.push(...d.skills);
    out.mp.push(...d.mp);
    out.shields.push(...d.shields);
    out.moves.push(...d.moves);
  }
  return out;
}
function buffIds(packets) {
  return packets.map(([id, body]) => [id, body])
    .filter(([id]) => id === 1558)
    .map(([, body]) => decodeCombatPacket(1558, body).buff.templateId);
}
function cooldownSkills(packets) {
  return packets.filter(p => p[0] === 1572 || p[0] === 1579)
    .map(([id, body]) => decodeCombatPacket(id, body).skill.skillId);
}

// ---------------------------------------------------------------------------
// Naruto: full end-to-end (energy -> enhanced basic -> vortex -> dash).

check('Naruto spawn, chakra buffs and local cooldown packet', () => {
  const a = makeArena(10000044);
  const spawn = a.tick(0);
  assert.ok(a.player instanceof NarutoActions);
  assert.equal(a.player.mp, 100);
  assert.equal(a.player.hp.toFixed(3), '2575.000');
  assert.equal(a.player.hasBuff(318101, a.now()), true);
  assert.equal(a.player.hasBuff(318102, a.now()), true);
  assert.equal(a.player.hasBuff(318103, a.now()), true);
  assert.ok(has(spawn, 1558), 'missing S1558 spawn buffs');
  assert.ok(has(spawn, 1579), 'missing self S1579');
  assert.ok(wellFormed(spawn));
});

check('Naruto E gives four enhanced shots and spends 25 chakra', () => {
  const a = makeArena(10000044);
  a.tick(0);
  const packets = a.player.cast(1, a.player.positionAt(a.now()), [700, 612], 0, a.now());
  assert.ok(a.player.cooldowns[1] > a.now());
  assert.equal(a.player.shots, 4);
  assert.equal(a.player.hasBuff(318201, a.now()), true);
  assert.equal(a.player.hasBuff(318202, a.now()), true);
  assert.equal(a.player.mp, 75);
  assert.ok(has(packets, 1564), 'missing chakra S1564');
  assert.ok(cooldownSkills(packets).includes(318211));
  assert.ok(wellFormed(packets));
  const expired = a.tick(5200);
  assert.equal(a.player.hasBuff(318201, a.now()), false);
  assert.equal(a.player.shots, 0, 'remove_buff override did not reset shots');
  assert.ok(has(expired, 1579), 'natural expiry did not refresh the basic cooldown');
});

check('Naruto basic fires 318211, hits, drains MP and advances the E mark', () => {
  const a = makeArena(10000044);
  a.tick(0);
  a.player.cast(1, a.player.positionAt(a.now()), [700, 612], 0, a.now());
  const start = a.player.positionAt(a.now());
  const packets = a.player.cast(0, start, a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.ok(a.player.cooldowns[0] > a.now());
  const fired = scenes(packets).fires;
  assert.ok(fired.some(f => f.templateId === 318211), 'enhanced bullet not fired');
  assert.equal(a.player.shots, 3);
  const botHp = a.bot.hp.toNumber();
  const after = a.tick(600);
  assert.ok(a.bot.hp.toNumber() < botHp, 'enhanced bullet never hit');
  assert.equal(a.player.mp, 80);
  assert.equal(a.bot.hasBuff(318212, a.now()), true);
  const markKey = `${a.player.generation},${a.bot.id},${a.bot.generation}`;
  assert.equal(a.player.e_hits.has(markKey), true, 'combo mark was not stored');
  const cleanse = a.bot.cleanse(a.now());
  assert.equal(a.player.e_hits.has(markKey), false, 'core cleanse did not drop the tuple mark');
  assert.ok(has(cleanse, 1559) || cleanse.length === 0);
  assert.ok(has(after, 1564));
  assert.ok(wellFormed(after));
});

check('Naruto Space spawns a vortex that ticks and expires', () => {
  const a = makeArena(10000044);
  a.tick(0);
  const start = a.player.positionAt(a.now());
  const packets = a.player.cast(2, start, a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(a.player.cooldowns[2] > a.now());
  assert.ok(a.player.ready, 'Space did not arm');
  assert.equal(a.player.mp, 50);
  assert.ok(has(packets, 1564));
  assert.ok(has(packets, 1572));
  const armed = a.tick(500);
  assert.equal(a.player.ready, null);
  const shot = scenes(armed).fires.some(f => f.templateId === 318301);
  assert.ok(shot || a.arena.pending.length > 0, 'Space did not fire');
  const landed = a.tick(600);
  assert.equal(a.arena.objects.size, 1, 'vortex object missing');
  assert.equal(a.player.fields.size, 1, 'vortex field missing');
  assert.ok(has(landed, 1556), 'missing S1556 vortex add');
  assert.ok(a.bot.hasBuff(318302, a.now()) || a.bot.hasBuff(318303, a.now()),
    'vortex never applied its opening mark');
  const ticked = a.tick(500);
  assert.ok(a.bot.hasBuff(318311, a.now()) || a.bot.hasBuff(318313, a.now()),
    'vortex tick never applied its mark');
  assert.ok(has(ticked, 1564));
  const expired = a.tick(5200);
  assert.equal(a.arena.objects.size, 0, 'vortex object did not expire');
  assert.equal(a.player.fields.size, 0, 'vortex field did not clear');
  assert.ok(has(expired, 1564));
  assert.ok(a.player.mp >= 0 && a.player.mp <= 100);
});

check('Naruto R dash connects, knocks back and clears its dash buff', () => {
  const a = makeArena(10000044);
  a.tick(0);
  const start = a.player.positionAt(a.now());
  const packets = a.player.cast(10, start, a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(a.player.cooldowns[10] > a.now());
  assert.ok(a.player.dash, 'dash state missing');
  assert.equal(a.player.hasBuff(318402, a.now()), true);
  assert.equal(a.player.hasBuff(318416, a.now()), true);
  assert.ok(wellFormed(packets));
  const after = a.tick(2000);
  assert.equal(a.player.dash, null);
  assert.equal(a.player.hasBuff(318416, a.now()), false);
  const skillIds = scenes(after).skills.map(s => s.skillId);
  assert.ok(skillIds.includes(318411), 'dash impact packet missing');
  assert.ok(a.bot.hp.lt(a.bot.maxHp), 'dash dealt no damage');
});

// ---------------------------------------------------------------------------
// Quan Vu: Q, E dash, Space execute/pull, R charge shockwave.

check('Quan Vu levels every slot, buffers and consumes R charges', () => {
  const a = makeArena(10000056);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof QuanVuActions);
  assert.equal(p.r_count, 3);

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.ok(p.cooldowns[0] > a.now());
  assert.ok(has(q, 1564));
  a.tick(700);

  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.cooldowns[1] > a.now());
  assert.equal(p.hasBuff(331202, a.now()), true);
  assert.equal(p.hasBuff(331206, a.now()), true);
  assert.ok(p.e_second_until > a.now());
  assert.ok(p.motion, 'dash motion missing');
  assert.ok(cooldownSkills(e).includes(331211));
  a.tick(500);

  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.ok(p.cooldowns[2] > a.now());
  assert.ok(cooldownSkills(space).includes(331301));
  assert.equal(p.hasBuff(331304, a.now()), true);
  assert.ok(p.cooldowns[1] > a.now());
  a.tick(400);

  const cdE = p.cooldowns[1];
  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.r_count, 2);
  assert.ok(p.cooldowns[10] > a.now());
  assert.ok(cooldownSkills(r).includes(331221));
  assert.ok(p.hasBuff(331224, a.now()), 'R did not land on the pulled target');
  assert.ok(p.cooldowns[1] <= cdE);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(space) && wellFormed(r));
});

// ---------------------------------------------------------------------------
// Gundam: Q combo mark, E missile salvo, Space laser, R recoil.

check('Gundam levels every slot and applies its native effects', () => {
  const a = makeArena(10000019);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof GundamActions);

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.ok(p.cooldowns[0] > a.now());
  const fired = scenes(q).fires;
  assert.ok(fired.some(f => f.templateId === 302600));
  a.tick(700);
  assert.ok(a.bot.hasBuff(302601, a.now()), 'basic did not start the combo');
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.ok(p.cooldowns[1] > a.now());
  assert.ok(cooldownSkills(e).includes(302701));
  const salvo = a.tick(2200);
  const missiles = scenes(salvo).fires.filter(f => f.templateId === 302701);
  assert.ok(missiles.length >= 4, `expected 4 missiles, got ${missiles.length}`);

  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.cooldowns[2] > a.now());
  assert.ok(p.ready !== null, 'laser did not arm');
  const hpBefore = a.bot.hp.toNumber();
  const beam = a.tick(600);
  assert.equal(p.ready, null);
  assert.ok(scenes(beam).skills.some(s => s.skillId === 302801));
  assert.ok(a.bot.hp.toNumber() < hpBefore, 'laser missed a lined-up target');

  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.cooldowns[10] > a.now());
  assert.ok(p.motion, 'recoil motion missing');
  assert.ok(cooldownSkills(r).includes(302901));
  a.tick(1000);
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(space) && wellFormed(r));
});

// ---------------------------------------------------------------------------
// Iron Man: shield, rocket area, beam channel, missile buffs.

check('Iron Man spawns with shield and levels every slot', () => {
  const a = makeArena(10000001);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof IronManActions);
  assert.ok(p.shieldAmount(a.now()).gt(0), 'passive shield missing');
  assert.equal(p.hasBuff(363102, a.now()), true);
  assert.ok(has(spawn, 1564));

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.ok(p.cooldowns[0] > a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = p.cast(1, p.positionAt(a.now()), [700, 612], 0, a.now());
  assert.ok(p.cooldowns[1] > a.now());
  assert.ok(p.ready, 'rocket did not arm');
  assert.ok(cooldownSkills(e).includes(363201));
  a.tick(250);
  assert.equal(p.ready, null);
  assert.equal(a.arena.objects.size, 1, 'rocket area object missing');

  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.ok(p.cooldowns[10] > a.now());
  assert.ok(p.ready, 'missile did not arm');
  const hit = a.tick(1000);
  assert.equal(p.ready, null);
  assert.ok(a.bot.hasBuff(363402, a.now()), 'missile rider buff missing');
  assert.ok(has(hit, 1564));

  const space = p.cast(2, p.positionAt(a.now()), [700, 612], 0, a.now());
  assert.ok(p.cooldowns[2] > a.now());
  assert.ok(p.ready, 'beam did not arm');
  const open = a.tick(120);
  assert.ok(p.channel !== null, 'beam channel missing');
  assert.equal(p.hasBuff(363301, a.now()), true);
  assert.equal(p.hasBuff(363309, a.now()), true);
  assert.ok(has(open, 1564));
  a.tick(2000);
  a.tick(2500);
  assert.equal(p.channel, null, 'channel end did not interrupt');
  assert.equal(p.hasBuff(363301, a.now()), false);
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(r) && wellFormed(space));
});

// ---------------------------------------------------------------------------
// Panda: Q lifesteal rider, E stomp shield, Space aura, R roll.

check('Panda levels every slot and runs the aura/roll lifecycles', () => {
  const a = makeArena(10000003);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof PandaActions);

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.ok(p.cooldowns[0] > a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 301100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = p.cast(1, p.positionAt(a.now()), [700, 612], 0, a.now());
  assert.ok(p.cooldowns[1] > a.now());
  assert.ok(p.ready, 'stomp did not arm');
  const armored = a.tick(150);
  assert.equal(p.ready, null);
  assert.ok(p.shieldAmount(a.now()).gt(0), 'stomp shield missing');
  assert.equal(p.hasBuff(301201, a.now()), true);
  assert.ok(scenes(armored).skills.some(s => s.skillId === 301201));

  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.ok(p.cooldowns[2] > a.now());
  assert.ok(p.ready, 'Space did not arm');
  const aura = a.tick(150);
  assert.ok(p.aura, 'aura missing');
  assert.equal(p.hasBuff(301303, a.now()), true);
  assert.equal(p.hasBuff(301305, a.now()), true);
  assert.equal(p.hasBuff(301306, a.now()), true);
  assert.equal(a.bot.hasBuff(301302, a.now()), true);
  assert.ok(scenes(aura).moves.length > 0);
  a.tick(5200);
  assert.equal(p.aura, null, 'aura did not end');

  // Space parks the body on the target, so aim the roll away from it.
  const [bx, by] = a.bot.positionAt(a.now());
  const r = p.cast(10, p.positionAt(a.now()), [bx + 200, by], 0, a.now());
  assert.ok(p.cooldowns[10] > a.now());
  assert.ok(p.roll, 'roll state missing');
  assert.equal(p.hasBuff(301403, a.now()), true);
  a.tick(700);
  assert.equal(p.roll, null, 'roll did not finish');
  assert.equal(p.hasBuff(301403, a.now()), false);
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(space) && wellFormed(r));
});

console.log(`batch-a1 tanks: ${checks} checks passed`);
