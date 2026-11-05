import * as Sentry from "@sentry/react";
import { useEffect, useId, useRef, useState } from "react";
import icon from "../logo/icon.svg";
import { useModal } from "./useModal.js";
import Viewer from "./Viewer.jsx";
import { track } from "./analytics.js";
import { path, processBatch } from "./batch.js";
import { MODELS, loadSession } from "./upscale.js";

const NO_PROGRESS = { image: 0, images: 0, tile: 0, tiles: 0 };
const LOADING = "Loading the upscaling model…";
const START_HINT = "Choose images or a folder to start.";
const KOFI_URL = "https://ko-fi.com/cassianokc";
// The donation prompt shows once per visit, after whichever comes first.
const DONATE_AFTER_IMAGES = 5;
const DONATE_AFTER_MS = 2 * 60 * 60 * 1000;
// Someone who clicked a Ko-fi link isn't prompted again, on this visit or later ones.
const DONATE_CLICKED_KEY = "upscale-donate-clicked";
// Above this many input pixels a run is warned about first: memory grows with image size.
const LARGE_IMAGE_PIXELS = 5_000_000;
// In menu order. Compact, the default, gets close to the full models in a fraction of the time; the rest are
// marked slow.
const MODEL_NAMES = {
  compact: "Real-ESRGAN Compact 4×",
  x2plus: "Real-ESRGAN 2×",
  x4plus: "Real-ESRGAN 4×",
};
const DEFAULT_MODEL = "compact";
const IMAGE_EXTENSION = /\.(avif|bmp|gif|jpe?g|png|webp)$/i;

const SOURCES = {
  files: {
    label: "Files",
    button: "Choose images…",
    hint: "Pick one or more images: PNG, JPEG, WebP, …",
    input: { accept: "image/*", multiple: true },
  },
  folder: {
    label: "Folder",
    button: "Choose folder…",
    hint: "Every image in the folder and its subfolders is upscaled.",
    input: { webkitdirectory: "" },
  },
};

function donateClickedBefore() {
  try {
    return localStorage.getItem(DONATE_CLICKED_KEY) === "1";
  } catch {
    return false;
  }
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

const errorMessage = (err) => String(err?.message ?? err);

// Firefox leaves `type` empty for files picked through a folder, so fall back to the extension.
const isImage = (file) => (file.type ? file.type.startsWith("image/") : IMAGE_EXTENSION.test(file.name));

// Width and height from the file's header: an <img> that is never drawn isn't decoded in full.
function imageSize(file) {
  const url = URL.createObjectURL(file);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  }).finally(() => URL.revokeObjectURL(url));
}

const megapixels = ({ width, height }) => ((width * height) / 1e6).toFixed(1);

function imageFiles(fileList) {
  // Folder pickers ignore `accept`, so filter here.
  return [...fileList].filter(isImage).sort((a, b) => path(a).localeCompare(path(b)));
}

function Help({ children }) {
  const id = useId();
  return (
    <span className="help">
      <button type="button" aria-label="More information" aria-describedby={id}>
        ?
      </button>
      <span role="tooltip" id={id}>
        {children}
      </span>
    </span>
  );
}

// A new tab, so following a link never throws away a run in progress.
function Link(props) {
  return <a {...props} target="_blank" rel="noreferrer" />;
}

function Meter({ label, text, value, max, help }) {
  return (
    <div className="meter">
      <div className="field-label">
        <span>
          {label}: {text}
        </span>
        {help && <Help>{help}</Help>}
      </div>
      <progress aria-label={label} value={value} max={max} />
    </div>
  );
}

function DonateLink({ className = "button", onClick }) {
  return (
    <Link
      className={className}
      href={KOFI_URL}
      onClick={() => {
        track("donate-clicked");
        try {
          localStorage.setItem(DONATE_CLICKED_KEY, "1");
        } catch {
          // Storage blocked (e.g. some private modes): the prompt just won't be remembered as handled.
        }
        onClick?.();
      }}
    >
      ☕ Support me on Ko-fi
    </Link>
  );
}

function DonateDialog({ onClose }) {
  const dialogRef = useModal();

  // StrictMode's second mount only happens in development, where nothing is counted.
  useEffect(() => track("donate-dialog-shown"), []);

  return (
    <dialog ref={dialogRef} className="prompt" aria-labelledby="donate-title" closedby="any" onClose={onClose}>
      <h2 id="donate-title">Heey, enjoying yourself?</h2>
      <p>
        I made Upscaler free, and it runs entirely on your device. If it helped you out, maybe buy me a coffee?
      </p>
      <div className="prompt-actions">
        <form method="dialog">
          <button className="button">Maybe later</button>
        </form>
        <DonateLink className="button primary" onClick={() => dialogRef.current.close()} />
      </div>
    </dialog>
  );
}

// The identity study's compact lockup: the icon (the mark drawn for 64px and below) at 24px, 8px from the title.
function Header() {
  return (
    <header>
      <h1 className="lockup">
        <img src={icon} alt="" width="24" height="24" />
        Upscaler
      </h1>
      <p className="subtitle">Make images 2× or 4× larger, right in your browser. Your images never leave this device.</p>
    </header>
  );
}

function Footer({ onDonate }) {
  return (
    <footer className="page-footer">
      <DonateLink onClick={onDonate} />
      <details className="about">
        <summary>How it works</summary>
        <p>
          Upscaler makes photos and drawings 2× or 4× larger with Real-ESRGAN, a family of neural networks trained to
          restore detail. By default it uses the compact one, over ten times faster than the full models.
          It runs entirely in your browser: the model is downloaded to this page and runs on your graphics card through
          WebGPU, or on the processor through WebAssembly, so your images are never uploaded. Pick a few images or a whole
          folder; each result is saved as a PNG that keeps the original's color profile, and a folder downloads as one zip.
          It's free, with no account, no watermark and no limit on how many images, and works on computers, phones and
          tablets.
        </p>
      </details>
      <div className="credits">
        <p>
          Powered by <Link href="https://github.com/xinntao/Real-ESRGAN">Real-ESRGAN</Link> (
          <Link href={`${import.meta.env.BASE_URL}LICENSE-Real-ESRGAN.txt`}>BSD-3-Clause</Link>), which builds
          on <Link href="https://github.com/xinntao/ESRGAN">ESRGAN</Link>, running on{" "}
          <Link href="https://github.com/microsoft/onnxruntime">ONNX Runtime Web</Link>.
        </p>
      </div>
    </footer>
  );
}

// Asked before a run that includes images over LARGE_IMAGE_PIXELS; Escape or a click outside cancels.
function LargeImagesDialog({ large, total, scale, onContinue, onCancel }) {
  const dialogRef = useModal();
  const largest = large.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
  const size = `${largest.width}×${largest.height} (${megapixels(largest)} MP)`;

  return (
    <dialog
      ref={dialogRef}
      className="prompt"
      aria-labelledby="large-title"
      closedby="any"
      onClose={(e) => (e.currentTarget.returnValue === "continue" ? onContinue() : onCancel())}
    >
      <h2 id="large-title">{large.length === 1 ? "That's a big image" : "Some of these images are big"}</h2>
      <p>
        {large.length === 1 && total === 1
          ? `${largest.name} is ${size}.`
          : `${large.length} of the ${plural(total, "image")} are over ${LARGE_IMAGE_PIXELS / 1e6} MP; the largest, ${largest.name}, is ${size}.`}{" "}
        Upscaling {large.length === 1 ? "it" : "them"} at {scale}× uses a lot of memory and can slow down or crash this
        tab.
      </p>
      <form method="dialog" className="prompt-actions">
        <button className="button" value="cancel">
          Cancel
        </button>
        <button className="button primary" value="continue">
          Upscale anyway
        </button>
      </form>
    </dialog>
  );
}

export default function App() {
  const previousRun = useRef(Promise.resolve());
  const processedCount = useRef(0);
  const [source, setSource] = useState("files");
  const [files, setFiles] = useState([]);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [status, setStatus] = useState(LOADING);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(NO_PROGRESS);
  const [results, setResults] = useState([]);
  const [output, setOutput] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [pending, setPending] = useState(null); // a selection waiting on the large-image warning
  const [donate, setDonate] = useState(() => (donateClickedBefore() ? "shown" : "idle")); // idle → due → shown
  const dueOnce = () => setDonate((state) => (state === "idle" ? "due" : state));
  const chooser = SOURCES[source];
  // From the selection rather than the switch, which may have been flipped since.
  const fromFolder = Boolean(files[0]?.webkitRelativePath);
  const succeeded = results.filter((entry) => !entry.error).length;
  const percent = progress.tiles ? Math.round((100 * progress.tile) / progress.tiles) : 0;

  useEffect(() => {
    loadSession(DEFAULT_MODEL).then(
      () => setStatus((current) => (current === LOADING ? `Ready. ${START_HINT}` : current)),
      (err) => {
        setStatus(errorMessage(err));
        console.error(err);
        Sentry.captureException(err);
      },
    );
  }, []);

  useEffect(() => {
    const timer = setTimeout(dueOnce, DONATE_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!files.length) return;
    const controller = new AbortController();
    const t0 = performance.now();
    let failed = 0;
    // A new selection or model starts a new run, and the UI resets with it: one extra render per run.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRunning(true);
    setOutput(null);
    setResults([]);
    setStatus("Starting…");
    setProgress({ ...NO_PROGRESS, images: files.length });

    const run = (async () => {
      // An aborted run must release its output files before this one clears them.
      await previousRun.current;
      return processBatch(files, model, {
        signal: controller.signal,
        onImage(index, width, height) {
          // Progress lines reach Sentry Logs, so a tab killed for memory still shows how far it got.
          // File names stay out of them: they can be personal.
          console.info(`Upscaling image ${index + 1} of ${files.length} to ${width}×${height} with ${model}`);
          setStatus(`Upscaling ${path(files[index])}`);
          setProgress({ image: index, images: files.length, tile: 0, tiles: 0 });
        },
        onTile: (tile, tiles) => setProgress((p) => ({ ...p, tile, tiles })),
        onResult(entry) {
          processedCount.current++;
          track("image-processed", model);
          setResults((list) => [...list, entry]);
        },
        onError(name, err) {
          failed++;
          const error = errorMessage(err);
          console.warn(`An image could not be upscaled: ${error}`);
          setResults((list) => [...list, { name, error }]);
        },
      });
    })();
    previousRun.current = run.catch(() => {});

    run.then(
      (batchOutput) => {
        const seconds = ((performance.now() - t0) / 1000).toFixed(1);
        const done = files.length - failed;
        console.info(`Finished ${done} of ${files.length} images with ${model} in ${seconds} s`);
        if (fromFolder && done > 0) track("folder-processed", model);
        setProgress((p) => ({ ...p, image: files.length }));
        setStatus(
          done === 0
            ? `None of the ${plural(files.length, "image")} could be upscaled.`
            : `Done: upscaled ${failed ? `${done} of ${files.length} images` : plural(done, "image")} in ${seconds} s.`,
        );
        setOutput(batchOutput);
        setRunning(false);
        // Only after the run, so the prompt never interrupts a batch in progress.
        if (processedCount.current >= DONATE_AFTER_IMAGES) dueOnce();
      },
      (err) => {
        if (controller.signal.aborted) return;
        setStatus(errorMessage(err));
        setRunning(false);
        console.error(err);
        Sentry.captureException(err);
      },
    );

    return () => controller.abort();
  }, [files, model, fromFolder]);

  async function chooseFiles(e) {
    const chosen = imageFiles(e.target.files);
    // Clearing the input lets the same selection be chosen again to re-run it.
    e.target.value = "";
    if (!chosen.length) return setStatus("No images found in that selection.");
    // Every size is known before anything starts, so a folder is checked as a whole.
    setStatus(`Checking ${plural(chosen.length, "image")}…`);
    const sizes = await Promise.all(chosen.map(imageSize));
    const large = chosen
      .map((file, i) => ({ name: path(file), ...sizes[i] }))
      .filter(({ width, height }) => width * height > LARGE_IMAGE_PIXELS);
    if (large.length) setPending({ files: chosen, large });
    else setFiles(chosen);
  }

  function saveOutput() {
    track(fromFolder ? "folder-downloaded" : "image-downloaded", model);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(output.blob);
    link.download = output.name;
    link.click();
    // Safari can drop the download if the URL is revoked synchronously.
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function closeViewer() {
    URL.revokeObjectURL(viewing.url);
    URL.revokeObjectURL(viewing.originalUrl);
    setViewing(null);
  }

  return (
    <>
      <main>
        <Header />

        <section className="panel" aria-label="Settings">
          <div className="fields">
            <div className="field">
              <div className="field-label">
                <span id="source-label">Source</span>
                <Help>
                  Files upscales the images you pick. Folder upscales every image in a folder and its subfolders, and
                  the download keeps the folder structure. Your browser may ask to “upload” the folder: the files never
                  leave this device.
                </Help>
              </div>
              <div className="segmented" role="radiogroup" aria-labelledby="source-label">
                {Object.entries(SOURCES).map(([key, { label }]) => (
                  <label key={key}>
                    <input
                      type="radio"
                      name="source"
                      value={key}
                      checked={source === key}
                      onChange={() => setSource(key)}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div className="field">
              <div className="field-label">
                <label htmlFor="model">Model</label>
                <Help>
                  Real-ESRGAN Compact is Real-ESRGAN's small model: over ten times faster than the full ones, with close
                  results. The full models can bring out a little more texture. The number is how much bigger each side
                  gets: at 4×, 1000×750 becomes 4000×3000. Changing it restarts the current run.
                </Help>
              </div>
              <select id="model" className="button" value={model} onChange={(e) => setModel(e.target.value)}>
                {Object.entries(MODEL_NAMES).map(([id, name]) => (
                  <option key={id} value={id}>
                    {id === DEFAULT_MODEL ? name : `${name} (slow)`}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="button chooser">
            {chooser.button}
            <input key={source} type="file" {...chooser.input} onChange={chooseFiles} />
          </label>
          <p className="hint">{chooser.hint}</p>
        </section>

        <p className="status" role="status">
          {status}
        </p>

        {progress.images > 1 && (
          <Meter
            label="Images"
            text={`${progress.image} of ${progress.images}`}
            value={progress.image}
            max={progress.images}
            help="Images are upscaled one after another. Finished ones appear in the list below and can be opened while the rest are still in progress."
          />
        )}
        {running && <Meter label="Current image" text={`${percent}%`} value={percent} max={100} />}

        {output && (
          <div className="download">
            <button className="button primary" onClick={saveOutput}>
              {succeeded === 1 ? "Download image" : "Download images"}
            </button>
            <Help>
              One image downloads as a PNG; several download together as a zip. Results are kept until you start another
              run.
            </Help>
          </div>
        )}

        {results.length > 0 && (
          <ul className="results" aria-label="Results">
            {results.map((entry) => (
              <li key={entry.name}>
                {entry.error ? (
                  <div className="result failed">
                    <span className="result-name">{entry.name}</span>
                    <span className="result-detail">Could not be upscaled: {entry.error}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="result"
                    onClick={() =>
                      setViewing({
                        ...entry,
                        modelName: MODEL_NAMES[model],
                        url: URL.createObjectURL(entry.blob),
                        originalUrl: URL.createObjectURL(entry.source),
                      })
                    }
                  >
                    <span className="result-name">{entry.name}</span>
                    <span className="result-detail">
                      {entry.width} × {entry.height}
                    </span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {viewing && <Viewer item={viewing} onClose={closeViewer} />}
        {/* Waits for the viewer to close rather than stacking on top of it. */}
        {pending && (
          <LargeImagesDialog
            large={pending.large}
            total={pending.files.length}
            scale={MODELS[model].scale}
            onContinue={() => {
              setFiles(pending.files);
              setPending(null);
            }}
            onCancel={() => {
              setPending(null);
              setStatus(`Canceled. ${START_HINT}`);
            }}
          />
        )}
        {donate === "due" && !viewing && !pending && <DonateDialog onClose={() => setDonate("shown")} />}
      </main>

      <Footer onDonate={() => setDonate("shown")} />
    </>
  );
}
