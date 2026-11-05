// GoatCounter page views and usage events, all under the "upscale" name. The endpoint comes from the
// VITE_GOATCOUNTER_URL CI/CD variable at build time; without it (local dev) nothing is counted.
const endpoint = import.meta.env.VITE_GOATCOUNTER_URL;

if (endpoint) {
  // Launches of the installed app (home screen, dock) show up as the referrer "pwa".
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  // main.jsx reloads a first visit once, for cross-origin isolation; the page view was counted before it.
  let reloaded = false;
  try {
    reloaded = sessionStorage.getItem("isolation-reload") !== null;
    sessionStorage.removeItem("isolation-reload");
  } catch {
    // Storage blocked: count the view.
  }
  window.goatcounter = { path: "upscale", no_onload: reloaded, ...(standalone && { referrer: "pwa" }) };
  const script = document.createElement("script");
  script.async = true;
  // A CORS request, which the cross-origin isolated page (see sw.js) allows.
  script.crossOrigin = "anonymous";
  script.src = "https://gc.zgo.at/count.js";
  script.dataset.goatcounter = endpoint;
  document.head.append(script);
}

// Counts one event, e.g. track("image-processed", 4) → "upscale/image-processed/4x", track("donate-clicked").
export function track(event, scale) {
  const name = scale ? `${event}/${scale}x` : event;
  window.goatcounter?.count?.({ path: `upscale/${name}`, title: name, event: true });
}
