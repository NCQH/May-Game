/* M5 PvP-with-bots room flow for the static GATE worker.
 *
 * Wire only: native C600/C601/C602/C607/C610/C215/C614/C605/C552/C509 and the
 * S1700/S1701/S1705/S1707/S1709/S1721/S1724/S1727/S1728 frames the M3 client
 * already decodes. Combat/result stay in the M5 arena, not here.
 *
 * Sources: server/multiplayer_gate.py, multiplayer_rooms.py,
 * prebattle_selection.py, sixcube_server.py (make_* helpers), and the captured
 * static-server/frames.json. The capture's room1700 is a PvE (roomType 4,
 * map 201) room; it supplies the player brief and room 1001 identity used here.
 */
import { Reader, Writer } from '../../protocol.js';
import { encodeFrame } from '../../sixcube.js';
import { PK_MAPS } from '../../m89_pk_maps.js';
import { BATTLE_MAPS } from '../../m810_modes.js';
import { NATIVE_TANK_IDS } from '../../m6_control_contract.js';

export const ROOMS_REQUEST = 60006;
export const ROOMS_REPLY = 60007;
export const SELECT_SECONDS = 60;

const MAP_BY_ID = new Map(BATTLE_MAPS.map((row) => [row.mapId, row]));
const MAP_BY_MODE = new Map(BATTLE_MAPS.map((row) => [row.mode, row]));
const NATIVE_TANKS = new Set(NATIVE_TANK_IDS);
const DEFAULT_MAP = MAP_BY_ID.get(19);

// Python bot_setup.configure_room's numeric room mode per map group.
const GROUP_MODE = Object.freeze({
  PK: 3, 'Phá trụ': 1, 'Chiếm cứ điểm': 2, 'Hộ tống': 1, 'Sinh Tử': 4, 'Luyện tập': 2,
});
// Native room titles used by bot_setup.configure_room for PK maps.
const PK_TITLE = Object.freeze({
  pk_mine: 'Khu Mỏ Phóng Xạ', pk_fortress: 'Pháo Đài Không Gian',
  pk_polar: 'Tiền Đồn Cực Địa', pk_lightning: 'Điện Chớp Sấm Rền',
  pk_fastfood: 'Quán Ăn Vui Vẻ', pk_snow: 'Băng Thiên Tuyết Địa',
  pk_maya: 'Lời Tiên Tri Maya', pk_robo: 'Robo', pk_cow: 'Dắt bò', pk_totem: 'Vật Tổ',
});

export const PVP_MAP_IDS = Object.freeze(PK_MAPS.map((row) => row.mapId));
export const PVP_MODES = Object.freeze(PK_MAPS.map((row) => row.mode));

/** Player brief values decoded from the captured S1700 in frames.json. */
export const OFFLINE_PLAYER = Object.freeze({
  accountId: 30000797, charUuid: 'multiplayer-char-30000797', name: 'M2 Test',
  level: 36, sex: 1, vipLevel: 6, eloSection: 1, preEloSection: 1,
  avatarId: 2801001, decorateId: 0, graduate: 0, elo: 1000, honorId: 0,
  boosterAttack: 0, militaryStar: 382, teamPlace: 0, teamName: '',
  tankId: 10000044, tankLevel: 5, externalId: 10673, haloId: 0,
  skinFrameType: 0, commandSkill: 0,
});

/** Verbatim shape of the captured offline room (S1700 in frames.json). */
export const CAPTURED_OFFLINE_ROOM = Object.freeze({
  roomId: 1001, creatorAccountId: 30000797, maxPlayers: 1, minPlayers: 1,
  observerCapacity: 0, password: 0, name: 'PvE — Lính đánh thuê gian ác',
  state: 0, roomType: 4, mode: 1,
  config: Object.freeze({ mapId: 201, banRobot: 0, tankAvailableLevel: 0, ladderMin: 0, ladderMax: 0 }),
});

/** Same identity, adapted to the default PvP bot room (pk_robo). */
export const BOT_ROOM = Object.freeze({
  roomId: 1001, creatorAccountId: 30000797, maxPlayers: 10, minPlayers: 2,
  observerCapacity: 0, password: 0, name: 'PK Robo - 25 điểm / 4 phút',
  state: 0, roomType: 2, mode: 3, mapId: 19,
  config: Object.freeze({ mapId: 19, banRobot: 0, tankAvailableLevel: 0, ladderMin: 0, ladderMax: 0 }),
});

/** All ids are NATIVE_TANK_IDS; the human tank is filtered out of the allies. */
export const BOT_TANKS = Object.freeze([
  10000019, 10000001, 10000003, 10000034, 10000036, 10000037,
  10000039, 10000043, 10000045, 10000048, 10000051, 10000053,
  10000060, 10000063, 10000065, 10000069, 10000073, 10000075,
]);

const BOT_ACCOUNT_BASE = 88888886; // Python: acct_id = 88888886 + object_id.

export function modeNumber(row) {
  return GROUP_MODE[row?.group] ?? 3;
}

export function botRoomName(mode, mapId) {
  const row = MAP_BY_MODE.get(mode) || MAP_BY_ID.get(Number(mapId)) || DEFAULT_MAP;
  const numeric = modeNumber(row);
  if (row.mode === 'test_desert') return 'Phòng test tank - Việt Dã';
  if (numeric === 3) {
    const duration = row.mode === 'pk_totem' || row.mode === 'pk_polar' ? '3 phút 30 giây' : '4 phút';
    return `PK ${PK_TITLE[row.mode] || row.name} - 25 điểm / ${duration}`;
  }
  if (numeric === 2) return `Chiếm cờ ${row.name} - 1.000 điểm / 10 phút`;
  if (numeric === 4) return `Sinh Tử ${row.name} - thắng 2 vòng`;
  if (row.mode === 'escort_bomb') return 'Hộ tống xe bom - về đích / 15 phút';
  return `Phá nhà ${row.name} - 15 phút`;
}

/** Deterministic stand-in for bot_setup.make_roster. */
export function defaultBots({
  allies = 4, enemies = 5, level = 5, humanTankId = OFFLINE_PLAYER.tankId,
  accountBase = BOT_ACCOUNT_BASE, tanks = BOT_TANKS,
} = {}) {
  allies = Math.max(0, Math.min(4, Number(allies) | 0));
  enemies = Math.max(0, Math.min(5, Number(enemies) | 0));
  const pool = tanks.filter((id) => id !== humanTankId && NATIVE_TANKS.has(id));
  if (!pool.length) throw new RangeError('No PvP bot tank candidate');
  const rows = [];
  let objectId = 2;
  const add = (camp) => {
    rows.push({
      objectId, accountId: accountBase + objectId, camp,
      charUuid: `robot-pk-${objectId}`, name: `Bot ${objectId}`,
      level: 36, sex: 0, vipLevel: 6, eloSection: 1, preEloSection: 1,
      avatarId: 2801001, decorateId: 0, graduate: 0, elo: 1000, honorId: 0,
      boosterAttack: 0, militaryStar: 0, teamPlace: 0, teamName: '',
      tankId: pool[(objectId - 2) % pool.length], tankLevel: Math.max(1, Math.min(6, level | 0)),
      externalId: 0, haloId: 0, skinFrameType: 1, commandSkill: 0, ready: 1, battle: 0,
    });
    objectId += 1;
  };
  for (let i = 0; i < allies; i += 1) add(1);
  for (let i = 0; i < enemies; i += 1) add(2);
  return rows;
}

const frame = (id, writer) => encodeFrame(id, writer.finish());

function writePlayerBrief(w, p) {
  w.u32(p.accountId).string(p.charUuid || '').string(p.name || '')
    .u8(p.level ?? 1).u8(p.sex ?? 0).u8(p.vipLevel ?? 0)
    .u8(p.eloSection ?? 1).u8(p.preEloSection ?? 1)
    .u32(p.avatarId ?? 0).u32(p.decorateId ?? 0).u16(p.graduate ?? 0)
    .i16(p.elo ?? 1000).u32(p.honorId ?? 0).u32(p.boosterAttack ?? 0)
    .u32(p.militaryStar ?? 0).u32(p.teamPlace ?? 0).string(p.teamName || '');
}

function writeOtherBrief(w, p) {
  w.u32(p.tankId ?? 0).u8(p.tankLevel ?? 1).u8(p.tryTank ?? 0)
    .u32(p.btItemId ?? 0).u8(p.btRank ?? 0).u8(p.btLevel ?? 0).u8(p.btUpLevel ?? 0)
    .u32(p.btUpCost ?? 0).u32(p.btRankCost ?? 0).u32(p.honorId ?? 0)
    .u32(p.externalId ?? 0).u32(p.haloId ?? 0).u8(p.skinFrameType ?? 0)
    .u32(p.btAttack ?? 0).u32(p.tankPartScore ?? 0)
    .u32(p.commandSkill ?? 0).u32(p.sprayId ?? 0);
}

function writeCharBrief(w, c) {
  writePlayerBrief(w, c);
  writeOtherBrief(w, c);
  const buffs = c.buffs || [];
  w.u32(c.regionUid ?? 299001).u32(c.ip ?? 0).u8(c.camp ?? 1)
    .u16(buffs.length);
  for (const buff of buffs) w.u32(typeof buff === 'number' ? buff : buff.templateId);
}

function writeRoomCharBrief(w, c) {
  w.u8(c.ready ? 1 : 0).u8(c.battle ? 1 : 0);
  writeCharBrief(w, c);
}

function writeTankInfo(w, a) {
  const buffs = a.buffs || [];
  w.u32(a.objectId).u32(a.accountId).i16(a.x).i16(a.y)
    .i32(a.hp).i32(a.maxHp).u8(a.star ?? 0).u8(a.camp ?? 1)
    .string(a.name || '').u16(buffs.length);
  for (const buff of buffs) {
    w.u32(buff.templateId ?? buff).u32(buff.instanceId ?? buff)
      .u8(buff.stackCount ?? 1).u32(buff.casterId ?? a.objectId);
  }
  w.i16(a.lifeCount ?? -1).u32(a.battleExp ?? 0)
    .u8(a.battleLevel ?? 1).u8(a.tankLevel ?? 5)
    .i32(a.mp ?? 0).i32(a.maxMp ?? 0).i32(a.shield ?? 0);
}

function writeRoomInfo(w, r) {
  w.u32(r.roomId).u32(r.playerCount ?? 0).u32(r.maxPlayers ?? 10)
    .u32(r.mapId).u32(r.mode).u8(r.state ?? 0).u8(r.isValidate ?? 1)
    .u8(r.roomType ?? 2).string(r.name || '').u32(r.teamId ?? 0);
}

function writeSceneInfo(w, s) {
  w.u32(s.sceneId).u32(s.playerCount ?? 0).u32(s.maxPlayers ?? 10)
    .u32(s.mapId).u8(s.inBattle ?? 0).u8(s.roomType ?? 2)
    .u8(s.isObserverFull ?? 0).u32(s.startTime ?? 0).string(s.name || '');
}

export function s1724({ rooms = [], scenes = [], site = 0, roomType = 1 } = {}) {
  const w = new Writer().u16(rooms.length);
  for (const room of rooms) writeRoomInfo(w, room);
  w.u16(scenes.length);
  for (const scene of scenes) writeSceneInfo(w, scene);
  w.i32(site).u8(roomType);
  return frame(1724, w);
}

export function s1700(room, characters, observers = []) {
  const config = room.config || {};
  const w = new Writer()
    .u32(room.roomId).u32(room.creatorAccountId ?? room.ownerId ?? 0)
    .u8(room.maxPlayers ?? 10).u8(room.minPlayers ?? 2).u8(room.observerCapacity ?? 0)
    .u32(room.password ?? 0).string(room.name || '')
    .u8(room.state ?? 0).u8(room.roomType ?? 2).u32(room.mode ?? 3)
    .u32(config.mapId ?? room.mapId ?? 0).u8(config.banRobot ?? 0)
    .u8(config.tankAvailableLevel ?? 0).u8(config.ladderMin ?? 0).u8(config.ladderMax ?? 0)
    .u16(characters.length);
  for (const character of characters) writeRoomCharBrief(w, character);
  w.u16(observers.length);
  for (const observer of observers) writeRoomCharBrief(w, observer);
  return frame(1700, w);
}

export function s1701(op, startAccountId, target = 0) {
  return frame(1701, new Writer().u8(op).u32(startAccountId).u32(target));
}

export function s1705({
  sceneId, mapId, roomType = 2, characters = [], backData = [], enterType = 0,
}) {
  const w = new Writer().u32(sceneId).u32(mapId).u8(roomType)
    .u16(characters.length);
  for (const character of characters) writeCharBrief(w, character);
  w.u16(backData.length);
  for (const value of backData) w.u32(value);
  w.u8(enterType);
  return frame(1705, w);
}

export function s1707(errorId, sceneId, accountId, exitType = 2, isObserver = 0) {
  return frame(1707, new Writer().u32(errorId).u32(sceneId).u32(accountId)
    .u32(exitType).u32(isObserver));
}

export function s1709(accountId, delay = 15, loaded = 100) {
  return frame(1709, new Writer().u32(accountId).u32(delay).u32(loaded));
}

export function s1711(player, other) {
  const w = new Writer();
  writePlayerBrief(w, player);
  writeOtherBrief(w, other);
  return frame(1711, w);
}

export function s1721({
  sceneId, mapId, roomType = 2, characters = [], lockedAccountIds = [],
  remainingSeconds = SELECT_SECONDS,
}) {
  const w = new Writer().u32(sceneId).u32(mapId).u8(roomType)
    .u16(characters.length);
  for (const character of characters) writeCharBrief(w, character);
  w.u16(lockedAccountIds.length);
  for (const id of lockedAccountIds) w.u32(id);
  w.u32(remainingSeconds);
  return frame(1721, w);
}

export function s1727({
  accountId, tankId, containerType = 0, externalId = 0, skinFrameType = 0,
  commandSkill = 0,
}) {
  return frame(1727, new Writer().u32(accountId).u32(tankId).u32(containerType)
    .u32(externalId).u32(skinFrameType).u32(commandSkill));
}

export function s1728(accountId, tankId, containerType = 0) {
  return frame(1728, new Writer().u32(accountId).u32(tankId).u32(containerType));
}

export function s1017() {
  return encodeFrame(1017);
}

export function s1586(startTime = 0, overtime = 0) {
  return frame(1586, new Writer().u32(startTime).u8(overtime));
}

export function s1550(self, {
  fireRate = 500, speed = 240, skills = [], items = [], kills = 0, deaths = 0, assists = 0,
} = {}) {
  const w = new Writer();
  writeTankInfo(w, self);
  w.i16(fireRate).i16(speed).u16(skills.length);
  for (const skill of skills) {
    w.u32(skill.skillId).u8(skill.slot).number('setInt8', 1, skill.count ?? -1, -128, 127)
      .u32(skill.endTimeLow ?? 0).u32(skill.endTimeHigh ?? 0)
      .u32(skill.nextChargeLow ?? 0).u32(skill.nextChargeHigh ?? 0);
  }
  w.u16(items.length);
  for (const item of items) {
    w.u32(item.templateId).i32(item.count ?? 0).u8(item.bind ?? 0).i32(item.lifetime ?? 0);
  }
  w.u8(kills).u8(deaths).u8(assists);
  return frame(1550, w);
}

export function s1551(actors) {
  const w = new Writer().u16(actors.length);
  for (const actor of actors) writeTankInfo(w, actor);
  return frame(1551, w);
}

/** Empty S1561 is the native objects-ready marker used by combat_state.js. */
export function s1561(actors = []) {
  const w = new Writer().u16(actors.length);
  for (const actor of actors) {
    const stats = actor.stats || [];
    w.u32(actor.accountId).u16(stats.length);
    for (const value of stats) w.i32(value);
    w.u8(actor.battleLevel ?? 1);
  }
  return frame(1561, w);
}

/**
 * Minimal battle entry snapshot. Spawns are placeholders, not map19 spawn data:
 * the actual PvP arena belongs to M5. This only satisfies M3's S1586/S1550/
 * S1551 wait and marks combat_state objectsReady through an empty S1561.
 */
export function battleEntryFrames({
  sceneId, mapId, roomType = 2, characters, selfAccountId, startTime = 0,
}) {
  if (!characters.some((c) => c.accountId === selfAccountId)) {
    throw new RangeError('S1705 roster is missing the authenticated account');
  }
  const actors = characters.map((c) => ({
    objectId: c.objectId, accountId: c.accountId, camp: c.camp,
    x: c.camp === 1 ? 360 + c.objectId * 40 : 1660 - (c.objectId - 5) * 40,
    y: 480 + ((c.objectId - 1) % 5) * 80,
    hp: 1000, maxHp: 1000, star: 0, name: c.name,
    buffs: [], lifeCount: -1, battleExp: 0, battleLevel: 1,
    tankLevel: c.tankLevel, mp: 100, maxMp: 100, shield: 0,
  }));
  const self = actors.find((a) => a.accountId === selfAccountId);
  return [
    s1586(startTime, 0),
    s1550(self),
    s1551(actors.filter((a) => a.accountId !== selfAccountId)),
    s1561([]),
  ];
}

/** rooms-v1 status reply. The static server keeps room state native. */
export function s60007(action, requestId, extra = {}) {
  const value = {
    v: 1, ok: true, action, request_id: requestId,
    server_time_ms: extra.serverTimeMs ?? Date.now(),
    room: extra.room ?? null,
    online: extra.online ?? [],
    invites: extra.invites ?? [],
    queue: extra.queue ?? { active: false, status: 'idle', wait_remaining_ms: 0 },
  };
  return encodeFrame(ROOMS_REPLY, new Writer().string(JSON.stringify(value)).finish());
}

export const PHASE = Object.freeze({
  LOBBY: 'lobby', ROOM: 'room', SELECTING: 'selecting',
  LOADING: 'loading', SCENE: 'scene',
});

export class PvpRoom {
  constructor({ player = {}, room = {}, bots = null } = {}) {
    this.player = { ...OFFLINE_PLAYER, ...player };
    this.roomId = room.roomId ?? BOT_ROOM.roomId;
    this.mapId = MAP_BY_ID.has(Number(room.mapId)) ? Number(room.mapId) : BOT_ROOM.mapId;
    this.modeName = MAP_BY_MODE.has(room.mode) ? room.mode
      : (MAP_BY_ID.get(this.mapId)?.mode ?? 'pk_robo');
    this.roomName = room.name || botRoomName(this.modeName, this.mapId);
    this.bots = Array.isArray(bots) ? bots : defaultBots({
      allies: room.allies ?? 4, enemies: room.enemies ?? 5,
      level: room.botLevel ?? this.player.tankLevel,
      humanTankId: this.player.tankId,
    });
    this.phase = PHASE.LOBBY;
    this.room = null;
    this.ready = false;
    this.tankId = this.player.tankId;
    this.tankLevel = this.player.tankLevel;
    this.sceneId = null;
    this.selection = null;
  }

  snapshot() {
    return {
      phase: this.phase, roomId: this.roomId,
      room: this.room ? { ...this.room, config: { ...this.room.config } } : null,
      ready: this.ready, tankId: this.tankId, sceneId: this.sceneId,
      selection: this.selection ? { ...this.selection } : null,
      bots: this.bots.length,
    };
  }

  hallRoom() {
    const row = MAP_BY_MODE.get(this.modeName) || MAP_BY_ID.get(this.mapId) || DEFAULT_MAP;
    return {
      roomId: this.roomId, playerCount: 1, maxPlayers: 10,
      mapId: this.room?.config.mapId ?? this.mapId,
      mode: this.room?.mode ?? modeNumber(row),
      state: 0, isValidate: 1, roomType: 2,
      name: this.room?.name ?? this.roomName, teamId: 0,
    };
  }

  _appearance(tankId = this.tankId) {
    const known = this.player.externals?.[tankId];
    if (known != null) {
      return { externalId: known, skinFrameType: this.player.skinFrameType ?? 0 };
    }
    if (tankId === this.player.tankId) {
      return {
        externalId: this.player.externalId ?? 0,
        skinFrameType: this.player.skinFrameType ?? 0,
      };
    }
    return { externalId: 0, skinFrameType: 0 };
  }

  _self() {
    const look = this._appearance();
    return {
      ...this.player, objectId: 1, camp: 1,
      tankId: this.tankId, tankLevel: this.tankLevel,
      externalId: look.externalId, skinFrameType: look.skinFrameType,
      commandSkill: 0, ready: this.ready ? 1 : 0, battle: 0,
    };
  }

  characters() {
    return [this._self(), ...this.bots];
  }

  _lockedAccountIds() {
    return this.bots.map((bot) => bot.accountId);
  }

  _reset() {
    this.phase = PHASE.LOBBY;
    this.room = null;
    this.ready = false;
    this.selection = null;
    this.sceneId = null;
    this.tankId = this.player.tankId;
    this.tankLevel = this.player.tankLevel;
  }

  _open({ mapId, modeName, name, joined }) {
    const row = MAP_BY_ID.get(Number(mapId)) || DEFAULT_MAP;
    this.mapId = row.mapId;
    this.modeName = modeName && MAP_BY_MODE.has(modeName) ? modeName : row.mode;
    const roomName = name || botRoomName(this.modeName, row.mapId);
    this.roomName = roomName;
    this.room = {
      roomId: this.roomId, creatorAccountId: this.player.accountId,
      maxPlayers: 10, minPlayers: 2, observerCapacity: 0, password: 0,
      name: roomName, state: 0, roomType: 2, mode: modeNumber(row),
      config: { mapId: row.mapId, banRobot: 0, tankAvailableLevel: 0, ladderMin: 0, ladderMax: 0 },
    };
    this.phase = PHASE.ROOM;
    this.ready = !joined;
    this.selection = null;
    this.sceneId = null;
    this.tankId = this.player.tankId;
    this.tankLevel = this.player.tankLevel;
    return s1700(this.room, this.characters());
  }

  _create(payload) {
    const r = new Reader(payload, 600);
    let roomType = 1, mapId = 0, name = '';
    if (r.remaining >= 1) roomType = r.u8();
    if (r.remaining >= 1) r.u8(); // numeric mode: the chosen map owns the mode
    if (r.remaining >= 4) mapId = r.u32();
    if (r.remaining >= 4) r.u32(); // password
    if (r.remaining >= 2) name = [...r.string()].slice(0, 80).join('');
    // itemId and any tail are not used by the native room flow.
    // roomType 4 / map >= 200 is the solo PvE path; let the worker keep it.
    if (roomType === 4 || mapId >= 200) return [];
    const row = MAP_BY_ID.get(mapId);
    return [this._open({
      mapId: row ? row.mapId : BOT_ROOM.mapId,
      modeName: row?.mode,
      name: name || botRoomName(row?.mode ?? 'pk_robo', row?.mapId ?? BOT_ROOM.mapId),
      joined: false,
    })];
  }

  _join(payload) {
    const r = new Reader(payload, 601);
    const roomId = r.u32();
    r.u8(); r.u8(); // requested room type / numeric mode: the hall row owns both.
    const mapId = r.u32();
    if (roomId !== this.roomId) return [];
    if (this.phase !== PHASE.LOBBY) return [];
    const row = MAP_BY_ID.get(mapId);
    return [this._open({
      mapId: row ? row.mapId : this.mapId,
      modeName: row?.mode ?? this.modeName,
      name: this.hallRoom().name,
      joined: true,
    })];
  }

  _readyOperation(payload) {
    const r = new Reader(payload, 602);
    const op = r.u8();
    if (op === 1 || op === 20) return this._leaveFrames();
    if (op !== 2 && op !== 3) return [];
    if (this.phase !== PHASE.ROOM) return [];
    this.ready = op === 2;
    return [s1701(op, this.player.accountId, this.player.accountId)];
  }

  _start(payload) {
    if (payload.length >= 1 && payload[0] === 9) return []; // ranked C610 form
    if (this.phase !== PHASE.ROOM || !this.ready) return [];
    this.phase = PHASE.SELECTING;
    this.ready = false;
    this.selection = {
      sceneId: this.roomId, mapId: this.room.config.mapId,
      roomType: this.room.roomType, remainingSeconds: SELECT_SECONDS,
      lockedAccountIds: this._lockedAccountIds(),
    };
    return [s1721({
      sceneId: this.selection.sceneId, mapId: this.selection.mapId,
      roomType: this.selection.roomType, characters: this.characters(),
      lockedAccountIds: this.selection.lockedAccountIds,
      remainingSeconds: this.selection.remainingSeconds,
    })];
  }

  _select(payload) {
    if (this.phase !== PHASE.SELECTING) return [];
    const r = new Reader(payload, 215);
    const sceneId = r.u32(), tankId = r.u32(), containerType = r.u32(), roomType = r.u8();
    if (sceneId !== this.roomId || roomType !== this.room?.roomType) return [];
    if (containerType !== 0 || !NATIVE_TANKS.has(tankId)) return [];
    this.tankId = tankId;
    if (this.selection) {
      this.selection.selectedTankId = tankId;
      this.selection.lockedAccountIds = this._lockedAccountIds();
    }
    const look = this._appearance();
    const self = this._self();
    return [
      s1711(self, self),
      s1727({
        accountId: this.player.accountId, tankId, containerType: 0,
        externalId: look.externalId, skinFrameType: look.skinFrameType, commandSkill: 0,
      }),
    ];
  }

  _confirm(payload) {
    if (this.phase !== PHASE.SELECTING) return [];
    const sceneId = new Reader(payload, 614).u32();
    if (sceneId !== this.roomId) return [];
    this.phase = PHASE.LOADING;
    this.sceneId = this.roomId;
    const frames = [
      s1728(this.player.accountId, this.tankId, 0),
      s1705({
        sceneId: this.sceneId, mapId: this.room.config.mapId,
        roomType: this.room.roomType, characters: this.characters(),
        backData: [], enterType: 0,
      }),
    ];
    this.selection = null;
    return frames;
  }

  _loaded(payload) {
    if (this.phase !== PHASE.LOADING) return [];
    const r = new Reader(payload, 605);
    const sceneId = r.u32(), accountId = r.u32(), delay = r.u32(), loaded = r.u32();
    if (sceneId !== this.sceneId || accountId !== this.player.accountId) return [];
    return [s1709(accountId, delay || 15, loaded)];
  }

  _enter(payload) {
    if (this.phase !== PHASE.LOADING) return [];
    const sceneId = new Reader(payload, 552).u32();
    if (sceneId !== this.sceneId) return [];
    this.phase = PHASE.SCENE;
    return battleEntryFrames({
      sceneId: this.sceneId, mapId: this.room.config.mapId,
      roomType: this.room.roomType, characters: this.characters(),
      selfAccountId: this.player.accountId,
    });
  }

  _leaveFrames() {
    const battle = this.phase === PHASE.LOADING || this.phase === PHASE.SCENE;
    const frames = battle
      ? [s1707(0, this.sceneId || this.roomId, this.player.accountId, 2, 0), s1017()]
      : [s1701(1, this.player.accountId, this.player.accountId), s1017()];
    this._reset();
    return frames;
  }

  _exit(payload) {
    if (this.phase === PHASE.LOBBY) return [];
    if (this.phase !== PHASE.SELECTING && payload.length >= 4) {
      const sceneId = new Reader(payload, 509).u32();
      if (sceneId !== (this.sceneId || this.roomId)) return [];
    }
    return this._leaveFrames();
  }

  _roomsV1(payload) {
    let value;
    try {
      value = JSON.parse(new Reader(payload, ROOMS_REQUEST).string());
    } catch {
      return [];
    }
    if (!value || value.v !== 1 || typeof value.action !== 'string'
      || typeof value.request_id !== 'string') return [];
    if (!['status', 'subscribe', 'list'].includes(value.action)) return [];
    return [s60007(value.action, value.request_id)];
  }

  handleMessage(msgId, payload = new Uint8Array()) {
    switch (msgId) {
      case 607: return [s1724({ rooms: [this.hallRoom()] })];
      case 600: return this._create(payload);
      case 601: return this._join(payload);
      case 602: return this._readyOperation(payload);
      case 610: return this._start(payload);
      case 215: return this._select(payload);
      case 614: return this._confirm(payload);
      case 605: return this._loaded(payload);
      case 552: return this._enter(payload);
      case 509:
      case 611:
      case 613: return this._exit(payload);
      case ROOMS_REQUEST: return this._roomsV1(payload);
      default: return [];
    }
  }

  /** Accept a complete Sixcube frame and return complete reply frames. */
  handle(frameBytes) {
    if (!(frameBytes instanceof Uint8Array) || frameBytes.length < 8) {
      throw new RangeError('Truncated client frame');
    }
    const size = frameBytes[0] | (frameBytes[1] << 8);
    const msgId = frameBytes[2] | (frameBytes[3] << 8);
    if (size < 8 || size > frameBytes.length) throw new RangeError('Bad client frame length');
    return this.handleMessage(msgId, frameBytes.subarray(8, size));
  }
}
