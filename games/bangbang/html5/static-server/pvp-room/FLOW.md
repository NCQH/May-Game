# M5 static-server PvP room flow (bots)

Scope: the native room → tank select → battle-start path the current client
(`M3Connection`/`M4Connection`) already understands, with the frames a static
JavaScript GATE worker must synthesize. Combat and settlement stay in the M5
arena; this document ends at scene entry and exiting the scene.

Sources:

- `games/bangbang/html5/room_protocol.js`, `scene_protocol.js`,
  `combat_protocol.js`, `m3.js`, `m4.js`, `m81337_connection.js`,
  `m81337_rooms_protocol.js`, `m89_pk_maps.js`, `m810_modes.js`, `app.js`.
- `/tmp/bang-poc/BangBang_Offline-main/server/multiplayer_gate.py`,
  `multiplayer_rooms.py`, `prebattle_selection.py`, `sixcube_server.py`
  (`serialize_*`, `make_*`), `bot_setup.py`.
- `games/bangbang/html5/static-server/frames.json` (captured AUTH/GATE replay).

## 1. Transport and two room APIs

Every frame is:

```
u16 size          payload length + 8, little-endian
u16 msgId         little-endian
u32 zero
payload
```

`encodeFrame`/`SixcubeStream` in `sixcube.js` own this header. All builders in
`pvp-room.js` return complete frames.

There are two concurrent room APIs:

1. **Native M3 packets** (C600/C601/C602/C607/C610/C215/C614/C605/C552/C509)
   move `state.play.phase` through `lobby → room → selecting → loading → scene`.
   `room_protocol.js`/`scene_protocol.js` decode the replies.
2. **rooms-v1 JSON** (`C60006`/`S60007`) is the small-server extension for
   shared rooms. `app.js` uses `M81337Connection`; on connect it calls
   `roomCommand('status')` (15 s timeout). If the reply has `room: null`,
   `isManagedWaitingRoom()` is false, so `createRoom`/`joinRoom` fall through to
   the native C600/C601 path, `setReady` falls through to native C602/S1701, and
   `leaveRoom` falls through to native C602/C509.

The static worker therefore needs both: answer `C60006 status` with a
`room: null` S60007 (otherwise connect stalls for 15 s), and implement the
native frames below.

## 2. End-to-end sequence

| Step | Client → server | Server → client | Client state / wait |
|---|---|---|---|
| Open PvP hall | C607 (empty) | **S1724** | `hallReceived`, `rooms[]` |
| Join bot room | C601 roomId/type/mode/map | **S1700** | `play.phase = room` |
| (or create room) | C600 roomType/mode/map/name | **S1700** | `play.phase = room` |
| Ready | C602 op=2 (or op=3) | **S1701** op, startAccountId=self | updates self.ready |
| Start | C610 roomType | **S1721** | `play.phase = selecting` |
| Select tank | C215 sceneId/tankId/container/roomType | **S1711** + **S1727** | waits S1727(self,tankId) |
| Lock / start | C614 sceneId | **S1728** + **S1705** | `play.phase = loading` |
| Load progress | C605 sceneId/account/delay/loaded | **S1709** | waits loaded === 100 |
| Enter scene | C552 sceneId | **S1586** + **S1550** + **S1551** (+ **S1561**) | `play.phase = scene` |
| Exit scene | C509 sceneId | **S1707** + **S1017** | `lastExit`, then lobby |
| Exit lobby/selection | C602 op=1 or C509/C611 | **S1701** op=1 + **S1017** | lobby |
| rooms-v1 status | C60006 JSON | **S60007** `room: null` | lets M81337 connect |

The client's `M3Connection` methods and their accept predicates:

- `refreshHall`: S1724 with no trailing bytes.
- `joinRoom`/`createRoom`: S1700 (`roomEntered`).
- `setReady`: S1701 `op === 2|3 && startAccountId === accountId`.
- `startMatch`: S1721 (`prebattle`).
- `selectTank`: S1727 `accountId === self && tankId === requested`, or S1705.
- `confirmTank`: S1705, or S1728 for self.
- `leaveRoom` (selecting): S1017; (scene): S1017 after S1707.

`M3Connection.receivePlay` requires S1721 to contain the authenticated account;
S1705 must too. S1724 must have zero trailing bytes (`hallAfter` freshness is
tracked by the session).

## 3. Bot room configuration

The capture in `frames.json` is a **PvE** room, not PvP:

- `room1700` decoded: room 1001, creator 30000797, max 1, min 1, ob 0,
  name `PvE — Lính đánh thuê gian ác`, roomType **4**, mode 1, map **201**,
  one char ready=1, account 30000797, uuid `multiplayer-char-30000797`,
  name `M2 Test`, level 36, vip 6, avatar 2801001, elo 1000, tank 10000044,
  tankLevel 5, external 10673, camp 1, region 299001.
- `battle1705` decoded: scene 1001, map 201, roomType **4**, one char,
  no back data, enterType 0.

The PvP bot room keeps that identity but uses the values
`multiplayer_gate._create` + `bot_setup.configure_room` produce for `pk_robo`:

| Field | Captured PvE | Static PvP bot room |
|---|---|---|
| roomId | 1001 | **1001** (same; Python shared rooms use 6-digit codes) |
| creator/owner | 30000797 | **30000797** |
| max / min / observers | 1 / 1 / 0 | **10 / 2 / 0** |
| name | PvE — … | **`PK Robo - 25 điểm / 4 phút`** |
| state | 0 | 0 |
| roomType | 4 | **2** (9 = ranked) |
| mode (numeric) | 1 | **3** |
| config.mapId | 201 | **19** |
| seats | 1 human | 1 human + 4 ally bots + 5 enemy bots |
| human tank | 10000044 Lv5 | same until C215 |
| bot object ids | — | 2..10 (human is 1) |
| bot acct ids | — | 88888886 + objectId |
| bot camps | — | 1,1,1,1 then 2,2,2,2,2 |

`bot_setup.configure_room` maps modes to numeric mode/roomType/name:

- PK maps: mapId per mode, `mode=3`, `roomType=2`, `PK <title> - 25 điểm /
  4 phút` (totem and polar use 3 phút 30 giây).
- Occupy maps: `mode=2`, `roomType=2`, `Chiếm cờ <name> - 1.000 điểm / 10 phút`.
- Base maps + escort: `mode=1`, `roomType=2`.
- Death maps: `mode=4`, `roomType=2`.
- `test_desert`: map 7, `mode=2`, `roomType=2`, `Phòng test tank - Việt Dã`.

`pvp-room.js` derives all of this from `m89_pk_maps.js` PK_MAPS and
`m810_modes.js` BATTLE_MAPS; `botRoomName()` mirrors the Python names.

## 4. Payload layouts

`str` is `u16 byteLength` + UTF-8 bytes. `vec<T>(n)` is `u16 count` + rows.
These are the exact layouts in `room_protocol.js` / `scene_protocol.js`; the
builders are validated against those decoders by `pvp-room.test.js`.

### C607 / S1724 hall

```
C607 payload: empty

S1724:
  u16 roomCount
  RoomInfo[roomCount]
  u16 sceneCount
  SceneInfo[sceneCount]
  i32 site
  u8  roomType            // hall type; Python sends 1

RoomInfo:
  u32 roomId, u32 playerCount, u32 maxPlayers, u32 mapId, u32 mode,
  u8 state, u8 isValidate, u8 roomType, str name, u32 teamId

SceneInfo:
  u32 sceneId, u32 playerCount, u32 maxPlayers, u32 mapId,
  u8 inBattle, u8 roomType, u8 isObserverFull, u32 startTime, str name
```

Python `multiplayer_gate` lists `hub.list_rooms()` (waiting, non-ranked) and
sends no scenes. Static advertises the one bot room with `playerCount = 1`
(humans only, matching `hub._public_room().human_count`; legacy
`sixcube_server` used `1 + len(bots)`).

### C600 / S1700 enter room

```
C600 payload:
  u8 roomType, u8 mode, u32 mapId, u32 password, str name, u32 itemId

S1700:
  u32 roomId, u32 creatorAccountId,
  u8 maxPlayers, u8 minPlayers, u8 observerCapacity, u32 password,
  str name, u8 state, u8 roomType, u32 mode,
  RoomConfig, u16 charCount, RoomCharBrief[], u16 observerCount, RoomCharBrief[]

RoomConfig:
  u32 mapId, u8 banRobot, u8 tankAvailableLevel, u8 ladderMin, u8 ladderMax

RoomCharBrief: u8 ready, u8 battle, CharBrief

CharBrief:
  PlayerBrief, OtherBrief, u32 regionUid, u32 ip, u8 camp,
  u16 buffCount, u32 buffIds[]

PlayerBrief:
  u32 accountId, str charUuid, str name, u8 level, u8 sex, u8 vipLevel,
  u8 eloSection, u8 preEloSection, u32 avatarId, u32 decorateId, u16 graduate,
  i16 elo, u32 honorId, u32 boosterAttack, u32 militaryStar, u32 teamPlace,
  str teamName

OtherBrief:
  u32 tankId, u8 tankLevel, u8 tryTank, u32 btItemId,
  u8 btRank, u8 btLevel, u8 btUpLevel, u32 btUpCost, u32 btRankCost,
  u32 honorId, u32 externalId, u32 haloId, u8 skinFrameType,
  u32 btAttack, u32 tankPartScore, u32 commandSkill, u32 sprayId
```

`CharBrief` is at least 104 bytes; `PlayerBrief` at least 43, `OtherBrief`
exactly 50. S1700 chars are sorted by server object id (human 1, bots 2..10).

### C601 / C602 / S1701

```
C601: u32 roomId, u8 roomType, u8 mode, u32 mapId, u32 password, u32 contestId
C602: u8 op, u32 target
      op 1 = leave, 2 = ready, 3 = cancel ready, 24 = enter scene
S1701: u8 op, u32 startAccountId, u32 target
```

Python `make_room_op(op, actor, profile)` puts the actor in `startAccountId`
and the subject in `target`; static uses `startAccountId = self, target = 0`
for ready (the client only checks `startAccountId`).

### C610 / S1721 prebattle

```
C610: u8 roomType                 // payload b'\x09' = rank queue
S1721:
  u32 sceneId, u32 mapId, u8 roomType,
  u16 charCount, CharBrief[],       // players + bots, no ready/battle bytes
  u16 lockedCount, u32 lockedAccountIds[],
  u32 remainingSeconds
```

Python `prebattle_selection.pair_payload` sets `sceneId = room_id`,
`remainingSeconds = ceil(selection_remaining_ms/1000)` (60), and locks every
bot account id in the lobby roster. The static worker does the same; the
human is not locked until C614.

### C215 / S1711 / S1727 / C614 / S1728

```
C215: u32 sceneId, u32 tankId, u32 containerType, u8 roomType
S1711: PlayerBrief, OtherBrief
S1727: u32 accountId, u32 tankId, u32 containerType,
       u32 externalId, u32 skinFrameType, u32 commandSkill
C614: u32 sceneId
S1728: u32 accountId, u32 tankId, u32 containerType
```

Validation from `prebattle_selection.select` + `multiplayer_gate`:
`sceneId === room_id`, `roomType === room.room_type`, `containerType === 0`,
tank is owned/supported, room is selecting, not locked, before the deadline.
Static validates scene/roomType/container and membership in `NATIVE_TANK_IDS`
(no Garage ownership store in the worker).

### S1705 battle start

```
S1705:
  u32 sceneId, u32 mapId, u8 roomType,
  u16 charCount, CharBrief[],
  u16 backCount, u32 backData[],
  u8 enterType
```

Python `make_start_game` sets `sceneId = config.scene_id || room_id`,
`roomType = 2` (9 ranked), `backData=[]`, `enterType=0`. The static worker
sends S1728 then S1705 from C614.

### C605 / S1709 scene load

```
C605: u32 sceneId, u32 accountId, u32 delay, u32 loaded
S1709: u32 accountId, u32 delay, u32 loaded
```

The client sends `loaded = 100` and waits for S1709 self with `loaded === 100`.
Python sends delay 15 for humans and 10 for bots.

### C552 / battle entry

```
C552: u32 sceneId

S1586: u32 startTime, u8 overtime

S1550: TankInfo self, i16 fireInterval, i16 speed,
       u16 skillCount, PropsInfo[],
       u16 itemCount, GivenItem[],
       u8 kills, u8 deaths, u8 assists

TankInfo:
  u32 objectId, u32 accountId, i16 x, i16 y, i32 hp, i32 maxHp,
  u8 star, u8 camp, str name, u16 buffCount, BuffInfo[],
  i16 lifeCount, u32 battleExp, u8 battleLevel, u8 tankLevel,
  i32 mp, i32 maxMp, i32 shield

BuffInfo:  u32 templateId, u32 instanceId, u8 stackCount, u32 casterId
PropsInfo: u32 skillId, u8 slot, i8 count,
           u32 endTimeLow, u32 endTimeHigh,
           u32 nextChargeLow, u32 nextChargeHigh
GivenItem: u32 templateId, i32 count, u8 bind, i32 lifetime

S1551: u16 actorCount, TankInfo[]

S1561: u16 actorCount, { u32 accountId, u16 statCount, i32 stats[],
                         u8 battleLevel }[]
```

The client's `M3Connection.enterScene` waits for S1586 + S1550 + S1551 by
message id after C552. `combat_state.js` sets `objectsReady` on S1561
(`sceneStats`), so a static entry should include an empty S1561 for map-object
readiness. Spawns in `pvp-room.js` are placeholders; real PvP spawn tables are
arena data.

### C509 / S1707 / S1017 exit

```
C509: u32 sceneId            // C611 and C613 have no payload
S1707: u32 errorId, u32 sceneId, u32 accountId, u32 exitType, u32 isObserver
S1017: empty
```

Python `_clear_local(battle_exit=True)` sends `(0, old_scene, profile, 2, 0)`
then S1017. In the waiting/selecting phase it sends S1701 op=1 +
S1017 instead. Static mirrors that.

### Result (M5, not this module)

`S1708` is decoded by `combat_protocol.js` as `battleEnd`:
`u32 sceneId, u32 mapId, u32 battleTime, u8 roomType, u8 winCamp, u8 winType,
i16 redLifeCount, i16 blueLifeCount, vec TankSettleInfo actors,
vec TankSettleInfo escaped, f32 serverExpRate, f32 tokenGoldRate,
u8 bpvpActOpen, u32 itemDropRate, u32 killerId, u32 assisterId, u32 kdaId,
u32 destroyerId, u32 victoryMvpId, u32 defeatMvpId, str sceneUuid`.
`static-server/pve-battle.js` `pack1708` is a PvE-shaped stub; do not reuse it
for PvP settlement without a real M5 result.

### rooms-v1 status

```
C60006 payload: str JSON   {v:1, request_id, action, ...}
S60007 payload: str JSON   {
  v:1, ok:true, action, request_id, server_time_ms,
  room:null, online:[], invites:[],
  queue:{active:false, status:'idle', wait_remaining_ms:0}
}
```

`m81337_rooms_protocol.js decodeRoomsPacket` validates this exact schema and
requires the JSON string to consume the whole payload.

## 5. Static state machine

`PvpRoom` in `pvp-room.js`:

| Internal phase | Accepted requests | Replies |
|---|---|---|
| `lobby` | C607, C600, C601, C60006 | S1724 / S1700 / S60007 |
| `room` | C607, C602 (2/3/1), C610, C60006 | S1724 / S1701 / S1721 / S60007 |
| `selecting` | C602(1), C215, C614, C509, C611, C60006 | S1701+S1017 / S1711+S1727 / S1728+S1705 / S1701+S1017 |
| `loading` | C605, C552, C509 | S1709 / S1586+S1550+S1551+S1561 / S1707+S1017 |
| `scene` | C509, C613 | S1707+S1017 |

Out-of-phase requests return `[]` rather than inventing a transition. Malformed
frames throw `RangeError` at the trust boundary.

## 6. Plugging into `static-server/worker.js`

```js
import { PvpRoom } from './pvp-room/pvp-room.js';

const pvp = new PvpRoom();       // one session per worker
const PVP_IDS = new Set([607, 600, 601, 602, 610, 215, 614, 605, 552,
                         509, 611, 613, 60006]);

// inside handle(role, data), before the existing PvE branches:
if (pvpActive && role === 'GATE' && PVP_IDS.has(msgIdOf(data))) {
  for (const frame of pvp.handle(data)) send(role, frame);
  return;
}
```

Notes:

- `pvp.handle(data)` takes the complete client frame (header included) and
  returns complete reply frames.
- The existing worker already intercepts C600/C602 for PvE. Route by an
  explicit PvP flag, or by C600 `roomType === 2` / a known PvP map; C600
  `roomType === 4` or `mapId >= 200` is left to PvE.
- Add C60006 **before** all room branches. It has no handler today, so
  `M81337Connection.connect` waits 15 s for the `status` reply.
- The static page's create dialog sends C600 with mapId 101 and the
  mode/map choice only goes to `POST /api/bots/save`, which `shim.js` answers
  outside the worker. The worker therefore cannot see the chosen map; it
  defaults to `pk_robo` (map 19). To honor the dialog, forward the setup to
  the worker (e.g. a `postMessage({type:'mode', ...})`) or encode the map in
  C600.
- S1709 must be sent after C605 and the S1586/S1550/S1551/S1561 snapshot after
  C552; the client sends C552 only after it accepts the S1709 self + 100.
- For result/exit, keep the M5 arena responsible for S1708/S1104; this module
  only owns S1707+S1017.

## 7. Missing assets and gaps

Assets checked in this workspace:

- PK map geometry is present for maps 1,4,17,18,20,21,34,35,36 via
  `m89_pk_catalog.json` (all `status:"ready"`, mapped files exist under
  `games/bangbang/rez/zh_CN/map/`).
- Map 19 (`pk_robo`) reuses the base `m6_asset_catalog.json`: source
  `zh_CN/map/data19.map` → `zh_CN/map/a9fb1422445cf72c13293cb5da09409f.map`
  (69,452 bytes, on disk), minimap/air marker in `m89_pk_catalog.hudMaps["19"]`.
  The m89 `maps` table intentionally omits 19.
- Objective maps 12,14,50,169,7,9,10,37,170,70 are in
  `m810_modes_catalog.json` (mapped files on disk); map 7 reuses the base m6
  `data7_c.map`, as the client comments state.
- No `m5_*` asset catalog exists. PvP presentation is the m89/m810 sidecars
  merged into the m6 catalog plus the existing tank/garage catalogs.

Gaps:

1. `frames.json` has **no S1724, S1721, S1727 or S1707 capture**. The captured
   `room1700`/`battle1705` are PvE roomType 4 / map 201. The PvP layouts here
   come from the Python `make_*`/`serialize_*` helpers and are validated with
   the real client decoders in `pvp-room.test.js`.
2. There is no PvP arena in the static worker: no map-19 navigation/spawn
   table, no bot AI, no S1564 tick producer, no PvP S1708/S1104 settlement.
   `pvp-room.js` only provides a minimal S1586/S1550/S1551/S1561 entry stub so
   M3 can reach `scene`; replace `battleEntryFrames` with the M5 arena's real
   entry packets when it lands.
3. Arbitrary tank appearances are not resolvable server-side: only the
   captured tank 10000044 has a known external id (10673). A different C215
   tank is sent with `externalId = 0`; the client falls back to catalog
   rendering. A server-side tank→external table is needed for exact skins.
4. The `/api/bots/save` setup (map/mode, bot counts, AI policy, levels) never
   reaches the worker in the static page. The default room is pk_robo with
   4 ally / 5 enemy Lv5 bots; other modes are supported by the builders but
   need a bridge to select them.
5. The current `worker.js` has no C60006 handler and already owns C600/C602
   for PvE. The routing flag/branch described in §6 is required before the
   static UI can open the PvP hall without a timeout.
