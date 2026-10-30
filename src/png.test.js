import { expect, test } from "vitest";
import { openOutput, pngWriter } from "./png.js";

test("streamed PNG decodes to the exact pixels", async () => {
  const [width, height] = [37, 29];
  const rgb = new Uint8Array(width * height * 3).map(() => Math.random() * 256);

  const output = await openOutput("png-test.png");
  const png = pngWriter(output.sink, width, height);
  for (const [start, end] of [[0, 10], [10, 11], [11, height]]) {
    await png.write(rgb.subarray(start * width * 3, end * width * 3));
  }
  await png.close();

  const bitmap = await createImageBitmap(await output.file(), { colorSpaceConversion: "none" });
  const ctx = new OffscreenCanvas(width, height).getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const decoded = Uint8Array.from(rgb.keys(), (i) => rgba[Math.floor(i / 3) * 4 + (i % 3)]);

  expect([bitmap.width, bitmap.height]).toEqual([width, height]);
  expect(decoded).toEqual(rgb);
});
