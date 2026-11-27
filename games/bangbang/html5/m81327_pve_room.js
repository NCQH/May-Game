/* RoomFrame.PVE / RoomPlayerFrame / RoomTipsFrame, native 1018×618.
 * Only presentation and the existing solo-PvE waiting-room actions live here.
 * Room ID, map, difficulty, character, tank and companion come from accepted
 * snapshots. Stamina purchases and Guild selection use explicit server ACKs;
 * VIP/payment, room passwords and multiplayer remain unavailable.
 */
import {element, assetImage, nativeText, setText} from './m8_ui_helpers.js';
import {selectedPrimaryTank} from './m8_meta_state.js';
import {pveRoomDifficulty} from './m81314_state.js';
import {companionConfig, companionAttributes} from './m81314_companion_math.js';
import {createNativePanel} from './m81_native_panel.js';
import {PVE_ROOM_ART} from './m81327_pve_room_art.js';
import {ROOM_SIDEBAR_PLAYER_LAYOUT as SIDEBAR, roomOrnamentKey, roomOrnamentRect, roomNamePresentation, styleRoomPlayerName} from './m81330_room_layout.js';

export const PVE_ROOM_LAYOUT = Object.freeze({
  width: 1018, height: 618, cards: [[20,80],[177,80],[334,80]], card: [158,318],
  title: [425,22,168,24], sidebar: [813,45,194,521],
  tips: [509,93,284,160], guild: [513,274],
  difficulty: [550,398,217,38], map: [509,446,168,100],
  startFrame: [498,437,289,122], start: [688,453,84,84], menu: [251,561,760,46],
  chat: [9,398,464,163],
});

export const PVE_ROOM_GUILD_SLOTS = Object.freeze([1,5,6,7,8]);

const at = (node, x, y, width, height) => {
  Object.assign(node.style, {position: 'absolute', left: `${x}px`, top: `${y}px`});
  if (width != null) node.style.width = `${width}px`;
  if (height != null) node.style.height = `${height}px`;
  return node;
};
const validNumber = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const label = (text, x, y, width, height = 22, extra = '') =>
  at(element('span', text, `pve-room-label ${extra}`), x, y, width, height);

/** Do not borrow another account's cosmetics/tank while reconnecting. The
 * selected TANK notify is newer than PLAYER_BRIEF when changing tank in-room. */
export function pveRoomPlayer(snapshot) {
  const accountId = snapshot?.accountId;
  const brief = snapshot?.flow?.roster?.find(row => row.accountId === accountId) || null;
  const meta = snapshot?.meta?.character?.accountId === accountId ? snapshot.meta.character : null;
  if (!meta && !brief) return null;
  const character = {...brief, ...meta, accountId};
  const owned = meta && selectedPrimaryTank(snapshot.meta);
  const tank = owned || (Number.isInteger(brief?.tankId) && Number.isInteger(brief?.tankLevel)
    ? {...brief, level: brief.tankLevel} : null);
  return {character, tank, thew: validNumber(meta?.thew) ? meta.thew : null};
}

/** Currency names in the old protocol are misleading: cash is Xu vàng,
 * golden is bạc. Never quote or spend golden/locked cash for this offer. */
export function pveRoomThewOffer(snapshot) {
  const c = snapshot?.meta?.character;
  if (!c || c.accountId !== snapshot.accountId || !Number.isSafeInteger(c.thew) || c.thew < 0
      || !Number.isSafeInteger(c.thewBuy) || c.thewBuy < 0
      || !Number.isSafeInteger(c.currency?.cash) || c.currency.cash < 0) return null;
  const reason = snapshot.pve?.staminaPurchaseUncertain ? 'Chưa rõ kết quả yêu cầu trước. Chờ máy chủ đồng bộ hoặc kết nối lại; không tự gửi lại.'
    : c.thew > 32667 || c.thewBuy >= 32767 ? 'Thể lực đã gần giới hạn 32.767; không thể mua thêm 100 lúc này.'
    : c.currency.cash < 1 ? 'Không đủ Xu vàng. Cần 1 Xu vàng để mua 100 thể lực.' : '';
  return {amount: 100, price: 1, thew: c.thew, cash: c.currency.cash, canBuy: !reason, reason};
}

/** Same ownership boundary as the native Guild picker: the lesser learned /
 * researched level, an opened native slot, and active/passive type matching.
 * Merely having an icon/catalog row never grants a skill. */
export function pveRoomGuildOptions(snapshot, catalog, slotId = 1) {
  const account = snapshot?.account;
  if (!PVE_ROOM_GUILD_SLOTS.includes(slotId) || !account?.guild
      || snapshot.meta?.character?.accountId !== snapshot.accountId
      || !(account.slotFlags & (1 << slotId))) return [];
  return (catalog?.guildSkills || []).filter(row => {
    const level = Math.min(Number(account.learned?.[row.nGuildSkillId] || 0),
      Number(account.research?.[row.nGuildSkillId] || 0));
    return level > 0 && row.nLevel === level && (slotId === 1) === [1,2].includes(row.skillType)
      && !Object.entries(account.slots || {}).some(([id, slot]) => Number(id) !== slotId && slot.skillId === row.nGuildSkillId);
  });
}

export class PveRoomView {
  constructor(owner) {
    this.owner = owner; this.assets = owner.assets; this.disposed = false;
    this.animated = new Set(); this.playerKey = ''; this.guildKey = ''; this.dialogKey = '';
    const href = new URL('./m81327_pve_room.css', import.meta.url);
    href.search = new URL(import.meta.url).search;
    this.style = element('link'); this.style.rel = 'stylesheet'; this.style.href = href.href;
    this.root = element('section', null, 'pve-room-native');
    this.root.dataset.testid = 'pve-waiting-room'; this.root.setAttribute('aria-label', 'Phòng chờ PvE đơn');
    owner.content.append(this.style, this.root);
    this.build();
  }
  asset(key) { return PVE_ROOM_ART[key] || this.assets.get?.(key) || this.assets.ui?.assets?.[key] || null; }
  art(key, x = 0, y = 0, width = null, height = null) {
    const asset = this.asset(key);
    return at(assetImage(asset, '', 'pve-room-art'), x, y, width ?? asset?.width, height ?? asset?.height);
  }
  button(key, name, work, x, y, {width, height, icon, testId, unavailable = false} = {}) {
    const asset = this.asset(key), button = this.owner.button('', work || (() => {}),
      {className: `pve-room-button${unavailable ? ' is-unavailable' : ''}`, title: name, testId});
    button.setAttribute('aria-label', name); button.dataset.roomAction = '';
    button.dataset.unavailable = String(unavailable);
    at(button, x, y, width ?? asset?.width, height ?? asset?.height);
    if (asset) button.append(this.art(key));
    if (icon) {
      const word = this.asset(icon);
      if (word) button.append(this.art(icon, ((width ?? asset?.width) - word.width) / 2,
        ((height ?? asset?.height) - word.height) / 2));
    }
    return button;
  }
  animatedArt(asset, x, y, width, height) {
    const node = this.assets.menuArt(asset, '', 'pve-room-art', {nativePriority: 20});
    this.animated.add(node); return at(node, x, y, width ?? asset.width, height ?? asset.height);
  }
  ornament(itemId, size) {
    const row = this.assets.accountPresentation?.decorations?.[String(itemId)];
    // RoomPlayerFrame uses OrnateImg.normal. ResourcePath.as resolves that to
    // normal/300 for the summer client, NOT the compact small/300 card art.
    const key = roomOrnamentKey(row, size);
    const asset = key && this.asset(key);
    if (!asset) return null;
    const box = roomOrnamentRect(asset, size); if (!box) return null;
    const node = this.animatedArt(asset, box.x, box.y, box.width, box.height);
    node.classList.add('pve-room-ornament'); node.dataset.fit = box.fit;
    node.dataset.sourceWidth = String(asset.width); node.dataset.sourceHeight = String(asset.height);
    // Only the oversized ornament is cropped. Avatar, tank portrait, level FX
    // and name remain siblings and retain their native overflow/lifecycle.
    const clip = at(element('div', null, 'm81330-room-ornament-clip'), 0, 0, box.clipWidth, box.clipHeight);
    clip.append(node); return clip;
  }
  levelBadge(level, x, y, scale) {
    const node = at(element('span', null, 'pve-room-level'), x, y, 80, 40);
    node.style.transform = `scale(${scale})`; node.setAttribute('aria-label', `Cấp nhân vật ${level ?? 'chưa đồng bộ'}`);
    const asset = this.asset(`chrome.charLevel${level}`);
    if (asset) node.append(this.art(`chrome.charLevel${level}`));
    const fx = level >= 11 && this.asset(`chrome.charLevelEffect${Math.min(6, Math.floor((level - 11) / 5) + 1)}`);
    if (fx) node.append(this.animatedArt(fx, 0, 0, 80, 40));
    return node;
  }
  releaseInside(root) {
    for (const node of [...this.animated]) if (root.contains(node)) {
      if (node.dispose) node.dispose(); else this.assets.menuAnimations?.release(node);
      this.animated.delete(node);
    }
  }
  build() {
    this.root.append(this.art('room.background'));
    this.close = this.button('public.close', 'Rời phòng PvE', () => this.owner.requestClose(), 978, 15,
      {width: 24, height: 24, testId: 'pve-room-close'});
    this.title = at(element('h2', '', 'pve-room-title'), ...PVE_ROOM_LAYOUT.title);
    this.roomId = label('', 103, 56, 50, 22, 'pve-room-number pve-room-id'); this.roomId.dataset.testid = 'pve-room-id';
    this.thew = label('', 205, 56, 40, 22, 'pve-room-number'); this.thew.dataset.testid = 'pve-room-thew';
    this.buyThew = this.button('flow.button_buy_s_t', 'Mua 100 thể lực với 1 Xu vàng',
      () => this.owner.openThewPurchase(), 247, 49, {testId: 'pve-room-buy-thew'});
    this.root.append(this.close, this.title, this.art('flow.title_teamnumber_t', 35, 54),
      this.art('flow.label40x20', 92, 53), this.roomId,
      this.art('flow.label_liveness_t', 157, 55), this.art('flow.label40x20', 201, 53), this.thew,
      this.buyThew,
      this.button('flow.button_2_s_blue', 'Phòng PvE đơn không dùng mật mã', null, 704, 53,
        {icon: 'flow.button_title_roompassword_t', unavailable: true}));
    this.player = at(element('article', null, 'pve-room-player'), 20, 80, 158, 318);
    this.player.dataset.testid = 'pve-room-player'; this.root.append(this.player);
    for (const [x, y] of PVE_ROOM_LAYOUT.cards.slice(1)) {
      const closed = at(element('article', null, 'pve-room-closed'), x, y, 158, 318);
      closed.setAttribute('aria-label', 'Vị trí đóng — PvE đơn');
      const art = this.asset('flow.avatar_card_close_t');
      closed.append(this.art('room.playerCard'), this.art('flow.avatar_card_close_t',
        Math.round((158 - art.width) / 2), Math.round((318 - art.height) / 2)));
      this.root.append(closed);
    }
    this.buildTips(); this.buildSidebar();
    this.guild = at(element('section', null, 'pve-room-guild'), ...PVE_ROOM_LAYOUT.guild, 268, 94);
    this.guild.setAttribute('aria-label', 'Kỹ năng Guild đang trang bị'); this.root.append(this.guild);
    this.root.append(this.art('flow.word_difficulty_t', 550, 406.5), this.art('flow.roomstatus_filter_bk', 589, 398));
    this.normal = this.button(null, 'Độ khó Thường', () => this.owner.chooseDifficulty(0), 595, 404,
      {width: 85, height: 26, testId: 'pve-room-normal'});
    this.hard = this.button(null, 'Độ khó Khó offline', () => this.owner.chooseDifficulty(1), 676, 404,
      {width: 85, height: 26, testId: 'pve-room-hard'});
    this.normalWord = element('span'); this.hardWord = element('span');
    this.normal.append(this.normalWord); this.hard.append(this.hardWord);
    this.root.append(this.normal, this.hard);
    // The original preview itself is btnEditMap2; “Chọn map” is already part
    // of the native start-frame bitmap. No duplicate caption overlays it.
    this.mapButton = this.button(null, 'Chọn màn PvE', () => this.owner.openMapPicker(), 509, 446,
      {width: 168, height: 107, testId: 'pve-room-choose-map'});
    this.mapImage = at(assetImage(null, '', 'pve-room-map-image'), 0, 0, 168, 100);
    this.mapButton.append(this.mapImage);
    this.modeMark = this.art('flow.label_normal_t', 510, 447);
    this.root.append(this.mapButton, this.art('flow.startgame_background_t', ...PVE_ROOM_LAYOUT.startFrame), this.modeMark);
    this.start = this.button('flow.startgame_button_t', 'Vào game', () => this.owner.startRoom(), ...PVE_ROOM_LAYOUT.start.slice(0,2),
      {testId: 'pve-room-start'}); this.root.append(this.start);
    this.buildChat();
    // This is a local system/status area, not invented chat from other users.
    this.status = at(element('p', '', 'pve-room-status'), 12, 65, 430, 64);
    this.status.dataset.testid = 'pve-room-status'; this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite'); this.status.setAttribute('aria-atomic', 'true'); this.chat.append(this.status);
  }
  buildChat() {
    this.chat = at(element('section', null, 'pve-room-chat'), ...PVE_ROOM_LAYOUT.chat);
    this.chat.dataset.testid = 'pve-room-offline-chat'; this.chat.setAttribute('aria-label', 'Khung thông tin phòng offline');
    this.chat.append(this.art('flow.chatBk'));
    const tabs = at(element('div', null, 'pve-room-chat-tabs'), 25, 6, 359, 25);
    for (const [index, text] of ['Tổng','Room','Team','Guild','Chat riêng'].entries()) {
      const tab = element('span', text, 'pve-room-chat-tab' + (index === 0 ? ' is-selected' : ''));
      const asset = this.asset(index === 0 ? 'flow.chat_channel_select' : 'flow.chat_channel_item');
      if (asset) tab.style.backgroundImage = `url("${asset.url}")`;
      tab.setAttribute('aria-hidden', 'true'); tabs.append(tab);
    }
    this.chat.append(tabs, at(element('p', 'Phòng PvE đơn · Offline', 'pve-room-chat-offline'), 13, 36, 420, 22),
      at(element('p', 'Khung chat trang trí · Không kết nối trò chuyện trực tuyến', 'pve-room-chat-note'), 13, 137, 408, 18),
      this.art('flow.chat_up', 430, 34), this.art('flow.chat_down', 430, 114), this.art('flow.chat_downend', 430, 134));
    this.root.append(this.chat);
  }
  buildTips() {
    const frame = createNativePanel({assets: this.assets.panels.assets, kind: 'box3', state: '', width: 284, height: 160});
    this.tips = at(frame.root, 509, 93, 284, 160); this.tips.classList.add('pve-room-tips');
    const banner = this.asset('room.tipVip');
    if (banner) frame.content.append(this.art('room.tipVip', Math.round((284 - banner.width) / 2), 17));
    const backing = this.asset('room.buyVipBackground');
    if (backing) frame.content.append(this.art('room.buyVipBackground', Math.round((284 - backing.width) / 2), 109));
    const vip = this.button('public.orange100', 'Mua VIP chưa được hỗ trợ trong bản offline', null, 92, 115,
      {icon: 'room.buyVipLabel', unavailable: true, testId: 'pve-room-vip-unavailable'});
    if (!this.asset('room.buyVipLabel')) vip.append(label('MUA VIP', 0, 4, 100, 24, 'pve-room-vip-label'));
    frame.content.append(vip); this.root.append(this.tips);
  }
  buildSidebar() {
    this.sidebar = at(element('section', null, 'pve-room-sidebar'), ...PVE_ROOM_LAYOUT.sidebar);
    this.sidebar.setAttribute('aria-label', 'Nhân vật trong phòng'); this.sidebar.append(this.art('flow.roomplayerlist_bk'));
    for (let i = 0; i < 7; i++) this.sidebar.append(this.art('flow.roomplayerlist_item', 9, 40 + 66 * i));
    for (const [key, name, x] of [['team','Guild',15],['friend','Bạn',71],['hall','Room',127]]) {
      const tab = this.button(key === 'hall' ? 'flow.roomplayerlist_label_selected' : 'flow.roomplayerlist_label_bk',
        key === 'hall' ? 'Danh sách phòng PvE đơn' : `${name}: chưa có danh sách trực tuyến`, null, x, 6,
        {icon: `flow.roomplayerlist_label_${key}_t`, unavailable: true});
      tab.setAttribute('aria-pressed', String(key === 'hall')); this.sidebar.append(tab);
    }
    this.sidebar.append(this.art('flow.darkgreen_scrollbar_bk', 169, 53, 16, 432),
      this.art('flow.darkgreen_scrollbar_up', 169, 37), this.art('flow.darkgreen_scrollbar_down', 169, 483));
    this.sidebarPlayer = at(element('article', null, 'pve-room-sidebar-player'), 5, 37, SIDEBAR.width, SIDEBAR.height);
    this.sidebar.append(this.sidebarPlayer); this.root.append(this.sidebar);
  }
  updatePlayer(model) {
    const s = this.owner.snapshot, metaCurrent = s.meta?.character?.accountId === s.accountId;
    const activeUuid = metaCurrent ? s.companions?.activeUuid : null;
    const item = activeUuid && s.meta?.containers?.[5]?.items?.find(row => row.uuid === activeUuid && row.count > 0);
    const namePresentation = roomNamePresentation(model?.character, this.assets, {clock: this.owner.client?.lastClock});
    const key = JSON.stringify([model, item, activeUuid, namePresentation.vipLevel]);
    if (key !== this.playerKey) {
      const focus = this.root.contains(document.activeElement) ? document.activeElement?.dataset?.testid : null;
      this.playerKey = key; this.releaseInside(this.player); this.releaseInside(this.sidebarPlayer);
      this.player.replaceChildren(this.art('room.playerCard'), this.art('room.selfOverlay'));
      this.sidebarPlayer.replaceChildren(); this.ping = null;
      if (!model) { this.player.setAttribute('aria-label', 'Đang đồng bộ nhân vật'); return; }
      const {character: c, tank} = model;
      this.player.dataset.accountId = String(c.accountId); this.sidebarPlayer.dataset.accountId = String(c.accountId);
      this.player.setAttribute('aria-label', `Đội trưởng ${nativeText(c.name)}`);
      const ornament = this.ornament(c.decorateId, 'normal'); if (ornament) this.player.append(ornament);
      const head = this.asset(this.assets.chrome?.avatars?.[String(c.avatarId)]);
      if (head) this.player.append(at(assetImage(head, nativeText(c.name), 'pve-room-art pve-room-player-avatar'), 13, 39, 60, 60));
      this.player.append(this.art('flow.avatar_card_name', 13, 99),
        styleRoomPlayerName(label(nativeText(c.name), ...namePresentation.name, 'pve-room-player-name'), namePresentation),
        this.levelBadge(c.level, 73, 45, .6),
        this.button('room.cardButton', 'Xem hồ sơ', () => this.owner.openRoomPanel('profile'), 121, 14,
          {icon: 'room.cardInfo', testId: 'pve-room-profile'}),
        this.button('room.interact', 'Tương tác người chơi chưa được hỗ trợ', null, 121, 70, {unavailable: true}));
      if (namePresentation.vipAsset) this.player.append(at(assetImage(namePresentation.vipAsset,
        `${namePresentation.vipLevel >= 100 ? 'Super VIP' : 'VIP'} ${namePresentation.vipLevel % 100}`,
        'pve-room-art m81331-room-vip'), ...namePresentation.vip));
      if (tank) {
        const portrait = this.assets.portraitForTank(tank, {size: 140, preferNative: true});
        this.animated.add(portrait); this.player.append(at(portrait, 9, 125, 140, 140));
        // Flex cvsTank measures the level-prefix + actual tank name, then
        // centers that combined group. A fixed-width name box creates a gap
        // next to short names and must not replace this intrinsic sizing.
        const row = at(element('div', null, 'pve-room-tank-name'), 0, 248, 158, 26);
        const level = this.asset(`tank.level${tank.level}`);
        if (level) {
          const image = assetImage(level, `Cấp tank ${tank.level}`, 'pve-room-tank-level');
          image.style.width = `${level.width * .75}px`; image.style.height = `${level.height * .75}px`; row.append(image);
        }
        const name = nativeText(this.assets.tankName(tank.tankId));
        row.append(element('span', name, 'pve-room-tank-caption')); row.title = `Lv.${tank.level} ${name}`; this.player.append(row);
      }
      let power = !metaCurrent || activeUuid ? null : 0;
      if (item) {
        try {
          const config = companionConfig(this.owner.catalog, this.owner.tipTables.companions, item);
          if (config) {
            const helper = this.owner.asset(config.entry.icon);
            const button = this.button(null, 'Đổi / nâng cấp trợ thủ', () => this.owner.openCompanions(), 99, 121,
              {width: 50, height: 50, testId: 'pve-room-companion'});
            if (helper) button.append(at(assetImage(helper, nativeText(config.entry.name), 'pve-room-art'), 0, 0, 50, 50));
            button.title = `${nativeText(config.entry.name)} · Lv.${item.level}`; this.player.append(button);
            power = companionAttributes(this.owner.tipTables.companions, item, config.booster).score;
          }
        } catch { /* An invalid/unsynchronized item must not become another pet. */ }
      }
      this.player.append(this.art('room.masterBackground', 16.5, 283), this.art('room.masterLabel', 56.5, 279));
      this.ping = label('', 104, 299, 52, 18, 'pve-room-ping'); this.player.append(this.ping);
      const sidebarOrnament = this.ornament(c.decorateId, 'hall'); if (sidebarOrnament) this.sidebarPlayer.append(sidebarOrnament);
      if (head) this.sidebarPlayer.append(at(assetImage(head, '', 'pve-room-art pve-room-sidebar-avatar'), ...SIDEBAR.head));
      this.sidebarPlayer.append(this.levelBadge(c.level, ...SIDEBAR.level), label(nativeText(c.name), ...SIDEBAR.name, 'pve-room-sidebar-name'),
        label(power == null ? 'Pet: —' : `Pet: ${power}`, ...SIDEBAR.detail, 'pve-room-helper-power'),
        this.button('flow.button_watch_t', 'Xem hồ sơ', () => this.owner.openRoomPanel('profile'), ...SIDEBAR.watch,
          {testId: 'pve-room-sidebar-profile'}));
      if (focus) [...this.root.querySelectorAll('[data-testid]')].find(node => node.dataset.testid === focus)?.focus?.({preventScroll: true});
    }
    if (this.ping) {
      const latency = s.latencyMs;
      setText(this.ping, validNumber(latency) ? `${Math.round(latency)}ms` : '—');
      this.ping.setAttribute('aria-label', validNumber(latency) ? `Độ trễ ${Math.round(latency)} mili giây` : 'Chưa đo được độ trễ');
    }
  }
  updateGuild() {
    const account = this.owner.snapshot.account || {}, key = JSON.stringify([this.owner.snapshot.accountId,
      this.owner.snapshot.meta?.character?.accountId, account.guild, account.slots, account.slotFlags, account.learned, account.research]);
    if (key === this.guildKey) return; this.guildKey = key;
    // The full native frame class is absent in the supplied decompile. Match
    // the reference's shallow blue frame, not mismatched thick Box3 strips.
    this.guild.dataset.frameGeometry = 'reference-reconstruction';
    this.guild.replaceChildren(at(element('div', null, 'pve-room-guild-tab'), 0, 0, 84, 26),
      at(element('div', null, 'pve-room-guild-frame'), 0, 18, 268, 74),
      this.art('account.guildSkill', 12, 5), label('GUILD', 46, 3, 36, 20, 'pve-room-guild-caption'));
    for (const [index, slot] of PVE_ROOM_GUILD_SLOTS.entries()) {
      const saved = account.slots?.[slot], enabled = !!account.guild && !!(account.slotFlags & (1 << slot));
      const options = pveRoomGuildOptions(this.owner.snapshot, this.assets.account, slot);
      const skill = enabled && options.find(row => row.nGuildSkillId === saved?.skillId && row.nLevel === saved?.level);
      // The native background includes the empty active grid. Passive slots
      // exist only when the server has opened them; no assumed free skills.
      if (slot > 1 && !enabled) continue;
      const size = slot === 1 ? 63 : 39, x = slot === 1 ? 8 : 80 + (index - 1) * 42;
      const button = this.button(null, skill ? `${nativeText(skill.name)} · Cấp ${skill.nLevel}` : 'Kỹ năng Guild chưa trang bị',
        () => this.owner.openGuildSkillPicker(slot), x, slot === 1 ? 25 : 38,
        {width: size, height: size, testId: `pve-room-guild-${slot}`, unavailable: !options.length});
      button.append(this.art(slot === 1 ? 'room.guildMainBackground' : 'room.guildBackground'));
      const inset = slot === 1 ? 6.5 : 2, iconSize = slot === 1 ? 50 : 35;
      if (skill?.icon) button.append(at(assetImage(skill.icon, nativeText(skill.name), 'pve-room-art'), inset, inset, iconSize, iconSize));
      else button.title = options.length ? 'Chọn kỹ năng Guild đã học' : account.guild ? 'Chưa có kỹ năng phù hợp đã học' : 'Chưa tham gia Guild';
      this.guild.append(button);
    }
  }
  dialogButton(text, work, testId, x, y, width = 100) {
    const node = this.owner.button(text, work, {className: 'pve-room-dialog-button', testId,
      disabled: !!this.owner.pending});
    return at(node, x, y, width, 32);
  }
  updateGuildPicker(dialog, skills, previousFocus) {
    // ClanSkillSelectBoxFrame.as: Box3 LIGHT_BG 350×148, list at17,6 with
    // 320×120 viewport and 60×60 tiles. Keep this compact in-room picker.
    const index = PVE_ROOM_GUILD_SLOTS.indexOf(dialog.slotId);
    const anchorX = PVE_ROOM_LAYOUT.guild[0] + (index === 0 ? 39.5 : 99.5 + (index - 1) * 42);
    const x = Math.max(12, Math.min(656, anchorX - 264)), y = 366;
    this.modal = at(element('div', null, 'pve-room-dialog-shade pve-room-guild-shade'), 0, 0, 1018, 618);
    this.modal.addEventListener('click', event => { if (event.target === this.modal) this.owner.closeRoomDialog(dialog); });
    const shell = createNativePanel({assets: this.assets.panels.assets, kind: 'box3', state: 'LIGHT_BG', width: 350, height: 148});
    const panel = at(shell.root, x, y, 350, 148);
    panel.classList.add('pve-room-dialog', 'pve-room-guild-popover'); panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', dialog.slotId === 1
      ? 'Chọn kỹ năng Guild chủ động đã học' : 'Chọn kỹ năng Guild bị động đã học');
    panel.setAttribute('aria-busy', String(!!this.owner.pending)); panel.dataset.testid = 'pve-guild-dialog';
    shell.content.append(this.art('room.guildPickerArrow', 254, -18));
    const current = this.owner.snapshot.account?.slots?.[dialog.slotId];
    const list = at(element('div', null, 'pve-room-guild-picker'), 17, 6, 320, 120);
    for (const row of skills) {
      const selected = current?.skillId === row.nGuildSkillId && current?.level === row.nLevel;
      const title = `${nativeText(row.name)} · Cấp ${row.nLevel}${selected ? ' · Đang trang bị' : ''}`;
      const button = this.owner.button('', () => this.owner.equipRoomGuildSkill(row.nGuildSkillId, dialog),
        {className: 'pve-room-guild-choice' + (selected ? ' is-selected' : ''), disabled: !!this.owner.pending,
          title: `${title}\n${nativeText(row.description)}`, testId: `pve-guild-choice-${row.nGuildSkillId}`});
      button.setAttribute('aria-label', title); button.setAttribute('aria-pressed', String(selected));
      if (row.icon) button.append(assetImage(row.icon, '', 'pve-room-guild-choice-icon'));
      button.append(element('span', `Lv.${row.nLevel}`, 'pve-room-guild-choice-level')); list.append(button);
    }
    shell.content.append(list);
    if (current?.skillId) {
      const remove = this.owner.button('Tháo', () => this.owner.equipRoomGuildSkill(0, dialog),
        {disabled: !!this.owner.pending, className: 'pve-room-picker-link', testId: 'pve-guild-unequip'});
      remove.setAttribute('aria-label', 'Tháo kỹ năng Guild đang trang bị'); shell.content.append(at(remove, 12, 128, 65, 18));
    }
    const close = this.owner.button('Đóng', () => this.owner.closeRoomDialog(dialog),
      {disabled: !!this.owner.pending, className: 'pve-room-picker-link', testId: 'pve-guild-cancel'});
    shell.content.append(at(close, 273, 128, 65, 18));
    const message = this.owner.pending ? 'Đang chờ máy chủ xác nhận…' : this.owner.notice || '';
    const status = at(element('p', message, 'pve-room-dialog-status'), 80, 128, 190, 18);
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.dataset.testid = 'pve-room-dialog-status';
    shell.content.append(status); this.modal.append(panel); this.root.append(this.modal);
    const restored = previousFocus && this.modal.querySelector(`[data-testid="${previousFocus}"]`);
    const focus = restored && !restored.disabled ? restored : this.modal.querySelector('button:not(:disabled)');
    focus?.focus?.({preventScroll: true});
  }
  updateDialog() {
    const dialog = this.owner.roomDialog;
    const offer = dialog?.kind === 'thew' ? pveRoomThewOffer(this.owner.snapshot) : null;
    const skills = dialog?.kind === 'guild' ? pveRoomGuildOptions(this.owner.snapshot, this.assets.account, dialog.slotId) : [];
    const key = JSON.stringify([dialog, offer, skills.map(row => [row.nGuildSkillId,row.nLevel]),
      this.owner.snapshot.account?.slots, this.owner.pending, this.owner.notice]);
    if (key === this.dialogKey) return; this.dialogKey = key;
    const previousFocus = this.modal?.contains(document.activeElement) ? document.activeElement?.dataset?.testid : null;
    this.modal?.remove(); this.modal = null;
    if (!dialog) return;
    if (dialog.kind === 'guild') {
      this.updateGuildPicker(dialog, skills, previousFocus); return;
    }
    const width = 418, height = 268;
    this.modal = at(element('div', null, 'pve-room-dialog-shade'), 0, 0, 1018, 618);
    const shell = createNativePanel({assets: this.assets.panels.assets, kind: 'box1', state: 'CONFIRM', width, height});
    const panel = at(shell.root, (1018 - width) / 2, (618 - height) / 2, width, height);
    panel.classList.add('pve-room-dialog'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Xác nhận mua thể lực'); panel.dataset.testid = 'pve-thew-dialog';
    const title = at(element('h3', 'Mua thể lực', 'pve-room-dialog-title'), 56, 19, width - 112, 24);
    shell.content.append(title);
    const close = this.button('public.close', 'Đóng', () => this.owner.closeRoomDialog(dialog), width - 37, 16,
      {width: 24, height: 24, testId: 'pve-room-dialog-close'});
    delete close.dataset.roomAction; close.disabled = !!this.owner.pending; shell.content.append(close);
    const body = at(element('div', null, 'pve-room-purchase-copy'), 36, 65, width - 72, 108);
    body.append(element('strong', '100 thể lực = 1 Xu vàng'),
      element('p', offer ? `Thể lực hiện có: ${offer.thew} · Xu vàng: ${offer.cash}` : 'Đang đồng bộ thể lực và Xu vàng…'),
      element('p', 'Số dư và thể lực chỉ cập nhật theo xác nhận máy chủ.'));
    shell.content.append(body);
    const buy = this.dialogButton('Mua · 1 Xu vàng', () => this.owner.confirmThewPurchase(dialog), 'pve-thew-confirm', 73, height - 60, 150);
    buy.classList.add('is-primary'); buy.disabled = !!this.owner.pending || !offer?.canBuy;
    shell.content.append(buy, this.dialogButton('Hủy', () => this.owner.closeRoomDialog(dialog), 'pve-thew-cancel', 241, height - 60, 104));
    const message = this.owner.pending ? `${this.owner.pending}: đang chờ xác nhận máy chủ…`
      : this.owner.notice || offer?.reason || '';
    const status = at(element('p', message, 'pve-room-dialog-status'), 30, height - 94, width - 60, 30);
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.dataset.testid = 'pve-room-dialog-status';
    shell.content.append(status); this.modal.append(panel); this.root.append(this.modal);
    const restored = previousFocus && this.modal.querySelector(`[data-testid="${previousFocus}"]`);
    const focus = restored && !restored.disabled ? restored : this.modal.querySelector('button:not(:disabled)');
    focus?.focus?.({preventScroll: true});
  }
  paintDifficulty(button, word, hard, selected, unavailable) {
    const key = hard ? unavailable ? 'word_difficult_disabled_t' : selected ? 'word_difficult_selected_t' : 'word_difficult_t'
      : selected ? 'word_normal_selected_t' : 'word_normal_t';
    const signature = `${key}:${selected}`;
    if (button.dataset.visual !== signature) {
      button.dataset.visual = signature;
      const a = this.asset('flow.' + key), parts = [];
      if (selected) parts.push(this.art('flow.option_seleted_bk'));
      parts.push(this.art('flow.' + key, (85 - a.width) / 2, (26 - a.height) / 2)); word.replaceChildren(...parts);
    }
    button.setAttribute('aria-pressed', String(selected));
  }
  update() {
    if (this.disposed || !this.owner.snapshot) return;
    const s = this.owner.snapshot, card = this.owner.roomCard, room = s.play?.room;
    const hard = pveRoomDifficulty(room) === 1, model = pveRoomPlayer(s);
    this.root.dataset.mapId = card ? String(card.mapId) : '';
    this.root.dataset.difficulty = hard ? 'hard' : 'normal';
    this.root.setAttribute('aria-busy', String(!this.owner.mutable));
    setText(this.title, card?.name || 'Đang đồng bộ màn PvE');
    setText(this.roomId, Number.isInteger(room?.roomId) ? room.roomId : '—');
    this.roomId.title = `Mã đội: ${Number.isInteger(room?.roomId) ? room.roomId : 'chưa đồng bộ'}`;
    setText(this.thew, model?.thew == null ? '—' : model.thew);
    this.updatePlayer(model); this.updateGuild();
    const hardReason = card ? this.owner.lockText(card, true) : 'Chưa nhận bản đồ từ máy chủ.';
    this.hard.title = hardReason || 'Khó offline: bản đồ và cơ chế màn thường, chỉ số PvE riêng.';
    this.hard.setAttribute('aria-label', 'Độ khó Khó offline' + (hardReason ? ` — ${hardReason}` : ''));
    this.paintDifficulty(this.normal, this.normalWord, false, !hard, false);
    this.paintDifficulty(this.hard, this.hardWord, true, hard, !!hardReason);
    const modeArt = this.asset(hard ? 'flow.label_diffcult_t' : 'flow.label_normal_t');
    if (modeArt && this.modeMark.getAttribute('src') !== modeArt.url) this.modeMark.src = modeArt.url;
    const preview = this.owner.asset(card?.map?.gui) || this.owner.asset(card?.map?.minimap);
    this.mapImage.hidden = !preview;
    if (preview && this.mapImage.getAttribute('src') !== preview.url) this.mapImage.src = preview.url;
    this.mapImage.alt = card?.name || '';
    this.mapButton.title = `${card?.name || 'Chọn màn PvE'} · ${hard ? 'Khó offline' : 'Thường'} — Chọn map`;
    this.start.setAttribute('aria-label', `Vào game: ${card?.name || 'PvE'} · ${hard ? 'Khó offline' : 'Thường'}`);
    const roomBlocked = !this.owner.mutable || !!this.owner.roomDialog;
    for (const button of this.root.querySelectorAll('[data-room-action]'))
      button.disabled = roomBlocked || button.dataset.unavailable === 'true';
    this.hard.disabled = roomBlocked || !!hardReason;
    this.start.disabled = roomBlocked || !card || !!this.owner.lockText(card, hard);
    this.buyThew.disabled = roomBlocked || !pveRoomThewOffer(s);
    const message = this.owner.pending ? `${this.owner.pending}: đang chờ xác nhận máy chủ…`
      : this.owner.notice || (!card ? 'Đang đồng bộ bản đồ từ máy chủ…' : !card.hardSupported ? 'Màn này chỉ có chế độ Thường trong bản gốc.' : '');
    setText(this.status, message); this.status.hidden = !message;
    this.updateDialog();
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.releaseInside(this.root); this.root.remove(); this.style.remove();
  }
}
