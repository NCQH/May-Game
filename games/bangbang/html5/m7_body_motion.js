/* Native tank-body presentation only. This module never moves actors, rotates
 * cannons, decides hits, or changes server gameplay state.
 * Current TankLib.dat: TankBodyView/SwfBodyView.setFront, TankTool.getAngleTo,
 * BmpBodyStateProxy and CAnimation. See evidence/source_body in the release.
 */

export const NATIVE_BODY_TICK_MS = 1000 / 24;
export const NATIVE_BODY_TURN_MS = 250;

const normalize = angle => ((angle % 360) + 360) % 360;
const requireTime = value => {
  if (!Number.isFinite(value)) throw new TypeError('A finite presentation time is required');
};

/** Exact TankTool.getAngleTo branches, including its half-turn tie choices.
 * DirectionType: NW0,N1,NE2,E3,SE4,S5,SW6,W7,NONE8.
 * The caller passes int(CMath.formatAngle(currentRotation)), as Flash does.
 */
export function nativeBodyTargetAngle(fromDegrees, direction) {
  if (!Number.isFinite(fromDegrees) || !Number.isInteger(direction) || direction < 0 || direction > 8)
    throw new TypeError('A finite angle and a native body direction are required');
  const from = Math.trunc(normalize(fromDegrees));
  switch (direction) {
    case 1: return from > 180 ? 360 : 0;
    case 5: return 180;
    case 7: return from <= 90 ? -90 : 270;
    case 3: return from > 270 ? 450 : 90;
    case 0: return from <= 135 ? -45 : 315;
    case 2: return from > 225 ? 405 : 45;
    case 6: return from <= 45 ? -135 : 225;
    case 4: return from > 315 ? 495 : 135;
    default: return 0;
  }
}

/** Native CMath.getRotation -> GameTool.angleToDirection, used by front-facing
 * skills. CMath treats coincident start/end coordinates as 180 degrees.
 */
export function nativeBodyDirectionForVector(dx, dy) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const angle = dx === 0 ? (dy < 0 ? 0 : 180)
    : Math.trunc(Math.atan2(dy, dx) * 180 / Math.PI + 90);
  return (Math.floor(normalize(angle + 22) / 45) + 1) % 8;
}

/** EffectLayer.onNotifyUseSkill changes the lower body for FORWARD_FAREST10.
 * No cannon adjustment is performed here. Other target types return null.
 */
export function nativeForwardBodyDirection(aim, skills) {
  if (!aim || Number(skills?.[String(aim.skillId)]?.iSType) !== 10) return null;
  if (![aim.x, aim.y, aim.startX, aim.startY].every(Number.isFinite)) return null;
  return nativeBodyDirectionForVector(aim.x - aim.startX, aim.y - aim.startY);
}

/** Source enums, not skill IDs: MOVE_NORMAL0, BEAT_BACK1, TRANSFER2, DASH3,
 * THROW4, SERVER5. BattleManager sends jump facing only to CTank, not AINpc.
 */
export function nativeMovementTurnsBody(motion, {tank = true} = {}) {
  if (!motion) return false;
  if (motion.moveType === 4) return tank && motion.throwType === 1;
  return [0, 3, 5].includes(motion.moveType) && motion.direction !== 8;
}

export function nativeMovementBodyDelay(motion) { return motion?.moveType === 3 ? 2 : 1; }

/** Call setFront once for EACH native move/front command (even a second step
 * in the same direction), then angleAt for every rendered frame. Stops do not
 * cancel the rotation. Create a new instance for a new actor/life; initialize
 * with that actor's known direction, including an inherited shadow direction.
 */
export class NativeBodyTurn {
  constructor(direction = 8) {
    this.direction = direction;
    this.from = this.to = nativeBodyTargetAngle(0, direction);
    this.startedAt = 0;
    this.durationMs = 0;
    this.commandCount = 0;
  }

  rotationAt(now) {
    requireTime(now);
    if (this.durationMs === 0) return this.to;
    const fraction = Math.max(0, Math.min(1, (now - this.startedAt) / this.durationMs));
    return this.from + (this.to - this.from) * fraction;
  }

  setFront(direction, now, {delayFactor = 1, immediate = false, noTween = false} = {}) {
    requireTime(now);
    if (!Number.isFinite(delayFactor) || delayFactor <= 0)
      throw new TypeError('A positive native body delay factor is required');
    const current = this.rotationAt(now);
    const from = Math.trunc(normalize(current));
    const to = nativeBodyTargetAngle(from, direction);
    this.direction = direction;
    this.commandCount += 1;
    this.startedAt = now;
    if (from === to) {
      // Native stops the previous Rotate before this early return. Its target
      // retains the last precise angle; setBodyRotation displays int degrees.
      this.from = this.to = current;
      this.durationMs = 0;
    } else if (immediate || noTween) {
      this.from = this.to = to;
      this.durationMs = 0;
    } else {
      this.from = from;
      this.to = to;
      this.durationMs = NATIVE_BODY_TURN_MS / delayFactor;
    }
    return this.angleAt(now);
  }

  degreesAt(now) {
    // setBodyRotation takes an AS3 int before CMath.formatAngle normalizes it.
    return normalize(Math.trunc(this.rotationAt(now)));
  }

  angleAt(now) { return this.degreesAt(now) * Math.PI / 180; }

  snapshot(now) {
    return {direction: this.direction, degrees: this.degreesAt(now),
      preciseDegrees: this.rotationAt(now), targetDegrees: normalize(this.to),
      fromDegrees: this.from, startedAt: this.startedAt, durationMs: this.durationMs,
      active: this.durationMs > 0 && now < this.startedAt + this.durationMs,
      commandCount: this.commandCount};
  }
}

/** BmpBodyStateProxy/CAnimation's persistent frame, independent of direction.
 * Stopping a non-idle body and FREEZE hold the current frame. MOVE/IDLE use
 * cutRate ticks; RUSH uses cutRate/2. gotoAndPlay(CURRENT_FRAME,...) restarts
 * the tick counter, including at the next same-direction movement command.
 * PNG animation has zero-based indices and includes its last frame; it does
 * not share SwfBodyStateProxy's one-based wrap-before-totalFrames convention.
 */
export class NativeBitmapBodyTimeline {
  constructor(totalFrames, {tickMs = NATIVE_BODY_TICK_MS, ticksPerFrame = 2,
    rushTicksPerFrame = 1, idleAnimated = false, attackFrameIndex = -1} = {}) {
    if (!Number.isInteger(totalFrames) || totalFrames < 1 || !(tickMs > 0))
      throw new TypeError('A positive bitmap frame count and tick duration are required');
    this.totalFrames = totalFrames;
    this.tickMs = tickMs;
    this.ticksPerFrame = Math.max(1, Math.trunc(ticksPerFrame));
    this.rushTicksPerFrame = Math.max(1, Math.trunc(rushTicksPerFrame));
    this.idleAnimated = idleAnimated === true;
    this.attackFrameIndex = Number.isInteger(attackFrameIndex) ? attackFrameIndex : -1;
    this.frame = 0;
    this.counter = 0;
    this.state = 'idle';
    this.lastTick = null;
    this.lastTime = null;
    this.commandKey = null;
  }

  _playing() {
    return this.state === 'move' || this.state === 'rush' || this.state === 'attack'
      || this.state === 'idle' && this.idleAnimated;
  }

  _advance(now) {
    requireTime(now);
    const tick = Math.floor(now / this.tickMs + 1e-9);
    if (this.lastTick == null) this.lastTick = tick;
    const count = Math.max(0, tick - this.lastTick);
    this.lastTick = Math.max(tick, this.lastTick);
    this.lastTime = Math.max(now, this.lastTime ?? now);
    if (!this._playing() || !count) return this.frame;
    const interval = this.state === 'rush' ? this.rushTicksPerFrame : this.ticksPerFrame;
    const advances = Math.floor((this.counter + count) / interval);
    this.counter = (this.counter + count) % interval;
    if (!advances) return this.frame;
    if (this.state === 'attack') {
      if (this.frame + advances < this.totalFrames) this.frame += advances;
      else {
        // CAnimation.PLAY_COMPLETE -> onAtkOver -> gotoAndStop(0) -> IDLE.
        this.frame = 0;
        this.state = 'idle';
        this.counter = 0;
      }
    } else {
      const end = this.attackFrameIndex > 0 && this.attackFrameIndex < this.totalFrames
        ? this.attackFrameIndex : this.totalFrames;
      this.frame = (this.frame + advances) % end;
    }
    return this.frame;
  }

  setState(state, now) {
    if (!['idle', 'move', 'rush', 'freeze', 'attack'].includes(state))
      throw new TypeError('An original bitmap body animation state is required');
    this._advance(now);
    if (state === 'attack' && (this.attackFrameIndex < 0 || this.attackFrameIndex >= this.totalFrames))
      return this.frame;
    this.state = state;
    if (state === 'attack') this.frame = this.attackFrameIndex;
    if (this._playing()) this.counter = 0;
    return this.frame;
  }

  /** commandKey/commandAt identify beginMoving, not a rendering tick. A null
   * key only changes state; callers can use setState for explicit source events.
   */
  sample(now, {moving = false, rushing = false, frozen = false,
    commandKey = null, commandAt = null} = {}) {
    requireTime(now);
    const state = frozen ? 'freeze' : rushing ? 'rush' : moving ? 'move' : 'idle';
    const newCommand = (moving || rushing) && commandKey != null && commandKey !== this.commandKey;
    if (state !== this.state || newCommand) {
      const at = Number.isFinite(commandAt) ? Math.min(now, Math.max(commandAt, this.lastTime ?? commandAt)) : now;
      this.setState(state, at);
    }
    this.commandKey = commandKey;
    return this._advance(now);
  }

  snapshot() {
    return {frame: this.frame, state: this.state, counter: this.counter,
      totalFrames: this.totalFrames, lastTick: this.lastTick, commandKey: this.commandKey};
  }
}
