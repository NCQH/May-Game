const { test, expect } = require("@playwright/test");

const KEY = 'may-game:v1:2048';
const URL = '/games/2048/';
const z = (n) => Array(n).fill(0);
const seed = (page, current, extra = {}) => page.addInitScript(([key, value]) => {
  if (sessionStorage.getItem('seeded')) return;
  sessionStorage.setItem('seeded', '1');
  localStorage.setItem(key, JSON.stringify(value));
}, [KEY, { version: 1, bestScore: 0, current, ...extra }]);
const grid = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)).current?.grid, KEY);
const saved = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);

test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on('pageerror', (error) => page.errors.push(error.message));
  // Aborted Google Fonts requests are expected offline; any other console error fails the test.
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.location().url.startsWith('https://fonts.googleapis.com/')) page.errors.push(message.text());
  });
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
});
test.afterEach(async ({ page }) => { expect(page.errors).toEqual([]); });

test("keyboard play merges, scores, undoes and saves across reload", async ({ page }) => {
  await seed(page, { grid: [2, 2, 0, 0, ...z(12)], score: 0, phase: 'playing', continued: false, undo: null });
  await page.goto(URL);
  await expect(page.locator('.tile-2048')).toHaveCount(2);
  await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('#board-2048').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#score')).toHaveText('4');
  await expect(page.locator('#max-tile')).toHaveText('4');
  await expect(page.locator('#best')).toHaveText('4');
  await expect(page.locator('.tile-2048')).toHaveCount(2);
  await expect(page.locator('#status-2048')).toHaveText('Gộp được 1 ô, điểm 4.');
  const afterMerge = await grid(page);
  expect(afterMerge[0]).toBe(4);
  await page.keyboard.press('d');
  await expect(page.locator('#undo')).toBeEnabled();
  await page.locator('#undo').click();
  await expect(page.locator('#undo')).toBeDisabled();
  expect(await grid(page)).toEqual(afterMerge);
  await expect(page.locator('#score')).toHaveText('4');
  await page.reload();
  await expect(page.locator('#score')).toHaveText('4');
  expect(await grid(page)).toEqual(afterMerge);
  await expect(page.locator('.tile-2048')).toHaveCount(afterMerge.filter(Boolean).length);
});

test("swipe on the board moves tiles; short taps do not", async ({ page }) => {
  await seed(page, { grid: [0, 0, 0, 2, ...z(12)], score: 0, phase: 'playing', continued: false, undo: null });
  await page.goto(URL);
  const box = await page.locator('#board-2048').boundingBox();
  const swipe = async (dx, dy) => page.locator('#board-2048').evaluate((board, [dx, dy]) => {
    const r = board.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const fire = (type, cx, cy) => board.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: cx, clientY: cy, isPrimary: true }));
    fire('pointerdown', x, y); fire('pointerup', x + dx, y + dy);
  }, [dx, dy]);
  expect(box.width).toBeGreaterThan(100);
  await swipe(10, 5);
  expect((await grid(page))[3]).toBe(2);
  await swipe(-80, 10);
  await expect.poll(async () => (await grid(page))[0]).toBe(2);
  await expect(page.locator('.tile-2048')).toHaveCount(2);
});

test("menu blocks input, Esc closes it and focus returns to the board", async ({ page }) => {
  await seed(page, { grid: [2, 0, 0, 0, ...z(12)], score: 0, phase: 'playing', continued: false, undo: null });
  await page.goto(URL);
  await page.locator('#board-2048').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#game-menu')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  expect((await grid(page))[0]).toBe(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('#game-menu')).toBeHidden();
  await expect(page.locator('#board-2048')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await grid(page))[3]).toBe(2);
  await page.locator('#game-menu-toggle').click();
  await page.locator('#mute').click();
  await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#new-game').click();
  await expect(page.locator('#game-menu')).toBeHidden();
  await expect(page.locator('.tile-2048')).toHaveCount(2);
  await expect(page.locator('#score')).toHaveText('0');
  expect((await saved(page)).muted).toBe(true);
});

test("win overlay offers keep playing once; game over clears the saved game", async ({ page }) => {
  await seed(page, { grid: [1024, 1024, 0, 0, ...z(12)], score: 100, phase: 'playing', continued: false, undo: null });
  await page.goto(URL);
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#overlay-2048 h2')).toHaveText('Đạt 2048!');
  await expect(page.locator('#primary-2048')).toHaveText('Chơi tiếp');
  await expect(page.locator('#secondary-2048')).toHaveText('Ván mới');
  expect((await saved(page)).current.phase).toBe('won');
  await page.locator('#primary-2048').click();
  await expect(page.locator('#overlay-2048')).toBeHidden();
  const s = await saved(page);
  expect(s.current).toMatchObject({ phase: 'playing', continued: true });

  // New tab after closing this one, so its pagehide save cannot overwrite the seeded board.
  const context = page.context();
  await page.close();
  const fresh = await context.newPage();
  page.errors = [];
  fresh.on('pageerror', (error) => page.errors.push(error.message));
  await fresh.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await seed(fresh, { grid: [2, 4, 2, 4, 4, 2, 4, 2, 8, 4, 2, 4, 16, 32, 64, 0], score: 50, phase: 'playing', continued: false, undo: null });
  await fresh.goto(URL);
  await fresh.keyboard.press('ArrowRight');
  await expect(fresh.locator('#overlay-2048 h2')).toHaveText('Hết nước đi');
  await expect(fresh.locator('#primary-2048')).toHaveText('Chơi lại');
  await expect(fresh.locator('#secondary-2048')).toBeHidden();
  expect((await saved(fresh)).current).toBeNull();
  await fresh.locator('#primary-2048').click();
  await expect(fresh.locator('#overlay-2048')).toBeHidden();
  await expect(fresh.locator('.tile-2048')).toHaveCount(2);
  await expect(fresh.locator('#score')).toHaveText('0');
});

test("invalid saves fall back to a fresh game", async ({ page }) => {
  await seed(page, { grid: [3, ...z(15)], score: 5, phase: 'playing', continued: false, undo: null }, { bestScore: 77 });
  await page.goto(URL);
  await expect(page.locator('.tile-2048')).toHaveCount(2);
  await expect(page.locator('#score')).toHaveText('0');
  await expect(page.locator('#best')).toHaveText('77');
});

for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1366, 768], [1920, 1080]]) {
  test(`fits ${width}x${height} without overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(URL);
    const info = await page.evaluate(() => {
      const rect = (s) => document.querySelector(s).getBoundingClientRect();
      const board = rect('#board-2048'), undo = rect('#undo');
      return { overflowX: document.documentElement.scrollWidth > innerWidth, overflowY: document.documentElement.scrollHeight > innerHeight,
        board: [board.left, board.top, board.right, board.bottom, board.width], undo: [undo.bottom, undo.height], w: innerWidth, h: innerHeight };
    });
    expect(info.overflowX).toBe(false);
    expect(info.overflowY).toBe(false);
    const [left, top, right, bottom, size] = info.board;
    expect(left).toBeGreaterThanOrEqual(0); expect(top).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(info.w); expect(bottom).toBeLessThanOrEqual(info.h);
    expect(size).toBeGreaterThan(200);
    expect(info.undo[0]).toBeLessThanOrEqual(info.h); expect(info.undo[1]).toBeGreaterThanOrEqual(44);
  });
}
