import * as Sentry from "@sentry/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./analytics.js";
import "./App.css";

// The DSN comes from the VITE_SENTRY_DSN CI/CD variable at build time; without it (local dev) nothing is sent.
// Uncaught errors and rejections become Sentry issues; console output goes to Sentry Logs.
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  release: import.meta.env.VITE_SENTRY_RELEASE,
  environment: import.meta.env.MODE,
  enableLogs: true,
  integrations: [Sentry.consoleLoggingIntegration({ levels: ["log", "info", "warn", "error"] })],
});

// Production only: in dev, a cached page would hide edits, and Vite sends the isolation headers itself.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  // A first visit isn't cross-origin isolated (see sw.js): reload once the worker takes over. Only then, so a
  // browser that ignores the worker's headers isn't reloaded again, mid-batch, by each deploy's new worker.
  const firstVisit = !navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!firstVisit || crossOriginIsolated) return;
    try {
      sessionStorage.setItem("isolation-reload", "1");
    } catch {
      // Without storage, the reload counts as a second page view.
    }
    location.reload();
  });
  navigator.serviceWorker
    .register("./sw.js")
    .catch((err) => console.warn(`No offline support: ${err?.message ?? err}`));
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<p className="status">Something went wrong. Reload the page to try again.</p>}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
