const { test, expect } = require("@playwright/test");

function spyHomeAudio() {
  window.audioEvents = [];
  window.AudioContext = class {
    state = 'suspended'; currentTime = 0; destination = {};
    constructor() { window.audioEvents.push('context'); }
    async resume() {
      if (window.deferHomeAudio) await new Promise(resolve => { window.finishHomeAudio = resolve; });
      this.state = 'running';
    }
    async close() { this.state = 'closed'; }
    createOscillator() { return { frequency: { setValueAtTime() {} }, connect() {}, disconnect() {},
      start() { window.audioEvents.push('start'); }, stop(time) { window.audioEvents.push(time === undefined ? 'stop-now' : 'stop-scheduled'); } }; }
    createGain() { return { gain: { cancelScheduledValues() {}, setValueAtTime(value) { window.audioEvents.push(value); }, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
  };
}

test.beforeEach(async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
});

test("home boots only after a trusted gesture, once, and mute stops and persists", async ({ page }) => {
  await page.addInitScript(spyHomeAudio);
  await page.goto('/');
  await expect(page.locator('#start-game')).toBeVisible();
  await page.locator('#next-game').dispatchEvent('click');
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => audioEvents)).toEqual([]);
  await page.locator('#next-game').click();
  await expect.poll(() => page.evaluate(() => audioEvents.filter(event => event === 'start').length)).toBe(1);
  expect(await page.evaluate(() => audioEvents.includes(.045))).toBe(true);
  await page.locator('#previous-game').click();
  expect(await page.evaluate(() => audioEvents.filter(event => event === 'start').length)).toBe(1);
  await page.locator('#home-sound').click();
  expect(await page.evaluate(() => audioEvents.slice(-2))).toEqual([0, 'stop-now']);
  await page.reload();
  await expect(page.locator('#home-sound')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#next-game').click();
  expect(await page.evaluate(() => audioEvents)).toEqual([]);
  await page.locator('#home-sound').click();
  await expect.poll(() => page.evaluate(() => audioEvents.includes('start'))).toBe(true);
});

test("home mute-first and mute during pending resume never schedule a boot tone", async ({ page }) => {
  await page.addInitScript(spyHomeAudio);
  await page.addInitScript(() => { window.deferHomeAudio = true; });
  await page.goto('/');
  await page.locator('#home-sound').click();
  await page.locator('#next-game').click();
  expect(await page.evaluate(() => audioEvents)).toEqual([]);
  await page.locator('#home-sound').click();
  await expect.poll(() => page.evaluate(() => typeof finishHomeAudio)).toBe('function');
  await page.locator('#home-sound').click();
  await page.evaluate(() => finishHomeAudio());
  expect(await page.evaluate(() => audioEvents)).toEqual(['context']);
});

test("home catalog and navigation survive unavailable audio and blocked storage", async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const mode = new URLSearchParams(location.search).get('audio-failure');
    localStorage.removeItem('may-game:v1:home-muted');
    window.failedAudioAttempt = false;
    window.AudioContext = window.webkitAudioContext = undefined;
    if (mode === 'constructor') window.AudioContext = class { constructor() { window.failedAudioAttempt = true; throw new Error('Unavailable'); } };
    if (mode === 'resume') window.AudioContext = class { async resume() { window.failedAudioAttempt = true; throw new Error('Blocked'); } async close() {} };
    if (mode === 'storage') Object.defineProperty(window, 'localStorage', { get() { throw new Error('Blocked'); } });
  });
  for (const failure of ['missing', 'constructor', 'resume', 'storage']) {
    await page.goto(`/?audio-failure=${failure}`);
    await page.locator('#next-game').click();
    if (['constructor', 'resume'].includes(failure)) expect(await page.evaluate(() => failedAudioAttempt)).toBe(true);
    await page.locator('#home-sound').click();
    await page.locator('#search-toggle').click();
    await page.locator('#game-search').fill('Tetris');
    await expect(page.locator('.feature-copy h1')).toHaveText('Tetris');
    await page.locator('#start-game').click();
    await expect(page).toHaveURL(/games\/tetris\//);
  }
  expect(errors).toEqual([]);
});

test("home sound fits phone and desktop, keyboard toggles, and reduced motion disables reveal", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 900, height: 600 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const sound = page.locator('#home-sound');
    await expect(sound).toBeVisible();
    const box = await sound.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await sound.focus();
    expect(await sound.evaluate(node => getComputedStyle(node).outlineWidth)).toBe('3px');
    const muted = await sound.getAttribute('aria-pressed');
    await page.keyboard.press('Space');
    await expect(sound).toHaveAttribute('aria-pressed', muted === 'true' ? 'false' : 'true');
    await expect(sound).toHaveAttribute('aria-label', /âm thanh trang chủ/);
    await expect(page.locator('.game-feature')).toBeVisible();
    expect(await page.locator('.game-feature').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
    await page.locator('#search-toggle').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.cabinet-deck').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#next-game').click();
  expect(await page.locator('.game-feature').evaluate(node => getComputedStyle(node).animationName)).toBe('card-reveal');
});

test("reduced motion keeps slow catalog loading static and respects preference changes", async ({ page }) => {
  let release;
  await page.route('**/games.json*', async route => {
    await new Promise(resolve => { release = resolve; });
    await route.continue();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const loader = page.locator('.loader-pixel');
  await expect(loader).toBeVisible();
  expect(await loader.evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  expect(await loader.evaluate(node => node.getAnimations().length)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await loader.evaluate(node => getComputedStyle(node).animationName)).toBe('pixel-blink');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await loader.evaluate(node => node.getAnimations().length)).toBe(0);
  release();
  await expect(page.locator('#start-game')).toBeVisible();
});

test("arcade actions retain shared readable fonts, touch targets and keyboard focus", async ({ page }) => {
  const screens = [
    ["/", "#start-game"],
    ["/games/tetris/", "button[data-mode='marathon']"],
    ["/games/pikachu/", ".pika-controls .pika-control"],
    ["/games/flappy-bird/", "#game-menu-toggle"],
    ["/games/pvz-goty/", "#game-menu-toggle"],
  ];
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    for (const [path, selector] of screens) {
      await page.goto(path);
      const actions = page.locator(selector);
      await expect(actions.first()).toBeVisible();
      for (const action of await actions.all()) {
        const style = await action.evaluate((el) => {
          const css = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          return { font: css.fontSize, weight: css.fontWeight, family: css.fontFamily, border: css.borderTopWidth, shadow: css.boxShadow, width: box.width, height: box.height, overflow: el.scrollWidth > el.clientWidth };
        });
        expect(style.font).toBe(selector === "#game-menu-toggle" ? "22px" : selector === "#start-game" && viewport.width >= 1600 && viewport.height >= 800 ? "16px" : "14px");
        expect(style.weight).toBe("600");
        expect(style.border).toBe("2px");
        expect(style.shadow).toBe("rgb(104, 124, 67) 0px 4px 0px 0px");
        expect(style.family).toContain("Be Vietnam Pro");
        expect(style.width).toBeGreaterThanOrEqual(44);
        expect(style.height).toBeGreaterThanOrEqual(44);
        expect(style.overflow).toBe(false);
      }
      await actions.first().hover();
      expect(await actions.first().evaluate((el) => getComputedStyle(el).transform)).toBe("matrix(1, 0, 0, 1, 0, -1)");
      await page.mouse.down();
      expect(await actions.first().evaluate((el) => getComputedStyle(el).boxShadow)).toBe("rgb(104, 124, 67) 0px 1px 0px 0px");
      await page.mouse.move(0, 0);
      await page.mouse.up();
      if (path !== "/") {
        await actions.first().evaluate((el) => { el.disabled = true; });
        expect(await actions.first().evaluate((el) => getComputedStyle(el).boxShadow)).toBe("none");
        await actions.first().evaluate((el) => { el.disabled = false; });
      }
      await page.keyboard.press("Tab");
      await actions.first().focus();
      expect(await actions.first().evaluate((el) => getComputedStyle(el).outlineWidth)).toBe("3px");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    }
  }
});

test("catalog failure keeps its recovery action and retries without reloading", async ({ page }) => {
  let attempts = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  await page.route("**/games.json*", async (route) => {
    attempts++;
    if (attempts < 3) return route.fulfill({ status: 503, body: "Unavailable" });
    await pending;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([{ id: "tetris", title: "Tetris", path: "./games/tetris/index.html" }]) });
  });
  await page.goto("/");
  const retry = page.getByRole("button", { name: "Thử lại" });
  await expect(retry).toBeVisible();
  await page.keyboard.press("/");
  await expect(page.locator("#search-toggle")).toBeDisabled();
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(retry).toBeFocused();
  await retry.click();
  await expect(page.locator("#selected-game")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator("#previous-game")).toBeDisabled();
  await page.keyboard.press("/");
  await expect(page.locator(".selection-loading")).toBeVisible();
  release();
  await expect(page.locator("#start-game")).toBeFocused();
  await expect(page.locator(".game-feature h1")).toHaveText("Tetris");
  await expect(page.locator("#selected-game")).toHaveAttribute("aria-busy", "false");
  expect(attempts).toBe(3);
});

test("catalog retry focuses the heading and omits missing optional game details", async ({ page }) => {
  let attempts = 0;
  await page.route("**/games.json*", (route) => ++attempts === 1
    ? route.fulfill({ status: 503, body: "Unavailable" })
    : route.fulfill({ contentType: "application/json", body: JSON.stringify([{ id: "tetris", title: "Tetris" }]) }));
  await page.goto("/");
  await page.getByRole("button", { name: "Thử lại" }).click();
  await expect(page.locator(".game-feature h1")).toBeFocused();
  await expect(page.locator(".is-unavailable")).toHaveText("Chưa có trang chơi");
  await expect(page.locator(".game-feature")).not.toContainText("undefined");
  await page.keyboard.press("/");
  await page.keyboard.type("undef");
  await expect(page.locator(".game-feature")).toHaveCount(0);
});

test("catalog distinguishes invalid data from an empty library", async ({ page }) => {
  for (const body of ["not json", "{}", '[{"id":"bad","title":42}]', "[]"]) {
    await page.route("**/games.json*", (route) => route.fulfill({ contentType: "application/json", body }));
    await page.goto("/");
    await expect(page.locator("#selected-game h1")).toHaveText(body === "[]" ? "Chưa có game" : "Không tải được thư viện");
    await expect(page.locator("#search-toggle")).toBeDisabled();
    await expect(page.locator("#retry-catalog")).toHaveCount(body === "[]" ? 0 : 1);
    await page.unroute("**/games.json*");
  }
});

function pikaState({ matched = 0, phase = "playing", timeLeft = 192 } = {}) {
  const pairCount = 24;
  return {
    version: 2, cols: 6, rows: 8,
    tiles: Array.from({ length: 48 }, (_, index) => ({
      kind: Math.floor(index / 2),
      removed: Math.floor(index / 2) < matched,
    })),
    selected: null, score: matched * 30, level: 1, lives: 10, hintsLeft: 3,
    matched, moves: 0, levelAwarded: matched * 30, timeLimit: pairCount * 8,
    timeLeft, clockStarted: false, phase, reason: phase === "over" ? "time" : "",
    previousLevel: 0, lastBonus: 0,
  };
}

async function seedPikachu(page, state) {
  await page.goto("/");
  await page.evaluate((saved) => {
    localStorage.clear();
    localStorage.setItem("may-game:v1:pikachu", JSON.stringify({ version: 2, bestScore: 300, current: saved }));
  }, state);
}

test("home loads the game catalog and supports search and keyboard selection", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator(".game-feature h1")).toHaveText("Tetris");
  await expect(page.locator("#game-position")).toHaveText("01 / 04");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".game-feature h1")).toHaveText("Pikachu");
  await page.keyboard.press("/");
  const search = page.getByRole("searchbox", { name: "Tìm game" });
  await expect(search).toBeFocused();
  await search.fill("flappy");
  await expect(page.locator(".game-feature h1")).toHaveText("Flappy Bird");
  await expect(page.locator("#game-position")).toHaveText("01 / 01");
  const dimensions = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
  await expect(page.locator("#start-game")).toHaveAttribute("href", "./games/flappy-bird/index.html");
});

test("invalid catalog URL cannot escape games directory", async ({ page }) => {
  await page.route("**/games.json*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{ id: "bad", title: "Bad", category: "test", description: "test", difficulty: "", controls: "", path: "./games/%2e%2e/contribute.html" }]),
  }));
  await page.goto("/");
  await expect(page.locator(".start-game.is-unavailable")).toBeVisible();
  await expect(page.locator("#start-game")).toHaveCount(0);
});

test("invalid GitHub username is displayed without a broken profile link", async ({ page }) => {
  await page.route("**/games.json*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([{ id: "tetris", title: "Tetris", category: "test", path: "./games/tetris/index.html", contributors: [{ name: "Contributor", github: "bad username" }] }]),
  }));
  await page.goto("/contributors.html");
  await expect(page.getByRole("heading", { name: "Contributor" })).toBeVisible();
  await expect(page.locator(".contributor-profile")).toHaveCount(0);
});

test("Pikachu commits a pending match before leaving the page", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = pikaState({ matched: 0 });
  state.tiles[0].kind = 23;
  state.tiles[1].kind = 23;
  state.tiles[47].kind = 23;
  await seedPikachu(page, state);
  await page.goto("/games/pikachu/");
  await page.evaluate(() => {
    const board = document.querySelector("#pika-board");
    board.addEventListener("click", () => {
      const target = performance.now() + 45;
      while (performance.now() < target) {}
    }, { capture: true, once: true });
  });
  await page.locator('[data-index="0"]').click();
  await page.locator('[data-index="1"]').click();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("may-game:v1:pikachu")));
  expect(saved.current.tiles.filter((tile) => tile.removed)).toHaveLength(2);
  expect(saved.current.matched).toBe(1);
  expect(saved.current.score).toBeGreaterThan(0);
  expect(await page.locator("#pika-board .pika-tile:not(:disabled)").count()).toBe(46);
});

test("Pikachu restarting cancels a pending match callback", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = pikaState();
  state.tiles[0].kind = 23;
  state.tiles[1].kind = 23;
  state.tiles[1].removed = true;
  state.tiles[47].kind = 23;
  await seedPikachu(page, state);
  await page.goto("/games/pikachu/");
  await page.evaluate(() => {
    const board = document.querySelector("#pika-board");
    board.addEventListener("click", () => {
      const target = performance.now() + 45;
      while (performance.now() < target) {}
    }, { capture: true, once: true });
  });
  await page.locator('[data-index="0"]').click();
  await page.locator('[data-index="47"]').click();
  await page.locator("#game-menu-toggle").click();
  await page.locator("#restart").click();
  await page.locator("#dialog-actions").getByRole("button", { name: "Chơi lại", exact: true }).click();
  const initial = await page.evaluate(() => JSON.parse(localStorage.getItem("may-game:v1:pikachu")).current);
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("may-game:v1:pikachu")).current);
  expect(after.tiles).toEqual(initial.tiles);
  expect(after.matched).toBe(0);
  expect(after.score).toBe(0);
});

test("Pikachu size changes retain progress and selecting the current mode is a no-op", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = pikaState({ matched: 1 });
  state.selected = null;
  await seedPikachu(page, state);
  await page.goto("/games/pikachu/");
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("may-game:v1:pikachu")).current);
  await page.locator("#game-menu-toggle").click();
  await page.locator("#size").click();
  await page.getByRole("button", { name: "Tự động" }).click();
  const unchanged = await page.evaluate(() => JSON.parse(localStorage.getItem("may-game:v1:pikachu")).current);
  expect(unchanged.tiles).toEqual(before.tiles);
  expect(unchanged.matched).toBe(before.matched);
  await page.locator("#game-menu-toggle").click();
  await page.locator("#size").click();
  await page.getByRole("button", { name: "Đầy đủ 16×9" }).click();
  const resized = await page.evaluate(() => JSON.parse(localStorage.getItem("may-game:v1:pikachu")).current);
  expect(resized.cols).toBe(16);
  expect(resized.rows).toBe(9);
  expect(resized.matched).toBeGreaterThan(0);
  expect(resized.score).toBe(before.score);
  expect(resized.lives).toBe(before.lives);
  expect(resized.moves).toBe(before.moves);
  await page.reload();
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("may-game:v1:pikachu")).current);
  expect(restored.tiles).toEqual(resized.tiles);
  expect(restored.matched).toBe(resized.matched);
  expect(restored.score).toBe(resized.score);
});

test("Pikachu terminal state is not treated as resumable progress", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const terminalState = pikaState({ matched: 0 });
  terminalState.phase = "over";
  terminalState.timeLeft = 0;
  await seedPikachu(page, terminalState);
  await page.goto("/games/pikachu/");
  await expect(page.getByRole("heading", { name: "Pikachu Cổ Điển" })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("may-game:v1:pikachu")));
  expect(saved.current).toBeNull();
});

test("Tetris top-outs when a blocked piece still reaches above the board", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  const { freshState, blankRecord } = require('../../games/tetris/game.js');
  const current = freshState();
  current.active = { type: 'T', rotation: 0, x: 3, y: -1 };
  current.board[1].fill('I');
  current.board[1][0] = null;
  current.paused = true;
  await page.addInitScript((saved) => {
    localStorage.setItem('may-game:v1:tetris', JSON.stringify(saved));
  }, { ...blankRecord(), current });
  await page.goto("/games/tetris/");
  await page.locator("#continue-game").click();
  await page.locator("#tetris-board").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#tetris-board")).toHaveAttribute("aria-label", /Ván kết thúc/);
  await expect(page.locator('.tetris-overlay strong')).toHaveText('Hết ván');
  await expect(page.locator('.tetris-overlay')).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("may-game:v1:tetris")).current)).toBeNull();
});

test("catalog artwork has no ground bar or oversized mobile gap", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 924 });
  await page.goto("/");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('.game-feature[data-game="pikachu"]')).toBeVisible();
  await expect(page.locator(".art-ground")).toHaveCount(0);
  const layout = await page.locator(".game-feature").evaluate((node) => {
    const art = node.querySelector(".feature-art-wrap").getBoundingClientRect();
    const copy = node.querySelector(".feature-copy").getBoundingClientRect();
    return { height: art.height, gap: copy.top - art.bottom };
  });
  expect(layout.height).toBeGreaterThanOrEqual(190);
  const cabinet = await page.locator('.arcade-cabinet').boundingBox();
  expect(cabinet.y + cabinet.height).toBeGreaterThan(900);
  expect(Math.abs(layout.gap)).toBeLessThan(2);
});

test("PvZ engine download failure reports an error instead of hanging", async ({ page }) => {
  await page.route("**/engine/pvz-portable.js", (route) => route.abort());
  await page.route("**/vendor/**", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route("**/resources.json", (route) => route.fulfill({ json: {
    version: 1, revision: "fixture", files: [{ name: "main.pak" }, { name: "properties/partner.xml" }],
  } }));
  await page.route("**/pvz-goty/data/**", (route) => route.fulfill({ body: "fixture" }));
  await page.goto("/games/pvz-goty/");
  await expect(page.locator(".pvz-boot-status")).toContainText("Không tải được engine GOTY");
  const retry = page.getByRole('button', { name: 'Thử lại', exact: true });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(page.locator('.pvz-boot-status')).toContainText('Không tải được engine GOTY');
});

test("PvZ keeps a complete cached bundle after a failed asset update", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await new Promise((resolve, reject) => {
      const request = indexedDB.open("may-game-pvz-goty-v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("bundles");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("bundles", "readwrite");
        tx.objectStore("bundles").put({ version: 1, revision: "old", files: [
          { name: "main.pak", blob: new Blob(["remembered"]) },
          { name: "properties/partner.xml", blob: new Blob(["remembered"]) },
        ] }, "resources");
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => reject(tx.error);
      };
    });
  });
  await page.route("**/engine/pvz-portable.js", (route) => route.fulfill({ contentType: "application/javascript", body: `
    Module.FS = { mkdir() {}, writeFile() {}, lookupPath() { return {node: {mounted: true}}; },
      syncfs(populate, callback) { callback(); } };
    Module.callMain = () => { window.fixtureStarted = true; };
    Module.onRuntimeInitialized();
  ` }));
  await page.route("**/vendor/**", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route("**/resources.json", (route) => route.fulfill({ json: {
    version: 1, revision: "new", files: [{ name: "main.pak" }, { name: "properties/partner.xml" }],
  } }));
  await page.route("**/pvz-goty/data/**", (route) => route.abort());
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto("/games/pvz-goty/");
  await expect.poll(() => page.evaluate(() => window.fixtureStarted), { message: JSON.stringify(errors) }).toBe(true);
  await expect(page.locator(".pvz-boot-status")).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const { readBundle } = await import('/games/pvz-goty/storage.js');
    return (await readBundle('resources')).revision;
  })).toBe("old");
  await page.evaluate(async () => {
    Module.FS.syncfs = (populate, callback) => callback(new Error('fixture storage failure'));
    try { await window.syncSaves(); } catch {}
  });
  await expect(page.locator('#save-warning')).toBeVisible();
  await expect(page.locator('#save-warning')).toHaveAttribute('role', 'alert');
  await expect(page.locator('#save-export-btn')).toContainText('lỗi tự lưu');
  await page.evaluate(async () => {
    Module.FS.syncfs = (populate, callback) => callback();
    Module.FS.readdir = () => [];
    await window.syncSaves();
  });
  await expect(page.locator('#save-warning')).toHaveCount(0);
});

test("PvZ ZIP import confirms, stages across reload and applies before engine startup", async ({ page }) => {
  await page.route('**/engine/pvz-portable.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    const root = '/may-game-pvz-goty-saves/userdata';
    const dirs = new Set(['/may-game-pvz-goty-saves', root]);
    const files = new Map([[root + '/user1.dat', new TextEncoder().encode('original')]]);
    Module.FS = {
      mkdir(name) { dirs.add(name); }, lookupPath() { return {node: {mounted: true}}; },
      analyzePath(name) { return {exists: files.has(name) || dirs.has(name)}; },
      stat(name) { return {mode: dirs.has(name) ? 'dir' : 'file'}; }, isDir(mode) { return mode === 'dir'; },
      readFile(name) { return files.get(name); }, writeFile(name, bytes) { files.set(name, bytes); }, unlink(name) { files.delete(name); },
      readdir(name) { return [...files.keys()].filter(path => path.startsWith(name + '/')).map(path => path.slice(name.length + 1)); },
      syncfs(populate, callback) { callback(window.failSaveSync ? new Error('fixture quota failure') : null); }
    };
    Module.callMain = () => { window.fixtureSaveAtStart = new TextDecoder().decode(files.get(root + '/user1.dat')); };
    Module.onRuntimeInitialized();
  ` }));
  // Wrapper fixture, not a real ZIP decoder or WASM engine.
  await page.route('**/vendor/jszip.min.js', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.JSZip = class {
      static async loadAsync(file) {
        const input = JSON.parse(await file.text());
        if (input.error) throw new Error(input.error);
        return {files: Object.fromEntries(input.map(entry => [entry.path, {
          name: entry.path, unsafeOriginalName: entry.path, _data: {uncompressedSize: entry.size || 0},
          async: async () => { if (entry.error) throw new Error(entry.error); return new TextEncoder().encode(entry.text); }
        }]))};
      }
      constructor() { this.files = []; }
      file(name, bytes) { this.files.push({path: name, text: new TextDecoder().decode(bytes)}); }
      async generateAsync() { return new Blob([JSON.stringify(this.files)]); }
    };
  ` }));
  await page.route('**/resources.json', route => route.fulfill({ json: { version: 1, revision: 'save-test', files: [{name:'main.pak'}, {name:'properties/partner.xml'}] } }));
  await page.route('**/pvz-goty/data/**', route => route.fulfill({ body: 'fixture' }));
  await page.goto('/games/pvz-goty/');
  await expect.poll(() => page.evaluate(() => window.fixtureSaveAtStart)).toBe('original');
  const getPending = () => page.evaluate(async () => (await import('/games/pvz-goty/storage.js')).readBundle('pending-save-import'));
  const choose = entries => page.locator('#save-import-input').setInputFiles({name:'save.zip', mimeType:'application/zip', buffer:Buffer.from(JSON.stringify(entries))});
  await page.locator('#game-menu-toggle').click();
  expect(await page.locator('#upload-save-actions, #upload-save-clear-btn').count()).toBe(0);
  const valid = [{path:'userdata/user1.dat', text:'imported'}];
  for (const entries of [[], [{path:'userdata/../bad.dat',text:'x'}], [{path:'userdata/user1.dat',size:64*1048576+1}], [{path:'userdata/a.dat',text:'a'},{path:'a.dat',text:'b'}], [{path:'userdata/a.dat',error:'decode failure'}], {error:'bad ZIP'}]) {
    const dialog = page.waitForEvent('dialog');
    await choose(entries);
    const alert = await dialog;
    expect(alert.message()).toContain('Không nạp được save');
    await alert.dismiss();
    await expect(page.locator('#save-import-btn')).toBeEnabled();
    expect(await getPending()).toBeNull();
    expect(await page.evaluate(() => new TextDecoder().decode(Module.FS.readFile('/may-game-pvz-goty-saves/userdata/user1.dat')))).toBe('original');
  }
  page.once('dialog', dialog => dialog.dismiss());
  await choose(valid);
  await expect(page.locator('#save-import-btn')).toBeEnabled();
  expect(await getPending()).toBeNull();
  await page.evaluate(() => { window.failSaveSync = true; });
  const saveError = page.waitForEvent('dialog', {predicate: dialog => dialog.type() === 'alert'});
  page.once('dialog', dialog => dialog.accept());
  await choose(valid);
  const alert = await saveError;
  expect(alert.message()).toContain('Không nạp được save');
  await alert.dismiss();
  expect(await getPending()).toBeNull();
  await page.evaluate(async () => { window.failSaveSync = false; await window.syncSaves(); });
  await page.evaluate(() => {
    window.originalBundlePut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (key === 'pending-save-import') throw new Error('fixture pending write failure');
      return window.originalBundlePut.call(this, value, key);
    };
  });
  const pendingError = page.waitForEvent('dialog', {predicate: dialog => dialog.type() === 'alert'});
  page.once('dialog', dialog => dialog.accept());
  await choose(valid);
  const failedWrite = await pendingError;
  expect(failedWrite.message()).toContain('pending write failure');
  await failedWrite.dismiss();
  expect(await getPending()).toBeNull();
  await page.evaluate(() => { IDBObjectStore.prototype.put = window.originalBundlePut; });
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#save-export-btn').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('pvz-portable-savedata.zip');
  const exportBytes = await require('node:fs/promises').readFile(await download.path());
  const exported = JSON.parse(exportBytes.toString());
  expect(exported).toEqual([{path:'userdata/user1.dat',text:'original'}]);
  page.once('dialog', dialog => dialog.accept());
  await Promise.all([page.waitForEvent('load'), page.locator('#save-import-input').setInputFiles({name:'roundtrip.zip', mimeType:'application/zip', buffer:exportBytes})]);
  await expect.poll(() => page.evaluate(() => window.fixtureSaveAtStart)).toBe('original');
  await page.locator('#game-menu-toggle').click();
  page.once('dialog', dialog => dialog.accept());
  await Promise.all([page.waitForEvent('load'), choose(valid)]);
  await expect.poll(() => page.evaluate(() => window.fixtureSaveAtStart)).toBe('imported');
  expect(await getPending()).toBeNull();
  for (const viewport of [{width:320,height:568},{width:390,height:844},{width:844,height:390},{width:1366,height:768},{width:1440,height:900},{width:1920,height:1080}]) {
    await page.setViewportSize(viewport);
    if (!await page.locator('#game-menu').evaluate(node => node.open)) await page.locator('#game-menu-toggle').click();
    for (const id of ['#save-export-btn','#save-import-btn']) {
      const box = await page.locator(id).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);
    }
    await page.screenshot({path:`/tmp/pvz-save-menu-${viewport.width}.png`});
  }
  await page.keyboard.press('Escape');
  await expect(page.locator('#game-menu-toggle')).toBeFocused();
});

test("every catalog start link remains visible and tappable on small screens", async ({ page }) => {
  for (const viewport of [{ width: 568, height: 320 }, { width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 900, height: 600 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("#start-game")).toBeVisible();
    for (let game = 0; game < 4; game++) {
      const card = page.locator('.selected-game');
      for (const time of [0, 80, 160]) {
        const overflow = await card.evaluate((node, currentTime) => {
          node.querySelector('.game-feature').getAnimations().forEach(animation => { animation.pause(); animation.currentTime = currentTime; });
          return [node.scrollWidth - node.clientWidth, node.scrollHeight - node.clientHeight];
        }, time);
        expect(overflow).toEqual([0, 0]);
      }
      for (const arrow of await page.locator('.select-arrow').all()) {
        const box = await arrow.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        if (viewport.width <= 760 && viewport.height > 500) expect(box.y).toBeGreaterThanOrEqual((await card.boundingBox()).y + (await card.boundingBox()).height);
      }
      if (viewport.height > 500) {
        const wide = viewport.width >= 1600 && viewport.height >= 800;
        expect(await page.locator('.feature-description').evaluate(node => getComputedStyle(node).fontSize)).toBe(wide ? '18px' : '14px');
        expect(await page.locator('.feature-controls').evaluate(node => getComputedStyle(node).fontSize)).toBe(wide ? '16px' : '14px');
        expect(await page.locator('.feature-overline').evaluate(node => getComputedStyle(node).fontSize)).toBe(wide ? '14px' : '12px');
      }
      await expect.poll(() => page.locator("#start-game").evaluate((link) => {
        const rect = link.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight
          && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("a") === link;
      })).toBe(true);
      await page.keyboard.press("ArrowRight");
    }
  }
});

test("small-phone catalog fits wider Linux fallback fonts without scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await expect(page.locator('#start-game')).toBeVisible();
  await page.addStyleTag({ content: ':root { --font-body: "DejaVu Sans", sans-serif; --font-display: "DejaVu Sans", sans-serif; }' });
  for (let game = 0; game < 4; game++) {
    expect(await page.locator('.selected-game').evaluate(node => [node.scrollWidth - node.clientWidth, node.scrollHeight - node.clientHeight])).toEqual([0, 0]);
    await expect(page.locator('#start-game')).toBeInViewport();
    await page.keyboard.press('ArrowRight');
  }
});

test("shared styles and relocated Flappy assets load without missing requests", async ({ page }) => {
  const missing = [];
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().startsWith("http://127.0.0.1:4173/")) missing.push(response.url());
  });
  await page.goto("/");
  await expect(page.locator("#start-game")).toBeVisible();
  for (let game = 0; game < 4; game++) {
    const art = page.locator(".game-feature");
    const backgrounds = await art.evaluate((node) => [...node.querySelectorAll("*")].flatMap((element) => {
      const match = getComputedStyle(element).backgroundImage.match(/url\("?([^"\)]+)"?\)/);
      return match ? [match[1]] : [];
    }));
    for (const url of backgrounds) expect((await page.request.get(url)).ok(), url).toBe(true);
    await expect.poll(() => art.locator("img").evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0))).toBe(true);
    await page.keyboard.press("ArrowRight");
  }
  for (const route of ["/contribute.html", "/contributors.html", "/games/_template/", "/games/flappy-bird/", "/games/pikachu/", "/games/tetris/"]) {
    await page.goto(route);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--font-body").trim())).not.toBe("");
  }
  expect(missing).toEqual([]);
});

test("Flappy supports pause, muted reload, one revival and a fresh retry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/games/flappy-bird/');
  const board = page.locator('#flappy-board');
  await expect(page.locator('.flappy-info, .flappy-controls, .flappy-help, #status')).toHaveCount(0);
  await page.keyboard.press('m');
  await board.click();
  await page.keyboard.press('p');
  await expect(board).toHaveAttribute('aria-label', /Tạm dừng/);
  await page.reload();
  await expect(board).toHaveAttribute('aria-label', /Tạm dừng.*Âm thanh tắt/);
  await board.click();
  await expect(page.locator('.flappy-results')).toBeVisible({ timeout: 6000 });
  await page.locator('#revive').click();
  await expect(page.locator('.flappy-results')).not.toBeVisible();
  await expect(board).toHaveAttribute('aria-label', /Tạm dừng/);
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('may-game:v1:flappy-bird')).current.revived)).toBe(true);
  await board.click();
  await expect(page.locator('.flappy-results')).toBeVisible({ timeout: 6000 });
  await expect(page.locator('#revive')).not.toBeVisible();
  await page.locator('#play').click();
  await expect(page.locator('.flappy-results')).not.toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('may-game:v1:flappy-bird')).current.revived)).toBe(false);
});

test("Flappy can resume its death animation after closing the menu", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => localStorage.setItem('may-game:v1:flappy-bird', JSON.stringify({
    version: 3, bestScore: 0, muted: true,
    current: { phase: 'playing', paused: true, birdY: 200, birdV: 0, baseOffset: 0, score: 0, revived: false,
      pipes: [{ x: 90, gapY: 250, scored: false }, { x: 280, gapY: 250, scored: false }] }
  })));
  await page.route('**/games/flappy-bird/game.js*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() +
      '\nwindow.flappySnapshot = () => ({ phase: state.phase, paused: state.paused });' });
  });
  await page.goto('/games/flappy-bird/');
  await page.locator('#flappy-board').click();
  await page.waitForFunction(() => window.flappySnapshot().phase === 'dying');
  await page.locator('#game-menu-toggle').click();
  expect(await page.evaluate(() => window.flappySnapshot())).toEqual({ phase: 'dying', paused: true });
  await page.keyboard.press('Escape');
  await expect(page.locator('#pause')).toHaveCount(0);
  await page.locator('#flappy-board').click();
  await expect(page.locator('.flappy-results')).toBeVisible({ timeout: 6000 });
  await expect(page.locator('#revive')).toBeVisible();
  await page.locator('#play').click();
  await expect(page.locator('.flappy-results')).not.toBeVisible();
});

test("Flappy shortcuts preserve native result-button activation", async ({ page }) => {
  await page.goto('/games/flappy-bird/');
  await page.locator('#flappy-board').click();
  await expect(page.locator('.flappy-results')).toBeVisible({ timeout: 6000 });
  await page.locator('#revive').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#flappy-board')).toHaveAttribute('aria-label', /Tạm dừng/);
  await page.locator('.back-link').focus();
  await page.keyboard.press('p');
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('#flappy-board')).toHaveAttribute('aria-label', /Tạm dừng/);
  await page.locator('#flappy-board').focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('.flappy-results')).toBeVisible({ timeout: 6000 });
  await page.locator('#play').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.flappy-results')).not.toBeVisible();
});

test("Tetris emits audible effects after unlock and stays silent when muted", async ({ page }) => {
  await page.addInitScript(() => {
    window.audioEvents = [];
    window.AudioContext = class {
      state = 'suspended'; currentTime = 0; destination = {};
      async resume() { await Promise.resolve(); this.state = 'running'; }
      async suspend() { this.state = 'suspended'; }
      createOscillator() { return { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {},
        start() { window.audioEvents.push('start'); }, stop() {} }; }
      createGain() { return { gain: { setValueAtTime(value) { window.audioEvents.push(value); }, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; }
    };
  });
  await page.goto('/games/tetris/');
  await page.locator('button[data-mode=marathon]').click();
  await page.locator('#tetris-board').focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.evaluate(() => audioEvents.includes('start'))).toBe(true);
  expect(await page.evaluate(() => audioEvents.includes(.18))).toBe(true);
  await page.locator('#game-menu-toggle').click();
  await page.locator('#mute').click();
  await page.locator('[data-menu-close]').click();
  await page.keyboard.press('p');
  await page.evaluate(() => { audioEvents.length = 0; });
  await page.locator('#tetris-board').focus();
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => audioEvents.length)).toBe(0);
  await page.locator('#game-menu-toggle').click();
  await page.locator('#mute').click();
  await page.locator('[data-menu-close]').click();
  await page.locator('#tetris-board').click();
  await expect.poll(() => page.evaluate(() => audioEvents.includes('start'))).toBe(true);
});

test("Tetris UI switches modes, holds once, pauses time and restores mute", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 924 });
  await page.goto('/games/tetris/');
  await expect(page.locator('.arcade-game-content')).toBeHidden();
  await page.locator('button[data-mode=blitz]').click();
  await expect(page.locator('#timer')).toContainText('1:');
  await page.locator('#game-menu-toggle').click();
  await page.locator('#mute').click();
  await page.locator('[data-menu-close]').click();
  await expect(page.locator('.tetris-overlay strong')).toHaveText('Tạm dừng');
  await page.keyboard.press('p');
  await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#pause, #hold, .side-actions')).toHaveCount(0);
  await page.locator('#tetris-board').focus();
  await page.keyboard.press('c');
  await expect(page.locator('#tetris-hold')).not.toHaveAttribute('aria-label', /trống/);
  await page.keyboard.press('Space');
  await page.keyboard.press('p');
  const clock = await page.locator('#timer').textContent();
  await page.waitForTimeout(250);
  await expect(page.locator('#timer')).toHaveText(clock);
  await page.reload();
  await expect(page.locator('#continue-game')).toBeVisible();
  await page.locator('#continue-game').click();
  await expect(page.locator('#mode-name')).toHaveText('Blitz');
  await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#game-menu-toggle').click();
  await page.locator('#choose-mode').click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('button[data-mode=sprint]').click();
  await expect(page.locator('.tetris-menu')).toBeVisible();
  await expect(page.locator('#lines')).toHaveText('0');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('button[data-mode=sprint]').click();
  await expect(page.locator('#lines')).toHaveText('0 / 40');
  await expect(page.locator('#level')).toBeHidden();
  await expect(page.locator('#timer').locator('..')).toContainText('Thời gian');
});

test("small-phone game boards and touch controls stay visible together", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  for (const [route, board, controls] of [['tetris', '#tetris-board', '#game-menu-toggle'], ['flappy-bird', '#flappy-board', '#flappy-board'], ['pikachu', '#pika-board', '.pika-controls']]) {
    await page.goto(`/games/${route}/`);
    if (route === 'tetris') await page.locator('button[data-mode=marathon]').click();
    const field = await page.locator(board).boundingBox(), buttons = await page.locator(controls).boundingBox();
    expect(field.y).toBeGreaterThanOrEqual(0);
    if (route === 'tetris') {
      expect(field.height).toBeGreaterThan(200);
      expect(field.y + field.height).toBeLessThanOrEqual(568);
      await expect(page.locator('.tetris-touch')).toHaveCount(0);
      await expect(page.locator('.tetris-key-guide')).toBeHidden();
      await expect(page.locator('.tetris-help, .tetris-gesture-help')).toHaveCount(0);
    } else expect(buttons.y + buttons.height).toBeLessThanOrEqual(568);
    if (route === 'flappy-bird') await expect(page.locator('.flappy-controls, .flappy-help')).toHaveCount(0);
  }
});

test("desktop Tetris and Flappy use side panels without page scrolling", async ({ page }) => {
  for (const viewport of [{ width: 900, height: 600 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    for (const game of ['tetris', 'flappy-bird']) {
      await page.goto(`/games/${game}/`);
      if (game === 'tetris') await page.locator('button[data-mode=marathon]').click();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height);
      const title = await page.locator('h1').boundingBox(), back = await page.locator('.back-link').boundingBox();
      expect(Math.abs(title.y + title.height / 2 - back.y - back.height / 2)).toBeLessThan(2);
      const board = await page.locator(`#${game === 'tetris' ? 'tetris' : 'flappy'}-board`).boundingBox();
      expect(board.height).toBeGreaterThanOrEqual(viewport.height - 285);
      if (game === 'tetris') {
        const next = await page.locator('.tetris-tools').boundingBox();
        const hold = await page.locator('.tetris-hold').boundingBox(), stats = await page.locator('.tetris-metrics').boundingBox();
        expect(next.x).toBeGreaterThan(board.x + board.width);
        expect(stats.x + stats.width).toBeLessThanOrEqual(board.x);
        expect(stats.y - (hold.y + hold.height)).toBeLessThan(16);
        await expect(page.locator('.tetris-key-guide, #pause, #hold')).toHaveCount(0);
        await page.locator('#game-menu-toggle').click();
        await page.keyboard.press('Escape');
        await expect(page.locator('.tetris-overlay strong')).toHaveText('Tạm dừng');
        await page.locator('#tetris-board').click();
        await expect(page.locator('.tetris-overlay')).not.toBeVisible();
        await expect(page.locator('.tetris-help, .tetris-gesture-help, #status')).toHaveCount(0);
        await expect(page.locator('#game-menu')).not.toBeVisible();
        await page.locator('#game-menu-toggle').click();
  await page.locator('#choose-mode').click();
        await page.locator('button[data-mode=sprint]').click();
        await expect(page.locator('#level')).not.toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height);
      } else {
        const controls = await page.locator('#flappy-hint').boundingBox();
        const panel = await page.locator('.arcade-game-content').boundingBox();
        expect(controls.x).toBeGreaterThan(board.x + board.width);
        expect(board.y).toBeGreaterThanOrEqual(panel.y);
        expect(board.y + board.height).toBeLessThanOrEqual(panel.y + panel.height);
        expect(controls.y + controls.height + 4).toBeLessThanOrEqual(panel.y + panel.height);
        await page.locator('#flappy-board').click();
        await page.keyboard.press('p');
        await expect(page.locator('#flappy-board')).toHaveAttribute('aria-label', /Tạm dừng/);
        expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height);
      }
    }
  }
});

test("Tetris gestures rotate, drag, drop, hold and cancel without double actions", async ({ page }) => {
  const { freshState, blankRecord } = require('../../games/tetris/game.js');
  const current = freshState();
  current.active = { type: 'T', rotation: 0, x: 3, y: 2 };
  await page.addInitScript(saved => localStorage.setItem('may-game:v1:tetris', JSON.stringify(saved)), { ...blankRecord(), current });
  await page.setViewportSize({ width: 412, height: 924 });
  await page.goto('/games/tetris/');
  await page.locator('#continue-game').click();
  await page.keyboard.press('p');
  const board = page.locator('#tetris-board');
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('may-game:v1:tetris')).current);
  const pointer = (type, x, y, id = 1, primary = true) => board.dispatchEvent(type, { pointerId: id, isPrimary: primary, pointerType: 'touch', button: 0, clientX: x, clientY: y });
  const rect = await board.boundingBox(), x = rect.x + rect.width * .75, y = rect.y + 100, cell = rect.width / 10;
  await pointer('pointerdown', x, y); await pointer('pointerup', x, y);
  expect((await saved()).paused).toBe(false);
  expect((await saved()).active.rotation).toBe(0);
  await pointer('pointerdown', x, y); await pointer('pointerup', x, y);
  expect((await saved()).active.rotation).toBe(1);
  await pointer('pointerdown', rect.x + 10, y); await pointer('pointerup', rect.x + 10, y);
  expect((await saved()).active.rotation).toBe(0);
  const start = (await saved()).active.x;
  await pointer('pointerdown', x, y);
  await pointer('pointermove', x - cell * 2.2, y);
  expect((await saved()).active.x).toBe(start - 2);
  await pointer('pointermove', x, y);
  await pointer('pointerup', x, y);
  expect((await saved()).active.x).toBe(start);
  expect((await saved()).active.rotation).toBe(0);
  await pointer('pointerdown', x, y);
  await pointer('pointerdown', x, y, 2, false);
  await pointer('pointerup', x, y, 2, false);
  await pointer('pointercancel', x, y);
  await pointer('pointerup', x, y);
  expect((await saved()).active.rotation).toBe(0);
  await pointer('pointerdown', x, y);
  await page.waitForTimeout(240);
  await pointer('pointermove', x, y + cell * 2.2);
  await pointer('pointerup', x, y + cell * 2.2);
  expect((await saved()).board.flat().filter(Boolean)).toHaveLength(0);
  await pointer('pointerdown', x, y); await pointer('pointerup', x, y - 60);
  expect((await saved()).hold).toBe('T');
  const held = (await saved()).active.type;
  await pointer('pointerdown', x, y); await pointer('pointerup', x, y - 60);
  expect((await saved()).active.type).toBe(held);
  await pointer('pointerdown', x, y); await pointer('pointerup', x, y + 60);
  expect((await saved()).board.flat().filter(Boolean)).toHaveLength(4);
  await board.focus(); await page.keyboard.press('m');
  await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('p');
  const clock = await page.locator('#timer').textContent();
  await page.waitForTimeout(100);
  await expect(page.locator('#timer')).toHaveText(clock);
  page.once('dialog', dialog => dialog.dismiss()); await page.keyboard.press('r');
  expect((await saved()).board.flat().filter(Boolean)).toHaveLength(4);
  page.once('dialog', dialog => dialog.accept()); await page.keyboard.press('r');
  expect((await saved()).board.flat().filter(Boolean)).toHaveLength(0);
});

test("contribution pages scroll natively without shrinking controls", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  for (const route of ['/contribute.html', '/contributors.html']) {
    await page.goto(route);
    expect(await page.locator('main').evaluate(node => getComputedStyle(node).transform)).toBe('none');
    const content = page.locator('.page-content');
    expect(await content.evaluate(node => getComputedStyle(node).overflowY)).toBe('auto');
    expect(await page.locator('.page-heading-copy p:not(.page-kicker)').evaluate(node => getComputedStyle(node).fontSize)).toBe('14px');
    for (const paragraph of await page.locator('.guide-step p, .guide-note p, .guide-local-run p').all()) {
      expect(await paragraph.evaluate(node => getComputedStyle(node).fontSize)).toBe('14px');
    }
    await content.evaluate(node => { node.scrollTop = node.scrollHeight; });
    expect(await content.evaluate(node => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop) <= 1)).toBe(true);
    const link = page.locator('.cabinet-deck a').first();
    await expect(link).toBeVisible();
    expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
});

test("review controls fit without scrolling and touch pause/mute work", async ({ page }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    for (const game of ["tetris", "flappy-bird"]) {
      await page.goto(`/games/${game}/`);
      if (game === "tetris") await page.locator('button[data-mode="marathon"]').click();
      for (const selector of ["#game-menu-toggle"]) {
        const rect = await page.locator(selector).boundingBox();
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height);
      }
    }
  }
  await page.locator("#flappy-board").click();
  await expect(page.locator("#game-menu-toggle")).toHaveAttribute("aria-label", "Tạm dừng và mở menu");
  await page.locator("#game-menu-toggle").click();
  await expect(page.locator("#flappy-hint")).toContainText("Chạm để tiếp tục");
  await page.locator("#mute").click();
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "true");
  await page.goto("/contribute.html");
  await expect(page.locator('a[href="https://github.com/NCQH/May-Game/fork"]')).toHaveCount(2);
  await expect(page.locator('a[href="https://github.com/NCQH/May-Game/tree/main/games/_template"]')).toHaveCount(1);
});

test("game pages fit phone and desktop viewports without horizontal overflow", async ({ page }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 412, height: 924 }, { width: 568, height: 320 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    for (const route of ["/", "/games/pikachu/", "/games/tetris/", "/games/flappy-bird/"]) {
      await page.goto(route);
      if (route.includes('tetris')) await page.locator('button[data-mode=marathon]').click();
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth, `${route} at ${viewport.width}px`).toBeLessThanOrEqual(dimensions.clientWidth);
      expect(await page.locator('main').evaluate(node => getComputedStyle(node).transform)).toBe('none');
      for (const selector of route.includes('tetris') ? ['#game-menu-toggle'] : []) {
        await page.locator(selector).scrollIntoViewIfNeeded();
        const rect = await page.locator(selector).boundingBox();
        expect(rect.height, selector).toBeGreaterThanOrEqual(44);
        expect(rect.width, selector).toBeGreaterThanOrEqual(44);
        expect(rect.y, selector).toBeGreaterThanOrEqual(-1);
        expect(rect.y + rect.height, selector).toBeLessThanOrEqual(viewport.height + 1);
      }
    }
  }
});


test("common menus expose settings, lock gameplay and restore focus with Escape", async ({ page }) => {
  for (const game of ["tetris", "flappy-bird", "pikachu", "pvz-goty", "_template"]) {
    await page.goto(`/games/${game}/`);
    if (game === "tetris") await page.locator('button[data-mode=blitz]').click();
    if (game === "flappy-bird") await page.locator("#flappy-board").click();
    const toggle = page.locator("#game-menu-toggle");
    await toggle.click();
    const menu = page.locator("#game-menu");
    await expect(menu).toHaveCount(1);
    await expect(menu).toBeVisible();
    await expect(menu.locator("h2")).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const timer = game === "tetris" ? page.locator("#timer") : game === "pikachu" ? page.locator("#time-text") : null;
    if (timer && await timer.count()) {
      const before = await timer.textContent();
      await menu.evaluate(node => node.focus());
      await page.keyboard.press("Space");
      await page.waitForTimeout(1100);
      await expect(timer).toHaveText(before);
    }
    if (game === "flappy-bird") {
      await page.keyboard.press("p");
      await expect(page.locator("#flappy-board")).toHaveAttribute("aria-label", /Tạm dừng/);
    }
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
  }
});


test("PvZ loading distinguishes first-file download from engine startup", async ({ page }) => {
  let releaseFile;
  const fileGate = new Promise(resolve => { releaseFile = resolve; });
  await page.route("**/engine/pvz-portable.js", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route("**/vendor/**", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route("**/resources.json", route => route.fulfill({ json: {
    version: 1, revision: "loading-fixture", files: [{ name: "main.pak" }, { name: "properties/partner.xml" }],
  } }));
  await page.route("**/pvz-goty/data/**", async route => { await fileGate; await route.fulfill({ body: "fixture" }); });
  await page.goto("/games/pvz-goty/", { waitUntil: "domcontentloaded" });
  const status = page.locator(".pvz-boot-status");
  await expect(status).toContainText("0/2 tệp hoàn tất");
  await expect(status.locator("progress")).toHaveAttribute("value", "0");
  await expect(status.locator("progress")).toHaveAttribute("max", "2");
  releaseFile();
  await expect(status).toContainText("Dữ liệu đã sẵn sàng. Đang khởi động engine");
  await expect(status.locator("progress")).not.toHaveAttribute("value");
  await page.evaluate(() => window._rejectModuleReady(new Error("Không tải được engine GOTY")));
  await expect(status).toContainText("Không tải được engine GOTY");
  await expect(status.locator("progress")).toHaveCount(0);
  await expect(status.getByRole("button", { name: "Thử lại" })).toBeVisible();
});


test("contributor links keep touch targets and wrap long names on phone and desktop", async ({ page }) => {
  await page.route("**/games.json*", route => route.fulfill({ json: [
    { id: "one", title: "Tên trò chơi rất dài để kiểm tra xuống dòng", category: "Arcade", path: "./games/tetris/index.html", contributors: [{ name: "Tên người đóng góp rất dài cần xuống dòng", github: "abcdefghijklmnopqrstuvwxyz0123456789" }] },
    { id: "two", title: "GameChuaGhiNhanVoiTenLienTucRatDaiKhongCoKhoangTrang", path: "./games/pikachu/index.html" },
  ] }));
  for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/contributors.html");
    await expect(page.locator(".contributor-profile")).toBeVisible();
    for (const link of await page.locator(".contributor-profile, a.contributor-game, a.uncredited-game").all()) {
      await link.scrollIntoViewIfNeeded();
      const box = await link.boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(await link.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      await link.focus();
      expect(await link.evaluate(node => getComputedStyle(node).outlineWidth)).toBe("3px");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
