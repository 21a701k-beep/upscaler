import { describe, expect, test } from "vitest";
import { MODELS, upscaleStrips } from "./upscale.js";

const QUADRANTS = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
];

function quadrantImage(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const quadrant = (y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1);
      data.set([...QUADRANTS[quadrant], 255], (y * width + x) * 4);
    }
  }
  return createImageBitmap(new ImageData(data, width, height));
}

async function upscaleAll(bitmap, model, options) {
  const { scale } = MODELS[model];
  const width = bitmap.width * scale;
  const rgb = new Uint8ClampedArray(width * bitmap.height * scale * 3);
  for await (const strip of upscaleStrips(bitmap, model, options)) rgb.set(strip.data, strip.y * width * 3);
  return { rgb, width, height: bitmap.height * scale };
}

function pixelAt({ rgb, width }, x, y) {
  const i = (Math.floor(y) * width + Math.floor(x)) * 3;
  return [...rgb.subarray(i, i + 3)];
}

function expectClose(actual, expected) {
  actual.forEach((value, i) => expect(Math.abs(value - expected[i])).toBeLessThan(40));
}

// tile=32 and pad=8 keep cases small enough for single-threaded WASM while still exercising multiple tiles;
// the checkerboard tests below use the real padding.
const SIZES = [
  [24, 24],
  [70, 45],
  [33, 17],
];

describe.each([
  ["wasm", "fp32"],
  ["webgpu", "fp32"],
  ["webgpu", "fp16"],
])("%s %s", (backend, precision) => {
  test.for(Object.keys(MODELS).flatMap((model) => SIZES.map(([w, h]) => [model, w, h])))(
    "%s %ix%i",
    async ([model, width, height], { skip }) => {
      const adapter = backend === "webgpu" ? await navigator.gpu?.requestAdapter() : null;
      if (backend === "webgpu" && !adapter) skip("no WebGPU adapter");
      // Software WebGPU (SwiftShader in headless Chromium) is too slow to test with, and the app avoids it too.
      if (backend === "webgpu" && adapter.info?.isFallbackAdapter) skip("software WebGPU adapter");
      if (precision === "fp16" && !adapter.features.has("shader-f16")) skip("no shader-f16");

      const { scale } = MODELS[model];
      const image = await upscaleAll(await quadrantImage(width, height), model, {
        backend,
        precision,
        tile: 32,
        pad: 8,
      });

      expect([image.width, image.height]).toEqual([width * scale, height * scale]);
      const [W, H] = [image.width, image.height];
      expectClose(pixelAt(image, W / 4, H / 4), QUADRANTS[0]);
      expectClose(pixelAt(image, (3 * W) / 4, H / 4), QUADRANTS[1]);
      expectClose(pixelAt(image, W / 4, (3 * H) / 4), QUADRANTS[2]);
      expectClose(pixelAt(image, (3 * W) / 4, (3 * H) / 4), QUADRANTS[3]);
      // Even unpadded, x2plus tints the outermost output pixel, so sample just inside it.
      expectClose(pixelAt(image, W - 2 * scale, H - 2 * scale), QUADRANTS[3]);
    },
  );
});

function checkerboard(width, height, square) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = (Math.floor(x / square) + Math.floor(y / square)) % 2 ? 0 : 255;
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
  }
  return createImageBitmap(new ImageData(data, width, height));
}

// A checkerboard one model tile wide, upscaled as a single tile and as two half tiles with the model's padding,
// so the seam between them gets full padding on both sides, as every seam in a real image does.
async function seamError(model, options) {
  const { tile } = MODELS[model];
  const bitmap = await checkerboard(tile, 32, 7);
  const whole = await upscaleAll(bitmap, model, { backend: "wasm", tile });
  const tiled = await upscaleAll(bitmap, model, { backend: "wasm", tile: tile / 2, ...options });
  let sum = 0;
  let max = 0;
  whole.rgb.forEach((value, i) => {
    const diff = Math.abs(value - tiled.rgb[i]);
    sum += diff;
    max = Math.max(max, diff);
  });
  return { mean: sum / whole.rgb.length, max };
}

// Mean and largest difference allowed, in levels. Compact's padding covers all the input its output sees, so its
// tiles must match a single pass up to rounding; the full models see further than their padding, so their seams
// only need to stay invisible.
const SEAM_LIMITS = {
  compact: { mean: 0.01, max: 1 },
  x2plus: { mean: 1, max: 31 },
  x4plus: { mean: 1, max: 31 },
};

test.for(Object.entries(SEAM_LIMITS))("%s tiled black/white checkerboard matches a single pass", async ([model, limit]) => {
  const { mean, max } = await seamError(model);
  expect(mean).toBeLessThan(limit.mean);
  expect(max).toBeLessThanOrEqual(limit.max);
});

// Shows the test above can fail: with Real-ESRGAN's default padding of 10, short of compact's 34, the seam shows.
test("compact checkerboard shows a seam with too little padding", async () => {
  const { max } = await seamError("compact", { pad: 10 });
  expect(max).toBeGreaterThan(SEAM_LIMITS.compact.max);
});
