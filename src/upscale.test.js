import { describe, expect, test } from "vitest";
import { upscaleStrips } from "./upscale.js";

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

async function upscaleAll(bitmap, scale, options) {
  const width = bitmap.width * scale;
  const rgb = new Uint8ClampedArray(width * bitmap.height * scale * 3);
  for await (const strip of upscaleStrips(bitmap, scale, options)) rgb.set(strip.data, strip.y * width * 3);
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
  test.for([4, 2].flatMap((scale) => SIZES.map(([w, h]) => [scale, w, h])))(
    "x%i %ix%i",
    async ([scale, width, height], { skip }) => {
      const adapter = backend === "webgpu" ? await navigator.gpu?.requestAdapter() : null;
      if (backend === "webgpu" && !adapter) skip("no WebGPU adapter");
      // Software WebGPU (SwiftShader in headless Chromium) is too slow to test with, and the app avoids it too.
      if (backend === "webgpu" && adapter.info?.isFallbackAdapter) skip("software WebGPU adapter");
      if (precision === "fp16" && !adapter.features.has("shader-f16")) skip("no shader-f16");

      const image = await upscaleAll(await quadrantImage(width, height), scale, {
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

// Two tiles, each as wide as the padding needs, so the seam gets full padding on both sides and tiling should
// match a single pass. Every tile is read at tile + 2 * pad square, so the single pass is 224 px at 4x and 448 px at 2x.
test.for([
  [4, 128],
  [2, 256],
])("x%i tiled black/white checkerboard matches a single pass", async ([scale, width]) => {
  const bitmap = await checkerboard(width, 32, 7);
  const options = { backend: "wasm" };
  const whole = await upscaleAll(bitmap, scale, { ...options, tile: width });
  const tiled = await upscaleAll(bitmap, scale, { ...options, tile: width / 2 });

  let sum = 0;
  let max = 0;
  whole.rgb.forEach((value, i) => {
    const diff = Math.abs(value - tiled.rgb[i]);
    sum += diff;
    max = Math.max(max, diff);
  });
  expect(sum / whole.rgb.length).toBeLessThan(1);
  expect(max).toBeLessThan(32);
});
