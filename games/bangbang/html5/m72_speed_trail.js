import {NativeBodyTurn, nativeForwardBodyDirection} from './m7_body_motion.js';
import {isNativeSpeedBuff} from './m72_status_presentation.js';

export const NATIVE_SPEED_TRAIL = Object.freeze({frameCount: 6, width: 150, height: 150,
  offsetX: -75, offsetY: -75, ticksPerFrame: 1, nominalTickMs: 1000 / 24,
  logical: 'zh_CN/tank/speed/speed.png'});
const bodyClass = body => body?.format === 'png-sheet' ? 'bitmap'
  : body?.format === 'swf-derived' ? 'swf' : 'none';
const bodyIdentity = body => `${bodyClass(body)}:${body?.componentId ?? 0}`;
const lifeOf = actor => `${actor?.objectId}:${actor?.lifeEpoch}`;
const eventOrder = (a, b) => a.at - b.at || a.packetOrder - b.packetOrder
  || a.sequence - b.sequence || a.kindOrder - b.kindOrder;

/** Current TankBodyBase speed child, separate from body-frame animation.
 * The renderer submits its returned frame with the original 150px geometry
 * inside the body filter/scale group and before the cannon group. No images,
 * gameplay values, actor fields or cannon angles are changed by this class.
 *
 * Construct with the initial/base body and snapshot direction. sample consumes
 * actual native buff callbacks + body begin/stop/front commands. A same-instance
 * AINpc refresh emits no callbacks and therefore does not reset this child.
 */
export class NativeSpeedTrail {
  constructor({body = null, direction = 8, at = 0, ctank = true,
    frameCount = NATIVE_SPEED_TRAIL.frameCount, tickMs = NATIVE_SPEED_TRAIL.nominalTickMs} = {}) {
    if (!(Number.isSafeInteger(frameCount) && frameCount > 0 && Number.isFinite(tickMs) && tickMs > 0))
      throw new TypeError('A native speed sheet and positive normal-tick period are required');
    this.frameCount = frameCount; this.tickMs = tickMs; this.ctank = ctank;
    this.initialDirection = direction; this.reset(body, direction, at);
  }

  reset(body, direction, at) {
    if (!Number.isFinite(at)) throw new TypeError('A finite presentation time is required');
    this.body = body; this.turn = new NativeBodyTurn(direction);
    this.life = null; this.sequence = 0; this.speedCount = 0; this.createdAt = null;
    this.exists = false; this.visible = false; this.running = false; this.frame = 0;
    this.rotation = 0; this.followingRotation = false; this.layer = 'over-body';
    this.lastAt = at; this.lastTick = Math.floor(at / this.tickMs);
    this.motionSeen = new Set(); this.faceSeen = new Set(); this.skillKey = null;
    this.historyGap = false; this.ready = true; this.reason = null; this.generation = 0;
  }

  advance(at) {
    at = Math.max(this.lastAt, at);
    const tick = Math.floor((at + 1e-8) / this.tickMs);
    if (this.exists && this.running) this.frame = (this.frame + Math.max(0, tick - this.lastTick)) % this.frameCount;
    this.lastTick = tick; this.lastAt = at;
    // SwfBodyView does not initialize the new speed Sprite's rotation. An
    // already-running Rotate starts writing it on its next update, however.
    if (this.exists && !this.followingRotation && this.turn.durationMs > 0
        && this.createdAt < this.turn.startedAt + this.turn.durationMs
        && at > Math.max(this.createdAt, this.turn.startedAt)) this.followingRotation = true;
    if (this.exists && this.followingRotation) this.rotation = this.turn.angleAt(at);
  }

  create(at, snapshot = false) {
    if (this.exists) return;
    this.exists = true; this.visible = false; this.running = false;
    this.frame = 0; this.createdAt = at; this.generation += 1;
    this.layer = snapshot && bodyClass(this.body) === 'swf' ? 'under-body' : 'over-body';
    this.followingRotation = bodyClass(this.body) === 'bitmap'
      || snapshot && bodyClass(this.body) === 'swf';
    // TankBodyView.initSpeedBuff copies the Rotate target; SwfBodyView inherits
    // the unrotated Sprite until setBodyRotation writes it.
    this.rotation = this.followingRotation ? this.turn.rotationAt(at) * Math.PI / 180 : 0;
  }

  release() {
    this.exists = this.visible = this.running = false;
    this.frame = 0; this.createdAt = null; this.rotation = 0; this.followingRotation = false;
  }

  buff(event, row) {
    if (!isNativeSpeedBuff(row)) return;
    if (event.operation === 'add') {
      if (!this.ctank || this.speedCount === 0) this.create(event.at, event.reason === 'snapshot');
      if (this.ctank) this.speedCount += 1;
    } else if (event.operation === 'remove') {
      if (this.ctank) this.speedCount = Math.max(0, this.speedCount - 1);
      // Ordinary AINpcObject has no m_speedBuffCount. Any matching REMOVE
      // releases the trail, even if another qualifying buff remains active.
      if (!this.ctank || this.speedCount === 0) this.release();
    }
  }

  animation(command) {
    if (!this.exists || bodyClass(this.body) === 'none') return;
    if (command.state === 'move' || command.state === 'rush') this.visible = this.running = true;
    else if (command.state === 'idle') this.visible = this.running = false;
    // addStaticEffect sets the body's proxy to FREEZE; it neither hides nor
    // stops the separate CAnimation speed child. Native stop commands still do.
  }

  front(command, at) {
    const before = this.turn.rotationAt(at);
    this.turn.setFront(command.direction, at, {delayFactor: command.delayFactor || 1,
      noTween: Number(this.body?.raw?.iReuseD) === 1, immediate: !!command.immediate});
    if (this.exists && (this.turn.durationMs > 0 || this.turn.to !== before)) {
      this.followingRotation = true; this.rotation = this.turn.angleAt(at);
    }
  }

  changeBody(next, at) {
    if (!next || bodyIdentity(next) === bodyIdentity(this.body)) return;
    const oldClass = bodyClass(this.body), nextClass = bodyClass(next);
    if (oldClass !== nextClass) {
      this.release(); // CTank keeps its counter while releasing the old view.
      this.turn = new NativeBodyTurn(8);
    } else if (nextClass === 'swf') {
      this.turn = new NativeBodyTurn(this.turn.direction);
      if (this.exists) {
        // onLoadBodyComplete appends the new holder above the surviving speed
        // child and calls setBodyRotation/setFront(direction,true).
        this.layer = 'under-body'; this.followingRotation = true;
        this.rotation = this.turn.angleAt(at);
      }
    }
    this.body = next;
  }

  sample({actor, position = {}, body, catalog, baseExternalId, now}) {
    if (!Number.isFinite(now)) throw new TypeError('A finite presentation time is required');
    const life = lifeOf(actor);
    if (this.life !== null && this.life !== life) this.reset(
      catalog?.appearances?.[String(baseExternalId)]?.body || body,
      actor?.ownerBodyDirectionAtSnapshot ?? actor?.bodyDirection ?? this.initialDirection,
      actor?.lastSnapshotAt ?? now);
    this.life = life;
    if (!actor || actor.dead || actor.removed) {
      this.release(); this.speedCount = 0; return this.snapshot();
    }
    const history = actor.buffPresentation?.nativeHistory
      || (Object.keys(actor.buffs || {}).length === 0 ? [] : null);
    if (!Array.isArray(history)) {
      this.ready = false; this.reason = 'native-buff-history-missing'; return this.snapshot();
    }
    const pending = history.filter(event => event.sequence > this.sequence && event.receivedAt <= now);
    if (pending.length && pending[0].sequence > this.sequence + 1) {
      this.historyGap = true; this.ready = false; this.reason = 'native-buff-history-gap';
      this.release(); // No guessed moving trail after lost creation/removal events.
    }
    const events = pending.map(event => ({...event, kind: 'buff', at: event.receivedAt,
      packetOrder: event.packetOrder ?? 0, kindOrder: 0}));
    const faces = position.bodyFacingCommands || [], motions = position.bodyAnimationCommands || [];
    for (const command of faces) if (command.startedAt <= now && !this.faceSeen.has(command.key)) {
      events.push({kind: 'front', at: command.startedAt, packetOrder: command.packetOrder ?? 0,
        sequence: command.sequence ?? 0, kindOrder: 1, command});
      this.faceSeen.add(command.key);
    }
    for (const command of motions) if (command.at <= now && !this.motionSeen.has(command.key)) {
      events.push({kind: 'animation', at: command.at, packetOrder: command.packetOrder ?? 0,
        sequence: command.sequence ?? 0, kindOrder: 2, command});
      this.motionSeen.add(command.key);
    }
    const direction = (Number(actor.objectId) >>> 26) === 0
      ? nativeForwardBodyDirection(actor.lastSkillAim, catalog?.skills || {}) : null;
    const skillKey = direction == null ? null : `${actor.lastSkillAim.receivedAt}:${actor.lastSkillAim.sourceSequence}`;
    if (skillKey && skillKey !== this.skillKey && actor.lastSkillAim.receivedAt <= now)
      events.push({kind: 'front', at: actor.lastSkillAim.receivedAt,
        packetOrder: actor.lastSkillAim.packetOrder ?? 0, sequence: 0, kindOrder: 1,
        command: {direction, delayFactor: 1}});
    this.skillKey = skillKey;
    events.sort(eventOrder);
    for (const event of events) {
      this.advance(event.at);
      if (event.kind === 'buff') {
        this.sequence = Math.max(this.sequence, event.sequence);
        const row = catalog?.buffs?.[String(event.templateId)];
        if (!row) { this.ready = false; this.reason = 'buff-template-missing'; continue; }
        this.buff(event, row);
        if (this.ctank && Number(row.nEffectType) === 55) {
          const external = event.operation === 'add' ? Number(row.fEffectValA) : baseExternalId;
          this.changeBody(catalog?.appearances?.[String(external)]?.body, event.at);
        }
      } else if (event.kind === 'front') this.front(event.command, event.at);
      else this.animation(event.command);
    }
    this.changeBody(body, now); this.advance(now);
    this.faceSeen = new Set(faces.filter(command => command.startedAt <= now).map(command => command.key));
    this.motionSeen = new Set(motions.filter(command => command.at <= now).map(command => command.key));
    return this.snapshot();
  }

  snapshot() {
    return {ready: this.ready, reason: this.reason, historyGap: this.historyGap,
      exists: this.exists, visible: this.visible && this.exists && this.ready,
      running: this.running, frame: this.frame, frameCount: this.frameCount,
      rotation: this.rotation, layer: this.layer, speedCount: this.speedCount,
      sequence: this.sequence, generation: this.generation, createdAt: this.createdAt,
      lastAt: this.lastAt, geometry: NATIVE_SPEED_TRAIL};
  }
}
