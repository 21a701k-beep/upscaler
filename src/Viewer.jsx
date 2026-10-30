import { useEffect, useLayoutEffect, useRef, useState } from "react";

const ZOOM_STEP = 1.5;
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 16;

// Full-size view of one result in a modal dialog. Opens fitted to the window; zoom with the buttons,
// Ctrl/⌘ + scroll (trackpad pinch in most browsers) or a double-click; pan by dragging or scrolling.
export default function Viewer({ item, onClose }) {
  const dialogRef = useRef(null);
  const viewportRef = useRef(null);
  const imageRef = useRef(null);
  const anchor = useRef(null);
  const drag = useRef(null);
  const [zoom, setZoom] = useState(null); // null: fit to the window

  useEffect(() => {
    // Guarded because StrictMode runs mount effects twice in development.
    if (!dialogRef.current.open) dialogRef.current.showModal();
  }, []);

  // Zooms while keeping the image point under (x, y) in place; defaults to the viewport center.
  function zoomTo(next, x, y) {
    const image = imageRef.current.getBoundingClientRect();
    if (!image.width) return;
    const view = viewportRef.current.getBoundingClientRect();
    x ??= view.left + view.width / 2;
    y ??= view.top + view.height / 2;
    const target = typeof next === "function" ? next(image.width / item.width) : next;
    anchor.current = { x, y, fx: (x - image.left) / image.width, fy: (y - image.top) / image.height };
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, target)));
  }

  useLayoutEffect(() => {
    const point = anchor.current;
    if (!point) return;
    anchor.current = null;
    const image = imageRef.current.getBoundingClientRect();
    viewportRef.current.scrollLeft += image.left + point.fx * image.width - point.x;
    viewportRef.current.scrollTop += image.top + point.fy * image.height - point.y;
  }, [zoom]);

  useEffect(() => {
    const view = viewportRef.current;
    function onWheel(e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaY;
      zoomTo((current) => current * Math.exp(-delta / 200), e.clientX, e.clientY);
    }
    // React's wheel listeners are passive, so they can't stop the browser zooming the whole page.
    view.addEventListener("wheel", onWheel, { passive: false });
    return () => view.removeEventListener("wheel", onWheel);
  });

  function startDrag(e) {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const view = viewportRef.current;
    drag.current = { x: e.clientX, y: e.clientY, left: view.scrollLeft, top: view.scrollTop };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function moveDrag(e) {
    if (!drag.current) return;
    const view = viewportRef.current;
    view.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
    view.scrollTop = drag.current.top - (e.clientY - drag.current.y);
  }

  function endDrag() {
    drag.current = null;
  }

  return (
    <dialog ref={dialogRef} className="viewer" aria-label={item.name} closedby="any" onClose={onClose}>
      <div className="viewer-bar">
        <span className="viewer-title">{item.name}</span>
        <div className="viewer-zoom" role="group" aria-label="Zoom">
          <button type="button" className="button" aria-label="Zoom out" onClick={() => zoomTo((z) => z / ZOOM_STEP)}>
            −
          </button>
          <output className="viewer-level">{zoom === null ? "Fit" : `${Math.round(zoom * 100)}%`}</output>
          <button type="button" className="button" aria-label="Zoom in" onClick={() => zoomTo((z) => z * ZOOM_STEP)}>
            +
          </button>
          <button type="button" className="button" onClick={() => setZoom(null)}>
            Fit
          </button>
          <button type="button" className="button" onClick={() => zoomTo(1)}>
            100%
          </button>
        </div>
        <form method="dialog">
          <button className="button">Close</button>
        </form>
      </div>
      <div ref={viewportRef} className={zoom === null ? "viewer-viewport fit" : "viewer-viewport"}>
        <img
          ref={imageRef}
          src={item.url}
          alt={item.name}
          draggable={false}
          style={zoom === null ? undefined : { width: item.width * zoom }}
          onDoubleClick={(e) => (zoom === null ? zoomTo(1, e.clientX, e.clientY) : setZoom(null))}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      </div>
    </dialog>
  );
}
