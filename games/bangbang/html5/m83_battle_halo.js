// CTank/TankShadow.initBuff and CTank.addBuffSwf. This module only adds
// original presentation resources; native buff vectors and attributes stay
// untouched. AutoCenterLoader's movie loops every frame, including the last.
import {NATIVE_EFFECT_TICK_MS} from './m83_effect_timeline.js';

const MASTER_BUFF = 15001;
const uint = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

function aborted(store, generation) {
  if (generation !== store.sceneGeneration)
    throw new DOMException('Tài nguyên vòng sáng thuộc trận trước đã đóng.', 'AbortError');
}

/** Called after M7's asset preparation and awaited by the existing C552 gate. */
export async function prepareM83BattleHalo(store, prepared, scene,
  {catalogUrl = './m83_battle_halo_catalog.json'} = {}) {
  if (!prepared?.supported) return prepared;
  const generation = store.sceneGeneration;
  const response = await fetch(catalogUrl, {cache: 'no-store', signal: store.abortController?.signal});
  if (!response.ok) throw new Error('Không tải được tài nguyên vòng sáng của tank.');
  const extension = await response.json();
  aborted(store, generation);
  if (extension.schemaVersion !== 1 || extension.consumer !== 'CTank/AutoCenterLoader'
      || extension.stageFps !== 24 || !extension.buffs?.[MASTER_BUFF])
    throw new Error('Danh mục vòng sáng không đúng phiên bản đã đối chiếu.');
  const byAccount = {}, required = new Set();
  for (const character of scene.characters || []) {
    const accountId = character.accountId ?? character.player?.accountId;
    const haloId = character.haloId ?? character.other?.haloId ?? 0;
    if (!uint(accountId) || !uint(haloId) || Object.hasOwn(byAccount, accountId))
      throw new Error('Đội hình có thông tin vòng sáng không hợp lệ.');
    byAccount[accountId] = {haloId};
    const customBuff = Number(extension.itemBuffIds?.[haloId]) || 0;
    if (customBuff) required.add(customBuff);
    else if (Number(character.tankLevel ?? character.other?.tankLevel) === 6) required.add(MASTER_BUFF);
  }
  // Bind only szBuffSwf. Raw fields, canonical IDs, state and gameplay tables
  // remain the accepted M6 values. The immutable M6 JSON file is never edited.
  for (const [id, binding] of Object.entries(extension.buffs)) {
    const row = prepared.catalog.buffs?.[id], resource = binding.resource;
    if (!row || row.szBuffSwf !== binding.szBuffSwf
        || Object.entries(binding.nativeFields).some(([key, value]) => (Number(row[key]) || 0) !== value)
        || resource?.derived?.nativeConsumer !== 'AutoCenterLoader'
        || resource.derived.rootFrameCount !== resource.derived.frames?.length)
      throw new Error(`Tài nguyên vòng sáng ${id} không khớp dữ liệu gốc.`);
    row.resources = {...row.resources, szBuffSwf: resource};
  }
  const readyBuffIds = [], missingBuffIds = [];
  for (const id of required) {
    const resource = extension.buffs[id]?.resource;
    if (!resource) {
      const absent = extension.missing.find(entry => entry.buffId === id);
      if (absent) store.recordMissing(absent.logical, absent.reason);
      missingBuffIds.push(id);
      continue; // Native source absent: preserve the native custom choice.
    }
    const asset = resource.derived.asset;
    store.pinnedUrls.add(asset.url);
    store.activeLogical.add(resource.logical);
    await store.loadResource(resource, true); // M6 verifies the atlas SHA256.
    aborted(store, generation);
    if (!store.image(asset)) throw new Error('Chưa giải mã được vòng sáng của tank.');
    (prepared.graphicsWarmUrls ||= []).push(asset.url);
    readyBuffIds.push(id);
  }
  prepared.m83BattleHalo = {sceneId: scene.sceneId, byAccount,
    itemBuffIds: extension.itemBuffIds, readyBuffIds, missingBuffIds,
    source: extension.source};
  return prepared;
}

/** A separate display vector, exactly as CTank.initBuff derives its children.
 * No level check here: the default ring requires native buff15001 in TankInfo.
 * A custom item from CHAR_BRIEF overrides it, including a missing-source item.
 */
export function nativeHaloBuffVector(actor, state, prepared) {
  const vector = Object.values(actor?.buffs || {}), setup = prepared?.m83BattleHalo;
  if (!setup || actor?.removed || actor?.dead) return vector;
  const type = actor.objectId >>> 26;
  const shadow = type === 5 && Number(prepared.catalog.aiNPCs?.[String(actor.templateId)]?.nType) === 4;
  if (type !== 0 && !shadow) return vector;
  const parent = shadow ? state?.actors?.[String(actor.ownerId)] : actor;
  const character = setup.byAccount[parent?.accountId];
  const customBuff = Number(setup.itemBuffIds[character?.haloId]) || 0;
  if (!customBuff) return vector;
  const result = vector.filter(buff => Number(buff.templateId) !== MASTER_BUFF);
  if (!result.some(buff => Number(buff.templateId) === customBuff)) result.push({
    templateId: customBuff, instanceId: null, casterId: parent.objectId,
    receivedAt: actor.lastSnapshotAt, presentationSource: 'native-character-halo',
  });
  return result;
}

/** AutoCenterLoader is an automatically playing root MovieClip, not the
 * CMovieClipLite end-exclusive consumer. One shared stage tick advances it;
 * source frame N is visible and the next tick wraps to frame1.
 */
export function nativeHaloSample(sequence, first, normalTick) {
  const derived = sequence?.derived;
  if (derived?.nativeConsumer !== 'AutoCenterLoader') return null;
  const count = sequence.frames?.length;
  if (!(count > 0) || count !== derived.rootFrameCount) return null;
  first.startNormalTick ??= normalTick;
  const ticks = Math.max(0, normalTick - first.startNormalTick);
  return {index: ticks % count, normalTicks: ticks, cycleFrames: count,
    cycleMs: count * NATIVE_EFFECT_TICK_MS, complete: false};
}
