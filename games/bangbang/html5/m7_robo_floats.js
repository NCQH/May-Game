/* Native bitmap damage/cure presentation; no damage is calculated here.
 * EffectLayer.showHpEffect/bubbleNum -> TmpBubbleNum -> TmpBmpNum.
 * Active TankLoaderR150 header is 24 fps. TmpBubbleNum registers a normal
 * ProcessManager callback (one per ENTER_FRAME, not its 42ms exact branch).
 * This age sampler reproduces the source steps at the loader's nominal rate;
 * actual Flash frame stalls can lengthen its wall-clock lifetime.
 */

export const ROBO_FLOAT_FRAME_MS = 1000 / 24;
export const ROBO_FLOAT_LIFETIME_MS = 1000;

const ROOT = 'zh_CN/gui_summer/controls/battle/';
const SHEETS = Object.freeze({
  harm: {logical: `${ROOT}num_harm.png`, cellWidth: 13, height: 20},
  cure: {logical: `${ROOT}num_cure.png`, cellWidth: 13, height: 21},
  crit: {logical: `${ROOT}num_crit.png`, cellWidth: 26, height: 33},
});
const int32 = value => Number(value) | 0;

/** duplicate is the source EffectLayer's same-coordinate, 84ms mutex flag.
 * random is cosmetic and injectable; this helper never reads server RNG.
 */
export function createRoboFloat(event, now, {duplicate = false, random = Math.random} = {}) {
  if (!event?.packet || !event?.position) {
    throw new TypeError('A native hpChange packet and its position are required');
  }
  const delta = int32(event.packet.delta);
  const type = Number(event.packet.fury) > 0 ? 'crit' : delta > 0 ? 'cure' : 'harm';
  const sheet = SHEETS[type];
  // TmpBubbleNum ignores the minus sign for negative values. Nonnegative
  // values retain the sign, using slot 11 for '+'. Slot 10 is '-' in the sheet.
  const indices = [...String(Math.abs(delta))].map(Number);
  if (delta >= 0) indices.unshift(11);
  const glyphs = indices.map(index => ({
    logical: sheet.logical, index,
    sx: index * sheet.cellWidth, sy: 0, sw: sheet.cellWidth, sh: sheet.height,
    offsetX: 0, offsetY: 0,
  }));
  if (type === 'crit') {
    glyphs.unshift({logical: `${ROOT}prefix_crit.png`, index: null,
      sx: 0, sy: 0, sw: 31, sh: 30, offsetX: 0, offsetY: 0});
  }
  const width = glyphs.reduce((sum, glyph) => sum + glyph.sw, 0);
  // Native measure() stores the centered origin in an int, truncating odd
  // half-widths toward zero; every glyph advances by its full bitmap width.
  let cursor = int32(-width / 2);
  for (const glyph of glyphs) {
    glyph.offsetX = cursor;
    cursor += glyph.sw;
  }
  let driftX = 0;
  if (duplicate) {
    const sign = random() >= 0.5 ? 1 : -1;
    driftX = int32((4 + random() * 4) * sign);
  }
  return {
    startedAt: now,
    position: {x: int32(event.position.x), y: int32(event.position.y)},
    delta, type, driftX, width, height: sheet.height, glyphs,
  };
}

/** Source glyph rectangles remain local; draw them at screen(x,y)+offset.
 * No initial -48px offset, font substitution, scale pulse, or extra spacing.
 */
export function sampleRoboFloat(record, now) {
  const age = Math.max(0, now - record.startedAt);
  const frame = Math.min(24, Math.floor(age / ROBO_FLOAT_FRAME_MS + 1e-9));
  const movingFrames = Math.min(16, frame);
  // Source tick: y -= speed; speed -= 0.5; alpha = speed. The Flash alpha
  // property clips to [0,1]. Speed starts at 8, reaching zero on tick 16.
  const rise = 8 * movingFrames - 0.25 * movingFrames * (movingFrames - 1);
  const alpha = frame === 0 ? 1 : Math.min(1, Math.max(0, 8 - 0.5 * movingFrames));
  const expired = frame >= 24;
  return {
    x: record.position.x + record.driftX * frame,
    y: record.position.y - rise,
    alpha, frame, expired, visible: !expired && alpha > 0,
    width: record.width, height: record.height, glyphs: record.glyphs,
  };
}
