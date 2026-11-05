import * as ort from "onnxruntime-web/webgpu";
import { expect, test } from "vitest";
import { processBatch } from "./batch.js";
import jpg from "./fixtures/adobe-rgb.jpg?url";
import png from "./fixtures/adobe-rgb.png?url";
import webp from "./fixtures/adobe-rgb.webp?url";
import { splitProfile } from "./icc.js";
import { detectPlatform } from "./platform.js";

// Small tiles and padding keep every model run tiny: CI runs these on single-threaded WASM.
const OPTIONS = { backend: "wasm", tile: 32, pad: 8 };

async function pngFile(name, width, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#3a7";
  ctx.fillRect(0, 0, width, height);
  return new File([await canvas.convertToBlob({ type: "image/png" })], name, { type: "image/png" });
}

test("a single image comes back as its own PNG", async () => {
  const result = await processBatch([await pngFile("photo.jpeg", 20, 12)], 2, OPTIONS);

  expect(result.name).toBe("photo_x2.png");
  const bitmap = await createImageBitmap(result.blob);
  expect([bitmap.width, bitmap.height]).toEqual([40, 24]);
});

test("several images are zipped, and a broken one is reported without stopping the batch", async () => {
  const broken = new File([new Uint8Array([1, 2, 3])], "broken.png", { type: "image/png" });
  const errors = [];
  const results = [];
  const files = [await pngFile("a.png", 20, 12), broken, await pngFile("b.png", 9, 14)];

  const result = await processBatch(files, 2, {
    ...OPTIONS,
    onError: (name) => errors.push(name),
    onResult: ({ name, width, height }) => results.push([name, width, height]),
  });

  expect(errors).toEqual(["broken_x2.png"]);
  expect(results).toEqual([
    ["a_x2.png", 40, 24],
    ["b_x2.png", 18, 28],
  ]);
  expect(result.name).toBe("upscaled_x2.zip");
  const bytes = new Uint8Array(await result.blob.arrayBuffer());
  const text = new TextDecoder("latin1").decode(bytes);
  expect(text.startsWith("PK\x03\x04")).toBe(true);
  expect(text).toContain("a_x2.png");
  expect(text).toContain("b_x2.png");
  expect(text).not.toContain("broken_x2.png");
});

// 16x16 of Adobe RGB (60, 160, 90), which in sRGB would be about (0, 161, 85).
test.for([jpg, png, webp])("%s keeps its color space and profile", async (url) => {
  const file = new File([await (await fetch(url)).blob()], url.split("/").pop());
  const input = await splitProfile(file);
  expect(input?.profile.length).toBe(560);

  const result = await processBatch([file], 2, OPTIONS);

  const output = await splitProfile(result.blob);
  expect(output?.profile).toEqual(input.profile);
  const bitmap = await createImageBitmap(output.untagged);
  const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  const center = ctx.getImageData(16, 16, 1, 1).data;
  [60, 160, 90].forEach((value, i) => expect(Math.abs(center[i] - value)).toBeLessThan(8));
});

test("an image whose GPU device is lost mid-run is retried on WASM", async ({ skip }) => {
  if ((await detectPlatform()).backend !== "webgpu") skip("this browser doesn't run on WebGPU");
  const file = await pngFile("photo.png", 20, 12);
  // Detected, not forced: loads the WebGPU session.
  await processBatch([file], 2, { tile: 32, pad: 8 });

  (await ort.env.webgpu.device).destroy();
  const errors = [];
  const result = await processBatch([file], 2, { tile: 32, pad: 8, onError: (name, err) => errors.push(err) });

  expect(errors).toEqual([]);
  const bitmap = await createImageBitmap(result.blob);
  expect([bitmap.width, bitmap.height]).toEqual([40, 24]);
});
