/* M4 combat wire schemas from current Python + native AS3, 2026-10-21.
 * Codec only: no local damage, movement, bot, cooldown, or match simulation.
 * Encoders return complete Sixcube frames. Source layouts: protocol_m4_combat.json.
 */
import { Reader, Writer } from './protocol.js';
import { encodeFrame } from './sixcube.js';

function frame(msgId, writer) { return encodeFrame(msgId, writer.finish()); }

/** Native 24px step. Direction is 0..7 (NW,N,NE,E,SE,S,SW,W), or 8 none. */
export function encodeMoveForward(sceneId, startX, startY, direction) {
  if (!Number.isInteger(direction) || direction < 0 || direction > 8) {
    throw new RangeError('Move direction must be an integer from 0 to 8');
  }
  return frame(501, new Writer().u16(startX).u16(startY).u8(direction).u32(sceneId));
}

/** targetId is an actor/object ID; Quan Vu basic/E1 use 0, E2/Space a target. */
export function encodeUseSkill(sceneId, targetId, slot, destX, destY) {
  return frame(503, new Writer().u32(sceneId).u32(targetId).u8(slot).i16(destX).i16(destY));
}

/** C510 replies to native S1590 auto-bullet aiming; ordinary fire uses C503. */
export function encodeAutoBullet(sceneId, startX, startY, destX, destY) {
  return frame(510, new Writer().u32(sceneId).i16(startX).i16(startY).i16(destX).i16(destY));
}

/** Channel aim only. The current QuanVuActions does not handle C514. */
export function encodeCacheSkillDestPos(sceneId, destX, destY) {
  return frame(514, new Writer().u32(sceneId).i16(destX).i16(destY));
}

/** Native settlement exit; server accepts only after its match has finished. */
export function encodeExitBattleEnd() { return encodeFrame(613); }

function readUint64Decimal(r) {
  const low = BigInt(r.u32()), high = BigInt(r.u32());
  return ((high << 32n) | low).toString();
}

function readPropsInfo(r) {
  return { skillId: r.u32(), slot: r.u8(), count: r.i8(),
    endTime: readUint64Decimal(r), nextChargeTime: readUint64Decimal(r) };
}

function readBuffInfo(r) {
  return { templateId: r.u32(), instanceId: r.u32(), stackCount: r.u8(), casterId: r.u32() };
}

function readObjectInfo(r) {
  return { objectId: r.u32(), templateId: r.u32(), x: r.i16(), y: r.i16(), hp: r.i32(),
    camp: r.u8(), maxHp: r.i32(), ownerId: r.u32(), shield: r.i32(),
    buffs: r.vector(13, readBuffInfo) };
}

function readTankStatInfo(r) {
  return { accountId: r.u32(), stats: r.vector(4, (p) => p.i32()), battleLevel: r.u8() };
}

function readSettleGroup(r) { return { type: r.i32(), value: r.i32() }; }

function readGivenItem(r) {
  return { templateId: r.u32(), count: r.i32(), bind: r.u8(), lifetime: r.i32() };
}

function readTankSettleInfo(r) {
  return { accountId: r.u32(), tankId: r.u32(), stats: r.vector(4, (p) => p.i32()),
    teamMerit: r.i16(), oldElo: r.i16(), newElo: r.i16(), tankGains: r.i16(), newTankGains: r.i32(),
    award: r.u8(), isWin: r.u8(), robotType: r.u8(), eloSection: r.u8(),
    battleLevel: r.u8(), roomCount: r.u8(), camp: r.u8(),
    exp: r.vector(8, readSettleGroup), coins: r.vector(8, readSettleGroup),
    tankExp: r.vector(8, readSettleGroup), items: r.vector(13, readGivenItem),
    pve: { total: r.u8(), harm: r.u8(), dead: r.u8(), time: r.u8(), booster: r.u8() } };
}

function readKillInfo(r) {
  return { killerId: r.u32(), victimId: r.u32(), skillId: r.u32(), x: r.i16(), y: r.i16(),
    multiCount: r.u8(), killerStreak: r.u8(), victimStreak: r.u8(), firstBlood: r.u8(),
    assists: r.vector(4, (p) => p.u32()) };
}

const HANDLED = new Set([1553, 1556, 1558, 1559, 1560, 1561, 1562, 1565, 1566,
  1572, 1578, 1579, 1581, 1583, 1585, 1589, 1590, 1595, 1603, 1605, 1708, 1710,1731,1732,1733,1734,1735,1736]);

/** Return null for schemas owned by M2/M3 or not yet verified from source.
 * Message order and trailing bytes are preserved for the session reducer/guard.
 * No scene ID is invented for messages whose native payload does not carry it.
 */
export function decodeCombatPacket(msgId, payload) {
  if (!Number.isInteger(msgId) || msgId < 0 || msgId > 65535) throw new RangeError('Invalid message ID');
  if (!HANDLED.has(msgId)) return null;
  const r = new Reader(payload, msgId);
  const byteLength = r.bytes.length;
  let result;
  switch (msgId) {
    case 1553:
      result = { type: 'tankRelive', accountId: r.u32(), remainingMs: r.i32() };
      break;
    case 1556:
      result = { type: 'sceneObjectAdd', sceneId: r.u32(), object: readObjectInfo(r) };
      break;
    case 1558:
      result = { type: 'buffAdd', objectId: r.u32(), buff: readBuffInfo(r), durationMs: r.u32() };
      break;
    case 1559:
      result = { type: 'buffRemove', objectId: r.u32(), instanceId: r.u32() };
      break;
    case 1560:
      result = { type: 'tankAttr', accountId: r.u32(), attrType: r.u8(), value: r.i32() };
      break;
    case 1561:
      result = { type: 'sceneStats', actors: r.vector(7, readTankStatInfo) };
      break;
    case 1562:
      result = { type: 'bulletOrbit', bulletId: r.u32(), startX: r.i16(), startY: r.i16(),
        destX: r.i16(), destY: r.i16() };
      break;
    case 1566:
      result = { type: 'killInfo', ...readKillInfo(r) };
      break;
    case 1565:
      result={type:'occupyState',flags:r.vector(20,p=>({index:p.i32(),camp:p.i32(),locked:p.i32(),progress:p.i32(),scoreTime:p.u32()}))};
      if(result.flags.some(f=>f.index<0||![0,1,2].includes(f.camp)||![0,1].includes(f.locked)))throw new RangeError('Invalid flag state');
      break;
    case 1732:
      result={type:'occupyAddScore',index:r.i32(),camp:r.i32(),score:r.i32()};
      if(![1,2].includes(result.camp)||result.index<0||result.score<0)throw new RangeError('Invalid flag score');
      break;
    case 1572: {
      // PropsInfo precedes ownerId on wire, despite native member declaration order.
      const skill = readPropsInfo(r);
      result = { type: 'skillCooldown', ownerId: r.u32(), skill };
      break;
    }
    case 1578:
      result = { type: 'objectThrow', objectId: r.u32(), startX: r.i16(), startY: r.i16(),
        destX: r.i16(), destY: r.i16(), durationMs: r.u32(), throwType: r.u8() };
      break;
    case 1579:
      result = { type: 'skillChanged', skill: readPropsInfo(r) };
      // Current KurumiActions._cooldown sends PropsInfo + uint32 self.id
      // even on its changed/local (S1579) branch. Other native producers send
      // PropsInfo alone. Decode exactly those two source-observed layouts;
      // arbitrary tails still fail the strict session decoder.
      if (byteLength === 26) result.ownerId = r.u32();
      break;
    case 1581:
      result = { type: 'buffTime', instanceId: r.u32(), remainingMs: r.u32(), stackCount: r.u8() };
      break;
    case 1583:
      result = { type: 'skillStopped', casterId: r.u32(), skillId: r.u32() };
      break;
    case 1585:
      result = { type: 'battleExp', currentExp: r.u16(), x: r.i16(), y: r.i16(), killHit: r.u8() };
      break;
    case 1589:
      // NotifyPortalPoint: vector<PortalInfo>, int32 index + int32 state.
      // The server owns teleportation and the cooldown, not this animation.
      result = { type: 'portalStates', portals: r.vector(8, p => {
        const index = p.i32(), state = p.i32();
        if (![0, 1, 2].includes(state)) throw new RangeError('Invalid native portal state');
        return {index, state};
      }) };
      break;
    case 1590:
      result = { type: 'autoBulletRequest' };
      break;
    case 1595:
      // Battle-only level: native battle_levels.grant uses object ID, not
      // account ID. HP/stat and self EXP notifications remain separate.
      result = { type: 'battleLevel', objectId: r.u32(), battleLevel: r.u8() };
      break;
    case 1603:
      result = { type: 'skillDest', objectId: r.u32(), x: r.i16(), y: r.i16() };
      break;
    case 1605:
      // Floating HP change / native reveal metadata only. S1564 carries the
      // actual current HP; adding this delta to HP would apply damage twice.
      result = { type: 'hpChange', changes: r.vector(13, (p) => ({
        objectId: p.u32(), delta: p.i32(), fury: p.u8(), casterId: p.u32() })) };
      break;
    case 1708:
      result = { type: 'battleEnd', sceneId: r.u32(), mapId: r.u32(), battleTime: r.u32(),
        roomType: r.u8(), winCamp: r.u8(), winType: r.u8(), redLifeCount: r.i16(), blueLifeCount: r.i16(),
        actors: r.vector(42, readTankSettleInfo), escaped: r.vector(42, readTankSettleInfo),
        serverExpRate: r.number('getFloat32', 4), tokenGoldRate: r.number('getFloat32', 4),
        bpvpActOpen: r.u8(), itemDropRate: r.u32(), killerId: r.u32(), assisterId: r.u32(),
        kdaId: r.u32(), destroyerId: r.u32(), victoryMvpId: r.u32(), defeatMvpId: r.u32(),
        sceneUuid: r.string() };
      break;
    case 1733:
      result = {type:'roundScore',camp1:r.u32(),camp2:r.u32()};
      break;
    case 1734:
      result = {type:'roundStart',startTime:r.u32(),number:r.u32(),sceneId:r.u32()};
      if(result.number<1||result.number>99)throw new RangeError('Invalid round number');
      break;
    case 1735:
      result = {type:'roundResult',winner:r.i32()};
      if(![1,2].includes(result.winner))throw new RangeError('Invalid round winner');
      break;
    case 1736:
      result = {type:'roundAlive',camp1:r.u32(),camp2:r.u32()};
      break;
    case 1731:
    case 1710:
      result = { type: 'campScore', camp1: r.u32(), camp2: r.u32() };
      break;
  }
  const consumed = r.offset, tail = r.rest();
  return { msgId, ...result, byteLength, consumed, decodedBytes: consumed,
    tail, trailingBytes: tail.length };
}
