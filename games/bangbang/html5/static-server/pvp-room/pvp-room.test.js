/* Run: node games/bangbang/html5/static-server/pvp-room/pvp-room.test.js
 * Every reply is decoded with the real client codecs before it is asserted. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeRoomPacket, encodeHallRequest, encodeCreateRoom, encodeJoinRoom,
  encodeRoomOp, encodeStartMatch, encodeSelectTank, encodeConfirmTank } from '../../room_protocol.js';
import { decodeScenePacket, encodeLoadProgress, encodeBattleEnter,
  encodeExitBattle } from '../../scene_protocol.js';
import { decodeCombatPacket } from '../../combat_protocol.js';
import { decodeRoomsPacket, encodeRoomsRequest, ROOMS_REPLY }
  from '../../m81337_rooms_protocol.js';
import {
  PvpRoom, OFFLINE_PLAYER, BOT_ROOM, CAPTURED_OFFLINE_ROOM,
  PVP_MAP_IDS, defaultBots, botRoomName, s1700, s1705, s1724,
} from './pvp-room.js';

const msgIdOf = (frame) => frame[2] | (frame[3] << 8);
const payloadOf = (frame) => frame.subarray(8);
const only = (frames, id) => {
  assert.equal(frames.length, 1, `expected one S${id}, got ${frames.length}`);
  assert.equal(msgIdOf(frames[0]), id);
  return frames[0];
};
const exact = (packet, label) => {
  assert.equal(packet.trailingBytes, 0, `${label}: trailing bytes`);
  assert.equal(packet.consumed, packet.byteLength, `${label}: not fully consumed`);
  return packet;
};
const roomPacket = (frame) => exact(decodeRoomPacket(msgIdOf(frame), payloadOf(frame)),
  `S${msgIdOf(frame)}`);
const scenePacket = (frame) => exact(decodeScenePacket(msgIdOf(frame), payloadOf(frame)),
  `S${msgIdOf(frame)}`);
const combatPacket = (frame) => exact(decodeCombatPacket(msgIdOf(frame), payloadOf(frame)),
  `S${msgIdOf(frame)}`);
const byId = (frames) => frames.map(msgIdOf);

// --- catalog/config invariants ------------------------------------------------
assert.ok(PVP_MAP_IDS.includes(19), 'pk_robo map 19 is a PvP map');
assert.equal(PVP_MAP_IDS.length, 10, 'ten native PK maps');
assert.equal(BOT_ROOM.roomId, CAPTURED_OFFLINE_ROOM.roomId,
  'static bot room keeps the captured room id');
assert.equal(BOT_ROOM.creatorAccountId, CAPTURED_OFFLINE_ROOM.creatorAccountId);
assert.equal(BOT_ROOM.roomType, 2);
assert.equal(BOT_ROOM.mode, 3);
assert.equal(BOT_ROOM.mapId, 19);
assert.equal(botRoomName('pk_robo', 19), 'PK Robo - 25 điểm / 4 phút');
assert.equal(defaultBots().length, 9);
assert.deepEqual(defaultBots().map((bot) => bot.camp),
  [1, 1, 1, 1, 2, 2, 2, 2, 2]);

// --- hall (C607 -> S1724) -----------------------------------------------------
const game = new PvpRoom();
const hall = roomPacket(only(game.handle(encodeHallRequest()), 1724));
assert.equal(hall.type, 'hall');
assert.equal(hall.rooms.length, 1);
assert.equal(hall.scenes.length, 0);
assert.equal(hall.site, 0);
assert.equal(hall.roomType, 1);
const advertised = hall.rooms[0];
assert.equal(advertised.roomId, 1001);
assert.equal(advertised.playerCount, 1);
assert.equal(advertised.maxPlayers, 10);
assert.equal(advertised.mapId, 19);
assert.equal(advertised.mode, 3);
assert.equal(advertised.state, 0);
assert.equal(advertised.isValidate, 1);
assert.equal(advertised.roomType, 2);
assert.equal(advertised.name, 'PK Robo - 25 điểm / 4 phút');

// --- join bot room (C601 -> S1700) --------------------------------------------
const entered = roomPacket(only(game.handle(encodeJoinRoom(advertised)), 1700));
assert.equal(entered.type, 'roomEntered');
assert.equal(entered.roomId, 1001);
assert.equal(entered.creatorAccountId, OFFLINE_PLAYER.accountId);
assert.equal(entered.maxPlayers, 10);
assert.equal(entered.minPlayers, 2);
assert.equal(entered.observerCapacity, 0);
assert.equal(entered.password, 0);
assert.equal(entered.name, advertised.name);
assert.equal(entered.state, 0);
assert.equal(entered.roomType, 2);
assert.equal(entered.mode, 3);
assert.deepEqual(entered.config,
  { mapId: 19, banRobot: 0, tankAvailableLevel: 0, ladderMin: 0, ladderMax: 0 });
assert.equal(entered.characters.length, 10);
assert.equal(entered.observers.length, 0);
const self = entered.characters.find((c) => c.player.accountId === OFFLINE_PLAYER.accountId);
assert.ok(self, 'authenticated player is in the roster');
assert.equal(self.ready, 0, 'a joined player is not ready yet');
assert.equal(self.player.charUuid, OFFLINE_PLAYER.charUuid);
assert.equal(self.player.name, OFFLINE_PLAYER.name);
assert.equal(self.player.level, 36);
assert.equal(self.player.avatarId, 2801001);
assert.equal(self.player.elo, 1000);
assert.equal(self.other.tankId, 10000044);
assert.equal(self.other.tankLevel, 5);
assert.equal(self.other.externalId, 10673);
assert.equal(self.camp, 1);
assert.equal(self.regionUid, 299001);
assert.deepEqual(self.buffs, []);
assert.deepEqual(entered.characters.map((c) => c.camp), [1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
assert.ok(entered.characters.slice(1).every((c) => c.ready === 1 && c.player.accountId > 0));
assert.equal(game.snapshot().phase, 'room');

// --- ready (C602 -> S1701) ----------------------------------------------------
const ready = roomPacket(only(game.handle(encodeRoomOp(2)), 1701));
assert.equal(ready.type, 'roomOp');
assert.equal(ready.op, 2);
assert.equal(ready.startAccountId, OFFLINE_PLAYER.accountId);
assert.equal(ready.target, OFFLINE_PLAYER.accountId);

// --- start selection (C610 -> S1721) ------------------------------------------
const pre = roomPacket(only(game.handle(encodeStartMatch(2)), 1721));
assert.equal(pre.type, 'prebattle');
assert.equal(pre.sceneId, 1001);
assert.equal(pre.mapId, 19);
assert.equal(pre.roomType, 2);
assert.equal(pre.characters.length, 10);
assert.equal(pre.characters.find((c) => c.player.accountId === OFFLINE_PLAYER.accountId).player.name,
  OFFLINE_PLAYER.name);
assert.equal(pre.lockedAccountIds.length, 9, 'lobby bots are already locked');
assert.deepEqual(pre.lockedAccountIds, entered.characters.slice(1).map((c) => c.player.accountId));
assert.equal(pre.remainingSeconds, 60);
assert.equal(game.snapshot().phase, 'selecting');

// --- select tank (C215 -> S1711 + S1727) --------------------------------------
const TANK = 10000019;
const selectFrames = game.handle(encodeSelectTank(pre.sceneId, TANK, 0, pre.roomType));
assert.deepEqual(byId(selectFrames), [1711, 1727]);
const changed = roomPacket(selectFrames[0]);
assert.equal(changed.type, 'roomCharChanged');
assert.equal(changed.player.accountId, OFFLINE_PLAYER.accountId);
const selected = roomPacket(selectFrames[1]);
assert.equal(selected.type, 'tankSelected');
assert.equal(selected.accountId, OFFLINE_PLAYER.accountId);
assert.equal(selected.tankId, TANK);
assert.equal(selected.containerType, 0);

// A wrong scene or unowned container is ignored.
assert.deepEqual(game.handle(encodeSelectTank(999, TANK, 0, 2)), []);
assert.deepEqual(game.handle(encodeSelectTank(pre.sceneId, TANK, 1, 2)), []);

// --- confirm (C614 -> S1728 + S1705) ------------------------------------------
const confirmFrames = game.handle(encodeConfirmTank(pre.sceneId));
assert.deepEqual(byId(confirmFrames), [1728, 1705]);
const locked = roomPacket(confirmFrames[0]);
assert.equal(locked.type, 'tankLocked');
assert.equal(locked.accountId, OFFLINE_PLAYER.accountId);
assert.equal(locked.tankId, TANK);
const start = roomPacket(confirmFrames[1]);
assert.equal(start.type, 'battleStart');
assert.equal(start.sceneId, 1001);
assert.equal(start.mapId, 19);
assert.equal(start.roomType, 2);
assert.equal(start.characters.length, 10);
assert.equal(start.backData.length, 0);
assert.equal(start.enterType, 0);
const battleSelf = start.characters.find((c) => c.player.accountId === OFFLINE_PLAYER.accountId);
assert.equal(battleSelf.other.tankId, TANK);
assert.equal(game.snapshot().phase, 'loading');

// --- scene load (C605 -> S1709, C552 -> S1586/S1550/S1551/S1561) --------------
const loaded = roomPacket(only(
  game.handle(encodeLoadProgress(start.sceneId, OFFLINE_PLAYER.accountId, 12, 100)), 1709));
assert.equal(loaded.type, 'roomLoaded');
assert.equal(loaded.accountId, OFFLINE_PLAYER.accountId);
assert.equal(loaded.loaded, 100);

const entryFrames = game.handle(encodeBattleEnter(start.sceneId));
assert.deepEqual(byId(entryFrames), [1586, 1550, 1551, 1561]);
const enteredScene = scenePacket(entryFrames[0]);
assert.equal(enteredScene.type, 'sceneEntered');
const selfScene = scenePacket(entryFrames[1]);
assert.equal(selfScene.type, 'sceneSelf');
assert.equal(selfScene.actor.accountId, OFFLINE_PLAYER.accountId);
assert.equal(selfScene.actor.camp, 1);
assert.equal(selfScene.actor.hp, 1000);
const others = scenePacket(entryFrames[2]);
assert.equal(others.type, 'sceneOthers');
assert.equal(others.actors.length, 9);
assert.equal(others.actors.filter((a) => a.camp === 2).length, 5);
const stats = combatPacket(entryFrames[3]);
assert.equal(stats.type, 'sceneStats');
assert.equal(stats.actors.length, 0);
assert.equal(game.snapshot().phase, 'scene');

// --- exit (C509 -> S1707 + S1017) ---------------------------------------------
const exitFrames = game.handle(encodeExitBattle(start.sceneId));
assert.deepEqual(byId(exitFrames), [1707, 1017]);
const exited = roomPacket(exitFrames[0]);
assert.equal(exited.type, 'sceneExit');
assert.equal(exited.errorId, 0);
assert.equal(exited.sceneId, 1001);
assert.equal(exited.accountId, OFFLINE_PLAYER.accountId);
assert.equal(exited.exitType, 2);
assert.equal(exited.isObserver, 0);
assert.equal(roomPacket(exitFrames[1]).type, 'backToMain');
assert.equal(game.snapshot().phase, 'lobby');

// --- create path (C600 -> S1700, owner is ready) ------------------------------
const created = new PvpRoom();
const createFrame = roomPacket(only(created.handle(encodeCreateRoom({ name: 'Phòng PK HTML5' })), 1700));
assert.equal(createFrame.name, 'Phòng PK HTML5');
assert.equal(createFrame.config.mapId, 19);
assert.equal(createFrame.roomType, 2);
assert.equal(createFrame.characters.find((c) => c.player.accountId === OFFLINE_PLAYER.accountId).ready, 1);
const createdPre = roomPacket(only(created.handle(encodeStartMatch(2)), 1721));
assert.equal(createdPre.sceneId, 1001);
assert.equal(createdPre.characters.length, 10);

// --- rooms-v1 status (C60006 -> S60007) ---------------------------------------
const v1Frames = created.handle(encodeRoomsRequest('status', 'req-1'));
assert.equal(v1Frames.length, 1);
const v1 = decodeRoomsPacket({ msgId: msgIdOf(v1Frames[0]), payload: payloadOf(v1Frames[0]) });
assert.ok(v1);
assert.equal(v1.type, 'multiplayerRooms');
assert.equal(v1.rooms.v, 1);
assert.equal(v1.rooms.ok, true);
assert.equal(v1.rooms.action, 'status');
assert.equal(v1.rooms.request_id, 'req-1');
assert.equal(v1.rooms.room, null);
assert.deepEqual(v1.rooms.queue, { active: false, status: 'idle', wait_remaining_ms: 0 });
assert.equal(msgIdOf(v1Frames[0]), ROOMS_REPLY);

// --- malformed frames fail at the trust boundary ------------------------------
assert.throws(() => game.handle(new Uint8Array([1, 2])), RangeError);
const bad = new Uint8Array(8);
new DataView(bad.buffer).setUint16(0, 999, true);
assert.throws(() => game.handle(bad), RangeError);

// A reusable builder still validates against the real decoder.
const standalone = decodeRoomPacket(1724, payloadOf(s1724({ rooms: [advertised] })));
exact(standalone, 'standalone S1724');
assert.equal(standalone.rooms[0].roomId, 1001);

// --- builders reproduce the captured offline S1700/S1705 byte-for-byte -------
const captures = JSON.parse(readFileSync(new URL('../frames.json', import.meta.url), 'utf8'));
const captured = (key) => Uint8Array.from(Buffer.from(captures[key], 'base64'));
const capturedSelf = {
  ...OFFLINE_PLAYER, regionUid: 299001, ip: 0, camp: 1, buffs: [], ready: 1, battle: 0,
  tryTank: 0, btItemId: 0, btRank: 0, btLevel: 0, btUpLevel: 0, btUpCost: 0,
  btRankCost: 0, btAttack: 0, tankPartScore: 0, sprayId: 0,
};
assert.deepEqual(
  Buffer.from(s1700(CAPTURED_OFFLINE_ROOM, [capturedSelf])),
  Buffer.from(captured('room1700')),
  'S1700 matches the captured offline room');
assert.deepEqual(
  Buffer.from(s1705({
    sceneId: 1001, mapId: 201, roomType: 4, characters: [capturedSelf],
    backData: [], enterType: 0,
  })),
  Buffer.from(captured('battle1705')),
  'S1705 matches the captured offline battle start');

console.log('pvp-room: all assertions passed');
