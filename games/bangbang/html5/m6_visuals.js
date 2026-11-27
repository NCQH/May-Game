/** Exact distance frame selection used by LinkBulletView and LinkBuffView.
 * CMovieClipLite.stop(0) stops without seeking, so a zero distance preserves
 * the prior frame. No clock, damage, collision or skill logic is involved.
 */
export function distanceFrame(frameCount, distance, previous = 0, maxDistance = Infinity) {
  if (!(frameCount > 0) || !Number.isFinite(distance)) return null;
  const requested = Math.min(Math.abs(Math.trunc(distance)), maxDistance);
  if (requested === 0) return Math.max(0, Math.min(frameCount - 1, previous));
  return Math.max(0, Math.min(frameCount - 1, requested - 1));
}

/** LinkBulletView rotates the parent by CMath.getRotation and
 * their child by -90°. Distance atlases retain the original +X axis. Ordinary
 * projectile art and LinkBuffView point north and retain their own rotation. */
export function nativeLinkRotation(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** CShakeTools.caculateDeadPos/moveDetalRange; only explicit AINpcDead metadata. */
export function nativeDeathFlight(position, hunter, range) {
  if (!position || !hunter || !(range > 0)) return null;
  const from = {x: Math.trunc(position.x), y: Math.trunc(position.y)};
  const dx = from.x - hunter.x, dy = from.y - hunter.y;
  if (dx === 0 && dy === 0) return null;
  const distance = Math.floor(Math.hypot(dx, dy));
  if (!distance) return null;
  return {from, to: {x: Math.trunc((distance + range) * dx / distance + hunter.x),
    y: Math.trunc((distance + range) * dy / distance + hunter.y)}, durationMs: 300};
}

function bounceOut(value) {
  if (value < 1 / 2.75) return 7.5625 * value * value;
  if (value < 2 / 2.75) return 7.5625 * (value -= 1.5 / 2.75) * value + .75;
  if (value < 2.5 / 2.75) return 7.5625 * (value -= 2.25 / 2.75) * value + .9375;
  return 7.5625 * (value -= 2.625 / 2.75) * value + .984375;
}
const bounceInOut = value => value < .5
  ? (1 - bounceOut(1 - value * 2)) * .5 : bounceOut(value * 2 - 1) * .5 + .5;
const quadOut = value => 1 - (1 - value) ** 2;

/** CShakeTools + mx.effects.easing.Bounce, extracted from current TankLib.dat.
 * Math.random controls presentation shake only; native combat RNG is untouched.
 */
export class NativeScreenShake {
  constructor(random = Math.random) { this.random = random; this.reset(); }
  reset() { this.steps = []; this.startedAt = null; this.durationMs = 0; this.triggers = 0;
    this.timelines = []; this.offset = {x: 0, y: 0}; }
  trigger(type, ownerId, selfId, now) {
    if (!Number.isInteger(type) || type === 0 || type > 4 || type < 0) return false;
    if (type >= 3 && ownerId !== selfId) return false;
    const big = [2, 4].includes(type), steps = [];
    const add = (axis, to, ms, bounce = false) => steps.push({axis, to, ms, bounce});
    const sign = () => this.random() > .5 ? 1 : -1;
    if (big) {
      add('x', sign() * (10 + 4 * this.random()), 80, true);
      add('y', sign() * (10 + 4 * this.random()), 80, true);
      add('x', 0, 75); add('y', 0, 75);
      for (const size of [8, 6]) {
        if (this.random() > .5) {
          add('x', size, 50); add('y', size, 50); add('x', 0, 50); add('y', 0, 50);
        } else {
          add('x', size, 50); add('x', 0, 50); add('y', size, 50); add('y', 0, 50);
        }
      }
      if (this.random() > .5) {
        add('x', 4, 50); add('x', 0, 50); add('y', 4, 50); add('y', 0, 50);
      } else {
        add('x', 4, 50); add('y', 4, 50); add('x', 0, 50); add('y', 0, 50);
      }
      if (this.random() > .5) {
        add('y', 2, 50); add('x', 2, 50); add('x', 0, 50); add('y', 0, 50);
      } else {
        add('x', 2, 50); add('y', 2, 50); add('x', 0, 50); add('y', 0, 50);
      }
    } else {
      const mark = sign();
      if (this.random() > .5) {
        add('x', mark * (5 + 4 * this.random()), 50, true);
        add('y', mark * (5 + 4 * this.random()), 50, true);
        add('x', 0, 50); add('y', 0, 50);
      } else {
        add('x', mark * (5 + 4 * this.random()), 50, true); add('x', 0, 50);
        add('y', mark * (5 + 4 * this.random()), 50, true); add('y', 0, 50);
      }
      if (this.random() > .5) {
        add('y', 2, 40); add('x', 2, 40); add('x', 0, 40); add('y', 0, 40);
      } else {
        add('x', 2, 40); add('x', 0, 40); add('y', 2, 40); add('y', 0, 40);
      }
    }
    this.steps = steps; this.startedAt = now; this.durationMs = steps.reduce((n, step) => n + step.ms, 0);
    this.timelines.push({steps, startedAt: now, durationMs: this.durationMs});
    this.triggers += 1; return true;
  }
  sample(now) {
    let offset = {x: 0, y: 0};
    // Each source call owns an independent TimelineLite/CPoint. Later-created
    // active timelines write last; completion restores zero for that tick.
    for (const timeline of this.timelines) {
      const point = {x: 0, y: 0};
      let elapsed = Math.max(0, now - timeline.startedAt);
      for (const step of timeline.steps) {
        const from = point[step.axis];
        if (elapsed >= step.ms) { point[step.axis] = Math.trunc(step.to); elapsed -= step.ms; continue; }
        const ratio = (step.bounce ? bounceInOut : quadOut)(elapsed / step.ms);
        // The original CPoint has int x/y fields, unlike the death movie's
        // DisplayObject Number coordinates.
        point[step.axis] = Math.trunc(from + (step.to - from) * ratio);
        break;
      }
      offset = point;
    }
    this.timelines = this.timelines.filter(timeline => now - timeline.startedAt < timeline.durationMs);
    this.offset = offset; return offset;
  }
  snapshot(now) { return {offset: {...this.offset}, triggers: this.triggers,
    active: this.timelines.some(timeline => now - timeline.startedAt < timeline.durationMs),
    activeTimelines: this.timelines.length, durationMs: this.durationMs}; }
}
