import {element, actionButton, assetImage, nativeText} from './m8_ui_helpers.js';
import {PVE_MAP_IDS, isPveRequestMap, pveNormalMapId, pveHardMapId} from './m81314_protocol.js';
import {cityUnlocked, cityCleared, cityHardUnlocked, pveRoomDifficulty, pveGrade} from './m81314_state.js';
import {PANEL_ART} from './m81316_panel_art.js';
import {companionTables, companionConfig, companionAttributes} from './m81314_companion_math.js';
import {PVE_TIP_DROPS} from './m81317_pve_tip_data.js';
import {PVE_START_GAME, PVE_TIP_REVEAL_MS, pveStartGamePosition, pveTipRevealProgress} from './m81318_pve_art.js';
import {PveRoomView, pveRoomThewOffer, pveRoomGuildOptions} from './m81327_pve_room.js';

const CHAPTER_SOURCE_TITLES = ['', '第一章 - 激战之始', '第二章 - 死里逃生', '第三章 - 强袭要塞',
  '第四章 - 剿灭叛军', '第五章 - 外星入侵', '第六章 - 星球大战', '第七章 - 生化危机', '第八章 - 末日之源', '第九章 - 复兴之战'];
// Exact entries from native vi_VN/mo/ui.mo. The earlier sidecar omitted these
// nine strings, so chapters2..9 fell back to a bare number despite having names.
// Source SHA256 4173f0012a5371b7477249b533c5457151c8381a247c3ba898d7ee3155e6e839.
export const PVE_CHAPTER_TITLES = Object.freeze(['', 'Chương 1-Bắt Đầu Trận Chiến',
  'Chương 2-Trong Rủi Có May', 'Chương 3-Tập Kích Căn Cứ', 'Chương 4-Diệt Phản Quân',
  'Chương 5 - Bị Xâm Nhập', 'Chương 6-Đại Chiến Tinh Cầu', 'Chương 7-Resident Evil',
  'Chương 8-Nguồn Gốc Hủy Diệt', 'Chương 9 - Cuộc Chiến Phục Hưng']);

// InstanceFrame.as: literal station positions after applying its chapter State.
// Source SHA256 fde503a2304e25233cd56c00304393840ece5449866fba055d92b225641c5b5b.
// State method number != chapter number (states 4/5/1/2/3 map to chapters 1..5).
export const PVE_CHAPTER_LAYOUT = Object.freeze({
  1: [[198,153],[389,172],[603,106],[710,220],[489,308]],
  2: [[104,178],[208,289],[404,181],[523,355],[594,154],[770,254]],
  3: [[130,215],[332,278],[437,82],[550,250],[772,225],[461,361]],
  4: [[74,213],[227,288],[417,237],[604,414],[774,251],[590,105]],
  5: [[76,116],[261,265],[510,367],[773,342],[789,138],[393,35]],
  6: [[65,235],[325,127],[603,34],[757,183],[625,292],[423,222]],
  7: [[76,158],[242,275],[378,84],[521,262],[663,84],[783,296]],
  8: [[99,254],[316,96],[621,24],[760,185],[493,274],[745,340]],
  9: [[173,143],[408,71]],
});

export function pveCards(catalog = {}) {
  const tables = catalog.rawTemplates || catalog.templates || {};
  const cities = new Map((tables.CityTemplate_table || []).map(row => [Number(row.nMapId), row]));
  const byCity = new Map((tables.CityTemplate_table || []).map(row => [Number(row.nId), row]));
  const chapterIndices = new Map();
  return PVE_MAP_IDS.map((mapId, ordinal) => {
    const map = catalog.maps?.[mapId], city = cities.get(mapId), chapter = Number(city?.nCountryId);
    const chapterIndex = chapterIndices.get(chapter) || 0; chapterIndices.set(chapter, chapterIndex + 1);
    const hardMapId = pveHardMapId(mapId);
    return {mapId, ordinal, map, city, cityId: Number(city?.nId || map?.cityId || 0), chapter, chapterIndex,
      hardMapId, hardSupported: hardMapId > 0 && Number(city?.nHeroMapId) === hardMapId,
      name: nativeText(map?.name) || `Màn ${mapId}`,
      previousMapId: Number(map?.previousMapId || byCity.get(Number(city?.nPreId))?.nMapId || 0),
      position: PVE_CHAPTER_LAYOUT[chapter]?.[chapterIndex] || null,
      supported: !!map && !!city && !!PVE_CHAPTER_LAYOUT[chapter]?.[chapterIndex] && map.nativeGeometryDecoded === true};
  });
}

const nonnegativeNumber = value => value != null && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
export function pveTipTables(catalog = {}) {
  const raw = catalog.rawTemplates || catalog.templates || {};
  return {maps: new Map((raw.MapTemplate_table || []).map(row => [Number(row.nMapId), row])),
    cities: new Map((raw.CityTemplate_table || []).map(row => [Number(row.nId), row])),
    companions: companionTables(catalog)};
}

/** Native MapTool.getAllNeedThew follows at most three linked scenes. A missing
 * row/invalid cycle stays unknown; it is never replaced with a made-up price. */
function pveThew(tables, mapId) {
  const seen = new Set(); let total = 0, current = Number(mapId);
  for (let count = 0; current && count < 3; count++) {
    const row = tables.maps.get(current), cost = nonnegativeNumber(row?.nReuseB);
    if (!row || cost == null || seen.has(current)) return null;
    seen.add(current); total += cost; current = Number(row.nNextMapId || 0);
  }
  return total;
}

/** Display-only source values, not a new entry gate or reward calculation. */
export function pveTipData(catalog, card, snapshot, tables = pveTipTables(catalog)) {
  const city = snapshot?.pve?.cities?.[card.cityId], flags = city ? Number(city.flags) : null;
  const mode = (mapId, hard) => {
    const raw = tables.maps.get(Number(mapId));
    if (!raw) return null;
    return {mapId: Number(mapId), hard, players: nonnegativeNumber(raw.nRecNum),
      // MapTool's normal-mode fallback is explicitly 489, including tutorial201.
      recommended: Number(raw.nBoosterAttack) > 0 ? Number(raw.nBoosterAttack) : hard ? null : 489,
      minimum: Number(raw.nBoosterAttackMin) > 0 ? Number(raw.nBoosterAttackMin) : hard ? null : 489,
      thew: pveThew(tables, mapId), itemIds: [...(PVE_TIP_DROPS[mapId] || [])],
      completedToday: flags == null ? null : !!(flags & (hard ? 128 : 64))};
  };
  const requirements = [];
  if (Number(card.city?.nLevelMin) > 0) requirements.push({kind: 'level', value: Number(card.city.nLevelMin), passed: flags == null ? null : !!(flags & 2)});
  if (Number(card.city?.nQuestId) > 0) requirements.push({kind: 'quest', value: Number(card.city.nQuestId), passed: flags == null ? null : !!(flags & 4)});
  if (Number(card.city?.nPreId) > 0) {
    const previous = tables.cities.get(Number(card.city.nPreId));
    requirements.push({kind: 'previous', value: Number(previous?.nMapId || card.previousMapId), passed: flags == null ? null : !!(flags & 8)});
  }
  const activeUuid = snapshot?.companions?.activeUuid;
  let power = activeUuid ? null : 0;
  if (activeUuid) {
    const item = snapshot?.meta?.containers?.[5]?.items?.find(row => row.uuid === activeUuid && row.count > 0);
    try {
      const config = companionConfig(catalog, tables.companions, item);
      if (config) power = companionAttributes(tables.companions, item, config.booster).score;
    } catch { /* Unsynchronized/invalid inventory is visibly unknown, not another pet. */ }
  }
  const normal = mode(card.mapId, false), hard = card.city?.nHeroMapId ? mode(card.city.nHeroMapId, true) : null;
  return {normal, hard, power, requirements, grade: city?.grade, hardGrade: city?.hardGrade,
    cityKnown: !!city, unlocked: cityUnlocked(city), hardUnlocked: cityHardUnlocked(city)};
}

/** Native full-content card, centered BELOW its trigger. On a short viewport
 * shift vertically, then uniformly shrink only if the entire card is taller
 * than the usable world. Never turn it into a side card, crop it, or scroll it.
 * Bounds are viewport/world coordinates expressed in panel-local units: the
 * actual Flash world can be larger than this centered 1000x600 panel. */
export function pveTooltipPlacement(anchor, measuredWidth = 440, measuredHeight = 480,
    viewport = {x: 0, y: 0, width: 1000, height: 548}) {
  const pad = 10, gap = 12;
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const width = Math.max(1, finite(measuredWidth, 440)), height = Math.max(1, finite(measuredHeight, 480));
  const bounds = {x: finite(viewport?.x), y: finite(viewport?.y),
    width: Math.max(1, finite(viewport?.width, 1000)), height: Math.max(1, finite(viewport?.height, 548))};
  const insetX = Math.min(pad, bounds.width / 4), insetY = Math.min(pad, bounds.height / 4);
  const scale = Math.min(1, (bounds.width - 2 * insetX) / width, (bounds.height - 2 * insetY) / height);
  const shownWidth = width * scale, shownHeight = height * scale;
  const x = finite(anchor?.x), y = finite(anchor?.y);
  const w = Math.max(0, finite(anchor?.width)), h = Math.max(0, finite(anchor?.height));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const left = clamp(x + w / 2 - shownWidth / 2, bounds.x + insetX, bounds.x + bounds.width - insetX - shownWidth);
  const preferredTop = y + h + gap;
  const top = clamp(preferredTop, bounds.y + insetY, bounds.y + bounds.height - insetY - shownHeight);
  const below = top >= y + h + gap - .01;
  return {left, top, width, height, scale, shownWidth, shownHeight, side: below ? 'top' : 'none',
    placement: below ? 'below' : 'vertical-fit',
    // The 20px reveal is shortened only where its start would leave the screen.
    entranceTravel: Math.min(20 * scale, Math.max(0, top - bounds.y - insetY)),
    arrowX: clamp((x + w / 2 - left) / scale, 20, Math.max(20, width - 20))};
}

/** Solo chapters with a separate offline hard variant. Server city flags,
 * never local successful-click state, decide whether enter is available. */
export class M81314Pve {
  constructor({host, client, assets, catalog, run, onClose = () => {}, onCompanions = null, onNavigate = null, onInteractionLock = () => {}}) {
    this.host = host; this.client = client; this.assets = assets; this.catalog = catalog || {};
    this.run = run || (work => work()); this.onClose = onClose; this.onCompanions = onCompanions;
    this.onNavigate = onNavigate; this.onInteractionLock = onInteractionLock;
    this.cards = pveCards(this.catalog);
    this.tipTables = pveTipTables(this.catalog); this.tipBindings = [];
    this.tip = null; this.tipAnchor = null; this.tipMode = null; this.tipReveal = null; this.tipPlacement = null;
    this.pointerStation = null; this.dismissedTipMapId = null; this.inputMode = 'keyboard';
    this.startGameMarker = null; this.markerMapId = null; this.markerElapsed = 0; this.markerStamp = null;
    this.motionRequest = 0; this.tipNeedsLayout = false; this.restoringRender = false; this.windowFocused = true;
    this.snapshot = null; this.identity = null; this.connectionGeneration = client.generation;
    this.epoch = 0; this.pending = ''; this.notice = ''; this.disposed = false;
    this.chapter = 1; this.chapterChosen = false; this.selectedMapId = null; this.dialogOpen = false; this.difficulty = 0;
    this.roomView = null; this.roomMapPickerOpen = false; this.pickerDifficulty = 0; this.roomDialog = null;
    this.style = element('link'); this.style.rel = 'stylesheet';
    const styleUrl = new URL('./m81314_pve.css', import.meta.url);
    styleUrl.search = new URL(import.meta.url).search;
    this.style.href = styleUrl.href;
    this.content = element('section', null, 'm81314-pve'); this.content.setAttribute('aria-label', 'PvE đơn');
    this.content.dataset.testid = 'pve-panel'; this.host.replaceChildren(this.style, this.content);
    this.onKeyDown = event => {
      if (event.key === 'Tab' || event.key?.startsWith('Arrow')) this.inputMode = 'keyboard';
      const dialog = this.content.querySelector('[role="dialog"]');
      if (event.key === 'Escape' && !dialog && this.tip) {
        event.preventDefault(); event.stopPropagation();
        this.dismissedTipMapId = Number(this.tip.dataset.mapId); this.hideTip(); return;
      }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.requestClose(); }
      if (event.key !== 'Tab' || !dialog) return;
      const buttons = [...dialog.querySelectorAll('button:not(:disabled)')], first = buttons[0], last = buttons.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)
          || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    };
    this.content.addEventListener('keydown', this.onKeyDown);
    this.onPointerInput = () => {
      this.inputMode = 'pointer';
      if (this.tipMode === 'focus' && this.pointerStation !== this.tipAnchor) this.hideTip();
    };
    this.onKeyboardInput = event => {
      if (event.key === 'Tab' || event.key?.startsWith('Arrow')) this.inputMode = 'keyboard';
    };
    this.content.addEventListener('pointerdown', this.onPointerInput, true);
    document.addEventListener('keydown', this.onKeyboardInput, true);
    this.onTipVisibility = () => {
      if (document.hidden) { this.hideTip(); this.pointerStation = null; }
      this.syncVisualState();
    };
    this.onTipWindowBlur = () => { this.windowFocused = false; this.hideTip(); this.pointerStation = null; this.syncVisualState(); };
    this.onTipWindowFocus = () => { this.windowFocused = true; this.syncVisualState(); };
    this.onTipResize = () => { this.tipNeedsLayout = !!this.tip; this.syncVisualState(); };
    this.motionPreference = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.onMotionPreference = () => {
      if (this.motionPreference?.matches) {
        this.tipReveal = null; this.paintTip(1); this.paintStartGame(0);
      }
      this.syncVisualState();
    };
    this.motionPreference?.addEventListener?.('change', this.onMotionPreference);
    document.addEventListener('visibilitychange', this.onTipVisibility);
    globalThis.addEventListener?.('blur', this.onTipWindowBlur);
    globalThis.addEventListener?.('focus', this.onTipWindowFocus);
    globalThis.addEventListener?.('resize', this.onTipResize);
    globalThis.visualViewport?.addEventListener?.('resize', this.onTipResize);
    globalThis.visualViewport?.addEventListener?.('scroll', this.onTipResize);
    this.style.addEventListener('load', this.onTipResize);
    if (typeof globalThis.ResizeObserver === 'function') {
      this.tipResizeObserver = new ResizeObserver(this.onTipResize);
      this.tipResizeObserver.observe(this.content);
      const viewport = this.content.closest?.('.m8-viewport');
      if (viewport) this.tipResizeObserver.observe(viewport);
    }
    if (typeof globalThis.MutationObserver === 'function') {
      this.surfaceObserver = new MutationObserver(this.onTipResize);
      // Outside modals retain the PvE controller but make its ancestor inert.
      // Observe only ancestors, not animated descendant styles every frame.
      for (let node = this.host; node; node = node.parentElement)
        this.surfaceObserver.observe(node, {attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden', 'class', 'style']});
    }
  }
  asset(value) {
    if (!value) return null;
    const result = typeof value === 'string' ? this.catalog.assets?.[value] || this.assets?.get?.(value)
      : value.assetRef ? this.catalog.assets?.[value.assetRef] : value;
    return result?.url && /\.(?:png|jpe?g|webp)(?:$|[?#])/i.test(result.url) ? result : null;
  }
  localized(value) { return nativeText(this.catalog.localizedText?.[value] || this.assets?.garage?.localizedText?.[value] || value); }
  get cities() { return this.snapshot?.pve?.cities || {}; }
  get mutable() { return !this.disposed && !this.pending && this.snapshot?.phase === 'ready' && !this.snapshot.play?.busy; }
  get interactionLocked() { return !this.disposed && (!!this.pending || !!this.roomDialog); }
  get inLobby() { return this.snapshot?.play?.phase === 'lobby'; }
  get inPveRoom() { return this.snapshot?.play?.phase === 'room' && this.snapshot.play?.room?.roomType === 4; }
  get hardMode() {
    if (this.inPveRoom && !this.roomMapPickerOpen) return this.difficulty === 1;
    return (this.roomMapPickerOpen ? this.pickerDifficulty : this.difficulty) === 1 && this.chapter !== 1;
  }
  get selected() { return this.cards.find(card => card.mapId === this.selectedMapId) || null; }
  get roomCard() {
    const mapId = Number(this.snapshot?.play?.room?.mapId || this.snapshot?.play?.room?.config?.mapId);
    return this.cards.find(card => card.mapId === mapId) || null;
  }
  requestMapId(card) { return this.hardMode ? card?.hardMapId || 0 : card?.mapId || 0; }
  live(epoch = this.epoch) { return !this.disposed && epoch === this.epoch && this.client.generation === this.connectionGeneration; }
  button(label, work, options = {}) {
    const epoch = this.epoch;
    return actionButton(label, () => this.run(async () => {
      if (!this.live(epoch)) throw new Error('Phiên PvE đã thay đổi; hãy mở lại bảng.');
      return work();
    }), options);
  }
  update(snapshot) {
    if (this.disposed) return;
    const identity = snapshot.accountId ?? snapshot.meta?.character?.accountId ?? null;
    if (identity !== this.identity || this.client.generation !== this.connectionGeneration) {
      this.hideTip(); this.pointerStation = null; this.dismissedTipMapId = null;
      this.startGameMarker = null; this.markerMapId = null; this.markerElapsed = 0; this.markerStamp = null;
      this.epoch++; this.identity = identity; this.connectionGeneration = this.client.generation;
      this.chapter = 1; this.chapterChosen = false; this.selectedMapId = null; this.dialogOpen = false; this.difficulty = 0;
      this.roomView?.dispose(); this.roomView = null; this.roomMapPickerOpen = false; this.pickerDifficulty = 0; this.roomDialog = null;
      this.pending = ''; this.notice = '';
    }
    const wasInPveRoom = this.inPveRoom;
    const oldRoom = this.snapshot?.play?.room;
    const oldRoomKey = JSON.stringify([oldRoom?.roomId, oldRoom?.mapId || oldRoom?.config?.mapId, pveRoomDifficulty(oldRoom)]);
    this.snapshot = snapshot;
    if (this.roomDialog && (!this.roomDialogLive(this.roomDialog)
        || (this.roomDialog.kind === 'guild' && !pveRoomGuildOptions(snapshot, this.assets.account, this.roomDialog.slotId).length)))
      this.roomDialog = null;
    if (this.inPveRoom) this.difficulty = pveRoomDifficulty(snapshot.play.room);
    const room = snapshot.play?.room;
    const roomKey = JSON.stringify([room?.roomId, room?.mapId || room?.config?.mapId, pveRoomDifficulty(room)]);
    if (this.inPveRoom && (!wasInPveRoom || !this.chapterChosen || oldRoomKey !== roomKey)) {
      const currentRoom = this.roomCard;
      if (currentRoom) { this.chapter = currentRoom.chapter; this.chapterChosen = true; this.selectedMapId = currentRoom.mapId; }
      // This also handles a delayed S1700 after a request timeout/reconnect.
      // Only the accepted room snapshot changes the displayed room/mode.
      this.roomMapPickerOpen = false; this.pickerDifficulty = this.difficulty;
      this.notice = '';
    }
    if (!this.chapterChosen && Object.keys(this.cities).length) {
      const next = this.cards.find(card => cityUnlocked(this.cities[card.cityId]) && !cityCleared(this.cities[card.cityId]))
        || this.cards.findLast(card => cityUnlocked(this.cities[card.cityId]));
      this.chapter = next?.chapter || 1; this.chapterChosen = true;
    }
    if (this.dialogOpen && !['lobby', 'room'].includes(snapshot.play?.phase)) this.dialogOpen = false;
    const key = JSON.stringify([identity, this.client.generation, snapshot.phase, snapshot.play?.phase,
      snapshot.play?.busy, snapshot.play?.room, snapshot.pve, snapshot.companions, snapshot.meta?.containers?.[5],
      snapshot.meta?.character, snapshot.meta?.tanks, snapshot.flow?.roster, snapshot.account?.revision]);
    if (key !== this.renderKey) { this.renderKey = key; this.render(); }
    else { this.roomView?.update(); this.syncVisualState(); }
  }
  async perform(label, work) {
    if (!this.mutable || !this.live()) throw new Error('Đợi máy chủ đồng bộ trước khi thao tác PvE.');
    const epoch = this.epoch; this.pending = label; this.notice = ''; this.render();
    try { return await work(); }
    catch (error) { if (this.live(epoch)) this.notice = error.message || 'Máy chủ chưa xác nhận yêu cầu.'; throw error; }
    finally { if (this.live(epoch)) {
      this.pending = ''; this.renderKey = null;
      // App-level painting is batched. Read the already-reduced ACK now, so a
      // completed room change cannot briefly re-enable Start on an old map.
      this.update(this.client.snapshot?.() || this.snapshot);
    } }
  }
  enter(mapId, waitingRoom = false) {
    const normalMapId = pveNormalMapId(mapId), hard = mapId !== normalMapId;
    const card = this.cards.find(row => row.mapId === normalMapId);
    if (!Number.isInteger(mapId) || !isPveRequestMap(mapId) || !card?.supported || (hard && !card.hardSupported))
      throw new Error('Màn PvE chưa có cấu hình và tài nguyên đã đối chiếu.');
    const locked = this.lockText(card, hard);
    if (locked) throw new Error(locked);
    if (!this.inLobby) throw new Error('Hãy về sảnh trước khi vào màn PvE khác.');
    return this.perform(waitingRoom ? 'Tạo phòng PvE' : 'Vào màn PvE', () => this.client.enterPve(mapId, {waitingRoom}));
  }
  startRoom() {
    if (!this.inPveRoom) throw new Error('Bạn không ở phòng chờ PvE đơn.');
    if (this.roomDialog) throw new Error('Hãy đóng bảng lựa chọn trước khi vào game.');
    return this.perform('Bắt đầu PvE', () => this.client.startPveRoom());
  }
  chooseStation(card) {
    if (!this.mutable || !this.live()) return;
    this.hideTip(); this.pointerStation = null; this.dismissedTipMapId = null;
    const locked = this.lockText(card);
    if (locked) { this.notice = locked; this.render(); return; }
    const mapId = this.requestMapId(card);
    return this.inPveRoom ? this.changeRoom(mapId) : this.enter(mapId, true);
  }
  changeRoom(mapId) {
    if (!this.inPveRoom) throw new Error('Bạn không ở phòng chờ PvE đơn.');
    if (this.roomDialog) throw new Error('Hãy đóng bảng lựa chọn trước khi đổi màn.');
    const normalMapId = pveNormalMapId(mapId), card = this.cards.find(row => row.mapId === normalMapId);
    if (!card || !Number.isInteger(mapId) || !isPveRequestMap(mapId)) throw new Error('Màn PvE chưa được hỗ trợ.');
    const locked = this.lockText(card, mapId !== normalMapId);
    if (locked) throw new Error(locked);
    const epoch = this.epoch;
    return this.perform('Đổi màn / độ khó PvE', async () => {
      const packet = await this.client.changePveRoom(mapId);
      if (this.live(epoch)) this.roomMapPickerOpen = false;
      return packet;
    });
  }
  openMapPicker() {
    if (!this.mutable || !this.live() || !this.inPveRoom || this.roomDialog) return;
    this.roomMapPickerOpen = true; this.pickerDifficulty = this.difficulty;
    if (this.roomCard) this.chapter = this.roomCard.chapter;
    this.notice = ''; this.render();
  }
  openRoomPanel(screen) {
    if (!this.mutable || !this.live() || !this.inPveRoom || this.roomDialog || !this.onNavigate) return;
    return this.onNavigate(screen);
  }
  openCompanions() {
    if (!this.live() || !this.mutable || !this.inPveRoom || this.roomDialog || !this.onCompanions)
      throw new Error('Đợi đồng bộ phòng PvE trước khi mở trợ thủ.');
    return this.onCompanions();
  }
  roomDialogLive(dialog) {
    const room = this.snapshot?.play?.room;
    return !!dialog && this.live(dialog.epoch) && this.inPveRoom && this.snapshot.phase === 'ready'
      && dialog.accountId === this.snapshot.accountId && dialog.roomId === room?.roomId
      && dialog.mapId === (room?.mapId || room?.config?.mapId)
      && dialog.difficulty === pveRoomDifficulty(room);
  }
  newRoomDialog(kind, values = {}) {
    const room = this.snapshot.play.room;
    return {kind, ...values, epoch: this.epoch, accountId: this.snapshot.accountId,
      roomId: room.roomId, mapId: room.mapId || room.config?.mapId, difficulty: pveRoomDifficulty(room)};
  }
  openThewPurchase() {
    if (!this.mutable || !this.live() || !this.inPveRoom || this.roomDialog || !pveRoomThewOffer(this.snapshot)) return;
    this.roomDialog = this.newRoomDialog('thew'); this.notice = ''; this.render();
  }
  openGuildSkillPicker(slotId = 1) {
    if (!this.mutable || !this.live() || !this.inPveRoom || this.roomDialog
        || !pveRoomGuildOptions(this.snapshot, this.assets.account, slotId).length) return;
    this.roomDialog = this.newRoomDialog('guild', {slotId}); this.notice = ''; this.render();
  }
  closeRoomDialog(dialog = this.roomDialog) {
    if (this.pending || !this.live() || dialog !== this.roomDialog) return;
    const trigger = dialog?.kind === 'thew' ? this.roomView?.buyThew
      : this.roomView?.root.querySelector(`[data-testid="pve-room-guild-${dialog?.slotId}"]`);
    this.roomDialog = null; this.notice = ''; this.render(); trigger?.focus?.({preventScroll: true});
  }
  confirmThewPurchase(dialog = this.roomDialog) {
    if (dialog !== this.roomDialog || dialog?.kind !== 'thew' || !this.roomDialogLive(dialog) || !this.mutable) return;
    const offer = pveRoomThewOffer(this.snapshot);
    if (!offer?.canBuy) { this.notice = offer?.reason || 'Thể lực và Xu vàng chưa đồng bộ.'; this.render(); return; }
    return this.perform('Mua thể lực', async () => {
      const result = await this.client.buyPveStamina();
      if (this.roomDialog === dialog && this.roomDialogLive(dialog)) {
        this.roomDialog = null; this.notice = 'Máy chủ xác nhận: đã mua 100 thể lực với 1 Xu vàng.';
      }
      return result;
    });
  }
  equipRoomGuildSkill(skillId, dialog = this.roomDialog) {
    if (dialog !== this.roomDialog || dialog?.kind !== 'guild' || !this.roomDialogLive(dialog) || !this.mutable) return;
    const options = pveRoomGuildOptions(this.snapshot, this.assets.account, dialog.slotId);
    const skill = options.find(row => row.nGuildSkillId === skillId);
    if (!options.length || (skillId !== 0 && !skill)) { this.closeRoomDialog(dialog); return; }
    const current = this.snapshot.account?.slots?.[dialog.slotId];
    if (current?.skillId === skillId && current?.level === (skill?.nLevel || 0)) { this.closeRoomDialog(dialog); return; }
    return this.perform('Đổi kỹ năng Guild', async () => {
      const result = await this.client.guildAction('equipSkill', {slotId: dialog.slotId, skillId, level: skill?.nLevel || 0});
      if (this.roomDialog === dialog && this.roomDialogLive(dialog)) {
        this.roomDialog = null; this.notice = skillId ? 'Đã trang bị kỹ năng Guild theo xác nhận máy chủ.' : 'Đã tháo kỹ năng Guild.';
      }
      return result;
    });
  }
  record(mapId) {
    if (!['lobby', 'room'].includes(this.snapshot?.play?.phase) || !isPveRequestMap(mapId))
      throw new Error('Chỉ xem kỷ lục PvE tại sảnh hoặc phòng chờ.');
    return this.perform('Đọc kỷ lục', () => this.client.requestPveRecord(mapId));
  }
  requestClose() {
    if (this.pending || !this.live() || (this.inPveRoom && !this.mutable)) return;
    this.hideTip();
    if (this.roomDialog) { this.closeRoomDialog(); return; }
    if (this.roomMapPickerOpen) {
      this.roomMapPickerOpen = false; this.notice = ''; this.pickerDifficulty = this.difficulty;
      if (this.roomCard) { this.chapter = this.roomCard.chapter; this.selectedMapId = this.roomCard.mapId; }
      this.render(); this.roomView?.mapButton.focus?.({preventScroll: true}); return;
    }
    if (this.dialogOpen) { this.dialogOpen = false; this.render(); return; }
    this.onClose();
  }
  lockText(card, hard = this.hardMode) {
    const city = this.cities[card.cityId];
    if (!card.supported) return 'Chưa có cấu hình / tài nguyên gốc đầy đủ.';
    if (hard && !card.hardSupported) return 'Màn này không có chế độ khó trong danh mục gốc.';
    if (!city) return 'Chưa nhận trạng thái mở khóa từ máy chủ.';
    if (cityUnlocked(city)) return hard && !cityCleared(city) ? 'Cần hoàn thành màn thường này trước khi vào khó.' : '';
    const previous = this.cards.find(row => row.mapId === card.previousMapId);
    if (!(city.flags & 8) && previous) return `Cần hoàn thành “${previous.name}” trước.`;
    return 'Điều kiện mở màn chưa được máy chủ xác nhận.';
  }
  chooseChapter(chapter) {
    if (this.pending || !Number.isInteger(chapter) || chapter < 1 || chapter > 9) return;
    if (chapter !== this.chapter) { this.hideTip(); this.pointerStation = null; this.dismissedTipMapId = null; }
    this.chapter = chapter; this.chapterChosen = true; this.dialogOpen = false; this.notice = ''; this.render();
  }
  chooseDifficulty(difficulty) {
    if (this.roomDialog) return;
    const chapter = this.inPveRoom && !this.roomMapPickerOpen ? this.roomCard?.chapter : this.chapter;
    if (this.pending || ![0, 1].includes(difficulty) || (difficulty === 1 && chapter === 1)) return;
    if (this.inPveRoom && !this.roomMapPickerOpen) {
      if (!this.mutable || !this.roomCard || this.difficulty === difficulty) return;
      const locked = this.lockText(this.roomCard, difficulty === 1);
      if (locked) { this.notice = locked; this.render(); return; }
      return this.changeRoom(difficulty ? this.roomCard.hardMapId : this.roomCard.mapId);
    }
    if ((this.roomMapPickerOpen ? this.pickerDifficulty : this.difficulty) === difficulty) return;
    this.hideTip(); this.pointerStation = null; this.dismissedTipMapId = null;
    if (this.roomMapPickerOpen) this.pickerDifficulty = difficulty; else this.difficulty = difficulty;
    this.dialogOpen = false; this.notice = ''; this.render();
  }
  chapterTitle() {
    const source = CHAPTER_SOURCE_TITLES[this.chapter], localized = this.localized(source);
    return localized && localized !== source ? localized : PVE_CHAPTER_TITLES[this.chapter] || 'Chương ' + this.chapter;
  }
  chapterPager(direction) {
    const previous = direction < 0, disabled = !!this.pending || (previous ? this.chapter === 1 : this.chapter === 9);
    const key = previous ? 'prev' : 'next';
    const art = PANEL_ART['public.btn_' + key + '_s2_l' + (disabled ? '_disabled' : '')];
    const word = PANEL_ART['instance.word_' + key + '_chapter_t'];
    const button = this.button(previous ? 'Chương trước' : 'Chương sau', () => this.chooseChapter(this.chapter + direction),
      {disabled, className: 'pve-chapter-pager pve-pager-' + key, testId: 'pve-' + key + '-chapter'});
    button.setAttribute('aria-label', previous ? 'Chương trước' : 'Chương sau');
    button.replaceChildren(assetImage(art, '', 'pve-pager-background'), assetImage(word, '', 'pve-pager-word')); return button;
  }
  render() {
    if (this.disposed) return;
    this.onInteractionLock(this.interactionLocked);
    const showingRoom = this.inPveRoom && !this.roomMapPickerOpen;
    this.content.classList.toggle('is-waiting-room', showingRoom);
    this.content.classList.toggle('is-room-map-picker', this.roomMapPickerOpen);
    if (showingRoom) {
      this.clearTipBindings(); this.startGameMarker = null; this.markerMapId = null;
      if (!this.roomView) { this.content.replaceChildren(); this.roomView = new PveRoomView(this); }
      this.roomView.update(); this.syncVisualState(); return;
    }
    this.roomView?.dispose(); this.roomView = null;
    const focusId = this.content.contains(document.activeElement) ? document.activeElement?.dataset?.testid : null;
    const retainedTip = this.tip && ((this.tipMode === 'pointer' && this.pointerStation === this.tipAnchor)
      || (this.tipMode === 'focus' && document.activeElement === this.tipAnchor))
      ? {mapId: Number(this.tipAnchor.dataset.mapId), mode: this.tipMode} : null;
    this.clearTipBindings(!!retainedTip);
    const children = [], world = this.asset(this.catalog.ui?.worlds?.[this.chapter])
      || this.asset(`zh_CN/map/world_${this.chapter}.jpg`);
    if (world) children.push(assetImage(world, '', 'pve-world'));
    else { const missing = element('p', 'Ảnh chương gốc chưa sẵn sàng.', 'pve-world-missing'); missing.dataset.assetMissing = 'true'; children.push(missing); }
    const heading = element('header', null, 'pve-heading');
    heading.append(element('h2', this.chapterTitle()));
    const close = this.button('Đóng', () => this.requestClose(), {disabled: !!this.pending, className: 'pve-close', testId: 'pve-close'});
    close.setAttribute('aria-label', this.roomMapPickerOpen ? 'Quay lại phòng PvE' : 'Đóng PvE'); close.replaceChildren(assetImage(PANEL_ART['public.btn_close'], '', 'pve-close-art'));
    children.push(heading, close);
    const modes = element('div', null, 'pve-mode-locks');
    modes.setAttribute('aria-label', 'Chọn độ khó PvE');
    for (const difficulty of [0, 1]) {
      const selected = Number(this.hardMode) === difficulty;
      const button = this.button(difficulty ? 'Khó · Offline' : 'Thường', () => this.chooseDifficulty(difficulty),
        {disabled: !!this.pending || (difficulty === 1 && this.chapter === 1),
          title: difficulty ? this.chapter === 1 ? 'Chương 1 chỉ có màn thường.'
            : 'Khó offline: dùng bản đồ và cơ chế màn thường, chỉ số PvE riêng. Qua màn thường để mở.' : 'Chế độ thường',
          className: selected ? 'is-selected' : '', testId: difficulty ? 'pve-mode-hard' : 'pve-mode-normal'});
      button.setAttribute('aria-pressed', String(selected)); modes.append(button);
    }
    modes.append(actionButton('Tổ đội · Chưa hỗ trợ', null, {disabled: true, title: 'Hiện hỗ trợ PvE đơn; không giả lập đội.'}));
    children.push(modes, this.chapterPager(-1), this.chapterPager(1));
    const stationLayer = element('div', null, 'pve-stations');
    for (const card of this.cards.filter(row => row.chapter === this.chapter)) stationLayer.append(this.renderStation(card));
    children.push(stationLayer);
    const navigation = element('nav', null, 'pve-chapters'); navigation.setAttribute('aria-label', 'Chọn chương PvE');
    for (let chapter = 1; chapter <= 9; chapter++) {
      const hard = this.hardMode && chapter !== 1;
      const rows = this.cards.filter(row => row.chapter === chapter), completed = rows.filter(row => cityCleared(this.cities[row.cityId], hard)).length;
      const button = this.button(String(chapter), () => this.chooseChapter(chapter),
        {disabled: !!this.pending, title: PVE_CHAPTER_TITLES[chapter] + (hard ? ' · Khó' : ' · Thường') + ' · Đã qua ' + completed + '/' + rows.length,
          className: chapter === this.chapter ? 'is-selected' : '', testId: `pve-chapter-${chapter}`});
      button.setAttribute('aria-label', PVE_CHAPTER_TITLES[chapter] + (hard ? ', khó' : ', thường') + ', đã qua ' + completed + '/' + rows.length);
      button.setAttribute('aria-pressed', String(chapter === this.chapter)); navigation.append(button);
    }
    children.push(navigation);
    const rules = element('p', 'PvE đơn · 15 phút · 3 mạng', 'pve-rules');
    children.push(rules);
    if (this.roomMapPickerOpen) {
      const tools = element('div', null, 'pve-room-tools');
      const roomMapId = Number(this.snapshot.play.room.mapId || this.snapshot.play.room.config?.mapId);
      const roomName = this.cards.find(card => card.mapId === roomMapId)?.name || `Màn ${roomMapId}`;
      const modeName = pveRoomDifficulty(this.snapshot.play.room) ? 'Khó offline' : 'Thường';
      tools.append(this.button('Quay lại phòng', () => this.requestClose(),
        {disabled: !!this.pending, className: 'pve-room-start', title: `${roomName} · ${modeName}`, testId: 'pve-return-room'}));
      children.push(tools);
    }
    const status = element('p', this.pending ? `${this.pending}: đang chờ xác nhận máy chủ…` : this.notice, 'pve-status');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.dataset.testid = 'pve-status';
    children.push(status); this.content.replaceChildren(...children);
    // Rebinding a snapshot must not replay focus reveal or turn a mouse click
    // into a keyboard-owned sticky tooltip.
    this.restoringRender = true;
    if (focusId) [...this.content.querySelectorAll('[data-testid]')].find(node => node.dataset.testid === focusId)?.focus?.({preventScroll: true});
    this.restoringRender = false;
    const dialog = this.content.querySelector('[role="dialog"]');
    if (dialog && !dialog.contains(document.activeElement)) dialog.querySelector('[data-testid="pve-detail-close"]')?.focus({preventScroll: true});
    if (retainedTip && !dialog) {
      const anchor = this.content.querySelector(`[data-testid="pve-map-${retainedTip.mapId}"]`), card = this.cards.find(row => row.mapId === retainedTip.mapId);
      if (anchor && card) {
        if (retainedTip.mode === 'pointer') this.pointerStation = anchor;
        this.showTip(anchor, card, retainedTip.mode, true);
      } else this.hideTip();
    } else this.hideTip();
    if (this.startGameMarker && !this.content.contains(this.startGameMarker)) {
      this.startGameMarker = null; this.markerMapId = null; this.markerElapsed = 0; this.markerStamp = null;
    }
    this.syncVisualState();
  }
  renderStation(card) {
    const city = this.cities[card.cityId], hard = this.hardMode;
    const unlocked = hard ? card.hardSupported && cityHardUnlocked(city) : cityUnlocked(city), cleared = cityCleared(city, hard);
    const value = hard ? city?.hardGrade : city?.grade;
    const status = cleared ? `Đã qua · ${pveGrade(value)}` : unlocked ? 'Đã mở' : 'Chưa mở';
    const button = this.button('', () => this.chooseStation(card), {disabled: !this.mutable,
      className: `pve-station${unlocked ? '' : ' is-locked'}${cleared ? ' is-cleared' : ''}`, testId: `pve-map-${card.mapId}`});
    button.dataset.mapId = String(card.mapId); button.dataset.cityId = String(card.cityId);
    button.dataset.unlocked = String(unlocked); button.dataset.difficulty = hard ? 'hard' : 'normal';
    button.setAttribute('aria-label', `${card.name} · ${hard ? 'Khó offline' : 'Thường'}: ${status}`);
    const art = this.asset(this.catalog.ui?.chapters?.[card.cityId])
      || this.asset(`zh_CN/mapres/${card.city?.szGuiImage || ''}`);
    const [x, y] = card.position || [20, 100];
    Object.assign(button.style, {left: `${x}px`, top: `${y}px`, width: `${art?.width || 162}px`, height: `${art?.height || 107}px`});
    if (art) button.append(assetImage(art, '', 'pve-station-icon'));
    else button.append(element('span', 'Chưa có ảnh gốc', 'pve-station-missing'));
    // The source artwork already contains the stage name and round station dot.
    // Do not cover either with duplicate HTML captions or a second map marker.
    const grade = cleared && this.asset(this.catalog.ui?.pveResults?.grades?.[value]);
    if (grade) {
      const mark = assetImage(grade, pveGrade(value), 'pve-station-grade');
      mark.style.top = (art?.height > 120 ? 14 : -22) + 'px'; button.append(mark);
    }
    const next = this.cards.find(row => (hard ? row.hardSupported && cityHardUnlocked(this.cities[row.cityId]) : cityUnlocked(this.cities[row.cityId]))
      && !cityCleared(this.cities[row.cityId], hard));
    if (next?.mapId === card.mapId && unlocked) {
      button.classList.add('is-next');
      if (!this.startGameMarker || this.markerMapId !== card.mapId) {
        this.startGameMarker = element('span', null, 'pve-station-next');
        this.startGameMarker.setAttribute('aria-hidden', 'true');
        this.startGameMarker.append(assetImage(PANEL_ART['instance.startGame'], '', 'pve-station-next-art'));
        Object.assign(this.startGameMarker.style, {left: `${PVE_START_GAME.offsetX}px`, top: `${PVE_START_GAME.offsetY}px`,
          width: `${PVE_START_GAME.width}px`, height: `${PVE_START_GAME.height}px`});
        this.markerMapId = card.mapId; this.markerElapsed = 0; this.markerStamp = null;
        this.paintStartGame(0);
      }
      button.append(this.startGameMarker);
    }
    this.bindStationTip(button, card);
    return button;
  }
  hideTip() {
    this.tipAnchor?.removeAttribute('aria-describedby');
    if (this.tip) this.tipResizeObserver?.unobserve(this.tip);
    this.tip?.remove(); this.tip = null; this.tipAnchor = null; this.tipMode = null;
    this.tipReveal = null; this.tipPlacement = null; this.tipNeedsLayout = false;
  }
  clearTipBindings(keepTip = false) {
    if (!keepTip) this.hideTip();
    this.pointerStation = null;
    for (const release of this.tipBindings) release();
    this.tipBindings.length = 0;
  }
  bindStationTip(button, card) {
    const enter = () => { this.inputMode = 'pointer'; this.pointerStation = button; this.showTip(button, card, 'pointer'); };
    const leave = () => {
      if (this.pointerStation === button) this.pointerStation = null;
      if (this.dismissedTipMapId === card.mapId) this.dismissedTipMapId = null;
      // Native ROLL_OUT releases the effect immediately. Neither the popup nor
      // the focus produced by clicking this button may retain mouse ownership.
      if (this.tipAnchor === button && this.tipMode === 'pointer') this.hideTip();
    };
    const focus = () => {
      if (!this.restoringRender && this.inputMode === 'keyboard') this.showTip(button, card, 'focus');
    };
    const blur = () => {
      if (this.restoringRender) return;
      this.dismissedTipMapId = null;
      if (this.tipAnchor === button && this.tipMode === 'focus') this.hideTip();
    };
    for (const [type, listener] of [['mouseenter', enter], ['mouseleave', leave], ['focus', focus], ['blur', blur]]) {
      button.addEventListener(type, listener);
      this.tipBindings.push(() => button.removeEventListener(type, listener));
    }
  }
  showTip(button, card, mode = 'pointer', reuse = false) {
    if (!this.canShowVisuals() || !this.content.contains(button) || this.dismissedTipMapId === card.mapId) {
      if (reuse) this.hideTip();
      return;
    }
    if (this.tipAnchor === button && this.tip && !reuse) { this.tipMode = mode; return; }
    const data = pveTipData(this.catalog, card, this.snapshot, this.tipTables);
    let tip = reuse ? this.tip : null;
    if (tip) {
      this.tipAnchor?.removeAttribute('aria-describedby');
      // Keep the outer element/reveal clock across snapshot updates. Replace
      // only display facts so active companion/record changes cannot go stale.
      tip.replaceChildren(this.renderTip(card, data).firstElementChild);
    } else {
      this.hideTip(); tip = this.renderTip(card, data);
      tip.id = `pve-hover-${this.epoch}-${card.mapId}`; tip.setAttribute('role', 'tooltip');
      tip.dataset.testid = 'pve-map-tooltip'; tip.dataset.mapId = String(card.mapId);
      tip.style.opacity = this.motionPreference?.matches ? '1' : '0';
      this.tipReveal = this.motionPreference?.matches ? null : {startedAt: null, elapsed: 0};
    }
    this.tip = tip; this.tipAnchor = button; this.tipMode = mode; button.setAttribute('aria-describedby', tip.id);
    this.content.append(tip);
    this.tipResizeObserver?.observe(tip);
    this.positionTip(); this.syncVisualState();
  }
  canShowVisuals() {
    if (!this.live() || !this.mutable || this.dialogOpen || document.hidden || !this.windowFocused
        || !['lobby', 'room'].includes(this.snapshot?.play?.phase) || this.content.isConnected === false) return false;
    for (let node = this.content; node; node = node.parentElement)
      if (node.hidden || node.inert || node.getAttribute?.('aria-hidden') === 'true'
          || node.style?.display === 'none' || node.style?.visibility === 'hidden') return false;
    return true;
  }
  tooltipViewport() {
    const box = this.content.getBoundingClientRect?.();
    if (!box?.width || !box?.height) return {x: 0, y: 0, width: 1000, height: 548};
    const scaleX = box.width / 1000, scaleY = box.height / 600;
    const visual = globalThis.visualViewport;
    let left = visual?.offsetLeft || 0, top = visual?.offsetTop || 0;
    let right = left + (visual?.width || globalThis.innerWidth || box.right);
    let bottom = top + (visual?.height || globalThis.innerHeight || box.bottom);
    const clip = this.content.closest?.('.m8-viewport')?.getBoundingClientRect?.();
    if (clip?.width && clip?.height) {
      left = Math.max(left, clip.left); top = Math.max(top, clip.top);
      right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
    }
    // The native bottom dock is a sibling with a higher stacking level. Do not
    // claim the part underneath it is visible space for full tooltip content.
    const dock = this.content.closest?.('.m8-stage')?.querySelector('.m8-footer');
    const dockBox = !dock?.hidden && dock?.getBoundingClientRect?.();
    if (dockBox?.width && dockBox?.height && dockBox.top > top && dockBox.top < bottom) bottom = dockBox.top;
    return {x: (left - box.left) / scaleX, y: (top - box.top) / scaleY,
      width: Math.max(1, right - left) / scaleX, height: Math.max(1, bottom - top) / scaleY};
  }
  positionTip() {
    if (!this.tip || !this.tipAnchor) return;
    const button = this.tipAnchor, tip = this.tip;
    this.tipPlacement = pveTooltipPlacement({x: parseFloat(button.style.left), y: parseFloat(button.style.top),
      width: parseFloat(button.style.width), height: parseFloat(button.style.height)},
      tip.offsetWidth || 440, tip.offsetHeight || 480, this.tooltipViewport());
    const place = this.tipPlacement;
    Object.assign(tip.style, {left: `${place.left}px`, top: `${place.top}px`});
    tip.style.setProperty('--pve-tip-arrow-x', `${place.arrowX}px`);
    tip.dataset.side = place.side; tip.dataset.placement = place.placement;
    tip.dataset.scale = String(place.scale); this.tipNeedsLayout = false;
    this.paintTip(this.tipReveal ? pveTipRevealProgress(this.tipReveal.elapsed) : 1);
  }
  paintTip(progress) {
    if (!this.tip || !this.tipPlacement) return;
    const place = this.tipPlacement;
    this.tip.style.opacity = String(progress);
    this.tip.style.transform = `translate3d(0,${-place.entranceTravel * (1 - progress)}px,0) scale(${place.scale})`;
  }
  paintStartGame(elapsed) {
    const image = this.startGameMarker?.firstElementChild;
    if (!image) return;
    const point = pveStartGamePosition(elapsed);
    image.style.transform = `translate3d(${point.x}px,${point.y}px,0)`;
  }
  syncVisualState() {
    const visible = this.canShowVisuals();
    if (!visible) { this.hideTip(); this.pointerStation = null; }
    const reduced = !!this.motionPreference?.matches;
    if (reduced) { this.tipReveal = null; this.paintTip(1); this.paintStartGame(0); }
    const needsFrame = visible && (this.tipNeedsLayout || (!reduced && (!!this.startGameMarker || !!this.tipReveal)));
    if (!needsFrame) {
      if (this.motionRequest) globalThis.cancelAnimationFrame?.(this.motionRequest);
      this.motionRequest = 0; this.markerStamp = null; return;
    }
    if (!this.motionRequest && typeof globalThis.requestAnimationFrame === 'function')
      this.motionRequest = requestAnimationFrame(time => this.visualFrame(time));
  }
  visualFrame(time) {
    this.motionRequest = 0;
    if (!this.canShowVisuals()) { this.syncVisualState(); return; }
    if (this.tipNeedsLayout) this.positionTip();
    if (!this.motionPreference?.matches) {
      if (this.startGameMarker) {
        if (this.markerStamp != null) this.markerElapsed += Math.max(0, time - this.markerStamp);
        this.markerStamp = time; this.paintStartGame(this.markerElapsed);
      }
      if (this.tipReveal) {
        if (this.tipReveal.startedAt == null) this.tipReveal.startedAt = time - this.tipReveal.elapsed;
        this.tipReveal.elapsed = Math.max(0, time - this.tipReveal.startedAt);
        this.paintTip(pveTipRevealProgress(this.tipReveal.elapsed));
        if (this.tipReveal.elapsed >= PVE_TIP_REVEAL_MS) this.tipReveal = null;
      }
    }
    this.syncVisualState();
  }
  renderTip(card, data) {
    const tip = element('section', null, 'pve-hover-card'), body = element('div', null, 'pve-hover-body');
    tip.append(body); body.append(element('h3', card.name));
    const description = this.localized(card.map?.raw?.szPveDesc);
    if (description) body.append(element('p', description, 'pve-hover-description'));
    const recommendations = element('div', null, 'pve-hover-recommendations');
    for (const mode of [data.normal, data.hard].filter(Boolean)) {
      const line = element('p');
      line.append(element('span', mode.hard ? 'Khó: ' : 'Thường: '));
      if (mode.players != null && mode.players > 0) line.append(element('span', 'Đề cử '), element('strong', mode.players), element('span', ' người · '));
      line.append(element('span', 'Chiến lực '), element('strong', mode.recommended ?? '—'), element('span', ' (Tối thiểu '),
        element('strong', mode.minimum ?? '—'), element('span', ')'));
      recommendations.append(line);
    }
    recommendations.append(element('p', `C.Lực trợ thủ: ${data.power == null ? 'Đang đồng bộ' : data.power}`, 'pve-hover-helper-power'));
    body.append(recommendations);
    const rewards = element('section', null, 'pve-hover-rewards');
    rewards.append(element('h4', 'Thưởng bản gốc — tham khảo:'));
    for (const mode of [data.normal, data.hard].filter(Boolean)) rewards.append(this.renderTipRewards(mode));
    body.append(rewards);
    const records = element('section', null, 'pve-hover-records'); records.append(element('h4', 'Ghi chép vượt ải:'));
    const record = this.snapshot?.pve?.lastRecord;
    for (const mode of [data.normal, data.hard].filter(Boolean)) {
      let recordText = 'Chưa tải kỷ lục · bấm vào màn để xem';
      if (Number(record?.mapId) === mode.mapId) {
        if (Number(record.passTime) > 0 && Number(record.useTime) > 0) {
          const seconds = Math.floor(Number(record.useTime));
          recordText = `${String(Math.floor(seconds / 60)).padStart(2, '0')}'${String(seconds % 60).padStart(2, '0')}s`;
        } else recordText = 'Chưa có kỷ lục';
      }
      const grade = pveGrade(mode.hard ? data.hardGrade : data.grade);
      records.append(element('p', `${mode.hard ? 'Khó offline' : 'Thường'}: ${recordText}`
        + (grade === '—' ? '' : ` · Hạng ${grade}`), 'pve-hover-record-line'));
    }
    body.append(records);
    const requirements = element('section', null, 'pve-hover-requirements'); requirements.append(element('h4', 'Điều kiện mở:'));
    for (const requirement of data.requirements) {
      const previous = this.cards.find(row => row.mapId === requirement.value);
      const label = requirement.kind === 'previous' ? `Qua ải PB: ${previous?.name || `Màn ${requirement.value}`}`
        : requirement.kind === 'level' ? `Cấp nhân vật: ${requirement.value}` : `Hoàn thành nhiệm vụ ${requirement.value}`;
      const mark = requirement.passed == null ? '?' : requirement.passed ? '✓' : '✗';
      requirements.append(element('p', `${mark} ${label}`, requirement.passed == null ? 'is-unknown' : requirement.passed ? 'is-met' : 'is-unmet'));
    }
    if (!data.cityKnown) requirements.append(element('p', 'Chưa nhận trạng thái mở khóa từ máy chủ.', 'is-unknown'));
    else if (!data.requirements.length || (!data.unlocked && data.requirements.every(row => row.passed === true))) requirements.append(element('p',
      data.unlocked ? '✓ Màn đã mở.' : 'Điều kiện chưa được máy chủ xác nhận.', data.unlocked ? 'is-met' : 'is-unknown'));
    if (data.hard) requirements.append(element('p', `${data.hardUnlocked ? '✓' : data.cityKnown ? '✗' : '?'} Khó: mở và hoàn thành màn thường này.`,
      !data.cityKnown ? 'is-unknown' : data.hardUnlocked ? 'is-met' : 'is-unmet'));
    if (!card.supported) requirements.append(element('p', 'Thiếu cấu hình / tài nguyên gốc.', 'is-unmet'));
    body.append(requirements, element('p', 'PvE đơn; khó offline dùng bản đồ và cơ chế thường với chỉ số riêng. Tổ đội chưa mở. '
      + 'Thưởng và thể lực phía trên là dữ liệu tham khảo bản gốc; phần thưởng thực tế do máy chủ kết toán.', 'pve-hover-scope'));
    return tip;
  }
  renderTipRewards(mode) {
    const row = element('div', null, `pve-hover-reward-row${mode.hard ? ' is-hard' : ''}`);
    row.dataset.mapId = String(mode.mapId);
    const modeCell = element('div', null, 'pve-hover-reward-mode');
    modeCell.append(element('b', mode.hard ? 'KHÓ' : 'THƯỜNG'));
    if (mode.completedToday != null) modeCell.append(element('span', mode.completedToday ? 'HÔM NAY ✓' : 'HÔM NAY',
      'pve-hover-today' + (mode.completedToday ? ' is-complete' : '')));
    modeCell.append(element('span', mode.thew == null ? 'Chưa có mức Thể lực' : `Cần ${mode.thew} Thể lực`, 'pve-hover-thew'));
    row.append(modeCell);
    for (let index = 0; index < 4; index++) {
      const id = mode.itemIds[index], item = this.tipTables.companions.items.get(Number(id));
      const box = element('div', null, 'pve-hover-reward-item'); box.dataset.itemId = String(id || 0);
      if (id && item) {
        const name = nativeText(this.assets?.garage?.items?.[id]?.name || this.localized(item.szName)) || `Vật phẩm ${id}`;
        const icon = this.asset(`zh_CN/icon/item/${item.szIconPath1 || ''}`);
        if (icon) box.append(assetImage(icon, name, 'pve-hover-reward-icon'));
        else box.append(element('span', 'Chưa có ảnh gốc', 'pve-hover-reward-missing'));
        box.append(element('span', name, 'pve-hover-reward-name')); box.title = name;
      } else if (id) box.append(element('span', `Thiếu dữ liệu vật phẩm ${id}`, 'pve-hover-reward-missing'));
      else box.classList.add('is-empty');
      row.append(box);
    }
    return row;
  }
  dispose() {
    if (!this.disposed) {
      this.disposed = true; this.epoch++; this.snapshot = null;
      this.roomDialog = null; this.pending = ''; this.onInteractionLock(false);
      this.roomView?.dispose(); this.roomView = null;
      this.clearTipBindings();
      if (this.motionRequest) globalThis.cancelAnimationFrame?.(this.motionRequest);
      this.motionRequest = 0; this.markerStamp = null; this.markerElapsed = 0;
      this.startGameMarker = null; this.markerMapId = null;
      this.tipResizeObserver?.disconnect(); this.surfaceObserver?.disconnect();
      this.motionPreference?.removeEventListener?.('change', this.onMotionPreference);
      document.removeEventListener('keydown', this.onKeyboardInput, true);
      document.removeEventListener('visibilitychange', this.onTipVisibility);
      globalThis.removeEventListener?.('blur', this.onTipWindowBlur);
      globalThis.removeEventListener?.('focus', this.onTipWindowFocus);
      globalThis.removeEventListener?.('resize', this.onTipResize);
      globalThis.visualViewport?.removeEventListener?.('resize', this.onTipResize);
      globalThis.visualViewport?.removeEventListener?.('scroll', this.onTipResize);
      this.style.removeEventListener('load', this.onTipResize);
      this.content.removeEventListener('pointerdown', this.onPointerInput, true);
      this.content.removeEventListener('keydown', this.onKeyDown); this.host.replaceChildren();
    }
  }
}
