/* Runnable batch-B self-check: node engine/tanks/batch-b.test.js
 *
 * Loads native rows in batch-b-data.json, spawns each kit on map 101 and
 * exercises spawn buffs, all four slots, cooldowns, projectiles and the
 * queued lifecycles (forms, channels, orbs, turret, burns, etc.).
 * No test framework, no core edits.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BattleData } from '../data.js';
import { BattleArena } from '../arena.js';
import { D } from '../math.js';
import { decodeScenePacket } from '../../../scene_protocol.js';
import { decodeCombatPacket } from '../../../combat_protocol.js';
import { GiongActions } from './giong.js';
import { AssassinActions } from './assassin.js';
import { SonTinhActions } from './sontinh.js';
import { ThachSanhActions } from './thachsanh.js';
import { PantherActions } from './panther.js';
import { SpongeActions } from './sponge.js';
import { ScorpionActions } from './scorpion.js';
import { StarLordActions } from './starlord.js';
import { NatsuActions } from './natsu.js';
import { MermaidActions } from './mermaid.js';
import { OxActions } from './ox.js';
import { HikariActions } from './hikari.js';
import { FireGodActions } from './firegod.js';
import { ChuDuActions } from './chudu.js';
import { HuluActions, HuluTurret } from './hulu.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./batch-b-data.json', import.meta.url), 'utf8'));

const CLASSES = {
  10000037: HuluActions,
  10000043: GiongActions,
  10000045: SpongeActions,
  10000048: AssassinActions,
  10000051: SonTinhActions,
  10000063: ThachSanhActions,
  10000065: MermaidActions,
  10000069: ScorpionActions,
  10000089: StarLordActions,
  10000090: NatsuActions,
  10000100: PantherActions,
  10000103: OxActions,
  10000105: FireGodActions,
  10000107: HikariActions,
  10000112: ChuDuActions,
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

function makeArena(tankId, botTankId = 10000043) {
  const clock = { now: 100000 };
  const state = {
    battle: { scene_id: 1234 },
    room: { map_id: 101, camp: 1 },
    char_id: 555, name: 'Tester', tank_id: tankId, tank_level: 1,
    spawns: { 1: [600, 612], 2: [720, 672] },
    bot: { acct_id: 556, name: 'Bot', tank_id: botTankId, tank_level: 1, human: false, in_room: true },
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
check('Giong spawn, shot cycle, piercing E, homing Space and R', () => {
  const a = makeArena(10000043);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof GiongActions);
  assert.equal(p.hasBuff(317101, a.now()), true);
  assert.ok(has(spawn, 1558));

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(p.cooldowns[0] > a.now());
  assert.ok(scenes(q).fires.some(f => [317100, 317102].includes(f.templateId)));
  a.tick(700);

  const e = cast(a, 1, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(p.cooldowns[1] > a.now());
  assert.ok(scenes(e).fires.some(f => f.templateId === 317201));
  a.tick(700);
  assert.equal(a.bot.hasBuff(317211, a.now()), true, 'E never applied its mark');

  const space = cast(a, 2, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(p.ready, 'Space did not arm');
  assert.ok(scenes(space).skills.some(s => s.skillId === 317301));
  const armed = a.tick(1000);
  assert.equal(p.ready, null);
  assert.ok(scenes(armed).fires.some(f => f.templateId === 317301), 'homing spear missing');
  a.tick(800);
  assert.ok(a.bot.hasBuff(317304, a.now()) || a.bot.hp.lt(a.bot.maxHp), 'Space blast missed');

  const r = cast(a, 10, a.bot.positionAt(a.now()), 0);
  assert.equal(p.enhanced_count, 3);
  assert.equal(p.hasBuff(317401, a.now()), true);
  assert.equal(p.hasBuff(317402, a.now()), true);
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(space) && wellFormed(r));
});

// ---------------------------------------------------------------------------
check('Assassin stealth, roll, recast stab and R', () => {
  const a = makeArena(10000048);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof AssassinActions);
  assert.equal(p.hasBuff(322102, a.now()), true);
  assert.equal(p.hasBuff(322103, a.now()), true);
  assert.ok(wellFormed(spawn));

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 322100));
  a.tick(700);

  const stealth = cast(a, 1, a.bot.positionAt(a.now()), 0);
  assert.equal(p.hasBuff(322201, a.now()), true);
  assert.equal(p.hasBuff(322202, a.now()), true);
  assert.ok(has(stealth, 1564));
  a.tick(700);

  const roll = cast(a, 2, a.bot.positionAt(a.now()), 0);
  assert.equal(p.space_count, 2);
  assert.ok(p.dash, 'roll dash missing');
  assert.ok(cooldownSkills(roll).includes(322311), 'roll flipped the button to recast');
  a.tick(500);
  assert.equal(p.dash, null, 'roll did not finish');

  const recast = cast(a, 2, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(p.dash, 'recast stab did not start');
  a.tick(1200);
  assert.equal(p.dash, null);

  const r = cast(a, 10, a.bot.positionAt(a.now()), 0);
  assert.ok(p.ready, 'R did not arm');
  const ready = a.tick(150);
  assert.equal(p.ready, null);
  assert.ok(scenes(ready).fires.some(f => f.templateId === 322401) || a.arena.pending.length);
  assert.ok(wellFormed(stealth) && wellFormed(roll) && wellFormed(recast) && wellFormed(r));
});

// ---------------------------------------------------------------------------
check('Son Tinh rage, stone form and curse lifecycle', () => {
  const a = makeArena(10000051);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof SonTinhActions);
  assert.ok(p.hasBuff(326101, a.now()));
  assert.ok(wellFormed(spawn));

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 326100));
  a.tick(700);

  const rage = cast(a, 1, a.bot.positionAt(a.now()), 0);
  for (const template of [326201, 326202, 326203, 326204, 326205]) {
    assert.equal(p.hasBuff(template, a.now()), true, `rage buff ${template} missing`);
  }
  assert.ok(p.rage_until > a.now());
  a.tick(700);
  const fan = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(fan).fires.filter(f => f.templateId === 326100).length >= 3, 'rage fan missing');
  a.tick(700);

  const space = cast(a, 2, a.bot.positionAt(a.now()), 0);
  assert.ok(p.ready, 'form did not arm');
  assert.ok(scenes(space).skills.some(s => s.skillId === 326301));
  const gather = a.tick(100);
  assert.equal(p.form.phase, 'gathering');
  assert.equal(p.info.untargetable, true);
  assert.equal(a.arena.objects.size, 1);
  assert.ok(has(gather, 1556));
  a.tick(1100);
  a.tick(1700);
  assert.equal(p.form.phase, 'active');
  assert.equal(p.info.untargetable, false);
  assert.ok(p.hasBuff(326321, a.now()));

  const [bx, by] = a.bot.positionAt(a.now());
  const stone = cast(a, 0, [bx + 150, by], a.bot.id);
  const stoneReady = a.tick(150);
  assert.ok(scenes(stoneReady).fires.some(f => f.templateId === 326331), 'stone shot missing');
  assert.ok(has(stone, 1564));

  const r = cast(a, 10, [bx + 100, by], 0);
  assert.ok(has(r, 1556), 'curse object missing');
  const area = a.tick(1000);
  assert.ok(has(area, 1564));
  assert.ok(a.bot.hasBuff(326402, a.now()) || a.bot.hasBuff(326403, a.now()));
  a.tick(2500);
  assert.equal(a.bot.hasBuff(326411, a.now()), true, 'petrify missing');
  a.tick(500);
  assert.equal(a.bot.hasBuff(326422, a.now()), true, 'curse payoff missing');
  assert.ok(wellFormed(q) && wellFormed(rage) && wellFormed(fan) && wellFormed(space)
    && wellFormed(stone) && wellFormed(r));
});

// ---------------------------------------------------------------------------
check('Thach Sanh arrow budget, extended Space and roll', () => {
  const a = makeArena(10000063);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof ThachSanhActions);
  for (const template of [338411, 338412, 338413]) assert.ok(p.hasBuff(template, a.now()));
  assert.ok(has(spawn, 1579), 'spawn basic S1579 missing');

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 338100));
  a.tick(700);

  const e = cast(a, 1, a.bot.positionAt(a.now()), 0);
  assert.equal(scenes(e).fires.filter(f => f.templateId === 338201).length, 5);
  a.tick(700);
  assert.equal(a.bot.hasBuff(338202, a.now()), true);

  const space = cast(a, 2, a.bot.positionAt(a.now()), 0);
  for (const template of [338302, 338303, 338304, 338305, 338306]) {
    assert.ok(p.hasBuff(template, a.now()), `Space buff ${template} missing`);
  }
  assert.ok(has(space, 1579) && has(space, 1572));

  a.tick(700);
  const enhanced = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(enhanced).fires.some(f => f.templateId === 338311));
  a.tick(700);

  const roll = cast(a, 10, a.bot.positionAt(a.now()), 0);
  assert.ok(p.roll, 'roll missing');
  assert.equal(p.hasBuff(338106, a.now()), true);
  assert.ok(scenes(roll).skills.some(s => s.skillId === 338101));
  a.tick(600);
  assert.equal(p.roll, null);
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(space) && wellFormed(enhanced) && wellFormed(roll));
});

// ---------------------------------------------------------------------------
check('Panther E carry and R bombs', () => {
  const a = makeArena(10000100);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof PantherActions);
  assert.ok(p.hasBuff(375101, a.now()) && p.hasBuff(375102, a.now()));

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 375100));
  a.tick(800);

  const e = cast(a, 1, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(p.combo && p.combo.phase === 'e_first');
  assert.ok(p.hasBuff(375202, a.now()));
  a.tick(150);
  assert.equal(p.combo.phase, 'e_wait', 'E first impact missing');
  assert.ok(p.hasBuff(375211, a.now()));
  a.tick(250);
  assert.equal(p.combo.phase, 'e_second');
  assert.ok(p.hasBuff(375220, a.now()));
  a.tick(600);
  assert.equal(p.combo, null, 'E did not finish');
  assert.ok(wellFormed(e));
});

check('Panther R homing strike and five bombs', () => {
  const a = makeArena(10000100);
  a.tick(0);
  const p = a.player;
  const r = cast(a, 10, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(p.combo && p.combo.kind === 'r');
  a.tick(300);
  assert.ok(p.combo, 'R dash did not connect');
  assert.ok(p.hasBuff(375404, a.now()));
  const bombs = a.tick(900);
  assert.ok(scenes(bombs).fires.filter(f => f.templateId === 375420).length >= 5, 'bombs missing');
  a.tick(600);
  assert.equal(p.combo, null);
  assert.ok(wellFormed(r) && wellFormed(bombs));
});

check('Panther Space schedule teleports, marks and finishes', () => {
  const a = makeArena(10000100);
  a.tick(0);
  const p = a.player;
  const space = cast(a, 2, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(p.combo && p.combo.kind === 'space');
  assert.equal(p.info.untargetable, true);
  assert.equal(p.info.damage_immune, true);
  assert.equal(p.hasBuff(375302, a.now()), true);
  assert.ok(has(space, 1556), 'Space visual object missing');
  a.tick(700);
  assert.equal(a.bot.hasBuff(375304, a.now()), true, 'Space first slash mark missing');
  a.tick(4300);
  assert.equal(p.combo, null, 'Space finale did not clear');
  assert.equal(p.info.untargetable, false);
  assert.ok(wellFormed(space));
});

// ---------------------------------------------------------------------------
check('Sponge bubbles, soap lob and passive pickup', () => {
  const a = makeArena(10000045);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof SpongeActions);
  assert.ok(p.hasBuff(319101, a.now()));
  assert.ok(wellFormed(spawn));

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 319100));
  a.tick(800);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = cast(a, 1, a.bot.positionAt(a.now()), 0);
  assert.ok(scenes(e).fires.some(f => f.templateId === 319201));
  a.tick(1000);
  assert.equal(a.bot.hasBuff(319211, a.now()), true, 'soap area missed');
  a.tick(1100);
  assert.ok(a.arena.objects.size >= 1, 'passive soap object missing');

  const space = cast(a, 2, a.bot.positionAt(a.now()), 0);
  assert.ok(scenes(space).skills.some(s => s.skillId === 319301));
  assert.equal(a.bot.hasBuff(319311, a.now()), true);
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(space));
});

// ---------------------------------------------------------------------------
check('Scorpion poison stacks, enhanced basic, cone and Space explosion', () => {
  const a = makeArena(10000069);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof ScorpionActions);
  assert.ok(p.hasBuff(343101, a.now()) && p.hasBuff(343102, a.now()));
  assert.ok(has(spawn, 1579));

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 343100));
  a.tick(1100);
  assert.equal(a.bot.hasBuff(343111, a.now()), true, 'poison mark missing');
  assert.equal(p.marks.size, 1);

  const e = cast(a, 1, a.bot.positionAt(a.now()), 0);
  for (const template of [343201, 343202, 343203]) assert.ok(p.hasBuff(template, a.now()));
  assert.ok(has(e, 1579));
  a.tick(1000);

  const enhanced = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(enhanced).fires.some(f => f.templateId === 343211));
  a.tick(1100);

  const cone = cast(a, 10, a.bot.positionAt(a.now()), 0);
  assert.ok(scenes(cone).skills.some(s => s.skillId === 343401));
  a.tick(400);

  const space = cast(a, 2, a.bot.positionAt(a.now()), 0);
  assert.equal(p.space_count, 1);
  assert.ok(has(space, 1556), 'Space object missing');
  assert.ok(scenes(space).skills.some(s => s.skillId === 343301));
  a.tick(400);
  assert.ok(a.bot.hasBuff(343302, a.now()) || a.bot.hasBuff(343304, a.now()));
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(enhanced) && wellFormed(cone) && wellFormed(space));
});

// ---------------------------------------------------------------------------
check('Star Lord burns, sweep and jump', () => {
  const a = makeArena(10000089);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof StarLordActions);
  assert.ok(p.hasBuff(364101, a.now()));
  assert.ok(wellFormed(spawn));

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 364100));
  a.tick(800);
  assert.ok(a.bot.hasBuff(364102, a.now()), 'burn mark missing');
  assert.ok(a.bot.hasBuff(364103, a.now()));

  const e = cast(a, 1, a.bot.positionAt(a.now()), 0);
  assert.ok(scenes(e).fires.some(f => f.templateId === 364201));
  a.tick(800);

  const space = cast(a, 2, a.bot.positionAt(a.now()), 0);
  for (const template of [364301, 364302, 364303, 364304, 364305]) {
    assert.ok(p.hasBuff(template, a.now()), `sweep buff ${template} missing`);
  }
  const sweep = a.tick(300);
  assert.ok(scenes(sweep).skills.some(s => s.skillId === 364501));
  a.tick(3000);
  assert.equal(p.sweep, null, 'sweep did not end');

  const r = cast(a, 10, a.bot.positionAt(a.now()), 0);
  assert.ok(p.ready, 'jump did not arm');
  assert.ok(p.hasBuff(364403, a.now()));
  const takeoff = a.tick(100);
  assert.equal(p.jump !== null, true, 'jump did not start');
  assert.equal(p.info.untargetable, true);
  assert.ok(scenes(takeoff).moves.length > 0);
  a.tick(800);
  assert.equal(p.jump, null, 'jump did not land');
  assert.equal(p.info.untargetable, false);
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(space) && wellFormed(r));
});

// ---------------------------------------------------------------------------
check('Natsu passive, flame cone, aura and dash', () => {
  const a = makeArena(10000090);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof NatsuActions);
  assert.ok(p.hasBuff(365101, a.now()));
  assert.ok(has(spawn, 1579), 'spawn enhanced-slot S1579 missing');

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 365100));
  assert.equal(p.power_stacks, 0, 'basic shot does not spend a stage');
  a.tick(700);

  const e = cast(a, 1, a.bot.positionAt(a.now()), 0);
  assert.equal(p.power_stacks, 1, 'E did not spend a passive stage');
  assert.ok(p.hasBuff(365102, a.now()) && p.hasBuff(365103, a.now()));
  assert.ok(p.ready && p.ready.slot === 1);
  const flame = a.tick(150);
  assert.equal(a.bot.hasBuff(365202, a.now()), true, 'flame cone missed');
  assert.ok(scenes(flame).skills.some(s => s.skillId === 365201));

  const space = cast(a, 2, a.bot.positionAt(a.now()), 0);
  for (const template of [365402, 365403, 365404, 365405, 365406, 365407]) {
    assert.ok(p.hasBuff(template, a.now()), `aura buff ${template} missing`);
  }
  const tick = a.tick(600);
  assert.ok(scenes(tick).skills.some(s => s.skillId === 365801));
  a.tick(700);

  const r = cast(a, 10, a.bot.positionAt(a.now()), 0);
  assert.ok(p.dash, 'dash state missing');
  assert.equal(p.hasBuff(365301, a.now()) || p.hasBuff(365601, a.now()), true);
  a.tick(800);
  assert.equal(p.dash, null);
  assert.ok(p.hasBuff(365303, a.now()), 'arrival buff missing');
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(space) && wellFormed(r));
});

// ---------------------------------------------------------------------------
check('Mermaid marks, geyser, wave and R shield', () => {
  const a = makeArena(10000065);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof MermaidActions);
  assert.ok(p.hasBuff(340101, a.now()));
  assert.ok(wellFormed(spawn));

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 340100));
  a.tick(800);
  assert.ok(a.bot.hp.lt(a.bot.maxHp), 'basic bullet missed');

  const e = cast(a, 1, a.bot.positionAt(a.now()), 0);
  assert.ok(scenes(e).fires.length === 0 && has(e, 1556));
  assert.ok(scenes(e).skills.some(s => s.skillId === 340201));
  a.tick(800);
  assert.equal(a.bot.hasBuff(340212, a.now()), true, 'geyser missed');

  const r = cast(a, 10, a.bot.positionAt(a.now()), 0);
  assert.ok(scenes(r).fires.some(f => f.templateId === 340401));
  a.tick(800);
  assert.ok(p.shieldAmount(a.now()).gt(0), 'R shield missing');

  const space = cast(a, 2, a.bot.positionAt(a.now()), 0);
  assert.ok(p.ready, 'wave did not arm');
  a.tick(500);
  assert.equal(p.ready, null);
  assert.ok(a.arena.pending.length > 0 || p.ready === null);
  a.tick(800);
  assert.equal(a.bot.hasBuff(340302, a.now()), true, 'wave mark missing');
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(r) && wellFormed(space));
});

// ---------------------------------------------------------------------------
check('Ox thresholds, shield dash, cone and R', () => {
  const a = makeArena(10000103);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof OxActions);
  for (const template of [378111, 378112, 378113]) assert.ok(p.hasBuff(template, a.now()));
  assert.ok(wellFormed(spawn));

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 378100));
  a.tick(800);

  const e = cast(a, 1, a.bot.positionAt(a.now()), 0);
  assert.ok(p.ready, 'dash did not arm');
  const dash = a.tick(350);
  assert.ok(p.dash, 'dash did not start');
  assert.ok(p.shieldAmount(a.now()).gt(0), 'dash shield missing');
  assert.ok(p.hasBuff(378202, a.now()));
  assert.ok(scenes(dash).moves.length > 0);
  a.tick(500);
  assert.equal(p.dash, null);

  const [bx, by] = a.bot.positionAt(a.now());
  const space = cast(a, 2, [bx + 120, by], 0);
  assert.ok(p.ready);
  const cone = a.tick(1000);
  assert.equal(a.bot.hasBuff(378304, a.now()), true, 'cone mark missing');
  assert.ok(scenes(cone).skills.some(s => s.skillId === 378301));

  const r = cast(a, 10, [bx + 120, by], 0);
  assert.equal(p.r_count, 1);
  const shout = a.tick(400);
  assert.equal(a.bot.hasBuff(378402, a.now()), true, 'R mark missing');
  assert.ok(scenes(shout).skills.some(s => s.skillId === 378501) || has(shout, 1564));

  const before = p.received;
  a.bot.damage(a.player.maxHp.mul(D('0.15')), a.now(), { target: a.player, school: 'true' });
  assert.ok(p.received.lt(before) || p.hasBuff(378502, a.now()), 'HP threshold cry did not fire');
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(space) && wellFormed(r));
});

// ---------------------------------------------------------------------------
check('Hikari inspire, ward, eye and temple pulses', () => {
  const a = makeArena(10000107);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof HikariActions);
  assert.ok(p.hasBuff(382101, a.now()) && p.hasBuff(382102, a.now()));
  assert.ok(wellFormed(spawn));

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(p.hasBuff(382122, a.now()) && p.hasBuff(382123, a.now()));
  assert.ok(scenes(q).fires.some(f => f.templateId === 382100));
  a.tick(800);

  const e = cast(a, 1, a.bot.positionAt(a.now()), 0);
  assert.equal(p.e_count, 1);
  assert.ok(scenes(e).fires.some(f => f.templateId === 382201));
  a.tick(800);
  assert.ok(a.bot.hasBuff(382213, a.now()) || a.bot.hasBuff(382214, a.now()));

  const r = cast(a, 10, a.bot.positionAt(a.now()), 0);
  assert.ok(has(r, 1556));
  a.tick(750);
  assert.equal(a.bot.hasBuff(382412, a.now()), true, 'eye mark missing');
  a.tick(1500);
  assert.equal(a.bot.hasBuff(382422, a.now()), true, 'eye tick missing');

  const space = cast(a, 2, a.bot.positionAt(a.now()), 0);
  assert.ok(p.ready);
  a.tick(1000);
  assert.ok(p.temple, 'temple did not open');
  for (const template of [382301, 382302, 382303, 382304]) assert.ok(p.hasBuff(template, a.now()));
  a.tick(1500);
  a.tick(1500);
  assert.equal(p.temple, null, 'temple did not close');
  assert.ok(p.hasBuff(382331, a.now()));
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(r) && wellFormed(space));
});

// ---------------------------------------------------------------------------
check('Fire God trail, jump, nova, melee stage and shield', () => {
  const a = makeArena(10000105);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof FireGodActions);
  assert.ok(p.hasBuff(380101, a.now()) && p.hasBuff(380102, a.now()));
  assert.ok(has(spawn, 1579));

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(p.hasBuff(380111, a.now()), 'trail buff missing');
  assert.ok(scenes(q).fires.some(f => f.templateId === 380100));
  p.position = [620, 612];
  a.tick(400);
  assert.ok(a.arena.objects.size >= 1, 'lava trail object missing');
  a.tick(1100);

  const e = cast(a, 1, [a.bot.positionAt(a.now())[0], a.bot.positionAt(a.now())[1]], 0);
  assert.ok(p.ready);
  a.tick(300);
  assert.ok(p.jump, 'jump did not start');
  const land = a.tick(600);
  assert.equal(p.jump, null, 'jump did not land');
  assert.ok(scenes(land).skills.some(s => s.skillId === 380211), 'landing skill missing');

  const space = cast(a, 2, a.bot.positionAt(a.now()), 0);
  assert.ok(p.hasBuff(380301, a.now()) && p.hasBuff(380302, a.now()));
  const nova = a.tick(2100);
  assert.ok(scenes(nova).skills.some(s => s.skillId === 380311), 'fire nova missing');

  const r = cast(a, 10, a.bot.positionAt(a.now()), 0);
  assert.equal(p.hasBuff(380401, a.now()), true);
  assert.equal(p.hasBuff(380402, a.now()), true);
  assert.ok(p.shieldAmount(a.now()).gt(0), 'R shield missing');

  a.tick(1200);
  const [fx, fy] = a.bot.positionAt(a.now());
  const melee = cast(a, 0, [fx + 120, fy], a.bot.id);
  assert.ok(scenes(melee).skills.some(s => s.skillId === 380141), 'melee stage skill missing');
  assert.equal(p.hasBuff(380403, a.now()), true);
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(space) && wellFormed(r) && wellFormed(melee));
});

// ---------------------------------------------------------------------------
check('Chu Du contagion, orbs and MP channel', () => {
  const a = makeArena(10000112);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof ChuDuActions);
  assert.equal(p.mp, 100);
  assert.ok(p.hasBuff(388101, a.now()) && p.hasBuff(388141, a.now()));
  assert.ok(wellFormed(spawn));

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 388100));
  a.tick(800);

  const e = cast(a, 1, a.bot.positionAt(a.now()), 0);
  assert.equal(p.e_count, 2);
  assert.ok(scenes(e).fires.some(f => f.templateId === 388201));
  a.tick(900);
  assert.ok(a.bot.hasBuff(388113, a.now()), 'burn mark missing');
  assert.ok(a.arena.objects.size >= 1, 'orb object missing');

  const space = cast(a, 2, a.bot.positionAt(a.now()), 0);
  assert.ok(p.ready);
  a.tick(100);
  assert.ok(a.arena.objects.size >= 1);
  a.tick(1000);
  assert.equal(p.ready, null);
  assert.ok(a.bot.hasBuff(388322, a.now()) || a.bot.hp.lt(a.bot.maxHp));

  const r = cast(a, 10, a.bot.positionAt(a.now()), 0);
  assert.ok(p.ready, 'channel did not arm');
  a.tick(300);
  assert.ok(p.channel, 'channel did not open');
  for (const template of [388401, 388402, 388403, 388404, 388405, 388406]) {
    assert.ok(p.hasBuff(template, a.now()), `channel buff ${template} missing`);
  }
  a.tick(500);
  assert.ok(p.hasBuff(388421, a.now()), 'channel cost buff missing');
  a.tick(800);
  const ended = cast(a, 10, a.bot.positionAt(a.now()), 0);
  assert.equal(p.channel, null, 'channel did not end');
  assert.ok(p.hasBuff(388435, a.now()));
  assert.ok(has(ended, 1579));
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(space) && wellFormed(r));
});

// ---------------------------------------------------------------------------
check('Hulu zones, shield conversion and turret', () => {
  const a = makeArena(10000037);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof HuluActions);
  assert.ok(p.hasBuff(311101, a.now()));
  assert.ok(wellFormed(spawn));
  a.tick(3100);
  assert.ok(a.player.alive);

  const q = cast(a, 0, a.bot.positionAt(a.now()), a.bot.id);
  assert.ok(scenes(q).fires.some(f => f.templateId === 311100));
  a.tick(800);

  const e = cast(a, 1, p.positionAt(a.now()), p.id);
  assert.ok(p.hasBuff(311201, a.now()), 'shield buff missing');
  assert.ok(p.shieldAmount(a.now()).gt(0), 'shield amount missing');
  for (const template of [311202, 311203, 311204]) assert.ok(p.hasBuff(template, a.now()));
  a.tick(1300);
  assert.ok(p.hasBuff(311201, a.now()), 'conversion removed the shield early');

  const space = cast(a, 2, a.bot.positionAt(a.now()), 0);
  assert.ok(has(space, 1556), 'healing zone object missing');
  assert.ok(p.hasBuff(311312, a.now()) && p.hasBuff(311313, a.now()));
  const ticked = a.tick(600);
  assert.ok(p.hasBuff(311312, a.now()), 'zone buff did not refresh');
  assert.ok(has(ticked, 1558) || has(ticked, 1581));

  const r = cast(a, 10, a.bot.positionAt(a.now()), 0);
  assert.equal(a.arena.actors.size, 3, 'turret actor missing');
  const turret = [...a.arena.actors.values()].find(actor => actor instanceof HuluTurret);
  assert.ok(turret, 'turret instance missing');
  assert.ok(turret.hasBuff(311421, a.now()) && turret.hasBuff(311431, a.now()));
  const botHp = a.bot.hp.toNumber();
  a.tick(1100);
  assert.ok(turret.alive);
  assert.ok(a.bot.hp.toNumber() < botHp || a.bot.hasBuff(311412, a.now()), 'turret never attacked');
  assert.ok(wellFormed(q) && wellFormed(e) && wellFormed(space) && wellFormed(r));
});

console.log(`batch-b tanks: ${checks} checks passed`);
