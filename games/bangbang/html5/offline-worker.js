import { loadPyodide } from './pyodide/pyodide.mjs';

const buffers = {
  AUTH: makeBuffer(),
  GATE: makeBuffer(),
};
function makeBuffer() {
  const sab = new SharedArrayBuffer(2 * 1024 * 1024);
  return { sab, header: new Int32Array(sab, 0, 4), data: new Uint8Array(sab, 16) };
}

const DB_NAME = 'bangbang-offline';
const DB_STORE = 'files';
let py;
let profile = {};

function waitIn(role, timeout) {
  const b = buffers[role] || buffers.GATE;
  const start = Date.now();
  let seq = Atomics.load(b.header, 1);
  for (;;) {
    if (Atomics.load(b.header, 2) === 1) {
      Atomics.store(b.header, 2, 0);
      return py.toPy([]);
    }
    const len = Atomics.load(b.header, 0);
    if (len > 0) {
      const data = Array.from(b.data.slice(0, len));
      Atomics.store(b.header, 0, 0);
      return py.toPy(data);
    }
    const remaining = timeout * 1000 - (Date.now() - start);
    if (remaining <= 0) return py.None;
    Atomics.wait(b.header, 1, seq, remaining);
    seq = Atomics.load(b.header, 1);
  }
}
function pushOut(role, data) {
  const bytes = data && data.toJs ? data.toJs() : data;
  self.postMessage({ role: String(role), out: Array.from(bytes) });
}

function idbOpen() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const request = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, 'readwrite');
    transaction.objectStore(DB_STORE).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
async function persistDb() {
  const path = py.globals.get('db_backup')();
  const bytes = py.FS.readFile(String(path));
  await idbSet('db', bytes);
}

(async () => {
  py = await loadPyodide({ indexURL: './pyodide/' });
  py.FS.mkdirTree('/bang');
  const zip = new Uint8Array(await (await fetch('./bangbang-py.zip')).arrayBuffer());
  py.FS.writeFile('/tmp/bang.zip', zip);
  py.runPython("import zipfile; zipfile.ZipFile('/tmp/bang.zip').extractall('/bang')");
  const saved = await idbGet('db');
  if (saved) py.FS.writeFile('/bang/data/bangbang.sqlite3', saved instanceof Uint8Array ? saved : new Uint8Array(saved));
  py.globals.set('wait_in', (role, timeout) => waitIn(String(role), timeout));
  py.globals.set('push_out', (role, data) => pushOut(String(role), data));
  self.postMessage({ buffers: { AUTH: buffers.AUTH.sab, GATE: buffers.GATE.sab } });
  await py.runPythonAsync(`
import sys, os, socket, select, traceback, json
sys.path.insert(0, '/bang/server')
os.environ['BB_DATABASE'] = '/bang/data/bangbang.sqlite3'
os.environ['BB_ACCELERATION'] = 'python'
import sixcube_server, characters, guilds, offline_mail, world_boss_store, ranked_matches, storage
select.select = lambda r, w, x, t: ([], [], [])
import offline_mail as _om
_om._start_maintenance = lambda: None
characters.initialize()
guilds.initialize()
offline_mail.initialize()
world_boss_store.initialize()
ranked_matches.initialize()
sixcube_server.GATE_TEMPLATES = sixcube_server.load_templates()
sixcube_server.load_tank_database()
class FakeSocket:
    def __init__(self, role): self.role = role; self.timeout = 0.5
    def settimeout(self, t): self.timeout = t
    def setsockopt(self, *a): pass
    def recv(self, n):
        data = wait_in(self.role, self.timeout)
        if data is None: raise socket.timeout()
        return bytes(data)
    def sendall(self, data): push_out(self.role, data)
    def shutdown(self, *a): pass
    def close(self): pass
def serve(role):
    try:
        sixcube_server._client_handler(FakeSocket(role), (role, 0))
    except BaseException:
        push_out(role, b'TRACE:' + traceback.format_exc().encode('utf-8'))
def serve_all():
    serve('AUTH')
    push_out('AUTH', b'AUTH_DONE')
    serve('GATE')
    push_out('GATE', b'GATE_DONE')
def profile_json():
    try:
        from characters import for_username
        from storage import for_profile, load_world
        ident = for_username('offline')
        with for_profile(ident):
            state, _ = load_world()
        return json.dumps({'name': state.get('name', ''), 'body': state.get('body', '')}, ensure_ascii=False)
    except Exception:
        return '{}'
def create_profile(name, body):
    from auth_store import Store
    from characters import for_username
    from storage import for_profile, connection, load_world, save_world
    login = Store().login('offline', 'offline123')
    ident = for_username('offline')
    with for_profile(ident), connection() as db:
        state, arena = load_world()
        state['name'] = (str(name).strip() or 'Người chơi')[:32]
        state['body'] = str(body)[:80]
        from storage import garage
        tanks = garage()
        preferred = next((t for t in tanks if int(t['tank_id']) == 10000044), None) or (tanks[0] if tanks else None)
        if preferred:
            state['tank_id'] = int(preferred['tank_id'])
            state['selected_tank_uuid'] = preferred['uuid']
            state['match_tank_uuid'] = preferred['uuid']
        save_world(state, arena, db=db)
    return login['loginToken']
def db_backup():
    import os
    target = '/tmp/bang-save.sqlite3'
    try: os.remove(target)
    except FileNotFoundError: pass
    storage.backup(target)
    return target
`);
  profile = JSON.parse(py.globals.get('profile_json')());
  self.postMessage({ ready: true, profile });
  self.onmessage = async (event) => {
    if (!event.data || event.data.type !== 'create') return;
    try {
      const token = py.globals.get('create_profile')(String(event.data.name || ''), String(event.data.body || ''));
      await persistDb();
      self.postMessage({ token: String(token) });
      py.runPython('serve_all()');
    } catch (error) {
      self.postMessage({ fatal: String(error && error.stack || error) });
    }
  };
})().catch((error) => {
  self.postMessage({ fatal: String(error && error.stack || error) });
});
