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
  const loader = quality.slice(quality.indexOf('async function loadHostedResources()'), quality.indexOf('\n\ntry {', quality.indexOf('async function loadHostedResources()'))).replaceAll('import.meta.url', '"https://example.test/games/pvz-goty/quality.js"');
  const requests = [];
  const resources = vm.createContext({
    URL, AbortController, Map, Set, Blob, hasPak: true, hasProperties: true,
    resourceRevision: 'old', collectedFiles: new Map(), bootStatus: {}, normalizeResourcePath: (name) => name,
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
  assert.equal(requests.length, 3);
  assert.ok(requests.every(([, cache]) => cache === 'no-cache'), 'Manifest and assets must be revalidated');
  const bootstrap = quality.slice(quality.lastIndexOf('\ntry {'));
  for (const cached of [false, true]) {
    let started = false;
    const boot = vm.createContext({
      hasPak: cached, hasProperties: cached, gameStarted: false,
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
