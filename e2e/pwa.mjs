// Builds the app and serves it as GitLab Pages does, without headers, then checks in each browser that the
// service worker makes it cross-origin isolated, that it loads nothing from other sites (a font or CDN script
// there would not work offline), and that after one upscale it upscales again offline. Analytics and Sentry
// are off, as their CI/CD variables are unset. Needs the models in public/ (see export.py).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, firefox, webkit } from "playwright";
import { build, preview } from "vite";

const image = new URL("../src/fixtures/adobe-rgb.png", import.meta.url).pathname;
let server;
let url;

before(async () => {
  await build({ logLevel: "warn" });
  server = await preview({ logLevel: "warn" });
  url = server.resolvedUrls.local[0];
});

after(() => server?.close());

async function upscale(page) {
  await page.setInputFiles('input[type="file"]', image);
  await page.getByRole("button", { name: "Download image" }).waitFor({ timeout: 120_000 });
}

for (const engine of [chromium, firefox, webkit]) {
  test(`${engine.name()}: isolated, self-contained, and works offline`, { timeout: 300_000 }, async () => {
    const browser = await engine.launch();
    try {
      const context = await browser.newContext();
      const foreign = [];
      context.on("request", (request) => {
        const { protocol, origin } = new URL(request.url());
        if (protocol.startsWith("http") && origin !== new URL(url).origin) foreign.push(request.url());
      });
      const page = await context.newPage();
      // WASM, the path isolation speeds up, and the same on every machine.
      await page.goto(`${url}?backend=wasm`);
      await page.waitForFunction(() => crossOriginIsolated, null, { timeout: 30_000 });
      await upscale(page);
      assert.deepEqual(foreign, [], "requests to other origins");

      await context.setOffline(true);
      const failed = [];
      // Not the worker's own network try for the page, which falls back to the cached copy.
      context.on("requestfailed", (request) => request.serviceWorker() || failed.push(request.url()));
      await page.reload();
      assert.equal(await page.evaluate(() => crossOriginIsolated), true, "isolated offline");
      await upscale(page);
      assert.deepEqual(failed, [], "requests that failed offline");
    } finally {
      await browser.close();
    }
  });
}
