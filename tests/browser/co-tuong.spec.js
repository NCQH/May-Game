const { test, expect } = require("@playwright/test");

const KEY = "may-game:v1:co-tuong";
const URL = "/games/co-tuong/";
const sq = (rank, file) => rank * 9 + file;
const point = (page, square) => page.locator(`.xq-point[data-sq="${square}"]`);
const seed = (page, record) => page.addInitScript(([key, value]) => {
  if (!sessionStorage.seeded) { localStorage.setItem(key, value); sessionStorage.seeded = 1; }
}, [KEY, JSON.stringify(record)]);
const readRecord = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
const base = { version: 1, bestScore: 0, tally: { win: 0, loss: 0, draw: 0 }, level: "easy", labels: "han", muted: true, current: null };

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
});

test("Cờ tướng two-player game plays by keyboard and by click", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Google Fonts are aborted on purpose, so resource-load noise is ignored.
  page.on("console", (message) => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) errors.push(message.text()); });
  await seed(page, { ...base, mode: "local", humanSide: "red" });
  await page.goto(URL);
  await expect(page.locator("#xq-turn-text")).toHaveText("Lượt Đỏ");
  await expect(page.locator(".xq-point")).toHaveCount(90);
  await expect(point(page, sq(9, 0))).toHaveAttribute("aria-label", "Xe đỏ, cột 1, hàng 10");
  // Keyboard: cursor starts on the red general; walk to the left cannon and play it to the centre file.
  await point(page, sq(9, 4)).focus();
  for (const key of ["ArrowUp", "ArrowUp", "ArrowLeft", "ArrowLeft", "ArrowLeft"]) await page.keyboard.press(key);
  await expect(point(page, sq(7, 1))).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(point(page, sq(7, 1))).toHaveClass(/is-selected/);
  await expect(point(page, sq(0, 1))).toHaveAttribute("aria-label", /ăn được/);
  // Esc cancels the selection and does not open the menu.
  await page.keyboard.press("Escape");
  await expect(page.locator("#game-menu")).toBeHidden();
  await expect(page.locator(".xq-point.is-target")).toHaveCount(0);
  await page.keyboard.press("Space");
  for (const key of ["ArrowRight", "ArrowRight", "ArrowRight"]) await page.keyboard.press(key);
  await page.keyboard.press("Enter");
  await expect(point(page, sq(7, 4))).toHaveAttribute("aria-label", /^Pháo đỏ, cột 5, hàng 8/);
  await expect(page.locator("#xq-turn-text")).toHaveText("Lượt Đen");
  await expect(page.locator("#xq-moves")).toHaveText("1");
  // Click: an illegal destination keeps the move pending; a legal one plays.
  await point(page, sq(0, 1)).click();
  await expect(page.locator(".xq-point.is-target")).toHaveCount(2);
  await point(page, sq(1, 1)).click();
  await expect(page.locator(".xq-point.is-target")).toHaveCount(0);
  await point(page, sq(0, 1)).click();
  await point(page, sq(2, 2)).click();
  await expect(page.locator("#xq-turn-text")).toHaveText("Lượt Đỏ");
  await expect(point(page, sq(2, 2))).toHaveClass(/is-last-to/);
  // The central cannon takes a pawn over its own screen; later the other cannon takes a horse with check.
  await point(page, sq(7, 4)).click();
  await point(page, sq(3, 4)).click();
  await expect(page.locator("#xq-red-takes")).toHaveText("1");
  await point(page, sq(0, 6)).click();
  await point(page, sq(2, 8)).click();
  await point(page, sq(7, 7)).click();
  await point(page, sq(0, 7)).click();
  await expect(page.locator("#xq-red-takes")).toHaveText("2");
  await expect(page.locator("#xq-turn-text")).toHaveText("Lượt Đen · chiếu tướng!");
  await expect(point(page, sq(0, 4))).toHaveClass(/is-check/);
  await expect(page.locator("#xq-status")).toContainText("Chiếu tướng!");
  // Undo in two-player mode takes back one move.
  await page.locator("#xq-undo").click();
  await expect(page.locator("#xq-red-takes")).toHaveText("1");
  await expect(page.locator("#xq-turn-text")).toHaveText("Lượt Đỏ");
  expect((await readRecord(page)).current.moves).toEqual([[sq(7, 1), sq(7, 4)], [sq(0, 1), sq(2, 2)], [sq(7, 4), sq(3, 4)], [sq(0, 6), sq(2, 8)]]);
  // Labels switch to Vietnamese names.
  await page.locator("#game-menu-toggle").click();
  await page.locator("#set-labels").selectOption("viet");
  await page.keyboard.press("Escape");
  await expect(point(page, sq(9, 0)).locator(".xq-piece")).toHaveText("Xe");
  expect(errors).toEqual([]);
});

test("Cờ tướng threefold repetition ends in a draw with the board kept", async ({ page }) => {
  await seed(page, { ...base, mode: "local", humanSide: "red" });
  await page.goto(URL);
  const cycle = [[sq(9, 1), sq(7, 2)], [sq(0, 1), sq(2, 2)], [sq(7, 2), sq(9, 1)], [sq(2, 2), sq(0, 1)]];
  for (let round = 0; round < 2; round++) for (const [from, to] of cycle) { await point(page, from).click(); await point(page, to).click(); }
  await expect(page.locator("#xq-overlay h2")).toHaveText("Hòa — lặp lại thế cờ");
  expect((await readRecord(page)).current).toBeNull();
  await expect(page.locator("#xq-undo")).toBeDisabled();
  await page.locator("#xq-secondary").click();
  await expect(page.locator("#xq-overlay")).toBeHidden();
  await expect(page.locator("#xq-turn-text")).toHaveText("Hòa — lặp lại thế cờ");
  await expect(point(page, sq(0, 1)).locator(".xq-piece")).toHaveText("馬");
  await page.locator("#xq-new").click();
  await expect(page.locator("#xq-moves")).toHaveText("0");
  await expect(page.locator("#xq-turn-text")).toHaveText("Lượt Đỏ");
});

test("Cờ tướng vs machine: reply, undo, menu blocks input, save and resume", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await seed(page, { ...base, mode: "ai", humanSide: "red" });
  await page.goto(URL);
  await expect(page.locator("#xq-turn-text")).toHaveText("Lượt Đỏ — bạn");
  await point(page, sq(7, 7)).click();
  await point(page, sq(7, 4)).click();
  await expect(page.locator("#xq-turn-text")).toHaveText("Lượt Đen — Máy đang nghĩ…");
  await expect(page.locator("#xq-undo")).toBeDisabled();
  await expect(page.locator("#xq-turn-text")).toHaveText("Lượt Đỏ — bạn", { timeout: 5000 });
  let record = await readRecord(page);
  expect(record.current.moves).toHaveLength(2);
  expect(record.current.settings).toEqual({ mode: "ai", humanSide: "red" });
  // Undo removes the machine reply and the player's move.
  await page.locator("#xq-undo").click();
  await expect(page.locator("#xq-moves")).toHaveText("0");
  expect((await readRecord(page)).current.moves).toEqual([]);
  // The open menu blocks the board; Esc closes it and focus returns to the board.
  await page.keyboard.press("Escape");
  await expect(page.locator("#game-menu")).toBeVisible();
  await point(page, sq(7, 1)).click({ force: true, timeout: 1000 }).catch(() => {});
  await expect(page.locator(".xq-point.is-selected")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#game-menu")).toBeHidden();
  await expect(page.locator(".xq-point[tabindex='0']")).toBeFocused();
  // Play a move, wait for the reply, then reload and resume.
  await point(page, sq(6, 2)).click();
  await point(page, sq(5, 2)).click();
  await expect(page.locator("#xq-turn-text")).toHaveText("Lượt Đỏ — bạn", { timeout: 5000 });
  record = await readRecord(page);
  await page.reload();
  await expect(page.locator("#xq-moves")).toHaveText("1");
  await expect(point(page, sq(5, 2)).locator(".xq-piece")).toHaveText("兵");
  expect((await readRecord(page)).current.moves).toEqual(record.current.moves);
  // A tampered save falls back to a fresh game.
  // Tamper before the page script runs (pagehide on reload would otherwise rewrite the save).
  await page.addInitScript((key) => {
    if (sessionStorage.tampered) return;
    const value = JSON.parse(localStorage.getItem(key));
    value.current.moves = [[0, 9]];
    localStorage.setItem(key, JSON.stringify(value));
    sessionStorage.tampered = 1;
  }, KEY);
  await page.reload();
  await expect(page.locator("#xq-moves")).toHaveText("0");
  expect(errors).toEqual([]);
});

test("Cờ tướng holds a pending machine reply behind the menu and in a hidden tab", async ({ page }) => {
  await seed(page, { ...base, mode: "ai", humanSide: "red" });
  await page.addInitScript(() => {
    window.Worker = class {
      postMessage({ id }) { window.reply = () => this.onmessage({ data: { id, move: null } }); }
      terminate() {}
    };
  });
  await page.goto(URL);
  await point(page, sq(7, 7)).click();
  await point(page, sq(7, 4)).click();
  await page.locator('#game-menu-toggle').click();
  await page.evaluate(() => window.reply());
  await page.waitForTimeout(450);
  expect((await readRecord(page)).current.moves).toHaveLength(1);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await readRecord(page)).current.moves.length).toBe(2);
  await page.locator('#xq-undo').click();
  await point(page, sq(7, 7)).click();
  await point(page, sq(7, 4)).click();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    window.reply();
  });
  await page.waitForTimeout(450);
  expect((await readRecord(page)).current.moves).toHaveLength(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await readRecord(page)).current.moves.length).toBe(2);
  await page.locator('#xq-undo').click();
  await point(page, sq(7, 7)).click();
  await point(page, sq(7, 4)).click();
  await page.locator('#xq-new').click();
  await page.evaluate(() => window.reply());
  await page.waitForTimeout(450);
  expect((await readRecord(page)).current.moves).toHaveLength(1);
  await expect(page.locator('#xq-overlay')).toBeVisible();
  await page.locator('#xq-secondary').click();
  await expect.poll(async () => (await readRecord(page)).current.moves.length).toBe(2);
});

test("Cờ tướng as Đen: machine opens, board is flipped, touch play works", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await seed(page, { ...base, mode: "ai", humanSide: "black" });
  await page.goto(URL);
  await expect(page.locator("#xq-turn-text")).toHaveText("Lượt Đen — bạn", { timeout: 5000 });
  // Display index 0 (top-left) shows the red corner rook square 89.
  await expect(page.locator(".xq-point").first()).toHaveAttribute("data-sq", "89");
  await expect(point(page, sq(0, 0))).toHaveAttribute("aria-label", "Xe đen, cột 9, hàng 10");
  const top = await point(page, sq(0, 4)).boundingBox(), bottom = await point(page, sq(9, 4)).boundingBox();
  expect(top.y).toBeGreaterThan(bottom.y);
  await point(page, sq(3, 2)).tap();
  await point(page, sq(4, 2)).tap();
  await expect(page.locator("#xq-turn-text")).toHaveText("Lượt Đen — bạn", { timeout: 5000 });
  expect((await readRecord(page)).current.moves).toHaveLength(3);
  const cell = await point(page, sq(5, 4)).boundingBox();
  expect(cell.width).toBeGreaterThanOrEqual(32);
  await context.close();
});

test("Cờ tướng fits phone, landscape and desktop screens", async ({ page }) => {
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.goto(URL);
    const board = await page.locator(".play-board").boundingBox();
    expect(board.width).toBeGreaterThan(190);
    expect(board.x).toBeGreaterThanOrEqual(0);
    expect(board.x + board.width).toBeLessThanOrEqual(width);
    expect(board.y + board.height).toBeLessThanOrEqual(height);
    for (const id of ["#xq-undo", "#xq-new", "#game-menu-toggle"]) {
      const box = await page.locator(id).boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => [document.documentElement.scrollWidth > innerWidth, document.documentElement.scrollHeight > innerHeight])).toEqual([false, false]);
  }
});
