const { test, expect } = require("@playwright/test");
const fs = require("node:fs");

test("migrate page exports and imports localStorage saves", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("may-game:v1:tetris", JSON.stringify({ version: 1, bestScore: 42 }));
    localStorage.setItem("may-game:v1:snake", JSON.stringify({ version: 1, bestScore: 7 }));
    localStorage.setItem("may-game:v1:pvz-goty", JSON.stringify({ version: 1, current: { phase: "saved" } }));
  });
  await page.goto("/migrate.html");
  await expect(page.locator("#save-count")).toContainText("2 game");
  await expect(page.locator("#save-export")).toBeEnabled();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#save-export").click(),
  ]);
  const backup = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  expect(Object.keys(backup.records).sort()).toEqual(["may-game:v1:snake", "may-game:v1:tetris"]);

  await page.evaluate(() => localStorage.clear());
  await page.goto("/migrate.html");
  await expect(page.locator("#save-count")).toContainText("Chưa có dữ liệu");
  page.on("dialog", (dialog) => dialog.accept());
  await page.setInputFiles("#save-import-input", {
    name: "saves.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.locator("#save-import-summary")).toContainText("2 game");
  await expect(page.locator("#save-import-button")).toBeEnabled();
  await page.locator("#save-import-button").click();
  await expect(page.locator("#save-import-status")).toContainText("Đã nhập 2 game");
  await expect(page.locator("#save-reload")).toBeVisible();

  const restored = await page.evaluate(() => ({
    tetris: localStorage.getItem("may-game:v1:tetris"),
    snake: localStorage.getItem("may-game:v1:snake"),
    pvz: localStorage.getItem("may-game:v1:pvz-goty"),
  }));
  expect(JSON.parse(restored.tetris).bestScore).toBe(42);
  expect(JSON.parse(restored.snake).bestScore).toBe(7);
  expect(restored.pvz).toBeNull();
});
