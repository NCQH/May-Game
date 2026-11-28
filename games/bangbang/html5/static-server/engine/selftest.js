/* Runnable self-check: node static-server/engine/selftest.js
 *
 * No test framework. Exercises Decimal/geometry, the arena tick, movement,
 * damage, buff add/remove/expiry, cooldowns, and every new writer against the
 * existing browser decoders in html5/*.js.
 */
import assert from 'node:assert/strict';
import {
  D, quantize, damageAmount, applyDamage, heal, pyRound, rectContact, circleContact,
} from './math.js';
import { BattleData, table_row, tank_stats } from './data.js';
import { BattleArena, TankActions, BattleMap, scenePacket } from './arena.js';
import {
  props, tankInfo, objectInfo, moveEvent, fireEvent, skillEvent, scene, stopMove,
  encodeS1550, encodeS1551, encodeS1552, encodeS1553, encodeS1554, encodeS1556,
  encodeS1558, encodeS1559, encodeS1560, encodeS1561, encodeS1562, encodeS1564,
  encodeS1566, encodeS1572, encodeS1579, encodeS1707, encodeS1708, encodeS1104,
} from './protocol.js';
import { decodeScenePacket } from '../../scene_protocol.js';
import { decodeCombatPacket } from '../../combat_protocol.js';
import { decodeRoomPacket } from '../../room_protocol.js';
import { decodeCrystalPacket } from '../../m8_crystal_protocol.js';
import { stop_move } from './protocol.js';

let checks = 0;
function check(name, fn) {
  try { fn(); checks += 1; }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}
function payloadOf(packet) { return packet[1] instanceof Uint8Array ? packet[1] : new Uint8Array(packet[1]); }
function find(packets, msgId) { return packets.find(p => p[0] === msgId); }
function syntheticData() {
  return new BattleData({
    garage: {
      levels: {
        '10000001:1': {
          tankId: 10000001, level: 1, externalId: 1,
          stats: { iHp: 1000, iAttack: 100, iEgAtk: 100, iArmor: 100, iEgArmor: 100,
            iCentesis: 0, iEgCtsis: 0, iFireInterv: 1000, iSpeed: 200, iMp: 100, nFireRange: 600 },
        },
      },
      strengthening: {},
    },
    assets: {
      tanks: {
        10000001: { tankId: 10000001, name: 'Test Tank', base: {
          nBullet: 1000114, nSkill1: 363201, nSkill2: 363301, nSkill3: 363101, nSkill4: 363401,
        } },
      },
      skills: {
        1000114: { nId: 1000114, iLifeTime: 1000, iFlyRange: 600, iRange: 600, iCoolTime: 1000, iStackCount: -1 },
        363201: { nId: 363201, iLifeTime: 800, iFlyRange: 500, iRange: 500, iCoolTime: 5000, iStackCount: 1 },
        363301: { nId: 363301, iLifeTime: 800, iFlyRange: 500, iRange: 500, iCoolTime: 5000, iStackCount: 1 },
        363101: { nId: 363101, iLifeTime: 800, iFlyRange: 500, iRange: 500, iCoolTime: 5000, iStackCount: 1 },
        363401: { nId: 363401, iLifeTime: 800, iFlyRange: 500, iRange: 500, iCoolTime: 5000, iStackCount: 3 },
      },
      buffs: {
        9001: { nBuffId: 9001, nEffectType: 201, nTypeParam: 11, fEffectValA: '0.5',
          iPersistTime: 2000, iStackCount: 3, iAspect: '0' },
        50353: { nBuffId: 50353, nEffectType: 45, fEffectValA: '3',
          iPersistTime: -1, iStackCount: 1, iAspect: '0' },
      },
      exhibits: {}, aiNPCs: {}, aiArms: {}, mapNPCs: {}, maps: {},
    },
  });
}

const state = {
  battle: { scene_id: 1234 },
  room: { map_id: 101, camp: 1 },
  char_id: 555, name: 'Tester', tank_id: 10000001, tank_level: 1,
  bot: { acct_id: 556, name: 'Bot', tank_id: 10000001, tank_level: 1, human: false, in_room: true },
};

// ---------------------------------------------------------------------------
// Math

check('decimal quantize half-up away from zero', () => {
  assert.equal(quantize('1.2345').toString(), '1.235');
  assert.equal(quantize('-1.2345').toString(), '-1.235');
  assert.equal(quantize('2.0004').toString(), '2');
  assert.equal(D('0.1').add(D('0.2')).toString(), '0.3');
  assert.equal(D('1').div(D('3')).toFixed(6), '0.333333');
});

check('python round ties to even', () => {
  assert.equal(D('2.5').ceil(), 3);
  assert.equal(D('-2.5').ceil(), -2);
  assert.equal(D('2.5').floor(), 2);
  assert.equal(D('-2.5').floor(), -3);
  assert.equal(pyRound(2.5), 2);
  assert.equal(pyRound(3.5), 4);
  assert.equal(pyRound(-2.5), -2);
  assert.equal(pyRound(-3.5), -4);
  assert.equal(pyRound(2.6), 3);
});

check('damage amount armor formula', () => {
  assert.equal(damageAmount('100', { school: 'physical', armor: 100 }).toFixed(3), '75.000');
  assert.equal(damageAmount('100', { school: 'energy', armor: 0 }).toFixed(3), '100.000');
  assert.equal(damageAmount('100', { school: 'true', armor: 999 }).toFixed(3), '100.000');
  assert.equal(damageAmount('100', { school: 'physical', armor: 100, reductions: ['.5'] }).toFixed(3), '37.500');
});

check('shield absorb order and break facts', () => {
  const hit = applyDamage(150, 100, [
    { shield_id: 'all', remaining: 30, school: 'all', expires_ms: 10 },
    { shield_id: 'phys', remaining: 50, school: 'physical', expires_ms: 5 },
  ], { school: 'physical', nowMs: 0 });
  assert.equal(hit.shield_absorbed.toString(), '80');
  assert.equal(hit.hp_loss.toString(), '70');
  assert.equal(hit.hp_after.toString(), '30');
  assert.deepEqual(hit.broken_shield_ids.sort(), ['all', 'phys']);
});

check('heal caps at max hp', () => {
  const result = heal(50, 90, 100);
  assert.equal(result.effective_heal.toString(), '10');
  assert.equal(result.overheal.toString(), '40');
});

check('geometry contact', () => {
  assert.equal(rectContact([0, 0], [100, 0], [[50, -10, 60, 10]]), 0.5);
  assert.equal(circleContact([0, 0], [100, 0], [50, 0], [50, 0], 10), 0.4);
  assert.equal(rectContact([0, 0], [10, 0], [[50, 50, 60, 60]]), null);
});

// ---------------------------------------------------------------------------
// Arena: movement, damage, buffs, cooldowns

const data = syntheticData();
const START = 100000;
let now = START;
const clock = () => now;
const arena = new BattleArena(state, { clock, data });
const player = arena.player;
const bot = arena.bot;

check('spawn wiring', () => {
  assert.deepEqual(player.position, [444, 612]);
  assert.deepEqual(bot.position, [780, 804]);
  assert.equal(player.camp, 1);
  assert.equal(bot.camp, 2);
  arena.tick(now);
  assert.equal(player.hp.toString(), '1000');
});

check('C501 movement sets a tween and lands on the 24px step', () => {
  const start = player.positionAt(now);
  const payload = new Uint8Array(9);
  const view = new DataView(payload.buffer);
  view.setUint16(0, start[0], true); view.setUint16(2, start[1], true);
  view.setUint8(4, 3); view.setUint32(5, arena.sceneId, true);
  const packets = player.handle(501, payload);
  assert.ok(player.motion, 'movement tween was not created');
  assert.deepEqual(player.position, [start[0] + 24, start[1]]);
  assert.ok(packets.every(p => Array.isArray(p) && p.length === 2));
  now += player.motion[3] - now;
  assert.deepEqual(player.positionAt(now), [start[0] + 24, start[1]]);
});

check('damage applies armor and emits S1564 HP', () => {
  const [packets, dealt] = player.damage('100', now, { target: bot, school: 'physical', basic: true });
  assert.equal(dealt, true, 'damage returned no HP loss');
  assert.equal(bot.hp.toFixed(3), '925.000');
  const hpPacket = find(packets, 1564);
  assert.ok(hpPacket, 'missing S1564');
  const decoded = decodeScenePacket(1564, payloadOf(hpPacket));
  assert.equal(decoded.hp[0].objectId, bot.id);
  assert.equal(decoded.hp[0].hp, 925);
});

check('buff add, live state, remove and expiry', () => {
  let packets = player._buff(9001, now);
  const add = find(packets, 1558);
  assert.ok(add, 'missing S1558');
  const decoded = decodeCombatPacket(1558, payloadOf(add));
  assert.equal(decoded.buff.templateId, 9001);
  assert.equal(decoded.durationMs, 2000);
  assert.equal(player.hasBuff(9001, now), true);
  assert.ok(player.buffTypes(now).has(201));

  packets = player.removeBuff(9001, now);
  assert.equal(player.hasBuff(9001, now), false);
  assert.ok(find(packets, 1559), 'missing S1559');

  player._buff(9001, now);
  assert.equal(player.hasBuff(9001, now), true);
  const due = now + 2000;
  arena.tick(due);
  assert.equal(player.hasBuff(9001, due), false, 'expiry event did not remove the buff');
  now = due;
});

check('cooldown writer and baseline cast', () => {
  const dest = [bot.positionAt(now)[0], bot.positionAt(now)[1]];
  const packets = player.cast(0, player.positionAt(now), dest, bot.id, now);
  assert.ok(player.cooldowns[0] > now, 'cooldown was not set');
  const fire = find(packets, 1564);
  assert.ok(fire, 'missing fire S1564');
  const decoded = decodeScenePacket(1564, payloadOf(fire));
  assert.equal(decoded.fires.length, 1);
  assert.equal(decoded.fires[0].objectId, player.id);
  assert.equal(decoded.fires[0].templateId, 1000114);

  const cooldown = find(packets, 1572);
  assert.ok(cooldown, 'missing S1572');
  const cd = decodeCombatPacket(1572, payloadOf(cooldown));
  assert.equal(cd.ownerId, player.id);
  assert.equal(cd.skill.skillId, 1000114);
  assert.equal(cd.skill.slot, 0);
});

check('S1553 respawn notification on death', () => {
  const [packets, dealt] = player.damage('99999', now, { target: bot, school: 'true', basic: false });
  assert.equal(dealt, true);
  assert.equal(bot.alive, false);
  assert.equal(bot.hp.isZero(), true);
  const relive = find(packets, 1553);
  assert.ok(relive, 'missing S1553');
  assert.equal(decodeCombatPacket(1553, payloadOf(relive)).remainingMs, 2000);
});

// ---------------------------------------------------------------------------
// S1564 round-trip through the real client decoder

check('S1564 all ten vectors round-trip', () => {
  const payload = encodeS1564({
    moves: [{ position: [1, 2], speed: 100, kind: 0, owner: 7, direction: 3 }],
    fires: [{ bulletId: 11, ownerId: 7, start: [1, 2], dest: [3, 4], speed: 600, templateId: 1000114 }],
    skills: [{ skillId: 1000114, start: [5, 6], dest: [7, 8], targetId: 8, ownerId: 7, ready: 1 }],
    hp: [{ objectId: 7, hp: 123 }],
    npcDeaths: [{ npcId: 9, x: 10, y: 11 }],
    mp: [{ objectId: 7, mp: 50 }],
    blownBullets: [21], removedObjects: [22], expiredBullets: [23],
    shields: [{ objectId: 7, shield: 44 }],
  });
  const decoded = decodeScenePacket(1564, payload);
  assert.equal(decoded.msgId, 1564);
  assert.equal(decoded.moves[0].objectId, 7);
  assert.equal(decoded.moves[0].direction, 3);
  assert.equal(decoded.fires[0].templateId, 1000114);
  assert.deepEqual([decoded.skills[0].x, decoded.skills[0].y], [7, 8]);
  assert.equal(decoded.hp[0].hp, 123);
  assert.equal(decoded.npcDeaths[0].npcId, 9);
  assert.equal(decoded.mp[0].mp, 50);
  assert.deepEqual(decoded.blownBullets, [21]);
  assert.deepEqual(decoded.removedObjects, [22]);
  assert.deepEqual(decoded.expiredBullets, [23]);
  assert.equal(decoded.shields[0].shield, 44);
  assert.equal(decoded.tail.length, 0);
});

// ---------------------------------------------------------------------------
// Every writer against the client decoder

const tank = {
  objectId: 7, accountId: 555, x: 10, y: 20, hp: 900, maxHp: 1000, camp: 1,
  name: 'Tester', buffs: [{ templateId: 9001, instanceId: 40, stackCount: 2, casterId: 7 }],
  battleLevel: 2, battleExp: 5, tankLevel: 1, mp: 100, maxMp: 100, shield: 0,
};

check('S1550 round-trip', () => {
  const payload = encodeS1550({ tank, fireInterval: 1000, speed: 200, kills: 1, deaths: 2, assists: 3,
    skills: [{ skillId: 1000114, slot: 0, count: -1, end: 123456, nextCharge: 0 }] });
  const decoded = decodeScenePacket(1550, payload);
  assert.equal(decoded.actor.objectId, 7);
  assert.equal(decoded.fireRate, 1000);
  assert.equal(decoded.speed, 200);
  assert.equal(decoded.skills[0].skillId, 1000114);
  assert.equal(decoded.skills[0].endTime, '123456');
  assert.deepEqual([decoded.kills, decoded.deaths, decoded.assists], [1, 2, 3]);
});

check('S1551/S1552/S1554 round-trip', () => {
  assert.equal(decodeScenePacket(1551, encodeS1551([tank])).actors[0].accountId, 555);
  assert.equal(decodeScenePacket(1552, encodeS1552(tank)).actor.objectId, 7);
  const stop = decodeScenePacket(1554, encodeS1554(1234, 7, [11, 12]));
  assert.deepEqual([stop.sceneId, stop.objectId, stop.x, stop.y], [1234, 7, 11, 12]);
});

check('S1553/S1560 round-trip', () => {
  assert.equal(decodeCombatPacket(1553, encodeS1553(555, 5000)).remainingMs, 5000);
  const attr = decodeCombatPacket(1560, encodeS1560(555, 4, 750));
  assert.deepEqual([attr.accountId, attr.attrType, attr.value], [555, 4, 750]);
});

check('S1556 object add round-trip', () => {
  const payload = encodeS1556(1234, { objectId: 260, templateId: 20007, x: 1, y: 2, hp: 30,
    camp: 1, maxHp: 30, ownerId: 7, shield: 0, buffs: [] });
  const decoded = decodeCombatPacket(1556, payload);
  assert.equal(decoded.sceneId, 1234);
  assert.equal(decoded.object.objectId, 260);
  assert.equal(decoded.object.ownerId, 7);
});

check('S1558/S1559/S1581 round-trip', () => {
  const add = decodeCombatPacket(1558, encodeS1558(7,
    { templateId: 9001, instanceId: 40, stackCount: 2, casterId: 7 }, 2000));
  assert.equal(add.durationMs, 2000);
  assert.equal(add.buff.stackCount, 2);
  const remove = decodeCombatPacket(1559, encodeS1559(7, 40));
  assert.equal(remove.instanceId, 40);
});

check('S1561/S1562 round-trip', () => {
  const stats = Array.from({ length: 21 }, (_, i) => i);
  const decoded = decodeCombatPacket(1561, encodeS1561([{ accountId: 555, stats, tankLevel: 4 }]));
  assert.equal(decoded.actors[0].accountId, 555);
  assert.equal(decoded.actors[0].stats.length, 21);
  assert.equal(decoded.actors[0].battleLevel, 4);
  const orbit = decodeCombatPacket(1562, encodeS1562(11, [1, 2], [3, 4]));
  assert.deepEqual([orbit.bulletId, orbit.startX, orbit.destY], [11, 1, 4]);
});

check('S1564 writer round-trip', () => {
  const decoded = decodeScenePacket(1564, encodeS1564({ moves: [
    { position: [1, 2], speed: 100, kind: 5, owner: 7 },
  ] }));
  assert.equal(decoded.moves[0].moveType, 5);
});

check('S1566 kill round-trip', () => {
  const decoded = decodeCombatPacket(1566, encodeS1566({
    killerId: 7, victimId: 8, skillId: 1000114, x: 10, y: 20,
    multiCount: 2, killerStreak: 3, victimStreak: 1, firstBlood: 1, assists: [9, 10],
  }));
  assert.equal(decoded.killerId, 7);
  assert.deepEqual(decoded.assists, [9, 10]);
  assert.equal(decoded.firstBlood, 1);
});

check('S1572/S1579 round-trip', () => {
  const info = { skillId: 1000114, slot: 0, count: -1, end: 5000, nextCharge: 0 };
  const cd = decodeCombatPacket(1572, encodeS1572(7, info));
  assert.equal(cd.ownerId, 7);
  assert.equal(cd.skill.endTime, '5000');
  const changed = decodeCombatPacket(1579, encodeS1579(info));
  assert.equal(changed.skill.skillId, 1000114);
  assert.equal(changed.trailingBytes, 0);
});

check('S1707 round-trip', () => {
  const decoded = decodeRoomPacket(1707, encodeS1707({ sceneId: 1234, accountId: 555, exitType: 2 }));
  assert.equal(decoded.type, 'sceneExit');
  assert.deepEqual([decoded.sceneId, decoded.accountId, decoded.exitType], [1234, 555, 2]);
});

check('S1708 settlement round-trip', () => {
  const actor = {
    accountId: 555, tankId: 10000001, stats: Array.from({ length: 21 }, (_, i) => i),
    teamMerit: 8, oldElo: 1000, newElo: 1010, tankGains: 5, newTankGains: 20,
    award: 1, isWin: 1, robotType: 0, eloSection: 2, battleLevel: 3, roomCount: 2, camp: 1,
    exp: [{ type: 1, value: 10 }], coins: [], tankExp: [],
    items: [{ templateId: 4001, count: 2, bind: 1, lifetime: 0 }],
    pve: { total: 1, harm: 2, dead: 3, time: 4, booster: 5 },
  };
  const payload = encodeS1708({ sceneId: 1234, mapId: 101, battleTime: 60, winCamp: 1,
    actors: [actor], serverExpRate: 1.5, sceneUuid: 'local-pk-1234' });
  const decoded = decodeCombatPacket(1708, payload);
  assert.equal(decoded.type, 'battleEnd');
  assert.equal(decoded.actors[0].accountId, 555);
  assert.equal(decoded.actors[0].stats.length, 21);
  assert.equal(decoded.actors[0].items[0].templateId, 4001);
  assert.equal(decoded.actors[0].pve.booster, 5);
  assert.equal(decoded.sceneUuid, 'local-pk-1234');
  assert.equal(decoded.trailingBytes, 0);
});

check('S1104 award round-trip', () => {
  const payload = encodeS1104({ kind: 19, award: {
    cash: 1, gift: 2, golden: 3, glory: 4,
    groups: [{ type: 5, items: [{ itemId: 4001, count: 2 }] }],
    tankIds: [10000001], exp: 7, fizz: 8,
  }, isShow: 1, extra: 0 });
  const decoded = decodeCrystalPacket({ msgId: 1104, payload });
  assert.equal(decoded.type, 'settleAward');
  assert.equal(decoded.kind, 19);
  assert.equal(decoded.award.groups[0].items[0].itemId, 4001);
  assert.deepEqual(decoded.award.tankIds, [10000001]);
  assert.equal(decoded.tail.length, 0);
});

// ---------------------------------------------------------------------------
// Map geometry and data adapter

check('map 101 walls and spawns', () => {
  const map = new BattleMap(data.mapDefinition(101));
  assert.deepEqual(map.spawn(1), [444, 612]);
  assert.deepEqual(map.clampTankPosition([0, 0]), [252, 108]);
  assert.equal(map.canWalkTo([444, 612]), true);
  assert.equal(map.canWalkTo([0, 0]), false);
  assert.ok(map.wallContact([600, 612], [600, 300]) !== null, 'inner wall not seen');
});

check('table_row adapter stringifies and indexes', () => {
  assert.equal(data.tableRow('TankUpTemplate_table.xml', { nTankId: 10000001, nLevel: 1 }).iHp, '1000');
  assert.equal(data.tableRow('SkillTemplate_table.xml', { nId: 1000114 }).iFlyRange, '600');
  assert.equal(data.tableRow('BuffTemplate_table.xml', { nBuffId: 9001 }).nEffectType, '201');
  assert.equal(data.tankStats(10000001, 1).iSpeed, '200');
  assert.throws(() => data.tableRow('BuffTemplate_table.xml', { nBuffId: 123 }), /Missing battle template/);
});

check('on_spawn flags and neutral hooks', () => {
  assert.equal(player.onSpawn(now).length, 0);
  assert.equal(TankActions.defenseBuff, undefined);
  assert.equal(player.defenseBuff(9001), false);
});

check('actor self snapshot uses the real skill/tank tables', () => {
  const packets = player.selfSnapshotPackets();
  const decoded = decodeScenePacket(1550, payloadOf(packets[0]));
  assert.equal(decoded.actor.objectId, player.id);
  assert.equal(decoded.actor.accountId, 555);
  assert.equal(decoded.skills[0].skillId, 1000114);
  assert.equal(decoded.speed, 200);
});

check('snake_case subclass overrides are dispatched by the engine', () => {
  class PortedTank extends TankActions {
    attr_bonus(attributes, when) { return super.attr_bonus(attributes, when).add(D('0.5')); }
    commit_hp(hp, when, options) { this.commitCalls = (this.commitCalls || 0) + 1; return super.commit_hp(hp, when, options); }
    on_damage() { this.damageCalls = (this.damageCalls || 0) + 1; return []; }
    on_spawn() { this.spawnCalls = (this.spawnCalls || 0) + 1; return []; }
  }
  const sub = new PortedTank(arena, 9, { acct_id: 999, name: 'Ported', tank_id: 10000001,
    tank_level: 1, human: false, in_room: true }, 1, [500, 612]);
  assert.equal(sub.attrBonus([4], now).toString(), '0.5');
  sub.onSpawn(now);
  assert.equal(sub.spawnCalls, 1);
  player.damage('10', now, { target: sub, school: 'physical', basic: true });
  assert.equal(sub.damageCalls, 1);
  assert.equal(sub.commitCalls, 1);
});

check('python packet tuple helpers', () => {
  const packet = scene({ hp: [{ objectId: 1, hp: 2 }] });
  assert.equal(packet[0], 1564);
  assert.ok(packet[1] instanceof Uint8Array);
  assert.equal(decodeScenePacket(1564, packet[1]).hp[0].hp, 2);
  const stop = stop_move(1234, 1, [3, 4]);
  assert.equal(stop[0], 1554);
  assert.deepEqual([decodeScenePacket(1554, stop[1]).x, decodeScenePacket(1554, stop[1]).y], [3, 4]);
});

check('python snake_case aliases', () => {
  assert.equal(player.position_at(now)[0], player.positionAt(now)[0]);
  assert.equal(player.max_hp.toString(), player.maxHp.toString());
  assert.equal(player.scene_id, player.sceneId);
  assert.equal(typeof player.has_buff, 'function');
  assert.equal(typeof player.add_object, 'function');
  assert.equal(arena.scene_id, arena.sceneId);
  assert.equal(typeof arena.new_id, 'function');
  assert.equal(data.table_row('BuffTemplate_table.xml', { nBuffId: 9001 }).nBuffId, '9001');
  assert.equal(data.tank_stats(10000001, 1).iHp, '1000');
  assert.equal(table_row('BuffTemplate_table.xml', { nBuffId: 9001 }).nEffectType, '201');
  assert.equal(tank_stats(10000001, 1).iSpeed, '200');
  assert.equal(arena.geometry.can_walk_to([444, 612]), true);
});

console.log(`engine selftest: ${checks} checks passed`);
