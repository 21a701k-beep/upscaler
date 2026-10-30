// Streaming RGB8 PNG encoder: rows are filtered, deflated and written as they arrive.

import { iccpData } from "./icc.js";

const OUTPUT_DIR = "outputs";

const CRC_TABLE = [...Array(256).keys()].map((n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const bytes = new Uint8Array(12 + data.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  bytes.set(new TextEncoder().encode(type), 4);
  bytes.set(data, 8);
  view.setUint32(8 + data.length, crc32(bytes.subarray(4, 8 + data.length)));
  return bytes;
}

// `profile` is an RGB ICC profile the pixels are in; without one they are sRGB.
export function pngWriter(sink, width, height, profile) {
  const out = sink.getWriter();
  const deflate = new CompressionStream("deflate");
  const input = deflate.writable.getWriter();
  const stride = width * 3;
  let previousRow = new Uint8Array(stride);

  const header = new Uint8Array(13);
  new DataView(header.buffer).setUint32(0, width);
  new DataView(header.buffer).setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit, RGB, deflate, adaptive filtering, no interlace

  const pumped = (async () => {
    await out.write(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    await out.write(chunk("IHDR", header));
    if (profile) await out.write(chunk("iCCP", await iccpData(profile)));
    const reader = deflate.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await out.write(chunk("IDAT", value));
    }
  })().catch((err) => {
    // Unblock a pending input.write() so the error surfaces instead of deadlocking.
    input.abort(err).catch(() => {});
    throw err;
  });

  return {
    // `rgb` holds whole rows; the "Up" filter (delta to the row above) keeps photos compressible.
    async write(rgb) {
      const rows = rgb.length / stride;
      const filtered = new Uint8Array(rows * (stride + 1));
      for (let r = 0; r < rows; r++) {
        const row = rgb.subarray(r * stride, (r + 1) * stride);
        const offset = r * (stride + 1);
        filtered[offset] = 2;
        for (let i = 0; i < stride; i++) filtered[offset + 1 + i] = row[i] - previousRow[i];
        previousRow = row;
      }
      previousRow = previousRow.slice();
      await input.write(filtered);
    },
    async close() {
      await input.close();
      await pumped;
      await out.write(chunk("IEND", new Uint8Array()));
      await out.close();
    },
    async abort(reason) {
      await input.abort(reason).catch(() => {});
      await pumped.catch(() => {});
      await out.abort(reason).catch(() => {});
    },
  };
}

export async function clearOutputs() {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(OUTPUT_DIR, { recursive: true });
  } catch {
    // Nothing stored yet, or no OPFS at all.
  }
}

// Prefers a file in the origin-private file system so the PNG lives on disk, not in RAM.
export async function openOutput(name) {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OUTPUT_DIR, { create: true });
    const handle = await dir.getFileHandle(name, { create: true });
    return { sink: await handle.createWritable(), file: () => handle.getFile() };
  } catch {
    // No OPFS (e.g. Safari private windows): keep the compressed chunks in memory instead.
    const chunks = [];
    const sink = new WritableStream({ write: (chunk) => void chunks.push(chunk) });
    const type = name.endsWith(".zip") ? "application/zip" : "image/png";
    return { sink, file: async () => new Blob(chunks, { type }) };
  }
}
