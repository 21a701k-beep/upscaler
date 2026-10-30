import { makeZip } from "client-zip";
import { splitProfile } from "./icc.js";
import { clearOutputs, openOutput, pngWriter } from "./png.js";
import { upscaleStrips } from "./upscale.js";

export function path(file) {
  return file.webkitRelativePath || file.name;
}

export function outputName(file, scale) {
  return `${path(file).replace(/\.[^./]+$/, "")}_x${scale}.png`;
}

async function upscaleFile(file, scale, index, options) {
  const { signal, onImage = () => {} } = options;
  // Keep the input's own color space and tag the output with its profile. Without a profile to
  // carry over, let the browser convert to sRGB, which is what an untagged PNG means.
  const split = await splitProfile(file);
  const bitmap = await createImageBitmap(split?.untagged ?? file);
  try {
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;
    onImage(index, width, height);
    const output = await openOutput(`${index}.png`);
    const png = pngWriter(output.sink, width, height, split?.profile);
    try {
      for await (const strip of upscaleStrips(bitmap, scale, options)) {
        signal?.throwIfAborted();
        await png.write(strip.data);
      }
      await png.close();
    } catch (err) {
      await png.abort(err);
      throw err;
    }
    return { blob: await output.file(), width, height };
  } finally {
    bitmap.close();
  }
}

// Upscales each file to its own stored PNG, one at a time so only one decoded image is in memory.
// Each finished image is reported through onResult as soon as it is stored.
// Returns the single PNG, or a zip of all of them; null if every file failed.
export async function processBatch(files, scale, options = {}) {
  const { signal, onResult = () => {}, onError = () => {} } = options;
  await clearOutputs();
  const outputs = [];

  for (const [index, file] of files.entries()) {
    signal?.throwIfAborted();
    const name = outputName(file, scale);
    try {
      const entry = { name, ...(await upscaleFile(file, scale, index, options)) };
      outputs.push(entry);
      onResult(entry);
    } catch (err) {
      if (signal?.aborted) throw err;
      onError(name, err);
    }
  }

  if (outputs.length <= 1) return outputs[0] ?? null;
  const zip = await openOutput("upscaled.zip");
  await makeZip(outputs.map(({ name, blob }) => ({ name, input: blob }))).pipeTo(zip.sink, { signal });
  return { name: `upscaled_x${scale}.zip`, blob: await zip.file() };
}
