import * as ort from "onnxruntime-web/webgpu";
import { detectPlatform } from "./platform.js";

// Each tile reads `pad` pixels of context past its edges. Real-ESRGAN's default of 10 leaves visible
// seams on fine detail. x2plus pixel-unshuffles its input onto a half-resolution grid, so it needs twice
// the tile and padding for the same memory and context, and tile sides must be multiples of 4.
// ponytail: x2 pad 96 still leaves ~2 levels mean error on random 3px noise; 128 removes it at ~1.3x the cost.
const TILING = {
  4: { tile: 128, pad: 48, multiple: 1 },
  2: { tile: 256, pad: 96, multiple: 4 },
};

let current = { key: null, session: null };
let lastRun = Promise.resolve();

// WASM inference can finish without ever leaving the current task, so without this the page could
// neither show progress nor react to input until a whole image is done. React schedules its renders
// as MessageChannel tasks too, so this resumes only after the pending progress update has rendered
// (scheduler.yield() would jump ahead of it). Unlike setTimeout, it isn't throttled in background tabs.
function yieldToPage() {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = resolve;
    channel.port2.postMessage(null);
  });
}

const modelUrl = (scale, precision) =>
  `${import.meta.env.BASE_URL}esrgan_x${scale}${precision === "fp16" ? "_fp16" : ""}.onnx`;

async function createSession(scale, backend, precision) {
  const t0 = performance.now();
  // The default "bucket" cache rounds buffers up to size buckets and keeps them per bucket; with every tile
  // the same shape, "simple" reuses exact-size buffers and holds GPU memory at one tile's worth.
  const provider = backend === "webgpu" ? { name: backend, storageBufferCacheMode: "simple" } : backend;
  const session = await ort.InferenceSession.create(modelUrl(scale, precision), { executionProviders: [provider] });
  console.info(`Loaded the ${scale}× ${precision} model on ${backend} in ${Math.round(performance.now() - t0)} ms`);
  return session;
}

// `forced` ({ backend, precision }) skips detection; tests use it to pin a path. Otherwise the detected
// path is used, falling back to WASM with fp32 if the GPU session can't be created.
// Only one model is held at a time: switching releases the previous session, once its last tile has
// finished, before the next one loads, so two models never hold memory together.
export function loadSession(scale, forced) {
  const key = forced ? `${scale}:${forced.backend}:${forced.precision}` : `${scale}`;
  if (current.key === key) return current.session;
  const released = (current.session ?? Promise.resolve()).then(
    async (session) => {
      await lastRun;
      await session?.release();
    },
    () => {},
  );
  const session = released.then(() =>
    forced
      ? createSession(scale, forced.backend, forced.precision)
      : detectPlatform().then(async ({ backend, precision }) => {
          try {
            return await createSession(scale, backend, precision);
          } catch (err) {
            if (backend === "wasm") throw err;
            console.warn(`Could not load the ${scale}× ${precision} model on ${backend}; using WASM: ${err?.message ?? err}`);
            return createSession(scale, "wasm", "fp32");
          }
        }),
  );
  current = { key, session };
  return session;
}

function toTensor(imageData) {
  const { data, width, height } = imageData;
  const plane = width * height;
  const chw = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    chw[i] = data[i * 4] / 255;
    chw[plane + i] = data[i * 4 + 1] / 255;
    chw[2 * plane + i] = data[i * 4 + 2] / 255;
  }
  return new ort.Tensor("float32", chw, [1, 3, height, width]);
}

// Reads one tile, repeating the last row/column where it extends past the image:
// zero padding visibly darkens edges.
function readTile(bitmap, x0, y0, tw, th) {
  const ctx = new OffscreenCanvas(tw, th).getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  const cw = Math.min(tw, bitmap.width - x0);
  const ch = Math.min(th, bitmap.height - y0);
  ctx.drawImage(bitmap, x0, y0, cw, ch, 0, 0, cw, ch);
  ctx.drawImage(bitmap, x0 + cw - 1, y0, 1, ch, cw, 0, tw - cw, ch);
  ctx.drawImage(bitmap, x0, y0 + ch - 1, cw, 1, 0, ch, cw, th - ch);
  ctx.drawImage(bitmap, x0 + cw - 1, y0 + ch - 1, 1, 1, cw, ch, tw - cw, th - ch);
  return ctx.getImageData(0, 0, tw, th);
}

// Yields the output one row of tiles at a time as packed RGB, so memory stays bounded by
// output width x tile height regardless of image size. Overlapping padding hides seams.
// Every tile is read at the full padded size, extending past the image edge where needed, so the
// model always sees one input shape and the GPU buffer cache never holds buffers for other shapes.
export async function* upscaleStrips(
  bitmap,
  scale,
  {
    signal,
    onTile = () => {},
    backend,
    precision = "fp32",
    tile = TILING[scale].tile,
    pad = TILING[scale].pad,
  } = {},
) {
  const session = await loadSession(scale, backend && { backend, precision });
  const { multiple } = TILING[scale];
  const { width, height } = bitmap;
  const outWidth = width * scale;
  const size = Math.ceil((tile + 2 * pad) / multiple) * multiple;
  const total = Math.ceil(width / tile) * Math.ceil(height / tile);
  let done = 0;

  for (let y = 0; y < height; y += tile) {
    const rows = Math.min(tile, height - y) * scale;
    const strip = new Uint8ClampedArray(outWidth * rows * 3);

    for (let x = 0; x < width; x += tile) {
      signal?.throwIfAborted();
      const x0 = Math.max(x - pad, 0);
      const y0 = Math.max(y - pad, 0);

      const run = session.run({ input: toTensor(readTile(bitmap, x0, y0, size, size)) });
      lastRun = run.catch(() => {});
      const { output } = await run;
      const [, , outTileHeight, outTileWidth] = output.dims;
      const plane = outTileHeight * outTileWidth;
      const chw = output.data;
      const cols = Math.min(tile, width - x) * scale;
      const sx = (x - x0) * scale;
      const sy = (y - y0) * scale;
      for (let r = 0; r < rows; r++) {
        let src = (sy + r) * outTileWidth + sx;
        let dst = (r * outWidth + x * scale) * 3;
        for (let c = 0; c < cols; c++, src++, dst += 3) {
          strip[dst] = chw[src] * 255;
          strip[dst + 1] = chw[plane + src] * 255;
          strip[dst + 2] = chw[2 * plane + src] * 255;
        }
      }
      onTile(++done, total);
      await yieldToPage();
    }

    yield { data: strip, y: y * scale, rows };
  }
}
