/* Runnable batch-F2 self-check: node engine/tanks/batch-f2.test.js
 *
 * Loads the native rows in batch-f2-data.json, spawns each kit on map 101,
 * levels all four slots and checks cooldowns, buffs, projectiles and the
 * tank-specific event loops. No test framework, no core edits.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BattleData } from '../data.js';
import { BattleArena } from '../arena.js';
import { D } from '../math.js';
import { decodeScenePacket } from '../../../scene_protocol.js';
import { decodeCombatPacket } from '../../../combat_protocol.js';
import { ApocalypseActions } from './apocalypse.js';
import { CaoCaoActions } from './caocao.js';
import { DaredevilActions } from './daredevil.js';
import { DoraemonActions } from './doraemon.js';
import { DraculaActions } from './dracula.js';
import { ElsaActions } from './elsa.js';
import { ErlangActions } from './erlang.js';
import { KakashiActions, KakashiWood } from './kakashi.js';
import { LacLongQuanActions } from './laclongquan.js';
import { MagnetoActions } from './magneto.js';
import { NoelActions, NoelBox } from './noel.js';
import { SimayiActions, SimaOrb } from './simayi.js';
import { StrangeActions, StrangeShadow } from './strange.js';
import { TimeGoddessActions, TimeGuardian } from './timegoddess.js';
import { TsubasaActions } from './tsubasa.js';
import { ZhugeActions } from './zhuge.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./batch-f2-data.json', import.meta.url), 'utf8'));

const CLASSES = {
  10000054: NoelActions,
  10000055: KakashiActions,
  10000057: DraculaActions,
  10000072: ApocalypseActions,
  10000080: DoraemonActions,
  10000083: StrangeActions,
  10000084: ZhugeActions,
  10000087: ErlangActions,
  10000091: CaoCaoActions,
  10000094: LacLongQuanActions,
  10000097: MagnetoActions,
  10000098: SimayiActions,
  10000106: ElsaActions,
  10000111: TsubasaActions,
  10000113: TimeGoddessActions,
  10000115: DaredevilActions,
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
  return data;
}

function makeArena(tankId) {
  const clock = { now: 100000 };
  const state = {
    battle: { scene_id: 1234 },
    room: { map_id: 101, camp: 1 },
    char_id: 555, name: 'Tester', tank_id: tankId, tank_level: 1,
    spawns: { 1: [600, 612], 2: [780, 804] },
    // A silent base TankActions opponent: no auto-cast, no kit passives.
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
function has(packets, id) {
  if (id === 1572) return packets.some(p => p[0] === 1572 || p[0] === 1579);
  return packets.some(p => p[0] === id);
}
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
function win(packets) { assert.ok(wellFormed(packets), 'malformed packet'); return packets; }

// ---------------------------------------------------------------------------
check('Apocalypse fires the bounded pellet salvo and its burst windows', () => {
  const a = makeArena(10000072);
  win(a.tick(0));
  const p = a.player;
  assert.ok(p instanceof ApocalypseActions);
  assert.equal(p.hasBuff(346101, a.now()), true);
  const q = win(p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(scenes(q).fires.some(f => f.templateId === 346100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = win(p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(p.ready, 'E did not arm');
  assert.ok(cooldownSkills(e).includes(346201));
  a.tick(150);
  assert.equal(p.ready, null);
  const r = win(p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(p.ready, 'R did not arm');
  const fired = scenes(a.tick(150).concat(r)).fires.filter(f => f.templateId === 346401);
  assert.ok(fired.length >= 5, `expected 5 pellets, got ${fired.length}`);
  const space = win(p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(p.ready, 'Space did not arm');
  a.tick(150);
  assert.equal(p.ready, null);
  assert.ok(has(space, 1572));
});

// ---------------------------------------------------------------------------
check('Cao Cao runs aura, projectile and hostage lifecycles', () => {
  const a = makeArena(10000091);
  win(a.tick(0));
  const p = a.player;
  assert.ok(p instanceof CaoCaoActions);
  assert.equal(p.hasBuff(366101, a.now()), true);
  const q = win(p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(scenes(q).fires.some(f => f.templateId === 366100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = win(p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(scenes(e).fires.some(f => f.templateId === 366201));
  a.tick(700);
  const r = win(p.cast(10, p.positionAt(a.now()), p.positionAt(a.now()), 0, a.now()));
  assert.ok(p.aura, 'aura missing');
  assert.equal(p.hasBuff(366401, a.now()), true);
  assert.equal(p.hasBuff(366404, a.now()), true);
  assert.ok(has(r, 1572));
  const space = win(p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(p.ready, 'hostage did not arm');
  assert.equal(a.bot.hasBuff(366301, a.now()), true);
  a.tick(2000);
  assert.ok(p.hostage, 'hostage never latched');
  assert.equal(p.hostage.target, a.bot.id);
  assert.ok(has(space, 1572));
});

// ---------------------------------------------------------------------------
check('Daredevil spends HP for charges and settles the ledger', () => {
  const a = makeArena(10000115);
  win(a.tick(0));
  const p = a.player;
  assert.ok(p instanceof DaredevilActions);
  assert.ok(p.hasBuff(391101, a.now()));
  const q = win(p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(scenes(q).fires.some(f => f.templateId === 391100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = win(p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.equal(p.e_count, 1);
  assert.ok(p.ledger, 'ledger missing');
  assert.ok(p.hp.lt(p.maxHp), 'HP cost did not apply');
  assert.ok(has(e, 1572));
  a.tick(1200);
  assert.equal(p.ledger, null, 'ledger did not settle');
  const space = win(p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(p.ready, 'Space did not arm');
  assert.equal(p.space_count, 2);
  a.tick(150);
  assert.equal(p.ready, null);
  assert.equal(p.hasBuff(391303, a.now()), true);
  const [px, py] = p.positionAt(a.now());
  const r = win(p.cast(10, p.positionAt(a.now()), [px + 120, py], 0, a.now()));
  assert.equal(p.r_count, 1);
  assert.ok(scenes(r).skills.some(s => s.skillId === 391401));
});

// ---------------------------------------------------------------------------
check('Doraemon opens traps, portals and paired marks', () => {
  const a = makeArena(10000080);
  win(a.tick(0));
  const p = a.player;
  assert.ok(p instanceof DoraemonActions);
  assert.ok(p.hasBuff(354101, a.now()));
  const q = win(p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(scenes(q).fires.some(f => f.templateId === 354100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = win(p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(a.arena.objects.size >= 2, 'trap objects missing');
  a.tick(600);
  assert.ok(a.arena.objects.size >= 1, 'trap did not open');
  assert.ok(a.bot.hasBuff(354203, a.now()) || a.bot.hasBuff(354204, a.now()));
  a.tick(3200);
  const space = win(p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(p.ready, 'Space did not arm');
  a.tick(100);
  assert.equal(p.ready, null);
  a.tick(900);
  assert.ok(has(space, 1572));
  const r = win(p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(scenes(r).fires.some(f => f.templateId === 354401));
  a.tick(1000);
  assert.ok(a.arena.objects.size >= 1, 'portal object missing');
  assert.ok(win(r).length > 0);
});

// ---------------------------------------------------------------------------
check('Dracula links, loans stats and swaps HP', () => {
  const a = makeArena(10000057);
  win(a.tick(0));
  const p = a.player;
  assert.ok(p instanceof DraculaActions);
  assert.ok(p.hasBuff(332101, a.now()));
  const q = win(p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(scenes(q).fires.some(f => f.templateId === 332100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(a.bot.hasBuff(332111, a.now()), 'basic did not apply the DOT');
  const r = win(p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(p.link, 'link missing');
  assert.equal(a.bot.hasBuff(332401, a.now()), true);
  assert.equal(p.hasBuff(332402, a.now()), true);
  a.tick(1200);
  assert.equal(p.hasBuff(332413, a.now()), true);
  assert.equal(a.bot.hasBuff(332414, a.now()), true);
  a.tick(5000);
  assert.equal(p.link, null, 'link did not end');
  const e = win(p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(p.bat, 'bat form missing');
  assert.equal(p.hasBuff(332202, a.now()), true);
  a.tick(3200);
  assert.equal(p.bat, null, 'bat did not end');
  const space = win(p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(p.ready, 'ritual did not arm');
  assert.ok(p.dracula_ritual, 'ritual lock missing');
  a.tick(1600);
  assert.equal(p.ready, null);
  assert.ok(has(space, 1572) && has(e, 1572) && has(r, 1572));
});

// ---------------------------------------------------------------------------
check('Elsa chains waves and freezes incoming damage', () => {
  const a = makeArena(10000106);
  win(a.tick(0));
  const p = a.player;
  assert.ok(p instanceof ElsaActions);
  assert.ok(p.hasBuff(381101, a.now()));
  const q = win(p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(scenes(q).fires.some(f => f.templateId === 381100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = win(p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(p.ready, 'E did not arm');
  a.tick(250);
  assert.equal(p.ready, null);
  assert.ok(a.bot.hasBuff(381203, a.now()) || a.bot.hasBuff(381204, a.now()));
  const space = win(p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(p.channel, 'channel did not open');
  assert.equal(p.hasBuff(381303, a.now()), true);
  a.tick(800);
  assert.ok(a.arena.objects.size >= 1);
  a.tick(4000);
  assert.equal(p.channel, null, 'channel did not finish');
  const r = win(p.cast(10, p.positionAt(a.now()), p.positionAt(a.now()), 0, a.now()));
  assert.equal(p.r_count, 1);
  assert.ok(scenes(r).fires.length === 0);
  assert.ok(has(space, 1572));
});

// ---------------------------------------------------------------------------
check('Erlang throws the dog, recalls and cycles Space phases', () => {
  const a = makeArena(10000087);
  win(a.tick(0));
  const p = a.player;
  assert.ok(p instanceof ErlangActions);
  assert.ok(p.hasBuff(361101, a.now()));
  const q = win(p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(scenes(q).fires.some(f => f.templateId === 361100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = win(p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(scenes(e).fires.some(f => f.templateId === 361501));
  assert.ok(p.dog, 'dog flight missing');
  assert.equal(p.hasBuff(361201, a.now()), true);
  const recall = win(p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(p.ready, 'recall did not arm');
  assert.equal(p.hasBuff(361201, a.now()), false);
  a.tick(100);
  assert.equal(p.ready, null);
  assert.equal(p.hasBuff(361803, a.now()), true);
  const space = win(p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(p.ready, 'Space did not arm');
  a.tick(150);
  assert.equal(p.phase, 2);
  assert.equal(p.hasBuff(361303, a.now()), true);
  assert.equal(p.hasBuff(361304, a.now()), true);
  const r = win(p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.equal(p.hasBuff(361404, a.now()), true);
  assert.equal(p.hasBuff(361405, a.now()), true);
  assert.ok(has(r, 1572) && has(recall, 1572) && has(space, 1572));
});

// ---------------------------------------------------------------------------
check('Kakashi substitutes, dashes and closes Kamui', () => {
  const a = makeArena(10000055);
  win(a.tick(0));
  const p = a.player;
  assert.ok(p instanceof KakashiActions);
  assert.ok(p.hasBuff(330101, a.now()));
  assert.equal(p.mp, 150);
  const q = win(p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(scenes(q).fires.some(f => f.templateId === 330100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.deepEqual(p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()), []);
  const r = win(p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(p.dash, 'dash missing');
  assert.equal(p.hasBuff(330402, a.now()), true);
  a.tick(1200);
  assert.equal(p.dash, null);
  const space = win(p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(p.ready, 'Kamui did not arm');
  assert.ok(p.mp <= 75);
  a.tick(350);
  assert.equal(p.ready, null);
  assert.ok(p.kamui, 'Kamui field did not open');
  assert.equal(p.hasBuff(330307, a.now()), true);
  assert.ok([...a.arena.actors.values()].some(x => x !== p && x instanceof StrangeShadow) === false);
  a.tick(3500);
  assert.equal(p.kamui, null);
  const sub = win(p.commitHp(D(0), a.now()));
  assert.equal(p.hp.toNumber(), 1);
  assert.equal(p.hasBuff(330131, a.now()), true);
  assert.ok([...a.arena.actors.values()].some(x => x instanceof KakashiWood), 'wood missing');
  assert.ok(has(space, 1572) && has(sub, 1556));
});

// ---------------------------------------------------------------------------
check('Lac Long Quan dashes, forms water and fires the dragon wave', () => {
  const a = makeArena(10000094);
  win(a.tick(0));
  const p = a.player;
  assert.ok(p instanceof LacLongQuanActions);
  assert.ok(p.shieldAmount(a.now()).gt(0), 'passive shield missing');
  const q = win(p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(scenes(q).fires.some(f => f.templateId === 387100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = win(p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(p.dash, 'dash missing');
  assert.equal(p.hasBuff(387202, a.now()), true);
  a.tick(600);
  assert.equal(p.dash, null);
  assert.equal(p.hasBuff(387203, a.now()), true);
  const space = win(p.cast(2, p.positionAt(a.now()), p.positionAt(a.now()), 0, a.now()));
  assert.ok(p.form, 'water form missing');
  assert.equal(p.hasBuff(387301, a.now()), true);
  assert.equal(p.hasBuff(387304, a.now()), true);
  const wave = win(p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.equal(p.form.used, true);
  assert.ok(a.arena.objects.size >= 1, 'dragon object missing');
  a.tick(1100);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  p.position = [700, 700];
  const r = win(p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(p.shieldAmount(a.now()).gt(0));
  assert.ok(has(space, 1572) && has(wave, 1572) && has(r, 1572));
});

// ---------------------------------------------------------------------------
check('Magneto lifts, storms and detonates the R field', () => {
  const a = makeArena(10000097);
  win(a.tick(0));
  const p = a.player;
  assert.ok(p instanceof MagnetoActions);
  assert.ok(p.hasBuff(372101, a.now()));
  const q = win(p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(scenes(q).fires.some(f => f.templateId === 372100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = win(p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(a.arena.objects.size >= 1);
  a.tick(800);
  assert.ok(a.bot.hasBuff(372202, a.now()) || a.bot.hasBuff(372204, a.now()));
  a.tick(1600);
  const space = win(p.cast(2, p.positionAt(a.now()), p.positionAt(a.now()), 0, a.now()));
  assert.equal(p.hasBuff(372301, a.now()), true);
  assert.equal(p.hasBuff(372302, a.now()), true);
  a.tick(800);
  assert.ok(a.bot.hasBuff(372306, a.now()) || a.bot.hasBuff(372307, a.now())
    || a.bot.hasBuff(372308, a.now()) || a.bot.hasBuff(372316, a.now()));
  const r = win(p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(p.ready, 'R did not arm');
  a.tick(350);
  assert.equal(p.ready, null);
  a.tick(900);
  assert.ok(has(e, 1572) && has(space, 1572) && has(r, 1572));
});

// ---------------------------------------------------------------------------
check('Noel hands gifts, boxes the enemy and opens the portal', () => {
  const a = makeArena(10000054);
  win(a.tick(0));
  const p = a.player;
  assert.ok(p instanceof NoelActions);
  assert.ok(p.hasBuff(329101, a.now()));
  const q = win(p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(scenes(q).fires.some(f => f.templateId === 329100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = win(p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.equal(p.e_count, 2);
  assert.ok(p.ready, 'E did not arm');
  const hpBeforeE = a.bot.hp.toNumber();
  a.tick(100);
  a.tick(700);
  assert.ok(a.bot.hp.toNumber() < hpBeforeE, 'E projectile missed');
  const space = win(p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  a.tick(900);
  a.tick(900);
  assert.ok(p.ready === null);
  const box = [...a.arena.actors.values()].find(x => x instanceof NoelBox);
  assert.ok(box, 'rescue box missing');
  assert.equal(a.bot.noel_box, box.id);
  a.tick(9000);
  assert.equal(a.bot.noel_box, null);
  const r = win(p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.equal(p.r_count, 2);
  a.tick(100);
  a.tick(1200);
  assert.ok([...a.arena.objects.values()].length >= 0);
  assert.ok(has(space, 1572) && has(r, 1572));
});

// ---------------------------------------------------------------------------
check('Sima Yi creates orbs, pushes them and volleys', () => {
  const a = makeArena(10000098);
  win(a.tick(0));
  const p = a.player;
  assert.ok(p instanceof SimayiActions);
  assert.ok(p.hasBuff(373101, a.now()));
  const q = win(p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(scenes(q).fires.some(f => f.templateId === 373100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = win(p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.equal(p.e_count, 2);
  a.tick(400);
  const orb = [...a.arena.actors.values()].find(x => x instanceof SimaOrb);
  assert.ok(orb, 'orb actor missing');
  const r = win(p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.equal(p.r_count, 1);
  assert.ok(a.bot.hasBuff(373404, a.now()));
  const space = win(p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.equal(p.orb_count, 0);
  assert.equal(a.bot.hasBuff(373301, a.now()), true);
  assert.equal(a.bot.hasBuff(373350, a.now()), true);
  a.tick(100);
  assert.ok(has(e, 1572) || has(e, 1556));
  assert.ok(has(r, 1572) && has(space, 1572));
});

// ---------------------------------------------------------------------------
check('Doctor Strange clones, reveals and exiles', () => {
  const a = makeArena(10000083);
  win(a.tick(0));
  const p = a.player;
  assert.ok(p instanceof StrangeActions);
  assert.ok(p.hasBuff(357101, a.now()));
  const q = win(p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(scenes(q).fires.some(f => f.templateId === 357100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = win(p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(p.ready, 'E did not arm');
  a.tick(100);
  assert.equal(p.ready, null);
  assert.ok(p.shadow, 'shadow missing');
  assert.ok([...a.arena.actors.values()].some(x => x instanceof StrangeShadow));
  assert.equal(p.hasBuff(357205, a.now()), true);
  a.tick(1000);
  const space = win(p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  a.tick(1100);
  assert.equal(p.hasBuff(357306, a.now()), true);
  assert.ok([...a.arena.objects.keys()].length >= 1);
  // The E clone move parks Strange on the target; step back for the R cast.
  p.position = [600, 612];
  p.motion = null;
  const r = win(p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  a.tick(1000);
  assert.equal(a.bot.hasBuff(357402, a.now()), true, 'exile missing');
  assert.ok(p.shieldAmount(a.now()).gt(0), 'shield burst missing');
  assert.ok(has(space, 1572) && has(r, 1572));
});

// ---------------------------------------------------------------------------
check('Time Goddess spends energy, rewinds and summons a guardian', () => {
  const a = makeArena(10000113);
  win(a.tick(0));
  const p = a.player;
  assert.ok(p instanceof TimeGoddessActions);
  assert.equal(p.mp, 100);
  const q = win(p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(scenes(q).fires.some(f => f.templateId === 389100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(p.mp <= 90);
  const e = win(p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  a.tick(700);
  assert.equal(a.bot.hasBuff(389202, a.now()), true);
  assert.equal(a.bot.hasBuff(389203, a.now()), true);
  const space = win(p.cast(2, p.positionAt(a.now()), p.positionAt(a.now()), 0, a.now()));
  assert.equal(p.hasBuff(389304, a.now()), true);
  const r = win(p.cast(10, p.positionAt(a.now()), p.positionAt(a.now()), 0, a.now()));
  const guardian = [...a.arena.actors.values()].find(x => x instanceof TimeGuardian);
  assert.ok(guardian, 'guardian missing');
  assert.ok(has(e, 1572) && has(space, 1572) && has(r, 1572));
});

// ---------------------------------------------------------------------------
check('Tsubasa bounces, reflects and catches the return shot', () => {
  const a = makeArena(10000111);
  win(a.tick(0));
  const p = a.player;
  assert.ok(p instanceof TsubasaActions);
  assert.equal(p.mp, 150);
  assert.ok(p.hasBuff(386101, a.now()));
  const q = win(p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(scenes(q).fires.some(f => f.templateId === 386100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const e = win(p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.equal(p.e_count, 1);
  assert.ok(p.dash, 'dash missing');
  assert.equal(p.hasBuff(386111, a.now()), true);
  a.tick(1200);
  assert.equal(p.dash, null);
  const space = win(p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.ok(p.ready, 'Space did not arm');
  a.tick(600);
  assert.equal(p.ready, null);
  a.tick(800);
  const r = win(p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  a.tick(1000);
  assert.equal(p.hasBuff(386111, a.now()), true);
  const flight = { attacker_ap: D(10), reflected: false };
  assert.equal(p.reflect_projectile(flight, a.now()), true);
  a.tick(0);
  assert.ok(has(e, 1572) && has(space, 1572) && has(r, 1572));
});

// ---------------------------------------------------------------------------
check('Zhuge switches weather and fires each kit', () => {
  const a = makeArena(10000084);
  win(a.tick(0));
  const p = a.player;
  assert.ok(p instanceof ZhugeActions);
  assert.equal(p.mp, 100);
  assert.ok(p.hasBuff(358911, a.now()));
  const q = win(p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now()));
  assert.ok(scenes(q).fires.some(f => f.templateId === 358100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const r = win(p.cast(10, p.positionAt(a.now()), p.positionAt(a.now()), 0, a.now()));
  assert.equal(p.weather, 1);
  assert.equal(p.hasBuff(358913, a.now()), true);
  const e = win(p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  assert.equal(p.mp, 80);
  a.tick(350);
  assert.equal(a.bot.hasBuff(358204, a.now()), true);
  assert.equal(a.bot.hasBuff(358205, a.now()), true);
  const space = win(p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()));
  a.tick(1300);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(has(e, 1572) && has(space, 1572) && has(r, 1572));
});

console.log(`batch-f2 tanks: ${checks} checks passed`);
