/* Runnable batch-E self-check: node engine/tanks/batch-e.test.js
 *
 * Loads the native rows in batch-e-data.json, spawns each kit on map 101,
 * and asserts its spawn state, slot behaviour, buffs, projectiles and the
 * signature loops (forms, summons, domains, traps, links, burrow, etc.).
 * No test framework, no core edits.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BattleData } from '../data.js';
import { BattleArena } from '../arena.js';
import { D } from '../math.js';
import { decodeScenePacket } from '../../../scene_protocol.js';
import { decodeCombatPacket } from '../../../combat_protocol.js';
import { OptimusActions } from './optimus.js';
import { NezhaActions } from './nezha.js';
import { AngelActions } from './angel.js';
import { DeadpoolActions } from './deadpool.js';
import { KanekiActions } from './kaneki.js';
import { HadesActions } from './hades.js';
import { SasukeActions, SasukeShadow } from './sasuke.js';
import { PumpkinActions, PumpkinGhost } from './pumpkin.js';
import { KurumiActions, KurumiClone } from './kurumi.js';
import { DarkKnightActions } from './darkknight.js';
import { WolfActions } from './wolf.js';
import { ShadowbladeActions } from './shadowblade.js';
import { StoneGodActions } from './stonegod.js';
import { AquamanActions } from './aquaman.js';
import { NightWingActions } from './nightwing.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./batch-e-data.json', import.meta.url), 'utf8'));

const CLASSES = {
  10000062: OptimusActions,
  10000082: NezhaActions,
  10000061: AngelActions,
  10000070: DeadpoolActions,
  10000076: KanekiActions,
  10000092: HadesActions,
  10000093: SasukeActions,
  10000052: PumpkinActions,
  10000095: KurumiActions,
  10000030: DarkKnightActions,
  10000040: WolfActions,
  10000108: ShadowbladeActions,
  10000109: StoneGodActions,
  10000110: AquamanActions,
  10000114: NightWingActions,
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
    spawns: { 1: [600, 612], 2: [780, 660] },
    // A quiet Kaneki opponent: only its spawn buff runs, no auto-cast.
    bot: { acct_id: 556, name: 'Bot', tank_id: 10000076, tank_level: 1, human: false, in_room: true },
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
  return packets.filter(([id]) => id === 1558)
    .map(([, body]) => decodeCombatPacket(1558, body).buff.templateId);
}
function cooldownSkills(packets) {
  return packets.filter(p => p[0] === 1572 || p[0] === 1579)
    .map(([id, body]) => decodeCombatPacket(id, body).skill.skillId);
}

// ---------------------------------------------------------------------------
// Optimus: rage, sword area, timed melee form.

check('Optimus spawn, rage tick, Q/R and melee form', () => {
  const a = makeArena(10000062);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof OptimusActions);
  assert.equal(p.hasBuff(8190101, a.now()), true);
  assert.ok(has(spawn, 1558) && has(spawn, 1579));
  assert.ok(wellFormed(spawn));
  a.tick(700);
  assert.equal(p.mp, 0, 'rage decayed below zero');
  p.onDamage(null, { hp_loss: D(10) }, a.now());
  assert.equal(p.mp, 5, 'rage did not gain from damage');
  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 819010));
  a.tick(600);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.cooldowns[1] > a.now());
  assert.equal(p.hasBuff(8190215, a.now()), true);
  assert.ok(has(e, 1564));
  const r = p.cast(10, p.positionAt(a.now()), [700, 612], 0, a.now());
  assert.equal(p.swords.length, 1);
  assert.ok(has(r, 1556));
  a.tick(600);
  assert.ok(a.arena.objects.size >= 1 || p.swords.length === 1);
  p.mp = 100;
  const space = p.cast(2, p.positionAt(a.now()), [650, 612], 0, a.now());
  assert.ok(p.form, 'melee form did not start');
  assert.equal(p.hasBuff(8190311, a.now()), true);
  assert.equal(p.hasBuff(8190115, a.now()), false);
  const mq = p.cast(0, p.positionAt(a.now()), [a.bot.positionAt(a.now())[0], a.bot.positionAt(a.now())[1]],
    0, a.now());
  assert.ok(scenes(mq).skills.some(s => s.skillId === 819012 || s.skillId === 819013));
  a.tick(8100);
  assert.equal(p.form, null);
  assert.equal(p.hasBuff(8190321, a.now()), true);
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(r) && wellFormed(space) && wellFormed(mq));
});

// ---------------------------------------------------------------------------
// Nezha: rings, follow-up E, three-head form.

check('Nezha spawn, Q/E follow-up, R ring and form landing', () => {
  const a = makeArena(10000082);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof NezhaActions);
  assert.equal(p.hasBuff(356101, a.now()), true);
  assert.ok(has(spawn, 1579));
  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 356100));
  a.tick(600);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.e_follow);
  assert.ok(p.ready);
  assert.equal(p.hasBuff(356205, a.now()), true);
  assert.ok(cooldownSkills(e).includes(356211));
  a.tick(60);
  assert.equal(p.ready, null, 'E windup did not resolve');
  const follow = p.cast(1, p.positionAt(a.now()), [680, 612], 0, a.now());
  assert.equal(p.e_follow, null);
  assert.ok(p.motion);
  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.cooldowns[10] > a.now());
  assert.ok(has(r, 1564));
  a.tick(600);
  const hpBefore = p.maxHp;
  const space = p.cast(2, p.positionAt(a.now()), [680, 612], 0, a.now());
  assert.ok(p.ready);
  assert.ok(has(space, 1556));
  a.tick(150);
  assert.ok(p.form);
  assert.equal(p.info.untargetable, true);
  a.tick(1000);
  assert.equal(p.form.landed, true);
  assert.ok(p.maxHp.gt(hpBefore), 'form did not raise max HP');
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(follow) && wellFormed(r) && wellFormed(space));
});

// ---------------------------------------------------------------------------
// Angel: light/fallen switch, pull and sanctuary.

check('Angel spawn, switch to fallen, pull and sanctuary', () => {
  const a = makeArena(10000061);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof AngelActions);
  assert.equal(p.hasBuff(336401, a.now()), true);
  assert.ok(has(spawn, 1558));
  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 336100));
  a.tick(600);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const r = p.cast(10, p.positionAt(a.now()), [680, 612], 0, a.now());
  assert.equal(p.fallen, true);
  assert.ok(p.motion);
  assert.equal(p._skill(0), 336500);
  assert.equal(p.hasBuff(336101, a.now()), true);
  assert.equal(p.cooldowns[1], 0);
  p.cooldowns[0] = 0;
  const fq = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(scenes(fq).fires.some(f => f.templateId === 336500));
  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.ready);
  assert.ok(has(e, 1564));
  const pull = a.tick(600);
  assert.equal(p.ready, null);
  assert.ok(scenes(pull).skills.some(s => s.skillId === 336601));
  const fallenSpace = p.cast(2, p.positionAt(a.now()), [680, 612], 0, a.now());
  assert.equal(p._skill(2), 336701);
  assert.ok(cooldownSkills(fallenSpace).includes(336701));
  assert.ok(has(fallenSpace, 1564));
  p.cooldowns[10] = 0;
  p.cooldowns[2] = 0;
  p.cast(10, p.positionAt(a.now()), [650, 612], 0, a.now());
  assert.equal(p.fallen, false);
  const space = p.cast(2, p.positionAt(a.now()), [680, 612], 0, a.now());
  assert.ok(p.sanctuary);
  assert.ok(has(space, 1564));
  a.tick(1100);
  assert.equal(p.sanctuary, null);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(q) && wellFormed(r) && wellFormed(fq) && wellFormed(e)
    && wellFormed(fallenSpace) && wellFormed(space));
});

// ---------------------------------------------------------------------------
// Deadpool: mark follow-up, push and one rescue per R.

check('Deadpool mark, recast, push and R rescue', () => {
  const a = makeArena(10000070);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof DeadpoolActions);
  assert.ok(has(spawn, 1579));
  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 344100));
  a.tick(600);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.cooldowns[1] > a.now());
  a.tick(600);
  assert.equal(a.bot.hasBuff(344211, a.now()), true);
  assert.ok(p.mark, 'mark missing');
  const recast = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.ok(p.ready, 'recast did not arm');
  assert.ok(scenes(recast).skills.some(s => s.skillId === 344202));
  a.tick(60);
  assert.equal(p.ready, null);
  assert.equal(p.hasBuff(344204, a.now()), true);
  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.ok(p.cooldowns[2] > a.now());
  assert.equal(a.bot.hasBuff(344303, a.now()), true);
  a.tick(400);
  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.hasBuff(344101, a.now()), true);
  assert.ok(has(r, 1564));
  const rescue = p.commitHp(D(0), a.now());
  assert.ok(p.rebirth, 'rescue did not trigger');
  assert.equal(p.alive, true);
  assert.equal(p.info.untargetable, true);
  assert.ok(wellFormed(rescue));
  a.tick(1100);
  assert.equal(p.rebirth, null);
  assert.ok(p.hp.gt(0));
  assert.equal(p.hasBuff(344112, a.now()), true);
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(recast) && wellFormed(space) && wellFormed(r));
});

// ---------------------------------------------------------------------------
// Kaneki: HP costs, heal stacks, regen.

check('Kaneki spawn, Q/E/R hp costs and regen', () => {
  const a = makeArena(10000076);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof KanekiActions);
  assert.equal(p.hasBuff(350101, a.now()), true);
  assert.ok(has(spawn, 1558));
  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 350100));
  a.tick(600);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const hp1 = p.hp;
  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.hp.lt(hp1), 'E did not spend HP');
  assert.ok(has(e, 1564));
  a.tick(700);
  assert.equal(a.bot.hasBuff(350215, a.now()), true);
  const hp2 = p.hp;
  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.r_count, 1);
  assert.ok(p.hp.lt(hp2), 'R did not spend HP');
  assert.equal(a.bot.hasBuff(350405, a.now()), true);
  const hp3 = p.hp;
  const space = p.cast(2, p.positionAt(a.now()), [680, 612], 0, a.now());
  assert.equal(p.hasBuff(350301, a.now()), true);
  assert.equal(p.hasBuff(350302, a.now()), true);
  assert.equal(p.hasBuff(350303, a.now()), true);
  a.tick(600);
  assert.ok(p.hp.gt(hp3), 'regen did not heal');
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(r) && wellFormed(space));
});

// ---------------------------------------------------------------------------
// Hades: ranged/melee switch, vanish + fear domain.

check('Hades spawn, E marks, vanish domain and melee switch', () => {
  const a = makeArena(10000092);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof HadesActions);
  assert.ok(has(spawn, 1579));
  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 367100));
  a.tick(600);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.equal(a.bot.hasBuff(367102, a.now()), true);
  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.cooldowns[1] > a.now());
  assert.ok(has(e, 1564));
  a.tick(100);
  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.ok(p.ready);
  a.tick(20);
  assert.ok(p.vanish);
  assert.equal(p.info.untargetable, true);
  a.tick(1000);
  assert.equal(p.vanish, null);
  assert.equal(p.domains.size, 1);
  assert.ok(a.arena.objects.size >= 1);
  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.melee, true);
  assert.equal(p.hasBuff(367401, a.now()), true);
  assert.equal(p.hasBuff(367501, a.now()), false);
  p.cooldowns[0] = 0;
  const mq = p.cast(0, p.positionAt(a.now()), [880, 660], 0, a.now());
  assert.ok(scenes(mq).skills.length > 0);
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(space) && wellFormed(r) && wellFormed(mq));
});

// ---------------------------------------------------------------------------
// Sasuke: ignite, dash, substitution shadow and arrow art.

check('Sasuke spawn, ignite, dash, substitution and arrow', () => {
  const a = makeArena(10000093);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof SasukeActions);
  assert.equal(p.mp, 100);
  assert.equal(p.hasBuff(368101, a.now()), true);
  assert.ok(has(spawn, 1564) && has(spawn, 1579));
  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 368100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const dashHp = a.bot.hp;
  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.ready);
  a.tick(120);
  assert.ok(p.dash, 'dash did not start');
  assert.equal(p.hasBuff(368201, a.now()), true);
  a.tick(900);
  assert.equal(p.dash, null);
  assert.ok(a.bot.hp.lt(dashHp), 'dash dealt no damage');
  assert.ok(a.bot.hasBuff(368102, a.now()) || a.bot.hasBuff(368103, a.now()),
    'dash did not ignite');
  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.hasBuff(368401, a.now()), true);
  assert.equal(p.hasBuff(368406, a.now()), true);
  const [blocked, wardPackets] = p.blockHit(['test', 1], D(100), a.now(), {
    basic: true, source: a.bot,
  });
  assert.equal(blocked, true);
  assert.ok([...a.arena.actors.values()].some(actor => actor instanceof SasukeShadow));
  assert.equal(p.hasBuff(368403, a.now()), true);
  assert.ok(wellFormed(wardPackets));
  const firstSpace = p.cast(2, p.positionAt(a.now()), [680, 612], 0, a.now());
  assert.equal(p.mp, 0);
  assert.equal(p.hasBuff(368304, a.now()), true);
  assert.ok(scenes(firstSpace).skills.some(s => s.skillId === 368301));
  p.cooldowns[2] = 0;
  const space = p.cast(2, p.positionAt(a.now()), [680, 612], 0, a.now());
  assert.ok(p.ready, 'arrow art did not arm');
  assert.ok(scenes(space).skills.some(s => s.skillId === 368320));
  a.tick(900);
  assert.equal(p.ready, null);
  assert.ok(a.arena.objects.size >= 1);
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(r) && wellFormed(firstSpace)
    && wellFormed(space));
});

// ---------------------------------------------------------------------------
// Pumpkin: traps, ghosts, volley.

check('Pumpkin spawn, trap, ghost portal and volley', () => {
  const a = makeArena(10000052);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof PumpkinActions);
  assert.equal(p.hasBuff(327102, a.now()), true);
  assert.ok(has(spawn, 1558));
  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 327100));
  a.tick(600);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.e_count, 1);
  assert.ok(p.e_next_charge > a.now());
  assert.ok(has(e, 1564));
  a.tick(700);
  assert.ok([...a.arena.objects.values()].length >= 1 || a.bot.hasBuff(327214, a.now()));
  a.tick(800);
  assert.ok(a.bot.hasBuff(327214, a.now()) || a.bot.hasBuff(327231, a.now())
    || a.bot.hp.lt(a.bot.maxHp));
  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.ready);
  a.tick(600);
  assert.equal(p.ready, null);
  a.tick(6000);
  assert.ok([...a.arena.actors.values()].some(actor => actor instanceof PumpkinGhost));
  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.volley);
  assert.equal(p.hasBuff(327401, a.now()), true);
  const volley = a.tick(600);
  assert.ok(scenes(volley).fires.some(f => f.templateId === 327411));
  a.tick(5500);
  assert.equal(p.volley, null);
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(space) && wellFormed(r));
});

// ---------------------------------------------------------------------------
// Kurumi: combo buffs, field, clone snapshot.

check('Kurumi spawn, E combo, Space field and R clone', () => {
  const a = makeArena(10000095);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof KurumiActions);
  assert.ok(has(spawn, 1579));
  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 370100));
  a.tick(600);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.hasBuff(370203, a.now()), true);
  assert.ok(p.motion);
  assert.ok(cooldownSkills(e).includes(370201));
  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.ready);
  assert.ok(has(space, 1556));
  a.tick(60);
  assert.equal(p.ready, null);
  a.tick(1000);
  assert.ok(a.arena.objects.size >= 1);
  assert.ok(a.bot.hasBuff(370306, a.now()) || a.bot.hasBuff(370302, a.now()));
  const r = p.cast(10, p.positionAt(a.now()), [680, 612], 0, a.now());
  assert.ok(cooldownSkills(r).includes(370401));
  a.tick(600);
  assert.ok([...a.arena.actors.values()].some(actor => actor instanceof KurumiClone));
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(space) && wellFormed(r));
});

// ---------------------------------------------------------------------------
// Dark Knight: stealth warning, poison, darts, space cone.

check('Dark Knight spawn, poison, stealth, darts and cone', () => {
  const a = makeArena(10000030);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof DarkKnightActions);
  assert.ok(wellFormed(spawn));
  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 305100));
  a.tick(600);
  assert.ok(a.bot.hasBuff(305100, a.now()), 'poison did not start');
  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.hasBuff(305201, a.now()), true);
  assert.equal(p.hasBuff(305202, a.now()), true);
  assert.ok(p.cooldowns[1] > a.now());
  a.tick(1100);
  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.channel);
  assert.equal(p.hasBuff(305401, a.now()), true);
  const darts = a.tick(1100);
  assert.ok(scenes(darts).fires.filter(f => f.templateId === 305411).length >= 5);
  assert.equal(p.channel, null);
  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(a.bot.hasBuff(305301, a.now()), true);
  assert.ok(p.motion);
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(r) && wellFormed(space));
});

// ---------------------------------------------------------------------------
// Wolf: dash, taunt, counter R.

check('Wolf spawn, dash, taunt and R counter', () => {
  const a = makeArena(10000040);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof WolfActions);
  assert.equal(p.hasBuff(314101, a.now()), true);
  assert.ok(has(spawn, 1558));
  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 314100));
  a.tick(600);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = p.cast(1, p.positionAt(a.now()), [700, 612], 0, a.now());
  assert.ok(p.dash);
  assert.equal(p.hasBuff(314202, a.now()), true);
  a.tick(1200);
  assert.equal(p.dash, null);
  assert.equal(p.hasBuff(314202, a.now()), false);
  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.cooldowns[2] > a.now());
  assert.equal(a.bot.hasBuff(314303, a.now()), true);
  assert.equal(p.taunts.size, 1);
  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.r_count, 1);
  assert.ok(cooldownSkills(r).includes(314401));
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(space) && wellFormed(r));
});

// ---------------------------------------------------------------------------
// Shadowblade: energy, dash, links and field.

check('Shadowblade spawn, E blink, link and field', () => {
  const a = makeArena(10000108);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof ShadowbladeActions);
  assert.equal(p.mp, 100);
  assert.equal(p.hasBuff(383101, a.now()), true);
  assert.ok(has(spawn, 1564) && has(spawn, 1579));
  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 383100));
  a.tick(600);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.e_count, 1);
  assert.ok(p.ready);
  a.tick(120);
  assert.equal(p.ready, null);
  assert.equal(p.hasBuff(383203, a.now()), true);
  p.cooldowns[0] = 0;
  a.tick(200);
  const [px, py] = p.positionAt(a.now());
  const bounce = p.cast(0, [px, py], [px + 120, py], 0, a.now());
  assert.ok(scenes(bounce).fires.some(f => f.templateId === 383211));
  assert.equal(p.hasBuff(383203, a.now()), false);
  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.links.size, 1);
  assert.equal(a.bot.hasBuff(383403, a.now()), true);
  a.tick(1100);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const space = p.cast(2, p.positionAt(a.now()), [680, 612], 0, a.now());
  assert.ok(p.ready);
  a.tick(600);
  assert.equal(p.ready, null);
  assert.ok(p.dash || a.arena.objects.size >= 1);
  a.tick(1000);
  assert.ok(a.arena.objects.size >= 1);
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(bounce) && wellFormed(r) && wellFormed(space));
});

// ---------------------------------------------------------------------------
// Stone God: burrow emerge, storm and dash.

check('Stone God spawn, burrow, storm and Space dash', () => {
  const a = makeArena(10000109);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof StoneGodActions);
  assert.equal(p.hasBuff(384101, a.now()), true);
  assert.ok(has(spawn, 1558) && has(spawn, 1579));
  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 384100));
  a.tick(600);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = p.cast(1, p.positionAt(a.now()), [620, 612], 0, a.now());
  assert.ok(p.burrow);
  assert.ok(p.shieldAmount(a.now()).gt(0), 'burrow shield missing');
  assert.equal(p.hasBuff(384201, a.now()), true);
  a.tick(3600);
  assert.ok(p.ready, 'burrow emerge did not arm');
  a.tick(600);
  assert.equal(p.burrow, null);
  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.storm);
  assert.equal(p.hasBuff(384401, a.now()), true);
  assert.ok(has(r, 1572));
  a.tick(600);
  const space = p.cast(2, p.positionAt(a.now()), [400, 612], 0, a.now());
  assert.ok(p.ready);
  a.tick(350);
  assert.equal(p.ready, null);
  assert.ok(p.dash || p.motion);
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(r) && wellFormed(space));
});

// ---------------------------------------------------------------------------
// Aquaman: third shot, dash whirlpool, charge burst, R phases.

check('Aquaman spawn, third shot, leap and charge burst', () => {
  const a = makeArena(10000110);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof AquamanActions);
  assert.equal(p.mp, 100);
  assert.ok(has(spawn, 1564) && has(spawn, 1579));
  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 385100));
  p.cooldowns[0] = 0;
  const q2 = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.hasBuff(385121, a.now()), true);
  p.cooldowns[0] = 0;
  const q3 = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(scenes(q3).fires.some(f => f.templateId === 385111));
  const e = p.cast(1, p.positionAt(a.now()), [680, 612], 0, a.now());
  assert.ok(p.dash);
  assert.ok(p.motion);
  a.tick(600);
  assert.equal(p.dash, null);
  assert.equal(p.hasBuff(385213, a.now()), true);
  a.tick(900);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const space = p.cast(2, p.positionAt(a.now()), [650, 612], 0, a.now());
  assert.ok(p.ready);
  assert.ok(p.shieldAmount(a.now()).gt(0), 'charge shield missing');
  a.tick(800);
  const release = p.cast(2, p.positionAt(a.now()), [650, 612], 0, a.now());
  assert.equal(p.ready, null);
  assert.ok(has(release, 1564));
  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.cooldowns[10] > a.now());
  assert.ok(wellFormed(q) && wellFormed(q2) && wellFormed(q3) && wellFormed(e)
    && wellFormed(space) && wellFormed(release) && wellFormed(r));
});

// ---------------------------------------------------------------------------
// Night Wing: marks, stealth, darts and ghost channel.

check('Night Wing spawn, marks, stealth and ghost channel', () => {
  const a = makeArena(10000114);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof NightWingActions);
  assert.equal(p.mp, 100);
  assert.equal(p.hasBuff(390101, a.now()), true);
  assert.ok(has(spawn, 1564) && has(spawn, 1579));
  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 390100));
  a.tick(600);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(a.bot.hasBuff(390111, a.now()) || a.bot.hasBuff(390115, a.now()));
  const e = p.cast(1, p.positionAt(a.now()), [680, 612], 0, a.now());
  assert.equal(p.hasBuff(390201, a.now()), true);
  assert.equal(p.hasBuff(390204, a.now()), true);
  assert.equal(p.isUntargetable(), true);
  p.cooldowns[0] = 0;
  const beam = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(scenes(beam).fires.some(f => f.templateId === 390221));
  assert.equal(p.hasBuff(390204, a.now()), false);
  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.ok(p.ready);
  a.tick(150);
  assert.ok(p.channel);
  assert.equal(a.bot.hasBuff(390305, a.now()), true);
  const ghosts = a.tick(1000);
  assert.ok(scenes(ghosts).fires.some(f => f.templateId === 390311));
  const r = p.cast(10, p.positionAt(a.now()), [680, 612], 0, a.now());
  assert.equal(p.r_count, 1);
  assert.ok(cooldownSkills(r).includes(390401));
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(beam) && wellFormed(space) && wellFormed(r));
});

console.log(`batch-e tanks: ${checks} checks passed`);
