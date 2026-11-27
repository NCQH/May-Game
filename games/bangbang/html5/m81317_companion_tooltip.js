import {element, assetImage, nativeText, numberText} from './m8_ui_helpers.js';
import {companionTables, companionConfig, companionProgress, companionAttributes} from './m81314_companion_math.js';
import {PANEL_ART} from './m81316_panel_art.js';

// All values come from the native item/booster tables and the current item
// instance. This module is read-only and is also used by WatchHelperInfo.
const ATTRS = [['hp', 'HP', 4], ['attack', 'TC', 1], ['penetration', 'XG', 2], ['armor', 'PT', 3]];
// ResourcePath.HELPER_TIP_SCORE, resolved through the original fileList.xml.
// PNG is copied byte-for-byte (80x40), not a text recreation of the badge.
export const COMPANION_POWER_BADGE = Object.freeze({
  url: '/html5/assets/m81318_companion/helper_tipsbg_battle_t.png', width: 80, height: 40,
  sha256: 'a5eb2549c3258be6ec7f60a17c4e39eb34f6dc31d9048ce155b266df26204aba',
});
const tablesCache = new WeakMap();
function tablesFor(catalog) {
  if (!tablesCache.has(catalog)) tablesCache.set(catalog, companionTables(catalog));
  return tablesCache.get(catalog);
}
export function companionNativeText(catalog, assets, text) {
  return nativeText(catalog?.localizedText?.[text] || assets?.garage?.localizedText?.[text] || text);
}
export function companionItemName(catalog, assets, templateId) {
  const row = catalog?.companions?.[templateId]?.rawItem || tablesFor(catalog || {}).items.get(Number(templateId));
  return nativeText(assets?.garage?.items?.[templateId]?.name)
    || companionNativeText(catalog, assets, row?.szName) || `Vật phẩm ${templateId ?? '—'}`;
}
function raster(catalog, assets, value) {
  const entry = typeof value === 'string' ? catalog?.assets?.[value] || assets?.get?.(value)
    : value?.assetRef ? catalog?.assets?.[value.assetRef] : value;
  return entry?.url && /\.(?:png|jpe?g|webp)(?:$|[?#])/i.test(entry.url) ? entry : null;
}
function iconFor(catalog, assets, item, row) {
  const entry = catalog?.companions?.[item?.templateId];
  return raster(catalog, assets, entry?.icon || entry?.inventoryIcon)
    || raster(catalog, assets, `zh_CN/icon/item/${row?.szIconPath1 || ''}`);
}
function validity(item) {
  // ITEM_INSTANCE.lifeTime is days before activation, or the expiry UTC second
  // after IEF_TIME_START (bit 2). Do not fabricate a lifetime for public data.
  if (item?.lifeTime === undefined || item?.lifeTime === null) return '';
  const lifetime = Number(item.lifeTime);
  if (!Number.isSafeInteger(lifetime) || lifetime < 0) return '';
  if (lifetime === 0) return 'Hiệu lực vĩnh viễn';
  if ((Number(item.extFlag) & 4) !== 0) return 'Hết hạn: ' + new Date(lifetime * 1000).toLocaleString('vi-VN');
  return 'Hiệu lực: ' + numberText(lifetime) + ' ngày sau khi kích hoạt';
}
export function companionTooltipData({catalog = {}, assets, item, activeUuid = ''} = {}) {
  const tables = tablesFor(catalog), config = companionConfig(catalog, tables, item);
  if (!config) return null;
  const progress = companionProgress(item), {booster, rawItem} = config;
  const attrs = companionAttributes(tables, item, booster);
  return {
    uuid: item.uuid, templateId: Number(item.templateId), name: companionItemName(catalog, assets, item.templateId),
    icon: iconFor(catalog, assets, item, rawItem), aptitude: Number(booster.nAptitude),
    level: progress.level, levelCap: Number(booster.iLevelLimit), exp: progress.exp,
    strength: progress.upgradeLevel, strengthCap: Number(booster.iUpLevelLimit),
    strengthProgress: progress.upgradeCost, rank: progress.rank, rankCap: Number(booster.iRankLimit),
    rankProgress: progress.rankCost, power: attrs.score, equipped: !!activeUuid && activeUuid === item.uuid,
    attributes: ATTRS.map(([key, label, type]) => ({key, label, value: attrs[key],
      enhanced: [Number(booster.nTypeA), Number(booster.nTypeB)].includes(type)})),
    // BoosterTemplate.iMove/iFireRate use native hundredths of a percent.
    movement: Number(booster.iMove) / 100, fireRate: Number(booster.iFireRate) / 100,
    description: companionNativeText(catalog, assets, rawItem.szDesc), validity: validity(item),
  };
}

export function createCompanionTooltip(options = {}) {
  const data = options.data || companionTooltipData(options);
  if (!data) return null;
  const tip = element('section', null, 'm81317-item-tip m81317-companion-tip');
  tip.dataset.testid = 'companion-tooltip'; tip.dataset.uuid = data.uuid;
  // A projected result is not an acknowledged/equipped instance. Keep the
  // successful-upgrade condition explicit when reading the standalone tip.
  if (options.previewLabel) tip.append(element('p', options.previewLabel, 'm81317-tip-preview'));
  const header = element('div', null, 'm81317-tip-header'), portrait = element('div', null, 'm81317-tip-portrait');
  if (data.icon) portrait.append(assetImage(data.icon, '', 'm81317-tip-icon'));
  const stars = element('div', null, 'm81317-tip-stars');
  stars.setAttribute('aria-label', `Sao ${data.rank}/${data.rankCap}`);
  for (let index = 0; index < data.rankCap; index++) {
    const star = assetImage(PANEL_ART['personpve.star'], '', index < data.rank ? 'is-filled' : 'is-empty');
    stars.append(star);
  }
  portrait.append(stars);
  const identity = element('div', null, 'm81317-tip-identity');
  identity.append(element('h4', data.name), element('p', 'Tư chất: ' + data.aptitude),
    element('p', `LV: ${data.level}/${data.levelCap}`),
    element('p', `Cường hóa: ${data.strength}/${data.strengthCap}`, 'm81317-tip-enhanced'));
  if (data.equipped && !options.previewLabel) identity.append(element('p', '[Đang Trang Bị]', 'm81317-tip-equipped'));
  header.append(portrait, identity); tip.append(header);
  const basics = element('div', null, 'm81317-tip-basics'), stats = element('div');
  stats.append(element('p', '[Thuộc tính cơ bản]', 'm81317-tip-section'));
  for (const attribute of data.attributes) {
    const line = element('p', `${attribute.label}: +${numberText(attribute.value)}`);
    if (attribute.enhanced) line.append(element('span', ' Cường Hóa', 'm81317-tip-enhanced'));
    stats.append(line);
  }
  const power = element('div', null, 'm81317-tip-power');
  power.setAttribute('role', 'img');
  power.setAttribute('aria-label', 'Chiến lực: ' + numberText(data.power));
  const badge = assetImage(COMPANION_POWER_BADGE, '', 'm81318-tip-power-badge');
  badge.width = COMPANION_POWER_BADGE.width; badge.height = COMPANION_POWER_BADGE.height;
  badge.dataset.nativeAsset = 'ResourcePath.HELPER_TIP_SCORE';
  power.append(element('strong', numberText(data.power)), badge);
  basics.append(stats, power); tip.append(basics);
  const bonuses = element('div', null, 'm81317-tip-bonuses');
  bonuses.append(element('p', '[Thuộc tính tư chất]', 'm81317-tip-section'));
  if (Number.isFinite(data.movement)) bonuses.append(element('p', 'Di động: +' + numberText(data.movement) + '%'));
  if (Number.isFinite(data.fireRate)) bonuses.append(element('p', 'Công Tốc: +' + numberText(data.fireRate) + '%'));
  tip.append(bonuses);
  if (data.description) tip.append(element('p', '[Giới thiệu]', 'm81317-tip-section'), element('p', data.description, 'm81317-tip-description'));
  if (data.validity) tip.append(element('p', data.validity, 'm81317-tip-validity'));
  return tip;
}

export function createMaterialTooltip({catalog = {}, assets, item} = {}) {
  if (!item) return null;
  const row = tablesFor(catalog).items.get(Number(item.templateId));
  if (!row) return null;
  const tip = element('section', null, 'm81317-item-tip m81317-material-tip');
  tip.dataset.testid = 'companion-material-tooltip'; tip.dataset.templateId = String(item.templateId);
  tip.append(element('h4', companionItemName(catalog, assets, item.templateId)));
  const description = companionNativeText(catalog, assets, row.szDesc);
  if (description) tip.append(element('p', '[Giới thiệu]', 'm81317-tip-section'), element('p', description, 'm81317-tip-description'));
  if (Number.isSafeInteger(Number(item.count)) && Number(item.count) > 0) tip.append(element('p', 'Số lượng: ' + numberText(item.count), 'm81317-tip-count'));
  const lifetime = validity(item); if (lifetime) tip.append(element('p', lifetime, 'm81317-tip-validity'));
  return tip;
}

let tooltipSerial = 0;
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
/** Complete, below-first tip placement. There is deliberately no side-placement
 * or scroll fallback: fit the entire native layout, then move only vertically
 * when the lower edge of the viewport cannot contain it. */
export function companionTooltipPlacement({viewport = {}, anchor = {}, width = 290, height = 1, scale = 1} = {}) {
  const vx = finite(viewport.left, 0), vy = finite(viewport.top, 0);
  const vw = Math.max(1, finite(viewport.width, 1024)), vh = Math.max(1, finite(viewport.height, 768));
  const margin = Math.min(8, vw / 4, vh / 4), gap = 8;
  const naturalWidth = Math.max(1, finite(width, 290)), naturalHeight = Math.max(1, finite(height, 1));
  const preferred = Math.max(.01, finite(scale, 1));
  const fit = Math.min(preferred, (vw - margin * 2) / naturalWidth, (vh - margin * 2) / naturalHeight);
  const w = naturalWidth * fit, h = naturalHeight * fit;
  const al = finite(anchor.left, vx), ar = finite(anchor.right, al + finite(anchor.width, 0));
  const at = finite(anchor.top, vy), ab = finite(anchor.bottom, at + finite(anchor.height, 0));
  const low = vy + margin, high = vy + vh - margin - h;
  let top = ab + gap, placement = 'below';
  if (top > high) {
    if (at - gap - h >= low) { top = at - gap - h; placement = 'above'; }
    else { top = Math.max(low, Math.min(top, high)); placement = 'vertical-fit'; }
  }
  top = Math.max(low, Math.min(top, high));
  const left = Math.max(vx + margin, Math.min((al + ar - w) / 2, vx + vw - margin - w));
  return {left, top, width: w, height: h, scale: fit, placement};
}
/** A body portal, so scaled panels do not turn fixed coordinates into local
 * coordinates. Bindings are render-scoped: call reset before replacing DOM. */
export class M81317TooltipLayer {
  constructor({host = document.body, scaleRoot = null, isCurrent = () => true} = {}) {
    this.host = host; this.scaleRoot = scaleRoot; this.isCurrent = isCurrent;
    this.bindings = []; this.disposed = false; this.active = null; this.serial = ++tooltipSerial;
    this.pointerBinding = null; this.focusBinding = null; this.inputMode = 'keyboard';
    this.positionFrame = null; this.measuredHeight = 0;
    this.style = element('link'); this.style.rel = 'stylesheet';
    const styleUrl = new URL('./m81317_companion_tooltip.css', import.meta.url);
    styleUrl.search = new URL(import.meta.url).search; this.style.href = styleUrl.href;
    this.portal = element('div', null, 'm81317-tooltip-layer'); this.portal.hidden = true;
    this.portal.id = 'm81317-tooltip-' + this.serial; this.portal.setAttribute('role', 'tooltip');
    // Like MouseHintBase.mouseEnabled/mouseChildren=false, this read-only
    // surface never receives pointer/focus ownership from its trigger.
    this.portal.setAttribute('aria-label', 'Thông tin vật phẩm. Escape để ẩn.');
    this.portal.dataset.testid = 'm81317-tooltip-layer';
    document.body.append(this.style, this.portal);
    this.onDismiss = () => this.hide();
    this.onKey = event => {
      this.inputMode = 'keyboard';
      if (event.key === 'Escape' && this.active) {
        // This listener runs in capture phase, before the panel's Escape
        // handler: dismiss the hint without also closing its owning panel.
        event.preventDefault(); event.stopPropagation(); this.hide();
      }
    };
    this.onPointerDown = () => {
      this.inputMode = 'pointer';
      // Clicking a trigger must not turn its incidental button focus into a
      // sticky keyboard tooltip after the pointer has left it.
      if (this.active && this.focusBinding === this.active && this.pointerBinding !== this.active) this.hide();
    };
    this.onResize = () => { this.measuredHeight = 0; this.queuePosition(this.active); };
    this.onVisibility = () => { if (document.hidden) this.hide(); };
    this.onStyleLoad = () => { this.measuredHeight = 0; this.queuePosition(this.active); };
    this.style.addEventListener('load', this.onStyleLoad);
    window.addEventListener?.('resize', this.onResize);
    window.addEventListener?.('scroll', this.onDismiss, true);
    window.addEventListener?.('blur', this.onDismiss);
    this.viewport = window.visualViewport;
    this.viewport?.addEventListener?.('resize', this.onResize);
    this.viewport?.addEventListener?.('scroll', this.onDismiss);
    document.addEventListener('keydown', this.onKey, true);
    document.addEventListener('pointerdown', this.onPointerDown, true);
    document.addEventListener('visibilitychange', this.onVisibility);
  }
  bind(target, builder) {
    if (!target || this.disposed) return target;
    // Native title tooltips otherwise appear a second time above this panel.
    target.removeAttribute('title'); target.title = '';
    const binding = {target, builder, listeners: [], oldDescription: target.getAttribute('aria-describedby'),
      oldShortcuts: target.getAttribute('aria-keyshortcuts')};
    target.setAttribute('aria-keyshortcuts', [...new Set((binding.oldShortcuts || '').split(/\s+/).filter(Boolean).concat('F2'))].join(' '));
    const listen = (name, callback) => { target.addEventListener(name, callback); binding.listeners.push([name, callback]); };
    listen('pointerenter', () => {
      this.inputMode = 'pointer'; this.show(binding);
      if (this.active === binding) { this.pointerBinding = binding; this.focusBinding = null; }
    });
    listen('pointermove', () => { if (this.active === binding) this.queuePosition(binding); });
    listen('pointerleave', () => { if (this.active === binding) this.hide(); });
    listen('pointerdown', () => { this.inputMode = 'pointer'; this.focusBinding = null; });
    listen('focus', () => {
      if (this.inputMode === 'pointer') return;
      this.show(binding); if (this.active === binding) this.focusBinding = binding;
    });
    listen('blur', () => { if (this.active === binding) this.hide(); });
    listen('keydown', event => this.keydown(binding, event));
    listen('dragstart', this.onDismiss);
    this.bindings.push(binding); return target;
  }
  show(binding) {
    if (!this.valid(binding)) return this.hide();
    if (this.active === binding && !this.portal.hidden) return;
    this.hide();
    let content;
    try { content = binding.builder(); } catch { return; }
    if (!content) return;
    this.active = binding; this.portal.replaceChildren(content); this.portal.hidden = false;
    binding.target.setAttribute('aria-describedby', [binding.oldDescription, this.portal.id].filter(Boolean).join(' '));
    this.position(binding);
  }
  valid(binding) {
    return !this.disposed && this.isCurrent() && this.host?.isConnected && binding?.target.isConnected;
  }
  queuePosition(binding) {
    if (!this.valid(binding) || this.active !== binding) return this.hide();
    if (this.positionFrame !== null) return;
    this.positionFrame = requestAnimationFrame(() => {
      this.positionFrame = null;
      if (!this.valid(binding) || this.active !== binding) return this.hide();
      this.position(binding);
    });
  }
  keydown(binding, event) {
    if (!this.valid(binding)) return;
    this.inputMode = 'keyboard';
    if (event.key === 'Escape' && this.active === binding) {
      event.preventDefault(); event.stopPropagation(); this.hide(); return;
    }
    if (event.key === 'F2') {
      this.show(binding);
      if (this.active === binding) {
        event.preventDefault(); event.stopPropagation(); this.pointerBinding = null; this.focusBinding = binding;
      }
    }
  }
  position(binding) {
    if (!this.valid(binding) || this.active !== binding) return this.hide();
    const viewport = window.visualViewport;
    const width = Number(viewport?.width || window.innerWidth || document.documentElement?.clientWidth || 1024);
    const height = Number(viewport?.height || window.innerHeight || document.documentElement?.clientHeight || 768);
    const vx = Number(viewport?.offsetLeft || 0), vy = Number(viewport?.offsetTop || 0);
    const root = this.scaleRoot;
    const candidateScale = root?.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1;
    const scale = Number.isFinite(candidateScale) && candidateScale > 0 ? candidateScale : 1;
    this.portal.style.width = '290px';
    // The content is laid out once at native width/font size, then uniformly
    // fitted as a whole. No cropped max-height, scroll container, or text
    // reflow while moving between pixels of the same trigger.
    if (!this.measuredHeight) {
      this.portal.style.transform = 'none';
      const bounds = this.portal.getBoundingClientRect?.();
      this.measuredHeight = Math.max(1, Math.ceil(this.portal.scrollHeight || this.portal.offsetHeight || bounds?.height || 1));
    }
    const rect = binding.target.getBoundingClientRect?.() || {left: vx, top: vy, right: vx, bottom: vy};
    const placement = companionTooltipPlacement({viewport: {left: vx, top: vy, width, height},
      anchor: rect, width: 290, height: this.measuredHeight, scale});
    this.portal.style.left = placement.left + 'px'; this.portal.style.top = placement.top + 'px';
    this.portal.style.transform = 'scale(' + placement.scale + ')';
    this.portal.dataset.placement = placement.placement;
  }
  hide() {
    if (this.positionFrame !== null) cancelAnimationFrame(this.positionFrame);
    this.positionFrame = null; this.measuredHeight = 0;
    if (this.active) {
      const {target, oldDescription} = this.active;
      if (oldDescription) target.setAttribute('aria-describedby', oldDescription);
      else target.removeAttribute('aria-describedby');
    }
    this.active = null; this.pointerBinding = null; this.focusBinding = null;
    this.portal.hidden = true; this.portal.replaceChildren(); this.portal.scrollTop = 0;
  }
  reset() {
    this.hide();
    for (const {target, listeners, oldShortcuts} of this.bindings) {
      for (const [name, handler] of listeners) target.removeEventListener(name, handler);
      if (oldShortcuts) target.setAttribute('aria-keyshortcuts', oldShortcuts); else target.removeAttribute('aria-keyshortcuts');
    }
    this.bindings = [];
  }
  dispose() {
    if (this.disposed) return;
    this.reset(); this.disposed = true;
    window.removeEventListener?.('resize', this.onResize);
    window.removeEventListener?.('scroll', this.onDismiss, true);
    window.removeEventListener?.('blur', this.onDismiss);
    this.viewport?.removeEventListener?.('resize', this.onResize);
    this.viewport?.removeEventListener?.('scroll', this.onDismiss);
    document.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('pointerdown', this.onPointerDown, true);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.style.removeEventListener('load', this.onStyleLoad);
    this.portal.remove(); this.style.remove();
  }
}
