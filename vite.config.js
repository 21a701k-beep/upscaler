import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig(({ command }) => ({
  // Relative URLs in builds, so the site works under any path (GitLab Pages may serve it from /<project>/).
  // Dev and tests keep "/": the browser tests fetch the models from the server root.
  base: command === "build" ? "./" : "/",
  plugins: [react()],
  // Pre-bundling breaks ORT's import.meta.url lookup of its .wasm files.
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  // Cross-origin isolation enables SharedArrayBuffer, so ORT's WASM backend can use threads.
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
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
