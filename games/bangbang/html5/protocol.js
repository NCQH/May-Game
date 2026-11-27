/* M2 payload schemas from the 2026-10-21 Python server and extracted AS3.
 * These functions encode client requests and decode server state only.
 * All encode* exports return complete Sixcube frames, including the 8-byte header.
 * See protocol_packets.json for source references and retained native tails.
 */
import { encodeFrame } from './sixcube.js';

const utf8 = new TextEncoder();
const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

export const PROTOCOL_VERSION = Object.freeze({ auth: 3, gate: 18, client: '1.0.1.8480' });

function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('Protocol payload must be bytes');
}

export class Writer {
  constructor() { this.parts = []; this.length = 0; }
  add(bytes) { this.parts.push(bytes); this.length += bytes.length; return this; }
  number(method, size, value, min, max) {
    if (!Number.isInteger(value) || value < min || value > max) throw new RangeError('Protocol integer out of range');
    const bytes = new Uint8Array(size);
    new DataView(bytes.buffer)[method](0, value, true);
    return this.add(bytes);
  }
  u8(value) { return this.number('setUint8', 1, value, 0, 255); }
  u16(value) { return this.number('setUint16', 2, value, 0, 65535); }
  i16(value) { return this.number('setInt16', 2, value, -32768, 32767); }
  u32(value) { return this.number('setUint32', 4, value, 0, 0xffffffff); }
  i32(value) { return this.number('setInt32', 4, value, -0x80000000, 0x7fffffff); }
  string(value) {
    if (typeof value !== 'string') throw new TypeError('Protocol string required');
    const bytes = utf8.encode(value);
    return this.u16(bytes.length).add(bytes);
  }
  finish() {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) { out.set(part, offset); offset += part.length; }
    return out;
  }
}

export class Reader {
  constructor(bytes, msgId) {
    this.bytes = bytesOf(bytes);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.offset = 0;
    this.msgId = msgId;
  }
  get remaining() { return this.bytes.length - this.offset; }
  need(size) {
    if (!Number.isSafeInteger(size) || size < 0 || size > this.remaining) {
      throw new RangeError(`Truncated S${this.msgId} at byte ${this.offset}: need ${size}, have ${this.remaining}`);
    }
  }
  number(method, size) {
    this.need(size);
    const value = this.view[method](this.offset, true);
    this.offset += size;
    return value;
  }
  u8() { return this.number('getUint8', 1); }
  i8() { return this.number('getInt8', 1); }
  u16() { return this.number('getUint16', 2); }
  i16() { return this.number('getInt16', 2); }
  u32() { return this.number('getUint32', 4); }
  i32() { return this.number('getInt32', 4); }
  string() {
    const size = this.u16();
    this.need(size);
    const value = strictUtf8.decode(this.bytes.subarray(this.offset, this.offset + size));
    this.offset += size;
    return value;
  }
  vector(minimumBytes, read) {
    const count = this.u16();
    this.need(count * minimumBytes);
    const values = [];
    for (let i = 0; i < count; i += 1) values.push(read(this));
    return values;
  }
  fields(schema) {
    const values = {};
    for (const [name, method] of schema) values[name] = this[method]();
    return values;
  }
  rest() { const out = this.bytes.slice(this.offset); this.offset = this.bytes.length; return out; }
}

function frame(msgId, writer) { return encodeFrame(msgId, writer.finish()); }

export function encodeVersion(role = 'AUTH') {
  const normalized = String(role).toUpperCase();
  if (normalized !== 'AUTH' && normalized !== 'GATE') throw new RangeError('Version role must be AUTH or GATE');
  return frame(52, new Writer().u32(PROTOCOL_VERSION.auth).u32(PROTOCOL_VERSION.gate).u32(0)
    .string(normalized === 'AUTH' ? 'curVersion' : PROTOCOL_VERSION.client));
}

export function encodeLogin(username, loginToken) {
  // C51.m_passwd carries the HTTP loginToken. It is not a password and not m_token.
  const w = new Writer().u8(0).string(username).string(loginToken);
  for (let i = 0; i < 6; i += 1) w.string('');
  return frame(51, w.u32(0));
}

export function encodeBind(sessionKey, accountId) {
  return frame(54, new Writer().u32(sessionKey).u32(accountId));
}

export function encodeEnter(charUuid, accountId = 0) {
  // Native GameTool leaves m_accountId at zero; C54 has already authenticated it.
  return frame(56, new Writer().string(charUuid).string('').u32(accountId).string('').i16(0));
}

export function encodeReady(type = 0, funcType = 0, param1 = 0, param2 = 0) {
  // C72 is ClientDataStat in AS3; the current Python handler uses it to send the garage batch.
  return frame(72, new Writer().u8(type).u8(funcType).i32(param1).i32(param2));
}

export function encodeSync(containerType = 0) {
  return frame(165, new Writer().u32(containerType));
}

export function encodeTick() {
  // PingManagerBase instantiates RequestPing without assigning fields. Python ignores its body.
  return encodeFrame(61);
}

export function encodeChatHeartbeat(timeMs = Date.now()) {
  // SystemHeartBeat writes UINT64.lowpart followed by hipart. Native CHAT ignores
  // the timestamp, but receiving C60 keeps its socket idle timeout from expiring.
  if (!Number.isSafeInteger(timeMs) || timeMs < 0) {
    throw new RangeError('Chat timestamp must be a nonnegative safe integer');
  }
  const low = timeMs % 0x100000000;
  const high = Math.floor(timeMs / 0x100000000);
  return frame(60, new Writer().u32(low).u32(high));
}

// Full CHAR_BASIC fixed prefix, 126 bytes, then UTF-8 name and UUID.
const CHAR_BASIC = [
  ['accountId', 'u32'], ['sex', 'u8'], ['level', 'u8'], ['vipTime', 'u32'], ['exp', 'i32'],
  ['tankExpDoubleTime', 'u32'], ['expDoubleTime', 'u32'], ['tokenDoubleTime', 'u32'],
  ['materialDoubleTime', 'u32'], ['tokenDoubleUse', 'u16'], ['materialDoubleUse', 'u16'],
  ['tankExpDoubleUse', 'u16'], ['militaryLevel', 'u16'], ['militaryExp', 'i32'],
  ['sprayId', 'u32'], ['vipPoints', 'u32'], ['vipPointsAddToday', 'u16'], ['avatarId', 'u32'],
  ['decorateId', 'u32'], ['fizz', 'i16'], ['weekFizz', 'i16'], ['vipTankTryTime', 'u32'],
  ['superVipTime', 'u32'], ['actionFlag', 'u32'], ['thew', 'i16'], ['thewBuy', 'i16'],
  ['createTime', 'u32'], ['onlineTime', 'u32'], ['honorId', 'u32'], ['goldenPool', 'u32'],
  ['rlteStageCount', 'u32'], ['settingFlag', 'u32'], ['cashbackTimes', 'u32'],
  ['cashbackPicked', 'u32'], ['prenticeCashback', 'u32'], ['graduateCount', 'u16'],
  ['groceryAdd', 'u16'], ['gmLevel', 'u8'], ['hasTankSoulRankAward', 'u8'], ['militaryStar', 'u32'],
  ['name', 'string'], ['charUuid', 'string'],
];

const TANK_INSTANCE = [
  ['uuid', 'string'], ['tankId', 'u32'], ['level', 'u8'], ['exp', 'u32'], ['extFlag', 'u32'],
  ['strengthenLevel', 'u8'], ['externalId', 'u32'], ['warCount', 'u32'], ['weekWarCount', 'u32'],
  ['containerType', 'u8'], ['cashHireCount', 'u8'], ['coinHireCount', 'u8'], ['existTime', 'u32'],
  ['haloId', 'u32'], ['skinFrameType', 'u8'], ['ownTime', 'u32'], ['strengthenCount', 'u8'],
  ['commonSkillId', 'u32'], ['crystalSchemeId', 'u8'], ['talentPageUuid', 'string'],
  ['proficiency', 'u32'], ['battleGains', 'i32'],
];

const ITEM_INSTANCE = [
  ['uuid', 'string'], ['templateId', 'u32'], ['lifeTime', 'u32'], ['extFlag', 'u32'],
  ['count', 'i32'], ['level', 'u8'], ['upgradeLevel', 'u8'], ['exp', 'i32'], ['rank', 'u8'],
  ['upgradeCost', 'i32'], ['rankCost', 'i32'], ['createTime', 'u32'], ['slotNo', 'i16'],
];

const KNOWN_UNDECODED = Object.freeze({
  1017: 'NotifyBackToMain', 1023: 'NotifyUseAvatar', 1028: 'NotifyHonor', 1029: 'NotifyHonorList',
  1036: 'NotifySyncSetting', 1047: 'NotifyCharOption', 1050: 'NotifyQQVip',
  1503: 'WorldEnterTrackConfirm', 1508: 'NotifyBuddyBrief', 1724: 'NotifyHallDisplayList',
  1800: 'NotifyGuildInfo', 1816: 'GuildApplyList', 1831: 'NotifyTeamMember',
  1832: 'GuildResearchSkills', 1955: 'NotifyActInfo',
});

/** Decode a frame emitted by SixcubeStream. Unknown messages retain all bytes.
 * Known packets keep any bytes beyond their documented schema as `tail`.
 * No suffix is silently interpreted as gameplay data or discarded.
 */
export function decodePacket({ msgId, payload }) {
  if (!Number.isInteger(msgId) || msgId < 0 || msgId > 65535) throw new RangeError('Invalid message ID');
  const r = new Reader(payload, msgId);
  const byteLength = r.bytes.length;
  let result;
  switch (msgId) {
    case 901:
      result = { type: 'authOk', sessionKey: r.u32(), expiresAt: r.u32(), hasCharacter: r.u32(), accountId: r.u32() };
      break;
    case 902:
      result = { type: 'authError', reason: r.i32(), openTime: r.u32(), message: r.string() };
      break;
    case 903: {
      // Current server emits the literal acknowledgement b'\x00\x00'; no invented flags.
      const first = r.u8(), second = r.u8();
      if (first !== 0 || second !== 0) throw new Error('Unexpected version acknowledgement');
      result = { type: 'versionOk' };
      break;
    }
    case 906:
      result = { type: 'serverList', servers: r.vector(20, (p) => ({
        regionId: p.u32(), name: p.string(), gateHost: p.string(), gatePort: p.u16(),
        chatHost: p.string(), chatPort: p.u16(), currentLoad: p.i8(), isPvp: p.i8(), openTime: p.u32(),
      })) };
      break;
    case 1003: {
      const low = r.u32(), high = r.u32(), serverTimeSeconds = r.u32();
      const serverTimeMs = high * 0x100000000 + low;
      if (!Number.isSafeInteger(serverTimeMs)) throw new RangeError('Server timestamp exceeds exact JavaScript integer range');
      result = { type: 'tick', serverTimeMs, serverTimeSeconds };
      break;
    }
    case 1005:
      result = { type: 'worldEntered', accountId: r.u32(), gameToken: r.u32() };
      break;
    case 1008:
      result = { type: 'characterPicked', charUuid: r.string() };
      break;
    case 1016: {
      const basic = r.fields(CHAR_BASIC);
      const currency = r.fields([['cash', 'i32'], ['golden', 'i32'], ['silver', 'i32'],
        ['honor', 'i32'], ['crystal', 'i32'], ['presentPoint', 'i32']]);
      const queryUrl = r.string();
      const technologies = r.vector(4, (p) => p.i32());
      result = { type: 'characterData', ...basic, currency, queryUrl, technologies };
      break;
    }
    case 1100:
      result = { type: 'container', containerType: r.u32(),
        items: r.vector(39, (p) => p.fields(ITEM_INSTANCE)), notifyType: r.u8() };
      break;
    case 1150:
      result = { type: 'garage', tanks: r.vector(60, (p) => {
        const tank = p.fields(TANK_INSTANCE);
        return { ...tank, selected: (tank.extFlag & 2) !== 0 };
      }), notifyType: r.u8(), containerType: r.u8() };
      break;
    case 1351:
      result = { type: 'guildSkills', skills: r.vector(8, (p) => ({ skillId: p.u32(), level: p.u32() })), opType: r.u32() };
      break;
    case 1350:
      result = { type: 'guildSlots', slots: r.vector(12, (p) => ({ slotId: p.u32(), skillId: p.u32(), level: p.u32() })), flags: r.u32() };
      break;
    case 1045:
      result = { type: 'limits', limits: r.vector(8, (p) => ({ limitId: p.u32(), count: p.i32() })) };
      break;
    case 1455:
      result = { type: 'crystalNames', boards: r.vector(6, (p) => ({ boardId: p.u32(), name: p.string() })) };
      break;
    case 1454:
      result = { type: 'crystalBoards', boards: r.vector(124, (p) => ({
        boardId: p.u32(), items: Array.from({ length: 30 }, () => p.u32()),
      })) };
      break;
    case 3500:
      // Python CHAT confirmation is a constant 10-byte legacy body. Retain it, do not infer field names.
      r.need(10);
      result = { type: 'chatReady', raw: r.rest(), decoded: false };
      break;
    default:
      result = { type: 'unknown', name: KNOWN_UNDECODED[msgId] || null, raw: r.rest(), decoded: false };
  }
  const decodedBytes = result.decoded === false ? 0 : r.offset;
  return { msgId, ...result, byteLength, decodedBytes, tail: r.rest() };
}
