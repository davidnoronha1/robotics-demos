import { forwardRef } from "preact/compat";
import { useEffect, useImperativeHandle, useRef, useState } from "preact/hooks";
import { setupCanvas } from "./canvas";
import { bindPointerInput } from "./pointerInput";
import { PlotLegend } from "./PlotLegend";
import { PLOT_ZOOM_STEP, isZoomGesture } from "./plotConstants";
import type { SeriesSpec } from "./TimeSeriesPlot";

export interface PolarPlotProps {
  series: SeriesSpec[];
  windowSeconds: number;
  size?: number;
}

/** Imperative handle driven from the sim loop (same contract as the time-series plots). */
export interface PolarPlotHandle {
  push(t: number, values: Record<string, number>): void;
  render(): void;
  reset(): void;
}

/**
 * Angle-vs-time as a spiral: angle maps to position around the dial (so
 * wraparound at 360° is just going around again, never a snap), and radius
 * encodes recency — newest sample at the rim, oldest fading toward the
 * center. A plain Cartesian line chart is the wrong shape for a quantity
 * that wraps; this is the right one.
 *
 * The chrome (legend, reset button, zoom readout) is JSX; the canvas drawing
 * and interactions are imperative in `createEngine`. The engine is the single
 * owner of zoom/window/hidden-series state and reports view changes up to the
 * component via `onViewChange`, so the readout stays a cheap React state
 * update instead of being poked on every 60×/sec render tick.
 */
interface PolarEngine {
  push(t: number, values: Record<string, number>): void;
  render(): void;
  reset(): void;
  resetZoom(): void;
  setSeriesHidden(key: string, hidden: boolean): void;
  destroy(): void;
}

function createEngine(opts: {
  series: SeriesSpec[];
  windowSeconds: number;
  size: number;
  canvas: HTMLCanvasElement;
  onViewChange: (view: { zoom: number; win: number }) => void;
}): PolarEngine {
  const { series, size } = opts;
  const ctx = setupCanvas(opts.canvas, size, size);
  const hidden = new Set<string>();

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
    for (const s of series) {
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

  function push(t: number, values: Record<string, number>): void {
    buffer.push({ t, values });
    const cutoff = t - MAX_WINDOW;
    while (buffer.length > 1 && buffer[0]!.t < cutoff) buffer.shift();
  }

  function applyView(): void {
    opts.onViewChange({ zoom, win });
  }

  function resetZoom(): void {
    win = defaultWindow;
    zoom = 1;
    panX = 0;
    panY = 0;
    applyView();
    render();
  }

  function reset(): void {
    buffer = [];
    resetZoom();
  }

  function setSeriesHidden(key: string, hiddenNow: boolean): void {
    if (hiddenNow) hidden.add(key);
    else hidden.delete(key);
    render();
  }

  // ---- Zoom (ctrl/cmd + wheel) + pan (drag) ----
  const canvas = opts.canvas;
  canvas.addEventListener("wheel", (e: WheelEvent) => {
    // Require a modifier so scrolling the page past this plot doesn't
    // silently zoom it — see the same guard in the time-series plot.
    if (!isZoomGesture(e)) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1 / PLOT_ZOOM_STEP : PLOT_ZOOM_STEP;
    zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    win = Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, defaultWindow / zoom));
    applyView();
    render();
  });
  canvas.addEventListener("dblclick", resetZoom);

  let panning = false;
  let panLast = { x: 0, y: 0 };
  const unbindPan = bindPointerInput(canvas, {
    onDown: (x, y) => {
      panning = true;
      panLast = { x, y };
    },
    onMove: (x, y) => {
      if (!panning) return;
      panX += x - panLast.x;
      panY += y - panLast.y;
      panLast = { x, y };
      render();
    },
    onUp: () => {
      panning = false;
    },
  });

  function destroy(): void {
    unbindPan();
  }

  return { push, render, reset, resetZoom, setSeriesHidden, destroy };
}

export const PolarPlot = forwardRef<PolarPlotHandle, PolarPlotProps>(function PolarPlot(props, ref) {
  const size = props.size ?? 320;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PolarEngine | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [view, setView] = useState({ zoom: 1, win: props.windowSeconds });

  useEffect(() => {
    const engine = createEngine({
      series: props.series,
      windowSeconds: props.windowSeconds,
      size,
      canvas: canvasRef.current!,
      onViewChange: setView,
    });
    engineRef.current = engine;
    return () => engine.destroy();
    // Config is fixed for the lifetime of the plot — mount-once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      push: (t, values) => engineRef.current?.push(t, values),
      render: () => engineRef.current?.render(),
      reset: () => engineRef.current?.reset(),
    }),
    [],
  );

  const windowText = view.win >= 60 ? `${(view.win / 60).toFixed(1)} min` : `${view.win.toFixed(1)}s window`;

  return (
    <div class="plot polar-plot">
      <div class="plot-legend">
        <PlotLegend
          series={props.series}
          hidden={hidden}
          onToggle={(key, nextShown) => {
            setHidden((prev) => {
              const next = new Set(prev);
              if (nextShown) next.delete(key);
              else next.add(key);
              return next;
            });
            engineRef.current?.setSeriesHidden(key, !nextShown);
          }}
        />
        <button type="button" class="plot-reset" onClick={() => engineRef.current?.resetZoom()}>
          reset zoom
        </button>
        <span class="polar-window">
          {view.zoom.toFixed(1)}× · {windowText}
        </span>
      </div>
      <canvas ref={canvasRef} />
    </div>
  );
});
