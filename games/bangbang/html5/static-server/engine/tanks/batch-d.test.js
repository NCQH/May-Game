/* Runnable batch-D self-check: node engine/tanks/batch-d.test.js
 *
 * Loads the native rows in batch-d-data.json, spawns each of the fifteen kits
 * on map 101, levels every slot and drives the tank-specific lifecycles
 * (pushes, dashes, fields, traps, forms, turrets). No test framework.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BattleData } from '../data.js';
import { BattleArena } from '../arena.js';
import { D } from '../math.js';
import { decodeScenePacket } from '../../../scene_protocol.js';
import { decodeCombatPacket } from '../../../combat_protocol.js';
import { LuffyActions } from './luffy.js';
import { EdwinaActions } from './edwina.js';
import { ZhaoYunActions } from './zhaoyun.js';
import { LuBuActions } from './lubu.js';
import { ZoroActions } from './zoro.js';
import { MikasaActions } from './mikasa.js';
import { GilgameshActions } from './gilgamesh.js';
import { KiritoActions } from './kirito.js';
import { MulanActions } from './mulan.js';
import { SniperActions } from './sniper.js';
import { SaitamaActions } from './saitama.js';
import { SongokuActions } from './songoku.js';
import { IchigoActions } from './ichigo.js';
import { SwordGodActions } from './swordgod.js';
import { MinionActions, MinionTurret } from './minion.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./batch-d-data.json', import.meta.url), 'utf8'));

const CLASSES = {
  10000042: SongokuActions,
  10000046: LuffyActions,
  10000060: MinionActions,
  10000064: IchigoActions,
  10000066: EdwinaActions,
  10000067: ZhaoYunActions,
  10000075: LuBuActions,
  10000077: ZoroActions,
  10000078: MikasaActions,
  10000081: SwordGodActions,
  10000088: GilgameshActions,
  10000096: KiritoActions,
  10000099: MulanActions,
  10000101: SniperActions,
  10000102: SaitamaActions,
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
    spawns: { 1: [600, 612], 2: [720, 672] },
    bot: { acct_id: 556, name: 'Bot', tank_id: 10000003, tank_level: 1, human: false, in_room: true },
  };
  const arena = new BattleArena(state, {
    clock: () => clock.now, rng: () => 0.5, data: makeData(), classes: CLASSES,
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
function cooldownSkills(packets) {
  return packets.filter(p => p[0] === 1572 || p[0] === 1579)
    .map(([id, body]) => decodeCombatPacket(id, body).skill.skillId);
}
function start(a) { return a.player.positionAt(a.now()); }
function botPos(a) { return a.bot.positionAt(a.now()); }

// ---------------------------------------------------------------------------
// Luffy: passive sub-40% heal, E push, five-punch Space.

check('Luffy spawns, pushes, punches and rescues below 40%', () => {
  const a = makeArena(10000046);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof LuffyActions);
  assert.equal(10 in p.cooldowns, false);
  assert.equal(p.hasBuff(320102, a.now()), true);
  assert.ok(wellFormed(spawn));

  const q = p.cast(0, start(a), botPos(a), a.bot.id, a.now());
  assert.ok(p.cooldowns[0] > a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 320100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const space = p.cast(2, start(a), botPos(a), a.bot.id, a.now());
  assert.ok(p.channel, 'punch channel missing');
  assert.equal(a.bot.hasBuff(320211, a.now()), true);
  a.tick(1100);
  assert.equal(p.channel, null, 'punch channel did not finish');
  assert.ok(wellFormed(space));

  const botBefore = botPos(a);
  const e = p.cast(1, start(a), botPos(a), a.bot.id, a.now());
  assert.ok(p.cooldowns[1] > a.now());
  assert.ok(cooldownSkills(e).includes(320301));
  assert.ok(has(e, 1564));
  assert.equal(a.bot.hasBuff(320311, a.now()), true, 'push marker missing');
  a.tick(800);
  assert.notDeepEqual(botPos(a), botBefore, 'E push did not move the target');

  const hp = p.hp;
  p.passive_ready_at = 0;
  const rescue = p.commit_hp(p.maxHp.mul(D('.3')), a.now());
  assert.ok(p.hasBuff(320101, a.now()), 'sub-40% rescue buff missing');
  assert.ok(p.hp.lt(hp));
  assert.ok(wellFormed(rescue));
});

// ---------------------------------------------------------------------------
// Edwina: paid E aura, sword field and guard dash.

check('Edwina channels the aura, lands the sword field and guards', () => {
  const a = makeArena(10000066);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof EdwinaActions);
  assert.ok(p.hasBuff(341101, a.now()) && p.hasBuff(341104, a.now()));

  const e = p.cast(1, start(a), botPos(a), a.bot.id, a.now());
  assert.ok(p.channel, 'aura channel missing');
  assert.equal(p.hasBuff(341201, a.now()), true);
  assert.ok(has(e, 1579));
  const mp = p.mp;
  const aura = a.tick(1200);
  assert.ok(p.mp < mp, 'aura did not pay MP');
  assert.ok(a.bot.hp.lt(a.bot.maxHp) || a.bot.hasBuff(341212, a.now()));
  assert.ok(wellFormed(aura));
  p.cast(1, start(a), botPos(a), 0, a.now()); // toggle off

  const space = p.cast(2, start(a), botPos(a), a.bot.id, a.now());
  assert.ok(p.ready, 'sword did not arm');
  assert.equal(p.info.damage_immune, true);
  a.tick(600);
  assert.equal(p.ready, null);
  assert.equal(a.arena.objects.size, 1, 'sword field object missing');
  assert.ok(scenes(space).skills.some(s => s.skillId === 341301));
  const ticked = a.tick(500);
  assert.ok(has(ticked, 1564));

  const r = p.cast(10, start(a), botPos(a), 0, a.now());
  assert.ok(p.motion, 'guard dash missing');
  assert.equal(p.hasBuff(341401, a.now()), true);
  assert.ok(cooldownSkills(r).includes(341401));
  a.tick(1200);
  assert.ok(wellFormed(space) && wellFormed(r));
});

// ---------------------------------------------------------------------------
// Zhao Yun: E charges, rage clocks and the R stab.

check('Zhao Yun dashes, stabs and tracks rage/charges', () => {
  const a = makeArena(10000067);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof ZhaoYunActions);
  assert.equal(p.e_count, 2);
  assert.equal(p.r_count, 2);
  assert.equal(p.hasBuff(342101, a.now()), true);

  const q = p.cast(0, start(a), botPos(a), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(q));

  const e = p.cast(1, start(a), botPos(a), 0, a.now());
  assert.equal(p.e_count, 1);
  assert.ok(p.dash);
  assert.equal(p.hasBuff(342211, a.now()), true);
  assert.ok(cooldownSkills(e).includes(342201));
  a.tick(700);
  assert.equal(p.dash, null);

  const r = p.cast(10, start(a), [start(a)[0] + 100, start(a)[1]], 0, a.now());
  assert.equal(p.r_count, 1);
  assert.ok(p.channel);
  assert.ok(cooldownSkills(r).includes(342401));
  a.tick(1200);
  assert.equal(p.channel, null, 'stab channel did not finish');
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const space = p.cast(2, start(a), [start(a)[0] + 100, start(a)[1]], a.bot.id, a.now());
  assert.ok(p.ready, 'field did not arm');
  a.tick(150);
  assert.equal(p.ready, null);
  assert.ok(a.bot.hasBuff(342304, a.now()), 'root field missing');
  a.tick(1100);
  assert.ok(wellFormed(space) && wellFormed(r));
});

// ---------------------------------------------------------------------------
// Lu Bu: empower shield, E landing and piercing R.

check('Lu Bu shields, lands E, fires the piercing R and blinks', () => {
  const a = makeArena(10000075);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof LuBuActions);
  assert.equal(p.hasBuff(349101, a.now()), true);

  const q = p.cast(0, start(a), botPos(a), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(q));

  const e = p.cast(1, start(a), botPos(a), 0, a.now());
  assert.ok(p.ready, 'E did not arm');
  assert.ok(p.shieldAmount(a.now()).gt(0), 'empower shield missing');
  assert.equal(p.hasBuff(349111, a.now()), true);
  a.tick(100);
  assert.equal(p.ready, null);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const r = p.cast(10, start(a), [start(a)[0] + 100, start(a)[1]], 0, a.now());
  assert.ok(scenes(r).fires.some(f => f.templateId === 349401), 'R bullet missing');
  assert.ok(wellFormed(r));

  const space = p.cast(2, start(a), [720, 612], 0, a.now());
  assert.ok(p.ready, 'Space did not arm');
  assert.equal(p.info.untargetable, true);
  a.tick(1100);
  assert.equal(p.ready, null);
  assert.ok(wellFormed(space));
});

// ---------------------------------------------------------------------------
// Zoro: blinks, marks, scatters and reflects.

check('Zoro blinks, marks, scatters and replies to a reflection', () => {
  const a = makeArena(10000077);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof ZoroActions);
  assert.equal(p.hasBuff(351101, a.now()), true);
  assert.equal(p.space_count, 3);

  const e = p.cast(1, start(a), botPos(a), 0, a.now());
  assert.ok(p.ready, 'blink did not arm');
  a.tick(80);
  assert.equal(p.ready, null);
  assert.equal(p.scatter_count, 3);
  assert.equal(a.bot.hasBuff(351112, a.now()), true);
  assert.ok(p.marks.has(a.bot.id));

  const q = p.cast(0, start(a), botPos(a), a.bot.id, a.now());
  assert.equal(a.bot.hasBuff(351112, a.now()), true);
  a.tick(200);
  assert.ok(p.marks.get(a.bot.id).end > a.now());
  assert.ok(wellFormed(q));

  const space = p.cast(2, start(a), botPos(a), 0, a.now());
  assert.equal(p.space_count, 2);
  assert.equal(a.bot.hasBuff(351303, a.now()) || a.bot.hasBuff(351112, a.now()), true);
  a.tick(500);

  const r = p.cast(10, start(a), botPos(a), 0, a.now());
  assert.equal(p.hasBuff(351401, a.now()), true);
  assert.equal(p.hasBuff(351402, a.now()), true);
  p.reflect_projectile({}, a.now());
  a.tick(10);
  assert.ok(p.reflections.length === 1 || p.reflections.length === 0);
  const reply = p.handle(510, (() => {
    const buf = new Uint8Array(12), view = new DataView(buf.buffer);
    view.setUint32(0, a.arena.sceneId, true);
    view.setInt16(8, 720, true); view.setInt16(10, 672, true);
    return buf;
  })());
  assert.ok(wellFormed(reply));
  assert.ok(wellFormed(space) && wellFormed(r));
});

// ---------------------------------------------------------------------------
// Mikasa: hook wall latch, Space burst and R reload.

check('Mikasa hooks a wall, bursts nearby and reloads', () => {
  const a = makeArena(10000078);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof MikasaActions);
  assert.equal(p.hasBuff(352101, a.now()), true);
  assert.equal(p.e_count, 3);

  const q = p.cast(0, start(a), botPos(a), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(q));

  const space = p.cast(2, start(a), botPos(a), 0, a.now());
  assert.equal(p.space_count, 2);
  assert.equal(a.bot.hasBuff(352302, a.now()), true, 'Space burst missed');
  a.tick(300);

  const r = p.cast(10, start(a), botPos(a), 0, a.now());
  assert.ok(p.ready, 'reload did not arm');
  a.tick(200);
  assert.equal(p.ready, null);
  assert.ok(p.reload);
  assert.ok(p.shieldAmount(a.now()).gt(0), 'reload shield missing');
  assert.equal(p.hasBuff(352404, a.now()), true);
  a.tick(4200);
  assert.equal(p.reload, null);

  const e = p.cast(1, start(a), [100, 612], 0, a.now());
  assert.equal(p.e_count, 2);
  assert.ok(p.hook, 'hook did not launch');
  assert.ok(scenes(e).fires.some(f => f.templateId === 352501));
  a.tick(500);
  assert.equal(p.hook, null);
  assert.ok(p.dash, 'hook did not latch a wall');
  a.tick(1200);
  assert.equal(p.dash, null);
  assert.ok(wellFormed(space) && wellFormed(r) && wellFormed(e));
});

// ---------------------------------------------------------------------------
// Gilgamesh: arrows, field and the forty-weapon sweep.

check('Gilgamesh fields, sweeps forty weapons and shields', () => {
  const a = makeArena(10000088);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof GilgameshActions);
  assert.equal(p.hasBuff(362101, a.now()) && p.hasBuff(362102, a.now()), true);

  const q = p.cast(0, start(a), botPos(a), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(q));

  const e = p.cast(1, start(a), botPos(a), 0, a.now());
  assert.equal(a.arena.objects.size, 1, 'field object missing');
  a.tick(400);
  assert.equal(a.bot.hasBuff(362203, a.now()), true, 'field never hit');

  const space = p.cast(2, start(a), botPos(a), 0, a.now());
  assert.ok(p.sweep, 'sweep did not arm');
  assert.equal(p.hasBuff(362302, a.now()), true);
  const volley = a.tick(500);
  assert.ok(scenes(volley).fires.some(f => f.templateId === 362501)
    || a.arena.pending.length > 0, 'weapon never fired');
  a.tick(4000);
  assert.equal(p.sweep, null);
  assert.ok(a.bot.hasBuff(362103, a.now()) || a.bot.hasBuff(362107, a.now())
    || a.bot.hp.lt(a.bot.maxHp));

  const r = p.cast(10, start(a), botPos(a), 0, a.now());
  assert.ok(p.shieldAmount(a.now()).gt(0), 'R shield missing');
  assert.ok(cooldownSkills(r).includes(362401));
  assert.ok(wellFormed(space) && wellFormed(r));
});

// ---------------------------------------------------------------------------
// Kirito: blades, carried dash, vanish cuts and the lethal rescue.

check('Kirito dashes, vanishes into fifteen cuts and rescues', () => {
  const a = makeArena(10000096);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof KiritoActions);
  assert.equal(p.hasBuff(371101, a.now()) && p.hasBuff(371102, a.now()), true);

  const q = p.cast(0, start(a), botPos(a), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(q));

  const e = p.cast(1, start(a), botPos(a), 0, a.now());
  assert.ok(p.dash, 'dash missing');
  assert.equal(p.hasBuff(371201, a.now()), true);
  a.tick(900);
  assert.equal(p.dash, null);
  assert.ok(wellFormed(e));

  const space = p.cast(2, start(a), botPos(a), 0, a.now());
  assert.ok(p.vanish, 'vanish missing');
  assert.equal(p.info.untargetable, true);
  const cuts = a.tick(200);
  assert.ok(a.bot.hp.lt(a.bot.maxHp), 'cuts missed');
  assert.ok(has(cuts, 1564));
  a.tick(1600);
  assert.equal(p.vanish, null);

  const hpBefore = a.bot.hp.toNumber();
  const r = p.cast(10, start(a), [start(a)[0] + 100, start(a)[1]], 0, a.now());
  assert.ok(p.ready, 'R did not arm');
  a.tick(60);
  assert.ok(p.vanish, 'blink vanish missing');
  a.tick(600);
  assert.equal(p.vanish, null);
  assert.ok(a.bot.hp.toNumber() < hpBefore, 'R landing missed');
  assert.ok(wellFormed(space) && wellFormed(r));

  p.passive_ready_at = 0;
  const rescue = p.prevent_lethal_hit({ hp_after: D(0) }, a.now());
  assert.ok(p.hasBuff(371111, a.now()), 'lethal rescue missing');
  assert.ok(wellFormed(rescue));
});

// ---------------------------------------------------------------------------
// Mulan: mark ladder, carried E swings, charged Space and sword field.

check('Mulan swings, charges Space and plants the sword field', () => {
  const a = makeArena(10000099);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof MulanActions);
  assert.equal(p.hasBuff(374101, a.now()) && p.hasBuff(374102, a.now()), true);

  const q = p.cast(0, start(a), botPos(a), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(q));

  const e = p.cast(1, start(a), botPos(a), 0, a.now());
  assert.ok(p.dash, 'E dash missing');
  assert.equal(p.hasBuff(374203, a.now()), true);
  a.tick(800);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  a.tick(900);
  assert.equal(p.dash, null);

  const space = p.cast(2, start(a), [start(a)[0] + 100, start(a)[1]], 0, a.now());
  assert.ok(p.ready, 'charge did not arm');
  assert.equal(p.hasBuff(374311, a.now()), true);
  a.tick(3100);
  assert.equal(p.ready, null);
  a.tick(200);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(scenes(space).skills.some(s => s.skillId === 374301)
    || cooldownSkills(space).includes(374321));

  const r = p.cast(10, start(a), botPos(a), 0, a.now());
  assert.equal(a.arena.objects.size > 0, true, 'field object missing');
  a.tick(700);
  assert.ok(a.bot.hasBuff(374404, a.now()) || a.bot.hasBuff(374405, a.now()));
  assert.ok(p.r_window.end > a.now(), 'R window missing');
  assert.ok(wellFormed(space) && wellFormed(r));
});

// ---------------------------------------------------------------------------
// Sniper: conceal, aimed specials, mine trap and push.

check('Sniper conceals, fires three specials and mines', () => {
  const a = makeArena(10000101);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof SniperActions);
  assert.equal(p.info.untargetable, true);
  assert.equal(p.hasBuff(376111, a.now()), true);
  assert.ok(has(spawn, 1579));

  const q = p.cast(0, start(a), botPos(a), a.bot.id, a.now());
  assert.equal(p.hasBuff(376111, a.now()), false, 'activity did not break conceal');
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = p.cast(1, start(a), botPos(a), 0, a.now());
  assert.ok(scenes(e).fires.some(f => f.templateId === 376201));
  a.tick(700);
  assert.equal(a.bot.hasBuff(376410, a.now()), true, 'aim mark missing');

  const space = p.cast(2, start(a), botPos(a), 0, a.now());
  assert.ok(p.special, 'special mode missing');
  assert.equal(p.hasBuff(376301, a.now()), true);
  const shots = [];
  for (let index = 0; index < 3; index += 1) {
    shots.push(p.cast(0, start(a), botPos(a), a.bot.id, a.now()));
    a.tick(1400);
  }
  assert.equal(p.special, null, 'special mode did not end');
  assert.ok(p.cooldowns[2] > a.now());

  const r = p.cast(10, start(a), start(a), 0, a.now());
  assert.ok(p.ready, 'trap did not arm');
  a.tick(150);
  assert.equal(p.ready, null);
  assert.equal(p.traps.size, 1, 'trap object missing');
  assert.ok(wellFormed(space) && wellFormed(r) && shots.every(wellFormed));
});

// ---------------------------------------------------------------------------
// Saitama: stacks, dash, manual charged punch and R cone.

check('Saitama dashes, charges/releases and knocks back', () => {
  const a = makeArena(10000102);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof SaitamaActions);
  assert.equal(p.hasBuff(377101, a.now()) && p.hasBuff(377103, a.now()), true);

  const q = p.cast(0, start(a), botPos(a), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(q));

  const e = p.cast(1, start(a), botPos(a), 0, a.now());
  assert.ok(p.ready, 'E did not arm');
  a.tick(150);
  assert.ok(p.dash, 'E dash missing');
  a.tick(900);
  assert.equal(p.dash, null);
  assert.ok(wellFormed(e));

  const charge = p.cast(2, start(a), [start(a)[0] + 100, start(a)[1]], 0, a.now());
  assert.ok(p.ready && p.ready.slot === 2, 'charge did not arm');
  assert.equal(p.hasBuff(377321, a.now()), true);
  const release = p.cast(2, start(a), botPos(a), 0, a.now());
  assert.equal(p.ready, null);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(charge) && wellFormed(release));

  const r = p.cast(10, start(a), botPos(a), 0, a.now());
  assert.ok(p.ready, 'R did not arm');
  a.tick(350);
  assert.equal(p.ready, null);
  assert.ok(a.bot.hasBuff(377403, a.now()) || a.bot.hasBuff(377303, a.now()));
  assert.ok(wellFormed(r));
});

// ---------------------------------------------------------------------------
// Songoku: nearby aura, teleport and the enemy-count form.

check('Songoku auras, teleports and enters the form', () => {
  const a = makeArena(10000042, );
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof SongokuActions);
  assert.equal(p.hasBuff(316141, a.now()), true);
  assert.equal(p.nearby, 1);
  assert.ok(p.hasBuff(316131, a.now()), 'nearby aura missing');

  const q = p.cast(0, start(a), botPos(a), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(q));

  const e = p.cast(1, start(a), botPos(a), a.bot.id, a.now());
  assert.ok(p.teleport, 'teleport did not arm');
  assert.equal(a.bot.hasBuff(316201, a.now()), true);
  a.tick(1100);
  assert.equal(p.teleport, null);
  assert.ok(a.bot.hasBuff(316213, a.now()), 'teleport strike missing');

  const space = p.cast(2, start(a), botPos(a), 0, a.now());
  assert.ok(a.bot.hasBuff(316302, a.now()), 'Space push missing');
  assert.equal(p.hasBuff(316312, a.now()), true, 'form level 1 missing');
  assert.ok(p.nearby === 0 || p.hasBuff(316130, a.now()) === false);
  assert.ok(cooldownSkills(space).includes(316301));
  assert.ok(wellFormed(space) && wellFormed(e));
});

// ---------------------------------------------------------------------------
// Ichigo: step, form, enhanced basic and Bankai R.

check('Ichigo steps, forms, cuts the strip and fires Bankai R', () => {
  const a = makeArena(10000064);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof IchigoActions);
  assert.equal(p.mp, 150);
  assert.equal(p.hasBuff(339101, a.now()) && p.hasBuff(339102, a.now()), true);

  const q = p.cast(0, start(a), botPos(a), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(q));

  const e = p.cast(1, start(a), botPos(a), a.bot.id, a.now());
  assert.equal(p.e_count, 2);
  assert.ok(p.ready, 'step did not arm');
  a.tick(80);
  assert.equal(p.ready, null);
  assert.equal(p.hasBuff(339111, a.now()), true, 'step empower missing');
  assert.equal(a.bot.hasBuff(339210, a.now()), true);
  assert.ok(wellFormed(e));

  const space = p.cast(2, start(a), botPos(a), 0, a.now());
  assert.ok(p.ready, 'form did not arm');
  a.tick(80);
  assert.equal(p.ready, null);
  assert.equal(p.hasBuff(339303, a.now()), true, 'Bankai buff missing');
  assert.equal(p.hasBuff(339302, a.now()), true);
  assert.equal(p.cooldowns[10], 0);
  a.tick(900);

  const enhanced = p.cast(0, start(a), [start(a)[0] + 100, start(a)[1]], a.bot.id, a.now());
  assert.ok(scenes(enhanced).skills.some(s => s.skillId === 339121), 'enhanced cut missing');
  a.tick(300);

  const r = p.cast(10, start(a), [start(a)[0] + 100, start(a)[1]], 0, a.now());
  assert.ok(scenes(r).fires.some(f => f.templateId === 339305), 'Bankai R bullet missing');
  a.tick(500);
  assert.ok(wellFormed(space) && wellFormed(enhanced) && wellFormed(r));
});

// ---------------------------------------------------------------------------
// Sword God: E marks, delayed Space execute and R suppression.

check('Sword God marks with E, executes with Space and suppresses', () => {
  const a = makeArena(10000081);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof SwordGodActions);
  assert.equal(p.mp, 0);

  const q = p.cast(0, start(a), botPos(a), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(q));

  const e = p.cast(1, start(a), botPos(a), 0, a.now());
  assert.equal(p.e_count, 2);
  assert.ok(p.ready, 'E did not arm');
  assert.equal(p.hasBuff(355211, a.now()), true);
  a.tick(80);
  assert.equal(p.ready, null);
  a.tick(500);
  assert.equal(a.bot.hasBuff(355202, a.now()), true, 'E mark missing');

  const space = p.cast(2, start(a), botPos(a), 0, a.now());
  assert.equal(a.bot.hasBuff(355301, a.now()), true);
  a.tick(1600);
  assert.equal(a.bot.hasBuff(355301, a.now()), false);
  assert.equal(a.bot.hasBuff(355305, a.now()), true, 'Space execute missing');
  assert.ok(wellFormed(space));

  const r = p.cast(10, start(a), botPos(a), 0, a.now());
  assert.equal(p.hasBuff(355403, a.now()), true);
  assert.equal(a.bot.hasBuff(355406, a.now()), true);
  assert.ok(cooldownSkills(r).includes(355401));
  assert.ok(wellFormed(e) && wellFormed(r));
});

// ---------------------------------------------------------------------------
// Minion: turret summon, device component and laser.

check('Minion summons the turret, drops a component and fires the laser', () => {
  const a = makeArena(10000060);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof MinionActions);
  assert.equal(p.mp, 100);
  assert.equal(p.e_count, 2);

  const q = p.cast(0, start(a), botPos(a), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(q));

  const e = p.cast(1, start(a), botPos(a), 0, a.now());
  assert.equal(p.e_count, 1);
  assert.equal(a.arena.actors.size, 3, 'turret actor missing');
  const turret = [...a.arena.actors.values()].find(actor => actor instanceof MinionTurret);
  assert.ok(turret, 'MinionTurret missing');
  assert.equal(turret.hasBuff(335221, a.now()), true);
  assert.ok(wellFormed(e));

  const space = p.cast(2, start(a), start(a), 0, a.now());
  assert.ok(a.arena.objects.size >= 2, 'device objects missing');
  a.tick(1100);
  assert.ok(a.arena.objects.size >= 1, 'device body missing');
  a.tick(3100);
  assert.ok(p.components.size <= 1, 'component drop missing');
  a.tick(200);
  assert.equal(p.components.size, 0, 'component was not picked up');
  assert.ok(p.shieldAmount(a.now()).gt(0), 'pickup shield missing');
  assert.ok(wellFormed(space));

  const r = p.cast(10, start(a), botPos(a), 0, a.now());
  assert.ok(p.ready, 'laser did not arm');
  a.tick(700);
  assert.equal(p.ready, null);
  assert.equal(a.bot.hasBuff(335402, a.now()), true, 'laser debuff missing');
  assert.ok(wellFormed(r));
});

console.log(`batch-d tanks: ${checks} checks passed`);
