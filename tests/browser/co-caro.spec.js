const { test, expect } = require("@playwright/test");

const URL = "/games/co-caro/";
const KEY = "may-game:v1:co-caro";
const cell = (page, idx) => page.locator(`.caro-cell[data-idx="${idx}"]`);
const stones = (page) => page.locator(".caro-cell[data-stone]");
const record = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "null"), KEY);

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("ERR_FAILED")) errors.push(message.text()); });
  return errors;
}
async function switchToTwoPlayers(page) {
  await page.locator("#game-menu-toggle").click();
  await page.selectOption("#mode", "pvp");
  await page.locator("#menu-new-game").click();
  await expect(page.locator("#caro-turn-text")).toHaveText("Lượt X");
}

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
});

test("keyboard play against the machine, with labels, undo and machine reply", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(URL);
  await expect(page.locator(".caro-cell")).toHaveCount(225);
  await expect(page.locator("#caro-turn-text")).toHaveText("Lượt X — bạn");
  await expect(page.locator('#caro-board [tabindex="0"]')).toHaveCount(1);
  await page.locator('#caro-board [tabindex="0"]').focus();
  await expect(page.locator(".caro-cell:focus")).toHaveAttribute("aria-label", "Hàng 8, cột 8, trống");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".caro-cell:focus")).toHaveAttribute("aria-label", "Hàng 7, cột 7, trống");
  await page.keyboard.press("Enter");
  await expect(cell(page, 96)).toHaveAttribute("data-stone", "x");
  await expect(cell(page, 96)).toHaveAttribute("aria-label", /quân X, nước vừa đi/);
  await expect(page.locator("#caro-turn-text")).toHaveText("Lượt O — Máy đang nghĩ…");
  await expect(stones(page)).toHaveCount(2);
  await expect(page.locator("#caro-turn-text")).toHaveText("Lượt X — bạn");
  await expect(page.locator(".caro-cell:focus")).toHaveAttribute("data-idx", "96");
  // Space places too, then "Đi lại" removes both the human move and the reply.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  if (await page.locator(".caro-cell:focus").getAttribute("data-stone")) await page.keyboard.press("ArrowRight");
  await page.keyboard.press(" ");
  await expect(stones(page)).toHaveCount(4);
  await page.locator("#undo").click();
  await expect(stones(page)).toHaveCount(2);
  await page.locator("#undo").click();
  await expect(stones(page)).toHaveCount(0);
  await expect(page.locator("#undo")).toBeDisabled();
  expect(errors).toEqual([]);
});

test("touch play: two players to a win, banner keeps the line visible, tally only counts machine games", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  const errors = watchErrors(page);
  await page.goto(URL);
  await switchToTwoPlayers(page);
  for (const idx of [100, 101, 115, 116, 130, 131, 145]) await cell(page, idx).tap();
  await expect(page.locator("#caro-turn-text")).toHaveText("Lượt O");
  await page.locator("#undo").tap();
  await expect(stones(page)).toHaveCount(6);
  await cell(page, 145).tap();
  await cell(page, 146).tap();
  await cell(page, 146).tap(); // occupied: ignored
  await cell(page, 160).tap();
  await expect(page.locator("#caro-result")).toBeVisible();
  await expect(page.locator("#caro-result h2")).toHaveText("X thắng!");
  await expect(page.locator(".caro-cell.is-win")).toHaveCount(5);
  // The banner does not cover any stone of the winning line.
  const banner = await page.locator("#caro-result").boundingBox();
  for (const idx of [100, 115, 130, 145, 160]) {
    const box = await cell(page, idx).boundingBox();
    expect(box.y + box.height <= banner.y + 1 || box.y >= banner.y + banner.height - 1).toBe(true);
  }
  await cell(page, 10).tap();
  await expect(stones(page)).toHaveCount(9);
  await expect(page.locator("#undo")).toBeDisabled();
  expect((await record(page)).current).toBeNull();
  expect((await record(page)).tally).toEqual({ win: 0, loss: 0, draw: 0 });
  await page.locator("#caro-replay").tap();
  await expect(stones(page)).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test("menu blocks input and holds the machine move; Esc closes it", async ({ page }) => {
  await page.goto(URL);
  await cell(page, 112).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("#game-menu")).toBeVisible();
  await page.waitForTimeout(700);
  await expect(stones(page)).toHaveCount(1);
  await cell(page, 10).dispatchEvent("click");
  await expect(stones(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator("#game-menu")).toBeHidden();
  await expect(stones(page)).toHaveCount(2);
  // Settings changed mid-game wait for the next game.
  await page.locator("#game-menu-toggle").click();
  await page.selectOption("#difficulty", "hard");
  await expect(page.locator("#settings-note")).toHaveText(/Ván mới/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#caro-mode")).toContainText("Thường");
  await page.locator("#new-game").click();
  await expect(page.locator("#caro-mode")).toContainText("Khó");
});

test("machine first, save, reload and resume", async ({ page }) => {
  await page.goto(URL);
  await page.locator("#game-menu-toggle").click();
  await page.selectOption("#first", "ai");
  await page.keyboard.press("Escape");
  await expect(cell(page, 112)).toHaveAttribute("data-stone", "x");
  await expect(page.locator("#caro-turn-text")).toHaveText("Lượt O — bạn");
  await expect(page.locator("#undo")).toBeDisabled();
  await cell(page, 96).click();
  await expect(stones(page)).toHaveCount(3);
  const saved = await record(page);
  expect(saved.current.moves).toHaveLength(3);
  expect(saved.current.settings.first).toBe("ai");
  await page.reload();
  await expect(stones(page)).toHaveCount(3);
  await expect(cell(page, 96)).toHaveAttribute("data-stone", "o");
  await expect(page.locator("#caro-turn-text")).toHaveText("Lượt O — bạn");
});

test("an invalid saved game is replaced by a fresh one", async ({ page }) => {
  await page.addInitScript((key) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem(key, JSON.stringify({ version: 1, bestScore: 2, tally: { win: 2, loss: 1, draw: 0 },
      settings: { mode: "ai", difficulty: "easy", first: "human", blocked: false },
      current: { moves: [112, 112], settings: { mode: "ai", difficulty: "easy", first: "human", blocked: false }, phase: "playing" } }));
  }, KEY);
  await page.goto(URL);
  await expect(stones(page)).toHaveCount(0);
  await expect(page.locator("#tally-win")).toHaveText("2");
  await expect(page.locator("#tally-loss")).toHaveText("1");
  await expect(page.locator("#caro-mode")).toContainText("Dễ");
});

for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1366, 768], [1920, 1080]]) {
  test(`fits ${width}x${height} without overflow and the board stays tappable`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(URL);
    const info = await page.evaluate(() => {
      const board = document.querySelector("#caro-board").getBoundingClientRect();
      const cell = document.querySelector(".caro-cell").getBoundingClientRect();
      const controls = [...document.querySelectorAll(".play-controls .game-button")].map((b) => b.getBoundingClientRect());
      return { scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight,
        board: [board.left, board.top, board.right, board.bottom], cell: cell.width,
        controlsBottom: Math.max(...controls.map((r) => r.bottom)), controlsHeight: Math.min(...controls.map((r) => r.height)) };
    });
    expect(info.scrollW).toBeLessThanOrEqual(width);
    expect(info.scrollH).toBeLessThanOrEqual(height);
    expect(info.board[0]).toBeGreaterThanOrEqual(0);
    expect(info.board[1]).toBeGreaterThanOrEqual(0);
    expect(info.board[2]).toBeLessThanOrEqual(width);
    expect(info.board[3]).toBeLessThanOrEqual(height);
    expect(info.cell).toBeGreaterThanOrEqual(14);
    expect(info.controlsBottom).toBeLessThanOrEqual(height);
    expect(info.controlsHeight).toBeGreaterThanOrEqual(44);
  });
}
