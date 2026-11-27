/* M32 source-pinned presentation fixes. Original atlases remain byte-identical. */
export const WORLD_BOSS_APPEAR_COMPOSITE = Object.freeze({
  sourceSha256: '65efe0c2f234492aad745e1f872ba46dbe225944bb9e2c27a2c07fb1ee7acd0b',
  sourceLogical: 'zh_CN/swf/tank/birth/appear.swf',
  atlasSha256: 'b051f2be705ad34f796fdb823f8f22dde1ce993832c8042956a14928e263dc11',
  frameCount: 15,
  nativeBlendMode: 8,
});

/** All 41 root placements of the original appear movie use Flash ADD (8).
 * Its 13 children contain only normal one-frame bitmap fills. The old atlas
 * correctly retains the light pixels but also their black JPEG background;
 * source-over incorrectly paints that background over the map. Apply the
 * authored ADD at the final scene composite, not a pixel/color-removal pass.
 * The three pins prevent this exception from changing any unrelated effect.
 */
export function nativeSequenceAdditive(sequence) {
  const pin = WORLD_BOSS_APPEAR_COMPOSITE, derived = sequence?.derived;
  if (!derived || sequence.source?.sha256 !== pin.sourceSha256
      || sequence.source?.logical !== pin.sourceLogical) return false;
  // These sequences have only fifteen frames. Validate their effective assets
  // every time: callers may share derived metadata while replacing frames.
  return derived.sourceSha256 === pin.sourceSha256
    && derived.mode === 'root-timeline' && derived.rootFrameCount === pin.frameCount
    && sequence.frames?.length === pin.frameCount
    && derived.asset?.sha256 === pin.atlasSha256
    && (derived.assets || [derived.asset]).every(asset => asset?.sha256 === pin.atlasSha256)
    && sequence.frames.every(frame => {
      const asset = frame?.asset
        || (frame?.assetIndex != null ? sequence.assets?.[frame.assetIndex] : null)
        || sequence.asset;
      return asset?.sha256 === pin.atlasSha256;
    });
}
