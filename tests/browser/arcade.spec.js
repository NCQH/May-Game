const { test, expect } = require("@playwright/test");

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
  await page.locator("#size").click();
  await page.getByRole("button", { name: "Tự động" }).click();
  const unchanged = await page.evaluate(() => JSON.parse(localStorage.getItem("may-game:v1:pikachu")).current);
  expect(unchanged.tiles).toEqual(before.tiles);
  expect(unchanged.matched).toBe(before.matched);
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
  const { freshState, blankRecord } = require('../../games/tetris/game.js');
  const current = freshState();
  current.active = { type: 'T', rotation: 0, x: 3, y: -1 };
  current.board[1].fill('I');
  current.paused = true;
  await page.addInitScript((saved) => {
    localStorage.setItem('may-game:v1:tetris', JSON.stringify(saved));
  }, { ...blankRecord(), current });
  await page.goto("/games/tetris/");
  await expect(page.locator("#pause")).toHaveText("Tiếp tục");
  await page.locator("#pause").click();
  await page.locator("#tetris-board").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#status")).toContainText("Ván kết thúc");
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
});

test("every catalog start link remains visible and tappable on small screens", async ({ page }) => {
  for (const viewport of [{ width: 568, height: 320 }, { width: 320, height: 568 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.locator("#start-game")).toBeVisible();
    for (let game = 0; game < 4; game++) {
      await expect.poll(() => page.locator("#start-game").evaluate((link) => {
        const rect = link.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight
          && document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("a") === link;
      })).toBe(true);
      await page.keyboard.press("ArrowRight");
    }
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

test("Flappy UI supports pause, muted reload, death and retry", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/games/flappy-bird/");
  await expect(page.locator("#flap")).toHaveText("Bắt đầu");
  await page.locator("#mute").click();
  await expect(page.locator("#mute")).toHaveText("Bật âm");
  await page.locator("#flap").click();
  await page.locator("#pause").click();
  await expect(page.locator("#status")).toContainText("Tạm dừng");
  await page.reload();
  await expect(page.locator("#flap")).toHaveText("Tiếp tục");
  await expect(page.locator("#mute")).toHaveText("Bật âm");
  await page.locator("#flap").click();
  await expect(page.locator("#flap")).toHaveText("Chơi lại", { timeout: 6000 });
  await page.locator("#flap").click();
  await expect(page.locator("#flap")).toHaveText("Vỗ cánh");
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
  await page.locator('#tetris-board').focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.evaluate(() => audioEvents.includes('start'))).toBe(true);
  expect(await page.evaluate(() => audioEvents.includes(.18))).toBe(true);
  await page.locator('#mute').click();
  await page.evaluate(() => { audioEvents.length = 0; });
  await page.locator('#tetris-board').focus();
  await page.keyboard.press('ArrowRight');
  expect(await page.evaluate(() => audioEvents.length)).toBe(0);
  await page.locator('#mute').click();
  await expect.poll(() => page.evaluate(() => audioEvents.includes('start'))).toBe(true);
});

test("Tetris UI switches modes, holds once, pauses time and restores mute", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 924 });
  await page.goto('/games/tetris/');
  await page.locator('#mode').selectOption('blitz');
  await expect(page.locator('#timer')).toContainText('1:');
  await page.locator('#mute').click();
  await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#tetris-board').focus();
  await page.keyboard.press('c');
  await expect(page.locator('#hold')).toBeDisabled();
  await expect(page.locator('#tetris-hold')).not.toHaveAttribute('aria-label', /trống/);
  await page.keyboard.press('Space');
  await expect(page.locator('#hold')).toBeEnabled();
  await page.locator('#pause').click();
  const clock = await page.locator('#timer').textContent();
  await page.waitForTimeout(250);
  await expect(page.locator('#timer')).toHaveText(clock);
  await page.reload();
  await expect(page.locator('#mode')).toHaveValue('blitz');
  await expect(page.locator('#pause')).toHaveText('Tiếp tục');
  await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#mode').selectOption('sprint');
  await expect(page.locator('#lines')).toHaveText('0');
});

test("game pages fit phone and desktop viewports without horizontal overflow", async ({ page }) => {
  for (const viewport of [{ width: 320, height: 568 }, { width: 412, height: 924 }, { width: 568, height: 320 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    for (const route of ["/", "/games/pikachu/", "/games/tetris/", "/games/flappy-bird/"]) {
      await page.goto(route);
      const dimensions = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scrollWidth, `${route} at ${viewport.width}px`).toBeLessThanOrEqual(dimensions.clientWidth);
      for (const selector of route.includes('tetris') ? ['#mode', '#pause', '#restart', '#mute'] : route.includes('flappy') ? ['#flap', '#mute'] : []) {
        const rect = await page.locator(selector).boundingBox();
        expect(rect.y, selector).toBeGreaterThanOrEqual(0);
        expect(rect.y + rect.height, selector).toBeLessThanOrEqual(viewport.height + 1);
      }
    }
  }
});
