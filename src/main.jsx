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

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<p className="status">Something went wrong. Reload the page to try again.</p>}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
