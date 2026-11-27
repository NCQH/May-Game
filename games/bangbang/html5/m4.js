import {M3Connection} from './m3.js';
import {createCombatState, applyCombatPacket, beginPredictedStep,
  visualPosition} from './combat_state.js';
import {encodeMoveForward, encodeUseSkill, encodeExitBattleEnd,
  encodeAutoBullet, encodeCacheSkillDestPos} from './combat_protocol.js';

/** M4 extends the verified room lifecycle; combat state is a separate view. */
export class M4Connection extends M3Connection {
  constructor(onChange, prepareScene = async () => ({supported: false})) {
    super(onChange);
    this.prepareSceneAssets = prepareScene;
    this.combat = null; this.sceneAssets = null; this.preparation = null;
    this.lastClock = null;
    this.inputStats = {sentMove: 0, sentSkill: 0, sentAutoBullet: 0, sentChannelAim: 0};
    this.getAim = () => null;
    this.prepareDynamicAssets = () => {};
  }

  emptyState() {
    const state = super.emptyState();
    state.play.render = {phase: 'idle', supported: false, message: ''};
    return state;
  }

  snapshot() {
    const snapshot = super.snapshot();
    snapshot.play.combat = this.combat ? structuredClone(this.combat) : null;
    snapshot.play.input = {...this.inputStats};
    return snapshot;
  }

  // DOM metadata is batched by app.js; the renderer reads combat directly on
  // RAF. Do not clone every map object and effect for each network frame.
  update(values = {}) { Object.assign(this.state, values); this.onChange(super.snapshot()); }

  async connect(credentials = null, automatic = false) {
    this.combat = null; this.sceneAssets = null; this.preparation = null; this.lastClock = null;
    this.inputStats = {sentMove: 0, sentSkill: 0, sentAutoBullet: 0, sentChannelAim: 0};
    return super.connect(credentials, automatic);
  }

  receivePlay(packet, generation) {
    const now = performance.now();
    if (packet.type === 'tick') this.lastClock = {packet, receivedAt: now};
    const previousScene = this.state.play.scene;
    super.receivePlay(packet, generation);
    const scene = this.state.play.scene;
    if (!scene) {
      this.combat = null; this.sceneAssets = null;
      this.state.play.render = {phase: 'idle', supported: false, message: ''};
      return;
    }
    if (scene !== previousScene || !this.combat || this.combat.sceneId !== scene.sceneId) {
      this.combat = createCombatState(scene, this.state.accountId, now);
      if (this.lastClock) applyCombatPacket(this.combat, this.lastClock.packet, this.lastClock.receivedAt);
    }
    applyCombatPacket(this.combat, packet, now);
    // A copied skill or dynamic summon can introduce a new source dependency.
    // Loading its art never blocks or changes the authoritative packet reducer.
    this.prepareDynamicAssets(packet, this.combat);
    if (packet.type === 'battleEnd' && packet.sceneId === scene.sceneId) {
      this.state.play.message = 'Server đã kết thúc trận. Xem kết quả rồi trở về sảnh.';
    }
    if (packet.type === 'autoBulletRequest') {
      // Native automatic-fire requests use C510; normal mouse fire uses C503.
      // Only reply with the current player's presentation and actual pointer.
      const aim = this.getAim(), self = this.combat.actors[this.combat.selfObjectId];
      if (this.canControl() && aim && self && !self.dead) {
        const from = visualPosition(self, now);
        this.gate.send(encodeAutoBullet(scene.sceneId, Math.trunc(from.x), Math.trunc(from.y),
          Math.trunc(aim.x), Math.trunc(aim.y)));
        this.inputStats.sentAutoBullet += 1;
      }
    }
  }

  async enterScene() {
    const scene = this.state.play.scene, generation = this.generation;
    if (!scene || this.state.play.phase !== 'loading') return super.enterScene();
    if (this.preparation?.scene === scene) return this.preparation.promise;
    const task = {scene, promise: null};
    task.promise = (async () => {
      this.state.play.render = {phase: 'loading', supported: false,
        message: 'Đang tải bản đồ và hình ảnh của đội hình…'};
      this.update();
      try {
        const prepared = await this.prepareSceneAssets(scene, this.state.accountId);
        if (generation !== this.generation || scene !== this.state.play.scene) return null;
        this.sceneAssets = prepared;
        this.state.play.render = {phase: 'ready', supported: !!prepared.supported,
          message: prepared.message || ''};
        this.update();
        return await super.enterScene();
      } catch (error) {
        // A stale asset failure must not reach M3's current-session action
        // catch and replace a newer scene/lobby message in the same generation.
        if (generation !== this.generation || scene !== this.state.play.scene) return null;
        this.state.play.render = {phase: 'error', supported: false, message: error.message};
        this.update();
        throw error;
      }
    })();
    this.preparation = task;
    return task.promise;
  }

  canControl() {
    return this.state.phase === 'ready' && this.state.play.phase === 'scene'
      && this.state.play.render?.supported && this.state.play.render.phase === 'ready'
      && !!this.gate && !!this.combat?.objectsReady && !this.combat.result;
  }

  move(direction, geometry, now = performance.now()) {
    if (!this.canControl()) return null;
    const step = beginPredictedStep(this.combat, direction, now, geometry);
    if (!step) return null;
    this.gate.send(encodeMoveForward(step.sceneId, step.startX, step.startY, step.direction));
    this.inputStats.sentMove += 1;
    return step;
  }

  useSkill(slot, targetId, x, y) {
    if (!this.canControl()) return false;
    const self = this.combat.actors[this.combat.selfObjectId];
    if (!self || self.dead || ![0, 1, 2, 4, 10].includes(slot)) return false;
    if (slot === 4 && !this.combat.skills?.[String(self.objectId)]?.['4']) return false;
    // The server accepts/rejects cost, target, range, collision and cooldown.
    this.gate.send(encodeUseSkill(this.combat.sceneId, targetId, slot, Math.trunc(x), Math.trunc(y)));
    this.inputStats.sentSkill += 1;
    return true;
  }

  cacheSkillDestination(x, y) {
    if (!this.canControl()) return false;
    const self = this.combat.actors[this.combat.selfObjectId];
    if (!self || self.dead || ![x, y].every(Number.isFinite)) return false;
    x = Math.trunc(x); y = Math.trunc(y);
    if (![x, y].every(value => value >= -32768 && value <= 32767)) return false;
    // IronManActions.handle C514 reads <Ihh>. SelfTimmingSkillCaster projects
    // 2000 units along the cannon; these aim points may lie outside the map.
    this.gate.send(encodeCacheSkillDestPos(this.combat.sceneId, x, y));
    this.inputStats.sentChannelAim += 1;
    return true;
  }

  closeResult() {
    if (!this.combat?.result) throw new Error('Chưa nhận kết quả trận từ server.');
    const generation = this.generation;
    return this.action('result', ['scene'], async gate => {
      await this.request(gate, encodeExitBattleEnd(), p => p.type === 'backToMain', 'trở về sảnh sau trận');
      // action() owns the busy flag; fresh hall can be requested after it clears.
      if (generation === this.generation) this.state.play.message = 'Đã về sảnh sau trận đấu.';
    });
  }
}
