// GoatCounter page views and usage events, all under the "upscale" name. The endpoint comes from the
// VITE_GOATCOUNTER_URL CI/CD variable at build time; without it (local dev) nothing is counted.
const endpoint = import.meta.env.VITE_GOATCOUNTER_URL;

if (endpoint) {
  window.goatcounter = { path: "upscale" };
  const script = document.createElement("script");
  script.async = true;
  script.src = "https://gc.zgo.at/count.js";
  script.dataset.goatcounter = endpoint;
  document.head.append(script);
}

// Counts one event, e.g. track("image-processed", 4) → "upscale/image-processed/4x", track("donate-clicked").
export function track(event, scale) {
  const name = scale ? `${event}/${scale}x` : event;
  window.goatcounter?.count?.({ path: `upscale/${name}`, title: name, event: true });
}
