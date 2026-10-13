const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'games/pvz-goty/index.html'), 'utf8');
const inline = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(Boolean);
for (const script of inline) new vm.Script(script);
function extract(name) {
  const start = html.indexOf(`function ${name}(`);
  const end = html.indexOf('\n}\n', start) + 2;
  assert.ok(start >= 0 && end > start);
  return html.slice(start, end);
}
const context = vm.createContext({});
vm.runInContext(['safeImportParts', 'normalizeResourcePath', 'normalizeSaveImportPath'].map(extract).join('\n'), context);
const resourceCases = [
  ['main.pak', 'main.pak'], ['GOTY/main.pak', 'main.pak'],
  ['GOTY/properties/partner.xml', 'properties/partner.xml'],
  ['GOTY/properties/partner.xml.sig2', 'properties/partner.xml.sig2'],
  ['HD/reanim/Peashooter.png', 'hd/reanim/peashooter.png'],
  ['wide/images/background1.png', 'wide/images/background1.png'],
  ['wide/reanim/SelectorScreen_BG_Left.png', 'wide/reanim/selectorscreen_bg_left.png'],
  ['wide/images/../../bad.png', ''], ['wide/images/background1.exe', ''],
  ['wide/fonts/font.png', ''], ['wide/images/nested/file.png', ''],
  ['GOTY/PlantsVsZombies.exe', ''], ['backup/main.pak/../../bad.exe', ''],
  ['/main.pak', ''], ['C:\\main.pak', ''], ['properties/xexe', ''],
  ['properties/../evil.xml', ''], ['properties/a\u0000.xml', ''],
];
for (const [input, expected] of resourceCases) assert.equal(context.normalizeResourcePath(input), expected, input);
assert.equal(context.normalizeSaveImportPath('userdata/user1.dat'), 'user1.dat');
assert.equal(context.normalizeSaveImportPath('userdata/../../x.dat'), '');
assert.equal(context.normalizeSaveImportPath('userdata/test.exe'), '');
assert.ok(!html.includes("console.warn('IDBFS initial sync error:'"), 'Restore errors must stop startup');
assert.ok(html.includes("Module.callMain(['-resdir', '/', '-savedir', '/may-game-pvz-goty-saves'])"));
async function checkPersistence() {
  const callbacks = [];
  const saves = vm.createContext({
    canSyncSaves: () => true, saveSyncInFlight: null, saveSyncQueued: false, lastSaveSyncAt: 0,
    Module: { FS: { syncfs: (_, callback) => callbacks.push(callback) } },
  });
  vm.runInContext('async ' + extract('syncSaves'), saves);
  const first = saves.syncSaves();
  let exitFinished = false;
  const exit = saves.syncSaves().then(() => { exitFinished = true; });
  callbacks.shift()();
  await new Promise(setImmediate);
  assert.equal(exitFinished, false, 'Exit must wait for the queued final flush');
  assert.equal(callbacks.length, 1);
  callbacks.shift()();
  await Promise.all([first, exit]);
  assert.equal(saves.saveSyncInFlight, null);
  const failed = saves.syncSaves();
  callbacks.shift()(new Error('Quota exceeded'));
  await assert.rejects(failed, /Quota exceeded/);
  const retry = saves.syncSaves();
  callbacks.shift()();
  await retry;

  let downloaded = false;
  const exported = [];
  const button = {};
  const backup = vm.createContext({
    document: { getElementById: () => button, createElement: () => ({ click: () => { downloaded = true; } }) },
    ensureSaveFsReady: async () => {}, syncSaves: async () => { throw new Error('Quota exceeded'); },
    collectSaveFiles: () => ['/may-game-pvz-goty-saves/userdata/user1.dat'],
    Module: { FS: { readFile: () => Buffer.from('latest progress') } },
    JSZip: class { file(name, bytes) { exported.push([name, bytes.toString()]); } async generateAsync() { return {}; } },
    URL: { createObjectURL: () => 'blob:backup', revokeObjectURL() {} },
    console: { warn() {}, error() {} }, alert: (message) => assert.fail(message),
  });
  vm.runInContext('async ' + extract('exportSaves'), backup);
  await backup.exportSaves();
  assert.equal(downloaded, true, 'Export must work when persistence fails');
  assert.deepEqual(exported, [['userdata/user1.dat', 'latest progress']]);
  assert.equal(button.disabled, false);

  const quality = fs.readFileSync(path.join(root, 'games/pvz-goty/quality.js'), 'utf8');
  const storage = await import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(root, 'games/pvz-goty/storage.js'))).toString('base64'));
  const bundle = files => ({ version: 1, files: files.map(([name, text]) => ({ name, blob: new Blob([text]) })) });
  for (const files of [[], [['../bad.dat', 'x']], [['bad.exe', 'x']], [['user.dat', 'x'], ['USER.dat', 'y']], [['user.dat', 'x'], ['user.dat/sub.dat', 'y']]]) {
    assert.throws(() => storage.validateSaveImport(bundle(files)));
  }
  assert.throws(() => storage.validateSaveImport({ version: 1, files: Array.from({ length: 1001 }, (_, i) => ({ name: `${i}.dat`, blob: new Blob() })) }));
  assert.throws(() => storage.validateSaveImport(bundle([['big.dat', Buffer.alloc(64 * 1048576 + 1)]])), /64 MiB/);
  const saveRoot = '/may-game-pvz-goty-saves/userdata/';
  const pending = bundle([['user1.dat', 'imported'], ['nested/new.dat', 'new']]);
  storage.validateSaveImport(pending);
  const apply = quality.slice(quality.indexOf('window.applyPendingSaveImport ='), quality.indexOf('\n\ntry {\n  const cached'));
  for (const failure of ['none', 'write', 'sync', 'delete', 'conflict']) {
    const files = new Map([[saveRoot + 'user1.dat', Buffer.from('original')], [saveRoot + 'other.dat', Buffer.from('untouched')]]);
    const directories = new Set(['/may-game-pvz-goty-saves', saveRoot.slice(0, -1)]);
    if (failure === 'conflict') files.set(saveRoot + 'nested', Buffer.from('not a directory'));
    let syncs = 0, removed = false;
    const context = vm.createContext({
      window: { syncSaves: async () => { if (++syncs === 1 && failure === 'sync') throw new Error('quota'); } },
      readBundle: async () => pending, validateSaveImport: storage.validateSaveImport,
      writeBundle: async () => { if (failure === 'delete') throw new Error('delete failed'); removed = true; },
      Uint8Array,
      Module: { FS: {
        analyzePath: name => ({ exists: files.has(name) || directories.has(name) }),
        stat: name => ({ mode: directories.has(name) ? 'dir' : 'file' }), isDir: mode => mode === 'dir',
        mkdir: name => directories.add(name), readFile: name => files.get(name), unlink: name => files.delete(name),
        writeFile: (name, data) => { if (failure === 'write' && name.endsWith('/new.dat')) throw new Error('write failed'); files.set(name, Buffer.from(data)); },
      } },
    });
    vm.runInContext(apply, context);
    if (failure === 'none') {
      await context.window.applyPendingSaveImport();
      assert.equal(files.get(saveRoot + 'user1.dat').toString(), 'imported');
      assert.equal(files.get(saveRoot + 'nested/new.dat').toString(), 'new');
      assert.equal(removed, true);
    } else {
      await assert.rejects(context.window.applyPendingSaveImport());
      assert.equal(removed, false);
      assert.equal(files.get(saveRoot + 'user1.dat').toString(), failure === 'delete' ? 'imported' : 'original');
      if (failure !== 'delete') assert.equal(files.has(saveRoot + 'nested/new.dat'), false);
    }
    assert.equal(files.get(saveRoot + 'other.dat').toString(), 'untouched');
  }
  assert.ok(!html.includes('upload-save-actions') && !html.includes('function clearSaves('));
  assert.ok(html.indexOf('await window.applyPendingSaveImport?.()') < html.indexOf("Module.callMain(['-resdir'"));
  const loader = quality.slice(quality.indexOf('async function loadHostedResources()'), quality.indexOf('\n\ntry {', quality.indexOf('async function loadHostedResources()'))).replaceAll('import.meta.url', '"https://example.test/games/pvz-goty/quality.js"');
  const requests = [];
  const resources = vm.createContext({
    URL, AbortController, Map, Set, Blob, hasPak: true, hasProperties: true,
    resourceRevision: 'old', collectedFiles: new Map(), bootMessage: {}, bootProgress: {}, normalizeResourcePath: (name) => name,
    window: { refreshUI() {} },
    fetch: async (url, options) => {
      requests.push([url.pathname, options.cache]);
      return url.pathname.endsWith('resources.json')
        ? { ok: true, json: async () => ({ version: 1, revision: 'new', files: [{ name: 'main.pak' }, { name: 'properties/partner.xml' }] }) }
        : { ok: true, headers: { get: () => null }, blob: async () => new Blob(['new bytes']) };
    },
  });
  vm.runInContext(loader, resources);
  await resources.loadHostedResources();
  assert.equal(resources.resourceRevision, 'new');
  assert.equal(resources.bootProgress.max, 2);
  assert.equal(resources.bootProgress.value, 2);
  assert.match(resources.bootMessage.textContent, /2\/2 tệp hoàn tất/);
  assert.equal(requests.length, 3);
  assert.ok(requests.every(([, cache]) => cache === 'no-cache'), 'Manifest and assets must be revalidated');
  const bootstrap = quality.slice(quality.lastIndexOf('\ntry {'));
  for (const cached of [false, true]) {
    let started = false;
    const boot = vm.createContext({
      hasPak: cached, hasProperties: cached, gameStarted: false,
      bootMessage: {}, bootProgress: { removeAttribute() {}, setAttribute() {} },
      bootStatus: { remove() {}, append(button) { this.retry = button; } }, loadStatus: { textContent: 'Engine failed' },
      document: { createElement: () => ({ style: {}, addEventListener() {} }) },
      cacheMessage() {}, console: { warn() {} },
      loadHostedResources: async () => { throw new Error('Download failed'); },
      window: { startGame: async () => { started = true; boot.gameStarted = true; } },
    });
    await vm.runInContext('(async () => {' + bootstrap + '})()', boot);
    assert.equal(started, cached, 'Only a complete remembered bundle can survive a failed update');
    if (!cached) assert.equal(boot.bootStatus.textContent, 'Download failed');
  }
  const oldFiles = new Map([['main.pak', new Blob(['old'])], ['properties/partner.xml', new Blob(['old'])]]);
  resources.collectedFiles = oldFiles;
  resources.resourceRevision = 'old';
  resources.fetch = async (url) => url.pathname.endsWith('resources.json')
    ? { ok: true, json: async () => ({ version: 1, revision: 'new', files: [{ name: 'main.pak' }, { name: 'properties/partner.xml' }] }) }
    : { ok: false };
  await assert.rejects(resources.loadHostedResources(), /Không tải được/);
  assert.equal(resources.collectedFiles, oldFiles);
  assert.equal(resources.resourceRevision, 'old');
  let rejected;
  const engine = vm.createContext({ window: { _rejectModuleReady: (error) => { rejected = error; } } });
  vm.runInContext(html.match(/src="\.\/engine\/pvz-portable.js" onerror="([^"]+)"/)[1], engine);
  assert.match(rejected.message, /Không tải được engine/);
  const { execFileSync } = require('node:child_process');
  const fixture = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'may-game-pages-'));
  try {
    const run = (command, args) => execFileSync(command, args, { cwd: fixture });
    run('git', ['init', '-q']);
    fs.mkdirSync(path.join(fixture, 'games/pvz-goty'), { recursive: true });
    fs.writeFileSync(path.join(fixture, 'games/pvz-goty/index.html'), 'current page');
    run('git', ['add', '.']);
    run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']);
    for (const name of ['engine', 'vendor']) {
      fs.mkdirSync(path.join(fixture, '.engine-artifact/games/pvz-goty', name), { recursive: true });
      fs.writeFileSync(path.join(fixture, '.engine-artifact/games/pvz-goty', name, 'retained.txt'), name);
    }
    fs.writeFileSync(path.join(fixture, '.engine-artifact/obsolete.html'), 'deleted page');
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/pages-web-update.yml'), 'utf8');
    const commands = workflow.match(/- name: Assemble current web files with the built engine\n\s+run: \|\n([\s\S]*?)\s+touch \.site\/\.nojekyll/)[1];
    run('bash', ['-e', '-c', commands]);
    assert.equal(fs.existsSync(path.join(fixture, '.site/obsolete.html')), false);
    assert.equal(fs.readFileSync(path.join(fixture, '.site/games/pvz-goty/index.html'), 'utf8'), 'current page');
    for (const name of ['engine', 'vendor']) assert.ok(fs.existsSync(path.join(fixture, '.site/games/pvz-goty', name, 'retained.txt')));
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
  console.log(`PASS: inline syntax, ${resourceCases.length} resource paths, save paths, queued flush, recovery export, resource revalidation and clean Pages assembly.`);
}
checkPersistence().catch((error) => { console.error(error); process.exitCode = 1; });
