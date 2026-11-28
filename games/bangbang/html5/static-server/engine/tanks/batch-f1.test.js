/* Runnable batch-F1 self-check: node engine/tanks/batch-f1.test.js
 *
 * Loads the native rows in batch-f1-data.json, spawns each kit on map 101,
 * casts all slots, and checks spawn buffs, cooldowns, projectiles, shields,
 * traps, stat loans, soul form and the signature queued lifecycles.
 * No test framework, no core edits.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BattleData } from '../data.js';
import { BattleArena } from '../arena.js';
import { D } from '../math.js';
import { decodeScenePacket } from '../../../scene_protocol.js';
import { decodeCombatPacket } from '../../../combat_protocol.js';
import { CaptainActions } from './captain.js';
import { ChopperActions } from './chopper.js';
import { GhostActions } from './ghost.js';
import { GrootActions } from './groot.js';
import { LegolasActions } from './legolas.js';
import { PeaActions } from './pea.js';
import { PikachuActions } from './pikachu.js';
import { SpiderActions } from './spider.js';
import { TeddyActions } from './teddy.js';
import { ThorActions } from './thor.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./batch-f1-data.json', import.meta.url), 'utf8'));

const CLASSES = {
  10000031: CaptainActions,
  10000029: ChopperActions,
  10000038: GhostActions,
  10000002: GrootActions,
  10000041: LegolasActions,
  10000033: PeaActions,
  10000047: PikachuActions,
  10000008: SpiderActions,
  10000032: TeddyActions,
  10000039: ThorActions,
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
    bot: { acct_id: 556, name: 'Bot', tank_id: 10000032, tank_level: 1,
      human: false, in_room: true },
    ally_bot: { acct_id: 557, name: 'Ally', tank_id: 10000032, tank_level: 1,
      human: false, in_room: true },
  };
  const arena = new BattleArena(state, {
    clock: () => clock.now, rng: () => 0.99, data: makeData(), classes: CLASSES,
  });
  return {
    arena,
    clock,
    player: arena.player,
    bot: arena.bot,
    ally: arena.actors.get(3),
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
  const out = { fires: [], skills: [], mp: [], shields: [], moves: [], removed: [] };
  for (const p of packets) {
    if (p[0] !== 1564) continue;
    const d = decodeScenePacket(1564, p[1]);
    out.fires.push(...d.fires);
    out.skills.push(...d.skills);
    out.mp.push(...d.mp);
    out.shields.push(...d.shields);
    out.moves.push(...d.moves);
    out.removed.push(...(d.removedObjects || []));
  }
  return out;
}
function cooldownSkills(packets) {
  return packets.filter(p => p[0] === 1572 || p[0] === 1579)
    .map(([id, body]) => decodeCombatPacket(id, body).skill.skillId);
}
const cast = (a, slot, dest, target = 0) =>
  a.player.cast(slot, a.player.positionAt(a.now()), dest, target, a.now());

// ---------------------------------------------------------------------------
// Captain: aura, toss/return, courage shields and allied R.

check('Captain spawns with command aura and lands Q/E', () => {
  const a = makeArena(10000031);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof CaptainActions);
  assert.equal(p.hasBuff(323101, a.now()), true);
  assert.equal(p.e_count, 2);
  assert.ok(has(spawn, 1558));
  assert.ok(wellFormed(spawn));

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(p.cooldowns[0] > a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 323100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = cast(a, 1, a.bot.positionAt(a.now()), a.bot.id);
  assert.equal(p.e_count, 1);
  assert.ok(p.e_next_charge > a.now());
  assert.ok(cooldownSkills(e).includes(323201));
  a.tick(400);
  assert.equal(a.bot.hasBuff(323202, a.now()), true);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  const returned = a.tick(500);
  assert.ok(scenes(returned).fires.some(f => f.templateId === 323211),
    'returning toss did not launch');
  a.tick(900);
  assert.equal(a.bot.hasBuff(323212, a.now()), true);
});

check('Captain courage shields allies and R buffs both camps slots', () => {
  const a = makeArena(10000031);
  a.tick(0);
  const p = a.player;

  const space = cast(a, 2, [700, 612]);
  assert.ok(p.ready, 'courage did not arm');
  assert.ok(cooldownSkills(space).includes(323301));
  const armed = a.tick(520);
  assert.equal(p.ready, null);
  assert.ok(scenes(armed).skills.some(s => s.skillId === 323301));
  assert.equal(p.hasBuff(323301, a.now()), true);
  assert.equal(p.hasBuff(323302, a.now()), true);
  assert.ok(p.shieldAmount(a.now()).gt(0));
  assert.equal(a.ally.hasBuff(323301, a.now()), true);
  assert.ok(a.ally.shieldAmount(a.now()).gt(0));
  const shield = p.shieldAmount(a.now());
  a.tick(600);
  assert.ok(p.shieldAmount(a.now()).lt(shield));

  const r = cast(a, 10, a.ally.positionAt(a.now()), a.ally.id);
  assert.ok(p.cooldowns[10] > a.now());
  assert.ok(scenes(r).skills.some(s => s.skillId === 323401));
  for (const actor of [p, a.ally]) {
    assert.equal(actor.hasBuff(323401, a.now()), true);
    assert.equal(actor.hasBuff(323402, a.now()), true);
  }
  assert.ok(wellFormed(space) && wellFormed(r));
});

// ---------------------------------------------------------------------------
// Chopper: passive shield, heal beam, wave push and healing aura.

check('Chopper spawns shielded and lands Q/E wave', () => {
  const a = makeArena(10000029);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof ChopperActions);
  assert.equal(p.hasBuff(304111, a.now()), true);
  assert.ok(p.shieldAmount(a.now()).gt(0));
  assert.ok(has(spawn, 1564));

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 304100));
  a.tick(900);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = cast(a, 1, a.ally.positionAt(a.now()), a.ally.id);
  assert.ok(p.cooldowns[1] > a.now());
  assert.ok(scenes(e).skills.some(s => s.skillId === 304201));
  assert.equal(a.ally.hasBuff(304202, a.now()), true);
  assert.ok(wellFormed(q) && wellFormed(e));
});

check('Chopper wave pushes and the healing aura ticks', () => {
  const a = makeArena(10000029);
  a.tick(0);
  const p = a.player;
  p.mp = 0;

  const r = cast(a, 10, a.bot.positionAt(a.now()), a.bot.id);
  assert.equal(p.r_count, 1);
  assert.ok(p.r_next_charge > a.now());
  assert.ok(scenes(r).fires.some(f => f.templateId === 304401));
  assert.ok(scenes(r).fires.some(f => f.templateId === 304401 && f.speed));
  a.tick(800);
  assert.equal(a.bot.hasBuff(304401, a.now()), true);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(a.bot.motion, 'wave did not push the target');

  const space = cast(a, 2, [700, 612]);
  assert.ok(p.aura);
  assert.equal(p.hasBuff(304301, a.now()), true);
  assert.equal(p.hasBuff(304304, a.now()), true);
  assert.ok(scenes(space).skills.some(s => s.skillId === 304301));
  a.tick(600);
  a.tick(6000);
  assert.equal(p.aura, null, 'healing aura did not end');
  assert.ok(wellFormed(r) && wellFormed(space));
});

// ---------------------------------------------------------------------------
// Teddy: basic marks, ally heal and delayed splash.

check('Teddy marks on Q and heals with E', () => {
  const a = makeArena(10000032);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof TeddyActions);

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 306100));
  a.tick(900);
  for (const template of [306101, 306102, 306103]) {
    assert.equal(a.bot.hasBuff(template, a.now()), true);
  }

  a.ally.hp = a.ally.maxHp.mul(D('.5'));
  const e = cast(a, 1, [700, 612]);
  assert.ok(p.cooldowns[1] > a.now());
  assert.ok(scenes(e).skills.some(s => s.skillId === 306201));
  assert.ok(a.ally.hp.gt(a.ally.maxHp.mul(D('.5'))));
  assert.ok(wellFormed(q) && wellFormed(e));
});

check('Teddy Space detonates with split radii', () => {
  const a = makeArena(10000032);
  a.tick(0);
  const p = a.player;
  assert.equal(cast(a, 10, a.bot.positionAt(a.now()), 0).length, 0);

  const dest = a.bot.positionAt(a.now());
  const space = cast(a, 2, dest);
  assert.ok(scenes(space).fires.some(f => f.templateId === 306301));
  const hp = a.bot.hp.toNumber();
  const landed = a.tick(1100);
  assert.ok(a.bot.hp.toNumber() < hp);
  for (const template of [306311, 306321, 306331, 306341]) {
    assert.equal(a.bot.hasBuff(template, a.now()), true);
  }
  assert.ok(wellFormed(space));
});

// ---------------------------------------------------------------------------
// Ghost Rider: marks, judgment channel, soul form and death flame.

check('Ghost Q/E and judgment channel', () => {
  const a = makeArena(10000038);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof GhostActions);
  assert.equal(p.hasBuff(312101, a.now()), true);

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 312100));
  a.tick(500);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = cast(a, 1, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(e).fires.some(f => f.templateId === 312201));
  a.tick(400);
  assert.equal(a.bot.hasBuff(312212, a.now()), true);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const space = cast(a, 2, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(p.channel, 'judgment channel missing');
  assert.equal(p.hasBuff(312331, a.now()), true);
  assert.equal(a.bot.hasBuff(312311, a.now()), true);
  assert.ok(scenes(space).moves.length > 0);
  const hp = a.bot.hp.toNumber();
  a.tick(600);
  assert.ok(a.bot.hp.toNumber() < hp, 'judgment missed');
  a.tick(2600);
  assert.equal(p.channel, null, 'judgment did not end');
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(space));
});

check('Ghost soul form revives at 150% and explodes on real death', () => {
  const a = makeArena(10000038);
  a.tick(0);
  const p = a.player;
  const baseHp = p.maxHp;

  const form = p.commitHp(D(0), a.now());
  assert.ok(p.soul, 'soul form did not start');
  assert.equal(p.hp.toFixed(3), baseHp.mul(D('1.5')).toFixed(3));
  assert.equal(p.maxHp.toFixed(3), baseHp.mul(D('1.5')).toFixed(3));
  assert.equal(p.hasBuff(312111, a.now()), true);
  assert.ok(has(form, 1560), 'max HP packet missing');

  const dead = p.commitHp(D(0), a.now() + 1);
  assert.equal(p.soul, null);
  assert.equal(p.hp.isZero(), true);
  assert.equal(a.arena.objects.size, 1, 'death flame object missing');
  assert.ok(has(dead, 1556));
  const flame = a.tick(500);
  assert.equal(a.arena.objects.size, 0);
  assert.ok(has(flame, 1564));
});

// ---------------------------------------------------------------------------
// Groot: missile, field, drain/borrow and passive regrowth.

check('Groot Q/E and passive regrowth', () => {
  const a = makeArena(10000002);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof GrootActions);
  assert.equal(p.hasBuff(416101, a.now()), true);

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 416100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = cast(a, 1, a.bot.positionAt(a.now()));
  assert.ok(scenes(e).fires.some(f => f.templateId === 416201));
  assert.equal(a.arena.objects.size, 0);
  const blast = a.tick(900);
  assert.equal(a.bot.hasBuff(416202, a.now()), true);
  assert.equal(a.bot.hasBuff(416203, a.now()), true);
  assert.equal(a.arena.objects.size, 1, 'missile landing object missing');

  p.hp = p.maxHp.mul(D('.7'));
  const before = p.hp;
  const passive = p.onDamage(a.bot, { hp_loss: D(1) }, a.now(), 'energy', false, D(1));
  assert.ok(passive_ready_ok(p));
  assert.ok(p.hp.gt(before));
  assert.equal(p.hasBuff(416102, a.now()), true);
  assert.ok(has(passive, 1564));
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(passive));
});

function passive_ready_ok(p) { return p.passive_ready_at > p.clock(); }

check('Groot field opens, damages and expires', () => {
  const a = makeArena(10000002);
  a.tick(0);
  const p = a.player;
  const hp = a.bot.hp.toNumber();
  const space = cast(a, 2, a.bot.positionAt(a.now()));
  assert.equal(p.fields.size, 1);
  assert.equal(a.arena.objects.size, 1);
  assert.ok(scenes(space).skills.some(s => s.skillId === 416301));
  const opened = a.tick(1100);
  assert.ok(has(opened, 1556), 'field opening packet missing');
  assert.equal(a.arena.objects.size, 1);
  assert.ok(a.bot.hp.toNumber() < hp, 'field opening missed');
  assert.equal(a.bot.hasBuff(416315, a.now()), true);
  a.tick(5200);
  assert.equal(p.fields.size, 0);
  assert.equal(a.arena.objects.size, 0);
});

check('Groot drain borrows stats from the target', () => {
  const a = makeArena(10000002);
  a.tick(0);
  const p = a.player;
  const r = cast(a, 10, [700, 612]);
  assert.ok(p.drain, 'drain aura missing');
  assert.equal(p.hasBuff(416401, a.now()), true);
  assert.equal(p.hasBuff(416403, a.now()), true);
  assert.ok(scenes(r).skills.some(s => s.skillId === 416401));
  a.tick(600);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.equal(p.statLoans.size, 1, 'caster loan missing');
  assert.equal(a.bot.statLoans.size, 1, 'target loan missing');
  for (const template of [416412, 416413]) {
    assert.equal(p.hasBuff(template, a.now()), true);
  }
  for (const template of [416415, 416416]) {
    assert.equal(a.bot.hasBuff(template, a.now()), true);
  }
  a.tick(5000);
  assert.equal(p.drain, null);
  assert.equal(p.hasBuff(416403, a.now()), false);
  assert.ok(wellFormed(r));
});

// ---------------------------------------------------------------------------
// Legolas: marks, piercing E, root field and rain.

check('Legolas Q marks and E detonates/pushes', () => {
  const a = makeArena(10000041);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof LegolasActions);

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 315100));
  a.tick(800);
  assert.equal(a.bot.hasBuff(315101, a.now()), true);
  assert.equal(p.hasBuff(315121, a.now()), true);

  const e = cast(a, 1, a.bot.positionAt(a.now()));
  assert.equal(p.e_count, 2);
  assert.ok(p.e_next_charge > a.now());
  assert.ok(scenes(e).fires.some(f => f.templateId === 315201));
  a.tick(250);
  assert.equal(a.bot.hasBuff(315112, a.now()), true);
  assert.equal(a.bot.hasBuff(315203, a.now()), true);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(q) && wellFormed(e));
});

check('Legolas Space roots and R starts rain', () => {
  const a = makeArena(10000041);
  a.tick(0);
  const p = a.player;

  const space = cast(a, 2, a.bot.positionAt(a.now()));
  assert.ok(scenes(space).fires.some(f => f.templateId === 315301));
  const rooted = a.tick(800);
  assert.equal(p.fields.size, 1);
  assert.equal(a.arena.objects.size, 1);
  assert.ok(has(rooted, 1556), 'root field packet missing');
  assert.equal(a.bot.hasBuff(315305, a.now()), true);

  const r = cast(a, 10, a.bot.positionAt(a.now()));
  assert.ok(p.ready, 'rain did not arm');
  assert.ok(cooldownSkills(r).includes(315401));
  const rain = a.tick(250);
  assert.equal(p.ready, null);
  assert.ok(a.arena.objects.size >= 1, 'rain field missing');
  const ticked = a.tick(1800);
  assert.equal(a.bot.hasBuff(315405, a.now()), true);
  assert.ok(has(ticked, 1564));
  assert.ok(wellFormed(space) && wellFormed(r));
});

// ---------------------------------------------------------------------------
// Pea Shooter: MP, marks, trap, Gatling and bomb.

check('Pea Q/E trap and MP rider', () => {
  const a = makeArena(10000033);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof PeaActions);
  assert.equal(p.mp, 200);
  p.mp = 150;

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 307100));
  a.tick(800);
  assert.equal(a.bot.hasBuff(307121, a.now()), true);
  assert.equal(a.bot.hasBuff(307122, a.now()), true);
  assert.equal(p.mp, 155);

  const e = cast(a, 1, a.bot.positionAt(a.now()));
  assert.equal(p.e_count, 1);
  assert.equal(p.traps.size, 1);
  assert.equal(a.arena.objects.size, 1);
  const armed = a.tick(1000);
  assert.ok(has(armed, 1564));
  assert.equal(p.traps.size, 0, 'trap did not trigger on the occupied point');
  assert.equal(a.bot.hasBuff(307232, a.now()), true);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(q) && wellFormed(e));
});

check('Pea Gatling toggles, spends MP and ends', () => {
  const a = makeArena(10000033);
  a.tick(0);
  const p = a.player;

  const on = cast(a, 2, [700, 612]);
  assert.equal(p.gatling, true);
  for (const template of [307301, 307302, 307303, 307304, 307305, 307306]) {
    assert.equal(p.hasBuff(template, a.now()), true);
  }
  assert.ok(cooldownSkills(on).includes(307311));
  assert.ok(has(on, 1560), 'fire-rate packet missing');

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 307321));
  assert.equal(p.mp, 190);

  const off = cast(a, 2, [700, 612]);
  assert.equal(p.gatling, false);
  for (const template of [307301, 307302, 307303, 307304, 307305, 307306]) {
    assert.equal(p.hasBuff(template, a.now()), false);
  }
  assert.ok(cooldownSkills(off).includes(307301));
  assert.ok(wellFormed(on) && wellFormed(q) && wellFormed(off));
});

check('Pea bomb detonates and photosynthesis begins idle', () => {
  const a = makeArena(10000033);
  a.tick(0);
  const p = a.player;
  p.mp = 100;

  const r = cast(a, 10, a.bot.positionAt(a.now()), a.bot.id);
  assert.equal(a.bot.hasBuff(307401, a.now()), true);
  assert.equal(p.bombs.size, 1);
  const hp = a.bot.hp.toNumber();
  a.tick(2100);
  assert.equal(p.bombs.size, 0);
  assert.equal(a.bot.hasBuff(307403, a.now()), true);
  assert.ok(a.bot.hp.toNumber() < hp, 'bomb missed');
  assert.ok(p.mp > 100, 'bomb kill did not refund MP');

  a.tick(2600);
  assert.equal(p.photosynthesis, true, 'idle photosynthesis did not begin');
  assert.equal(p.info.untargetable, true);
  for (const template of [307131, 307132, 307133]) {
    assert.equal(p.hasBuff(template, a.now()), true);
  }
  assert.ok(wellFormed(r));
});

// ---------------------------------------------------------------------------
// Pikachu: marks, contact dash, discharge and R bolt.

check('Pikachu Q marks and E dash contact', () => {
  const a = makeArena(10000047);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof PikachuActions);

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 321100));
  a.tick(900);
  assert.equal(a.bot.hasBuff(321121, a.now()), true);
  assert.equal(a.bot.hasBuff(321102, a.now()), true);

  const e = cast(a, 1, a.bot.positionAt(a.now()));
  assert.ok(p.ready, 'E did not arm');
  assert.ok(cooldownSkills(e).includes(321201));
  const dash = a.tick(200);
  assert.equal(p.ready, null);
  assert.ok(p.motion, 'dash motion missing');
  assert.ok(p.contact, 'contact aura missing');
  assert.equal(p.hasBuff(321202, a.now()), true);
  assert.ok(scenes(dash).moves.length > 0);
  a.tick(300);
  assert.equal(a.bot.hasBuff(321213, a.now()), true);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(q) && wellFormed(e));
});

check('Pikachu R bolt, marks and discharge aura', () => {
  const a = makeArena(10000047);
  a.tick(0);
  const p = a.player;
  assert.equal(p.r_count, 2);

  const r = cast(a, 10, a.bot.positionAt(a.now()));
  assert.equal(p.r_count, 1);
  assert.ok(p.r_next_charge > a.now());
  const fired = a.tick(200);
  assert.ok(scenes(fired).fires.some(f => f.templateId === 321401));
  const hit = a.tick(900);
  assert.equal(a.bot.hasBuff(321402, a.now()), true);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(has(hit, 1564));

  const space = cast(a, 2, [700, 612]);
  assert.ok(p.discharge, 'discharge missing');
  assert.equal(p.hasBuff(321301, a.now()), true);
  assert.equal(p.hasBuff(321304, a.now()), true);
  const ticked = a.tick(600);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(has(ticked, 1564));
  a.tick(5200);
  assert.equal(p.discharge, null, 'discharge did not end');
  assert.ok(wellFormed(r) && wellFormed(space));
});

// ---------------------------------------------------------------------------
// Spider Man: web field, dash and web-pull.

check('Spider Q shot, E dash and R web', () => {
  const a = makeArena(10000008);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof SpiderActions);
  assert.equal(p.mp, 100);
  assert.equal(p.hasBuff(303101, a.now()), true);

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 303100));
  a.tick(800);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = cast(a, 1, a.bot.positionAt(a.now()));
  assert.equal(p.mp, 75);
  assert.ok(p.dash, 'dash missing');
  assert.equal(p.hasBuff(303202, a.now()), true);
  a.tick(300);
  assert.equal(a.bot.hasBuff(303213, a.now()), true);
  assert.equal(p.mp, 100);
  a.tick(700);
  assert.equal(p.dash, null);

  const r = cast(a, 10, a.bot.positionAt(a.now()));
  assert.equal(p.r_count, 2);
  assert.ok(p.r_next_charge > a.now());
  assert.equal(p.hasBuff(303113, a.now()), true);
  const fired = a.tick(200);
  assert.ok(scenes(fired).fires.some(f => f.templateId === 303401));
  a.tick(1000);
  assert.equal(p.webs.size, 1, 'web object missing');
  assert.equal(a.bot.hasBuff(303403, a.now()), true);
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(r));
});

check('Spider web-pull moves both actors', () => {
  const a = makeArena(10000008);
  a.tick(0);
  const p = a.player;

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  a.tick(800);
  const r = cast(a, 10, a.bot.positionAt(a.now()), a.bot.id);
  assert.equal(p.hasBuff(303113, a.now()), true);
  a.tick(200);
  a.tick(1000);
  const webStart = p.webs.size;
  assert.ok(webStart >= 1);

  const shot = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.equal(p.hasBuff(303113, a.now()), false);
  const pulled = a.tick(200);
  assert.ok(has(pulled, 1564));
  a.tick(500);
  assert.equal(p.hasBuff(303136, a.now()), true);
  assert.ok(wellFormed(q) && wellFormed(r) && wellFormed(shot));
});

check('Spider Space field damages and expires', () => {
  const a = makeArena(10000008);
  a.tick(0);
  const p = a.player;
  const hp = a.bot.hp.toNumber();
  const space = cast(a, 2, a.bot.positionAt(a.now()));
  assert.equal(p.fields.size, 1);
  assert.equal(a.arena.objects.size, 1);
  assert.ok(scenes(space).skills.some(s => s.skillId === 303301));
  const open = a.tick(700);
  assert.ok(has(open, 1556), 'field opening packet missing');
  assert.equal(a.arena.objects.size, 1);
  a.tick(1100);
  assert.ok(a.bot.hp.toNumber() < hp, 'field tick missed');
  assert.equal(a.bot.hasBuff(303305, a.now()), true);
  a.tick(5000);
  assert.equal(p.fields.size, 0);
  assert.equal(a.arena.objects.size, 0);
});

// ---------------------------------------------------------------------------
// Thor: hammer chain, thunder field and strike.

check('Thor Q/E hammer marks and chain', () => {
  const a = makeArena(10000039);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof ThorActions);
  assert.equal(p.hasBuff(313101, a.now()), true);

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 313100));
  a.tick(900);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = cast(a, 1, a.bot.positionAt(a.now()), a.bot.id);
  assert.equal(p.e_count, 1);
  assert.ok(p.e_next_charge > a.now());
  assert.ok(scenes(e).fires.some(f => f.templateId === 313201));
  a.tick(1100);
  assert.equal(a.bot.hasBuff(313131, a.now()), true);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(q) && wellFormed(e));
});

check('Thor Space creates a field and R strikes', () => {
  const a = makeArena(10000039);
  a.tick(0);
  const p = a.player;

  const space = cast(a, 2, a.bot.positionAt(a.now()));
  assert.ok(p.ready, 'hammer did not arm');
  const fired = a.tick(200);
  assert.equal(p.ready, null);
  assert.ok(scenes(fired).fires.some(f => f.templateId === 313301));
  const crash = a.tick(900);
  assert.ok(has(crash, 1556), 'thunder field packet missing');
  assert.equal(p.fields.size, 1, 'thunder field missing');
  assert.equal(a.arena.objects.size, 1);
  const zapped = a.tick(1100);
  assert.equal(a.bot.hasBuff(313312, a.now()), true);
  assert.ok(has(zapped, 1564));

  const r = cast(a, 10, a.bot.positionAt(a.now()));
  assert.equal(a.arena.objects.size, 3, 'strike props missing');
  const hp = a.bot.hp.toNumber();
  a.tick(550);
  assert.equal(a.arena.objects.size, 2);
  const strike = a.tick(150);
  assert.ok(a.bot.hp.toNumber() < hp, 'thunder strike missed');
  assert.equal(a.bot.hasBuff(313412, a.now()), true);
  assert.ok(has(strike, 1564));
  a.tick(5000);
  assert.equal(p.fields.size, 0);
  assert.ok(wellFormed(space) && wellFormed(r));
});

console.log(`batch-f1 tanks: ${checks} checks passed`);
