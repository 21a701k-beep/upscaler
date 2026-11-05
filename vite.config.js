import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const shortHash = (...parts) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex").slice(0, 12);
};

// Emits src/sw.js as sw.js, with the constants it needs from this build filled in.
const serviceWorker = {
  name: "service-worker",
  apply: "build",
  enforce: "post",
  generateBundle(options, bundle) {
    const files = Object.values(bundle);
    const build = {
      version: shortHash(...files.map((file) => file.code ?? file.source)),
      modelVersion: shortHash(readFileSync("export.py"), readFileSync("export.py.lock")),
      precache: files.map((file) => file.fileName).filter((name) => !/\.(html|wasm)$/.test(name)),
    };
    const source = readFileSync("src/sw.js", "utf8").replace("= __BUILD__;", `= ${JSON.stringify(build)};`);
    this.emitFile({ type: "asset", fileName: "sw.js", source });
  },
};

export default defineConfig(({ command }) => ({
  // Relative URLs in builds, so the site works under any path (GitLab Pages may serve it from /<project>/).
  // Dev and tests keep "/": the browser tests fetch the models from the server root.
  base: command === "build" ? "./" : "/",
  plugins: [react(), serviceWorker],
  // Pre-bundling breaks ORT's import.meta.url lookup of its .wasm files.
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  // Cross-origin isolation enables SharedArrayBuffer, so ORT's WASM backend can use threads.
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  // Like GitLab Pages, which can't send headers: in a build, the service worker isolates the page.
  preview: { headers: {} },
  test: {
    testTimeout: 300_000,
    // Test files share the browser's OPFS "outputs" folder, which a batch clears.
    fileParallelism: false,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [
        // Full Chromium in new headless mode exposes the GPU to WebGPU; the default headless shell has no adapter.
        { browser: "chromium", provider: playwright({ launchOptions: { channel: "chromium" } }) },
        { browser: "firefox" },
        { browser: "webkit" },
      ],
    },
  },
}));
