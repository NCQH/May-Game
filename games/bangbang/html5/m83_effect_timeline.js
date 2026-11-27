// The served TankLoader/TankLib stage runs at 24 fps. CMovieClipLite registers
// with ProcessManager.normal, which advances once per ENTER_FRAME; it does not
// use the separate exact/catch-up queue or a movie's header frame rate.
export const NATIVE_EFFECT_TICK_MS = 1000 / 24;

/** One presentation clock for both EffectLayer draw passes. Never burst through
 * several source frames after a slow render or a suspended browser tab. */
export class NativeEffectClock {
  constructor(tickMs = NATIVE_EFFECT_TICK_MS) {
    this.tickMs = tickMs; this.origin = null; this.slot = 0;
    this.tick = 0; this.droppedTicks = 0;
  }

  sample(now) {
    if (!Number.isFinite(now)) return this.tick;
    if (this.origin == null) { this.origin = now; return this.tick; }
    // The tiny tolerance only handles floating-point values at exact 24 Hz
    // boundaries; it does not make a source frame advance early in practice.
    const slot = Math.floor(Math.max(0, now - this.origin) / this.tickMs + 1e-9);
    if (slot > this.slot) {
      this.droppedTicks += slot - this.slot - 1;
      this.slot = slot; this.tick += 1;
    }
    return this.tick;
  }

  snapshot() { return {tick: this.tick, tickMs: this.tickMs, droppedTicks: this.droppedTicks}; }
}

/** Only bind the CMovieClipLite clock to an audited, unabridged root timeline.
 * PNG CAnimation sheets, body/cannon movies and distance frames retain their
 * own consumers. Descriptor durationMs is an export size, not this lifecycle. */
export function isNativeEffectMovie(sequence) {
  const derived = sequence?.derived;
  return derived?.mode === 'root-timeline'
    && derived.rootFrameCount > 0 && derived.rootFrameCount === sequence.frames.length;
}

/** CMovieClipLite starts at frame1. On reaching frameN it dispatches completion
 * (EffectLayer hides it in the same tick), or immediately replays frame1. The
 * final frame is therefore not submitted by this consumer. A one-frame root
 * never reaches the equality check after ++m_curFrame and stays on frame1. */
export function nativeEffectSample(length, normalTicks, loop = false) {
  if (!(length > 0)) return null;
  if (length === 1) return {index: 0, complete: false, durationMs: null};
  const cycle = length - 1, ticks = Math.max(0, Math.floor(normalTicks));
  const complete = !loop && ticks >= cycle;
  return {index: complete ? length - 1 : ticks % cycle, complete,
    durationMs: cycle * NATIVE_EFFECT_TICK_MS};
}
