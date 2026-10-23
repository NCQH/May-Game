const { test, expect } = require("@playwright/test");

const KEY = "may-game:v1:o-an-quan";
const URL = "/games/o-an-quan/";
const sq = (dan, quan = false) => ({ dan, quan });
const settings = { mode: "ai", level: "normal", aiFirst: false, quanNon: true };
// One move from the end: square 3 → 4, then 5 empty, eat the right quan (5 dân) and the board is out of quan.
const nearEnd = { squares: [sq(0), sq(0), sq(0), sq(1), sq(0), sq(0), sq(5, true), sq(2), sq(0), sq(0), sq(0), sq(3)],
  scores: [{ dan: 20, quan: 1 }, { dan: 19, quan: 0 }], debts: [0, 0], turn: 0, phase: "playing", moves: 30, winner: null, settings };
const record = (current, extra = {}) => ({ version: 1, bestScore: 2, tally: { win: 2, loss: 1, draw: 0 }, ...settings, speed: "fast", muted: true, current, ...extra });
const seed = (page, value) => page.addInitScript(([key, json]) => {
  if (!sessionStorage.seeded) { localStorage.setItem(key, json); sessionStorage.seeded = 1; }
}, [KEY, JSON.stringify(value)]);
const saved = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
const cell = (page, i) => page.locator(`.oaq-cell[data-index="${i}"]`);
const counts = (page) => page.locator(".oaq-count").allTextContents();

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
});

test("keyboard play: choose a square, pick a direction, the machine answers, and the game resumes after reload", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(URL);
  await expect(page.locator("#oaq-turn-text")).toContainText("Lượt của bạn");
  await expect(page.locator(".oaq-cell.is-selectable")).toHaveCount(5);
  await page.keyboard.press("Tab"); // back link
  await page.keyboard.press("Tab"); // menu toggle
  await page.keyboard.press("Tab"); // roving square
  await expect(cell(page, 1)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(cell(page, 3)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#oaq-dirs")).toBeVisible();
  await expect(page.locator(".oaq-dir").first()).toHaveAttribute("aria-label", "Rải về trái");
  // Esc cancels the choice without opening the menu.
  await page.keyboard.press("Escape");
  await expect(page.locator("#oaq-dirs")).toBeHidden();
  await expect(page.locator("#game-menu")).toBeHidden();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  // 3 → 4,5,6(quan),7,8; next 9 has 5 → keep sowing … the machine then replies.
  await expect.poll(async () => (await saved(page))?.current?.moves ?? 0).toBeGreaterThanOrEqual(1);
  await expect(page.locator("#oaq-turn-text")).toContainText("Lượt của bạn", { timeout: 5000 });
  const state = (await saved(page)).current;
  expect(state.moves).toBe(2);
  expect(state.squares.reduce((n, q) => n + q.dan, 0) + state.scores[0].dan + state.scores[1].dan).toBe(50);
  const before = await counts(page);
  await page.reload();
  await expect(page.locator("#oaq-turn-text")).toContainText("Lượt của bạn");
  expect(await counts(page)).toEqual(before);
  expect((await saved(page)).current.moves).toBe(2);
  // "Ván mới" asks for a second press before dropping a game in progress.
  await page.locator("#oaq-new").click();
  await expect(page.locator("#oaq-new")).toHaveText("Bỏ ván này? Bấm lần nữa");
  await page.locator("#oaq-new").click();
  expect(await counts(page)).toEqual(["0", "5", "5", "5", "5", "5", "0", "5", "5", "5", "5", "5"]);
  expect((await saved(page)).current).toBeNull();
  expect(errors).toEqual([]);
});

test("touch play on a phone: tap a square, tap a direction, input is blocked while sowing", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.goto(URL);
  await expect(page.locator("#oaq-board")).toHaveAttribute("data-layout", "portrait");
  const box = await cell(page, 2).boundingBox();
  expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
  await cell(page, 2).tap();
  const dirs = page.locator(".oaq-dir");
  await expect(dirs.first()).toHaveAttribute("aria-label", "Rải lên trên");
  for (const button of await dirs.all()) {
    const b = await button.boundingBox();
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(44);
  }
  await dirs.last().tap(); // down = towards square 1
  await expect(page.locator("#oaq-turn-text")).toContainText("Đang rải");
  // aria-disabled squares make Playwright wait, so tap the screen point directly.
  const other = await cell(page, 4).boundingBox();
  await page.touchscreen.tap(other.x + other.width / 2, other.y + other.height / 2);
  await expect(page.locator("#oaq-dirs")).toBeHidden();
  await expect(page.locator(".oaq-cell.is-selected")).toHaveCount(0);
  await expect(page.locator(".oaq-cell.is-hand")).toHaveCount(1);
  await expect(page.locator("#oaq-turn-text")).toContainText("Lượt của bạn", { timeout: 15000 });
  expect((await saved(page)).current.moves).toBe(2);
  await context.close();
});

test("the menu blocks the machine's turn and Esc closes it again", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const aiTurn = { ...nearEnd, squares: nearEnd.squares.map((q) => ({ ...q })), turn: 1, moves: 31 };
  await seed(page, record(aiTurn));
  await page.goto(URL);
  await page.keyboard.press("Escape");
  await expect(page.locator("#game-menu")).toBeVisible();
  await page.waitForTimeout(1200);
  expect((await saved(page)).current.moves).toBe(31);
  await page.keyboard.press("Escape");
  await expect(page.locator("#game-menu")).toBeHidden();
  await expect.poll(async () => (await saved(page))?.current?.moves ?? "over", { timeout: 5000 }).not.toBe(31);
});

test("game over shows the result, counts the win and Chơi lại starts fresh", async ({ page }) => {
  await seed(page, record(nearEnd));
  await page.goto(URL);
  await expect(page.locator("#oaq-wins")).toHaveText("2");
  await cell(page, 3).click();
  await page.locator('.oaq-dir[data-dir="1"]').click();
  await expect(page.locator("#oaq-overlay h2")).toHaveText("Bạn thắng!", { timeout: 5000 });
  await expect(page.locator("#oaq-overlay p")).toContainText("Bạn 46 điểm · Máy 24 điểm");
  await expect(page.locator("#oaq-status")).toContainText("Ăn quan và 5 dân", { ignoreCase: true });
  const after = await saved(page);
  expect(after.current).toBeNull();
  expect([after.bestScore, after.tally.win]).toEqual([3, 3]);
  await page.locator("#oaq-primary").click();
  await expect(page.locator("#oaq-overlay")).toBeHidden();
  expect(await counts(page)).toEqual(["0", "5", "5", "5", "5", "5", "0", "5", "5", "5", "5", "5"]);
});

test("invalid saves fall back to a fresh game", async ({ page }) => {
  await seed(page, record({ ...nearEnd, squares: nearEnd.squares.map((q, i) => (i === 3 ? sq(9) : q)) }));
  await page.goto(URL);
  expect(await counts(page)).toEqual(["0", "5", "5", "5", "5", "5", "0", "5", "5", "5", "5", "5"]);
  await expect(page.locator("#oaq-wins")).toHaveText("2");
});

test("two players share the screen and the top row is labelled from the screen", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seed(page, record(null, { mode: "pvp" }));
  await page.goto(URL);
  await expect(page.locator("#oaq-name-1")).toHaveText("Người 2");
  await cell(page, 5).click();
  await page.locator(".oaq-dir").last().click(); // screen-right = +1 on the bottom row
  await expect(page.locator("#oaq-turn-text")).toContainText("Người 2");
  await expect(page.locator(".oaq-cell.is-selectable").first()).toHaveClass(/oaq-side-1/);
  const target = await page.locator(".oaq-cell.is-selectable").first().getAttribute("data-index");
  await cell(page, target).click();
  await expect(page.locator(".oaq-dir").first()).toHaveAttribute("data-dir", "1"); // screen-left on the top row = +1
});

test("fits phone, landscape and desktop screens", async ({ page }) => {
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.goto(URL);
    const board = await page.locator(".play-board").boundingBox();
    expect(board.y).toBeGreaterThanOrEqual(0);
    expect(board.y + board.height).toBeLessThanOrEqual(height);
    expect(board.x + board.width).toBeLessThanOrEqual(width);
    const dan = await cell(page, 3).boundingBox();
    expect(Math.min(dan.width, dan.height)).toBeGreaterThanOrEqual(width === 320 ? 30 : 44);
    await expect(page.locator("#oaq-new")).toBeInViewport();
    expect(await page.evaluate(() => [document.documentElement.scrollWidth > innerWidth, document.documentElement.scrollHeight > innerHeight])).toEqual([false, false]);
  }
});
