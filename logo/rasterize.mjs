// Renders the versions of the mark that have to be PNG: a 32px favicon for browsers without SVG favicons,
// the opaque app icons (180px for Apple, which iOS requires, and 192/512px for the web app manifest), and the
// 1200×630 social preview. Run after generate.py, from the repository root:
//
//   node logo/rasterize.mjs    # writes public/favicon-32.png, apple-touch-icon.png, icon-*.png and og-image.png
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const svg = (name) =>
  readFileSync(new URL(name, import.meta.url), "utf8").replace("<svg ", '<svg width="100%" height="100%" ');

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(name, width, height, body, { transparent = false } = {}) {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><body style="margin: 0">${body}</body>`);
  await page.screenshot({ path: new URL(`../public/${name}`, import.meta.url).pathname, omitBackground: transparent });
  console.log(`wrote public/${name} (${width}×${height})`);
}

await render("favicon-32.png", 32, 32, `<div style="width: 32px; height: 32px">${svg("icon.svg")}</div>`, {
  transparent: true,
});

// The mark on white, inset by `inset` of the side. Maskable icons get more: Android crops them to as little as
// a circle 80% wide, which a square fits in only at under 57% of the side.
const appIcon = (name, side, inset) =>
  render(
    name,
    side,
    side,
    `<div style="box-sizing: border-box; width: ${side}px; height: ${side}px; padding: ${side * inset}px; background: #ffffff">
      ${svg("logo.svg")}
    </div>`,
  );

await appIcon("apple-touch-icon.png", 180, 26 / 180);
await appIcon("icon-192.png", 192, 26 / 180);
await appIcon("icon-512.png", 512, 26 / 180);
await appIcon("icon-maskable-512.png", 512, 0.22);

// The app's light ground and type, as in the identity study's lockup.
await render(
  "og-image.png",
  1200,
  630,
  `<div style="box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 64px;
      width: 1200px; height: 630px; color: #1d1d1f; background: #ececec;
      font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', sans-serif">
    <div style="width: 300px; height: 300px">${svg("logo.svg")}</div>
    <div>
      <div style="font-size: 104px; font-weight: 600; letter-spacing: -0.02em; line-height: 1">Upscaler</div>
      <div style="margin-top: 20px; font-size: 34px; line-height: 1.3; color: #6e6e73">
        Make images 2× or 4× larger,<br />right in your browser.
      </div>
    </div>
  </div>`,
);

await browser.close();
