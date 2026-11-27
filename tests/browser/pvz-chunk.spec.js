const { test, expect } = require("@playwright/test");

test("PvZ assembles a chunked main.pak before engine startup", async ({ page }) => {
  await page.route("**/engine/pvz-portable.js", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `
      window.written = [];
      Module.FS = {
        mkdir() {},
        writeFile(name, bytes) { window.written.push([name, bytes.length]); },
        lookupPath() { return { node: { mounted: true } }; },
        syncfs(populate, callback) { callback(); },
      };
      Module.callMain = () => { window.fixtureStarted = true; };
      Module.onRuntimeInitialized();
    `,
  }));
  await page.route("**/vendor/**", (route) => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.route("**/resources.json", (route) => route.fulfill({
    json: {
      version: 1,
      revision: "chunked",
      files: [{ name: "properties/partner.xml" }],
      mainPak: {
        size: 18,
        parts: [{ name: "main.pak.001", size: 11 }, { name: "main.pak.002", size: 7 }],
      },
    },
  }));
  await page.route("**/pvz-goty/data/properties/partner.xml", (route) => route.fulfill({ body: "<xml/>" }));
  await page.route("**/pvz-goty/data/main.pak.001", (route) => route.fulfill({ body: "a".repeat(11) }));
  await page.route("**/pvz-goty/data/main.pak.002", (route) => route.fulfill({ body: "b".repeat(7) }));

  await page.goto("/games/pvz-goty/");
  await expect.poll(() => page.evaluate(() => window.fixtureStarted)).toBe(true);
  await page.evaluate(() => window.resizeCanvas());

  const written = await page.evaluate(() => window.written);
  const main = written.find(([name]) => name === "/main.pak");
  expect(main).toEqual(["/main.pak", 18]);
  expect(written.some(([name]) => name.includes("main.pak."))).toBe(false);
  expect(written.some(([name]) => name === "/properties/partner.xml")).toBe(true);

  const layout = await page.evaluate(() => {
    const display = document.querySelector(".pvz-display").getBoundingClientRect();
    const canvas = document.querySelector("#canvas").getBoundingClientRect();
    return {
      display: display.width / display.height,
      canvas: canvas.width / canvas.height,
      wider: canvas.width > display.width + 1,
      centered: Math.abs(canvas.x + canvas.width / 2 - (display.x + display.width / 2)) < 2,
    };
  });
  expect(layout.display).toBeCloseTo(4 / 3, 1);
  expect(layout.canvas).toBeCloseTo(16 / 9, 1);
  expect(layout.wider).toBe(true);
  expect(layout.centered).toBe(true);
});
