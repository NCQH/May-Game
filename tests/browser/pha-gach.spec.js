const { test, expect } = require("@playwright/test");

const KEY = "may-game:v1:pha-gach";
const URL = "/games/pha-gach/";
const seed = (page, record) => page.addInitScript(([key, value]) => {
  if (!sessionStorage.seeded) { localStorage.setItem(key, value); sessionStorage.seeded = 1; }
}, [KEY, JSON.stringify(record)]);
const game = (page) => page.evaluate(() => {
  const s = PhaGach.state;
  return { phase: s.phase, paddle: s.paddle.x, stuck: s.ball.stuck, vy: s.ball.vy, score: s.score, lives: s.lives, level: s.level };
});

test.beforeEach(async ({ page }) => {
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
});

test("Phá gạch plays with the keyboard, pauses with the menu and resumes after reload", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("ERR_FAILED")) errors.push(message.text()); });
  await page.goto(URL);
  await expect(page.locator("#pha-gach-overlay h2")).toHaveText("Sẵn sàng");
  await expect(page.locator(".pha-gach-move")).toBeHidden();
  await page.locator("#pha-gach-board").focus();
  await page.keyboard.press("Space");
  await expect(page.locator("#pha-gach-overlay")).toBeHidden();
  expect((await game(page)).stuck).toBe(false);
  // Held arrow keys move the paddle smoothly; releasing stops it.
  const before = (await game(page)).paddle;
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(250);
  await page.keyboard.up("ArrowLeft");
  const moved = (await game(page)).paddle;
  expect(moved).toBeLessThan(before - 40);
  await page.waitForTimeout(100);
  expect((await game(page)).paddle).toBe(moved);
  await expect(page.locator("#score")).not.toHaveText("0", { timeout: 6000 });

  // Esc opens the menu and pauses; closing keeps the paused overlay.
  await page.keyboard.press("Escape");
  await expect(page.locator("#game-menu")).toBeVisible();
  expect((await game(page)).phase).toBe("paused");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await expect(page.locator("#game-menu")).toBeHidden();
  await expect(page.locator("#pha-gach-overlay h2")).toHaveText("Tạm dừng");
  const paused = await game(page);
  await page.waitForTimeout(200);
  expect(await game(page)).toEqual(paused);

  const record = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), KEY);
  expect(record.current).toMatchObject({ level: 1, phase: "paused", score: paused.score, lives: paused.lives });
  expect(record.current.bricks).toHaveLength(120);
  await page.reload();
  await expect(page.locator("#pha-gach-overlay h2")).toHaveText("Tạm dừng");
  await expect(page.locator("#score")).toHaveText(String(paused.score));
  const resumed = await game(page);
  expect(resumed.stuck).toBe(true);
  expect(resumed.paddle).toBe(240);
  await page.locator("#pha-gach-board").focus();
  await page.keyboard.press("p");
  await expect(page.locator("#pha-gach-overlay")).toBeHidden();
  expect(errors).toEqual([]);
});

test("Phá gạch ignores invalid saves, ends at zero lives and advances levels", async ({ page }) => {
  await seed(page, { version: 1, bestScore: 50, muted: true, current: { level: 1, score: 10, lives: 3, bricks: [1, 2, 3], phase: "paused" } });
  await page.goto(URL);
  await expect(page.locator("#pha-gach-overlay h2")).toHaveText("Sẵn sàng");
  await expect(page.locator("#best")).toHaveText("50");
  await page.locator("#pha-gach-primary").click();
  // Drop the last life by sending the ball off the bottom.
  await page.evaluate(() => { const s = PhaGach.state; s.lives = 1; Object.assign(s.ball, { stuck: false, x: 20, y: 630, vx: 0, vy: 400 }); PhaGach.state.paddle.x = 400; });
  await expect(page.locator("#pha-gach-overlay h2")).toHaveText("Hết ván");
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).current, KEY)).toBeNull();
  await page.locator("#pha-gach-primary").click();
  await expect(page.locator("#lives")).toHaveText("3");
  // Clear the level: one brick left, ball heading straight at it.
  await page.evaluate(() => {
    const s = PhaGach.state; s.bricks = s.bricks.map((v, i) => (i === 30 ? 1 : 0));
    Object.assign(s.ball, { stuck: false, x: 24 + 6 * 36 + 18, y: 300, vx: 0, vy: -400 });
  });
  await expect(page.locator("#pha-gach-overlay h2")).toHaveText("Qua màn 1");
  await expect(page.locator("#pha-gach-overlay .play-overlay-actions")).toBeHidden();
  await expect(page.locator("#level")).toHaveText("2", { timeout: 3000 });
  await expect(page.locator("#pha-gach-overlay")).toBeHidden();
  expect((await game(page)).stuck).toBe(true);
});

test("Phá gạch works with touch: drag, tap to launch and hold buttons", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.goto(URL);
  const left = page.locator('.pha-gach-move [data-move="left"]');
  await expect(left).toBeVisible();
  const size = await left.boundingBox();
  expect(Math.min(size.width, size.height)).toBeGreaterThanOrEqual(52);
  await page.locator("#pha-gach-primary").tap();
  await expect(page.locator("#pha-gach-overlay")).toBeHidden();
  // Lose the ball on purpose so it is stuck again, then drag and tap.
  await page.evaluate(() => Object.assign(PhaGach.state.ball, { x: 10, y: 630, vx: 0, vy: 400 }));
  await expect(page.locator("#lives")).toHaveText("2");
  const board = page.locator("#pha-gach-board");
  const box = await board.boundingBox();
  const at = (fx) => ({ clientX: box.x + box.width * fx, clientY: box.y + box.height * .8, pointerId: 7, pointerType: "touch", isPrimary: true });
  await board.dispatchEvent("pointerdown", at(.5));
  await board.dispatchEvent("pointermove", at(.7));
  await board.dispatchEvent("pointermove", at(.85));
  await board.dispatchEvent("pointerup", at(.85));
  let state = await game(page);
  expect(state.paddle).toBeCloseTo(480 * .85, 0);
  expect(state.stuck).toBe(true);
  await board.tap({ position: { x: box.width * .5, y: box.height * .5 } });
  state = await game(page);
  expect(state.stuck).toBe(false);
  expect(state.vy).toBeLessThan(0);
  // Hold-to-move button.
  const start = state.paddle;
  await left.dispatchEvent("pointerdown", { pointerId: 9, pointerType: "touch", isPrimary: true });
  await page.waitForTimeout(250);
  await left.dispatchEvent("pointerup", { pointerId: 9, pointerType: "touch", isPrimary: true });
  expect((await game(page)).paddle).toBeLessThan(start - 40);
  // Native keyboard and assistive activations move the visible button without a pointer hold.
  const beforeKeyboard = (await game(page)).paddle;
  await left.focus();
  await page.keyboard.press('Enter');
  expect((await game(page)).paddle).toBeLessThan(beforeKeyboard);
  const beforeAssistive = (await game(page)).paddle;
  await left.evaluate(button => button.click());
  expect((await game(page)).paddle).toBeLessThan(beforeAssistive);
  // Menu pauses and blocks the hold buttons.
  await page.locator("#game-menu-toggle").tap();
  await expect(page.locator("#game-menu")).toBeVisible();
  expect((await game(page)).phase).toBe("paused");
  await page.locator("[data-menu-close]").tap();
  await expect(page.locator("#pha-gach-overlay h2")).toHaveText("Tạm dừng");
  await page.locator("#pha-gach-primary").tap();
  expect((await game(page)).phase).toBe("playing");
  await context.close();
});

test("Phá gạch fits phone, landscape and desktop screens", async ({ browser }) => {
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1366, 768], [1920, 1080]]) {
    const touch = width < 900;
    const context = await browser.newContext({ hasTouch: touch, isMobile: touch, viewport: { width, height } });
    const page = await context.newPage();
    await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
    await page.goto(URL);
    const board = await page.locator(".play-board").boundingBox();
    expect(board.width).toBeGreaterThan(160);
    expect(Math.abs(board.width / board.height - .75)).toBeLessThan(.02);
    expect(board.x).toBeGreaterThanOrEqual(0);
    expect(board.y + board.height).toBeLessThanOrEqual(height);
    expect(await page.evaluate(() => [document.documentElement.scrollWidth > innerWidth, document.documentElement.scrollHeight > innerHeight])).toEqual([false, false]);
    const primary = await page.locator("#pha-gach-primary").boundingBox();
    expect(primary.y + primary.height).toBeLessThanOrEqual(board.y + board.height);
    if (touch) {
      for (const button of await page.locator(".pha-gach-move button").all()) {
        const b = await button.boundingBox();
        expect(b.y + b.height).toBeLessThanOrEqual(height);
        expect(b.x + b.width).toBeLessThanOrEqual(width);
      }
    }
    await context.close();
  }
});
