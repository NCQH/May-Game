/* Server-side writers for the battle packets the client decodes.
 *
 * Payload-only: every function returns the bytes after the 8-byte Sixcube
 * header, matching Python's (msgId, body) tuples. Use `frame()` to wrap one
 * when a transport needs the complete packet.
 *
 * Layouts are copied from combat_protocol.py, battle_entry.py, pk_rules.py,
 * m8_crystal_protocol.js and the decoders in scene_protocol.js /
 * combat_protocol.js. Field order stays byte-for-byte identical.
 */
import { Writer } from '../../protocol.js';
import { encodeFrame } from '../../sixcube.js';
import { pyRound } from './math.js';

export const MSG = Object.freeze({
  S1550: 1550, S1551: 1551, S1552: 1552, S1553: 1553, S1554: 1554,
  S1556: 1556, S1558: 1558, S1559: 1559, S1560: 1560, S1561: 1561,
  S1562: 1562, S1564: 1564, S1566: 1566, S1572: 1572, S1579: 1579,
  S1707: 1707, S1708: 1708, S1104: 1104,
});

const utf8 = new TextEncoder();

export function frame(msgId, payload) { return encodeFrame(msgId, payload); }

function i8(writer, value) {
  if (!Number.isInteger(value) || value < -128 || value > 127) throw new RangeError('i8 out of range');
  return writer.add(new Uint8Array([value & 0xff]));
}

function u64(writer, value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('u64 requires a nonnegative safe integer');
  const big = BigInt(value);
  return writer.u32(Number(big & 0xffffffffn)).u32(Number((big >> 32n) & 0xffffffffn));
}

function f32(writer, value) {
  if (!Number.isFinite(value)) throw new RangeError('f32 requires a finite number');
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, true);
  return writer.add(bytes);
}

function payload(build) { const w = new Writer(); build(w); return w.finish(); }

/** Python combat_protocol.props: <IBbQQ. */
export function props(skill, slot, count = -1, end = 0, nextCharge = 0) {
  return payload(w => { w.u32(skill).u8(slot); i8(w, count); u64(w, end); u64(w, nextCharge); });
}

/** Python battle_entry._tank_info / scene_protocol readTankInfo. */
export function tankInfo({
  objectId, accountId, x, y, hp, maxHp = hp, star = 0, camp, name = '',
  buffs = [], lives = -1, battleExp = 0, battleLevel = 1, tankLevel = 1,
  mp = 0, maxMp = mp, shield = 0,
}) {
  return payload(w => {
    const rawName = utf8.encode(String(name));
    w.u32(objectId).u32(accountId).i16(x).i16(y).i32(hp).i32(maxHp)
      .u8(star).u8(camp).u16(rawName.length).add(rawName)
      .u16(buffs.length);
    for (const buff of buffs) w.add(buffInfo(buff));
    w.i16(lives).u32(battleExp).u8(battleLevel).u8(tankLevel)
      .i32(mp).i32(maxMp).i32(shield);
  });
}

/** BuffInfo: <IIBI, 13 bytes. */
export function buffInfo({ templateId, instanceId, stackCount = 1, casterId }) {
  return payload(w => w.u32(templateId).u32(instanceId).u8(stackCount).u32(casterId));
}

/** ObjInfo: <IIhhiBiIiH + BuffInfo vector, used by summons and map objects. */
export function objectInfo({
  objectId, templateId, x, y, hp = 0, camp = 0, maxHp = hp,
  ownerId = 0, shield = 0, buffs = [],
}) {
  return payload(w => {
    w.u32(objectId).u32(templateId).i16(x).i16(y).i32(hp).u8(camp).i32(maxHp)
      .u32(ownerId).i32(shield).u16(buffs.length);
    for (const buff of buffs) w.add(buffInfo(buff));
  });
}

/** Python combat_protocol.skill_event, 22 bytes. */
export function skillEvent(skill, start, dest, target = 0, { owner = 1, ready = 0 } = {}) {
  return payload(w => w.u32(owner).u32(target).u32(skill)
    .i16(pyRound(start[0])).i16(pyRound(start[1]))
    .i16(pyRound(dest[0])).i16(pyRound(dest[1])).u8(ready).u8(1));
}

/** Python combat_protocol.move_event, 12 bytes. */
export function moveEvent(position, speed, kind, owner = 1, direction = 8) {
  return payload(w => w.u32(owner).i16(pyRound(position[0])).i16(pyRound(position[1]))
    .i16(speed).u8(direction).u8(kind));
}

/** Projectile launch, 22 bytes: <IIhhhhhI. */
export function fireEvent(bulletId, ownerId, start, dest, speed, templateId) {
  return payload(w => w.u32(bulletId).u32(ownerId)
    .i16(pyRound(start[0])).i16(pyRound(start[1]))
    .i16(pyRound(dest[0])).i16(pyRound(dest[1]))
    .i16(speed).u32(templateId));
}

/** Python combat_protocol.stop_move: (1554, body). */
export function stopMove(sceneId, owner, position) {
  return payload(w => w.u32(sceneId).u32(owner)
    .i16(pyRound(position[0])).i16(pyRound(position[1])));
}

/** Python combat_protocol.scene body (ten vectors, native SyncSceneData order). */
export function scenePayload({
  moves = [], fires = [], skills = [], hp = [], npcDeaths = [], mp = [],
  blownBullets = [], removedObjects = [], expiredBullets = [], shields = [],
} = {}) {
  return payload(w => {
    const vector = (entries, write) => { w.u16(entries.length); for (const entry of entries) write(w, entry); };
    vector(moves, (out, entry) => out.add(ArrayBuffer.isView(entry) ? entry
      : moveEvent(entry.position, entry.speed, entry.kind ?? 0, entry.owner ?? 1,
        entry.direction ?? 8)));
    vector(fires, (out, entry) => out.add(ArrayBuffer.isView(entry) ? entry
      : fireEvent(entry.bulletId, entry.ownerId, entry.start, entry.dest, entry.speed, entry.templateId)));
    vector(skills, (out, entry) => out.add(ArrayBuffer.isView(entry) ? entry
      : skillEvent(entry.skillId, entry.start, entry.dest, entry.targetId ?? 0,
        { owner: entry.ownerId ?? 1, ready: entry.ready ?? 0 })));
    vector(hp, (out, entry) => out.u32(entry.objectId).i32(entry.hp));
    vector(npcDeaths, (out, entry) => out.u32(entry.npcId).i16(entry.x).i16(entry.y));
    vector(mp, (out, entry) => out.u32(entry.objectId).i32(entry.mp));
    vector(blownBullets, (out, entry) => out.u32(entry));
    vector(removedObjects, (out, entry) => out.u32(entry));
    vector(expiredBullets, (out, entry) => out.u32(entry));
    vector(shields, (out, entry) => out.u32(entry.objectId).i32(entry.shield));
  });
}

/** Python combat_protocol.scene: [1564, body]. Tank ports append this directly. */
export function scene(vectors) { return [1564, scenePayload(vectors)]; }

/** S1550 NotifySelfData. */
export function encodeS1550({
  tank, fireInterval = 0, speed = 0, skills = [], items = [],
  kills = 0, deaths = 0, assists = 0,
}) {
  return payload(w => {
    w.add(tankInfo(tank));
    w.i16(fireInterval).i16(speed).u16(skills.length);
    for (const skill of skills) {
      w.add(skill instanceof Uint8Array ? skill
        : props(skill.skillId, skill.slot, skill.count ?? -1, skill.end ?? 0, skill.nextCharge ?? 0));
    }
    w.u16(items.length);
    for (const item of items) {
      w.u32(item.templateId).i32(item.count).u8(item.bind ?? 0).i32(item.lifetime ?? 0);
    }
    w.u8(kills).u8(deaths).u8(assists);
  });
}

/** S1551 NotifyOtherList: uint16 count + TankInfo vector. */
export function encodeS1551(tanks) {
  return payload(w => { w.u16(tanks.length); for (const tank of tanks) w.add(tankInfo(tank)); });
}

/** S1552 NotifyTankAdd: one TankInfo. */
export function encodeS1552(tank) { return tankInfo(tank); }

/** S1553 NotifyTankRelive: account + respawn delay. */
export function encodeS1553(accountId, remainingMs) {
  return payload(w => w.u32(accountId).i32(remainingMs));
}

/** S1554 NotifyStopMove. */
export function encodeS1554(sceneId, objectId, position) { return stopMove(sceneId, objectId, position); }

/** S1556 NotifyAddObject: scene id + ObjInfo. */
export function encodeS1556(sceneId, object) {
  return payload(w => w.u32(sceneId).add(objectInfo(object)));
}

/** S1558 NotifyAddBuff: <IIIBII. */
export function encodeS1558(objectId, buff, durationMs) {
  return payload(w => w.u32(objectId).u32(buff.templateId).u32(buff.instanceId)
    .u8(buff.stackCount ?? 1).u32(buff.casterId).u32(durationMs >>> 0));
}

/** S1559 NotifyRemoveBuff: <II. */
export function encodeS1559(objectId, instanceId) {
  return payload(w => w.u32(objectId).u32(instanceId));
}

/** S1560 NotifyTankAttr: <IBi. */
export function encodeS1560(accountId, attrType, value) {
  return payload(w => w.u32(accountId).u8(attrType).i32(value));
}

/** S1561 actor stats: uint16 count + <IH21iB rows. */
export function encodeS1561(actors) {
  return payload(w => {
    w.u16(actors.length);
    for (const actor of actors) {
      const stats = actor.stats || [];
      if (stats.length !== 21) throw new RangeError('S1561 requires exactly 21 stats');
      w.u32(actor.accountId).u16(21);
      for (const value of stats) w.i32(value);
      w.u8(actor.tankLevel ?? 1);
    }
  });
}

/** S1562 bullet orbit correction: <Ihhhh. */
export function encodeS1562(bulletId, start, dest) {
  return payload(w => w.u32(bulletId)
    .i16(pyRound(start[0])).i16(pyRound(start[1]))
    .i16(pyRound(dest[0])).i16(pyRound(dest[1])));
}

/** S1564 SyncSceneData payload (wire bytes only). */
export function encodeS1564(vectors) { return scenePayload(vectors); }

/** S1566 kill info + assist vector. */
export function encodeS1566(kill) {
  return payload(w => {
    w.u32(kill.killerId).u32(kill.victimId).u32(kill.skillId)
      .i16(kill.x).i16(kill.y).u8(kill.multiCount ?? 0).u8(kill.killerStreak ?? 0)
      .u8(kill.victimStreak ?? 0).u8(kill.firstBlood ?? 0).u16((kill.assists || []).length);
    for (const id of kill.assists || []) w.u32(id);
  });
}

/** S1581 self-only buff timer/stack refresh: <IIB. */
export function encodeS1581(instanceId, remainingMs, stackCount) {
  return payload(w => w.u32(instanceId).u32(remainingMs >>> 0).u8(stackCount));
}

/** S1605 floating HP-change metadata: <HIiBI. */
export function encodeS1605(delta, objectId, fury = 0, casterId = objectId) {
  return payload(w => w.u16(1).u32(objectId).i32(delta).u8(fury).u32(casterId));
}

/** S1572 cooldown snapshot: PropsInfo + owner. */
export function encodeS1572(ownerId, info) {
  return payload(w => w.add(props(info.skillId, info.slot, info.count ?? -1,
    info.end ?? 0, info.nextCharge ?? 0)).u32(ownerId));
}

/** S1579 local-slot cooldown change: PropsInfo + optional owner. */
export function encodeS1579(info, ownerId = null) {
  return payload(w => {
    w.add(props(info.skillId, info.slot, info.count ?? -1, info.end ?? 0, info.nextCharge ?? 0));
    if (ownerId !== null) w.u32(ownerId);
  });
}

/** S1707 scene exit: <IIIII. */
export function encodeS1707({ errorId = 0, sceneId, accountId = 1, exitType = 0, isObserver = 0 }) {
  return payload(w => w.u32(errorId).u32(sceneId).u32(accountId).u32(exitType).u32(isObserver));
}

/**
 * S1708 battle settlement. Mirrors pk_rules.settlement exactly:
 * header, TankSettleInfo rows, escaped rows, rates, ids, scene UUID.
 */
export function encodeS1708({
  sceneId, mapId, battleTime, roomType = 2, winCamp = 0, winType = 1,
  redLifeCount = 0, blueLifeCount = 0, actors = [], escaped = [],
  serverExpRate = 1, tokenGoldRate = 1, bpvpActOpen = 0, itemDropRate = 0,
  killerId = 0, assisterId = 0, kdaId = 0, destroyerId = 0,
  victoryMvpId = 0, defeatMvpId = 0, sceneUuid = '',
}) {
  const settleInfo = (w, actor) => {
    const stats = actor.stats || [];
    if (stats.length !== 21) throw new RangeError('S1708 requires exactly 21 stats');
    w.u32(actor.accountId).u32(actor.tankId).u16(21);
    for (const value of stats) w.i32(value);
    w.i16(actor.teamMerit ?? 0).i16(actor.oldElo ?? 0).i16(actor.newElo ?? 0)
      .i16(actor.tankGains ?? 0).i32(actor.newTankGains ?? 0)
      .u8(actor.award ?? 0).u8(actor.isWin ?? 0).u8(actor.robotType ?? 0)
      .u8(actor.eloSection ?? 0).u8(actor.battleLevel ?? 1).u8(actor.roomCount ?? 0)
      .u8(actor.camp ?? 0);
    for (const field of ['exp', 'coins', 'tankExp']) {
      const groups = actor[field] || [];
      w.u16(groups.length);
      for (const group of groups) w.i32(group.type ?? 0).i32(group.value ?? 0);
    }
    const items = actor.items || [];
    w.u16(items.length);
    for (const item of items) w.u32(item.templateId).i32(item.count)
      .u8(item.bind ?? 0).i32(item.lifetime ?? 0);
    const pve = actor.pve || {};
    w.u8(pve.total ?? 0).u8(pve.harm ?? 0).u8(pve.dead ?? 0).u8(pve.time ?? 0).u8(pve.booster ?? 0);
  };
  return payload(w => {
    w.u32(sceneId).u32(mapId).u32(battleTime).u8(roomType).u8(winCamp).u8(winType)
      .i16(redLifeCount).i16(blueLifeCount).u16(actors.length);
    for (const actor of actors) settleInfo(w, actor);
    w.u16(escaped.length);
    for (const actor of escaped) settleInfo(w, actor);
    f32(w, serverExpRate); f32(w, tokenGoldRate); w.u8(bpvpActOpen)
      .u32(itemDropRate).u32(killerId).u32(assisterId).u32(kdaId)
      .u32(destroyerId).u32(victoryMvpId).u32(defeatMvpId);
    const uuid = utf8.encode(sceneUuid);
    w.u16(uuid.length).add(uuid);
  });
}

/** S1104 settle award (m8_crystal_protocol.js decoder). */
export function encodeS1104({  kind, award = {}, isShow = 0, extra = 0,
}) {
  return payload(w => {
    w.u32(kind);
    w.i32(award.cash ?? 0).i32(award.gift ?? 0).i32(award.golden ?? 0).i32(award.glory ?? 0);
    const groups = award.groups || [];
    w.u16(groups.length);
    for (const group of groups) {
      w.u32(group.type ?? 0);
      w.u16((group.items || []).length);
      for (const item of group.items || []) w.u32(item.itemId).i32(item.count);
    }
    const tankIds = award.tankIds || [];
    w.u16(tankIds.length);
    for (const id of tankIds) w.u32(id);
    w.i32(award.exp ?? 0).u16(award.fizz ?? 0)
      .u8(isShow).u32(extra);
  });
}

// Python combat_protocol.py names used verbatim by tank action ports.
export const skill_event = skillEvent;
export const move_event = moveEvent;
export const stop_move = (sceneId, owner, position) => [1554, stopMove(sceneId, owner, position)];
export const tank_info = tankInfo;
export const object_info = objectInfo;
export const buff_info = buffInfo;
