import {element, actionButton, assetImage, numberText} from './m8_ui_helpers.js';
import {createNativePanel} from './m81_native_panel.js';
import {companionTables, companionConfig, companionAttributes, companionProgress,
  companionFeedQuote, companionUpgradeQuote, companionTransferQuote, companionPercent} from './m81314_companion_math.js';
import {M81315CompanionFeedback} from './m81315_companion_feedback.js';
import {PANEL_ART} from './m81316_panel_art.js';
import {companionItemName, createCompanionTooltip, createMaterialTooltip, M81317TooltipLayer} from './m81317_companion_tooltip.js';
import {M81332EconomyDialog,economyProtection,economyReceiptText} from './m81332_economy_ui.js';

const TABS = [['feed', 'Lên cấp', 'word_upgrade_t.png'], ['strength', 'Cường hóa', 'word_strengthen_t.png'],
  ['rank', 'Tăng sao', 'word_upclass_t.png'], ['transfer', 'Chuyển đổi', 'word_convert_t.png']];
const STAT_NAMES = {hp: 'HP', attack: 'TC', penetration: 'XG', armor: 'PT'};
// This question-mark slot is already in the immutable M84 native catalog.
const EMPTY_SLOT = Object.freeze({url: '/html5/assets_m84/panels/CharModuleFactory_28_a06532830e9a.png', width: 55, height: 55});
const DRAG_TYPE = 'application/x-bangbang-helper';
// Faithful Vietnamese text of HelperLabInstructionsFrame (native LEVEL, STTH,
// UPGRADE, CONVERT and HELPER states). No rate/price is hard-coded in help.
const HELP_TEXT = Object.freeze({
  feed: [
    'Cấp Trợ Thủ càng cao, thuộc tính cơ bản càng lớn.',
    'Dùng vật liệu tăng cấp “Chip Siêu Dẫn” để tăng cấp Trợ Thủ.',
    'Tư chất Trợ Thủ càng cao, giới hạn cấp càng cao.',
    '“Chip Siêu Dẫn” có nhiều cấp; chip càng tốt cung cấp càng nhiều EXP.',
    'Có thể nhận “Chip Siêu Dẫn” qua phụ bản.',
  ],
  strength: [
    'Trên cơ sở tăng cấp Trợ Thủ, số lần cường hóa càng cao, thuộc tính cường hóa càng lớn.',
    'Các loại Trợ Thủ có thuộc tính cường hóa khác nhau; cường hóa càng cao, đặc điểm Trợ Thủ càng nổi bật.',
    'Dùng vật liệu “Tinh thể cường hóa” để cường hóa Trợ Thủ.',
    'Cường hóa chưa thành công sẽ tăng mức hoàn thành; mức hoàn thành càng cao, năng lực nhận được càng cao.',
    'Tư chất Trợ Thủ càng cao, giới hạn cường hóa càng cao.',
    'Vật liệu cường hóa có nhiều cấp; cấp vật liệu cần dùng tùy theo mức cường hóa hiện tại.',
    'Có thể nhận vật liệu cường hóa qua phụ bản hoặc mua ở Shop.',
  ],
  rank: [
    'Trên cơ bản tăng lv Trợ Thủ, tăng theo cấp sao, sẽ tăng lượng lớn thuộc tính cơ bản.',
    'Dùng vật liệu tăng sao “Hạt Nhân Vạn Năng”, tăng cấp sao Trợ Thủ.',
    'Tăng sao thất bại sẽ tăng mức hoàn thành tăng sao của Trợ Thủ; mức đó càng cao, năng lực nhận được càng cao.',
    'Tư chất trợ thủ càng cao, giới hạn tăng sao càng cao.',
    'Vật liệu tăng sao có nhiều cấp; cấp vật liệu cần dùng tùy theo cấp sao Trợ Thủ hiện tại.',
    'Có thể nhận hạt nhân qua phụ bản, đổi bằng đủ số lượng “Mảnh Hạt Nhân” hoặc mua ở Shop.',
    '“Mảnh Hạt Nhân” nhận qua phụ bản.',
  ],
  transfer: [
    'Chuyển đổi hoán đổi cấp, số lần cường hóa và cấp sao giữa hai Trợ Thủ khác nhau.',
    'Chuyển đổi cần tiêu hao vật liệu “Bộ lưu trữ thông tin”.',
    'Có thể đổi vật liệu chuyển đổi bằng đủ số lượng mảnh lưu trữ hoặc mua ở Shop.',
  ],
  general: [
    'Tư chất Trợ Thủ: tư chất càng cao, Trợ Thủ càng tốt.',
    'Thanh cường hóa: số lần cường hóa càng cao, đặc điểm năng lực Trợ Thủ càng nổi bật.',
    'Cấp sao Trợ Thủ: sao càng cao, năng lực được tăng càng nhiều.',
    'Cấp Trợ Thủ: cấp càng cao, thuộc tính càng cao.',
    'Có thể nhận Trợ Thủ qua phụ bản.',
  ],
});
const progressText = item => {
  const p = companionProgress(item);
  return `Cấp ${p.level} · EXP ${numberText(p.exp)} · Cường hóa +${p.upgradeLevel} (${numberText(p.upgradeCost)}) · Sao ${p.rank} (${numberText(p.rankCost)})`;
};

/** Preview only. M32 opts in to exactly one level with the minimum chip count;
 * surplus EXP remains stored. Native Flash C156 keeps its existing behavior. */
export function companionPreview(tables, item, booster, tab, quote) {
  const after = {...item, ...companionProgress(item)};
  if (tab === 'feed' && quote.allowed) {
    after.exp = quote.remainder; after.level = quote.nextLevel;
  } else if ((tab === 'strength' || tab === 'rank') && quote.row && !quote.capped) {
    const level = tab === 'strength' ? 'upgradeLevel' : 'rank';
    const progress = tab === 'strength' ? 'upgradeCost' : 'rankCost';
    after[level]++; after[progress] = 0;
  }
  return after;
}

/** HelperFrame's 818×600 workspace and native art; unsupported source joins are
 * visible, not guessed. This view never writes authoritative snapshot fields. */
export class M81314Companions {
  constructor({host, client, assets, catalog, run, onClose = () => {}}) {
    this.host = host; this.client = client; this.assets = assets; this.catalog = catalog || {};
    this.tables = companionTables(this.catalog); this.run = run || (work => work()); this.onClose = onClose;
    this.snapshot = null; this.identity = null; this.connectionGeneration = client.generation;
    this.epoch = 0; this.disposed = false; this.pending = ''; this.notice = ''; this.tab = 'feed';
    this.selectedUuid = ''; this.chipUuid = ''; this.transferUuid = ''; this.doses = []; this.confirmation = null;
    this.selectionInitialized = false; this.chipInitialized = false;
    this.materialUuids = {strength: '', rank: '', transfer: ''};
    this.petTarget = 'primary'; this.doseTarget = -1; this.helpOpen = ''; this.helpReturnFocus = '';
    this.drag = null; this.dragSerial = 0;
    this.style = element('link'); this.style.rel = 'stylesheet';
    const styleUrl = new URL('./m81314_companions.css', import.meta.url);
    styleUrl.search = new URL(import.meta.url).search;
    this.style.href = styleUrl.href;
    this.content = element('section', null, 'm81314-companions'); this.content.setAttribute('aria-label', 'Trợ thủ');
    this.content.dataset.testid = 'companion-panel';
    this.onKeyDown = event => {
      const dialog = this.content.querySelector('[role="alertdialog"],[role="dialog"]');
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.requestClose(); }
      if (event.key !== 'Tab' || !dialog) return;
      const choices = [...dialog.querySelectorAll('button:not(:disabled),select:not(:disabled),[tabindex="0"]')];
      const first = choices[0], last = choices.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (!dialog.contains(document.activeElement) || (event.shiftKey && document.activeElement === first)
          || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      }
    };
    this.content.addEventListener('keydown', this.onKeyDown);
    this.panelAssets = {...assets?.panels?.assets, ...assets?.ui?.assets};
    const title = this.asset(this.catalog.ui?.helper?.['title_helper_t.png']);
    if (title) this.panelAssets['m81314.helper.title'] = title;
    if (this.panelAssets['box.bk_lt']) {
      try {
        this.panel = createNativePanel({assets: this.panelAssets, width: 818, height: 600, kind: 'box1', state: 'BOTTOM_BAR',
          ...(title ? {title: {asset: 'm81314.helper.title', x: (818 - title.width) / 2, y: 20, label: 'Trợ thủ'}} : {}),
          ...(this.panelAssets['public.close'] ? {close: {asset: 'public.close', x: 779, y: 15, label: 'Đóng trợ thủ'},
            onClose: () => this.requestClose()} : {})});
        this.panel.root.classList.add('m81314-helper-frame'); this.panel.content.append(this.content);
      } catch (error) { this.frameError = error.message; }
    }
    this.host.replaceChildren(this.style, this.panel?.root || this.content);
    if (!this.panel) this.content.classList.add('is-fallback');
    this.tooltips = new M81317TooltipLayer({host: this.host, scaleRoot: this.host.parentElement,
      isCurrent: () => this.live() && !this.helpOpen && !this.confirmation && !this.drag
        && this.snapshot?.phase === 'ready' && ['lobby', 'room'].includes(this.snapshot?.play?.phase)});
    this.operationSerial = 0; this.feedbackError = '';
    this.feedback = new M81315CompanionFeedback({host: this.host, catalog: this.catalog,
      isCurrent: () => this.live() && this.snapshot?.phase === 'ready'
        && ['lobby', 'room'].includes(this.snapshot.play?.phase),
      onUnavailable: message => { if (this.live()) { this.feedbackError = message; this.render(); } }});
  }

  asset(value) {
    if (!value) return null;
    const result = typeof value === 'string' ? this.catalog.assets?.[value] || this.assets?.get?.(value)
      : value.assetRef ? this.catalog.assets?.[value.assetRef] : value;
    return result?.url && /\.(?:png|jpe?g|webp)(?:$|[?#])/i.test(result.url) ? result : null;
  }
  get bag() { return (this.snapshot?.meta?.containers?.[3]?.items || []).filter(item => item.count > 0); }
  get owned() { return (this.snapshot?.meta?.containers?.[5]?.items || []).filter(item => item.count > 0); }
  get selected() { return this.owned.find(item => item.uuid === this.selectedUuid); }
  get other() { return this.owned.find(item => item.uuid === this.transferUuid); }
  get chip() { return this.bag.find(item => item.uuid === this.chipUuid); }
  get selectedDoses() { return this.doses.filter(Boolean); }
  get silver() { return this.snapshot?.meta?.character?.currency?.golden || 0; }
  get mutable() {
    return !this.disposed && !this.pending && this.snapshot?.phase === 'ready' && !this.snapshot.play?.busy
      && !this.snapshot.economy?.pending
      && ['lobby', 'room'].includes(this.snapshot.play?.phase);
  }
  config(item) { return companionConfig(this.catalog, this.tables, item); }
  name(item) {
    return this.itemName(item?.templateId);
  }
  itemName(templateId) {
    return companionItemName(this.catalog, this.assets, templateId);
  }
  icon(item, portrait = false) {
    const entry = this.catalog.companions?.[item?.templateId];
    const row = this.tables.items.get(Number(item?.templateId));
    return this.asset(portrait ? entry?.icon : entry?.inventoryIcon || entry?.icon)
      || this.asset(`zh_CN/icon/item/${row?.szIconPath1 || ''}`);
  }
  live(epoch = this.epoch) {
    return !this.disposed && epoch === this.epoch && this.client.generation === this.connectionGeneration;
  }
  button(label, work, options = {}) {
    const epoch = this.epoch;
    const button = actionButton(label, () => this.run(async () => {
      if (!this.live(epoch)) throw new Error('Phiên trợ thủ đã thay đổi; hãy mở lại bảng.');
      if (!button.isConnected) return;
      return work();
    }), options);
    return button;
  }
  requestClose() {
    if (this.pending || !this.live()) return;
    if (this.helpOpen) { this.closeHelp(); return; }
    if (this.confirmation) { this.confirmation = null; this.render(); return; }
    this.onClose();
  }

  update(snapshot) {
    if (this.disposed) return;
    const identity = snapshot.accountId ?? snapshot.meta?.character?.accountId ?? null;
    if (identity !== this.identity || this.client.generation !== this.connectionGeneration) {
      this.economyDialog?.dispose();
      this.epoch++; this.identity = identity; this.connectionGeneration = this.client.generation;
      this.selectedUuid = ''; this.chipUuid = ''; this.transferUuid = ''; this.doses = [];
      this.selectionInitialized = false; this.chipInitialized = false;
      this.materialUuids = {strength: '', rank: '', transfer: ''};
      this.petTarget = 'primary'; this.doseTarget = -1; this.helpOpen = ''; this.drag = null;
      this.pending = ''; this.notice = ''; this.confirmation = null;
      this.feedbackError = ''; this.feedback.reset();
    }
    this.snapshot = snapshot;
    this.economyDialog?.update(snapshot);
    // Default once, not on every server packet: a locally cleared slot stays
    // empty, and clearing a lab slot never sends equip/unequip to the server.
    if (!this.selectionInitialized && this.owned.length) {
      this.selectedUuid = (this.owned.find(item => item.uuid === snapshot.companions?.activeUuid) || this.owned[0]).uuid;
      this.selectionInitialized = true; this.autoSelectMaterial();
    } else if (!this.selected) this.selectedUuid = '';
    if (!this.chipInitialized && this.bag.some(item => this.itemType(item) === 37)) {
      this.chipUuid = this.bag.find(item => this.itemType(item) === 37).uuid; this.chipInitialized = true;
    } else if (!this.chip || this.itemType(this.chip) !== 37) this.chipUuid = '';
    if (!this.other || this.other.uuid === this.selectedUuid) this.transferUuid = '';
    const counts = new Map();
    this.doses = this.doses.slice(0, 3).map(uuid => {
      const item = this.bag.find(row => row.uuid === uuid), used = (counts.get(uuid) || 0) + 1;
      counts.set(uuid, used);
      return item && used <= item.count && this.itemType(item) === 39 ? uuid : '';
    });
    for (const kind of ['strength', 'rank', 'transfer']) {
      const material = this.bag.find(row => row.uuid === this.materialUuids[kind]);
      if (!material || Number(material.templateId) !== this.requiredMaterialId(kind)) this.materialUuids[kind] = '';
    }
    if (this.confirmation && (this.confirmation.kind === 'feed' ? this.confirmation.fingerprint !== this.feedFingerprint() : this.confirmation !== this.transferFingerprint())) {
      this.confirmation = null; this.notice = 'Tiến trình hoặc nguyên liệu đã đổi. Hãy kiểm tra rồi xác nhận lại.';
    }
    const key = JSON.stringify([identity, this.client.generation, snapshot.phase, snapshot.play?.phase,
      snapshot.play?.busy, snapshot.companions, snapshot.economy, snapshot.meta?.character?.currency,
      snapshot.meta?.containers?.[3], snapshot.meta?.containers?.[5]]);
    if (key !== this.renderKey) { this.renderKey = key; this.render(); }
  }

  itemType(item) { return Number(this.tables.items.get(Number(item?.templateId))?.nType); }
  requiredMaterialId(tab = this.tab) {
    if (tab === 'transfer') return 4000001;
    const item = this.selected, config = this.config(item);
    if (!config || !['strength', 'rank'].includes(tab)) return 0;
    return companionUpgradeQuote(this.tables, item, config.booster, tab === 'strength' ? 1 : 2,
      this.bag, this.silver, []).itemId || 0;
  }
  chosenMaterial(tab = this.tab) {
    const required = this.requiredMaterialId(tab);
    return this.bag.find(row => row.uuid === this.materialUuids[tab] && Number(row.templateId) === required);
  }
  autoSelectMaterial() {
    const required = this.requiredMaterialId();
    if (required) this.materialUuids[this.tab] = this.bag.find(row => Number(row.templateId) === required)?.uuid || '';
  }
  canSelect() { return this.mutable && this.live() && !this.confirmation && !this.helpOpen; }
  localChange(work) {
    if (!this.canSelect()) return false;
    work(); this.confirmation = null; this.notice = ''; this.drag = null; this.render(); return true;
  }
  setPetSlot(slot, uuid) {
    if (!['primary', 'secondary'].includes(slot) || (slot === 'secondary' && this.tab !== 'transfer')) return false;
    const item = this.owned.find(row => row.uuid === uuid);
    // A quarantined entry may be selected for inspection, but config() keeps
    // its operations disabled and drag/drop never accepts it as a valid pet.
    if (uuid && !item) return false;
    return this.localChange(() => {
      const key = slot === 'primary' ? 'selectedUuid' : 'transferUuid';
      const otherKey = slot === 'primary' ? 'transferUuid' : 'selectedUuid';
      const previous = this[key];
      // Dropping a pet already in the opposite box swaps the local selections.
      if (uuid && this[otherKey] === uuid) this[otherKey] = previous || '';
      this[key] = uuid || ''; this.selectionInitialized = true;
      this.doses = []; this.doseTarget = -1;
      if (slot === 'primary' || this[otherKey] !== uuid) this.autoSelectMaterial();
      this.petTarget = !this.selectedUuid ? 'primary' : !this.transferUuid ? 'secondary' : slot;
    });
  }
  pickPet(uuid) {
    const target = this.tab !== 'transfer' ? 'primary'
      : !this.selectedUuid ? 'primary' : !this.transferUuid ? 'secondary' : this.petTarget;
    if (this.tab === 'transfer' && (uuid === this.selectedUuid || uuid === this.transferUuid)) return false;
    return this.setPetSlot(target, uuid);
  }
  materialTarget(item) {
    if (this.tab === 'feed' && this.itemType(item) === 37) return 'feed';
    if (Number(item.templateId) === this.requiredMaterialId()) return this.tab;
    if (this.tab === 'rank' && this.itemType(item) === 39) {
      const index = this.doseTarget >= 0 && !this.doses[this.doseTarget] ? this.doseTarget
        : [0, 1, 2].find(index => !this.doses[index]);
      return index === undefined ? '' : 'dose-' + index;
    }
    return '';
  }
  acceptsMaterial(target, item) {
    if (!item || !this.bag.some(row => row.uuid === item.uuid)) return false;
    if (target === 'feed') return this.tab === 'feed' && this.itemType(item) === 37;
    if (/^dose-[0-2]$/.test(target)) return this.tab === 'rank' && this.itemType(item) === 39;
    return target === this.tab && ['strength', 'rank', 'transfer'].includes(target)
      && Number(item.templateId) === this.requiredMaterialId(target);
  }
  placeMaterial(target, uuid, source = '') {
    const item = this.bag.find(row => row.uuid === uuid);
    if (!this.acceptsMaterial(target, item)) return false;
    let doses;
    if (target.startsWith('dose-')) {
      const index = Number(target.slice(5)); doses = [...this.doses];
      if (/^dose-[0-2]$/.test(source)) {
        const origin = Number(source.slice(5));
        if (doses[origin] !== uuid) return false;
        doses[origin] = doses[index] || '';
      }
      doses[index] = uuid;
      const used = new Map();
      for (const selected of doses.filter(Boolean)) {
        const count = (used.get(selected) || 0) + 1; used.set(selected, count);
        if (count > Number(this.bag.find(row => row.uuid === selected)?.count || 0)) return false;
      }
    }
    return this.localChange(() => {
      if (target === 'feed') { this.chipUuid = uuid; this.chipInitialized = true; }
      else if (doses) { this.doses = doses; this.doseTarget = -1; }
      else this.materialUuids[target] = uuid;
    });
  }
  clearMaterial(target) {
    return this.localChange(() => {
      if (target === 'feed') { this.chipUuid = ''; this.chipInitialized = true; }
      else if (/^dose-[0-2]$/.test(target)) { this.doses[Number(target.slice(5))] = ''; this.doseTarget = Number(target.slice(5)); }
      else if (target in this.materialUuids) this.materialUuids[target] = '';
    });
  }
  bindDrag(node, kind, uuid, source = '') {
    node.draggable = !!uuid && this.canSelect();
    const epoch = this.epoch;
    node.addEventListener('dragstart', event => {
      if (!node.isConnected || !this.live(epoch) || !this.canSelect() || !uuid) { event.preventDefault(); return; }
      this.tooltips.hide();
      const data = {kind, uuid, source, epoch, generation: this.connectionGeneration, token: ++this.dragSerial, tab: this.tab};
      this.drag = data;
      if (!event.dataTransfer) { this.drag = null; event.preventDefault(); return; }
      event.dataTransfer.effectAllowed = 'copyMove';
      event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(data));
    });
    node.addEventListener('dragend', () => { this.drag = null; this.clearDropHighlights(); });
  }
  readDrag(event) {
    if (!this.canSelect() || !this.drag) return null;
    let data;
    try { data = JSON.parse(event.dataTransfer?.getData(DRAG_TYPE) || 'null'); } catch { return null; }
    if (!data || JSON.stringify(data) !== JSON.stringify(this.drag) || data.epoch !== this.epoch
      || data.generation !== this.connectionGeneration || data.tab !== this.tab) return null;
    return data;
  }
  clearDropHighlights() {
    for (const node of this.content.querySelectorAll('.is-drop-target')) node.classList.remove('is-drop-target');
  }
  bindDrop(node, kind, target) {
    const accepts = data => data && data.kind === kind && (kind === 'pet'
      ? !!this.config(this.owned.find(row => row.uuid === data.uuid))
      : this.acceptsMaterial(target, this.bag.find(row => row.uuid === data.uuid)));
    node.addEventListener('dragover', event => {
      // Browsers hide drag data until drop. The in-memory token still identifies
      // the drag initiated by this exact panel, account and render generation.
      if (node.isConnected && this.canSelect() && accepts(this.drag) && this.drag.epoch === this.epoch
        && this.drag.generation === this.connectionGeneration && this.drag.tab === this.tab) {
        event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = this.drag.source ? 'move' : 'copy';
        node.classList.add('is-drop-target');
      }
    });
    node.addEventListener('dragleave', () => node.classList.remove('is-drop-target'));
    node.addEventListener('drop', event => {
      const data = this.readDrag(event); this.clearDropHighlights();
      if (!node.isConnected || !accepts(data)) return;
      event.preventDefault(); event.stopPropagation();
      if (kind === 'pet') this.setPetSlot(target, data.uuid);
      else this.placeMaterial(target, data.uuid, data.source);
      this.drag = null;
    });
  }

  async perform(label, work, message, feedback = null) {
    if (!this.mutable || !this.live() || this.helpOpen || this.confirmation) throw new Error('Về sảnh hoặc phòng chờ và đợi đồng bộ để nuôi trợ thủ.');
    const epoch = this.epoch, requestId = ++this.operationSerial;
    this.pending = label; this.notice = ''; this.feedbackError = ''; this.render();
    if (feedback) this.feedback.prepare(feedback.action);
    try {
      const packet = await work();
      if (!this.live(epoch)) return packet;
      this.notice = typeof message === 'function' ? message(packet) : message;
      if (feedback && this.owned.some(item => item.uuid === feedback.uuid))
        this.feedback.confirm(packet, feedback, requestId);
      return packet;
    } catch (error) {
      if (this.live(epoch)) this.notice = error.message || 'Yêu cầu chưa được máy chủ xác nhận.';
      throw error;
    } finally {
      if (this.live(epoch)) { this.pending = ''; this.render(); }
    }
  }
  requireSelected() {
    const item = this.selected, config = this.config(item);
    if (!config) throw new Error('Trợ thủ không còn trong túi hoặc thiếu cấu hình gốc hợp lệ.');
    return {item, config};
  }
  equip() {
    const {item} = this.requireSelected();
    return this.perform('Trang bị / tháo', () => this.client.equipCompanion(item.uuid), 'Đã nhận xác nhận trang bị từ máy chủ.');
  }
  feedFingerprint() { return JSON.stringify([this.selected, this.chip, this.bag]); }
  confirmFeed() {
    if (!this.mutable || this.confirmation?.kind !== 'feed') return;
    const valid = this.confirmation.fingerprint === this.feedFingerprint();
    this.confirmation = null;
    if (!valid) { this.notice = 'Tiến trình hoặc nguyên liệu đã đổi. Hãy xác nhận lại.'; this.render(); return; }
    return this.feed(true);
  }
  feed(accepted = false) {
    const {item, config} = this.requireSelected(), chip = this.chip;
    const quote = companionFeedQuote(this.tables, item, config.booster, chip, this.bag);
    if (!quote.allowed) throw new Error(quote.reason);
    if (quote.discardedExp && !accepted) {
      if (!this.mutable || !this.live() || this.confirmation) return;
      this.confirmation = {kind:'feed',fingerprint:this.feedFingerprint(),quote}; this.render(); return;
    }
    return this.perform('Tăng đúng một cấp', () => this.client.levelCompanion(item.uuid, chip?.uuid, quote, accepted ? quote.discardedExp : 0),
      packet => economyReceiptText(packet.economyReceipt), {action: 31, uuid: item.uuid});
  }
  splitCandidates(all = false) {
    const activeUuid = this.snapshot?.companions?.activeUuid;
    if (!all) return this.selected && this.config(this.selected) && !economyProtection(this.selected, activeUuid, true) ? [this.selected] : [];
    // HelperView.doConfirmSplitAllHelper: only ordinary quality<=1 below the
    // currently equipped helper's aptitude. Never silently include rare pets.
    const active = this.owned.find(item => item.uuid === activeUuid), aptitude = Number(this.config(active)?.booster.nAptitude || 0);
    return this.owned.filter(item => this.config(item) && !economyProtection(item, activeUuid, true)
      && Number(this.tables.items.get(Number(item.templateId))?.iQuality || 0) <= 1
      && Number(this.config(item)?.booster.nAptitude) < aptitude);
  }
  split(all = false) {
    if (!this.live() || this.pending || this.economyDialog) return;
    const items = this.splitCandidates(all);
    if (!this.snapshot?.economy?.pending && (!this.mutable || !items.length)) throw new Error('Không có trợ thủ đủ điều kiện tách; đang dùng/khóa bảo vệ được giữ nguyên.');
    this.economyDialog = new M81332EconomyDialog({client:this.client,kind:'dismantle',items,
      name:item=>this.name(item),onComplete:receipt=>{if(this.live()){this.notice=economyReceiptText(receipt);this.render();}},
      onClose:()=>{this.economyDialog=null;}});
  }
  upgrade(kind) {
    const {item, config} = this.requireSelected(), doses = kind === 2 ? this.selectedDoses : [];
    const quote = companionUpgradeQuote(this.tables, item, config.booster, kind, this.bag, this.silver, doses);
    if (!quote.allowed) throw new Error(quote.reason);
    if (!this.chosenMaterial(kind === 1 ? 'strength' : 'rank')) throw new Error('Chọn vật liệu tương ứng từ Đạo cụ vào ô nguyên liệu.');
    return this.perform(kind === 1 ? 'Cường hóa' : 'Tăng sao', () => kind === 1
      ? this.client.strengthenCompanion(item.uuid) : this.client.rankCompanion(item.uuid, doses), packet => {
      if (kind === 2) this.doses = [];
      return packet?.success === 0 || packet?.success === false
        ? 'Chưa nâng thành công. Tiến độ bảo hiểm được cập nhật từ máy chủ.'
        : 'Đã nhận kết quả nâng từ máy chủ.';
    }, {action: kind === 1 ? 32 : 33, uuid: item.uuid});
  }
  transferQuote() {
    return companionTransferQuote(this.tables, this.selected, this.config(this.selected)?.booster,
      this.other, this.config(this.other)?.booster, this.bag);
  }
  transferFingerprint() {
    if (!this.selected || !this.other) return '';
    const quote = this.transferQuote();
    return JSON.stringify([this.selected.uuid, companionProgress(this.selected), this.other.uuid,
      companionProgress(this.other), quote.amount, quote.owned, quote.allowed]);
  }
  prepareTransfer() {
    if (!this.mutable) throw new Error('Đợi đồng bộ xong trước khi chuyển đổi.');
    this.requireSelected(); const quote = this.transferQuote();
    if (!quote.allowed) throw new Error(quote.reason);
    if (!this.chosenMaterial('transfer')) throw new Error('Chọn vật liệu chuyển đổi từ Đạo cụ.');
    this.confirmation = this.transferFingerprint(); this.render();
  }
  transfer() {
    const quote = this.transferQuote();
    if (!quote.allowed || !this.chosenMaterial('transfer') || !this.confirmation || this.confirmation !== this.transferFingerprint())
      throw new Error(quote.reason || 'Tiến trình đã đổi; hãy xác nhận lại chuyển đổi.');
    const leftUuid = this.selected.uuid, rightUuid = this.other.uuid; this.confirmation = null;
    return this.perform('Chuyển đổi', () => this.client.transferCompanion(leftUuid, rightUuid),
      'Đã chuyển đổi toàn bộ tiến trình theo xác nhận máy chủ.', {action: 34, uuid: leftUuid});
  }

  section(title, className) {
    const node = element('section', null, className); node.append(element('h3', title)); return node;
  }
  art(key, className = '', x = null, y = null) {
    const source = PANEL_ART[key];
    if (!source) return element('span', '', className);
    const image = assetImage(source, '', className);
    image.style.width = source.width + 'px'; image.style.height = source.height + 'px';
    if (x !== null) Object.assign(image.style, {position: 'absolute', left: x + 'px', top: y + 'px'});
    return image;
  }
  nativeButton(label, work, options = {}) {
    const {skin = 'public.button_window_orange', word, ...buttonOptions} = options;
    const button = this.button(label, work, buttonOptions), art = PANEL_ART[skin] || this.panelAssets[skin];
    button.setAttribute('aria-label', label);
    button.classList.add('helper-native-button');
    if (art) button.style.backgroundImage = 'url("' + art.url + '")';
    if (word && PANEL_ART[word]) button.replaceChildren(this.art(word));
    return button;
  }
  surface(className, x, y, width, height) {
    let node;
    try { node = createNativePanel({assets: this.panelAssets, width, height, kind: 'box3', state: 'LIGHT_BG'}).root; }
    catch { node = element('div', null, 'helper-surface-fallback'); }
    node.classList.add(className); node.setAttribute('aria-hidden', 'true');
    Object.assign(node.style, {position: 'absolute', left: x + 'px', top: y + 'px', width: width + 'px', height: height + 'px'});
    return node;
  }
  helperCard(item, config, {size = 106, preview = false, className = '', slot = 'primary'} = {}) {
    const label = slot === 'secondary' ? 'Trợ thủ thứ hai' : this.tab === 'transfer' ? 'Trợ thủ thứ nhất' : 'Trợ thủ';
    const card = this.button('', () => {
      if (item) this.setPetSlot(slot, '');
      else this.localChange(() => { this.petTarget = slot; });
    }, {disabled: !this.canSelect(), className: 'helper-lab-card helper-size-' + size + ' ' + className,
      testId: preview ? 'companion-slot-preview' : 'companion-slot-' + slot});
    card.setAttribute('aria-label', item ? `${label}: ${this.name(item)}. Bấm để gỡ khỏi ô, không tháo trang bị.`
      : `${label}: ô trống. Chọn hoặc kéo Trợ thủ từ túi vào đây.`);
    card.classList.toggle('is-slot-target', this.tab === 'transfer' && this.petTarget === slot);
    this.bindDrop(card, 'pet', slot);
    this.bindDrag(card, 'pet', item?.uuid, slot);
    const epoch = this.epoch;
    card.addEventListener('keydown', event => {
      if (card.isConnected && this.live(epoch) && item && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault(); this.setPetSlot(slot, '');
      }
    });
    card.append(this.art('helper.box_' + size, 'helper-card-background'));
    card.append(this.art('helper.box_totem_' + size, 'helper-card-totem'));
    if (!item) { card.append(element('span', label.toLocaleUpperCase('vi-VN'), 'helper-slot-placeholder')); return card; }
    const icon = this.icon(item, true);
    if (icon) card.append(assetImage(icon, this.name(item), 'helper-card-portrait'));
    else card.append(element('span', 'Chưa có ảnh gốc', 'helper-no-icon'));
    const p = companionProgress(item);
    // HelperBoxProxy.refreshHelperInfo: the upper-left numeral is aptitude,
    // not level. Level has its own LV label below the feed box.
    card.append(element('span', numberText(config?.booster.nAptitude), 'helper-card-level'));
    const stars = element('span', null, 'helper-card-stars');
    stars.append(this.art('personpve.star'), element('span', p.rank + '/' + (config?.booster.iRankLimit ?? '—')));
    card.append(stars);
    const bar = this.art(size === 106 ? 'helper.strengthenbar_xl' : 'helper.strengthenbar_l', 'helper-card-strength');
    bar.title = 'Cường hóa +' + p.upgradeLevel;
    const cap = Number(config?.booster.iUpLevelLimit || 0), portion = cap ? Math.min(1, p.upgradeLevel / cap) : 0;
    bar.style.clipPath = 'inset(' + ((1 - portion) * 100) + '% 0 0)'; card.append(bar);
    card.dataset.preview = String(preview);
    // HelperBoxProxy forwards HelperResultStruct for result boxes. Use the
    // same detached projection as the right card/stat rows, not its owned UUID
    // lookup (which would silently put the current level/stats back in the tip).
    const previewLabel = preview ? this.tab === 'feed' ? 'Xem trước: tăng đúng 1 cấp' : 'Xem trước khi thành công' : '';
    this.tooltips.bind(card, () => {
      const owned = this.owned.find(row => row.uuid === item.uuid);
      return owned ? createCompanionTooltip({catalog: this.catalog, assets: this.assets,
        item: preview ? item : owned, previewLabel,
        activeUuid: preview ? '' : this.snapshot?.companions?.activeUuid}) : null;
    });
    return card;
  }
  statComparison(lab, item, after, config) {
    const current = companionAttributes(this.tables, item, config.booster);
    const next = companionAttributes(this.tables, after, config.booster);
    const group = element('dl', null, 'helper-stat-comparison'); group.dataset.testid = 'companion-stat-preview';
    group.setAttribute('aria-label', 'Chỉ số hiện tại và xem trước, chưa phải kết quả máy chủ');
    for (const [key, label] of Object.entries(STAT_NAMES)) {
      // Native strengthen view lists the booster's two supported attributes.
      if (this.tab === 'strength' && ![Number(config.booster.nTypeA), Number(config.booster.nTypeB)]
        .includes({hp: 4, attack: 1, penetration: 2, armor: 3}[key])) continue;
      const row = element('div', null, 'helper-stat-row'); row.style.backgroundImage = 'url("' + PANEL_ART['public.label250x28'].url + '")';
      const values = element('dd', null, 'helper-stat-values'), delta = next[key] - current[key];
      values.append(element('span', numberText(current[key]), 'helper-stat-current'),
        this.art('tank.smallwhitearrow', 'helper-stat-arrow'), element('span', numberText(next[key]), 'helper-stat-next'),
        element('span', (delta > 0 ? '+' : '') + numberText(delta), 'helper-stat-delta'));
      row.append(element('dt', label + ':'), values); group.append(row);
    }
    lab.append(group);
    lab.dataset.currentScore = String(current.score); lab.dataset.previewScore = String(next.score);
  }
  labMaterial(item, {className = '', label = '', count = '', target = '', placeholder = ''} = {}) {
    const slot = target ? this.button('', () => this.clearMaterial(target),
      {disabled: !this.canSelect(), className: 'helper-lab-material ' + className, testId: 'companion-slot-' + target})
      : element('div', null, 'helper-lab-material ' + className);
    slot.append(this.art('helper.box_60', 'helper-material-background'), this.art('helper.box_totem_60', 'helper-material-totem'));
    if (item) { const icon = this.icon(item); if (icon) slot.append(assetImage(icon, label || this.name(item), 'helper-material-portrait')); }
    else if (placeholder) slot.append(element('span', placeholder, 'helper-slot-placeholder'));
    if (count !== '') slot.append(element('span', count, 'helper-material-quantity'));
    slot.setAttribute('aria-label', (label || (item ? this.name(item) : 'Không chọn vật phẩm'))
      + (target ? item ? '. Bấm để gỡ khỏi ô.' : '. Chọn hoặc kéo vật liệu từ Đạo cụ vào đây.' : ''));
    if (target) {
      this.bindDrop(slot, 'material', target); this.bindDrag(slot, 'material', item?.uuid, target);
      const epoch = this.epoch;
      slot.addEventListener('keydown', event => {
        if (slot.isConnected && this.live(epoch) && (event.key === 'Delete' || event.key === 'Backspace')) {
          event.preventDefault(); this.clearMaterial(target);
        }
      });
    }
    if (item) this.tooltips.bind(slot, () => createMaterialTooltip({catalog: this.catalog, assets: this.assets,
      item: item.uuid ? this.bag.find(row => row.uuid === item.uuid) : item}));
    return slot;
  }
  render() {
    if (this.disposed) return;
    this.tooltips.reset(); this.drag = null;
    const focusId = this.content.contains(document.activeElement) ? document.activeElement?.dataset?.testid : null;
    const nodes = [this.surface('helper-lab-surface', 19, 83, 436, 442),
      this.surface('helper-owned-surface', 460, 82, 338, 264), this.surface('helper-material-surface', 460, 372, 338, 144)];
    if (!this.panel || !this.panelAssets['m81314.helper.title']) nodes.push(element('h2', 'Trợ thủ', 'helper-title'));
    if (!this.panel?.close) nodes.push(this.button('Đóng', () => this.requestClose(),
      {disabled: !!this.pending, className: 'helper-close', testId: 'companion-close'}));
    const tabs = element('nav', null, 'helper-tabs'); tabs.setAttribute('aria-label', 'Nuôi trợ thủ');
    for (const [id, label, word] of TABS) {
      const selected = this.tab === id, button = this.button(label, () => {
        if (this.pending || this.helpOpen) return;
        if (this.tab !== id) { this.tab = id; this.doses = []; this.doseTarget = -1; this.autoSelectMaterial(); }
        this.confirmation = null; this.notice = ''; this.petTarget = !this.selectedUuid ? 'primary' : 'secondary'; this.render();
      }, {disabled: !!this.pending, className: selected ? 'is-selected' : '', testId: `companion-tab-${id}`});
      const skin = this.asset(this.catalog.ui?.shop?.[selected ? 'shop_navItemSelected.png' : 'shop_navItem.png']);
      if (skin) button.style.backgroundImage = `url("${skin.url}")`;
      const wordArt = this.asset(this.catalog.ui?.helper?.[word]);
      if (wordArt) button.replaceChildren(assetImage(wordArt, '', 'helper-tab-word'));
      button.setAttribute('aria-label', label); button.title = label;
      button.setAttribute('aria-pressed', String(selected)); tabs.append(button);
    }
    nodes.push(tabs);
    const detail = element('section', null, 'helper-detail'); detail.dataset.testid = 'companion-detail';
    const totem = this.asset(this.catalog.ui?.helper?.['totem.jpg']);
    if (totem) detail.style.backgroundImage = `url("${totem.url}")`;
    const item = this.selected, config = this.config(item);
    detail.setAttribute('aria-label', item ? this.name(item) : 'Chọn trợ thủ');
    if (item && !config) detail.append(element('p', 'Thiếu cấu hình hoặc nguồn ảnh trợ thủ gốc. Tạm khóa thao tác; không thay thế bằng trợ thủ khác.', 'helper-warning'));
    const lab = element('div', null, 'helper-lab helper-lab-' + this.tab);
    if (this.tab === 'transfer') this.renderTransfer(lab);
    else if (!config) this.renderEmptyLab(lab);
    else if (this.tab === 'feed') this.renderFeed(lab, item, config);
    else this.renderUpgrade(lab, item, config, this.tab === 'strength' ? 1 : 2);
    detail.append(lab);
    const help = this.button('Giải thích', () => this.openHelp(this.tab, 'companion-help'),
      {disabled: !!this.pending, className: 'helper-explanation', testId: 'companion-help'});
    help.prepend(this.art('public.help')); detail.append(help);
    nodes.push(detail, this.renderInventory(), this.renderMaterials());
    const status = element('p', this.pending ? `${this.pending}: đang chờ xác nhận máy chủ…`
      : [this.notice, this.feedbackError].filter(Boolean).join(' '), 'helper-status');
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.dataset.testid = 'companion-status';
    nodes.push(status);
    if (this.snapshot?.economy?.pending) nodes.push(this.button('Kiểm tra kết quả thao tác kho trước', () => this.split(false),
      {disabled:!!this.pending,testId:'companion-economy-reconcile',className:'helper-economy-reconcile'}));
    this.content.replaceChildren(...nodes);
    if (this.confirmation) this.renderConfirmation();
    if (this.helpOpen) this.renderHelp();
    if (focusId) [...this.content.querySelectorAll('[data-testid]')].find(node => node.dataset.testid === focusId)?.focus?.({preventScroll: true});
    const dialog = this.content.querySelector('[role="alertdialog"],[role="dialog"]');
    if (dialog && !dialog.contains(document.activeElement))
      (dialog.querySelector('[data-testid="companion-help-ok"]') || dialog.querySelector('[data-testid="companion-transfer-cancel"]'))?.focus({preventScroll: true});
  }

  renderInventory() {
    const panel = this.section('Trợ thủ phụ bản', 'helper-inventory');
    const title = this.asset(this.catalog.ui?.helper?.['word_instancehelper_t.png']);
    if (title) panel.firstChild.replaceChildren(assetImage(title, 'Trợ thủ phụ bản'));
    const help = this.button('Giải thích', () => this.openHelp('general', 'companion-help-general'),
      {disabled: !!this.pending, className: 'helper-explanation helper-general-help', testId: 'companion-help-general'});
    help.prepend(this.art('public.help')); panel.append(help);
    const list = element('div', null, 'helper-item-grid'); list.dataset.testid = 'companion-owned';
    const background = this.asset('zh_CN/gui_summer/controls/tankbarn/BagItem_BK.png') || EMPTY_SLOT;
    for (const item of this.owned) {
      const active = this.snapshot?.companions?.activeUuid === item.uuid, valid = !!this.config(item);
      const selected = this.selectedUuid === item.uuid || (this.tab === 'transfer' && this.transferUuid === item.uuid);
      const button = this.button('', () => this.pickPet(item.uuid), {disabled: !!this.pending,
        className: `helper-item${selected ? ' is-selected' : ''}${active ? ' is-equipped' : ''}${valid ? '' : ' is-unavailable'}`,
        testId: `companion-item-${item.uuid}`});
      button.dataset.uuid = item.uuid; button.setAttribute('aria-pressed', String(selected));
      button.style.backgroundImage = 'url("' + background.url + '")';
      button.setAttribute('aria-label', `${this.name(item)}, cấp ${item.level}${active ? ', đang trang bị' : ''}${valid ? '' : ', chưa hỗ trợ'}`);
      const icon = this.icon(item); if (icon) button.append(assetImage(icon, '', 'helper-item-icon'));
      else button.append(element('span', 'Chưa có ảnh', 'helper-no-icon'));
      button.append(element('span', numberText(this.config(item)?.booster.nAptitude), 'helper-item-level'));
      const star = element('span', null, 'helper-item-star');
      star.append(this.art('personpve.star'), element('span', item.rank + '/' + (this.config(item)?.booster.iRankLimit ?? '—'))); button.append(star);
      if (active) button.append(this.art('helper.sign_using_t', 'helper-item-active'));
      if (selected) button.append(this.art('helper.item_bg2', 'helper-item-selection'));
      this.bindDrag(button, 'pet', valid ? item.uuid : '');
      this.tooltips.bind(button, () => createCompanionTooltip({catalog: this.catalog, assets: this.assets,
        item: this.owned.find(row => row.uuid === item.uuid), activeUuid: this.snapshot?.companions?.activeUuid}));
      list.append(button);
    }
    for (let index = this.owned.length; index < 15; index++) list.append(assetImage(background, '', 'helper-empty-slot'));
    const item = this.selected, active = item?.uuid === this.snapshot?.companions?.activeUuid;
    const actions = element('div', null, 'helper-inventory-actions');
    actions.append(this.nativeButton('Tách hết trợ thủ thường đủ điều kiện…', () => this.split(true), {disabled: !this.mutable || !this.splitCandidates(true).length,
      title: 'Chỉ tách trợ thủ thường, tư chất thấp hơn chủ chiến; xem danh sách trước. 10 Xu vàng/con.', skin: 'helper.btn_alldemount_t', className: 'helper-split-all',testId:'companion-split-all'}),
      this.nativeButton('Tách trợ thủ đã chọn…', () => this.split(false), {disabled: !this.mutable || !this.splitCandidates(false).length,
        title: economyProtection(item,this.snapshot?.companions?.activeUuid,true) || 'Tách trợ thủ đã chọn để nhận 10 Xu vàng; cần xác nhận.', skin: 'helper.btn_demount_t', className: 'helper-split',testId:'companion-split'}));
    // The original full button includes its caption. Never show that caption when the action is unequip.
    for (const child of actions.children) child.textContent = '';
    const equip = this.nativeButton(active ? 'Tháo trợ thủ' : 'Làm chủ chiến', () => this.equip(),
      {disabled: !this.mutable || !this.config(item), skin: active ? 'public.button_window_orange' : 'helper.btn_set_battle_t',
        className: 'helper-equip', testId: 'companion-equip'});
    if (!active) equip.textContent = '';
    actions.append(equip); panel.append(list, actions);
    return panel;
  }
  renderMaterials() {
    const panel = this.section('Đạo cụ', 'helper-materials');
    const title = this.asset(this.catalog.ui?.helper?.['word_property_t.png']);
    if (title) panel.firstChild.replaceChildren(assetImage(title, 'Đạo cụ'));
    const grid = element('div', null, 'helper-material-grid');
    const background = this.asset('zh_CN/gui_summer/controls/tankbarn/BagItem_BK.png') || EMPTY_SLOT;
    const rows = this.bag.filter(item => [37, 38, 39, 40, 41].includes(Number(this.tables.items.get(Number(item.templateId))?.nType))
      || Number(item.templateId) === 4000001);
    for (const item of rows) {
      const pickable = !!this.materialTarget(item), used = this.selectedDoses.filter(uuid => uuid === item.uuid).length;
      const selected = this.chipUuid === item.uuid && this.tab === 'feed' || used > 0 && this.tab === 'rank'
        || this.materialUuids[this.tab] === item.uuid;
      const slot = this.button('', () => this.placeMaterial(this.materialTarget(item), item.uuid),
        {className: 'helper-material' + (selected ? ' is-selected' : ''),
        testId: 'companion-material-' + item.uuid});
      // Keep all item descriptions keyboard/hover accessible even when that
      // material cannot be used in the current tab. Selection remains guarded.
      slot.setAttribute('aria-disabled', String(!this.canSelect() || !pickable || used >= item.count));
      slot.setAttribute('aria-label', this.name(item) + ' ×' + item.count);
      slot.style.backgroundImage = 'url("' + background.url + '")';
      const icon = this.icon(item); if (icon) slot.append(assetImage(icon, this.name(item), 'helper-item-icon'));
      else slot.append(element('span', this.name(item), 'helper-no-icon'));
      slot.append(element('span', numberText(item.count), 'helper-material-count'));
      this.bindDrag(slot, 'material', pickable || this.tab === 'rank' && this.itemType(item) === 39 ? item.uuid : '');
      this.tooltips.bind(slot, () => createMaterialTooltip({catalog: this.catalog, assets: this.assets,
        item: this.bag.find(row => row.uuid === item.uuid)}));
      grid.append(slot);
    }
    for (let index = rows.length; index < 10; index++) grid.append(assetImage(background, '', 'helper-empty-slot'));
    panel.append(grid); return panel;
  }
  renderFeed(detail, item, config) {
    const quote = companionFeedQuote(this.tables, item, config.booster, this.chip, this.bag);
    const after = companionPreview(this.tables, item, config.booster, 'feed', quote);
    detail.append(this.art('helper.arrow_2', 'helper-feed-arrow'),
      this.helperCard(item, config, {className: 'helper-before'}),
      this.helperCard(after, config, {preview: true, className: 'helper-after'}),
      element('span', 'LV.' + item.level, 'helper-before-level'), element('span', 'LV.' + after.level, 'helper-after-level'));
    this.statComparison(detail, item, after, config);
    const material = this.labMaterial(this.chip, {className: 'helper-feed-material', target: 'feed',
      count: this.chip ? numberText(this.chip.count) : '', placeholder: 'VẬT LIỆU\nTĂNG CẤP',
      label: this.chip ? this.name(this.chip) + ' — có ' + quote.available + ', cần ' + quote.amount + ' để tăng 1 cấp' : 'Chọn chip EXP'});
    detail.append(material);
    const progress = element('div', null, 'helper-exp-progress');
    progress.append(this.art('helper.exp_bar', 'helper-exp-art'));
    const fraction = quote.need > 0 ? Math.max(0, Math.min(1, item.exp / quote.need)) : 0;
    const fill = element('span', null, 'helper-exp-fill'); fill.style.width = Math.round(366 * fraction) + 'px';
    const text = item.level >= quote.cap ? 'EXP  Tối đa' : 'EXP  ' + Math.floor(fraction * 100) + '%  ' + numberText(item.exp) + '/' + numberText(quote.need);
    progress.append(fill, element('span', text, 'helper-exp-text')); detail.append(progress);
    const caption=quote.allowed||quote.amount>0
      ?`Lên 1 cấp: ${numberText(quote.amount)} chip · ${quote.discardedExp ? `Bỏ ${numberText(quote.discardedExp)} EXP dư nếu đồng ý` : `Giữ ${numberText(Math.max(0,quote.remainder))} EXP dư`}`
      :item.level>=quote.cap?'Đã đạt cấp tối đa.':'Chọn chip EXP để xem số lượng lên 1 cấp.';
    detail.append(element('p', caption, 'helper-preview-caption'),
      this.nativeButton('Tăng đúng 1 cấp', () => this.feed(), {word: 'helper.btn_word_upgrade_t',
        disabled: !this.mutable || !quote.allowed, className: 'helper-lab-confirm', testId: 'companion-feed'}));
    if (quote.reason) detail.append(element('p', quote.reason, 'helper-lab-reason'));
  }
  renderUpgrade(detail, item, config, kind) {
    const quote = companionUpgradeQuote(this.tables, item, config.booster, kind, this.bag, this.silver, kind === 2 ? this.selectedDoses : []);
    const after = companionPreview(this.tables, item, config.booster, this.tab, quote);
    detail.append(this.art(kind === 2 ? 'helper.arrow_1' : 'helper.arrow_2', 'helper-upgrade-arrow'),
      this.helperCard(item, config, {size: kind === 2 ? 76 : 106, className: 'helper-before'}),
      this.helperCard(after, config, {preview: true, className: 'helper-after'}));
    this.statComparison(detail, item, after, config);
    if (quote.row) {
      const chosen = this.chosenMaterial();
      const material = this.labMaterial(chosen, {className: 'helper-upgrade-material', target: this.tab,
        placeholder: 'VẬT LIỆU\n' + (kind === 1 ? 'CƯỜNG HÓA' : 'TĂNG SAO'),
        count: chosen ? quote.owned + '/' + quote.amount : '',
        label: this.itemName(quote.itemId) + ' — cần ' + quote.amount + ', có ' + quote.owned});
      detail.append(material);
    }
    if (kind === 2) this.renderDoses(detail);
    if (!quote.capped && quote.row) {
      const rate = element('div', null, 'helper-upgrade-rate');
      rate.append(this.art('helper.word_successrate_t'), element('strong', companionPercent(quote.totalRate)));
      const cost = element('div', null, 'helper-upgrade-cost');
      cost.append(this.art('helper.word_expendcoins_t'), element('strong', numberText(quote.coin)));
      const count = element('div', null, 'helper-upgrade-count');
      count.append(this.art('helper.word_strengthentimes_t'), element('strong', '1'));
      const pity = element('div', null, 'helper-upgrade-pity');
      pity.append(this.art('helper.word_blessvalue_t'), element('strong', numberText(quote.progress)));
      pity.title = 'Bảo hiểm: ' + quote.progress + '/' + quote.maximum + '. +' + quote.gain + ' mỗi lần thất bại. Tối đa ' + quote.attemptsToGuarantee + ' lần nữa.';
      const progress = element('div', null, 'helper-pity-bar'), fill = element('span');
      progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-label', 'Tiến độ bảo hiểm');
      progress.setAttribute('aria-valuenow', String(quote.progress)); progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', String(quote.maximum || 1));
      fill.style.width = Math.max(0, Math.min(100, quote.maximum ? quote.progress / quote.maximum * 100 : 0)) + '%'; progress.append(fill);
      detail.append(rate, cost, pity, progress); if (kind === 1) detail.append(count);
      if (quote.guaranteed) detail.append(element('p', 'Bảo hiểm: thành công lần này', 'helper-guaranteed'));
    }
    detail.append(element('p', 'Xem trước khi thành công', 'helper-preview-caption'),
      this.nativeButton(kind === 1 ? 'Cường hóa 1 lần' : 'Tăng sao 1 lần', () => this.upgrade(kind),
      {word: kind === 1 ? 'helper.btn_word_strengthen_t' : 'helper.btn_word_upclass_t', className: 'helper-lab-confirm',
        disabled: !this.mutable || !quote.allowed || !this.chosenMaterial(), testId: kind === 1 ? 'companion-strengthen' : 'companion-rank'}));
    if (quote.reason) detail.append(element('p', quote.reason, 'helper-lab-reason'));
  }
  renderTransfer(detail) {
    detail.append(this.art('helper.arrow_3', 'helper-transfer-arrow'),
      this.helperCard(this.selected, this.config(this.selected), {className: 'helper-before'}),
      this.helperCard(this.other, this.config(this.other), {className: 'helper-after', slot: 'secondary'}));
    const fields = element('div', null, 'helper-transfer-fields');
    fields.append(element('p', 'Chọn hoặc kéo hai Trợ thủ vào hai ô. Bấm Trợ thủ trong ô để gỡ.', 'helper-hint'));
    if (this.selected) fields.append(element('p', this.name(this.selected) + ': ' + progressText(this.selected), 'helper-transfer-progress'));
    if (this.other) fields.append(element('p', this.name(this.other) + ': ' + progressText(this.other), 'helper-transfer-progress'));
    const quote = this.transferQuote();
    if (quote.amount) fields.append(element('p', `Phí: ${quote.amount} ${this.itemName(4000001)} (có ${quote.owned}).`, 'helper-cost'));
    const material = this.chosenMaterial('transfer');
    detail.append(this.labMaterial(material, {className: 'helper-transfer-material', target: 'transfer',
      count: material && quote.amount ? quote.owned + '/' + quote.amount : '', placeholder: 'VẬT LIỆU\nCHUYỂN ĐỔI',
      label: this.itemName(4000001)}), fields, this.nativeButton('Kiểm tra và chuyển đổi…', () => this.prepareTransfer(),
      {word: 'helper.btn_word_convert_t', className: 'helper-lab-confirm',
        disabled: !this.mutable || !quote.allowed || !material, testId: 'companion-transfer'}));
    if (quote.reason) fields.append(element('p', quote.reason, 'helper-hint'));
  }
  renderDoses(detail) {
    const group = element('div', null, 'helper-doses'); group.setAttribute('aria-label', 'Liều tăng tỷ lệ (0–3), có thể dùng cùng một chồng');
    for (let i = 0; i < 3; i++) {
      const selected = this.bag.find(row => row.uuid === this.doses[i] && this.itemType(row) === 39);
      const slot = this.labMaterial(selected, {className: 'helper-dose helper-dose-' + i, target: 'dose-' + i,
        label: 'Liều tăng tỷ lệ ' + (i + 1) + (selected ? ': ' + this.name(selected) : ': không dùng')});
      slot.classList.toggle('is-slot-target', this.doseTarget === i); group.append(slot);
    }
    group.append(this.art('helper.plus', 'helper-dose-plus first'), this.art('helper.plus', 'helper-dose-plus second'));
    detail.append(group);
  }
  renderEmptyLab(detail) {
    const rank = this.tab === 'rank';
    detail.append(this.art(rank ? 'helper.arrow_1' : 'helper.arrow_2', this.tab === 'feed' ? 'helper-feed-arrow' : 'helper-upgrade-arrow'),
      this.helperCard(null, null, {size: rank ? 76 : 106, className: 'helper-before'}),
      this.helperCard(null, null, {preview: true, className: 'helper-after'}));
    const group = element('dl', null, 'helper-stat-comparison');
    for (const label of Object.values(STAT_NAMES)) {
      const row = element('div', null, 'helper-stat-row');
      row.style.backgroundImage = 'url("' + PANEL_ART['public.label250x28'].url + '")';
      row.append(element('dt', label + ':'), this.art('tank.smallwhitearrow', 'helper-empty-stat-arrow')); group.append(row);
    }
    detail.append(group);
    if (this.tab === 'feed') detail.append(this.labMaterial(this.chip, {className: 'helper-feed-material', target: 'feed',
      placeholder: 'VẬT LIỆU\nTĂNG CẤP', label: 'Chip EXP', count: this.chip ? numberText(this.chip.count) : ''}));
    else detail.append(this.labMaterial(null, {className: 'helper-upgrade-material', target: this.tab,
      placeholder: 'VẬT LIỆU', label: this.tab === 'strength' ? 'Vật liệu cường hóa' : 'Vật liệu tăng sao'}));
    if (rank) this.renderDoses(detail);
    detail.append(this.nativeButton('Chọn Trợ thủ để tiếp tục', null, {disabled: true, className: 'helper-lab-confirm',
      word: this.tab === 'feed' ? 'helper.btn_word_upgrade_t' : this.tab === 'strength' ? 'helper.btn_word_strengthen_t' : 'helper.btn_word_upclass_t'}));
  }
  openHelp(kind, returnFocus) {
    if (!this.live() || this.pending || this.confirmation || !HELP_TEXT[kind]) return;
    this.helpOpen = kind; this.helpReturnFocus = returnFocus; this.render();
  }
  closeHelp() {
    if (!this.helpOpen) return;
    this.helpOpen = ''; this.render();
    [...this.content.querySelectorAll('[data-testid]')].find(node => node.dataset.testid === this.helpReturnFocus)?.focus?.({preventScroll: true});
  }
  renderHelp() {
    const shade = element('div', null, 'helper-help-shade');
    let frame;
    try {
      frame = createNativePanel({assets: this.panelAssets, width: 422, height: 362, kind: 'box1', state: 'CONFIRM',
        ...(this.panelAssets['public.close'] ? {close: {asset: 'public.close', x: 383, y: 15, label: 'Đóng giải thích'},
          onClose: () => { if (this.live()) this.closeHelp(); }} : {})});
    } catch { frame = {root: element('section'), content: element('div')}; frame.root.append(frame.content); }
    const dialog = frame.root; dialog.classList.add('helper-help-dialog');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Giải thích — ' + (this.helpOpen === 'general' ? 'Trợ thủ' : TABS.find(row => row[0] === this.helpOpen)?.[1]));
    dialog.dataset.testid = 'companion-help-dialog'; dialog.dataset.helpKind = this.helpOpen;
    const title = element('h3', 'Giải thích', 'helper-help-title');
    const text = element('ol', null, 'helper-help-text'); text.setAttribute('tabindex', '0');
    text.setAttribute('aria-label', 'Nội dung giải thích');
    for (const paragraph of HELP_TEXT[this.helpOpen]) text.append(element('li', paragraph));
    frame.content.append(title, text);
    const ok = this.nativeButton('OK', () => this.closeHelp(), {skin: 'dialog.green', className: 'helper-help-ok', testId: 'companion-help-ok'});
    const word = this.panelAssets['dialog.confirm']; if (word) ok.replaceChildren(assetImage(word, 'OK'));
    frame.content.append(ok);
    if (!frame.close) frame.content.append(this.button('×', () => this.closeHelp(), {className: 'helper-help-close', testId: 'companion-help-close'}));
    shade.append(dialog); this.content.append(shade);
  }
  renderConfirmation() {
    if (this.confirmation?.kind === 'feed') {
      const q=this.confirmation.quote,shade=element('div',null,'helper-confirm-shade'),dialog=element('section',null,'helper-confirm');
      dialog.setAttribute('role','alertdialog'); dialog.setAttribute('aria-modal','true'); dialog.setAttribute('aria-label','Xác nhận bỏ EXP dư');
      dialog.append(element('h3','Xác nhận bỏ EXP dư'),element('p',`Dùng ${numberText(q.amount)} chip để tăng trợ thủ lên cấp tối đa ${q.nextLevel}. Phần ${numberText(q.discardedExp)} EXP dư sẽ bị bỏ và không được hoàn lại. Bạn có muốn tiếp tục không?`),
        this.button('Có',()=>this.confirmFeed(),{disabled:!this.mutable,testId:'companion-feed-confirm'}),
        this.button('Không',()=>{this.confirmation=null;this.render();},{testId:'companion-feed-cancel'}));
      shade.append(dialog);this.content.append(shade);dialog.querySelector('[data-testid="companion-feed-cancel"]')?.focus();return;
    }
    const shade = element('div', null, 'helper-confirm-shade'), dialog = element('section', null, 'helper-confirm');
    dialog.setAttribute('role', 'alertdialog'); dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Xác nhận chuyển toàn bộ tiến trình trợ thủ');
    dialog.append(element('h3', 'Xác nhận chuyển đổi toàn bộ tiến trình'),
      element('p', `${this.name(this.selected)} → ${this.name(this.other)}: ${progressText(this.selected)}`),
      element('p', `${this.name(this.other)} → ${this.name(this.selected)}: ${progressText(this.other)}`));
    const quote = this.transferQuote();
    dialog.append(element('p', `Tiêu ${quote.amount} ${this.itemName(4000001)}. Hai trợ thủ vẫn giữ nguyên hình dạng và giới hạn gốc.`, 'helper-cost'),
      this.button('Xác nhận chuyển đổi', () => this.transfer(), {disabled: !this.mutable, testId: 'companion-transfer-confirm'}),
      this.button('Hủy', () => { this.confirmation = null; this.render(); }, {disabled: !!this.pending, testId: 'companion-transfer-cancel'}));
    shade.append(dialog); this.content.append(shade);
  }
  dispose() {
    if (this.disposed) return;
    this.economyDialog?.dispose();
    this.disposed = true; this.epoch++; this.snapshot = null; this.confirmation = null;
    this.helpOpen = ''; this.drag = null; this.tooltips.dispose(); this.feedback.dispose();
    this.content.removeEventListener('keydown', this.onKeyDown);
    this.host.replaceChildren();
  }
}
