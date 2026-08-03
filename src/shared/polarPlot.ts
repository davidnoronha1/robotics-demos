import { setupCanvas } from "./canvas";
import type { SeriesSpec, TimeSeriesPlot } from "./plot";

/**
 * Angle-vs-time as a spiral: angle maps to position around the dial (so
 * wraparound at 360° is just going around again, never a snap), and radius
 * encodes recency — newest sample at the rim, oldest fading toward the
 * center. A plain Cartesian line chart is the wrong shape for a quantity
 * that wraps; this is the right one.
 */
export function createPolarPlot(opts: {
  series: SeriesSpec[];
  windowSeconds: number;
  size?: number;
}): TimeSeriesPlot {
  const size = opts.size ?? 320;

  const wrap = document.createElement("div");
  wrap.className = "plot polar-plot";

  const hidden = new Set<string>();

  const legend = document.createElement("div");
  legend.className = "plot-legend";
  for (const s of opts.series) {
    const item = document.createElement("span");
    item.className = "legend-item";
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = s.color;
    item.append(swatch, document.createTextNode(s.label));
    item.addEventListener("click", () => {
      if (hidden.has(s.key)) hidden.delete(s.key);
      else hidden.add(s.key);
      item.classList.toggle("legend-off", hidden.has(s.key));
      render();
    });
    legend.appendChild(item);
  }
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "plot-reset";
  resetBtn.textContent = "reset zoom";
  legend.appendChild(resetBtn);
  const winLabel = document.createElement("span");
  winLabel.className = "polar-window";
  legend.appendChild(winLabel);
  wrap.appendChild(legend);

  const canvas = document.createElement("canvas");
  wrap.appendChild(canvas);
  const ctx = setupCanvas(canvas, size, size);

  let buffer: Array<{ t: number; values: Record<string, number> }> = [];

  // Zooming the polar plot does two things together: it scales the whole
  // dial up around its center (an actual visual zoom, not just a relabeling)
  // and shrinks the time window so the now-larger dial is filled with the
  // most recent, most detailed samples instead of stretching old ones out.
  const defaultWindow = opts.windowSeconds;
  const MIN_WINDOW = 1;
  const MAX_WINDOW = 120;
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 12;
  let win = defaultWindow;
  let zoom = 1;
  // Pan offset, in canvas pixels — lets you drag the zoomed-in dial around
  // when part of it has scrolled off the fixed-size canvas.
  let panX = 0;
  let panY = 0;

  function push(t: number, values: Record<string, number>): void {
    buffer.push({ t, values });
    const cutoff = t - MAX_WINDOW;
    while (buffer.length > 1 && buffer[0]!.t < cutoff) buffer.shift();
  }

  function resetZoom(): void {
    win = defaultWindow;
    zoom = 1;
    panX = 0;
    panY = 0;
    render();
  }

  function reset(): void {
    buffer = [];
    resetZoom();
  }

  canvas.addEventListener("wheel", (e: WheelEvent) => {
    // Require a modifier so scrolling the page past this plot doesn't
    // silently zoom it — see the same guard in shared/plot.ts.
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1 / 1.12 : 1.12;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    win = Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, defaultWindow / zoom));
    render();
  });
  canvas.addEventListener("dblclick", resetZoom);
  resetBtn.addEventListener("click", resetZoom);

  let panning = false;
  let panLast = { x: 0, y: 0 };
  canvas.addEventListener("pointerdown", (e: PointerEvent) => {
    panning = true;
    panLast = { x: e.offsetX, y: e.offsetY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e: PointerEvent) => {
    if (!panning) return;
    panX += e.offsetX - panLast.x;
    panY += e.offsetY - panLast.y;
    panLast = { x: e.offsetX, y: e.offsetY };
    render();
  });
  const stopPan = (e: PointerEvent) => {
    panning = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener("pointerup", stopPan);
  canvas.addEventListener("pointercancel", stopPan);

  function labelWindow(): void {
    const windowText = win >= 60 ? `${(win / 60).toFixed(1)} min` : `${win.toFixed(1)}s window`;
    winLabel.textContent = `${zoom.toFixed(1)}× · ${windowText}`;
  }

  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 28;
  const DEG2RAD = Math.PI / 180;

  // 0° at the top, positive = clockwise.
  const pointOn = (deg: number, r: number): [number, number] => {
    const a = deg * DEG2RAD;
    return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  };

  function render(): void {
    ctx.clearRect(0, 0, size, size);
    labelWindow();

    // Actual geometric zoom: scale everything about the dial's center. At
    // high zoom the ring and outer ticks fall outside the canvas — that's
    // expected, same as zooming into any image. Line widths and text are
    // counter-scaled below so strokes/labels stay crisp instead of smearing.
    ctx.save();
    ctx.translate(panX, panY);
    ctx.translate(cx, cy);
    ctx.scale(zoom, zoom);
    ctx.translate(-cx, -cy);

    // Dial: ring + 30° ticks/labels.
    ctx.strokeStyle = "#88888855";
    ctx.lineWidth = 1 / zoom;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    ctx.font = `${10 / zoom}px monospace`;
    ctx.fillStyle = "#888";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let deg = 0; deg < 360; deg += 30) {
      const [ix, iy] = pointOn(deg, R - 6);
      const [ox, oy] = pointOn(deg, R + 6);
      ctx.strokeStyle = "#88888855";
      ctx.beginPath();
      ctx.moveTo(ix, iy);
      ctx.lineTo(ox, oy);
      ctx.stroke();
      const [lx, ly] = pointOn(deg, R + 16);
      ctx.fillText(`${deg}°`, lx, ly);
    }

    if (buffer.length === 0) {
      ctx.restore();
      return;
    }

    const tNow = buffer[buffer.length - 1]!.t;

    // Spiral trace: recent samples near the rim, older ones fading toward
    // the center as they age out of the window.
    for (const s of opts.series) {
      if (hidden.has(s.key)) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5 / zoom;
      ctx.beginPath();
      let started = false;
      for (const { t, values } of buffer) {
        const v = values[s.key];
        if (v === undefined) continue;
        const age = tNow - t;
        const frac = 1 - Math.min(age / win, 1);
        const r = R * frac;
        const deg = ((v % 360) + 360) % 360;
        const [x, y] = pointOn(deg, r);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Needle to the current value, drawn on top for a clear readout.
      const last = buffer[buffer.length - 1]!.values[s.key];
      if (last !== undefined) {
        const deg = ((last % 360) + 360) % 360;
        const [x, y] = pointOn(deg, R);
        ctx.lineWidth = 2.5 / zoom;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 3 / zoom, 0, Math.PI * 2);
        ctx.fillStyle = s.color;
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function destroy(): void {
    // Plain canvas, no observers/external instances to tear down.
  }

  return { el: wrap, push, render, reset, destroy };
}
