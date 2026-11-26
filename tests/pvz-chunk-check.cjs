const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'may-game-chunk-'));

try {
  const data = path.join(dir, 'games/pvz-goty/data');
  fs.mkdirSync(path.join(data, 'properties'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
  fs.writeFileSync(path.join(data, 'properties/partner.xml'), '<xml/>');
  const original = Buffer.alloc(21 * 1024 * 1024 + 123, 7);
  fs.writeFileSync(path.join(data, 'main.pak'), original);
  fs.writeFileSync(path.join(dir, 'games/pvz-goty/resources.json'), JSON.stringify({
    version: 1,
    revision: 'before',
    files: [{ name: 'main.pak' }, { name: 'properties/partner.xml' }],
  }));

  execFileSync(process.execPath, ['scripts/pvz/chunk-main-pak.cjs', dir], { cwd: root, stdio: 'pipe' });

  assert.equal(fs.existsSync(path.join(data, 'main.pak')), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'games/pvz-goty/resources.json'), 'utf8'));
  assert.equal(manifest.mainPak.size, original.length);
  assert.equal(manifest.mainPak.parts.length, 2);
  assert.equal(manifest.files.some((entry) => entry.name === 'main.pak'), false);
  assert.match(manifest.revision, /^[a-f0-9]{64}$/);

  const joined = Buffer.concat(manifest.mainPak.parts.map((part) => fs.readFileSync(path.join(data, part.name))));
  assert.equal(joined.length, original.length);
  assert.equal(joined.equals(original), true);
  for (const part of manifest.mainPak.parts) assert.ok(part.size <= 20 * 1024 * 1024);

  execFileSync(process.execPath, ['scripts/pvz/chunk-main-pak.cjs', dir], { cwd: root, stdio: 'pipe' });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'games/pvz-goty/resources.json'), 'utf8')).mainPak.parts.length, 2);

  console.log('PvZ chunk checks passed: split, size, byte equality and idempotence.');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
