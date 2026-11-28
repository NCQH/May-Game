#!/usr/bin/env node
// Local Playwright perf smoke: create -> lobby -> PvP room -> PvE scene -> warm reload.
// Usage:
//   node games/bangbang/html5/static-server/perf/smoke.cjs
//   PERF_ENGINE=py node .../smoke.cjs --boot-only
const { chromium } = require('@playwright/test');
const { createServer } = require('./serve.cjs');

const engine = process.env.PERF_ENGINE === 'py' ? 'py' : 'js';
const bootOnly = process.argv.includes('--boot-only');
const timeout = Number(process.env.PERF_TIMEOUT || 180000);

function emptyStats() {
  return { requests: 0, bytes: 0, serviceWorker: 0, pyodide: 0, types: {}, large: {} };
}

(async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/games/bangbang/html5/index.html${engine === 'py' ? '?engine=py' : ''}`;
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  const errors = [];
  page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/fonts\.(googleapis|gstatic)\.com|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|favicon\.ico/.test(text)) return;
    errors.push('console: ' + text);
  });

  const stats = { boot: emptyStats(), create: emptyStats(), pvp: emptyStats(), pve: emptyStats(), warm: emptyStats() };
  const requestPhase = new WeakMap();
  let phase = 'boot';
  const label = (url) => {
    if (/\/pyodide\/|bangbang-py\.zip/.test(url)) stats[phase].pyodide += 1;
  };
  page.on('request', (request) => {
    requestPhase.set(request, phase);
    const row = stats[phase];
    row.requests += 1;
    row.types[request.resourceType()] = (row.types[request.resourceType()] || 0) + 1;
    label(request.url());
  });
  page.on('response', (response) => {
    const row = stats[requestPhase.get(response.request()) || phase];
    if (!row) return;
    const length = Number(response.headers()['content-length'] || 0);
    if (Number.isFinite(length)) row.bytes += length;
    if (length >= 1048576) {
      const pathname = new URL(response.url()).pathname;
      const entry = row.large[pathname] || (row.large[pathname] = { count: 0, bytes: 0 });
      entry.count += 1; entry.bytes += length;
    }
    if (response.fromServiceWorker()) row.serviceWorker += 1;
  });

  const startedAt = Date.now();
  const step = (name) => console.error(`[${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${name}`);
  const mark = (name) => { phase = name; step('phase ' + name); };
  const overlay = page.locator('#bb-create');
  const waitOverlay = () => overlay.waitFor({ state: 'visible' });
  const waitLobby = async () => {
    await page.waitForFunction(
      () => window.bbM8?.snapshot?.().phase === 'ready' && window.bbM8.snapshot().play?.phase === 'lobby',
      null, { timeout });
    await page.locator('[data-testid="m8-pvp"]').waitFor({ state: 'visible' });
    await page.waitForTimeout(500);
  };

  const report = { engine, cold: {}, pvp: {}, pve: {}, warm: {}, errors, cache: {} };
  try {
    mark('boot');
    const navStart = Date.now();
    step('goto');
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    step('wait create overlay');
    await waitOverlay();
    report.cold.bootMs = Date.now() - navStart;
    report.cold.stats = stats.boot;
    step('overlay visible');

    if (bootOnly) {
      if (engine === 'py') {
        step('wait Pyodide ready');
        await page.evaluate(() => window.__bbOffline.ready);
        report.pyReady = true;
        step('Pyodide ready');
      }
      throw Object.assign(new Error('boot-only'), { done: true });
    }

    mark('create'); // create/lobby share this phase bucket; the request counts stay useful.
    const createStart = Date.now();
    await page.locator('#bb-create-name').fill('Perf Smoke');
    step('submit create');
    await page.locator('#bb-create-submit').click();
    step('wait lobby');
    await waitLobby();
    step('lobby ready');
    report.cold.lobbyMs = Date.now() - createStart;
    report.cold.createStats = stats.create;

    // PvE waiting room -> start -> battle scene (core path).
    mark('pve');
    const pveStart = Date.now();
    step('open PvE page');
    await page.locator('[data-testid="m81314-nav-pve"]').click({ force: true });
    await page.locator('[data-testid="pve-map-201"]').waitFor({ state: 'visible' });
    step('enter PvE room');
    await page.locator('[data-testid="pve-map-201"]').click({ force: true });
    await page.locator('[data-testid="pve-room-start"]').waitFor({ state: 'visible' });
    step('start PvE');
    await page.locator('[data-testid="pve-room-start"]').click({ force: true });
    step('wait PvE scene');
    await page.waitForFunction(
      () => window.bbM8?.snapshot?.().play?.phase === 'scene', null, { timeout });
    step('PvE scene ready');
    report.pve.supported = await page.evaluate(
      () => Boolean(window.bbM8?.snapshot?.().play?.render?.supported));
    if (!report.pve.supported) throw new Error('PvE scene assets are unsupported');
    report.pve.ok = true;
    report.pve.sceneMs = Date.now() - pveStart;
    report.pve.stats = stats.pve;

    // Let the service worker finish installing the common cache before warm boot.
    step('wait service worker');
    const swReady = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      const registered = await Promise.race([
        navigator.serviceWorker.ready.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 120000)),
      ]);
      const names = await caches.keys();
      const cache = names[0] ? await caches.open(names[0]) : null;
      const keys = cache ? (await cache.keys()).map((request) => new URL(request.url).pathname) : [];
      return {
        registered, caches: names, entries: keys.length,
        pyodide: keys.filter((url) => /\/pyodide\/|bangbang-py\.zip/.test(url)),
      };
    }).catch((error) => ({ error: String(error) }));
    report.cache = swReady;

    mark('warm');
    const warmStart = Date.now();
    step('warm reload');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitOverlay();
    step('warm overlay visible');
    report.warm.bootMs = Date.now() - warmStart;
    report.warm.stats = stats.warm;

    // Optional PvP room pass on the warm cache; failure must not hide the PvE result.
    try {
      mark('pvp');
      const pvpStart = Date.now();
      step('PvP: create character again');
      await page.locator('#bb-create-name').fill('Perf Smoke');
      await page.locator('#bb-create-submit').click();
      await waitLobby();
      step('open PvP hall');
      await page.locator('[data-testid="m8-pvp"]').click({ force: true, timeout: 30000 });
      await page.locator('[data-testid="m81-open-create-room"]').waitFor({ state: 'visible', timeout: 30000 });
      step('create PvP room');
      await page.locator('[data-testid="m81-open-create-room"]').click({ force: true, timeout: 30000 });
      await page.locator('[data-testid="m8-create-room"]').waitFor({ state: 'visible', timeout: 30000 });
      await page.locator('[data-testid="m8-create-room"]').click({ force: true, timeout: 30000 });
      await page.waitForFunction(
        () => window.bbM8?.snapshot?.().play?.phase === 'room'
          && window.bbM8.snapshot().play.room?.roomType !== 4, null, { timeout: 30000 });
      await page.locator('[data-testid="m81-room-close"]').waitFor({ state: 'visible', timeout: 30000 });
      step('PvP room ready');
      report.pvp.roomMs = Date.now() - pvpStart;

      step('PvP: start match');
      if (await page.locator('[data-testid="m8-ready"]').isVisible().catch(() => false)) {
        await page.locator('[data-testid="m8-ready"]').click({ force: true });
      }
      await page.locator('[data-testid="m8-start"]').click({ force: true });
      await page.locator('[data-testid="m8-confirm"]').waitFor({ state: 'visible', timeout: 30000 });
      await page.locator('[data-testid="m8-select-10000044"]').click({ force: true });
      await page.locator('[data-testid="m8-confirm"]').click({ force: true });
      await page.waitForFunction(
        () => window.bbM8?.snapshot?.().play?.phase === 'scene', null, { timeout });
      await page.waitForTimeout(1500);
      report.pvp.supported = await page.evaluate(
        () => Boolean(window.bbM8?.snapshot?.().play?.render?.supported));
      if (!report.pvp.supported) throw new Error('PvP scene assets are unsupported');
      report.pvp.ok = true;
      report.pvp.stats = stats.pvp;
    } catch (error) {
      report.pvp.ok = false;
      report.pvp.error = error.message;
      report.pvp.stats = stats.pvp;
    }
  } catch (error) {
    if (!error.done) report.fatal = error.stack || String(error);
    if (bootOnly && error.done) {
      report.cache = await page.evaluate(async () => ('serviceWorker' in navigator)
        ? navigator.serviceWorker.ready.then(async () => ({ caches: await caches.keys() })).catch(() => false)
        : false).catch(() => false);
    }
  } finally {
    report.errors = errors;
    const totalPyodideRequests = Object.values(stats).reduce((total, row) => total + row.pyodide, 0);
    const cachedPyodide = Array.isArray(report.cache?.pyodide) ? report.cache.pyodide.length : null;
    report.checks = engine === 'py'
      ? { pyodideReady: bootOnly ? report.pyReady === true : true }
      : {
        noPyodideRequests: totalPyodideRequests === 0,
        noPyodideInCache: cachedPyodide === 0,
        coldBootUnder2_5s: (report.cold?.bootMs || Infinity) < 2500,
        pveScene: bootOnly || report.pve?.ok === true,
        pvpRoom: bootOnly || Boolean(report.pvp?.roomMs),
        pvpScene: bootOnly || report.pvp?.ok === true,
      };
    report.failed = Object.entries(report.checks).filter(([, ok]) => !ok).map(([name]) => name);
    if (report.failed.length) process.exitCode = 1;
    console.log(JSON.stringify(report, null, 2));
    await browser.close();
    server.close();
  }
})();
