/* Runnable batch-C self-check: node engine/tanks/batch-c.test.js
 *
 * Loads the native rows in batch-c-data.json, spawns each kit on map 101,
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
import { BaymaxActions } from './baymax.js';
import { AthenaActions } from './athena.js';
import { HulkActions } from './hulk.js';
import { TimeHunterActions } from './timehunter.js';
import { PegasusActions } from './pegasus.js';
import { PhoenixActions } from './phoenix.js';
import { DiaoChanActions } from './diaochan.js';
import { ThuyTinhActions } from './thuytinh.js';
import { TransformerActions } from './transformer.js';
import { SupermanActions } from './superman.js';
import { MedusaActions } from './medusa.js';
import { JokerActions } from './joker.js';
import { FoxActions } from './fox.js';
import { FalconActions } from './falcon.js';
import { WukongActions } from './wukong.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./batch-c-data.json', import.meta.url), 'utf8'));

const CLASSES = {
  10000034: HulkActions,
  10000035: PegasusActions,
  10000036: WukongActions,
  10000049: TransformerActions,
  10000050: TimeHunterActions,
  10000053: SupermanActions,
  10000058: MedusaActions,
  10000059: PhoenixActions,
  10000071: JokerActions,
  10000073: BaymaxActions,
  10000074: DiaoChanActions,
  10000079: ThuyTinhActions,
  10000085: AthenaActions,
  10000086: FoxActions,
  10000104: FalconActions,
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

function makeArena(tankId, { ally = false } = {}) {
  const clock = { now: 100000 };
  const state = {
    battle: { scene_id: 1234 },
    room: { map_id: 101, camp: 1 },
    char_id: 555, name: 'Tester', tank_id: tankId, tank_level: 1,
    spawns: { 1: [600, 612], 2: [780, 804] },
    // A neutral TankActions opponent: silent, no auto-cast.
    bot: { acct_id: 556, name: 'Bot', tank_id: 10000003, tank_level: 1, human: false, in_room: true },
  };
  if (ally) {
    state.ally_bot = {
      acct_id: 557, name: 'Ally', tank_id: 10000003, tank_level: 1, human: false, in_room: true,
    };
  }
  const arena = new BattleArena(state, {
    clock: () => clock.now, rng: () => 0.99, data: makeData(), classes: CLASSES,
  });
  return {
    arena,
    clock,
    player: arena.player,
    bot: arena.bot,
    ally: arena.actors.get(3) ?? null,
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
function distanceTo(actor, position, now) {
  const pos = actor.positionAt(now);
  return Math.hypot(pos[0] - position[0], pos[1] - position[1]);
}

// ---------------------------------------------------------------------------
// Baymax: tether heal, shot blast, intercept flight.

check('Baymax links allies, refunds MP and lands the intercept', () => {
  const a = makeArena(10000073, { ally: true });
  const spawn = a.tick(0);
  const p = a.player, ally = a.ally;
  assert.ok(p instanceof BaymaxActions);
  assert.equal(p.mp, 100);
  assert.equal(p.hasBuff(347101, a.now()), true);
  assert.ok(has(spawn, 1564) && has(spawn, 1572) && has(spawn, 1579));
  assert.ok(wellFormed(spawn));

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.ok(p.cooldowns[0] > a.now());
  assert.ok(scenes(q).fires.some(f => f.templateId === 347100));
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.e_count, 2);
  assert.ok(scenes(e).fires.some(f => f.templateId === 347201));
  const hpBefore = a.bot.hp.toNumber();
  a.tick(520);
  assert.ok(a.bot.hp.toNumber() < hpBefore, 'E blast missed');
  assert.ok(a.arena.objects.size >= 1, 'E blast object missing');

  const mpBefore = p.mp;
  const r = p.cast(10, p.positionAt(a.now()), ally.positionAt(a.now()), ally.id, a.now());
  assert.ok(p.link, 'R did not tether');
  assert.equal(p.hasBuff(347402, a.now()), true);
  assert.equal(ally.hasBuff(347401, a.now()), true);
  assert.equal(p.mp, mpBefore - 20);
  a.tick(1000);
  assert.ok(p.mp <= mpBefore - 10, 'tether tick did not drain MP');
  assert.ok(has(r, 1572) && wellFormed(r));

  const space = p.cast(2, p.positionAt(a.now()), ally.positionAt(a.now()), ally.id, a.now());
  assert.ok(p.ready, 'Space did not arm');
  assert.equal(ally.hasBuff(347303, a.now()), true);
  assert.ok(cooldownSkills(space).includes(347301));
  a.tick(500);
  assert.ok(p.dash, 'intercept did not launch');
  a.tick(1500);
  assert.equal(p.dash, null);
  assert.ok(p.form, 'guardian form did not start');
  assert.ok(p.shieldAmount(a.now()).gt(0));
  assert.ok(ally.shieldAmount(a.now()).gt(0));
  ally.hp = ally.maxHp.mul(D('.2'));
  const emergency = p._emergency(a.now());
  assert.ok(p.passive_ready_at > a.now(), 'emergency did not arm the passive');
  assert.equal(p.hasBuff(347103, a.now()), true);
  assert.equal(ally.hasBuff(347104, a.now()), true);
  assert.ok(wellFormed(emergency));
  assert.ok(wellFormed(space));
});

// ---------------------------------------------------------------------------
// Athena: Q bolt, ally E shield, blessing, soul mark.

check('Athena shields allies, blesses and marks for true damage', () => {
  const a = makeArena(10000085, { ally: true });
  a.tick(0);
  const p = a.player, ally = a.ally;
  assert.ok(p instanceof AthenaActions);
  assert.equal(p.mp, 150);
  assert.equal(p.hasBuff(359101, a.now()), true);

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.ok(p.cooldowns[0] > a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = p.cast(1, p.positionAt(a.now()), ally.positionAt(a.now()), ally.id, a.now());
  assert.ok(p.ready, 'E did not arm');
  assert.ok(cooldownSkills(e).includes(359201));
  a.tick(50);
  assert.equal(p.ready, null);
  assert.ok(ally.shieldAmount(a.now()).gt(0), 'ally shield missing');
  assert.equal(ally.hasBuff(359201, a.now()), true);
  assert.ok(ally.athenaShield, 'shield ledger missing');

  const blessing = p.cast(2, p.positionAt(a.now()), ally.positionAt(a.now()), ally.id, a.now());
  assert.equal(ally.hasBuff(359301, a.now()), true);
  assert.equal(ally.hasBuff(359302, a.now()), true);
  const hpAlly = ally.hp.toNumber();
  a.tick(3100);
  assert.ok(ally.hp.toNumber() >= hpAlly);
  assert.ok(wellFormed(blessing));

  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.r_count, 2);
  assert.ok(p.cooldowns[10] > a.now());
  assert.equal(p.hasBuff(359401, a.now()), false);
  assert.equal(a.bot.hasBuff(359401, a.now()), true);
  const hpBefore = a.bot.hp.toNumber();
  a.tick(1000);
  assert.ok(a.bot.hp.toNumber() < hpBefore, 'soul mark dealt no damage');
  assert.ok(wellFormed(r));
});

// ---------------------------------------------------------------------------
// Hulk: regen, leap, rage heals and shockwave.

check('Hulk leaps, heals on basics and pulses rage', () => {
  const a = makeArena(10000034);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof HulkActions);
  assert.equal(p.hasBuff(308101, a.now()), true);
  assert.equal(p.hasBuff(308102, a.now()), true);

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(has(q, 1564));

  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.ready, 'E did not arm');
  assert.ok(a.arena.objects.size >= 1, 'warning object missing');
  a.tick(100);
  assert.ok(p.jump, 'leap did not start');
  a.tick(600);
  assert.equal(p.jump, null);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.equal(a.bot.hasBuff(308512, a.now()), true);
  assert.ok(wellFormed(e));

  const space = p.cast(2, p.positionAt(a.now()), p.positionAt(a.now()), 0, a.now());
  assert.equal(p.hasBuff(308601, a.now()), true);
  assert.equal(p.hasBuff(308604, a.now()), true);
  const hpBefore = p.hp.toNumber();
  a.tick(1100);
  assert.ok(p.hp.toNumber() >= hpBefore);
  assert.ok(wellFormed(space));

  const [bx, by] = a.bot.positionAt(a.now());
  const r = p.cast(10, [bx, by], [bx, by], 0, a.now());
  assert.ok(p.cooldowns[10] > a.now());
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(a.bot.hasBuff(308402, a.now()) || a.bot.hasBuff(308403, a.now()));
  assert.ok(wellFormed(r));
});

// ---------------------------------------------------------------------------
// Time Hunter: rewind, pulse channel, wormhole.

check('Time Hunter rewinds, pulses and detonates the wormhole', () => {
  const a = makeArena(10000050);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof TimeHunterActions);
  assert.equal(p.hasBuff(325401, a.now()), true);

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const rewind = p.cast(1, p.positionAt(a.now()), p.positionAt(a.now()), 0, a.now());
  assert.ok(p.rewind, 'rewind did not arm');
  assert.equal(p.hasBuff(325201, a.now()), true);
  a.tick(3600);
  assert.equal(p.rewind, null);
  assert.ok(a.arena.objects.size >= 0);
  assert.ok(wellFormed(rewind));

  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.ready, 'channel did not arm');
  a.tick(200);
  assert.ok(p.channel, 'channel did not open');
  assert.equal(a.bot.hasBuff(325607, a.now()), true);
  const hpBefore = a.bot.hp.toNumber();
  a.tick(3100);
  assert.equal(p.channel, null, 'channel did not finish');
  assert.ok(a.bot.hp.toNumber() < hpBefore, 'channel pulses missed');
  assert.ok(wellFormed(space));

  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.worm, 'wormhole did not arm');
  assert.ok(cooldownSkills(r).includes(325701) || cooldownSkills(r).includes(325501));
  a.tick(300);
  assert.ok(p.worm.npc, 'wormhole NPC missing');
  a.tick(3500);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.equal(a.bot.hasBuff(325522, a.now()), true);
  assert.ok(wellFormed(r));
});

// ---------------------------------------------------------------------------
// Pegasus: ward, vanish, meteor fan, spear.

check('Pegasus vanishes, fans meteors and spears', () => {
  const a = makeArena(10000035);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof PegasusActions);
  assert.equal(p.hasBuff(309111, a.now()), true);
  assert.equal(p.ward_count, 3);
  const [wardBlocked] = p.block_hit([999, 0, 0, 1], D(10), a.now());
  assert.equal(wardBlocked, true, 'counted ward did not block');
  assert.equal(p.ward_count, 2);

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(has(q, 1564));

  const e = p.cast(1, p.positionAt(a.now()), p.positionAt(a.now()), 0, a.now());
  assert.ok(p.vanish, 'vanish did not start');
  assert.equal(p.info.untargetable, true);
  assert.equal(p.hasBuff(309201, a.now()), true);
  a.tick(3200);
  assert.equal(p.vanish, null);
  assert.equal(p.info.untargetable, undefined);
  assert.equal(p.hasBuff(309211, a.now()), true);
  assert.ok(wellFormed(e));

  const hpBefore = a.bot.hp.toNumber();
  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.ready, 'meteors did not arm');
  const armed = a.tick(150);
  assert.equal(p.ready, null);
  const meteors = scenes(space.concat(armed)).fires.filter(f => f.templateId === 309301);
  assert.ok(meteors.length >= 12, `expected 12 meteors, got ${meteors.length}`);
  a.tick(900);
  assert.ok(a.bot.hp.toNumber() < hpBefore, 'meteor line missed');

  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.r_count, 1);
  const hpSpear = a.bot.hp.toNumber();
  a.tick(800);
  assert.ok(a.bot.hp.toNumber() < hpSpear);
  assert.equal(a.bot.hasBuff(309402, a.now()), true);
  assert.ok(wellFormed(r));
});

// ---------------------------------------------------------------------------
// Phoenix: burn, dash trail, area burst, rebirth.

check('Phoenix burns on dash, bursts and rebirths in the egg', () => {
  const a = makeArena(10000059);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof PhoenixActions);
  assert.equal(p.hasBuff(334101, a.now()), true);

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.dash, 'dash did not start');
  a.tick(700);
  assert.equal(p.dash, null);
  assert.equal(a.bot.hasBuff(334111, a.now()), true);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(wellFormed(e));

  const [bx, by] = a.bot.positionAt(a.now());
  const hpBefore = a.bot.hp.toNumber();
  const r = p.cast(10, [bx, by], [bx, by], 0, a.now());
  assert.ok(a.bot.hp.toNumber() < hpBefore);
  assert.equal(a.bot.hasBuff(334411, a.now()), true);
  assert.ok(wellFormed(r));

  const hpFull = p.maxHp.toNumber();
  const space = p.cast(2, p.positionAt(a.now()), p.positionAt(a.now()), 0, a.now());
  assert.ok(p.egg, 'egg did not arm');
  assert.equal(p.hasBuff(334304, a.now()), true);
  assert.ok(p.hp.toNumber() < hpFull, 'egg did not pay half HP');
  a.tick(2600);
  assert.equal(p.egg, null);
  assert.equal(p.hasBuff(334333, a.now()), true);
  assert.ok(p.hp.toNumber() > hpFull * 0.9, 'rebirth did not heal');
  assert.ok(wellFormed(space));
});

// ---------------------------------------------------------------------------
// Diao Chan: dash fans, marks, charm.

check('Diao Chan dash-fans, stacks marks and charms', () => {
  const a = makeArena(10000074);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof DiaoChanActions);
  assert.equal(p.hasBuff(348101, a.now()), true);

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.ready, 'E did not arm');
  a.tick(100);
  assert.ok(p.dash, 'E dash did not start');
  assert.equal(p.hasBuff(348202, a.now()), true);
  a.tick(700);
  assert.equal(p.dash, null);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok([348111, 348112, 348113, 348114].some(t => a.bot.hasBuff(t, a.now())));
  assert.ok(wellFormed(e));

  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.space_count, 2);
  assert.equal(p.hasBuff(348321, a.now()), true);
  assert.ok(cooldownSkills(space).includes(348301));
  const armed = a.tick(100);
  const fans = scenes(space.concat(armed)).fires.filter(f => f.templateId === 348301);
  assert.ok(fans.length >= 3, `expected 3 fans, got ${fans.length}`);
  a.tick(900);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  a.tick(700);
  assert.equal(a.bot.hasBuff(348402, a.now()), true);
  assert.ok(a.bot.hasBuff(348403, a.now()) || a.bot.hasBuff(348404, a.now()));
  assert.ok(wellFormed(r));
});

// ---------------------------------------------------------------------------
// Thuy Tinh: mark, water wall, ice area, ice rebirth.

check('Thuy Tinh walls, marks and freezes at lethal HP', () => {
  const a = makeArena(10000079);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof ThuyTinhActions);
  assert.equal(p.hasBuff(353111, a.now()), true);

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hasBuff(353200, a.now()), 'basic did not start the ice mark');
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const hpBefore = a.bot.hp.toNumber();
  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.water_wall, 'water wall missing');
  assert.ok(p.water_wall.blocks.length > 0);
  assert.equal(p.hasBuff(353501, a.now()), true);
  assert.ok(a.bot.hp.toNumber() < hpBefore);
  assert.ok(wellFormed(e));

  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.ready, 'Space did not arm');
  a.tick(60);
  assert.equal(p.ready, null);
  a.tick(1200);
  const hpArea = a.bot.hp.toNumber();
  a.tick(4500);
  assert.ok(a.bot.hp.toNumber() < hpArea, 'ice area missed');
  assert.ok(wellFormed(space));

  const [bx, by] = a.bot.positionAt(a.now());
  const r = p.cast(10, [bx, by], [bx, by], 0, a.now());
  assert.ok(p.cooldowns[10] > a.now());
  assert.equal(a.bot.hasBuff(353300, a.now()), true);
  assert.ok(wellFormed(r));

  const passive = p.commitHp(D(0), a.now());
  assert.ok(p.ice, 'ice rebirth did not trigger');
  assert.equal(p.hp.toNumber(), 1);
  assert.equal(p.hasBuff(353121, a.now()), true);
  assert.ok(p.cooldowns[2] >= a.now());
  a.tick(2100);
  assert.equal(p.ice, null);
  assert.equal(p.hasBuff(353131, a.now()), true);
  assert.ok(wellFormed(passive));
});

// ---------------------------------------------------------------------------
// Transformer: scoped reactions, beam, charged pierce.

check('Transformer fires reactions, beam and charged pierce', () => {
  const a = makeArena(10000049);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof TransformerActions);
  assert.equal(p.hasBuff(324101, a.now()), true);

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.ready, 'E did not arm');
  a.tick(100);
  assert.equal(p.ready, null);
  const hpAfterE = a.bot.hp.toNumber();
  a.tick(700);
  assert.ok(a.bot.hp.toNumber() < hpAfterE);
  assert.ok(a.bot.hasBuff(324202, a.now()) || a.bot.hasBuff(324203, a.now()));
  assert.ok(wellFormed(e));

  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.ready, 'beam did not arm');
  a.tick(100);
  assert.equal(p.ready, null);
  const hpBeam = a.bot.hp.toNumber();
  a.tick(1100);
  assert.ok(a.bot.hp.toNumber() < hpBeam, 'beam missed');
  assert.equal(a.bot.hasBuff(324313, a.now()), true);
  assert.ok(wellFormed(space));

  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.r_count, 1);
  assert.ok(p.ready, 'R did not arm');
  a.tick(100);
  const hpR = a.bot.hp.toNumber();
  a.tick(800);
  assert.ok(a.bot.hp.toNumber() < hpR);
  assert.ok(a.bot.hasBuff(324402, a.now()) || a.bot.hasBuff(324403, a.now()));
  assert.ok(wellFormed(r));
});

// ---------------------------------------------------------------------------
// Superman: nearby auras, dash, throwdown, no R.

check('Superman keeps auras, dashes and lands the throwdown', () => {
  const a = makeArena(10000053);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof SupermanActions);
  assert.equal(10 in p.cooldowns, false);
  assert.equal(p.hasBuff(328131, a.now()), true);
  assert.equal(p.nearby, 1);
  assert.equal(p.hasBuff(328101, a.now()), true);
  assert.equal(p.hasBuff(328111, a.now()), true);
  assert.equal(p.hasBuff(328121, a.now()), true);
  assert.ok(has(spawn, 1558));

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.dash, 'dash did not start');
  assert.equal(p.hasBuff(328212, a.now()), true);
  a.tick(500);
  assert.ok(a.bot.hasBuff(328222, a.now()));
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  a.tick(400);
  assert.equal(p.dash, null);
  assert.equal(p.hasBuff(328231, a.now()), true, 'dash count did not start');
  assert.ok(wellFormed(e));

  const throwdown = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.ok(has(throwdown, 1578), 'S1578 missing');
  assert.equal(a.bot.hasBuff(328303, a.now()), true);
  assert.ok(wellFormed(throwdown));
  a.tick(1100);
  assert.equal(a.bot.hasBuff(328304, a.now()), true);
  assert.equal(a.bot.hasBuff(328307, a.now()), true);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  assert.deepEqual(p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now()), []);
});

// ---------------------------------------------------------------------------
// Medusa: curses, bouncing snake and paid channel.

check('Medusa curses, bounces and pays for the channel', () => {
  const a = makeArena(10000058);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof MedusaActions);
  assert.equal(p.mp, 150);
  assert.equal(p.hasBuff(333101, a.now()), true);

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.equal(a.bot.hasBuff(333121, a.now()), true, 'basic did not curse');
  assert.equal(a.bot.hasBuff(333112, a.now()), true);

  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.equal(p.e_count, 1);
  assert.ok(scenes(e).fires.some(f => f.templateId === 333201));
  a.tick(700);
  assert.equal(a.bot.hasBuff(333122, a.now()), true, 'curse did not advance');
  assert.ok(wellFormed(e));

  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.channel, 'channel did not open');
  assert.equal(p.hasBuff(333301, a.now()), true);
  const mpBefore = p.mp;
  a.tick(600);
  assert.ok(p.mp < mpBefore, 'channel did not pay MP');
  const hpBefore = a.bot.hp.toNumber();
  a.tick(1000);
  assert.ok(a.bot.hp.toNumber() < hpBefore, 'channel volley missed');
  assert.ok(wellFormed(space));

  const interrupted = p.interrupt(a.now());
  assert.equal(p.channel, null);
  assert.ok(p.cooldowns[2] > a.now());
  assert.ok(wellFormed(interrupted));

  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.ready, 'gaze did not arm');
  a.tick(500);
  assert.equal(p.ready, null);
  assert.equal(a.bot.hasBuff(333402, a.now()), true);
  assert.ok(wellFormed(r));
});

// ---------------------------------------------------------------------------
// Joker: box, soul tear and the shadow clone.

check('Joker detonates the box, tears souls and spawns a clone', () => {
  const a = makeArena(10000071);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof JokerActions);
  assert.equal(p.hasBuff(451101, a.now()), true);

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const hpBefore = a.bot.hp.toNumber();
  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.e_count, 2);
  a.tick(1100);
  assert.ok(a.bot.hp.toNumber() < hpBefore, 'box missed');
  assert.equal(a.bot.hasBuff(451204, a.now()), true);
  assert.ok(wellFormed(e));

  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  a.tick(700);
  assert.equal(a.bot.hasBuff(451302, a.now()), true, 'soul mark missing');
  assert.equal(p.marks.size, 1);
  a.tick(600);
  assert.equal(a.bot.hasBuff(345303, a.now()), true, 'tear buff missing');
  assert.ok(wellFormed(space));

  const acting = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.hasBuff(451403, a.now()), true);
  assert.equal(p.info.untargetable, true);
  const clone = [...a.arena.actors.values()].find(x => x.constructor.name === 'JokerClone');
  assert.ok(clone, 'clone missing');
  assert.equal(a.arena.actors.size, 3);
  const hpClone = a.bot.hp.toNumber();
  a.tick(2100);
  assert.ok(!clone.alive, 'clone did not expire');
  assert.ok(a.bot.hp.toNumber() <= hpClone);
  assert.ok(wellFormed(acting));
});

// ---------------------------------------------------------------------------
// Fox: wave decay, blink and foxfire.

check('Fox fans waves, blinks and starts foxfire', () => {
  const a = makeArena(10000086);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof FoxActions);
  assert.equal(p.hasBuff(360101, a.now()), true);

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.e_count, 2);
  assert.ok(scenes(e).fires.filter(f => f.templateId === 360401).length >= 3);
  a.tick(800);
  assert.equal(p.fire_count, 3, 'wave hits did not stack');
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const blinkStart = p.positionAt(a.now());
  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(p.space_count, 2);
  assert.ok(p.ready, 'blink did not arm');
  a.tick(100);
  assert.equal(p.ready, null);
  assert.notDeepEqual(p.positionAt(a.now()), blinkStart);
  assert.equal(a.bot.hasBuff(360302, a.now()), true);
  assert.ok(p.fire_count >= 4);
  assert.ok(wellFormed(space));

  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  a.tick(700);
  assert.equal(a.bot.hasBuff(360202, a.now()), true);
  assert.equal(a.bot.hasBuff(360203, a.now()), true);
  assert.ok(p.foxfire, 'foxfire did not start at five stacks');
  const hpBefore = a.bot.hp.toNumber();
  a.tick(500);
  assert.ok(a.bot.hp.toNumber() < hpBefore, 'foxfire missed');
  assert.ok(wellFormed(r));
});

// ---------------------------------------------------------------------------
// Falcon: precision, dash reload, marked explosions and radar.

check('Falcon reloads, marks explosions and scans', () => {
  const a = makeArena(10000104);
  const spawn = a.tick(0);
  const p = a.player;
  assert.ok(p instanceof FalconActions);
  assert.equal(p.mp, 100);
  assert.equal(p.hasBuff(379101, a.now()), true);
  assert.equal(p.hasBuff(379106, a.now()), true);
  assert.ok(has(spawn, 1579));

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  assert.equal(p.mp, 90);
  a.tick(700);
  assert.equal(p.precision_count, 1);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const [ex, ey] = p.positionAt(a.now());
  const e = p.cast(1, [ex, ey], [ex, ey + 300], 0, a.now());
  assert.ok(p.dash, 'dash did not start');
  a.tick(500);
  assert.equal(p.enhanced, 5);
  assert.equal(p.mp, 100);
  assert.equal(p.hasBuff(379203, a.now()), true);
  assert.ok(wellFormed(e));

  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  a.tick(700);
  assert.equal(p.marks.size, 1, 'explosive mark missing');
  assert.equal(a.bot.hasBuff(379302, a.now()), true);
  const hpBefore = a.bot.hp.toNumber();
  const empowered = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  a.tick(700);
  assert.ok(p.precision_count >= 2);
  assert.ok(p.marks.get(a.bot.id).index >= 1, 'mark did not advance');
  a.tick(500);
  assert.ok(a.bot.hp.toNumber() < hpBefore, 'marked explosion missed');
  assert.ok(wellFormed(space) && wellFormed(empowered));

  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.equal(a.bot.hasBuff(379411, a.now()), true);
  assert.equal(a.bot.hasBuff(379412, a.now()), true);
  a.tick(250);
  a.tick(5200);
  assert.ok(wellFormed(r));
});

// ---------------------------------------------------------------------------
// Wukong: sweep, dash, vanish slam and R empower.

check('Wukong sweeps, dashes, slams and empowers', () => {
  const a = makeArena(10000036);
  a.tick(0);
  const p = a.player;
  assert.ok(p instanceof WukongActions);
  assert.equal(p.hasBuff(310101, a.now()), true);

  const q = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), a.bot.id, a.now());
  a.tick(700);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));

  const e = p.cast(1, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.motion, 'dash motion missing');
  assert.equal(p.hasBuff(310211, a.now()), true);
  assert.equal(p.hasBuff(310111, a.now()), true);
  a.tick(500);
  assert.ok(a.bot.hp.lt(a.bot.maxHp));
  assert.ok(p.hasBuff(310204, a.now()));
  const reactive = p.on_skill_damage(a.bot, { potential_damage: D(5) }, a.now());
  assert.equal(p.hasBuff(310204, a.now()), false);
  assert.ok(p.shieldAmount(a.now()).gt(0), 'reactive shield missing');
  assert.ok(wellFormed(reactive));
  assert.ok(wellFormed(e));

  const hpSweep = a.bot.hp.toNumber();
  const sweep = p.cast(0, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.ready, 'empowered sweep did not arm');
  assert.ok(cooldownSkills(sweep).includes(310121));
  a.tick(20);
  assert.ok(a.bot.hp.toNumber() < hpSweep, 'empowered sweep missed');
  assert.equal(a.bot.hasBuff(310122, a.now()), true);
  assert.ok(wellFormed(sweep));

  const space = p.cast(2, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.vanish, 'vanish did not start');
  assert.equal(p.info.untargetable, true);
  const hpSlam = a.bot.hp.toNumber();
  a.tick(800);
  assert.equal(p.vanish, null);
  assert.ok(a.bot.hp.toNumber() < hpSlam, 'slam missed');
  assert.equal(a.bot.hasBuff(310312, a.now()), true);
  assert.ok(wellFormed(space));

  const r = p.cast(10, p.positionAt(a.now()), a.bot.positionAt(a.now()), 0, a.now());
  assert.ok(p.ready, 'R did not arm');
  a.tick(120);
  assert.equal(a.bot.hasBuff(310402, a.now()), true);
  assert.ok(wellFormed(r));
});

console.log(`batch-c tanks: ${checks} checks passed`);
