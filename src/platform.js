import * as Sentry from "@sentry/react";

// Chooses how this browser runs the models, once, and logs why (the log reaches Sentry Logs, and Sentry
// issues are tagged with the result): WebGPU with fp16 models when the GPU supports shader-f16, which
// roughly halves model size and GPU memory; WebGPU with fp32 otherwise; WASM with fp32 when there is no
// usable WebGPU, which includes software adapters like SwiftShader (far slower than WASM).
// ?backend=wasm and ?precision=fp32 force the slower paths, e.g. to compare them on a phone.
let detected;

export function detectPlatform() {
  detected ??= detect();
  return detected;
}

function choose(backend, precision, reason) {
  console.info(`Using ${backend === "webgpu" ? "WebGPU" : "WASM"} with ${precision} models: ${reason}`);
  Sentry.setTags({ backend, precision });
  return { backend, precision };
}

function describe(adapter) {
  const { vendor, architecture } = adapter.info ?? {};
  return [vendor, architecture].filter(Boolean).join(" ") || "the GPU";
}

async function detect() {
  const params = new URLSearchParams(location.search);
  if (params.get("backend") === "wasm") return choose("wasm", "fp32", "forced by ?backend=wasm");
  if (!navigator.gpu) return choose("wasm", "fp32", "WebGPU is unavailable (unsupported browser or not HTTPS)");

  let adapter = null;
  try {
    adapter = await navigator.gpu.requestAdapter();
  } catch (err) {
    console.warn(`WebGPU adapter request failed: ${err?.message ?? err}`);
  }
  if (!adapter) return choose("wasm", "fp32", "no WebGPU adapter");

  const gpu = describe(adapter);
  if (adapter.info?.isFallbackAdapter) return choose("wasm", "fp32", `${gpu} is a software adapter, slower than WASM`);
  if (params.get("precision") === "fp32") return choose("webgpu", "fp32", `forced by ?precision=fp32 on ${gpu}`);
  return adapter.features.has("shader-f16")
    ? choose("webgpu", "fp16", `${gpu} supports shader-f16`)
    : choose("webgpu", "fp32", `${gpu} lacks shader-f16`);
}
