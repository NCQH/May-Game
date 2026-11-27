/* M3 room/prebattle wire schemas from the current Python server and native AS3.
 * This module describes transport only. It neither selects bots nor changes
 * Garage ownership, the primary tank, match rules, timers, combat, or AI.
 * Source references and full field order: ../../protocol_m3_rooms.json.
 */
import { Reader, Writer } from './protocol.js';
import { encodeFrame } from './sixcube.js';

function frame(msgId, writer) { return encodeFrame(msgId, writer.finish()); }

export const ROOM_OP = Object.freeze({ leave: 1, ready: 2, cancelReady: 3, enterScene: 24 });

export function encodeHallRequest(roomType = 1, site = 0) {
  return frame(607, new Writer().u8(roomType).i32(site));
}

export function encodeCreateRoom({ roomType = 1, mode = 1, mapId = 101, password = 0,
  name = '', itemId = 0 } = {}) {
  // Current Python applies the saved web bot setup after reading this request.
  // Keep itemId even though the current handler ignores that native field.
  return frame(600, new Writer().u8(roomType).u8(mode).u32(mapId).u32(password).string(name).u32(itemId));
}

export function encodeJoinRoom({ roomId, roomType = 1, mode = 1, mapId = 101,
  password = 0, contestId = 0 }) {
  return frame(601, new Writer().u32(roomId).u8(roomType).u8(mode).u32(mapId).u32(password).u32(contestId));
}

export function encodeRoomOp(op, target = 0) {
  return frame(602, new Writer().u8(op).u32(target));
}

export function encodeStartMatch(roomType = 1) {
  return frame(610, new Writer().u8(roomType));
}

export function encodeSelectTank(sceneId, tankId, containerType = 0, roomType = 2) {
  // C215 changes match_tank_uuid. C200 would change the Garage primary tank.
  // Callers must pass the roomType received in S1721, not a hall placeholder.
  return frame(215, new Writer().u32(sceneId).u32(tankId).u32(containerType).u8(roomType));
}

export function encodeConfirmTank(sceneId) {
  return frame(614, new Writer().u32(sceneId));
}

export function encodeCancelMatch() { return encodeFrame(611); }

const PLAYER_BRIEF = [
  ['accountId', 'u32'], ['charUuid', 'string'], ['name', 'string'], ['level', 'u8'],
  ['sex', 'u8'], ['vipLevel', 'u8'], ['eloSection', 'u8'], ['preEloSection', 'u8'],
  ['avatarId', 'u32'], ['decorateId', 'u32'], ['graduate', 'u16'], ['elo', 'i16'],
  ['honorId', 'u32'], ['boosterAttack', 'u32'], ['militaryStar', 'u32'],
  ['teamPlace', 'u32'], ['teamName', 'string'],
];

const OTHER_BRIEF = [
  ['tankId', 'u32'], ['tankLevel', 'u8'], ['tryTank', 'u8'], ['btItemId', 'u32'],
  ['btRank', 'u8'], ['btLevel', 'u8'], ['btUpLevel', 'u8'], ['btUpCost', 'u32'],
  ['btRankCost', 'u32'], ['honorId', 'u32'], ['externalId', 'u32'], ['haloId', 'u32'],
  ['skinFrameType', 'u8'], ['btAttack', 'u32'], ['tankPartScore', 'u32'],
  ['commandSkill', 'u32'], ['sprayId', 'u32'],
];

/** PLAYER_BRIEF is at least 43 bytes, including three empty UTF-8 strings. */
export function readPlayerBrief(reader) { return reader.fields(PLAYER_BRIEF); }

/** OTHER_BRIEF is exactly 50 bytes. externalId begins at offset 25. */
export function readOtherBrief(reader) { return reader.fields(OTHER_BRIEF); }

/** CHAR_BRIEF is at least 104 bytes; the buff vector holds u32 IDs. */
export function readCharBrief(reader) {
  return { player: readPlayerBrief(reader), other: readOtherBrief(reader),
    regionUid: reader.u32(), ip: reader.u32(), camp: reader.u8(),
    buffs: reader.vector(4, (r) => r.u32()) };
}

function readRoomCharBrief(reader) {
  const ready = reader.u8(), battle = reader.u8();
  return { ready, battle, ...readCharBrief(reader) };
}

function readRoomConfig(reader) {
  return { mapId: reader.u32(), banRobot: reader.u8(), tankAvailableLevel: reader.u8(),
    ladderMin: reader.u8(), ladderMax: reader.u8() };
}

function readRoomInfo(reader) {
  return { roomId: reader.u32(), playerCount: reader.u32(), maxPlayers: reader.u32(),
    mapId: reader.u32(), mode: reader.u32(), state: reader.u8(), isValidate: reader.u8(),
    roomType: reader.u8(), name: reader.string(), teamId: reader.u32() };
}

function readSceneInfo(reader) {
  return { sceneId: reader.u32(), playerCount: reader.u32(), maxPlayers: reader.u32(),
    mapId: reader.u32(), inBattle: reader.u8(), roomType: reader.u8(),
    isObserverFull: reader.u8(), startTime: reader.u32(), name: reader.string() };
}

const HANDLED = new Set([1017, 1700, 1701, 1704, 1705, 1707, 1709, 1711, 1721, 1724, 1727, 1728]);

/** Decode only a verified room schema, or return null to let another module try.
 * Native captured login S1724 may contain both rooms and scenes and a trailer;
 * it is not evidence of a fresh C607 response. The session layer owns freshness.
 * Trailing bytes are retained exactly, matching the M2 decoder contract.
 */
export function decodeRoomPacket(msgId, payload) {
  if (!Number.isInteger(msgId) || msgId < 0 || msgId > 65535) throw new RangeError('Invalid message ID');
  if (!HANDLED.has(msgId)) return null;
  const r = new Reader(payload, msgId);
  const byteLength = r.bytes.length;
  let result;
  switch (msgId) {
    case 1017:
      result = { type: 'backToMain' };
      break;
    case 1700:
      result = { type: 'roomEntered', roomId: r.u32(), creatorAccountId: r.u32(),
        maxPlayers: r.u8(), minPlayers: r.u8(), observerCapacity: r.u8(), password: r.u32(),
        name: r.string(), state: r.u8(), roomType: r.u8(), mode: r.u32(), config: readRoomConfig(r),
        characters: r.vector(106, readRoomCharBrief), observers: r.vector(106, readRoomCharBrief) };
      break;
    case 1701:
      result = { type: 'roomOp', op: r.u8(), startAccountId: r.u32(), target: r.u32() };
      break;
    case 1704:
      result = { type: 'roomMap', mapId: r.u32() };
      break;
    case 1705:
      result = { type: 'battleStart', sceneId: r.u32(), mapId: r.u32(), roomType: r.u8(),
        characters: r.vector(104, readCharBrief), backData: r.vector(4, (p) => p.u32()), enterType: r.u8() };
      break;
    case 1707:
      result = { type: 'sceneExit', errorId: r.u32(), sceneId: r.u32(), accountId: r.u32(),
        exitType: r.u32(), isObserver: r.u32() };
      break;
    case 1709:
      // Native AS3 calls this field m_nTankId; current Python sends accountId.
      result = { type: 'roomLoaded', accountId: r.u32(), delay: r.u32(), loaded: r.u32() };
      break;
    case 1711:
      result = { type: 'roomCharChanged', player: readPlayerBrief(r), other: readOtherBrief(r) };
      break;
    case 1721:
      result = { type: 'prebattle', sceneId: r.u32(), mapId: r.u32(), roomType: r.u8(),
        characters: r.vector(104, readCharBrief), lockedAccountIds: r.vector(4, (p) => p.u32()),
        remainingSeconds: r.u32() };
      break;
    case 1724:
      result = { type: 'hall', rooms: r.vector(29, readRoomInfo), scenes: r.vector(25, readSceneInfo),
        site: r.i32(), roomType: r.u8() };
      break;
    case 1727:
      result = { type: 'tankSelected', accountId: r.u32(), tankId: r.u32(), containerType: r.u32(),
        externalId: r.u32(), skinFrameType: r.u32(), commandSkill: r.u32() };
      break;
    case 1728:
      result = { type: 'tankLocked', accountId: r.u32(), tankId: r.u32(), containerType: r.u32() };
      break;
  }
  const consumed = r.offset, tail = r.rest();
  return { msgId, ...result, byteLength, consumed, decodedBytes: consumed,
    tail, trailingBytes: tail.length };
}
