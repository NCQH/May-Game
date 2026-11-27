/* M3 scene wire schemas from the 2026-10-21 Python server and native AS3.
 * This module only encodes requests and decodes authoritative server data.
 * It contains no movement interpolation, combat calculation, bot logic, or AI.
 * Full source references and field order: ../../protocol_m3_scene.json.
 */
import { Reader, Writer } from './protocol.js';
import { encodeFrame } from './sixcube.js';

function frame(msgId, writer) { return encodeFrame(msgId, writer.finish()); }

/** C605's native m_nTankId field carries the bound account ID, not a tank ID. */
export function encodeLoadProgress(sceneId, accountId, delay = 0, loaded = 100) {
  if (!Number.isInteger(loaded) || loaded < 0 || loaded > 100) {
    throw new RangeError('Load progress must be an integer from 0 to 100');
  }
  return frame(605, new Writer().u32(sceneId).u32(accountId).u32(delay).u32(loaded));
}

/** C552 confirms readiness for the exact scene most recently supplied in S1705. */
export function encodeBattleEnter(sceneId) { return frame(552, new Writer().u32(sceneId)); }

/** C509 requests voluntary leave; wait for S1707/S1017 before clearing the view. */
export function encodeExitBattle(sceneId) { return frame(509, new Writer().u32(sceneId)); }

function readUint64Decimal(reader) {
  // Native UINT64 writes its low u32 first. Public values remain JSON-safe and
  // exact even when a timestamp is greater than Number.MAX_SAFE_INTEGER.
  reader.need(8);
  const low = BigInt(reader.u32()), high = BigInt(reader.u32());
  return ((high << 32n) | low).toString();
}

function readBuff(reader) {
  return { templateId: reader.u32(), instanceId: reader.u32(),
    stackCount: reader.u8(), casterId: reader.u32() };
}

/** TankInfo has 46 fixed bytes including the name length and buff count. */
function readTankInfo(reader) {
  return { objectId: reader.u32(), accountId: reader.u32(), x: reader.i16(), y: reader.i16(),
    hp: reader.i32(), maxHp: reader.i32(), star: reader.u8(), camp: reader.u8(),
    name: reader.string(), buffs: reader.vector(13, readBuff), lifeCount: reader.i16(),
    battleExp: reader.u32(), battleLevel: reader.u8(), tankLevel: reader.u8(),
    mp: reader.i32(), maxMp: reader.i32(), shield: reader.i32() };
}

function readPropsInfo(reader) {
  return { skillId: reader.u32(), slot: reader.u8(), count: reader.i8(),
    endTime: readUint64Decimal(reader), nextChargeTime: readUint64Decimal(reader) };
}

function readGivenItem(reader) {
  return { templateId: reader.u32(), count: reader.i32(), bind: reader.u8(), lifetime: reader.i32() };
}

function readMove(reader) {
  return { objectId: reader.u32(), x: reader.i16(), y: reader.i16(), speed: reader.i16(),
    direction: reader.u8(), moveType: reader.u8() };
}

function readFire(reader) {
  return { bulletId: reader.u32(), objectId: reader.u32(), startX: reader.i16(),
    startY: reader.i16(), destX: reader.i16(), destY: reader.i16(), speed: reader.i16(),
    templateId: reader.u32() };
}

function readSkill(reader) {
  return { casterId: reader.u32(), targetId: reader.u32(), skillId: reader.u32(),
    startX: reader.i16(), startY: reader.i16(), x: reader.i16(), y: reader.i16(),
    isReady: reader.u8(), count: reader.u8() };
}

const HANDLED = new Set([1550, 1551, 1552, 1554, 1564, 1586]);

/** Decode an owned scene schema, or return null so another codec can handle it.
 * Uninterpreted trailing bytes are retained for the session's strict validation.
 * S1586/S1564 have no scene ID: the session binds them to the accepted S1705.
 */
export function decodeScenePacket(msgId, payload) {
  if (!Number.isInteger(msgId) || msgId < 0 || msgId > 65535) throw new RangeError('Invalid message ID');
  if (!HANDLED.has(msgId)) return null;
  const r = new Reader(payload, msgId);
  const byteLength = r.bytes.length;
  let result;
  switch (msgId) {
    case 1550:
      result = { type: 'sceneSelf', actor: readTankInfo(r), fireRate: r.i16(), speed: r.i16(),
        skills: r.vector(22, readPropsInfo), items: r.vector(13, readGivenItem),
        kills: r.u8(), deaths: r.u8(), assists: r.u8() };
      break;
    case 1551:
      result = { type: 'sceneOthers', actors: r.vector(46, readTankInfo) };
      break;
    case 1552:
      result = { type: 'sceneAdd', actor: readTankInfo(r) };
      break;
    case 1554:
      result = { type: 'sceneStop', sceneId: r.u32(), objectId: r.u32(), x: r.i16(), y: r.i16() };
      break;
    case 1564:
      // Ten vectors in the native SyncSceneData order. No locally generated events.
      result = { type: 'sceneUpdate', moves: r.vector(12, readMove), fires: r.vector(22, readFire),
        skills: r.vector(22, readSkill),
        hp: r.vector(8, (p) => ({ objectId: p.u32(), hp: p.i32() })),
        npcDeaths: r.vector(8, (p) => ({ npcId: p.u32(), x: p.i16(), y: p.i16() })),
        mp: r.vector(8, (p) => ({ objectId: p.u32(), mp: p.i32() })),
        blownBullets: r.vector(4, (p) => p.u32()), removedObjects: r.vector(4, (p) => p.u32()),
        expiredBullets: r.vector(4, (p) => p.u32()),
        shields: r.vector(8, (p) => ({ objectId: p.u32(), shield: p.i32() })) };
      break;
    case 1586:
      result = { type: 'sceneEntered', startTime: r.u32(), overtime: r.u8() };
      break;
  }
  const consumed = r.offset, tail = r.rest();
  return { msgId, ...result, byteLength, consumed, decodedBytes: consumed,
    tail, trailingBytes: tail.length };
}
