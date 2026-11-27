/* StartGame_t.swf (InstanceFrame.swfStartGame), audited from the original
 * f661628cb59518d926a8341e34b980a4.swf. SHA256:
 * 76ca3de3d569298935fd1c5f53a31ab517e9a3c29fba19c65852ed053e8bbecc.
 * All 40 root matrices are [1,0,0,1,x,y]: a small circular translation,
 * NOT rotation of the lettering. The child sprite/button has identity
 * transforms and the bitmap shape is (-35.5,-35)..(35.5,35).
 * Reuse the already verified 71x70 PNG in PANEL_ART['instance.startGame'].
 */
export const PVE_START_GAME = Object.freeze({
  sourceSha256: '76ca3de3d569298935fd1c5f53a31ab517e9a3c29fba19c65852ed053e8bbecc',
  fps: 36, frameCount: 40, width: 84, height: 84,
  offsetX: 80, offsetY: -65, bitmapX: -35.5, bitmapY: -35,
  frames: Object.freeze([
    [36.75,39.95],[37,39.15],[37.45,38.45],[37.85,37.75],
    [38.45,37.2],[39.2,36.85],[39.9,36.45],[40.7,36.25],
    [41.5,36.3],[42.35,36.35],[43.15,36.4],[43.9,36.7],
    [44.5,37.25],[45.15,37.75],[45.75,38.3],[46.1,39.05],
    [46.45,39.75],[46.5,40.55],[46.55,41.4],[46.6,42.2],
    [46.3,42.8],[46,43.45],[45.7,44.05],[45.15,44.45],
    [44.6,44.85],[44.1,45.2],[43.55,45.6],[43,46],
    [42.35,46],[41.65,46.05],[41,46.05],[40.3,46.05],
    [39.65,45.8],[39,45.5],[38.6,44.95],[38.2,44.45],
    [37.75,43.9],[37.35,43.4],[36.95,42.85],[37.05,42.15],
  ].map(frame => Object.freeze(frame))),
});

/** Interpolate only between audited translations; at each 36fps frame boundary
 * this is the exact native matrix. No new spin, size pulse, or vertical bob. */
export function pveStartGamePosition(elapsedMs = 0) {
  const elapsed = Number.isFinite(Number(elapsedMs)) ? Math.max(0, Number(elapsedMs)) : 0;
  const phase = (elapsed * PVE_START_GAME.fps / 1000) % PVE_START_GAME.frameCount;
  const index = Math.floor(phase), part = phase - index;
  const a = PVE_START_GAME.frames[index], b = PVE_START_GAME.frames[(index + 1) % PVE_START_GAME.frameCount];
  return {x: a[0] + (b[0] - a[0]) * part + PVE_START_GAME.bitmapX,
    y: a[1] + (b[1] - a[1]) * part + PVE_START_GAME.bitmapY};
}

// InstanceView.as::doTipEffect: Parallel(400ms), Move(20px), Fade(0..1),
// both Sine.easeOut. The user requests the DOWN/below variant first.
export const PVE_TIP_REVEAL_MS = 400;
export function pveTipRevealProgress(elapsedMs = 0) {
  const elapsed = Number.isFinite(Number(elapsedMs)) ? Number(elapsedMs) : 0;
  return Math.sin(Math.min(1, Math.max(0, elapsed / PVE_TIP_REVEAL_MS)) * Math.PI / 2);
}
