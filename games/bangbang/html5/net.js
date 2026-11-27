import {SixcubeStream} from './sixcube.js';
import {encodeVersion, encodeLogin, encodeBind, encodeEnter, encodeReady,
  encodeSync, encodeTick} from './protocol.js';
import {decodePacket} from './protocol_m8.js';

const PHASE_TIMEOUT = 12000;
const CHAR_PACKETS = [1005, 1503, 1016, 1955, 1050, 1029, 1028, 1047, 1036];
const GARAGE_PACKETS = [1100, 1455, 1454, 1045, 1023, 1150, 1724];
const CONTAINER_IDS = [0, 2, 3, 4, 6, 7, 9, 10];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** A binary stream for one native role. A WebSocket message is not a TCP frame. */
export class NativeChannel {
  constructor(role, onPacket = () => {}, onClosed = () => {}) {
    this.role = role;
    this.onPacket = onPacket;
    this.onClosed = onClosed;
    this.history = [];
    this.sequence = 0;
    this.waiters = new Set();
    this.intentionalClose = false;
    this.lastReceived = performance.now();
  }

  open() {
    return new Promise((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => {
        reject(new Error(`${this.role}: quá thời gian chờ kết nối.`));
        this.close();
      }, PHASE_TIMEOUT);
      const url = new URL('/html5/ws', location.href);
      url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('role', this.role);
      this.socket = new WebSocket(url);
      this.socket.binaryType = 'arraybuffer';
      this.closed = new Promise(done => { this.resolveClosed = done; });
      const parser = new SixcubeStream(frame => {
        const packet = decodePacket(frame);
        packet.sequence = ++this.sequence;
        packet.byteLength = frame.raw.length;
        // Do not expose credentials or raw packet bodies through the UI log.
        this.history.push(packet);
        if (this.history.length > 512) this.history.shift();
        this.lastReceived = performance.now();
        this.onPacket(packet, this.role);
        for (const waiter of [...this.waiters]) waiter.check();
      }, () => {
        ready = true;
        clearTimeout(timer);
        resolve(this);
      });
      this.socket.onmessage = event => {
        if (this.failure) return;
        try {
          if (!(event.data instanceof ArrayBuffer)) throw new Error('Expected binary data');
          parser.push(new Uint8Array(event.data));
        } catch (error) {
          this.failure = new Error(`${this.role}: dữ liệu giao thức không hợp lệ (${error.message}).`);
          this.rejectWaiters(this.failure);
          // Browser WebSocket.close allows 1000 or application codes
          // 3000..4999. 1002 throws instead of closing the faulty stream.
          this.socket.close(4002, 'Invalid protocol data');
        }
      };
      this.socket.onerror = () => {
        if (!ready) reject(new Error(`${this.role}: không mở được kết nối; kiểm tra phiên đăng nhập và server.`));
      };
      this.socket.onclose = event => {
        clearTimeout(timer);
        const error = this.failure || new Error(`${this.role}: kết nối đã đóng (${event.code}).`);
        if (!ready) reject(error);
        this.rejectWaiters(error);
        this.resolveClosed();
        this.onClosed(error, this.intentionalClose, this.role);
      };
    });
  }

  send(frame) {
    if (this.socket?.readyState !== WebSocket.OPEN) throw new Error(`${this.role}: kết nối chưa sẵn sàng.`);
    this.socket.send(frame);
  }

  until(predicate, description, timeout = PHASE_TIMEOUT) {
    return new Promise((resolve, reject) => {
      const waiter = {timer: null, reject, check: () => {
        const result = predicate(this.history);
        if (!result) return;
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        resolve(result);
      }};
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`${this.role}: quá thời gian chờ ${description}.`));
      }, timeout);
      this.waiters.add(waiter);
      waiter.check();
    });
  }

  packet(id) {
    return this.until(history => history.find(packet => packet.msgId === id), `S${id}`);
  }

  packets(ids) {
    return this.until(history => ids.every(id => history.some(packet => packet.msgId === id)) && history,
      ids.map(id => `S${id}`).join(', '));
  }

  rejectWaiters(error) {
    for (const waiter of this.waiters) { clearTimeout(waiter.timer); waiter.reject(error); }
    this.waiters.clear();
  }

  async close() {
    this.intentionalClose = true;
    if (!this.socket || this.socket.readyState === WebSocket.CLOSED) return;
    try { this.socket.close(1000, 'Client closed'); } catch { /* Already closing. */ }
    await Promise.race([this.closed, sleep(1600)]);
    this.rejectWaiters(new Error(`${this.role}: đã ngắt kết nối.`));
  }
}

export async function webRequest(path, payload = {}) {
  const response = await fetch(path, {method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
  if (!response.ok) throw new Error(`HTTP ${response.status}: không gửi được yêu cầu.`);
  return response.json();
}

/** Authenticated lobby transport shared by M2 and the M3 room client. */
export class LobbyConnection {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.generation = 0;
    this.channels = [];
    this.reconnectAttempt = 0;
    this.state = this.emptyState();
  }

  emptyState() {
    return {phase: 'idle', message: 'Đăng nhập để kết nối sảnh.', username: '', accountId: null,
      charUuid: '', character: null, tanks: [], containers: {}, packets: [], packetCount: 0,
      bytesReceived: 0, stages: {web: false, auth: false, gate: false, lobby: false, chat: false},
      latencyMs: null, reconnectAttempt: 0};
  }

  update(values = {}) { Object.assign(this.state, values); this.onChange(this.snapshot()); }

  snapshot() {
    // Explicit fields prevent game/session tokens from becoming diagnostic output.
    const s = this.state;
    return {phase: s.phase, message: s.message, username: s.username, accountId: s.accountId,
      charUuid: s.charUuid, character: s.character ? {accountId: s.character.accountId,
        charUuid: s.character.charUuid, name: s.character.name, level: s.character.level,
        sex: s.character.sex} : null, tanks: s.tanks, containers: s.containers,
      packets: s.packets.slice(-80), packetCount: s.packetCount, bytesReceived: s.bytesReceived,
      stages: {...s.stages}, latencyMs: s.latencyMs, reconnectAttempt: s.reconnectAttempt};
  }

  phase(name, message) { this.update({phase: name, message}); }

  receive(packet, role, generation) {
    if (generation !== this.generation) return;
    const s = this.state;
    s.packetCount += 1;
    s.bytesReceived += packet.byteLength;
    s.packets.push({role, id: packet.msgId, type: packet.type, bytes: packet.byteLength});
    if (s.packets.length > 80) s.packets.shift();
    if (packet.type === 'characterData') s.character = packet;
    if (packet.type === 'garage') s.tanks = packet.tanks;
    if (packet.type === 'container') {
      const key = packet.containerType ?? packet.contType ?? packet.container;
      s.containers[key] = {count: packet.items?.length ?? packet.count ?? 0};
    }
    if (packet.msgId === 1003 && this.pingSentAt) {
      s.latencyMs = Math.round(performance.now() - this.pingSentAt);
      this.pingSentAt = 0;
    }
    this.update();
  }

  async login(username, password) {
    const generation = ++this.generation;
    await this.closeChannels();
    if (generation !== this.generation) return false;
    this.state = this.emptyState();
    this.phase('web', 'Đang xác thực tài khoản…');
    let result;
    try { result = await webRequest('/api/login', {username, password}); }
    catch (error) {
      if (generation === this.generation) this.phase('error', error.message);
      return false;
    }
    if (generation !== this.generation) return false;
    if (!result.success) { this.phase('error', result.message || 'Đăng nhập thất bại.'); return false; }
    // /api/session mints a separate native token. Using the /api/login token in
    // C51 would shorten the row containing the browser cookie to five minutes.
    return this.connect();
  }

  async restore() {
    const generation = this.generation;
    try {
      const session = await webRequest('/api/session');
      if (generation !== this.generation) return false;
      if (session.success) return this.connect(session);
    } catch (error) { if (generation === this.generation) this.phase('error', error.message); }
    return false;
  }

  async connect(credentials = null, automatic = false) {
    const generation = ++this.generation;
    await this.closeChannels();
    if (generation !== this.generation) return false;
    this.state = this.emptyState();
    this.state.reconnectAttempt = this.reconnectAttempt;
    const ensureCurrent = () => { if (generation !== this.generation) throw new Error('Đã hủy lần kết nối cũ.'); };
    const channel = role => {
      const conn = new NativeChannel(role,
        (packet, packetRole) => this.receive(packet, packetRole, generation),
        (error, intentional) => {
          if (!intentional && generation === this.generation && this.state.phase === 'ready') this.recover(error);
        });
      this.channels.push(conn);
      return conn;
    };
    try {
      this.phase('web', automatic ? 'Đang khôi phục phiên…' : 'Đang kiểm tra phiên web…');
      credentials ||= await webRequest('/api/session');
      ensureCurrent();
      if (!credentials.success) throw new Error('Phiên web đã hết hạn. Hãy đăng nhập lại.');
      this.state.username = credentials.username;
      this.state.stages.web = true;
      this.phase('auth', 'Đang kết nối máy chủ đăng nhập…');
      const auth = channel('AUTH');
      await auth.open(); ensureCurrent();
      auth.send(encodeVersion('AUTH'));
      await auth.packet(903); ensureCurrent();
      auth.send(encodeLogin(credentials.username, credentials.loginToken));
      credentials = null;
      const result = await auth.until(history => history.find(p => p.msgId === 901 || p.msgId === 902), 'xác thực AUTH');
      ensureCurrent();
      if (result.msgId === 902) throw new Error(result.message || result.reason || 'Server từ chối token đăng nhập.');
      const serverList = await auth.packet(906); ensureCurrent();
      if (!serverList.servers.length) throw new Error('AUTH chưa trả máy chủ GATE khả dụng.');
      const {sessionKey, accountId} = result;
      if (!Number.isInteger(sessionKey) || !Number.isInteger(accountId)) throw new Error('AUTH trả thông tin phiên không hợp lệ.');
      this.state.accountId = accountId;
      this.state.stages.auth = true;
      await auth.close(); ensureCurrent();
      this.phase('gate', 'Đang kết nối nhân vật…');
      const gate = channel('GATE');
      this.gate = gate;
      await gate.open(); ensureCurrent();
      // C52 without curVersion selects GATE. C54 first would select CHAT.
      gate.send(encodeVersion('GATE'));
      await gate.packet(903); ensureCurrent();
      gate.send(encodeBind(sessionKey, accountId));
      const picked = await gate.packet(1008); ensureCurrent();
      this.state.charUuid = picked.charUuid;
      gate.send(encodeEnter(picked.charUuid, 0));
      await gate.packets(CHAR_PACKETS); ensureCurrent();
      const entered = gate.history.find(p => p.msgId === 1005);
      const basic = gate.history.find(p => p.msgId === 1016);
      if (entered.accountId !== accountId || entered.gameToken !== sessionKey
          || basic.accountId !== accountId || basic.charUuid !== picked.charUuid) {
        throw new Error('Nhân vật nhận được không khớp phiên AUTH/GATE.');
      }
      this.state.stages.gate = true;
      this.phase('sync', 'Đang nhận kho tank và dữ liệu sảnh…');
      gate.send(encodeReady());
      await gate.packets(GARAGE_PACKETS); ensureCurrent();
      if (!CONTAINER_IDS.every(id => gate.history.some(p => p.msgId === 1100 && p.containerType === id))) {
        throw new Error('Server chưa gửi đủ các kho trong batch sảnh.');
      }
      const finalStart = gate.history.length;
      gate.send(encodeSync());
      await gate.until(history => {
        const final = history.slice(finalStart);
        return [1100, 1351, 1350].every(id => final.some(p => p.msgId === id))
          && final.some(p => p.msgId === 1045 && [2, 12, 220].every(id => p.limits.some(limit => limit.limitId === id)));
      }, 'xác nhận đồng bộ cuối');
      ensureCurrent();
      this.state.stages.lobby = true;
      this.reconnectAttempt = 0;
      this.state.reconnectAttempt = 0;
      this.phase('ready', 'Đã vào sảnh trên server hiện hành.');
      this.heartbeat = setInterval(() => {
        if (generation !== this.generation || this.state.phase !== 'ready') return;
        if (performance.now() - gate.lastReceived > 45000) { this.recover(new Error('Mất phản hồi từ server.')); return; }
        try {
          this.pingSentAt = performance.now();
          gate.send(encodeTick());
        }
        catch (error) { this.recover(error); }
      }, 15000);
      this.pingSentAt = performance.now(); gate.send(encodeTick());
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      await this.closeChannels();
      if (generation !== this.generation) return false;
      this.phase('error', error.message);
      return false;
    }
  }

  async recover(error) {
    if (this.state.phase !== 'ready') return;
    this.phase('reconnecting', 'Kết nối bị gián đoạn. Đang thử lại…');
    let generation = ++this.generation;
    await this.closeChannels();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (generation !== this.generation) return;
      this.reconnectAttempt = attempt;
      this.phase('reconnecting', `Đang thử kết nối lại (${attempt}/3)…`);
      await sleep([500, 1200, 2500][attempt - 1]);
      if (generation !== this.generation) return;
      const nextGeneration = this.generation + 1;
      const ok = await this.connect(null, true);
      if (this.generation !== nextGeneration) return;
      generation = nextGeneration;
      if (ok) return;
      if (this.state.message.includes('Phiên web')) return;
    }
    if (generation === this.generation) this.phase('error', `Không thể kết nối lại sau 3 lần: ${error.message}`);
  }

  async closeChannels() {
    clearInterval(this.heartbeat);
    this.heartbeat = null;
    const channels = this.channels;
    this.channels = [];
    this.gate = null;
    Object.assign(this.state.stages, {auth: false, gate: false, lobby: false, chat: false});
    this.state.latencyMs = null;
    await Promise.all(channels.map(channel => channel.close()));
  }

  async disconnect(showMessage = true) {
    const generation = ++this.generation;
    await this.closeChannels();
    if (generation !== this.generation) return;
    if (showMessage) {
      this.state.stages = {web: this.state.stages.web, auth: false, gate: false, lobby: false, chat: false};
      this.phase('disconnected', 'Đã ngắt kết nối. Bấm Kết nối lại để kiểm tra và mở lại phiên.');
    }
  }

  async logout() {
    const generation = ++this.generation;
    await this.closeChannels();
    if (generation !== this.generation) return;
    await webRequest('/api/logout');
    if (generation !== this.generation) return;
    this.state = this.emptyState();
    this.update({message: 'Đã đăng xuất.'});
  }
}
