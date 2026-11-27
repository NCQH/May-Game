import {characterProgress} from './m83_chrome.js';

/* Shared room-only geometry. Native logical pixels; the stage owns scaling.
 * LivePlayerList is 179 wide INCLUDING its 16px scrollbar: the actual player
 * viewport is 163. Both Hall/PvP and PvE must center decorations in that same
 * viewport instead of retaining the 89.5px center of the full 179px list.
 */
const rect = (...values) => Object.freeze(values);
export const ROOM_SIDEBAR_PLAYER_LAYOUT = Object.freeze({
  width: 163, height: 67,
  head: rect(8, 5, 40, 40), name: rect(53, 5, 103, 20),
  level: rect(8, 45, .5), detail: rect(53, 26, 103, 18),
  rankIcon: rect(53, 22), rankName: rect(77, 26, 79, 18),
  watch: rect(52, 46),
});

// TankSkinAttrFrame.as: width996; CloseButton top15, right12; native24×24.
export const TANK_SKIN_CLOSE_LAYOUT = Object.freeze({
  frameWidth: 996, top: 15, right: 12, width: 24, height: 24,
});

/** RoomPlayerFrame / FreePvePlayerFrame share a 120px name at x16 and a
 * native VIP image anchored right16. Reserve that image's actual width so a
 * long account name cannot paint over it. The tall/compact rows differ by
 * exactly 60 native pixels; avatar and character-level anchors do not move.
 * PlayerReadyFrameProxy uses VipTool.setVipNameStyle/getSmallVipIcon. Read
 * accepted brief data, or the newer own-character VIP fields with native
 * server time. Never infer VIP from the reference image or the PC's clock.
 */
export function roomNamePresentation(character, assets, {compact = false, clock = null,
  nowMs = globalThis.performance?.now?.()} = {}) {
  let vipLevel = Number(character?.vipLevel);
  const serverSeconds = Number(clock?.packet?.serverTimeSeconds);
  if (clock && Number.isFinite(serverSeconds) && Number.isFinite(clock.receivedAt) && Number.isFinite(nowMs)
      && Number.isFinite(character?.vipTime) && Number.isFinite(character?.vipPoints) && assets?.chrome?.vip) {
    const progress = characterProgress(character, {...assets.chrome, levels: assets.chrome.levels || {}},
      serverSeconds + Math.max(0, nowMs - clock.receivedAt) / 1000);
    vipLevel = progress.vip ? progress.vip + (progress.superVip ? 100 : 0) : 0;
  }
  const level = vipLevel % 100;
  if (!Number.isSafeInteger(vipLevel) || vipLevel < 0 || vipLevel >= 200 || level < 1 || level > 15) vipLevel = 0;
  const vipKey = vipLevel ? `chrome.${vipLevel >= 100 ? 'superVip' : 'vip'}${level}` : null;
  const image = vipKey && (assets?.get?.(vipKey) || assets?.chrome?.assets?.[vipKey]);
  const vipAsset = image?.url && image.width > 0 && image.width <= 120 && image.height > 0 && image.height <= 18 ? image : null;
  const rowY = compact ? 41 : 101, vipX = vipAsset ? 158 - 16 - vipAsset.width : null;
  const colors = !vipLevel ? null : level < 3 ? [15990034,4495616]
    : level < 6 ? [16762622,11141375] : [16777028,16720384];
  return {vipLevel, vipKey, vipAsset, colors,
    name: [16,rowY,vipAsset ? Math.min(120, vipX - 16 - 3) : 120,18],
    vip: vipAsset ? [vipX,rowY + 3,vipAsset.width,vipAsset.height] : null};
}

export function styleRoomPlayerName(node, presentation) {
  node.dataset.vipLevel = String(presentation.vipLevel);
  node.title = node.textContent;
  node.classList.toggle('m81331-room-vip-name', !!presentation.colors);
  if (presentation.colors) {
    node.style.backgroundImage = `linear-gradient(#${presentation.colors[0].toString(16).padStart(6,'0')},#${presentation.colors[1].toString(16).padStart(6,'0')})`;
  } else node.style.backgroundImage = '';
  return node;
}

/** OrnateImg.normal resolves ResourcePath.ORNATE_NORMAL_PATH + ItemTemplet.szUrl.
 * A missing small variant does not mean the normal variant is absent (notably
 * midFestival/christmas/valentineDay_2016). Only derive the logical filename;
 * the caller must still resolve an actual, source-verified normal asset. Never
 * draw a big/small/hall bitmap in the tall card as a substitute.
 */
export function roomOrnamentKey(row, size = 'hall') {
  if (!row) return null;
  if (size !== 'normal') return row[size + 'Key'] || null;
  if (/^zh_CN\/individual\/normal\/300\/[^/]+\.(?:png|swf)$/.test(row.normalKey || '')) return row.normalKey;
  const names = new Set();
  for (const key of [row.bigKey, row.smallKey, row.hallKey, row.iconKey]) {
    const match = /^zh_CN\/individual\/(?:big|hall|icon|small\/300)\/([^/]+\.(?:png|swf))$/.exec(key || '');
    if (match) names.add(match[1]);
  }
  return names.size === 1 ? 'zh_CN/individual/normal/300/' + [...names][0] : null;
}

/** Uniform bitmap/timeline placement, without rewriting or stretching art.
 * Tall 300-series room ornaments cover the card (clipped by an art-only layer), rather
 * than shrinking to a short island behind fixed native avatar/name anchors.
 * Small/missing source artwork is never upscaled to impersonate a full frame.
 * Hall ornaments contain inside the actual 163×67 viewport in both modes.
 */
export function roomOrnamentRect(asset, size = 'hall') {
  const width = Number(asset?.width), height = Number(asset?.height);
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) return null;
  const bounds = size === 'normal' ? [158, 318] : [ROOM_SIDEBAR_PLAYER_LAYOUT.width, ROOM_SIDEBAR_PLAYER_LAYOUT.height];
  const fit = size === 'normal' ? Math.max : Math.min;
  const scale = Math.min(1, fit(bounds[0] / width, bounds[1] / height));
  const drawnWidth = width * scale, drawnHeight = height * scale;
  return Object.freeze({x: (bounds[0] - drawnWidth) / 2, y: (bounds[1] - drawnHeight) / 2,
    width: drawnWidth, height: drawnHeight, scale, clipWidth: bounds[0], clipHeight: bounds[1],
    fit: size === 'normal' ? 'uniform-card-cover-no-upscale' : 'uniform-sidebar-contain'});
}
