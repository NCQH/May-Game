(() => {
  const tokenReady = new Promise((resolve) => { window.__bbOfflineResolve = resolve; });
  const profileReady = new Promise((resolve) => { window.__bbOfflineProfileResolve = resolve; });
  let token = null;
  let profile = {};
  const buffers = {};
  const sockets = { AUTH: null, GATE: null };
  const pending = { AUTH: [], GATE: [] };
  const inputQueue = { AUTH: [], GATE: [] };
  // JavaScript engine is the default; ?engine=py (or bb-engine=py) opts into Pyodide.
  const engine = (() => {
    const query = () => new URLSearchParams(location.search).get('engine');
    try { return (query() || localStorage.getItem('bb-engine')) === 'py' ? 'py' : 'js'; }
    catch { return query() === 'py' ? 'py' : 'js'; }
  })();
  window.__bbEngine = engine;
  const workerUrl = engine === 'py' ? './offline-worker.js' : './static-server/worker.js';
  let worker = null;
  const outbox = [];
  const post = (message) => { if (worker) worker.postMessage(message); else outbox.push(message); };
  const json = (value) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  const realFetch = window.fetch.bind(window);
  const CATALOG_PARTS = {
  "m6_asset_catalog.json": 3,
  "m81314_assets_catalog.json": 4
};

  function writeFrame(role, bytes) {
    const b = buffers[role];
    if (!b) { inputQueue[role].push(bytes); return; }
    const flush = () => {
      if (Atomics.load(b.header, 0) > 0) { setTimeout(flush, 1); return; }
      b.data.set(bytes);
      Atomics.store(b.header, 0, bytes.length);
      Atomics.add(b.header, 1, 1);
      Atomics.notify(b.header, 1);
    };
    flush();
  }
  function closeFrame(role) {
    const b = buffers[role];
    if (!b) return;
    Atomics.store(b.header, 2, 1);
    Atomics.add(b.header, 1, 1);
    Atomics.notify(b.header, 1);
  }
  function deliver(role, bytes) {
    const socket = sockets[role];
    if (!socket) { pending[role].push(bytes); return; }
    socket.__deliver(bytes);
  }
  // M6: import the old Pyodide SQLite save before the worker reads pve-profile/
  // pve-bag. sql.js is a UMD script, so it must load as a classic script and only
  // when a legacy DB actually exists (fresh installs skip the 672 KiB wasm).
  function loadLegacySqlJs() {
    const vendor = new URL('./static-server/migrate/vendor/', document.baseURI);
    const init = () => globalThis.initSqlJs({
      locateFile: (file) => new URL(file, vendor).href,
    });
    if (typeof globalThis.initSqlJs === 'function') return init();
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('sql-wasm.js', vendor).href;
      script.onload = () => typeof globalThis.initSqlJs === 'function'
        ? init().then(resolve, reject)
        : reject(new Error('sql.js unavailable'));
      script.onerror = () => reject(new Error('sql.js failed to load'));
      document.head.appendChild(script);
    });
  }
  let migration = null;
  function migrateLegacySave() {
    if (!migration) {
      migration = import('./static-server/migrate/migrate-save.js')
        .then((mod) => mod.migrateSaveFromIndexedDb({ initSqlJs: loadLegacySqlJs }))
        .then((result) => { window.__bbMigration = result; return result; })
        .catch((error) => { window.__bbMigration = { migrated: false, error: String(error) }; console.warn('Legacy save migration skipped:', error); return null; });
    }
    return migration;
  }
  let starting = null;
  function start() {
    if (worker) return worker;
    if (starting) return starting;
    starting = migrateLegacySave().then(() => {
    if (worker) return worker;
    // Read the profile after migration so a restored legacy character is used.
    try { post({ type: 'init', profile: { name: localStorage.getItem('bb-character-name') || '', body: localStorage.getItem('bb-character-body') || '' } }); } catch {}
    worker = new Worker(workerUrl, { type: 'module' });
    try { if (new URLSearchParams(location.search).get('debug') === '1') window.__bbWorker = worker; } catch {}
    worker.onmessage = (event) => {
      const data = event.data || {};
      if (data.buffers) {
        for (const role of Object.keys(data.buffers)) {
          const sab = data.buffers[role];
          buffers[role] = { header: new Int32Array(sab, 0, 4), data: new Uint8Array(sab, 16) };
        }
        for (const role of Object.keys(inputQueue)) { const q = inputQueue[role].splice(0); for (const bytes of q) writeFrame(role, bytes); }
        return;
      }
      if (data.fatal) { console.error('Offline worker:', data.fatal); return; }
      if (data.ready) { profile = data.profile || {}; window.__bbOfflineProfileResolve(profile); return; }
      if (data.token) { token = String(data.token); window.__bbOfflineResolve(token); return; }
      if (data.role && data.out) {
        const bytes = Uint8Array.from(data.out);
        if (new TextDecoder().decode(bytes.slice(0,6)) === 'TRACE:') console.log('TRACE', new TextDecoder().decode(bytes).slice(0,1000));
        const text = new TextDecoder().decode(bytes);
        if (text.startsWith('TOKEN:')) {
          token = text.slice(6).trim();
          window.__bbOfflineResolve(token);
          return;
        }
        deliver(data.role, bytes);
      }
    };
    worker.onerror = (event) => console.error('Offline worker error:', event.error?.stack || event.message || event);
    for (const message of outbox.splice(0)) worker.postMessage(message);
    return worker;
    });
    return starting;
  }

  window.__bbOffline = {
    ready: profileReady,
    start,
    create(name, body) {
      start();
      // The Pyodide worker installs onmessage only after Python is ready; send
      // create after ready so the message is not dropped.
      profileReady.then(() => post({ type: 'create', name, body }));
      return tokenReady;
    },
    get profile() { return profile; },
  };
  // Compatibility: an older cached index.html waits for ready before painting.
  setTimeout(start, 8000);

  class WorkerSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) {
      this.url = String(url);
      this.readyState = WorkerSocket.CONNECTING;
      this.binaryType = 'arraybuffer';
      this.bufferedAmount = 0;
      this.protocol = '';
      this.extensions = '';
      this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
      this._queue = [];
      const parsed = new URL(this.url, location.href);
      this.role = (parsed.searchParams.get('role') || 'GATE').toUpperCase();
      if (this.role === 'CHAT') {
        this.readyState = WorkerSocket.OPEN;
        setTimeout(() => {
          const frame = new Uint8Array(18);
          const view = new DataView(frame.buffer);
          view.setUint16(0, 18, true); view.setUint16(2, 0x0DAC, true); frame[8] = 1;
          const out = new Uint8Array(20); out.set([0, 0], 0); out.set(frame, 2);
          this.__deliver(out);
        }, 0);
        return;
      }
      sockets[this.role] = this;
      this.readyState = WorkerSocket.OPEN;
      setTimeout(() => {
        if (this._queue.length) { for (const bytes of this._queue) this.__deliver(bytes); this._queue = []; }
        if (pending[this.role].length) { for (const bytes of pending[this.role]) this.__deliver(bytes); pending[this.role] = []; }
      }, 0);
    }
    __deliver(bytes) {
      if (this.readyState !== WorkerSocket.OPEN && this.readyState !== WorkerSocket.CLOSING) { this._queue.push(bytes); return; }
      const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const event = new MessageEvent('message', { data });
      if (typeof this.onmessage === 'function') this.onmessage(event);
      this.dispatchEvent?.(event);
    }
    send(data) {
      if (this.role === 'CHAT') return;
      let bytes;
      if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
      else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      else bytes = new Uint8Array(data);
      writeFrame(this.role, bytes);
    }
    close(code = 1000, reason = '') {
      if (this.readyState >= WorkerSocket.CLOSING) return;
      this.readyState = WorkerSocket.CLOSING;
      if (this.role !== 'CHAT') closeFrame(this.role);
      setTimeout(() => {
        this.readyState = WorkerSocket.CLOSED;
        const event = new CloseEvent('close', { code, reason, wasClean: true });
        if (typeof this.onclose === 'function') this.onclose(event);
        this.dispatchEvent?.(event);
      }, 0);
    }
    addEventListener(type, listener) { this[`on${type}`] = listener; }
    removeEventListener(type) { this[`on${type}`] = null; }
  }
  window.WebSocket = WorkerSocket;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const resolved = new URL(url, location.href);
    const path = resolved.pathname;
    const name = path.split('/').pop();
    if (Object.prototype.hasOwnProperty.call(CATALOG_PARTS, name)) {
      const dir = path.slice(0, path.lastIndexOf('/') + 1);
      const pieces = await Promise.all(Array.from({ length: CATALOG_PARTS[name] }, (_, index) => realFetch(dir + name + '.part' + index + '.json').then((response) => {
        if (!response.ok) throw new Error('Không tải được phần danh mục ' + name + '.' + index);
        return response.arrayBuffer();
      })));
      const total = pieces.reduce((sum, piece) => sum + piece.byteLength, 0);
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const piece of pieces) { bytes.set(new Uint8Array(piece), offset); offset += piece.byteLength; }
      return new Response(bytes, { headers: { 'Content-Type': 'application/json' } });
    }
    if (path.endsWith('/api/login') || path.endsWith('/api/session')) {
      await tokenReady;
      return json({ success: true, username: 'offline', loginToken: token });
    }
    if (path.endsWith('/api/logout')) return json({ success: true });
    if (path.endsWith('/api/bots/get')) {
      return json({ success: true, setup: { mode: 'pk_robo', allies: [5, 5], enemies: [5, 5, 5], bot_ai: 'legacy', bot_ai_allies: 'legacy', bot_ai_enemies: 'legacy' }, tanks: [] });
    }
    if (path.endsWith('/api/bots/save')) {
      let body = {};
      try { body = JSON.parse(init && init.body || '{}'); } catch {}
      return json({ success: true, setup: body, tanks: [] });
    }
    return realFetch(input, init);
  };
})();
