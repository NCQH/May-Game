import {M81337Connection as M8Connection} from './m81337_connection.js';
import {M8BattleAssets} from './m8_assets.js';
import {M8UI} from './m8_ui.js';
import {BattleView} from './battle_view.js';
import {NATIVE_TANK_IDS} from './m6_control_contract.js';

const byId = id => document.getElementById(id);
let catalog = {}, assets = {}, lastState = null;
let renderingKey = '', hallKey = '', rosterKey = '', sceneKey = '', settingsKey = '';
let queuedState = null, renderTimer = null;
const battleAssets = new M8BattleAssets();
let battleView = null, outsideUI = null;
// Keep the accepted battle DOM independent of the replaced outside shell.
document.body.append(byId('battle-panel'));
const nativeTankIds = new Set(NATIVE_TANK_IDS);
const phaseNames = {idle: 'Chưa kết nối', web: 'Xác thực web', auth: 'Đang đăng nhập', gate: 'Đang nối nhân vật',
  sync: 'Đang đồng bộ', ready: 'Đã kết nối', disconnected: 'Đã ngắt', reconnecting: 'Đang kết nối lại', error: 'Cần kiểm tra'};
const playNames = {lobby: 'Sảnh', room: 'Trong phòng', selecting: 'Chọn tank', loading: 'Đang tải scene', scene: 'Đã nhận scene'};
const bagNames = {0: 'Tổng hợp', 2: 'Vật phẩm', 3: 'Nguyên liệu', 4: 'Avatar', 6: 'Skin', 7: 'Nền', 9: 'Kho 9', 10: 'Tinh thể'};
const tankName = id => {
  const name = catalog[id]?.name || assets.tanks?.[id]?.name || `Tank ${id}`;
  return id === 10000056 && name === 'Quan Công' ? 'Quan Công (Quan Vũ)' : name;
};
// The current server's bot_setup.configure_room supplies these Vietnamese
// labels. The config pack retains Chinese names, which need optional fonts.
const mapName = id => ({7: 'Sân tập sa mạc', 19: 'Robo', 20: 'Dắt bò'}[id] || `Map ${id}`);
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = String(text);
  if (className) node.className = className;
  return node;
};

function renderTanks(state) {
  const query = byId('tank-search').value.trim().toLocaleLowerCase('vi');
  const selection = state.play.selection;
  const enabled = state.phase === 'ready' && state.play.phase === 'selecting' && !state.play.busy;
  const key = JSON.stringify([state.tanks, query, Object.keys(catalog).length,
    Object.keys(assets.tanks || {}).length, enabled, selection?.selectedTankId]);
  if (renderingKey === key) return;
  renderingKey = key;
  const fragment = document.createDocumentFragment();
  let shown = 0;
  for (const tank of state.tanks) {
    const id = tank.tankId, name = tankName(id);
    if (query && !`${name} ${id}`.toLocaleLowerCase('vi').includes(query)) continue;
    const selectedMatch = selection?.selectedTankId === id;
    const node = element('li', null, `tank-card${tank.selected ? ' active' : ''}${selectedMatch ? ' selected-match' : ''}`);
    const icon = assets.tanks?.[id]?.icon;
    if (icon) {
      const image = document.createElement('img');
      image.src = icon.url; image.alt = ''; image.className = 'tank-icon'; image.loading = 'lazy';
      image.title = 'Biểu tượng tank chung; không thể hiện skin hiện tại'; node.append(image);
    }
    node.append(element('strong', name), element('p', `Cấp sao ${tank.level} · ID ${id}`),
      element('p', `Ngoại hình ${tank.externalId} · Khung ${tank.skinFrameType}`));
    if (tank.selected) node.append(element('span', 'Tank chủ chiến', 'active-label'));
    if (selectedMatch) node.append(element('span', 'Server đã chọn cho trận', 'match-label'));
    const supported = nativeTankIds.has(id);
    const button = element('button', !supported ? 'Tank chưa được server hỗ trợ' : selectedMatch ? 'Đã chọn cho trận' : 'Chọn cho trận');
    button.type = 'button'; button.dataset.selectTank = String(id);
    button.disabled = !supported || !enabled || tank.containerType !== 0 || selectedMatch;
    node.append(button); fragment.append(node); shown += 1;
  }
  byId('tank-list').replaceChildren(fragment);
  byId('garage-empty').hidden = shown > 0;
  byId('garage-empty').textContent = state.tanks.length
    ? 'Không có tank khớp từ khóa này.' : 'Danh sách tank sẽ xuất hiện sau khi server xác nhận nhân vật và gửi kho.';
}

function countdown() {
  const selection = lastState?.play.selection;
  if (!selection) return;
  const seconds = Math.max(0, Math.ceil((selection.deadlineAt - Date.now()) / 1000));
  byId('selection-countdown').textContent = seconds;
  byId('selection-countdown').title = seconds ? 'Thời gian còn lại theo lần xác nhận gần nhất của server' : 'Đang chờ server chốt';
  // Presentation only: reaching zero never sends a request or starts a scene.
}

function renderPlay(state) {
  const p = state.play, ready = state.phase === 'ready', free = ready && !p.busy;
  document.body.dataset.playPhase = p.phase;
  byId('play-badge').textContent = playNames[p.phase] || p.phase;
  byId('play-badge').className = `badge ${p.phase === 'scene' ? 'ready' : ''}`;
  byId('play-message').textContent = p.message;
  byId('play-error').hidden = !p.error;
  byId('play-error').textContent = p.error;
  byId('hall-panel').hidden = p.phase !== 'lobby';
  byId('room-panel').hidden = p.phase === 'lobby';
  byId('room-actions').hidden = p.phase !== 'room';
  byId('selection-panel').hidden = p.phase !== 'selecting';
  byId('scene-panel').hidden = !['loading', 'scene'].includes(p.phase);
  for (const id of ['bot-mode', 'bot-allies', 'bot-enemies', 'bot-level', 'bot-guild', 'bot-crystals', 'bot-military', 'bot-ai', 'bot-ai-enemies', 'save-bots', 'preset-3v3', 'create-room', 'refresh-hall']) {
    byId(id).disabled = !free || p.phase !== 'lobby' || !p.setup || !!state.multiplayer?.queue.active;
  }
  const newSettingsKey = JSON.stringify(p.setup);
  if (p.setup && newSettingsKey !== settingsKey) {
    settingsKey = newSettingsKey;
    if (![...byId('bot-mode').options].some(option => option.value === p.setup.mode)) {
      const option = element('option', `Thiết lập hiện hành · ${p.setup.mode}`); option.value = p.setup.mode;
      byId('bot-mode').append(option);
    }
    byId('bot-mode').value = p.setup.mode;
    byId('bot-allies').value = p.setup.allies.length;
    byId('bot-enemies').value = p.setup.enemies.length;
    byId('bot-level').value = p.setup.enemies[0] || 5;
    byId('bot-guild').value = p.setup.bot_guild ? '1' : '0';
    byId('bot-crystals').value = p.setup.bot_crystals ? '1' : '0';
    byId('bot-military').value = p.setup.bot_military ? '1' : '0';
    byId('bot-ai').value = p.setup.bot_ai_allies || p.setup.bot_ai || 'legacy';
    byId('bot-ai-enemies').value = p.setup.bot_ai_enemies || p.setup.bot_ai || 'legacy';
  }
  const botName=value=>value==='elite_v1'?'ProV3':'Bot gốc';
  byId('bot-summary').textContent = p.setup ? `PK không rank: ${p.setup.mode} · Cùng đội: ${botName(p.setup.bot_ai_allies||p.setup.bot_ai)} · Đối thủ: ${botName(p.setup.bot_ai_enemies||p.setup.bot_ai)} · ${p.setup.allies.length} bot cùng đội (cấp ${p.setup.allies.join(', ') || '—'}) · ${p.setup.enemies.length} bot đối thủ (cấp ${p.setup.enemies.join(', ')||'—'}).`
    : 'Thiết lập hiện hành sẽ được tải sau khi đăng nhập.';
  const nextHallKey = JSON.stringify([p.rooms, p.hallReceived, free]);
  if (nextHallKey !== hallKey) {
    hallKey = nextHallKey;
    const nodes = p.rooms.map(room => {
      const li = element('li', null, 'hall-card'), info = element('div');
      info.append(element('strong', room.name), element('p', `Phòng ${room.roomId} · ${mapName(room.mapId)} · ${room.playerCount}/${room.maxPlayers}`));
      const button = element('button', 'Vào phòng'); button.type = 'button';
      button.dataset.joinRoom = String(room.roomId); button.disabled = !free || !p.hallReceived;
      li.append(info, button); return li;
    });
    if (!nodes.length) nodes.push(element('li', p.hallReceived ? 'Server chưa trả phòng khả dụng.' : 'Tải danh sách phòng mới hoặc tạo phòng bot.', 'subtle'));
    byId('hall-rooms').replaceChildren(...nodes);
  }
  const room = p.room;
  if (room) {
    byId('room-title').textContent = room.name;
    byId('room-map').textContent = `Phòng ${room.roomId} · ${mapName(room.mapId)} (map ${room.mapId}) · ${room.characters.length} người chơi và bot`;
    const preview = assets.maps?.[room.mapId]?.preview;
    byId('map-preview').hidden = !preview;
    if (preview && byId('map-preview').getAttribute('src') !== preview.url) byId('map-preview').src = preview.url;
  }
  const nextRosterKey = JSON.stringify([room?.characters, p.phase, p.selection?.lockedAccountIds, Object.keys(catalog).length]);
  if (nextRosterKey !== rosterKey) {
    rosterKey = nextRosterKey;
    byId('room-roster').replaceChildren(...(room?.characters || []).map(char => {
      const row = element('tr');
      const status = p.phase === 'selecting'
        ? (p.selection.lockedAccountIds.includes(char.accountId) ? 'Đã chốt tank' : 'Đang chọn tank')
        : p.phase === 'scene' ? 'Trong scene' : p.phase === 'loading' ? 'Đang vào scene'
          : char.ready ? 'Sẵn sàng' : 'Chưa sẵn sàng';
      row.append(element('td', char.camp === 1 ? 'Đội 1' : `Đội ${char.camp}`, `team-label team-${char.camp}`),
        element('td', char.accountId === state.accountId ? `${char.name} (bạn)` : char.name),
        element('td', tankName(char.tankId)), element('td', status));
      return row;
    }));
  }
  const self = room?.characters.find(char => char.accountId === state.accountId);
  byId('room-ready').textContent = self?.ready ? 'Hủy sẵn sàng' : 'Sẵn sàng';
  byId('room-ready').disabled = !free || p.phase !== 'room';
  byId('start-match').disabled = !free || p.phase !== 'room' || !self?.ready;
  byId('confirm-tank').disabled = !free || p.phase !== 'selecting';
  byId('cancel-selection').disabled = !free || p.phase !== 'selecting';
  byId('leave-room').disabled = !free || p.phase === 'lobby';
  byId('leave-room').textContent = ['loading', 'scene'].includes(p.phase) ? 'Rời scene & về sảnh' : 'Rời phòng & về sảnh';
  byId('selection-current').textContent = p.selection ? `Tank cho trận: ${tankName(p.selection.selectedTankId)}. Có thể đổi đến khi server chốt.` : '';
  countdown();
  const scene = p.scene;
  byId('scene-status').textContent = p.phase === 'scene' ? 'Đã nhận scene từ server' : 'Đang nhận scene…';
  byId('scene-summary').textContent = scene ? `Scene ${scene.sceneId} · ${mapName(scene.mapId)} · ${scene.actors.length} tank · ${scene.updateCount} cập nhật trận từ server.` : '';
  const nextSceneKey = JSON.stringify([scene?.spawnActors, Object.keys(catalog).length]);
  if (nextSceneKey !== sceneKey) {
    sceneKey = nextSceneKey;
    byId('scene-actors').replaceChildren(...(scene?.spawnActors || []).map(actor => {
      const row = element('tr');
      row.append(element('td', `Đội ${actor.camp}`, `team-label team-${actor.camp}`),
        element('td', `${tankName(actor.tankId)}${actor.accountId === state.accountId ? ' (bạn)' : ''}`),
        element('td', `${actor.x}, ${actor.y}`), element('td', `${actor.hp}/${actor.maxHp} HP · ${actor.mp}/${actor.maxMp} MP`));
      return row;
    }));
  }
}

function render(state) {
  lastState = state;
  if (outsideUI) { outsideUI.update(state); battleView?.update(state); return; }
  const busy = ['web', 'auth', 'gate', 'sync', 'reconnecting'].includes(state.phase), ready = state.phase === 'ready';
  byId('status-badge').textContent = phaseNames[state.phase] || state.phase;
  byId('status-badge').className = `badge ${ready ? 'ready' : state.phase === 'error' ? 'error' : ''}`;
  byId('status-message').textContent = state.message;
  document.body.dataset.phase = state.phase;
  for (const node of document.querySelectorAll('[data-stage]')) node.classList.toggle('done', state.stages[node.dataset.stage]);
  byId('login').disabled = busy;
  byId('username').disabled = busy;
  byId('password').disabled = busy;
  byId('reconnect').disabled = busy || (!state.stages.web && !['disconnected', 'error'].includes(state.phase));
  byId('disconnect').disabled = !busy && !ready;
  byId('logout').disabled = busy || (!state.stages.web && !['disconnected', 'error'].includes(state.phase));
  byId('character-name').textContent = state.character?.name || '—';
  byId('character-level').textContent = state.character?.level ?? '—';
  byId('tank-count').textContent = state.tanks.length;
  byId('latency').textContent = state.latencyMs == null ? '—' : `${state.latencyMs} ms`;
  byId('packet-summary').textContent = `${state.packetCount} gói · ${(state.bytesReceived / 1024).toFixed(1)} KiB`;
  byId('identity-summary').textContent = state.accountId == null ? 'Chưa có nhân vật được server xác nhận.'
    : `Tài khoản ${state.username} · ID nhân vật ${state.accountId} · ${state.charUuid}`;
  const bags = Object.entries(state.containers).map(([id, bag]) => `${bagNames[id] || `Kho ${id}`}: ${bag.count}`);
  byId('inventory-summary').textContent = bags.length ? `Các kho đã nhận · ${bags.join(' / ')}` : '';
  if (document.querySelector('.diagnostics').open) {
    byId('packet-log').replaceChildren(...state.packets.slice().reverse().map(packet => {
      const row = element('tr');
      for (const value of [packet.role, `S${packet.id}`, packet.type, packet.bytes]) row.append(element('td', value));
      return row;
    }));
  }
  renderPlay(state); renderTanks(state); battleView?.update(state);
}

// Connection and action transitions render immediately. Only an unchanged
// active scene batches frequent packet metadata at most every80ms.
const client = new M8Connection(state => {
  queuedState = state;
  const canBatch = lastState && state.phase === 'ready' && state.play.phase === 'scene'
    && lastState.phase === state.phase && lastState.play.phase === state.play.phase
    && lastState.play.busy === state.play.busy && lastState.play.error === state.play.error
    && lastState.play.scene?.sceneId === state.play.scene?.sceneId;
  if (!canBatch) {
    clearTimeout(renderTimer); renderTimer = null; render(state); return;
  }
  if (renderTimer != null) return;
  renderTimer = setTimeout(() => { renderTimer = null; render(queuedState); }, 80);
}, async(scene, accountId, progress) => {
  const prepared=await battleAssets.prepareScene(scene, accountId, progress);
  return battleView.prepareSceneGraphics(prepared,scene,progress);
});
render(client.snapshot());
const run = async action => {
  const play = client.state.play;
  try { return await action(); }
  catch (error) { if (client.state.play === play) { play.error = error.message; client.update(); } }
};
battleView = new BattleView(client, battleAssets, run);
client.prepareDynamicAssets = packet => battleAssets.preparePacket(packet);
battleView.update(client.snapshot());
outsideUI = new M8UI({host: byId('m8-shell'), client, run, getBattleView: () => battleView});
outsideUI.ready.then(()=>{if(outsideUI.loaded)battleView.postmatch.setUI(outsideUI);});
battleView.onOpenSettings=()=>outsideUI.showSettings();
outsideUI.update(client.snapshot());
byId('login-form').addEventListener('submit', event => {
  event.preventDefault();
  const username = byId('username').value.trim(), password = byId('password').value;
  byId('password').value = ''; run(() => client.login(username, password));
});
byId('reconnect').onclick = () => run(() => client.connect());
byId('disconnect').onclick = () => run(() => client.disconnect());
byId('logout').onclick = () => run(() => client.logout());
byId('tank-search').oninput = () => lastState && renderTanks(lastState);
byId('refresh-hall').onclick = () => run(() => client.refreshHall());
byId('create-room').onclick = () => run(() => client.createRoom());
byId('preset-3v3').onclick = () => run(() => client.saveBotSetup({mode: 'pk_robo',
  allies: [5, 5], enemies: [5, 5, 5],
  bot_guild: !!client.state.play.setup?.bot_guild, bot_crystals: !!client.state.play.setup?.bot_crystals,
  bot_military: !!client.state.play.setup?.bot_military,
  bot_ai: client.state.play.setup?.bot_ai || 'legacy',
  bot_ai_allies: client.state.play.setup?.bot_ai_allies || client.state.play.setup?.bot_ai || 'legacy',
  bot_ai_enemies: client.state.play.setup?.bot_ai_enemies || client.state.play.setup?.bot_ai || 'legacy',
  quanvu_execute_hint: client.state.play.setup?.quanvu_execute_hint || false}));
byId('hall-rooms').onclick = event => {
  const button = event.target.closest('[data-join-room]');
  if (button && !button.disabled) run(() => client.joinRoom(Number(button.dataset.joinRoom)));
};
byId('bot-form').onsubmit = event => {
  event.preventDefault();
  const level = Number(byId('bot-level').value);
  run(() => client.saveBotSetup({mode: byId('bot-mode').value,
    allies: Array(Number(byId('bot-allies').value)).fill(level),
    enemies: Array(Number(byId('bot-enemies').value)).fill(level),
    bot_guild: byId('bot-guild').value === '1', bot_crystals: byId('bot-crystals').value === '1',
    bot_military: byId('bot-military').value === '1',
    bot_ai: byId('bot-ai').value,
    bot_ai_allies: byId('bot-ai').value,bot_ai_enemies:byId('bot-ai-enemies').value,
    quanvu_execute_hint: client.state.play.setup?.quanvu_execute_hint || false}));
};
byId('room-ready').onclick = () => {
  const self = client.state.play.room?.characters.find(char => char.accountId === client.state.accountId);
  run(() => client.setReady(!self?.ready));
};
byId('start-match').onclick = () => run(() => client.startMatch());
byId('tank-list').onclick = event => {
  const button = event.target.closest('[data-select-tank]');
  if (button && !button.disabled) run(() => client.selectTank(Number(button.dataset.selectTank)));
};
byId('confirm-tank').onclick = () => run(() => client.confirmTank());
byId('cancel-selection').onclick = byId('leave-room').onclick = () => run(() => client.leaveRoom());
window.addEventListener('pagehide', () => { client.disconnect(false); });
document.querySelector('.diagnostics').ontoggle = () => lastState && render(lastState);
setInterval(countdown, 250);
const diagnostics = Object.freeze({snapshot: () => client.snapshot()});
Object.defineProperty(window, 'bbM2', {value: diagnostics, writable: false});
Object.defineProperty(window, 'bbM3', {value: diagnostics, writable: false});
const battleDiagnostics = Object.freeze({snapshot: () => ({
  ...client.snapshot(), view: battleView.snapshot(),
})});
Object.defineProperty(window, 'bbM4', {value: battleDiagnostics, writable: false});
Object.defineProperty(window, 'bbM5', {value: battleDiagnostics, writable: false});
Object.defineProperty(window, 'bbM6', {value: battleDiagnostics, writable: false});
Object.defineProperty(window, 'bbM7', {value: battleDiagnostics, writable: false});
Object.defineProperty(window, 'bbM8', {value: Object.freeze({snapshot: () => ({
  ...client.snapshot(), ui: outsideUI.snapshot(), view: battleView.snapshot(),
})}), writable: false});
Promise.all([fetch('./tank_catalog.json', {cache: 'no-store'}), fetch('./m3_asset_catalog.json', {cache: 'no-store'})])
  .then(async responses => {
    if (!responses.every(response => response.ok)) throw new Error('Không tải được danh mục hiển thị.');
    [catalog, assets] = await Promise.all(responses.map(response => response.json()));
    renderingKey = ''; hallKey = ''; if (lastState) render(lastState);
  }).catch(() => {});
client.restore();
