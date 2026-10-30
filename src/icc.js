// Embedded ICC profiles, so the output PNG can carry the input's color space instead of converting to sRGB.

async function pipe(bytes, transform) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer());
}

// Finds the embedded ICC profile and takes it out of `bytes`: `pieces` are what remains of the file.
async function extractProfile(bytes) {
  const view = new DataView(bytes.buffer);
  const ascii = (start, length) => String.fromCharCode(...bytes.subarray(start, start + length));

  if (view.getUint16(0) === 0xffd8) {
    // JPEG: APP2 "ICC_PROFILE" segments, numbered from 1, all before the image data.
    const parts = [];
    for (let i = 2; bytes[i] === 0xff; ) {
      const marker = bytes[i + 1];
      if (marker === 0xda || marker === 0xd9) break; // start of scan, end of image
      const end = i + 2 + view.getUint16(i + 2);
      if (marker === 0xe2 && ascii(i + 4, 12) === "ICC_PROFILE\0") {
        parts[bytes[i + 16]] = bytes.slice(i + 18, end);
        bytes[i + 4] = 0x58; // "XCC_PROFILE", which decoders skip
      }
      i = end;
    }
    return parts.length ? { profile: new Uint8Array(await new Blob(parts.filter(Boolean)).arrayBuffer()), pieces: [bytes] } : null;
  }
  if (ascii(1, 3) === "PNG") {
    // PNG: an iCCP chunk before the image data holds a name, a compression method and the zlib'd profile.
    for (let i = 8; i + 8 <= bytes.length; ) {
      const size = view.getUint32(i);
      const type = ascii(i + 4, 4);
      if (type === "IDAT") break;
      if (type === "iCCP") {
        const data = bytes.subarray(i + 8, i + 8 + size);
        const profile = await pipe(data.subarray(data.indexOf(0) + 2), new DecompressionStream("deflate"));
        return { profile, pieces: [bytes.subarray(0, i), bytes.subarray(i + 12 + size)] };
      }
      i += 12 + size;
    }
    return null;
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    // WebP: an ICCP chunk holding the raw profile, flagged in the VP8X header; chunks are padded to even sizes.
    for (let i = 12; i + 8 <= bytes.length; ) {
      const size = view.getUint32(i + 4, true);
      if (ascii(i, 4) === "ICCP") {
        const profile = bytes.slice(i + 8, i + 8 + size);
        bytes[i] = 0x58; // "XCCP", an unknown chunk decoders skip
        bytes[20] &= ~0x20;
        return { profile, pieces: [bytes] };
      }
      i += 8 + size + (size & 1);
    }
  }
  return null;
}

// Splits off the file's ICC profile if it is an RGB one, the only kind an RGB PNG can carry (CMYK and
// gray inputs still get converted to sRGB on decode). `untagged` is the file without it, which every
// browser decodes unconverted: WebKit ignores createImageBitmap's colorSpaceConversion: "none".
// Null for no profile, other formats, or a malformed file.
export async function splitProfile(file) {
  try {
    const found = await extractProfile(new Uint8Array(await file.arrayBuffer()));
    const isRgb = found && String.fromCharCode(...found.profile.subarray(16, 20)) === "RGB ";
    return isRgb ? { profile: found.profile, untagged: new Blob(found.pieces) } : null;
  } catch {
    return null;
  }
}

// Data of a PNG iCCP chunk: profile name, compression method 0, zlib'd profile.
export async function iccpData(profile) {
  const compressed = await pipe(profile, new CompressionStream("deflate"));
  return new Uint8Array(await new Blob([new TextEncoder().encode("ICC profile\0\0"), compressed]).arrayBuffer());
}
