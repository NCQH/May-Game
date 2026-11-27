import {teamHudRows} from './team_hud_state.js';

const make = (tag, className, text = '') => {
  const node = document.createElement(tag);
  node.className = className; node.textContent = text;
  return node;
};
const ratio = (value, max) => Math.max(0, Math.min(100, value / Math.max(1, max) * 100));

/** Team HUD has no network handle. Selecting a portrait changes camera only. */
export class BattleTeamHud {
  constructor(root, onSelect) {
    this.root = root; this.onSelect = onSelect;
    this.nodes = new Map(); this.rows = [];
    root.addEventListener('click', event => {
      const button = event.target.closest('[data-spectate-account]');
      if (button && !button.disabled) onSelect(Number(button.dataset.spectateAccount));
    });
  }

  clear() { this.root.replaceChildren(); this.nodes.clear(); this.rows = []; }

  create(row) {
    const card = make('article', 'team-card'); card.dataset.teamAccount = row.accountId;
    const heading = make('div', 'team-heading'), icon = document.createElement('img');
    icon.alt = ''; icon.width = 24; icon.height = 24;
    icon.title = 'Biểu tượng tank chung; không thể hiện skin đang mặc';
    const name = make('strong', 'team-name');
    heading.append(icon, name);
    const bars = {};
    for (const field of ['hp', 'mp']) {
      const bar = make('div', `team-vital ${field}`), fill = make('div', 'team-vital-fill');
      const label = make('span', 'team-vital-label');
      bar.append(fill, label); bars[field] = {bar, fill, label};
    }
    const shield = make('span', 'team-shield'), space = make('span', 'team-space');
    const details = make('div', 'team-details'); details.append(shield, space);
    const status = make('p', 'team-status'), buffs = make('div', 'team-buffs');
    buffs.setAttribute('aria-label', 'Hiệu ứng đang được server báo');
    const watch = make('button', 'team-watch', 'Theo dõi'); watch.type = 'button';
    watch.dataset.spectateAccount = row.accountId;
    card.append(heading, bars.hp.bar, bars.mp.bar, details, status, buffs, watch);
    this.root.append(card);
    return {card, icon, name, bars, shield, space, status, buffs, watch, buffKey: null};
  }

  update(state, catalog, now, spectator, connected) {
    this.rows = teamHudRows(state, catalog, now);
    const wanted = new Set(this.rows.map(row => row.accountId));
    for (const [id, nodes] of this.nodes) if (!wanted.has(id)) {
      nodes.card.remove(); this.nodes.delete(id);
    }
    for (const row of this.rows) {
      let node = this.nodes.get(row.accountId);
      if (!node) { node = this.create(row); this.nodes.set(row.accountId, node); }
      node.card.dataset.objectId = row.objectId;
      node.card.dataset.dead = String(row.dead);
      node.card.classList.toggle('is-self', row.self);
      node.card.classList.toggle('is-dead', row.dead);
      const followed = spectator.followObjectId === row.objectId;
      node.card.classList.toggle('is-followed', followed && spectator.mode === 'spectating');
      node.name.textContent = row.self ? `${row.name} · Bạn` : row.name;
      node.icon.hidden = !row.icon?.url;
      if (row.icon?.url && node.icon.getAttribute('src') !== row.icon.url) node.icon.src = row.icon.url;
      for (const [field, maximum] of [['hp', 'maxHp'], ['mp', 'maxMp']]) {
        node.bars[field].label.textContent = `${row[field]} / ${row[maximum]} ${field.toUpperCase()}`;
        node.bars[field].fill.style.width = `${ratio(row[field], row[maximum])}%`;
        node.card.dataset[field] = String(row[field]);
      }
      node.shield.textContent = `Khiên ${row.shield}`;
      node.card.dataset.shield = String(row.shield);
      const skill = row.space;
      node.space.textContent = !skill || skill.remainingMs == null ? 'Space: —'
        : skill.remainingMs > 0 ? `Space: ${(skill.remainingMs / 1000).toFixed(1)}s`
          : skill.ready ? 'Space: sẵn sàng' : 'Space: chờ nạp';
      node.space.title = 'Hồi Space riêng của tank này; thời gian hồi sinh nằm ở dòng trạng thái.';
      const statuses = [];
      if (row.dead) statuses.push(row.respawnRemainingMs > 0
        ? `Hồi sinh sau ${Math.ceil(row.respawnRemainingMs / 1000)}s` : 'Chờ server hồi sinh');
      else {
        if (row.controls.movementBlocked) statuses.push('Hạn chế di chuyển');
        if (row.controls.attackBlocked || row.controls.blockedSlots.length) statuses.push('Đang khóa thao tác');
      }
      node.status.textContent = statuses.join(' · ') || 'Đang chiến đấu';
      node.watch.hidden = row.self;
      node.watch.disabled = !connected || !spectator.canSwitch || row.dead
        || !spectator.eligibleObjectIds.includes(row.objectId);
      node.watch.textContent = followed && spectator.mode === 'spectating' ? 'Đang theo dõi' : 'Theo dõi';
      node.watch.setAttribute('aria-pressed', String(followed && spectator.mode === 'spectating'));
      // Flash BuffProxy exposes at most eight ordinary icons. Keep server
      // membership even when a presentation countdown reaches zero.
      const visibleBuffs = row.buffs.slice(0, 8);
      const buffKey = JSON.stringify(visibleBuffs.map(buff => [buff.instanceId, buff.templateId,
        buff.stackCount, buff.remainingMs == null ? null : Math.ceil(buff.remainingMs / 1000)]));
      if (node.buffKey !== buffKey) {
        node.buffKey = buffKey;
        node.buffs.replaceChildren(...visibleBuffs.map(buff => {
          const item = make('span', 'team-buff');
          const seconds = buff.hideExistTime || buff.remainingMs == null ? '' : ` · ${Math.ceil(buff.remainingMs / 1000)}s`;
          item.title = `${buff.name}${seconds}${buff.description ? `\n${buff.description}` : ''}`;
          if (buff.icon?.url) { const image = document.createElement('img'); image.src = buff.icon.url;
            image.alt = buff.name; image.width = 20; image.height = 20; item.append(image); }
          else item.textContent = buff.name;
          if (buff.showStackCount && buff.stackCount > 1) item.append(make('small', 'team-buff-count', String(buff.stackCount)));
          return item;
        }));
      }
    }
    return this.rows;
  }

  snapshot() { return structuredClone(this.rows); }
}
