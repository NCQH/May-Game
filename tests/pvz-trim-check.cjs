const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'may-game-trim-'));

try {
  const data = path.join(dir, 'games/pvz-goty/data');
  for (const sub of ['properties', 'hd/images', 'wide/images', 'wide/reanim']) fs.mkdirSync(path.join(data, sub), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(data, 'main.pak'), Buffer.alloc(21 * 1024 * 1024, 1));
  fs.writeFileSync(path.join(data, 'properties/partner.xml'), '<xml/>');
  fs.writeFileSync(path.join(data, 'hd/images/a.png'), 'hd');
  fs.writeFileSync(path.join(data, 'wide/images/titlescreen.png'), 'card');
  fs.writeFileSync(path.join(data, 'wide/reanim/bg.png'), 'wide');
  const manifestPath = path.join(dir, 'games/pvz-goty/resources.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    version: 1,
    revision: 'before',
    files: [
      { name: 'main.pak' },
      { name: 'properties/partner.xml' },
      { name: 'hd/images/a.png' },
      { name: 'wide/images/titlescreen.png' },
      { name: 'wide/reanim/bg.png' },
    ],
  }));

  execFileSync(process.execPath, ['scripts/pvz/trim-pvz.cjs', dir], { cwd: root, stdio: 'pipe' });

  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files.map((entry) => entry.name).sort(), [
    'main.pak',
    'properties/partner.xml',
  ]);
  assert.equal(fs.existsSync(path.join(data, 'hd/images/a.png')), false);
  assert.equal(fs.existsSync(path.join(data, 'wide/reanim/bg.png')), false);
  assert.equal(fs.existsSync(path.join(data, 'wide/images/titlescreen.png')), true);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.match(manifest.revision, /^[a-f0-9]{64}$/);
  assert.notEqual(manifest.revision, 'before');

  execFileSync(process.execPath, ['scripts/pvz/trim-pvz.cjs', dir], { cwd: root, stdio: 'pipe' });
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files.map((entry) => entry.name).sort(), [
    'main.pak',
    'properties/partner.xml',
  ]);

  execFileSync(process.execPath, ['scripts/pvz/chunk-main-pak.cjs', dir], { cwd: root, stdio: 'pipe' });
  execFileSync(process.execPath, ['scripts/pvz/trim-pvz.cjs', dir], { cwd: root, stdio: 'pipe' });
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).files.map((entry) => entry.name).sort(), [
    'properties/partner.xml',
  ]);

  console.log('PvZ trim checks passed: hd/wide removed, catalog image kept, idempotent with chunking.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
