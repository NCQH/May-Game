import {NORMAL_TICK_MS} from './battle_effects.js';

/** Root-cannon frame scripts jump to idle before displaying the jump frame. */
export function nativeCannonFrame(animation, elapsedMs, fireAgeMs, frameMs) {
  const idle = animation.idleFrames || [animation.idleFrame || 0];
  const fire = animation.fireFrames || [];
  if (fireAgeMs != null && fireAgeMs >= 0 && fire.length) {
    const index = Math.floor(fireAgeMs / frameMs);
    if (index < fire.length) return fire[index];
    elapsedMs = fireAgeMs - fire.length * frameMs;
  }
  return idle[Math.floor(Math.max(0, elapsedMs) / frameMs) % idle.length];
}

/** SwfBodyStateProxy's source-defined frame clock. Body drives its shadow.
 * MovieClip frame numbers are one-based. Native gotoAndStop(0) clamps to1;
 * the body wraps before totalFrames, and a shorter shadow clamps at its end.
 * This is animation state only, independent of any combat deadline or HP.
 */
export class NativeBodyTimeline {
  constructor(totalFrames, tickMs = NORMAL_TICK_MS, {includeLastFrame = false} = {}) {
    this.totalFrames = Math.max(1, totalFrames); this.tickMs = tickMs;
    // Opt-in for supplied non-ABC atlas clips. Native SWF consumers retain
    // their source-proved terminal-control-frame exclusion by default.
    this.includeLastFrame = includeLastFrame;
    this.frame = 1; this.counter = 0; this.lastTick = null;
  }

  sample(now, {moving = false, rushing = false, frozen = false} = {}) {
    const tick = Math.floor(now / this.tickMs);
    if (this.lastTick == null) this.lastTick = tick;
    const count = Math.max(0, tick - this.lastTick); this.lastTick = tick;
    if (frozen) return this.frame - 1;
    const interval = moving || rushing ? 1 : 2, step = rushing ? 2 : 1;
    const untilNext = Math.max(1, interval - this.counter);
    if (count < untilNext) { this.counter += count; return this.frame - 1; }
    const advances = 1 + Math.floor((count - untilNext) / interval);
    this.counter = (count - untilNext) % interval;
    // The sequence beginning at frame1 repeats after ceil((N-1)/step)
    // advances. Limit only repeated cycles, never truncate a movie timeline.
    const period = Math.max(1, Math.ceil((this.totalFrames - (this.includeLastFrame ? 0 : 1)) / step));
    const normalized = advances > period * 2 ? period + advances % period : advances;
    for (let index = 0; index < normalized; index += 1) {
      const next = this.frame + step;
      this.frame = (this.includeLastFrame ? next > this.totalFrames : next >= this.totalFrames) ? 1 : next;
    }
    return this.frame - 1;
  }

  layerIndex(layerFrameCount) { return Math.max(0, Math.min(layerFrameCount - 1, this.frame - 1)); }
}
