import {NATIVE_KEYCAPS} from './m81_native_keycaps.js';
import {cooldownView} from './combat_state.js';
import {selfKdaView} from './team_hud_state.js';
import {nativeHonorLayout, nativeHonorPhase, roboKillBannerPresentation} from './m71_kill_banner.js';
import {bindNativeSkillTooltip} from './m85_tank_ui.js';
import {modeScoreView} from './m810_objectives.js';
import {isDeathMap,deathBannerView} from './m811_death.js';
import {m81338VisualExternal} from './m81338_level_looks.js';

// Layout and resource joins: evidence/hud_audit/hud_layout_contract.json.
// This module only presents accepted native state. It has no network handle.
const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
const ratio = (value, maximum) => maximum > 0 ? clamp(value / maximum) : 0;
const finite = value => value != null && Number.isFinite(Number(value));
const logicalPath = path => String(path || '').replace(/^\/?rez\//, '');
const text = (node, value) => { const next = String(value ?? ''); if (node.textContent !== next) node.textContent = next; };
const nativeName = (actor, character) => actor?.name || character?.name || '';
let hudInstanceId = 0;
const timeText = seconds => !finite(seconds) ? '—:—'
  : `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;
const SLOT = Object.freeze({E: 1, Space: 2, P: 3, Q: 4, R: 10, B: 12, Commander: 13});
// Current TankLib BattleTool.isOpenSurrender and BulkDataEnum.ROOM_TYPE.
const SURRENDER_ROOM_TYPES = new Set([1, 2, 5, 6, 9, 12, 15, 16, 17, 18, 19]);
// GameText CONTROL_TEXT79/354/287/BATTLE_KILL_30 translated by original vi_VN/game.mo.
const RELIVE_TEXT = Object.freeze({countdown: 'Còn @num1@ s hồi sinh', lives: 'Còn @num1@ mạng',
  vip: 'VIP có thể rút ngắn thời gian đợi hồi sinh', killed: 'Bạn bị @text1@ đánh bại'});
const TAG = Object.freeze({alive_bg: 46, alive_left_blue: 111, alive_left_red: 23,
  alive_right_blue: 85, alive_right_red: 103, tankStateBg: 41,
  temateCDBg: 57, temateCDready: 126, word_hp: 17, play_bar_l: 49,
  img_mp_bar_bg: 137, keyboard_R: 84, keyboard_E: 138, keyboard_Q: 116,
  keyboard_Space: 118, system_set: 5, system_exit: 9, top_right_bg: 127,
  btn_signal_atk: 51, btn_signal_bak: 2, btn_signal_mst: 26,
  relive_bg_pvp: 56, relive_bg_pve: 67, bg_battleKill: 110, kill_icon: 32, tankLife: 3});
const LOOSE = Object.freeze({imgSkillCellMask: 'zh_CN/gui_summer/controls/gameplay/skill_bar_2.png',
  locked: 'zh_CN/gui_summer/controls/public/locked.png',
  MPmask: 'zh_CN/gui_summer/controls/gameplay/img_skill_mp_lack.png',
  skillBan: 'zh_CN/gui_summer/controls/public/ban.png',
  playerBlueHPBar: 'zh_CN/gui_summer/controls/gameplay/playerBlueHPBar.png',
  playerRedHPBar: 'zh_CN/gui_summer/controls/gameplay/playerRedHPBar.png'});

/** IDs in TAG are scoped to the audited current BattleUI, never protocol IDs. */
export function roboHudAsset(catalog, name) {
  if (!catalog || !name) return null;
  const tag = catalog.namedBitmaps?.[name] ?? TAG[name];
  if (tag != null && catalog.bitmaps?.[String(tag)]) return catalog.bitmaps[String(tag)];
  if (catalog.resources?.[name]?.url) return catalog.resources[name];
  const loose = catalog.loose?.[name];
  if (loose?.url) return loose;
  const path = logicalPath(typeof loose === 'string' ? loose : loose?.logical || LOOSE[name] || name);
  return catalog.assets?.[path] || catalog.assets?.[`rez/${path}`] || null;
}

export function roboPortrait(catalog, hudCatalog, actor, character = null) {
  const level = actor?.tankLevel ?? character?.tankLevel;
  const explicit = Number(actor?.externalId ?? character?.externalId) || 0;
  const nativeExternal = explicit || (finite(level)
    ? Number(catalog?.tanks?.[String(actor?.tankId ?? character?.tankId)]?.baseExternalByLevel?.[String(level)]) : 0);
  const externalId=m81338VisualExternal({tankId:actor?.tankId??character?.tankId,tankLevel:level},nativeExternal);
  const source = hudCatalog?.portraits?.[String(externalId)] || hudCatalog?.portraits_by_external?.[String(externalId)];
  if (!source) return null;
  const asset = source.asset?.url ? source.asset : roboHudAsset(hudCatalog, source.logical);
  return {...source, externalId, asset, bitmapOffset: source.bitmapOffset
    || (asset && finite(asset.width) && finite(asset.height) ? [(200 - asset.width) / 2, (200 - asset.height) / 2] : [0, 0])};
}

/** Native CAMP_A/CAMP_B positions and native insertion order, never ally sorting. */
export function roboHudRows(state, catalog, hudCatalog, now) {
  const self = state?.actors?.[String(state.selfObjectId)];
  if (!self) return [];
  const characters = new Map((state.characters || []).map(row => [row.accountId, row]));
  const ordered = state.actorOrder?.length ? state.actorOrder : Object.keys(state.actors);
  const counts = new Map();
  return ordered.map(id => state.actors[String(id)]).filter(actor => actor && !actor.removed
    && (actor.camp === 1 || actor.camp === 2) && Number.isInteger(actor.accountId)).map(actor => {
    const character = characters.get(actor.accountId), position = counts.get(actor.camp) || 0;
    counts.set(actor.camp, position + 1);
    const ally = actor.camp === self.camp;
    return {objectId: actor.objectId, accountId: actor.accountId, camp: actor.camp, position,
      name: nativeName(actor, character), self: actor.objectId === self.objectId, ally,
      hp: actor.hp, maxHp: actor.maxHp, dead: !!actor.dead || actor.hp <= 0,
      portrait: roboPortrait(catalog, hudCatalog, actor, character),
      skinFrameType: actor.skinFrameType ?? character?.skinFrameType ?? 0,
      vipLevel: character?.vipLevel ?? character?.player?.vipLevel ?? 0,
      space: ally ? cooldownView(state, actor.objectId, SLOT.Space, now) : null};
  });
}

export function nativeCooldownText(milliseconds) {
  if (!finite(milliseconds) || milliseconds <= 0) return '';
  const seconds = milliseconds / 1000;
  return seconds < 10 ? seconds.toFixed(1) : seconds.toFixed(0);
}

/** GamePlayerItemFrame uses fixedSec=false and minValueToShow=99. */
export function nativeRosterCooldownText(milliseconds) {
  if (!finite(milliseconds) || milliseconds <= 0 || milliseconds >= 99000) return '';
  return String(Math.round(milliseconds / 1000));
}

/** Called only inside BATTLE. Following an ally after death is not native isLook. */
export function nativeBattleExitVisible(state) {
  return !!state?.isLook || !SURRENDER_ROOM_TYPES.has(Number(state?.roomType));
}

/** BuffProxy uses the received vector, then filters icons and takes eight cells. */
export function roboHudBuffs(self, catalog, localizedText = {}) {
  const buffs = self?.buffs || {}, order = self?.buffPresentation?.nativeOrder;
  const ordered = Array.isArray(order) ? order.map(id => buffs[String(id)]).filter(Boolean)
    : Object.values(buffs); // Legacy presentation fixtures have no native vector.
  const localize = source => {
    const raw = typeof source === 'string' ? source : '';
    return raw && typeof localizedText[raw] === 'string' ? localizedText[raw] : raw;
  };
  return ordered.map(buff => ({buff, template: catalog?.buffs?.[String(buff.templateId)]}))
    .filter(row => row.template?.hudVisible).slice(0, 8).map(row => {
      const name = localize(row.template.szBuffName), description = localize(row.template.szBuffDesc);
      const stackVisible = !!row.template.hudStackCountVisible;
      return {...row, name, description, title: [name, description].filter(Boolean).join('\n'),
        stackVisible, stackText: stackVisible && finite(row.buff.stackCount) ? String(row.buff.stackCount) : ''};
    });
}

/** BuffGridProxy refreshes the start AND duration on S1581; it never expires a buff. */
export function nativeBuffElapsed(buff, template, now) {
  if (template?.hudHideExistTime || !finite(buff?.receivedAt) || !finite(buff?.durationMs)
    || Number(buff.durationMs) <= 0 || !finite(now)) return 0;
  // Keep the native uint duration, including 0xffffffff. expiresAt is a state
  // convenience, not ClockProgress's denominator or permission to remove UI.
  return clamp((Number(now) - Number(buff.receivedAt)) / Number(buff.durationMs));
}

/** Current ClockProgress's clockwise square path, including its partial outline. */
export function nativeBuffClockGeometry(percent) {
  const p = clamp(percent);
  if (!p) return {path: '', outline: false, visible: false};
  if (p === 1) return {path: 'M0 0 L32 0 L32 32 L0 32 Z', outline: false, visible: true};
  const points = [[16, 16], [16, 0]];
  let verticalEdge = false, signX = 1, signY = -1, edge = 0;
  if (p > 1 / 8) { points.push([32, 0]); verticalEdge = true; edge = 32; }
  if (p > 1 / 4) { points.push([32, 16]); signY = 1; }
  if (p > 3 / 8) { points.push([32, 32]); verticalEdge = false; }
  // Preserve the source path, including its retraced bottom-edge segment.
  if (p > 1 / 2) { points.push([0, 32]); signX = -1; }
  if (p > 5 / 8) { points.push([0, 32]); verticalEdge = true; edge = 0; }
  if (p > 6 / 8) { points.push([0, 16]); signY = -1; }
  if (p > 7 / 8) { points.push([0, 0]); verticalEdge = false; }
  const angle = 360 * p, delta = Math.floor(angle / 45) % 2 ? 45 - angle % 45 : angle % 45;
  const displacement = Math.tan(delta * Math.PI / 180) * 16;
  points.push(verticalEdge ? [edge, 16 + signY * displacement] : [16 + signX * displacement, edge], [16, 16]);
  return {path: points.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' '),
    outline: true, visible: true};
}

/** Preserve each independently running native child timeline. */
export function nativeHudFrames(sequence, elapsedMs, loop = true) {
  if (!sequence) return [];
  return (sequence.layers || [sequence]).map(layer => {
    const frames = layer.frames || [];
    if (!frames.length) return null;
    const tick = Math.floor(Math.max(0, elapsedMs) / Math.max(1, layer.frameMs || sequence.frameMs || 1000 / 24));
    // skillComplete.swf MainTimeline.frame35 immediately redirects to frame14.
    // Retain its intro, then play frames14..34; neither hide nor freeze the gold rim.
    const loopStart = Number(layer.loopStartFrame ?? sequence.loopStartFrame) - 1;
    const redirect = Number(layer.endRedirectFrame ?? sequence.endRedirectFrame) - 1;
    const nativeLoop = Number.isInteger(loopStart) && loopStart >= 0
      && Number.isInteger(redirect) && redirect > loopStart && redirect < frames.length;
    if (!nativeLoop && !loop && tick >= frames.length) return null;
    const index = nativeLoop ? (tick < redirect ? tick : loopStart + (tick - redirect) % (redirect - loopStart))
      : loop ? tick % frames.length : Math.min(tick, frames.length - 1);
    const frame = frames[index];
    if (!frame || frame.empty) return null;
    // Multi-page composites keep complete page records outside frames so the
    // scene asset loader can hash-verify the current/prefetched page on demand.
    const pages = layer.pages || sequence.pages || [];
    const indexedPage = Number.isInteger(frame.page) ? pages[frame.page] : null;
    const page = frame.url ? (indexedPage?.url === frame.url ? indexedPage
      : pages.find(asset => asset.url === frame.url)) : indexedPage;
    if (pages.length && !page) return null;
    const asset = page || layer.asset || sequence.asset;
    const scale = Number(layer.rasterScale ?? sequence.rasterScale ?? 1);
    return {frame, asset, rasterScale: Number.isFinite(scale) && scale > 0 ? scale : 1};
  });
}

/** Atlas pixels become native avatar units before the existing portrait scale. */
export function nativeHudFrameGeometry(sample, offset = [0, 0]) {
  if (!sample?.frame) return null;
  const {frame, asset} = sample;
  const scale = Number(sample.rasterScale) > 0 ? Number(sample.rasterScale) : 1;
  const url = asset?.url || frame.url;
  if (!url || (scale !== 1 && !(asset?.width > 0 && asset?.height > 0))) return null;
  return {url, rasterScale: scale,
    width: finite(frame.nativeW) ? Number(frame.nativeW) : frame.w / scale,
    height: finite(frame.nativeH) ? Number(frame.nativeH) : frame.h / scale,
    left: (Number(frame.offsetX) || 0) + (Number(offset[0]) || 0),
    top: (Number(frame.offsetY) || 0) + (Number(offset[1]) || 0),
    backgroundX: -frame.sx / scale, backgroundY: -frame.sy / scale,
    backgroundWidth: asset?.width > 0 ? asset.width / scale : null,
    backgroundHeight: asset?.height > 0 ? asset.height / scale : null};
}

/** P/R share one cell. No template-ID arithmetic or forced Q unlock. */
export function roboHudSkills(state, catalog, hudCatalog, now, castAvailability = null, keyBindings = null) {
  const self = state?.actors?.[String(state.selfObjectId)];
  if (!self) return [];
  const entries = state.skills?.[String(self.objectId)] || {};
  const first = entries[String(SLOT.R)] ? ['R', SLOT.R] : ['P', SLOT.P];
  const q = entries[String(SLOT.Commander)] ? SLOT.Commander : SLOT.Q;
  return [first, ['E', SLOT.E], ['Space', SLOT.Space], ['Q', q]].map(([key, slot], index) => {
    const skill = cooldownView(state, self.objectId, slot, now);
    const template = catalog?.skills?.[String(skill?.skillId)];
    const icon = hudCatalog?.skills?.[String(skill?.skillId)];
    const path = icon?.logical || (icon?.szIconPath1 || template?.szIconPath1
      ? `zh_CN/icon/skills/${icon?.szIconPath1 || template.szIconPath1}` : '');
    const availability = key === 'P' ? {ready: false, reason: 'passive'}
      : castAvailability ? castAvailability(slot, now) : {ready: false, reason: 'unavailable'};
    const actionCode=({R:82,E:69,Space:32,Q:81})[key],bound=keyBindings?.[actionCode];
    const remapped=bound!=null&&bound!==actionCode;
    const keyLabel=!remapped?key:bound===1000?'Chuột trái':bound===1001?'Chuột phải':bound===32?'Space':bound>=96&&bound<=105?`Num ${bound-96}`:String.fromCharCode(bound);
    return {key:keyLabel,passive:key==='P',remapped,keycap:remapped&&NATIVE_KEYCAPS[bound]?.pixelVerified?NATIVE_KEYCAPS[bound]:null, slot, x: [150, 211, 272, 333][index], skill, template,
      icon: path ? roboHudAsset(hudCatalog, path) : null, availability,
      locked: !skill && key !== 'P', cooldownText: availability.cooldownIgnored && availability.ready
        ? '' : nativeCooldownText(skill?.remainingMs),
      tooltip:catalog?.modePresentation?.skillText?.[String(skill?.skillId)]||
        (template?{skillId:skill.skillId,name:template.szName,description:template.szDesc,cooldownMs:template.iCoolTime,mpCost:template.iMpCost}:null),
      name: catalog?.modePresentation?.skillText?.[String(skill?.skillId)]?.name||template?.szName || (key === 'P' ? 'Nội tại' : `${key}: chưa có kỹ năng`)};
  });
}

function element(document, tag, className, parent = null) {
  const node = document.createElement(tag); node.className = className;
  if (parent) parent.append(node);
  return node;
}

/** Overlay-only HUD. Callbacks are the existing client's confirmed actions. */
export class RoboHud {
  constructor({host, onCast, onSkillHover = null, castAvailability, onExit, onSettings, onSound, onFullscreen,
    onSelectAccount, onPortraitHover = null, portraitCopyAvailability = null,
    onChat, onSignal, onInteraction = null, resolveFrameAsset = () => true} = {}) {
    if (!host?.ownerDocument) throw new TypeError('RoboHud needs an overlay host');
    this.document = host.ownerDocument; this.host = host;
    Object.assign(this, {onCast, onSkillHover, castAvailability, onExit, onSettings, onSound, onFullscreen,
      onSelectAccount, onPortraitHover, portraitCopyAvailability, onChat, onSignal, onInteraction, resolveFrameAsset});
    this.root = element(this.document, 'div', 'm7-robo-hud', host);
    this.root.setAttribute('aria-label', 'Giao diện trận đấu');
    this.addNativeHighlightFilters();
    this.root.hidden = true; this.rows = new Map(); this.last = null;
    this.catalog = null; this.missing = new Set(); this.listeners = [];
    this.skillHover = null;
    this.animationTargets = new Set();
    this.title = this.make('div', 'm7-map-title');
    this.chatLog = this.make('div', 'm7-battle-chat');
    this.chatLog.setAttribute('aria-live', 'polite');
    this.score = this.make('div', 'm7-score');
    this.scoreBg = this.image('m7-score-bg', this.score);
    this.scoreLeft = this.image('m7-score-left', this.score);
    this.scoreRight = this.image('m7-score-right', this.score);
    this.scoreHomeFrame = this.image('m8134-score-home-frame', this.score);
    this.scoreGauges = [1,2].map(camp=>this.make('span',`m8134-score-gauge m8134-score-gauge-${camp}`,this.score));
    this.scoreHomeTrack = this.image('m8134-score-home-track', this.score);
    this.scoreFlags = [1,2].map(camp=>[0,1,2].map(index=>{
      const flag=this.image('m8134-score-flag',this.score);
      flag.style.left=`${camp===1?26+(2-index)*34:221+index*34}px`;return flag;
    }));
    this.scoreA = this.make('span', 'm7-score-a', this.score);
    this.scoreB = this.make('span', 'm7-score-b', this.score);
    this.target = this.make('span', 'm7-score-target', this.score);
    this.clock = this.make('span', 'm7-match-clock', this.score);
    this.deathTrophies=[1,2].map(camp=>[0,1].map(index=>{
      const image=this.image('m811-round-trophy',this.score);image.style.left=`${(camp===1?44:207)+index*29}px`;
      image.hidden=true;return image;
    }));
    this.roundBanner=this.make('div','m811-round-banner');this.roundBanner.hidden=true;
    this.roundImage=this.image('',this.roundBanner);this.roundCaption=this.make('div','m811-round-caption',this.roundBanner);
    this.roundBanner.setAttribute('aria-live','polite');
    this.objective = this.make('div', 'm7-objective');
    this.objectiveText = this.make('span', 'm7-objective-text', this.objective);
    this.kda = this.make('span', 'm7-kda', this.objective);
    this.system = this.make('div', 'm7-system');
    this.systemBg = this.image('m7-system-bg', this.system);
    this.ping = this.make('span', 'm7-ping', this.system);
    this.exit = this.button('m7-exit', 'Rời trận', this.system, () => this.onExit?.());
    this.exitImage = this.image('', this.exit);
    this.settings = this.button('m7-settings', 'Cài đặt', this.system, () => {
      if (this.onSettings) this.onSettings(); else this.settingsMenu.hidden = !this.settingsMenu.hidden;
    });
    this.settingsImage = this.image('', this.settings);
    this.settingsMenu = this.make('div', 'm7-settings-menu'); this.settingsMenu.hidden = true;
    this.soundButton = this.button('', 'Âm thanh', this.settingsMenu, () => this.onSound?.());
    text(this.soundButton, 'Âm thanh');
    this.fullscreenButton = this.button('', 'Toàn màn hình', this.settingsMenu, () => this.onFullscreen?.());
    text(this.fullscreenButton, 'Toàn màn hình');
    this.rosterA = this.make('div', 'm7-roster m7-roster-a');
    this.rosterB = this.make('div', 'm7-roster m7-roster-b');
    this.feed = this.make('div', 'm7-kill-feed'); this.feedRows = new Map();
    this.honor = this.make('div', 'm71-kill-banner'); this.honor.hidden = true;
    this.honor.setAttribute('role', 'status'); this.honor.setAttribute('aria-live', 'polite');
    this.honorBg = this.image('m71-honor-bg', this.honor);
    this.honorKillerFrame = this.image('m71-honor-frame m71-honor-killer-frame', this.honor);
    this.honorVictimFrame = this.image('m71-honor-frame m71-honor-victim-frame', this.honor);
    this.honorKiller = this.portraitNode('m71-honor-killer', this.honor, .3);
    this.honorVictim = this.portraitNode('m71-honor-victim', this.honor, .3);
    this.honorName = this.make('span', 'm71-honor-name', this.honor);
    this.honorTip = this.make('span', 'm71-honor-tip', this.honor);
    this.honorCurrent = null; this.honorHistory = [];
    this.bottom = this.make('div', 'm7-bottom');
    this.info = this.make('div', 'm7-self-info', this.bottom);
    this.life = this.make('div', 'm7-self-life', this.info);
    this.hpWord = this.image('m7-hp-word', this.info);
    this.hp = this.vital('hp', this.info); this.mp = this.vital('mp', this.info);
    this.mpWord = this.image('m7-mp-word', this.info);
    this.skills = Array.from({length: 4}, (_, index) => this.createSkill(index));
    this.buffs = this.make('div', 'm7-buffs');
    this.signals = ['atk', 'bak', 'mst'].map((kind, index) => {
      const labels = ['Tấn công', 'Rút lui', 'Tập hợp'];
      const button = this.button(`m7-signal m7-signal-${kind}`, labels[index], this.root,
        () => this.onSignal?.(kind));
      return {kind, button, image: this.image('', button)};
    });
    this.relive = this.make('div', 'm7-relive'); this.relive.hidden = true;
    this.reliveBg = this.image('m7-relive-bg', this.relive);
    this.reliveAvatar = this.portraitNode('m7-relive-avatar', this.relive, .25);
    this.killerMessage = this.make('div', 'm7-killer-message', this.relive);
    this.killerTip = this.make('div', 'm7-killer-tip', this.relive);
    this.reliveText = this.make('div', 'm7-relive-text', this.relive);
    this.reliveVip = this.make('div', 'm7-relive-vip', this.relive); text(this.reliveVip, RELIVE_TEXT.vip);
    this.spectate = this.make('div', 'm7-spectate'); this.spectate.hidden = true;
    this.status = this.make('div', 'm7-hud-status'); this.status.hidden = true;
    this.status.setAttribute('role', 'status');
    this.chatForm = this.make('form', 'm7-chat-input'); this.chatForm.hidden = true;
    this.chatChannel = this.make('span', 'm7-chat-channel', this.chatForm); text(this.chatChannel, 'Đội');
    this.chatInput = this.make('input', '', this.chatForm); this.chatInput.type = 'text';
    this.chatInput.setAttribute('aria-label', 'Tin nhắn trong trận');
    this.chatSend = this.button('', 'Gửi tin', this.chatForm); this.chatSend.type = 'submit'; text(this.chatSend, 'Gửi');
    this.listen(this.chatForm, 'submit', event => {
      event.preventDefault(); event.stopPropagation();
      const content = this.chatInput.value.trim();
      if (content && this.onChat && this.last?.connected) this.onChat({text: content, channel: 64});
      this.chatInput.value = ''; this.chatForm.hidden = true;
    });
    this.listen(this.document, 'keyup', event => {
      if (this.root.hidden || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === 'Escape') { this.clearSkillHover(); this.chatForm.hidden = true; this.settingsMenu.hidden = true; return; }
      if (event.key !== 'Enter' || event.defaultPrevented
          || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(event.target?.tagName || '')) return;
      this.onInteraction?.(); this.chatForm.hidden = false;
      this.chatInput.disabled = !this.onChat || !this.last?.connected;
      this.chatSend.disabled = this.chatInput.disabled;
      this.chatInput.placeholder = this.onChat ? 'Nhập tin nhắn…' : 'Chat trong trận chưa được kết nối';
      if (!this.chatInput.disabled) this.chatInput.focus();
    });
    if(this.document.defaultView?.addEventListener)
      this.listen(this.document.defaultView,'blur',()=>this.clearSkillHover());
    this.listen(this.document,'visibilitychange',()=>{if(this.document.hidden)this.clearSkillHover();});
  }

  make(tag, className, parent = this.root) { return element(this.document, tag, className, parent); }
  addNativeHighlightFilters() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = this.document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'm7-filter-defs'); svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    const defs = this.document.createElementNS(ns, 'defs'); svg.append(defs);
    const instance = ++hudInstanceId;
    // GUITools: RGB addition, alpha unchanged. CHighLightButton passes30;
    // TankStateView.onAvatarOver uses getHighLightFilter's default50.
    for (const [name, amount] of [['button', 30], ['avatar', 50]]) {
      const id = `m7-native-highlight-${instance}-${name}`;
      const filter = this.document.createElementNS(ns, 'filter');
      filter.setAttribute('id', id); filter.setAttribute('color-interpolation-filters', 'sRGB');
      const matrix = this.document.createElementNS(ns, 'feColorMatrix');
      const offset = amount / 255;
      matrix.setAttribute('type', 'matrix');
      matrix.setAttribute('values', `1 0 0 0 ${offset} 0 1 0 0 ${offset} 0 0 1 0 ${offset} 0 0 0 1 0`);
      filter.append(matrix); defs.append(filter);
      this.root.style.setProperty(`--m7-highlight-${name}`, `url(#${id})`);
    }
    this.root.append(svg);
  }
  image(className, parent) { const node = this.make('img', className, parent); node.alt = ''; node.draggable = false; return node; }
  listen(target, type, listener) { target.addEventListener(type, listener); this.listeners.push([target, type, listener]); }
  releaseNode(node) {
    const Node = this.document.defaultView?.Node;
    this.listeners = this.listeners.filter(([target, type, listener]) => {
      if (target === node || (typeof Node === 'function' && target instanceof Node && node.contains?.(target))) { target.removeEventListener(type, listener); return false; }
      return true;
    });
    node.remove();
  }
  button(className, label, parent, onClick) {
    const node = this.make('button', className, parent); node.type = 'button';
    node.title = label; node.setAttribute('aria-label', label);
    this.listen(node, 'pointerdown', event => { event.stopPropagation(); this.onInteraction?.(); });
    if (onClick) this.listen(node, 'click', event => { event.stopPropagation(); onClick(event); });
    return node;
  }
  bindImage(node, name, dimensions = true) {
    const asset = typeof name === 'object' ? name : roboHudAsset(this.catalog, name);
    const usable = asset?.url && asset.status !== 'missing' && !String(asset.url).endsWith('.swf');
    node.hidden = !usable;
    if (!usable) { if (name && typeof name === 'string') this.missing.add(name); return null; }
    if (node.getAttribute('src') !== asset.url) node.src = asset.url;
    if (dimensions && finite(asset.width) && finite(asset.height)) {
      node.width = asset.width; node.height = asset.height;
    }
    return asset;
  }
  paintModeScore(mode,selfCamp) {
    const style=mode?.style||'alive',home=style==='home',occupy=style==='occupy';
    this.score.dataset.mode=style;
    this.bindImage(this.scoreBg,home?'gameboard_bk':occupy?'occupy_bg':'alive_bg');
    for(const [index,node] of [this.scoreLeft,this.scoreRight].entries()){
      const side=index?'right':'left',color=selfCamp===index+1?'blue':'red';
      this.bindImage(node,home?null:`${occupy?'occupy':'alive'}_${side}_${color}`);
      const gauge=this.scoreGauges[index],key=occupy?`scoreblood_${color}${side}`:
        `hoomblood_${color}${(index===0&&color==='blue')||(index===1&&color==='red')?'2':''}`;
      const sequence=(home||occupy)&&this.catalog.effects?.['m8134_'+key];
      const value=mode?.progress?.[index],frame=sequence?.frames?.[Math.max(0,Math.min(99,Math.floor(clamp(value)*100)-1))];
      const sample=frame?{frame,asset:sequence.asset,rasterScale:1}:null;
      const geometry=sample&&nativeHudFrameGeometry(sample,[home?(index?156:48):(index?225:17),home?6:7]);
      const resolved=sample&&this.resolveFrameAsset(sample.asset);
      gauge.hidden=!(geometry&&resolved&&Number.isFinite(value));
      if(!gauge.hidden)Object.assign(gauge.style,{left:`${geometry.left}px`,top:`${geometry.top}px`,
        width:`${geometry.width}px`,height:`${geometry.height}px`,
        backgroundImage:`url("${typeof resolved==='string'?resolved:geometry.url}")`,
        backgroundPosition:`${geometry.backgroundX}px ${geometry.backgroundY}px`,
        backgroundSize:`${geometry.backgroundWidth}px ${geometry.backgroundHeight}px`});
      this.scoreFlags[index].forEach((flag,n)=>{
        this.bindImage(flag,occupy&&n<(mode.flagCounts?.[index]||0)?`occupy_${color}_${side}_flag`:null);
      });
    }
    this.bindImage(this.scoreHomeFrame,home?'fightstate_bk':null);
    this.bindImage(this.scoreHomeTrack,home?'homeblood_bk':null);
  }
  vital(kind, parent) {
    const bar = this.make('div', `m7-vital m7-vital-${kind}`, parent);
    const clip = this.make('div', 'm7-vital-clip', bar), fill = this.image('', clip);
    const label = this.make('span', 'm7-vital-label', bar);
    return {bar, clip, fill, label};
  }
  portraitNode(className, parent, scale) {
    const node = this.make('div', `m7-avatar ${className}`, parent);
    const view = this.make('div', 'm7-avatar-content', node);
    const image = this.image('', view); node.style.setProperty('--portrait-scale', scale);
    return {node, view, image, layers: []};
  }
  paintPortrait(node, portrait) {
    const animation = portrait?.animation || this.catalog?.effects?.[portrait?.effect];
    if (animation) {
      node.node.hidden = false; node.image.hidden = true;
      this.setAnimation(node, animation, portrait.bitmapOffset || [0, 0], true);
      return;
    }
    this.setAnimation(node, null);
    const asset = this.bindImage(node.image, portrait?.asset);
    node.node.hidden = !asset;
    if (asset) {
      node.image.style.left = `${portrait.bitmapOffset[0]}px`;
      node.image.style.top = `${portrait.bitmapOffset[1]}px`;
    }
  }
  setAnimation(target, sequence, offset = [0, 0], loop = true, restart = false) {
    if (!sequence) {
      this.animationTargets.delete(target); target.sequence = null;
      (target.layers || []).forEach(layer => { layer.hidden = true; });
      return;
    }
    if (target.sequence !== sequence || restart) {
      target.startedAt = this.last?.now ?? this.document.defaultView?.performance?.now?.() ?? 0;
      target.sequence = sequence;
    }
    target.offset = offset; target.loop = loop;
    target.layers ||= [];
    const length = sequence.layers?.length || 1;
    while (target.layers.length < length) target.layers.push(this.make('span', 'm7-native-frame', target.view || target.node));
    while (target.layers.length > length) target.layers.pop().remove();
    this.animationTargets.add(target);
    this.animateTarget(target, this.last?.now ?? target.startedAt);
  }
  animateTarget(target, now) {
    const elapsed = now - target.startedAt;
    const samples = nativeHudFrames(target.sequence, elapsed, target.loop);
    samples.forEach((sample, index) => {
      const node = target.layers[index], geometry = nativeHudFrameGeometry(sample, target.offset);
      node.hidden = !geometry;
      if (!geometry) { node.style.backgroundImage = 'none'; return; }
      // The scene store requests an absent page and only returns true after its
      // declared hash and image decode pass. Never let CSS fetch an unready page.
      const resolved = this.resolveFrameAsset(sample.asset);
      const sequence = target.sequence.layers?.[index] || target.sequence;
      const pages = sequence.pages || target.sequence.pages || [];
      if ((sequence.lazyPages ?? target.sequence.lazyPages) && pages.length > 1) {
        const declaredPage = sample.frame.page;
        const currentPage = Number.isInteger(declaredPage) && pages[declaredPage]?.url === sample.asset?.url
          ? declaredPage : pages.findIndex(asset => asset.url === sample.asset?.url);
        // Start loading the next page as soon as the current page is in use.
        // Waiting until12frames before its boundary was too late in page01.
        const next = currentPage >= 0 ? pages[(currentPage + 1) % pages.length] : null;
        if (next?.url && next.url !== sample.asset?.url) this.resolveFrameAsset(next);
      }
      node.hidden = !resolved;
      if (!resolved) { node.style.backgroundImage = 'none'; return; }
      node.style.width = `${geometry.width}px`; node.style.height = `${geometry.height}px`;
      node.style.left = `${geometry.left}px`; node.style.top = `${geometry.top}px`;
      // Lazy pages may return the store's live, verified Blob URL so CSS shares
      // the already decoded source rather than fetching a second image URL.
      node.style.backgroundImage = `url("${typeof resolved === 'string' ? resolved : geometry.url}")`;
      node.style.backgroundPosition = `${geometry.backgroundX}px ${geometry.backgroundY}px`;
      node.style.backgroundSize = geometry.backgroundWidth && geometry.backgroundHeight
        ? `${geometry.backgroundWidth}px ${geometry.backgroundHeight}px` : 'auto';
    });
    if (!target.loop && samples.every(sample => !sample)) this.animationTargets.delete(target);
  }
  animate(now) {
    if (this.root.hidden) return;
    this.animateAnnouncement(now);
    const self = this.last?.state?.actors?.[String(this.last.state.selfObjectId)];
    const version = self && `${self.objectId}:${self.lifeEpoch}:${self.buffPresentation?.sequence || 0}:${self.buffPresentation?.hudSequence || 0}`;
    // Native BuffProxy reacts to ADD/REMOVE/TIME immediately. Reconcile just
    // this small row on the next RAF instead of waiting for the 80ms full HUD.
    if (self && version !== this.buffVersion) this.updateBuffs(self, this.last.catalog, now);
    else this.animateBuffs(now);
    for (const target of this.animationTargets) {
      if (target.node.isConnected === false || !target.sequence) this.animationTargets.delete(target);
      else this.animateTarget(target, now);
    }
  }
  createSkill(index) {
    const button = this.button('m7-skill', 'Kỹ năng', this.bottom, () => {
      const row = this.skillRows?.[index];
      if (row && !button.disabled) this.onCast?.(row.slot);
    });
    let pointerInside=false;
    this.listen(button,'pointerenter',()=>{pointerInside=true;this.previewSkill(index);});
    this.listen(button,'pointerleave',()=>{pointerInside=false;this.clearSkillHover(index);});
    this.listen(button,'pointercancel',()=>{pointerInside=false;this.clearSkillHover(index);});
    this.listen(button,'focus',()=>this.previewSkill(index));
    this.listen(button,'blur',()=>{if(!pointerInside)this.clearSkillHover(index);});
    this.listen(button,'keydown',event=>{if(event.key==='Escape')this.clearSkillHover(index);});
    const icon = this.image('m7-skill-icon', button), shade = this.make('div', 'm7-skill-clock', button);
    const mp = this.image('m7-skill-mp-mask', button), ban = this.image('m7-skill-ban', button);
    const lock = this.image('m7-skill-lock', button), border = this.image('m7-skill-border', button);
    const timer = this.make('span', 'm7-skill-time', button), charge = this.make('span', 'm7-skill-count', button);
    const chargeRing = this.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chargeRing.setAttribute('class', 'm7-skill-charge-ring'); chargeRing.setAttribute('viewBox', '0 0 23 23');
    chargeRing.setAttribute('aria-hidden', 'true');
    const circle = this.document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const [name, value] of Object.entries({cx: 11.5, cy: 11.5, r: 10.5, fill: 'none', stroke: '#fff', 'stroke-width': 2})) circle.setAttribute(name, value);
    chargeRing.append(circle); button.append(chargeRing, charge);
    const keycap = this.image('m7-skill-key', button);
    const keytext=this.make('span','m7-skill-key m81-key-text',button);
    const complete = {node: this.make('span', 'm7-skill-fx', button), layers: []};
    const selected = {node: this.make('span', 'm7-skill-fx', button), layers: []};
    return {index, button, icon, shade, mp, ban, lock, border, timer, charge, chargeRing, circle, keycap, keytext, complete, selected};
  }
  previewSkill(index) {
    const row=this.skillRows?.[index],state=this.last?.state,self=state?.actors?.[String(state.selfObjectId)];
    if(this.root.hidden||this.last?.connected===false||!self||self.dead||self.removed||self.hp<=0
        ||state.result||!row?.skill||row.passive||!(Number(row.template?.iRange)>0)){
      this.clearSkillHover();return;
    }
    this.skillHover={index,key:`${row.slot}:${row.skill.skillId}`};
    this.onSkillHover?.(row.slot);
  }
  clearSkillHover(index=null) {
    if(!this.skillHover||(index!==null&&this.skillHover.index!==index))return;
    this.skillHover=null;this.onSkillHover?.(null);
  }
  createRoster(row) {
    const button = this.button('m7-roster-item', row.name, row.camp === 1 ? this.rosterA : this.rosterB,
      () => this.onSelectAccount?.(row.accountId));
    this.listen(button, 'pointerenter', () => this.onPortraitHover?.(row.accountId));
    this.listen(button, 'pointerleave', () => this.onPortraitHover?.(null));
    // Keep canvas focus / the selected E through pointerdown -> click.
    this.listen(button, 'pointerdown', event => { if (event.button === 0) event.preventDefault(); });
    const bg = this.image('m7-roster-bg', button), avatar = this.portraitNode('m7-roster-avatar', button, .27);
    const skin = this.image('m7-roster-skin', button), name = this.make('span', 'm7-roster-name', button);
    const hp = this.make('div', 'm7-roster-hp', button), fill = this.image('', hp);
    const cdBg = this.image('m7-roster-cd-bg', button), cdReady = this.image('m7-roster-cd-ready', button);
    const cd = this.make('span', 'm7-roster-cd', button);
    return {button, bg, avatar, skin, name, hp, fill, cdBg, cdReady, cd};
  }
  resize(width, height) {
    if (width > 0 && height > 0) { this.width = width; this.height = height;
      this.root.style.width = `${width}px`; this.root.style.height = `${height}px`; }
  }
  update(options) {
    const {state, catalog, hudCatalog, now, connected = true, spectator = {},
      remainingSeconds = null, targetScore = null, pingMs = null, killFeed = [], chatMessages = []} = options;
    const self = state?.actors?.[String(state.selfObjectId)];
    if (!self || !hudCatalog?.maps?.[String(state.mapId)]) { this.clearSkillHover(); this.root.hidden = true; return; }
    if(!connected||self.dead||self.removed||self.hp<=0||state.result)this.clearSkillHover();
    if (this.last?.state !== state) { this.clear(); }
    this.last = options; this.catalog = hudCatalog; this.root.hidden = false;
    this.root.dataset.dead = String(!!self.dead || self.hp <= 0);
    text(this.title, options.mapTitle || catalog?.maps?.[String(state.mapId)]?.name || '');
    this.scoreA.classList.toggle('m7-score-allied', self.camp === 1);
    this.scoreB.classList.toggle('m7-score-allied', self.camp === 2);
    const scoreValue = value => finite(value) ? finite(targetScore) ? Math.min(value, targetScore) : value : '—';
    const modeScore=options.practiceMode?null:modeScoreView(state,catalog,now);
    this.paintModeScore(modeScore,self.camp);
    text(this.scoreA, modeScore?.camp1??scoreValue(state.scores?.camp1)); text(this.scoreB, modeScore?.camp2??scoreValue(state.scores?.camp2));
    text(this.target, modeScore?.label??(finite(targetScore) ? targetScore : '')); text(this.clock, timeText(remainingSeconds));
    text(this.objectiveText, (options.objectiveText || (finite(targetScore) ? `Mục tiêu: ${targetScore}` : ''))+
      (modeScore?.detail?` · ${modeScore.detail}`:''));
    this.objectiveText.title = this.objectiveText.textContent;
    const deathArt=catalog.deathPresentation?.resources;
    for(let camp=1;camp<=2;camp++)for(let index=0;index<2;index++){
      const image=this.deathTrophies[camp-1][index];
      this.bindImage(image,isDeathMap(state.mapId)?deathArt?.[index<(state.scores['camp'+camp]||0)?'trophy1':'trophy2']:null,false);
      image.width=26;image.height=23;
    }
    const roundBanner=deathBannerView(state,now,options.serverTimeMs);
    this.roundBanner.hidden=!roundBanner;
    if(roundBanner){
      this.bindImage(this.roundImage,deathArt?.[roundBanner.asset],false);
      // Native bitmaps already contain their label; avoid a duplicate caption.
      this.roundImage.alt=roundBanner.text;
      const caption=roundBanner.caption??(roundBanner.asset?'':roundBanner.text);
      text(this.roundCaption,caption);this.roundCaption.hidden=!caption;
      const key=roundBanner.key+':'+roundBanner.asset;
      if(this.roundBannerKey!==key){
        this.roundBannerKey=key;
        this.roundBanner.getAnimations?.().forEach(a=>a.cancel());
        this.roundBanner.animate?.([{opacity:0,transform:'translateX(-50%) scale(.88)'},{opacity:1,transform:'translateX(-50%) scale(1)'}],{duration:260,easing:'cubic-bezier(.16,1,.3,1)',fill:'both'});
      }
    }
    const kda = selfKdaView(state); text(this.kda, `${kda.kills}/${kda.deaths}/${kda.assists}`);
    this.bindImage(this.systemBg, 'top_right_bg'); this.bindImage(this.exitImage, 'system_exit');
    this.bindImage(this.settingsImage, 'system_set');
    text(this.ping, finite(pingMs) ? `${Math.round(pingMs)}ms` : '');
    this.exit.disabled = !this.onExit || !connected; this.exit.title = this.onExit ? 'Rời trận' : 'Rời trận chưa khả dụng';
    this.exit.hidden = !nativeBattleExitVisible(state);
    this.settings.disabled = !(this.onSettings || this.onSound || this.onFullscreen);
    this.soundButton.disabled = !this.onSound; this.fullscreenButton.disabled = !this.onFullscreen;
    if (typeof options.soundEnabled === 'boolean') text(this.soundButton, options.soundEnabled ? 'Tắt âm thanh' : 'Bật âm thanh');
    this.rosterRows = roboHudRows(state, catalog, hudCatalog, now);
    const wanted = new Set(this.rosterRows.map(row => row.accountId));
    for (const [key, node] of this.rows) if (!wanted.has(key)) { this.releaseNode(node.button); this.rows.delete(key); }
    for (const row of this.rosterRows) {
      let node = this.rows.get(row.accountId);
      if (!node) { node = this.createRoster(row); this.rows.set(row.accountId, node); }
      const parent = row.camp === 1 ? this.rosterA : this.rosterB;
      if (node.button.parentNode !== parent) parent.append(node.button);
      node.button.style.top = `${row.position * 72}px`; node.button.dataset.accountId = row.accountId;
      node.button.dataset.objectId = row.objectId; node.button.dataset.dead = String(row.dead);
      const copy = this.portraitCopyAvailability?.(row.accountId, now);
      const watch = spectator.canSwitch && (spectator.eligibleObjectIds || []).includes(row.objectId);
      node.button.disabled = !this.onSelectAccount || !connected || row.dead || !(watch || copy?.copy && !row.self);
      node.button.classList.toggle('m812-copy-ready', !!copy?.ready);
      node.button.dataset.copyReady = String(!!copy?.ready);
      node.button.title = copy?.copy && !row.self
        ? `${row.name} · ${copy.ready ? 'Sao chép E: dùng phím E khi trỏ avatar; nếu tắt dùng nhanh, chọn E rồi bấm avatar.' : copy.message || 'Chưa thể sao chép.'}` : row.name;
      this.bindImage(node.bg, 'tankStateBg'); this.paintPortrait(node.avatar, row.portrait);
      const frame = hudCatalog.skinFrames?.[String(row.skinFrameType)];
      this.bindImage(node.skin, row.skinFrameType ? frame?.logical || frame?.url && frame : null);
      text(node.name, row.name); node.name.classList.toggle('m7-vip-name', row.vipLevel > 0);
      this.bindImage(node.fill, row.ally ? 'playerBlueHPBar' : 'playerRedHPBar', false);
      node.hp.style.width = `${56 * ratio(row.hp, row.maxHp)}px`;
      this.bindImage(node.cdBg, 'temateCDBg'); this.bindImage(node.cdReady, 'temateCDready');
      node.cdBg.hidden = !row.ally; node.cdReady.hidden = !row.ally || !row.space?.ready;
      text(node.cd, row.ally ? nativeRosterCooldownText(row.space?.remainingMs) : '');
    }
    this.updateVitals(self); this.skillRows = roboHudSkills(state, catalog, hudCatalog, now, this.castAvailability, this.last?.keyBindings);
    this.skillRows.forEach((row, index) => this.updateSkill(this.skills[index], row, connected && !self.dead && !state.result));
    this.updateBuffs(self, catalog, now);
    this.signals.forEach(({kind, button, image}) => {
      this.bindImage(image, `btn_signal_${kind}`); button.disabled = !this.onSignal || !connected;
      button.title = `${{atk: 'Tấn công', bak: 'Rút lui', mst: 'Tập hợp'}[kind]}${this.onSignal ? '' : ' — tín hiệu chưa được kết nối'}`;
    });
    this.updateFeed(state, catalog, killFeed, now);
    this.updateRelive(state, catalog, self, killFeed, spectator, now);
    this.updateChat(chatMessages);
    text(this.status, options.message || ''); this.status.hidden = !options.message;
  }
  updateVitals(self) {
    const hasMP = self.maxMp > 0; this.info.classList.toggle('m7-has-mp', hasMP);
    this.bindImage(this.hpWord, 'word_hp'); this.bindImage(this.mpWord, 'word_mp');
    this.bindImage(this.hp.fill, 'play_bar_l'); this.bindImage(this.mp.fill, 'img_mp_bar_bg');
    this.hp.clip.style.width = `${100 * ratio(self.hp, self.maxHp)}px`;
    this.mp.clip.style.width = `${100 * ratio(self.mp, self.maxMp)}px`;
    text(this.hp.label, `${self.hp}/${self.maxHp}`); text(this.mp.label, `${self.mp}/${self.maxMp}`);
    this.mp.bar.hidden = !hasMP; this.mpWord.hidden = !hasMP;
    const count = Number(self.lifeCount); const key = `${count}:${this.catalog?.schemaVersion}`;
    if (this.lifeKey !== key) {
      this.lifeKey = key; this.life.replaceChildren();
      const icon = roboHudAsset(this.catalog, 'tankLife');
      if (icon) for (let i = 0; i < (count === -1 ? 1 : Math.max(0, Math.min(count, 12))); i++) {
        const img = this.image('', this.life); this.bindImage(img, icon); img.style.left = `${i * 32}px`;
      }
      if (count === -1) text(this.make('span', 'm7-life-infinity', this.life), '∞');
      this.life.title = count === -1 ? 'Hồi sinh không giới hạn' : finite(count) ? `Số mạng: ${count}` : '';
    }
  }
  updateSkill(node, row, connected) {
    if(this.skillHover?.index===node.index&&(!connected||row.passive
        ||this.skillHover.key!==`${row.slot}:${row.skill?.skillId}`))this.clearSkillHover(node.index);
    node.button.style.left = `${row.x}px`; node.button.dataset.slot = row.slot;
    node.button.dataset.skillId = row.skill?.skillId ?? ''; node.button.dataset.key = row.key;
    node.button.disabled = !connected || !this.onCast || !row.availability.ready || row.passive;
    const reasons = {unavailable: 'Chưa khả dụng', metadata: 'Chờ dữ liệu kỹ năng', mp: 'Không đủ năng lượng',
      cooldown: 'Đang hồi', control: 'Đang bị khóa', passive: 'Kỹ năng nội tại'};
    const label=`${row.key}: ${row.name}${reasons[row.availability.reason] ? ` · ${reasons[row.availability.reason]}` : ''}`;
    node.button.setAttribute('aria-label', label);node.button.removeAttribute('title');
    const tooltipKey=row.tooltip?`${row.skill?.skillId}:${row.tooltip.name}:${row.tooltip.description}`:'';
    if(node.tooltipKey!==tooltipKey){
      node.tooltipCleanup?.();node.tooltipKey=tooltipKey;
      node.tooltipCleanup=row.tooltip?bindNativeSkillTooltip(node.button,this.root,row.tooltip,{},
        ()=>({width:this.root.clientWidth||1000,height:this.root.clientHeight||600})):null;
    }
    this.bindImage(node.icon, row.icon, false); this.bindImage(node.border, 'imgSkillCellMask');
    this.bindImage(node.mp, 'MPmask'); node.mp.hidden = row.availability.reason !== 'mp';
    this.bindImage(node.ban, 'skillBan'); node.ban.hidden = row.availability.reason !== 'control';
    this.bindImage(node.lock, 'locked'); node.lock.hidden = !row.locked;
    this.bindImage(node.keycap, row.passive ? null : row.keycap || (row.remapped?null:`keyboard_${row.key}`));
    node.keytext.hidden=row.passive||!row.remapped||!!row.keycap; text(node.keytext,node.keytext.hidden?'':row.key);
    // SkillTool.getCDMilSecMax selects stack cooldown only when native count > 0.
    const duration = Math.max(1, Number(row.skill?.count > 0 ? row.template?.iStackCoolTime : row.template?.iCoolTime) || 1);
    const fraction = row.availability.cooldownIgnored && row.availability.ready ? 0 : ratio(row.skill?.remainingMs, duration);
    node.shade.hidden = !fraction; node.shade.style.setProperty('--remaining-angle', `${fraction * 360}deg`);
    text(node.timer, row.cooldownText);
    text(node.charge, row.skill?.count > 0 ? `x${row.skill.count}` : '');
    node.chargeRing.style.display = row.skill?.count > 0 ? '' : 'none';
    const chargeProgress = 1 - ratio(row.skill?.nextChargeRemainingMs, Number(row.template?.iCoolTime));
    const circumference = 2 * Math.PI * 10.5;
    node.circle.setAttribute('stroke-dasharray', `${circumference * chargeProgress} ${circumference}`);
    const ready = connected && row.availability.ready && !row.passive;
    const skillKey = `${row.slot}:${row.skill?.skillId}`;
    if (ready && (!node.wasReady || node.skillKey !== skillKey)) {
      this.setAnimation(node.complete, this.catalog.effects?.skill_complete, [0, 0], true, true);
    } else if (!ready) this.setAnimation(node.complete, null);
    const isSelected = ready && this.last?.selectedSlot === row.slot;
    this.setAnimation(node.selected, isSelected ? this.catalog.effects?.skill_selected : null, [0, -2], true);
    node.wasReady = ready; node.skillKey = skillKey;
  }
  updateBuffs(self, catalog, now) {
    this.buffVersion = `${self.objectId}:${self.lifeEpoch}:${self.buffPresentation?.sequence || 0}:${self.buffPresentation?.hudSequence || 0}`;
    this.buffSource = {objectId: self.objectId, lifeEpoch: self.lifeEpoch,
      nativeOrder: [...(self.buffPresentation?.nativeOrder || Object.values(self.buffs || {}).map(buff => buff.instanceId))],
      buffs: Object.values(self.buffs || {}).map(({instanceId, templateId}) => ({instanceId, templateId})), updatedAt: now};
    const rows = roboHudBuffs(self, catalog, this.catalog?.localizedText);
    const key = JSON.stringify(rows.map(({buff}) => [buff.instanceId, buff.templateId]));
    if (this.buffKey !== key) {
      this.buffKey = key; this.buffs.replaceChildren();
      this.buffNodes = rows.map((row, index) => {
        const node = this.make('span', 'm7-buff', this.buffs); node.style.left = `${2 + index * 36}px`;
        node.tabIndex = 0;
        const tooltip = this.make('aside', 'm7-buff-tooltip', node);
        tooltip.hidden = true; tooltip.setAttribute('role', 'tooltip');
        tooltip.id = `m7-buff-tip-${index}`; node.setAttribute('aria-describedby', tooltip.id);
        const tipName = this.make('strong', 'm7-buff-tip-name', tooltip);
        const tipDescription = this.make('span', 'm7-buff-tip-description', tooltip);
        const show = () => { if (node.isConnected && node.dataset.buffActive === 'true') tooltip.hidden = false; };
        const hide = () => { tooltip.hidden = true; };
        node.addEventListener('pointerenter', show); node.addEventListener('pointerleave', hide);
        node.addEventListener('focus', show); node.addEventListener('blur', hide);
        node.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
        const icon = this.image('', node);
        const clock = this.document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        clock.setAttribute('class', 'm7-buff-clock'); clock.setAttribute('viewBox', '0 0 32 32');
        clock.setAttribute('width', '32'); clock.setAttribute('height', '32');
        clock.setAttribute('aria-hidden', 'true'); clock.setAttribute('focusable', 'false');
        const path = this.document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('fill', '#000'); path.setAttribute('fill-opacity', '.6');
        path.setAttribute('stroke-width', '1'); clock.append(path); node.append(clock);
        const stack = this.make('span', 'm7-buff-stack', node);
        return {node, icon, clock, path, stack, tooltip, tipName, tipDescription, row};
      });
    }
    rows.forEach((row, index) => {
      const view = this.buffNodes[index]; view.row = row;
      view.node.dataset.instanceId = String(row.buff.instanceId);
      view.node.dataset.templateId = String(row.buff.templateId);
      view.node.dataset.buffActive = 'true';
      this.bindImage(view.icon, row.template.resources?.szBuffIcon, false);
      view.node.removeAttribute('title'); view.node.setAttribute('aria-label', row.title);
      text(view.tipName, row.name || `Buff ${row.buff.templateId}`);
      text(view.tipDescription, row.description || '');
      view.stack.hidden = !row.stackVisible; text(view.stack, row.stackText);
    });
    this.animateBuffs(now);
  }
  animateBuffs(now) {
    for (const view of this.buffNodes || []) {
      const {buff, template} = view.row;
      const elapsed = nativeBuffElapsed(buff, template, now);
      view.drawnAt = now;
      // Diagnostics describe the frame actually painted. A later S1581 may
      // mutate the live BuffInfo before the next RAF has updated its SVG.
      view.drawnBuff = {receivedAt: buff.receivedAt, durationMs: buff.durationMs,
        expiresAt: buff.expiresAt, stackCount: buff.stackCount};
      if (view.elapsed === elapsed) continue;
      view.elapsed = elapsed;
      const geometry = nativeBuffClockGeometry(elapsed);
      view.maskVisible = geometry.visible;
      if (geometry.visible) view.clock.removeAttribute('hidden');
      else view.clock.setAttribute('hidden', '');
      view.path.setAttribute('d', geometry.path);
      view.path.setAttribute('stroke', geometry.outline ? '#000' : 'none');
    }
  }
  updateFeed(state, catalog, feed, now) {
    const entries = feed.filter(event => now - event.receivedAt < 5000
      && state.actors[String(event.killerId)] && state.actors[String(event.victimId)])
      .slice(-3).reverse();
    const key = JSON.stringify(entries.map(event => [event.killerId, event.victimId, event.receivedAt]));
    if (this.feedKey === key) return;
    this.feedKey = key;
    const entryKey = event => `${event.receivedAt}:${event.killerId}:${event.victimId}`;
    const active = new Set(entries.map(entryKey));
    for (const [id, row] of this.feedRows) {
      if (!active.has(id)) { row.remove(); this.feedRows.delete(id); }
    }
    const self = state.actors[String(state.selfObjectId)];
    for (const [position, event] of entries.entries()) {
      const id = entryKey(event), existing = this.feedRows.get(id);
      if (existing) {
        // BattlePvpKillProxy only fades the new row; previous rows stay opaque
        // and TweenLite shifts them to index * native BattleKillFrame.height.
        existing.style.animation = 'none'; existing.style.top = `${position * 30}px`;
        continue;
      }
      const row = this.make('div', 'm7-kill-row', this.feed), bg = this.image('m7-kill-bg', row);
      this.feedRows.set(id, row); row.style.top = `${position * 30}px`;
      this.bindImage(bg, 'bg_battleKill');
      for (const [index, id] of [event.killerId, event.victimId].entries()) {
        if (index === 1) { const icon = this.image('m7-kill-icon', row); this.bindImage(icon, 'kill_icon'); }
        const actor = state.actors[String(id)], character = state.characters?.find(char => char.accountId === actor.accountId);
        if (index === 0) { const portrait = this.portraitNode('m7-kill-avatar-killer', row, .17); this.paintPortrait(portrait, roboPortrait(catalog, this.catalog, actor, character)); }
        const name = this.make('span', `m7-kill-name m7-kill-name-${index === 0 ? 'killer' : 'victim'}`, row);
        text(name, nativeName(actor, character));
        name.style.color = actor.camp === self.camp ? '#28baee' : '#ff0000';
        if (index === 1) { const portrait = this.portraitNode('', row, .17); this.paintPortrait(portrait, roboPortrait(catalog, this.catalog, actor, character)); }
      }
    }
  }
  /** Called every frame alongside native announcer.tick, within HUD asset ownership. */
  updateAnnouncement(cue, catalog, bannerCatalog, now) {
    const phase = nativeHonorPhase(cue, now);
    if (!phase || !this.catalog || !bannerCatalog) { this.hideAnnouncement(); return; }
    if (this.honorCurrent?.eventKey !== cue.eventKey) {
      const map = catalog.maps?.[String(this.last?.state?.mapId)];
      const value = roboKillBannerPresentation(cue, catalog, bannerCatalog, map);
      if (!value) { this.hideAnnouncement(); return; }
      this.honorCurrent = value;
      this.honor.hidden = false; this.honor.dataset.eventKey = value.eventKey;
      this.honor.dataset.reason = value.reason; this.honor.dataset.textKey = value.textKey;
      this.honor.dataset.ally = String(value.isMate);
      this.bindImage(this.honorBg, bannerCatalog.bitmaps.honorBackground, false);
      this.bindImage(this.honorKillerFrame, bannerCatalog.bitmaps[value.isMate ? 'allyFrame' : 'enemyFrame']);
      this.bindImage(this.honorVictimFrame, bannerCatalog.bitmaps[value.isMate ? 'enemyFrame' : 'allyFrame']);
      this.paintPortrait(this.honorKiller, value.killer ? roboPortrait(catalog, this.catalog, value.killer) : null);
      this.paintPortrait(this.honorVictim, value.victim ? roboPortrait(catalog, this.catalog, value.victim) : null);
      this.honorKillerFrame.hidden = this.honorKiller.node.hidden;
      this.honorVictimFrame.hidden = this.honorVictim.node.hidden;
      text(this.honorName, value.name); text(this.honorTip, value.tip);
      // These spans have no padding/width constraint, so bounds measure only
      // the actual localized text. One layout read per cue, never per frame.
      const layout = nativeHonorLayout(this.honorName.getBoundingClientRect().width,
        this.honorTip.getBoundingClientRect().width);
      this.honor.style.width = `${layout.width}px`;
      this.honorName.style.left = `${layout.nameX}px`; this.honorTip.style.left = `${layout.tipX}px`;
      this.honorCurrent.layout = layout;
      this.honorHistory.push({...value, killer: value.killer?.externalId ?? null,
        victim: value.victim?.externalId ?? null});
      if (this.honorHistory.length > 50) this.honorHistory.shift();
    }
    this.animateAnnouncement(now);
  }
  animateAnnouncement(now) {
    const phase = nativeHonorPhase(this.honorCurrent, now);
    if (!phase) { this.hideAnnouncement(); return; }
    this.honor.hidden = false;
    this.honor.style.opacity = String(phase.alpha);
    this.honorName.style.opacity = this.honorTip.style.opacity = String(phase.labelAlpha);
  }
  hideAnnouncement() {
    if (!this.honorCurrent && this.honor.hidden) return;
    this.honor.hidden = true; this.honorCurrent = null;
    for (const target of [this.honorKiller, this.honorVictim]) {
      this.setAnimation(target, null); target.node.hidden = true;
      target.image.removeAttribute('src');
      for (const layer of target.layers) layer.style.backgroundImage = 'none';
    }
    this.honorKillerFrame.hidden = this.honorVictimFrame.hidden = true;
    text(this.honorName, ''); text(this.honorTip, '');
  }
  updateRelive(state, catalog, self, feed, spectator, now) {
    const dead = (self.dead || self.hp <= 0) && !state.result;
    this.relive.hidden = !dead; this.spectate.hidden = !dead;
    if (!dead) { this.deathPresentation = null; return; }
    const respawn = state.respawns?.[String(self.accountId)];
    const seconds = finite(respawn?.expiresAt) ? Math.max(0, Math.ceil((respawn.expiresAt - now) / 1000)) : null;
    // ReliveProxy hides its timer panel on timeout; only server packets revive the actor.
    this.relive.hidden = seconds == null || seconds <= 0;
    const deathKey = `${self.objectId}:${self.lifeEpoch}:${self.deathAt}`;
    if (this.deathPresentation?.key !== deathKey) this.deathPresentation = {key: deathKey, killer: null};
    if (!this.deathPresentation.killer) {
      const event = [...feed].reverse().find(item => item.victimId === self.objectId
        && (self.deathAt == null || item.receivedAt >= self.deathAt - 1000));
      const currentKiller = event && state.actors[String(event.killerId)];
      if (currentKiller) this.deathPresentation.killer = {...currentKiller};
    }
    const killer = this.deathPresentation.killer;
    this.relive.classList.toggle('m7-relive-tank', !!killer);
    this.bindImage(this.reliveBg, killer ? 'relive_bg_pvp' : 'relive_bg_pve');
    const character = killer && state.characters?.find(char => char.accountId === killer.accountId);
    this.paintPortrait(this.reliveAvatar, killer ? roboPortrait(catalog, this.catalog, killer, character) : null);
    const killerTank = killer && catalog?.tanks?.[String(killer.tankId)];
    const killerName = killer && (this.catalog.skinNames?.[String(killer.externalId)] || killerTank?.base?.szName || '');
    text(this.killerMessage, killerName ? RELIVE_TEXT.killed.replace('@text1@', killerName) : '');
    const tip = killerTank?.base?.szKillerTips || '';
    text(this.killerTip, this.catalog.localizedText?.[tip] || tip);
    text(this.reliveText, seconds > 0 ? RELIVE_TEXT.countdown.replace('@num1@', seconds)
      + (self.lifeCount > 0 ? ` ${RELIVE_TEXT.lives.replace('@num1@', self.lifeCount)}` : '') : '');
    const followed = state.actors[String(spectator.followObjectId)];
    text(this.spectate, (isDeathMap(state.mapId)?'Chờ vòng tiếp theo':'')+
      (spectator.mode === 'spectating' && followed ? `${isDeathMap(state.mapId)?' · ':''}Đang theo dõi ${followed.name || ''}` : ''));
  }
  updateChat(messages) {
    const key = JSON.stringify(messages.slice(-4)); if (key === this.chatKey) return;
    this.chatKey = key; this.chatLog.replaceChildren();
    for (const message of messages.slice(-4)) {
      const row = this.make('div', '', this.chatLog);
      text(row, typeof message === 'string' ? message : `${message.name ? `${message.name}: ` : ''}${message.text || ''}`);
    }
  }
  clear() {
    this.clearSkillHover();
    this.root.hidden = true; this.last = null; this.rows.forEach(row => this.releaseNode(row.button)); this.rows.clear();
    this.hideAnnouncement(); this.honorHistory = [];
    this.roundBanner.hidden=true;this.roundBannerKey=null;this.roundBanner.getAnimations?.().forEach(a=>a.cancel());
    this.deathTrophies.flat().forEach(image=>{image.hidden=true;});
    this.rosterRows = []; this.skillRows = []; this.feed.replaceChildren(); this.feedRows.clear(); this.buffs.replaceChildren();
    this.chatLog.replaceChildren(); this.chatForm.hidden = true; this.settingsMenu.hidden = true;
    this.feedKey = this.buffKey = this.chatKey = this.lifeKey = this.buffVersion = null;
    this.buffNodes = []; this.buffSource = null; this.deathPresentation = null;
    this.animationTargets.forEach(target => this.setAnimation(target, null)); this.animationTargets.clear();
    this.skills.forEach(node => { node.wasReady = false; node.skillKey = null;node.tooltipCleanup?.();node.tooltipCleanup=null;node.tooltipKey=null; });
  }
  snapshot() {
    return {visible: !this.root.hidden, width: this.width, height: this.height,
      killBanner: {visible: !this.honor.hidden, active: this.honorCurrent ? {...this.honorCurrent} : null,
        history: this.honorHistory.map(row => ({...row}))},
      roster: (this.rosterRows || []).map(({portrait, space, ...row}) => ({...row,
        portraitExternal: portrait?.externalId ?? null, portraitLogical: portrait?.logical ?? null,
        spaceRemainingMs: space?.remainingMs ?? null})),
      skills: (this.skillRows || []).map(row => ({key: row.key, slot: row.slot, skillId: row.skill?.skillId ?? null,
        icon: row.icon?.url ?? null, ready: row.availability.ready, reason: row.availability.reason,
        remainingMs: row.skill?.remainingMs ?? null})),
      buffSource: this.buffSource ? {...this.buffSource, nativeOrder: [...this.buffSource.nativeOrder],
        buffs: this.buffSource.buffs.map(buff => ({...buff}))} : null,
      buffs: (this.buffNodes || []).map(({row, elapsed, maskVisible, drawnAt, drawnBuff}) => ({
        instanceId: row.buff.instanceId, templateId: row.buff.templateId,
        icon: row.template.resources?.szBuffIcon?.url ?? null,
        name: row.name, description: row.description, title: row.title,
        stackCount: drawnBuff?.stackCount, stackText: row.stackText, stackVisible: row.stackVisible,
        elapsedFraction: elapsed, maskVisible, hideExistTime: !!row.template.hudHideExistTime,
        receivedAt: drawnBuff?.receivedAt, durationMs: drawnBuff?.durationMs,
        expiresAt: drawnBuff?.expiresAt, drawnAt})), missingAssets: [...this.missing]};
  }
  destroy() { this.clear(); this.listeners.forEach(([node, type, fn]) => node.removeEventListener(type, fn)); this.listeners = []; this.root.remove(); }
}
