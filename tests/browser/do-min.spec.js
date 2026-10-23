const { test, expect } = require("@playwright/test");

const URL = "/games/do-min/";
const KEY = "may-game:v1:do-min";
const FAR = [63, 64, 65, 66, 67, 68, 69, 70, 71, 72]; // row 7 + (0,8): rows 0-6 open in one flood

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("ERR_FAILED")) errors.push(message.text()); });
  return errors;
}
const cell = (page, i) => page.locator(`.mine-cell[data-i="${i}"]`);
const openCount = (page) => page.locator(".mine-cell.is-open").count();
const saved = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
// Seed storage once per test (later reloads keep what the game itself saved).
async function seed(page, record) {
  await page.addInitScript(([key, value]) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem(key, JSON.stringify(value));
  }, [KEY, record]);
}
// A Dễ game one reveal from winning (only cell 80 is still hidden).
function nearlyWon() {
  const revealed = [];
  for (let i = 0; i < 81; i++) if (!FAR.includes(i) && i !== 80) revealed.push(i);
  return { level: "easy", cols: 9, rows: 9, mines: FAR, revealed, flags: [], elapsed: 41000, phase: "playing" };
}

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
});

test("Dò mìn keyboard play: roving focus, reveal, flag and menu pause", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(URL);
  await expect(page.locator(".mine-cell")).toHaveCount(81);
  await expect(page.locator("#mine-grid [tabindex='0']")).toHaveCount(1);
  await page.locator("#mine-grid [tabindex='0']").focus();
  const start = Number(await page.evaluate(() => document.activeElement.dataset.i));
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  expect(Number(await page.evaluate(() => document.activeElement.dataset.i))).toBe(start + 10);
  await expect(page.locator(".mine-cell[tabindex='0']")).toHaveCount(1);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Space");
  expect(await openCount(page)).toBeGreaterThanOrEqual(9); // first reveal is a safe zero
  await expect(cell(page, start)).toHaveAttribute("aria-label", /^Hàng 5, cột 5, trống$/);
  // Flag the first hidden cell with F.
  const hidden = Number(await page.locator(".mine-cell:not(.is-open)").first().getAttribute("data-i"));
  await cell(page, hidden).focus();
  await page.keyboard.press("f");
  await expect(cell(page, hidden)).toHaveAttribute("aria-label", /đã cắm cờ$/);
  await expect(page.locator("#mines-left")).toHaveText("9");
  await page.keyboard.press("Enter"); // flagged cells do not open
  await expect(cell(page, hidden)).not.toHaveClass(/is-open/);
  // In flag mode Space still means "open" and must not also fire the button click (which would unflag).
  await page.locator("#mode").click();
  await cell(page, hidden).focus();
  await page.keyboard.press("Space");
  await expect(cell(page, hidden)).toHaveClass(/is-flag/);
  await page.locator("#mode").click();
  await cell(page, hidden).focus();
  await page.keyboard.press("f");
  await expect(page.locator("#mines-left")).toHaveText("10");
  // Timer runs, then stops while the menu is open; input is blocked by the modal.
  await expect(page.locator("#timer")).not.toHaveText("0:00", { timeout: 3000 });
  await page.keyboard.press("Escape");
  await expect(page.locator("#game-menu")).toBeVisible();
  const frozen = await page.locator("#timer").textContent();
  const opened = await openCount(page);
  await page.waitForTimeout(1300);
  await expect(page.locator("#timer")).toHaveText(frozen);
  await page.keyboard.press("f");
  expect(await openCount(page)).toBe(opened);
  await page.keyboard.press("Escape");
  await expect(page.locator("#game-menu")).toBeHidden();
  await expect(page.locator("#mine-grid [tabindex='0']")).toBeFocused();
  expect(errors).toEqual([]);
});

test("Dò mìn chord, mouse flag, mode toggle and a wrong-flag chord loss", async ({ page }) => {
  // Row 7 is mined except (1,7)=64, plus (0,8) and (1,8). Rows 0-6 are open; row 6 shows numbers.
  const mines = [63, 65, 66, 67, 68, 69, 70, 71, 72, 73];
  const revealed = []; for (let i = 0; i < 63; i++) revealed.push(i);
  await seed(page, { version: 1, bestScore: 0, best: {}, level: "easy",
    current: { level: "easy", cols: 9, rows: 9, mines, revealed, flags: [], elapsed: 0, phase: "playing" } });
  await page.goto(URL);
  expect(await openCount(page)).toBe(63);
  await expect(cell(page, 54)).toHaveText("1");
  // Right-click flags (context menu suppressed); clicking a satisfied number chords.
  await cell(page, 63).click({ button: "right" });
  await expect(page.locator("#mines-left")).toHaveText("9");
  await cell(page, 54).click();
  await expect(cell(page, 64)).toHaveClass(/is-open/);
  await expect(cell(page, 64)).toHaveText("4");
  // Mode toggle: clicking flags instead of opening.
  await page.locator("#mode").click();
  await expect(page.locator("#mode")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#mode")).toHaveText("Chế độ: Cắm cờ");
  await cell(page, 65).click();
  await cell(page, 72).click();
  await expect(cell(page, 72)).toHaveClass(/is-flag/);
  await page.locator("#mode").click();
  await expect(page.locator("#mode")).toHaveText("Chế độ: Mở ô");
  // 64 is a 4: flags on 63, 65, 72 and a WRONG one on 74 → chording opens 73, a mine.
  await cell(page, 74).click({ button: "right" });
  await expect(page.locator("#mines-left")).toHaveText("6");
  await cell(page, 64).click();
  await expect(page.locator("#mine-overlay")).toBeVisible();
  await expect(page.locator("#mine-overlay h2")).toHaveText("Trúng mìn!");
  await page.locator("#mine-view").click();
  await expect(page.locator("#mine-overlay")).toBeHidden();
  await expect(cell(page, 73)).toHaveClass(/is-exploded/);
  await expect(cell(page, 73)).toHaveAttribute("aria-label", /mìn đã nổ$/);
  await expect(cell(page, 74)).toHaveClass(/is-wrong/);
  await expect(cell(page, 74)).toHaveAttribute("aria-label", /cờ sai/);
  await expect(page.locator(".mine-cell.is-mine")).toHaveCount(6);
  expect((await saved(page)).current).toBeNull();
  // Any board press brings the result back; "Chơi lại" starts fresh.
  await cell(page, 0).click();
  await expect(page.locator("#mine-overlay")).toBeVisible();
  await page.locator("#mine-primary").click();
  expect(await openCount(page)).toBe(0);
  await expect(page.locator("#timer")).toHaveText("0:00");
  await expect(page.locator("#mines-left")).toHaveText("10");
});

test("Dò mìn win records wins and best time; save survives reload", async ({ page }) => {
  await seed(page, { version: 1, bestScore: 2, best: { easy: 99 }, level: "easy", current: nearlyWon() });
  await page.goto(URL);
  await expect(page.locator("#best-time")).toHaveText("1:39");
  await expect(page.locator("#timer")).toHaveText("0:41");
  expect(await openCount(page)).toBe(70);
  // Restored game waits: the clock does not run before the next move.
  await page.waitForTimeout(1200);
  await expect(page.locator("#timer")).toHaveText("0:41");
  await cell(page, 80).click();
  await expect(page.locator("#mine-overlay h2")).toHaveText("Thắng rồi!");
  await expect(page.locator("#mine-overlay p")).toContainText("Kỷ lục mới");
  await expect(page.locator("#mines-left")).toHaveText("0");
  await expect(page.locator(".mine-cell.is-flag")).toHaveCount(10);
  const record = await saved(page);
  expect(record.bestScore).toBe(3);
  expect(record.best.easy).toBe(41);
  expect(record.current).toBeNull();
  await expect(page.locator("#mine-primary")).toBeFocused();
});

test("Dò mìn in-progress game is saved and resumed after reload", async ({ page }) => {
  await page.goto(URL);
  await cell(page, 40).click();
  const hidden = Number(await page.locator(".mine-cell:not(.is-open)").first().getAttribute("data-i"));
  await cell(page, hidden).click({ button: "right" });
  const open = await openCount(page);
  const before = await saved(page);
  expect(before.current.phase).toBe("playing");
  expect(before.current.mines).toHaveLength(10);
  await page.reload();
  expect(await openCount(page)).toBe(open);
  await expect(cell(page, hidden)).toHaveClass(/is-flag/);
  await expect(page.locator("#mines-left")).toHaveText("9");
  // Corrupt saves fall back to a fresh board.
  const corrupt = { ...before, current: { ...before.current, mines: [0, 0, 0] } };
  const fresh = await page.context().newPage();
  await seed(fresh, corrupt);
  await page.close();
  await fresh.goto(URL);
  expect(await openCount(fresh)).toBe(0);
  await expect(fresh.locator("#mines-left")).toHaveText("10");
});

test("Dò mìn level change asks inside the menu only when a game is in progress", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto(URL);
  // No game yet: switching applies immediately.
  await page.locator("#game-menu-toggle").click();
  await page.locator("[data-level='medium']").click();
  await expect(page.locator("#game-menu")).toBeHidden();
  await expect(page.locator(".mine-cell")).toHaveCount(256);
  await cell(page, 100).click();
  await page.locator("#game-menu-toggle").click();
  await page.locator("[data-level='hard']").click();
  await expect(page.locator("#level-confirm")).toBeVisible();
  await expect(page.locator("#level-confirm-yes")).toBeFocused();
  await page.locator("#level-confirm-no").click();
  await expect(page.locator("#level-confirm")).toBeHidden();
  await expect(page.locator(".mine-cell")).toHaveCount(256);
  await page.locator("[data-level='hard']").click();
  await page.locator("#level-confirm-yes").click();
  await expect(page.locator("#game-menu")).toBeHidden();
  await expect(page.locator(".mine-cell")).toHaveCount(480);
  await expect(page.locator("#mine-grid")).toHaveCSS("--cols", "30");
  await expect(page.locator("#mines-left")).toHaveText("99");
  expect((await saved(page)).level).toBe("hard");
});

test("Dò mìn touch: tap reveals, long press flags without revealing", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  const errors = watchErrors(page);
  await page.goto(URL);
  await page.locator("[data-level]").first().waitFor({ state: "attached" });
  await cell(page, 40).tap();
  expect(await openCount(page)).toBeGreaterThanOrEqual(9);
  const target = cell(page, Number(await page.locator(".mine-cell:not(.is-open)").first().getAttribute("data-i")));
  const box = await target.boundingBox();
  const cdp = await context.newCDPSession(page);
  const point = [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point });
  await page.waitForTimeout(150);
  await expect(target).toHaveClass(/is-holding/);
  await page.waitForTimeout(400);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(target).toHaveClass(/is-flag/);
  await expect(target).not.toHaveClass(/is-open/);
  await expect(page.locator("#mines-left")).toHaveText("9");
  // Long-pressing the flag again removes it, and the release must not open the cell.
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point });
  await page.waitForTimeout(550);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(100);
  await expect(target).not.toHaveClass(/is-flag/);
  await expect(target).not.toHaveClass(/is-open/);
  await expect(page.locator("#mines-left")).toHaveText("10");
  // Flag mode: tap flags.
  await page.locator("#mode").tap();
  const other = cell(page, Number(await page.locator(".mine-cell:not(.is-open):not(.is-flag)").first().getAttribute("data-i")));
  await other.tap();
  await expect(other).toHaveClass(/is-flag/);
  expect(errors).toEqual([]);
  await context.close();
});

for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1366, 768], [1920, 1080]]) {
  test(`Dò mìn fits ${width}x${height} without page overflow`, async ({ browser }) => {
    const touch = width < 900;
    const context = await browser.newContext({ hasTouch: touch, isMobile: touch, viewport: { width, height } });
    const page = await context.newPage();
    await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
    await page.goto(URL);
    await expect(page.locator(".mine-cell")).toHaveCount(81);
    const info = await page.evaluate(() => {
      const rect = (s) => document.querySelector(s).getBoundingClientRect();
      const board = rect(".play-board"), stage = rect(".play-stage"), cellBox = rect(".mine-cell"), mode = rect("#mode");
      return { overflowX: document.documentElement.scrollWidth > innerWidth, overflowY: document.documentElement.scrollHeight > innerHeight,
        inside: board.left >= stage.left - 1 && board.right <= stage.right + 1 && board.top >= stage.top - 1 && board.bottom <= stage.bottom + 1 && board.bottom <= innerHeight,
        cell: cellBox.width, mode: [mode.height, mode.bottom <= innerHeight] };
    });
    expect(info.overflowX).toBe(false);
    expect(info.overflowY).toBe(false);
    expect(info.inside).toBe(true);
    expect(info.cell).toBeGreaterThanOrEqual(22);
    expect(info.mode[0]).toBeGreaterThanOrEqual(44);
    expect(info.mode[1]).toBe(true);
    // Khó keeps cells usable (≥16px; scroll inside the stage when needed) and stands up on portrait screens.
    await page.locator("#game-menu-toggle").click();
    await page.locator("[data-level='hard']").click();
    const hard = await page.evaluate(() => ({ cols: getComputedStyle(document.querySelector("#mine-grid")).getPropertyValue("--cols").trim(),
      cell: document.querySelector(".mine-cell").getBoundingClientRect().width, overflowX: document.documentElement.scrollWidth > innerWidth }));
    expect(hard.cols).toBe(height > width ? "16" : "30");
    expect(hard.cell).toBeGreaterThanOrEqual(15.9);
    expect(hard.overflowX).toBe(false);
    await context.close();
  });
}
