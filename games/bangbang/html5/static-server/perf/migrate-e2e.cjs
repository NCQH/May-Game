#!/usr/bin/env node
// Browser E2E for the legacy SQLite -> JS save migration.
// Seeds IndexedDB with the real fixture DB from bangbang-py.zip, boots the
// default JS engine, then checks the migrated profile/bag and idempotent reload.
// Usage: node games/bangbang/html5/static-server/perf/migrate-e2e.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { inflateRawSync } = require('node:zlib');
const { chromium } = require('@playwright/test');
const { createServer } = require('./serve.cjs');

const ZIP = path.resolve(__dirname, '../../bangbang-py.zip');
const FIXTURE = 'data/bangbang.sqlite3';

function zipEntry(zip, wanted) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip end-of-central-directory not found');
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('bad zip central header');
    const method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (name === wanted) {
      const local = zip.readUInt32LE(offset + 42);
      const localName = zip.readUInt16LE(local + 26);
      const localExtra = zip.readUInt16LE(local + 28);
      const start = local + 30 + localName + localExtra;
      const raw = zip.subarray(start, start + compressed);
      return method === 0 ? raw : inflateRawSync(raw);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`zip entry not found: ${wanted}`);
}

const readProfile = async () => {
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open('bangbang-offline', 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains('files')) open.result.createObjectStore('files');
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(open.result);
  });
  const get = (key) => new Promise((resolve, reject) => {
    const request = db.transaction('files', 'readonly').objectStore('files').get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const out = { 'pve-profile': await get('pve-profile'), 'pve-bag': await get('pve-bag') };
  db.close();
  return out;
};

(async () => {
  const bytes = zipEntry(fs.readFileSync(ZIP), FIXTURE);
  assert.ok(bytes.byteLength > 1_000_000, 'fixture DB extracted');

  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
    page.on('console', (message) => {
      if (message.type() === 'warning') console.error('browser warning:', message.text());
      if (message.type() !== 'error') return;
      if (/fonts\.(googleapis|gstatic)\.com|ERR_NAME_NOT_RESOLVED|favicon\.ico/.test(message.text())) return;
      errors.push('console: ' + message.text());
    });
    await page.route('**/e2e-fixture.db', (route) => route.fulfill({
      status: 200, contentType: 'application/octet-stream', body: bytes,
    }));
    await page.route('**/e2e-blank', (route) => route.fulfill({
      status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>seed</title>',
    }));

    await page.goto(origin + '/e2e-blank', { waitUntil: 'domcontentloaded' });
    const seeded = await page.evaluate(async () => {
      const data = new Uint8Array(await (await fetch('/e2e-fixture.db')).arrayBuffer());
      const db = await new Promise((resolve, reject) => {
        const open = indexedDB.open('bangbang-offline', 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains('files')) open.result.createObjectStore('files');
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => resolve(open.result);
      });
      await new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').put(data, 'db');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return data.byteLength;
    });
    assert.equal(seeded, bytes.byteLength, 'legacy DB seeded into IndexedDB');

    await page.goto(origin + '/games/bangbang/html5/index.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#bb-create').waitFor({ state: 'visible', timeout: 90000 });
    const profile = await page.evaluate(() => window.__bbOffline.ready);
    const migrated = await page.evaluate(readProfile);
    if (profile?.name !== 'html5_seed_local') {
      console.error('migration diagnostics', JSON.stringify({
        profile,
        keys: Object.keys(migrated),
        pveProfile: migrated['pve-profile'],
        bag: Array.isArray(migrated['pve-bag']) ? migrated['pve-bag'].length : null,
        name: await page.evaluate(() => localStorage.getItem('bb-character-name')),
        engine: await page.evaluate(() => window.__bbEngine),
        migration: await page.evaluate(() => window.__bbMigration),
        db: await page.evaluate(async () => {
          const db = await new Promise((resolve, reject) => {
            const open = indexedDB.open('bangbang-offline', 1);
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => reject(open.error);
          });
          const tx = db.transaction('files', 'readonly');
          const keys = await new Promise((resolve) => { const req = tx.objectStore('files').getAllKeys(); req.onsuccess = () => resolve(req.result); });
          const legacy = await new Promise((resolve) => { const req = tx.objectStore('files').get('db'); req.onsuccess = () => resolve(req.result?.byteLength || null); });
          db.close();
          return { keys, legacy };
        }),
      }, null, 2));
    }
    assert.equal(profile?.name, 'html5_seed_local', 'migrated character reaches the worker');
    assert.equal(migrated['pve-profile']?.legacy_migration?.version, 1, 'profile marked migrated');
    assert.equal(Array.isArray(migrated['pve-bag']), true, 'bag is an array');
    assert.equal(migrated['pve-bag'].length, 384, 'all legacy inventory items migrated');
    assert.equal(await page.evaluate(() => localStorage.getItem('bb-character-name')), 'html5_seed_local',
      'character name written to localStorage');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#bb-create').waitFor({ state: 'visible', timeout: 90000 });
    const reloadedProfile = await page.evaluate(() => window.__bbOffline.ready);
    const reloaded = await page.evaluate(readProfile);
    assert.equal(reloadedProfile?.name, 'html5_seed_local', 'character survives reload');
    assert.equal(reloaded['pve-profile']?.legacy_migration?.version, 1, 'migration marker survives reload');
    assert.equal(reloaded['pve-bag'].length, 384, 'bag is not duplicated on reload');
    assert.deepEqual(errors, [], 'no page or console errors');

    console.log(JSON.stringify({
      ok: true,
      character: migrated['pve-profile'].name,
      bag: migrated['pve-bag'].length,
      reloadBag: reloaded['pve-bag'].length,
      marker: migrated['pve-profile'].legacy_migration,
    }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
