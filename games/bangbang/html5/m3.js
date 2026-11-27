import {LobbyConnection, webRequest} from './net.js';
import {encodeHallRequest, encodeCreateRoom, encodeJoinRoom, encodeRoomOp,
  encodeStartMatch, encodeSelectTank, encodeConfirmTank} from './room_protocol.js';
import {encodeLoadProgress, encodeBattleEnter, encodeExitBattle} from './scene_protocol.js';

// Presentation state only. Every transition below follows a native reply.
// No browser timer starts combat and no game action is simulated here.
function emptyPlay() {
  return {phase: 'lobby', busy: '', error: '', message: 'Chọn thiết lập bot và vào phòng.',
    hallReceived: false, rooms: [], room: null, selection: null, scene: null,
    setup: null, lastExit: null};
}

function brief(value) {
  return {accountId: value.player.accountId, name: value.player.name,
    vipLevel: value.player.vipLevel,
    tankId: value.other.tankId, tankLevel: value.other.tankLevel,
    externalId: value.other.externalId, skinFrameType: value.other.skinFrameType,
    haloId: value.other.haloId,
    btItemId:value.other.btItemId,btRank:value.other.btRank,btLevel:value.other.btLevel,btAttack:value.other.btAttack,
    btUpLevel:value.other.btUpLevel,btUpCost:value.other.btUpCost,btRankCost:value.other.btRankCost,
    commandSkill: value.other.commandSkill, camp: value.camp,
    ready: value.ready ?? 0, battle: value.battle ?? 0};
}

export class M3Connection extends LobbyConnection {
  emptyState() { return {...super.emptyState(), play: emptyPlay()}; }

  snapshot() {
    // Return a detached diagnostic snapshot: no socket, credentials, room
    // password, old captured hall names, or raw packets escape this interface.
    return structuredClone({...super.snapshot(), play: this.state.play});
  }

  async connect(credentials = null, automatic = false) {
    const expectedGeneration = this.generation + 1;
    this.hallAfter = null;
    const ok = await super.connect(credentials, automatic);
    if (!ok || this.generation !== expectedGeneration) return false;
    // Optional settings must not block resuming an already acknowledged scene.
    const settingsTask = webRequest('/api/bots/get').then(settings => {
      if (this.generation !== expectedGeneration) return;
      if (!settings.success) throw new Error(settings.message || 'Không đọc được thiết lập bot.');
      this.state.play.setup = settings.setup;
      this.update();
    }).catch(error => {
      if (this.generation === expectedGeneration) { this.state.play.error = error.message; this.update(); }
    });
    try {
      // C165 may already have delivered a saved selection or scene. Never
      // overwrite it with a default lobby after the M2 handshake completes.
      if (this.state.play.phase === 'loading') await this.enterScene();
      else if (this.state.play.phase === 'lobby') await this.refreshHall();
      this.update();
    } catch (error) {
      if (this.generation === expectedGeneration) {
        this.state.play.error = error.message;
        this.update();
      }
    }
    await settingsTask;
    return this.generation === expectedGeneration;
  }

  receive(packet, role, generation) {
    if (generation !== this.generation) return;
    if (role === 'GATE') this.receivePlay(packet, generation);
    super.receive(packet, role, generation);
  }

  receivePlay(packet, generation) {
    const p = this.state.play;
    const mine = this.state.accountId;
    switch (packet.type) {
      case 'hall':
        // C72 includes historical captured S1724. Only show the response to
        // this connection's explicit C607, and require its exact current shape.
        if (this.hallAfter == null || packet.sequence <= this.hallAfter) break;
        if (packet.trailingBytes) throw new Error('S1724 mới có phần đuôi chưa xác minh.');
        p.rooms = packet.rooms.map(({password, ...room}) => room);
        p.hallReceived = true;
        this.hallAfter = null;
        break;
      case 'roomEntered':
        p.room = {roomId: packet.roomId, creatorAccountId: packet.creatorAccountId,
          mapId: packet.config.mapId, roomType: packet.roomType, name: packet.name,
          mode: packet.mode, maxPlayers: packet.maxPlayers, minPlayers: packet.minPlayers,
          characters: packet.characters.map(brief), observers: packet.observers.map(brief)};
        p.phase = 'room'; p.selection = null; p.scene = null;
        p.lastExit = null;
        p.message = 'Đã vào phòng. Sẵn sàng rồi mở bước chọn tank cho trận.';
        break;
      case 'roomOp': {
        if ([1,20].includes(packet.op) && (packet.target === mine || packet.op === 1 && packet.startAccountId === mine)) {
          this.returnToLobby(packet.op===20?'Bạn đã được mời rời phòng.':'Đã rời phòng.', {kind: 'room', accountId: mine});
        } else if (p.room && [2, 3].includes(packet.op)) {
          const char = p.room.characters.find(c => c.accountId === packet.startAccountId);
          if (char) char.ready = packet.op === 2 ? 1 : 0;
        }
        break;
      }
      case 'roomMap':
        if (p.room) p.room.mapId = packet.mapId;
        break;
      case 'prebattle': {
        const characters = packet.characters.map(brief);
        const self = characters.find(c => c.accountId === mine);
        if (!self) throw new Error('S1721 thiếu nhân vật đã xác thực.');
        if (p.room) Object.assign(p.room, {mapId: packet.mapId, roomType: packet.roomType, characters});
        p.phase = 'selecting'; p.scene = null;
        p.lastExit = null;
        p.selection = {sceneId: packet.sceneId, mapId: packet.mapId, roomType: packet.roomType,
          characters, selectedTankId: self.tankId, lockedAccountIds: packet.lockedAccountIds,
          remainingSeconds: packet.remainingSeconds,
          deadlineAt: Date.now() + packet.remainingSeconds * 1000};
        p.message = 'Chọn tank đang sở hữu. Server chốt tank khi xác nhận hoặc hết thời gian.';
        break;
      }
      case 'roomCharChanged': {
        for (const group of [p.room?.characters, p.selection?.characters]) {
          const char = group?.find(c => c.accountId === packet.player.accountId);
          if (char) Object.assign(char, brief({...packet, camp: char.camp, ready: char.ready}));
        }
        break;
      }
      case 'tankSelected':
        if (p.selection && packet.accountId === mine) {
          p.selection.selectedTankId = packet.tankId;
          p.selection.externalId = packet.externalId;
          p.selection.skinFrameType = packet.skinFrameType;
          p.message = 'Server đã xác nhận tank cho trận. Bấm Chốt tank để vào scene.';
        }
        break;
      case 'tankLocked':
        if (p.selection) {
          if (!p.selection.lockedAccountIds.includes(packet.accountId)) p.selection.lockedAccountIds.push(packet.accountId);
          if (packet.accountId === mine) p.selection.selectedTankId = packet.tankId;
        }
        break;
      case 'battleStart': {
        // A resume is a new connection/generation. Within one connection a
        // repeated start for this scene cannot reset an arena already entered.
        if (p.scene?.sceneId === packet.sceneId && p.scene.mapId === packet.mapId
            && ['loading', 'scene'].includes(p.phase)) break;
        const characters = packet.characters.map(brief);
        if (!characters.some(c => c.accountId === mine)) throw new Error('S1705 thiếu nhân vật đã xác thực.');
        p.phase = 'loading'; p.selection = null; p.lastExit = null;
        p.scene = {sceneId: packet.sceneId, mapId: packet.mapId, roomType: packet.roomType,
          enterType: packet.enterType, characters, received: {entered: false, self: false, others: false},
          self: null, actors: [], spawnActors: [], updateCount: 0, lastUpdateCounts: {},
          loadPercent: 0, startedAt: null};
        p.message = 'Server đã chốt đội hình. Đang nhận snapshot scene…';
        queueMicrotask(() => {
          if (generation === this.generation && this.state.phase === 'ready') {
            this.enterScene().catch(error => {
              if (generation === this.generation) { this.state.play.error = error.message; this.update(); }
            });
          }
        });
        break;
      }
      case 'roomLoaded':
        if (p.scene && packet.accountId === mine) p.scene.loadPercent = packet.loaded;
        break;
      case 'sceneEntered':
        if (p.scene) { p.scene.received.entered = true; p.scene.startedAt = packet.startTime; }
        break;
      case 'sceneSelf':
        if (p.scene) {
          if (packet.actor.accountId !== mine) throw new Error('S1550 không thuộc nhân vật đang đăng nhập.');
          p.scene.received.self = true;
          p.scene.self = this.actorWithTank(packet.actor);
          this.mergeActors([packet.actor]);
        }
        break;
      case 'sceneOthers':
        if (p.scene) { p.scene.received.others = true; this.mergeActors(packet.actors); }
        break;
      case 'sceneAdd':
        if (p.scene) this.mergeActors([packet.actor]);
        break;
      case 'sceneUpdate':
        if (p.scene) {
          p.scene.updateCount += 1;
          p.scene.lastUpdateCounts = Object.fromEntries(['moves', 'fires', 'skills', 'hp', 'npcDeaths',
            'mp', 'blownBullets', 'removedObjects', 'expiredBullets', 'shields'].map(key => [key, packet[key].length]));
        }
        break;
      case 'sceneExit':
        if (packet.accountId === mine) {
          if (packet.errorId) p.error = `Server từ chối rời scene (${packet.errorId}).`;
          else p.lastExit = {kind: 'scene', sceneId: packet.sceneId, accountId: mine, exitType: packet.exitType};
        }
        break;
      case 'backToMain':
        this.returnToLobby('Đã trở về sảnh. Có thể vào phòng tiếp theo.', p.lastExit || {kind: 'selection'});
        break;
      default:
        break; // Unregistered packets never block following frames or invent state.
    }
    if (p.phase === 'loading' && p.scene && Object.values(p.scene.received).every(Boolean)) {
      p.phase = 'scene';
      p.scene.spawnActors = structuredClone(p.scene.actors);
      p.message = 'Đã nhận scene thật và vị trí xuất hiện từ server.';
    }
  }

  actorWithTank(actor) {
    const char = this.state.play.scene.characters.find(c => c.accountId === actor.accountId);
    return {...actor, tankId: char?.tankId ?? null, externalId: char?.externalId ?? null,
      skinFrameType: char?.skinFrameType ?? null};
  }

  mergeActors(actors) {
    const scene = this.state.play.scene;
    for (const actor of actors) {
      const mapped = this.actorWithTank(actor);
      const index = scene.actors.findIndex(item => item.objectId === actor.objectId);
      if (index < 0) scene.actors.push(mapped); else scene.actors[index] = mapped;
    }
  }

  returnToLobby(message, lastExit) {
    Object.assign(this.state.play, {phase: 'lobby', room: null, selection: null, scene: null,
      hallReceived: false, rooms: [], message, lastExit});
  }

  async action(label, phases, callback) {
    const play = this.state.play;
    if (this.state.phase !== 'ready' || !this.gate) throw new Error('Hãy chờ kết nối hoàn tất.');
    if (!phases.includes(play.phase)) throw new Error('Thao tác không phù hợp với trạng thái server hiện tại.');
    if (play.busy) throw new Error('Đang chờ server xác nhận thao tác trước.');
    const generation = this.generation;
    const gate = this.gate;
    play.busy = label; play.error = ''; this.update();
    try {
      const result = await callback(gate, generation);
      if (generation !== this.generation) return null;
      return result;
    } catch (error) {
      if (generation !== this.generation) return null;
      play.error = error.message;
      throw error;
    } finally {
      if (generation === this.generation) { play.busy = ''; this.update(); }
    }
  }

  request(gate, frame, accept, description, timeout = 12000) {
    const after = gate.sequence;
    gate.send(frame);
    return gate.until(history => history.find(packet => packet.sequence > after && accept(packet)), description, timeout);
  }

  refreshHall() {
    return this.action('hall', ['lobby'], gate => {
      this.hallAfter = gate.sequence;
      return this.request(gate, encodeHallRequest(), p => p.type === 'hall' && !p.trailingBytes, 'danh sách phòng mới');
    });
  }

  saveBotSetup(setup) {
    return this.action('settings', ['lobby'], async (_gate, generation) => {
      const result = await webRequest('/api/bots/save', setup);
      if (!result.success) throw new Error(result.message || 'Server không nhận thiết lập bot.');
      if (generation === this.generation) {
        this.state.play.setup = result.setup;
        this.state.play.hallReceived = false;
        this.state.play.rooms = [];
        this.state.play.message = 'Đã lưu thiết lập bot trên server. Thiết lập áp dụng cho phòng mới.';
      }
    });
  }

  createRoom() {
    return this.action('create', ['lobby'], gate => this.request(gate,
      encodeCreateRoom({name: 'Phòng PK HTML5'}), p => p.type === 'roomEntered', 'xác nhận tạo phòng'));
  }

  joinRoom(roomId) {
    return this.action('join', ['lobby'], gate => {
      const room = this.state.play.rooms.find(room => room.roomId === roomId);
      if (!room || !this.state.play.hallReceived) throw new Error('Hãy tải lại danh sách phòng từ server.');
      return this.request(gate, encodeJoinRoom(room), p => p.type === 'roomEntered', 'xác nhận vào phòng');
    });
  }

  setReady(ready) {
    return this.action('ready', ['room'], gate => this.request(gate, encodeRoomOp(ready ? 2 : 3),
      p => p.type === 'roomOp' && p.op === (ready ? 2 : 3) && p.startAccountId === this.state.accountId,
      'trạng thái sẵn sàng'));
  }

  startMatch() {
    return this.action('start', ['room'], gate => this.request(gate,
      encodeStartMatch(this.state.play.room.roomType), p => p.type === 'prebattle', 'bước chọn tank'));
  }

  selectTank(tankId) {
    return this.action('select', ['selecting'], gate => {
      const owned = this.state.tanks.find(tank => tank.tankId === tankId && tank.containerType === 0);
      if (!owned) throw new Error('Tank này không có trong kho đang sở hữu.');
      const selection = this.state.play.selection;
      return this.request(gate, encodeSelectTank(selection.sceneId, tankId, 0, selection.roomType),
        p => (p.type === 'tankSelected' && p.accountId === this.state.accountId && p.tankId === tankId)
          || p.type === 'battleStart',
        'server xác nhận tank cho trận');
    });
  }

  confirmTank() {
    return this.action('confirm', ['selecting'], gate => this.request(gate,
      encodeConfirmTank(this.state.play.selection.sceneId), p => p.type === 'battleStart'
        ||p.type==='tankLocked'&&p.accountId===this.state.accountId, 'xác nhận chốt tank'));
  }

  async enterScene() {
    const play = this.state.play, scene = play.scene, gate = this.gate, generation = this.generation;
    if (!scene || play.phase !== 'loading' || this.state.phase !== 'ready' || !gate) return;
    if (this.loadingScene?.scene === scene) return this.loadingScene.promise;
    const task = (async () => {
      try {
      await this.request(gate, encodeLoadProgress(scene.sceneId, this.state.accountId,
        Math.max(0, this.state.latencyMs || 0), 100),
      p => p.type === 'roomLoaded' && p.accountId === this.state.accountId && p.loaded === 100,
      'xác nhận tải dữ liệu scene');
      if (generation !== this.generation || this.state.play.scene !== scene) return;
      const after = gate.sequence;
      gate.send(encodeBattleEnter(scene.sceneId));
      await gate.until(history => [1586, 1550, 1551].every(id =>
        history.some(p => p.sequence > after && p.msgId === id)), 'snapshot scene từ server', 30000);
      if (generation !== this.generation || this.state.play.scene !== scene) return;
      if (play.phase !== 'scene') throw new Error('Chưa nhận đủ snapshot scene hợp lệ.');
      this.update();
      } catch (error) {
        // A leave/reconnect supersedes this scene load. Its stale waiter must
        // not publish an error into the next room or the replacement session.
        if (generation === this.generation && this.state.play.scene === scene) throw error;
      }
    })();
    this.loadingScene = {scene, promise: task};
    return task;
  }

  async leaveRoom() {
    const generation = this.generation;
    await this.action('leave', ['room', 'selecting', 'loading', 'scene'], gate => {
      const play = this.state.play;
      if (play.phase === 'room') return this.request(gate, encodeRoomOp(1),
        p => p.type === 'roomOp' && p.op === 1 && p.startAccountId === this.state.accountId, 'rời phòng');
      // Native C509 handles both selection and battle. This also works when
      // the server deadline wins just before a selection cancel arrives.
      if (play.phase === 'selecting') return this.request(gate, encodeExitBattle(play.selection.sceneId),
        p => p.type === 'backToMain', 'hủy chọn tank và về sảnh');
      return this.request(gate, encodeExitBattle(play.scene.sceneId),
        p => p.type === 'backToMain', 'rời scene và về sảnh');
    });
    if (generation === this.generation && this.state.phase === 'ready'
        && this.state.play.phase === 'lobby') await this.refreshHall();
  }
}
