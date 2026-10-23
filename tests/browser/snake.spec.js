const { test, expect } = require("@playwright/test");

const KEY = "may-game:v1:snake";
// Head at (9,9) moving right with food two cells ahead.
const saved = (extra = {}) => ({ version: 1, bestScore: 40, walls: true, muted: true, current: {
  snake: [[9, 9], [8, 9], [7, 9]], dir: "right", queue: [], food: [11, 9], score: 0, walls: true, phase: "paused", ...extra } });

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
});

test("Snake rapid pause and resume keep exactly one frame chain", async ({ page }) => {
  await page.addInitScript(() => {
    const pending = new Map();
    let next = 1;
    window.requestAnimationFrame = callback => { const id = next++; pending.set(id, callback); return id; };
    window.cancelAnimationFrame = id => pending.delete(id);
    window.pendingFrames = () => pending.size;
    window.runFrame = time => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback(time)); };
  });
  await page.goto('/games/snake/');
  await page.locator('#snake-primary').click();
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
  });
  expect(await page.evaluate(() => window.pendingFrames())).toBe(1);
  await page.evaluate(() => window.runFrame(100));
  expect(await page.evaluate(() => window.pendingFrames())).toBe(1);
});

test("Snake starts, steers, eats and survives a reload", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(([key, value]) => { if (!sessionStorage.seeded) { localStorage.setItem(key, value); sessionStorage.seeded = 1; } }, [KEY, JSON.stringify(saved())]);
  await page.goto("/games/snake/");
  await expect(page.locator("#snake-overlay h2")).toHaveText("Tạm dừng");
  await expect(page.locator("#best")).toHaveText("40");
  await page.locator("#snake-board").focus();
  await page.keyboard.press("p");
  await expect(page.locator("#snake-overlay")).toBeHidden();
  await expect(page.locator("#score")).toHaveText("10");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("p");
  await expect(page.locator("#snake-overlay h2")).toHaveText("Tạm dừng");
  const record = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
  expect(record.current.score).toBe(10);
  expect([record.current.dir, ...record.current.queue]).toContain("down");
  await page.reload();
  await expect(page.locator("#score")).toHaveText("10");
  await expect(page.locator("#snake-overlay h2")).toHaveText("Tạm dừng");
  expect(errors).toEqual([]);
});

test("Snake menu pauses, keeps the run paused after closing and ends on a wall", async ({ page }) => {
  await page.addInitScript(([key, value]) => { if (!sessionStorage.seeded) { localStorage.setItem(key, value); sessionStorage.seeded = 1; } },
    [KEY, JSON.stringify(saved({ snake: [[16, 9], [15, 9], [14, 9]], food: [0, 0] }))]);
  await page.goto("/games/snake/");
  await page.locator("#snake-primary").click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#game-menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#game-menu")).toBeHidden();
  await expect(page.locator("#snake-overlay h2")).toHaveText("Tạm dừng");
  await page.locator("#snake-primary").click();
  await expect(page.locator("#snake-overlay h2")).toHaveText("Hết ván");
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).current, KEY)).toBeNull();
  await page.locator("#snake-primary").click();
  await expect(page.locator("#snake-overlay")).toBeHidden();
});

test("Snake reacts to swipes and the touch pad", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.goto("/games/snake/");
  await expect(page.locator(".play-pad")).toBeVisible();
  await page.locator('.play-pad [data-dir="up"]').click();
  await expect(page.locator("#snake-overlay")).toBeHidden();
  const box = await page.locator("#snake-board").boundingBox();
  await page.locator("#game-menu-toggle").click();
  await page.locator("[data-menu-close]").click();
  // A swipe on the board resumes the paused run and steers it.
  const touch = await context.newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 100, y: box.y + 100 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + 40, y: box.y + 104 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator("#snake-overlay")).toBeHidden();
  await page.locator("#game-menu-toggle").click();
  const record = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
  expect([record.current.dir, ...record.current.queue]).toContain("left");
  await context.close();
});

test("Snake fits phone, landscape and desktop screens", async ({ page }) => {
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.goto("/games/snake/");
    const board = await page.locator(".play-board").boundingBox();
    expect(board.width).toBeGreaterThan(180);
    expect(board.y + board.height).toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => [document.documentElement.scrollWidth > innerWidth, document.documentElement.scrollHeight > innerHeight])).toEqual([false, false]);
  }
});
