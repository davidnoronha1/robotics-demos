import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import { forwardRef } from "preact/compat";
import { useEffect, useImperativeHandle, useRef, useState } from "preact/hooks";
import { bindPointerInput } from "./pointerInput";
import { PlotLegend } from "./PlotLegend";
import { PLOT_ZOOM_STEP, isZoomGesture } from "./plotConstants";

export interface SeriesSpec {
  key: string;
  label: string;
  color: string;
}

export interface TimeSeriesPlotProps {
  series: SeriesSpec[];
  windowSeconds: number;
  yLabel?: string;
  height?: number;
  minWindowSeconds?: number;
  maxWindowSeconds?: number;
}

/** Imperative handle the sim loop drives 60×/sec, bypassing Preact's render
 * cycle entirely — the chart's data lives inside uPlot, not in component
 * state. Preact only owns the chrome and the mount/destroy lifecycle. */
export interface TimeSeriesPlotHandle {
  push(t: number, values: Record<string, number>): void;
  render(): void;
  reset(): void;
}

const AXIS_COLOR = "#888";
const GRID_COLOR = "#8888882a";

const ExpandIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2H2v4M10 2h4v4M2 10v4h4M14 10v4h-4" />
  </svg>
);
const CollapseIcon = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

/**
 * Streaming time-series chart backed by uPlot.
 *
 * Scaling is owned explicitly rather than delegated to uPlot's built-in
 * auto-range: in the default "auto" mode the y-axis is recomputed on every
 * render from the values currently visible in the x-window (so plots
 * continuously rescale to the data they receive, however small or large the
 * magnitudes); whatever the user sees is always what the axis is fit to.
 *
 * Interactions:
 *   - ctrl/cmd + wheel: zoom both axes, anchored at the cursor
 *   - drag to pan (x scrolls; y moves the range)
 *   - double-click or the "reset zoom" button: restore auto-fit + follow
 *   - the "expand" button: view the plot as a fullscreen overlay
 *
 * The chrome (header/legend/buttons) is JSX; everything touching uPlot is
 * imperative and lives in `createEngine`, so the sim loop can stream data
 * without any React re-render.
 */
interface Engine {
  push(t: number, values: Record<string, number>): void;
  render(): void;
  reset(): void;
  resetView(): void;
  setSeriesShown(index: number, shown: boolean): void;
  setExpanded(expanded: boolean): void;
  sizeChart(): void;
  destroy(): void;
}

function createEngine(opts: {
  series: SeriesSpec[];
  windowSeconds: number;
  minWindow: number;
  maxWindow: number;
  baseHeight: number;
  wrap: HTMLElement;
  holder: HTMLElement;
}): Engine {
  const { series, windowSeconds, minWindow, maxWindow, baseHeight, wrap, holder } = opts;

  const chart = new uPlot(
    {
      width: 640,
      height: baseHeight,
      padding: [8, 8, 8, 8],
      scales: {
        // Both axes are driven manually every frame (see applyScales).
        // `auto: false` stops uPlot from ever re-deriving a range from the
        // data on its own — that auto-fit is what kept snapping the x-axis
        // back to the pre-data 0..window window and hiding the data.
        x: { time: false, auto: false },
        y: { auto: false },
      },
      axes: [
        {
          stroke: AXIS_COLOR,
          grid: { stroke: GRID_COLOR },
          ticks: { stroke: AXIS_COLOR },
          size: 44,
        },
        {
          stroke: AXIS_COLOR,
          grid: { stroke: GRID_COLOR },
          ticks: { stroke: AXIS_COLOR },
          size: 60,
          // Significant-figure labels so small-magnitude series (e.g. the
          // attitude covariance trace, ~1e-4) stay readable instead of
          // collapsing to repeated "0" ticks.
          values: (_self, ticks) =>
            ticks.map((v) => {
              if (v === 0) return "0";
              const digits = Math.max(0, 2 - Math.floor(Math.log10(Math.abs(v))));
              return v.toFixed(Math.min(digits, 6));
            }),
        },
      ],
      legend: { show: false },
      cursor: { y: true, drag: { x: false, y: false } },
      series: [{}, ...series.map((s) => ({ label: s.label, stroke: s.color, width: 1.75 }))],
    },
    [[], ...series.map(() => [])],
    holder,
  );

  let buffer: Array<{ t: number; values: Record<string, number> }> = [];
  let tNow = 0;

  // ---- View state ----
  // The x-window follows tNow while follow is true; otherwise it's explicit.
  let followed = true;
  let xMin = Math.max(0, tNow - windowSeconds);
  let xMax = tNow;
  // Y is auto-fit per frame until the user zooms/pans into a manual range.
  let yAuto = true;
  let yMin = -1;
  let yMax = 1;
  let sawFirstData = false;

  /** Visible x-window; while following, don't show dead space before the first sample. */
  function currentXMin(): number {
    if (!followed) return xMin;
    if (buffer.length > 0) return Math.max(tNow - windowSeconds, buffer[0]!.t);
    return tNow - windowSeconds;
  }

  function syncX(): void {
    if (followed) {
      xMax = tNow;
      xMin = currentXMin();
    }
  }

  /** Auto-fit y to the values currently within the visible x-window. */
  function fitY(): void {
    const lo = xMin;
    const hi = xMax;
    let min = Infinity;
    let max = -Infinity;
    let any = false;
    for (let i = 0; i < buffer.length; i++) {
      const p = buffer[i]!;
      if (p.t < lo || p.t > hi) continue;
      for (let s = 0; s < series.length; s++) {
        const v = p.values[series[s]!.key];
        if (v === undefined || Number.isNaN(v)) continue;
        if (v < min) min = v;
        if (v > max) max = v;
        any = true;
      }
    }
    if (!any) {
      yMin = -1;
      yMax = 1;
      return;
    }
    if (min === max) {
      const pad = Math.max(Math.abs(min) * 0.1, 1);
      yMin = min - pad;
      yMax = max + pad;
      return;
    }
    const pad = (max - min) * 0.08;
    yMin = min - pad;
    yMax = max + pad;
  }

  /**
   * Compute the current x/y limits, then push them into uPlot **synchronously**
   * via chart.batch(). uPlot defers scale application to a microtask for normal
   * setScale calls; wrapping everything in batch() guarantees the ranges are
   * applied and drawn before this call returns, so the chart always reflects
   * exactly what we computed (no stale construction-time window lingering).
   */
  function applyScales(): void {
    if (yAuto) fitY();
    syncX();
    chart.batch(() => {
      chart.setScale("x", { min: xMin, max: xMax });
      chart.setScale("y", { min: yMin, max: yMax });
    });
  }

  function resetView(): void {
    followed = true;
    yAuto = true;
    xMin = Math.max(0, tNow - windowSeconds);
    xMax = tNow;
    applyScales();
  }

  /**
   * Re-anchor the x-window around `anchorVal` scaling its span by `factor`,
   * clamped to [minWindow, maxWindow]. Sets followed=false (user took over).
   */
  function zoomX(anchorVal: number, factor: number): void {
    followed = false;
    const span = Math.min(Math.max((xMax - xMin) * factor, minWindow), maxWindow);
    // Keep the fraction of the window left of the cursor fixed while the
    // total span changes.
    xMin = anchorVal - (anchorVal - xMin) * factor;
    xMax = xMin + span;
  }

  let expanded = false;
  function setExpanded(v: boolean): void {
    expanded = v;
  }

  /** Re-read width/height and push the new size into uPlot. */
  function sizeChart(): void {
    const w = Math.max(holder.clientWidth || wrap.clientWidth, 200);
    // The expanded overlay (see .plot-expanded) is a viewport-fixed box, so
    // its clientHeight reflects the fullscreen size; otherwise use the fixed
    // per-plot height.
    const h = expanded ? Math.max((wrap.clientHeight || 600) - holder.offsetTop - 12, 160) : baseHeight;
    chart.setSize({ width: Math.round(w), height: Math.round(h) });
  }

  // Immediately establish the real initial window so uPlot doesn't lock in a
  // degenerate range from the empty seed data.
  resetView();

  function setSeriesShown(index: number, shown: boolean): void {
    chart.setSeries(index, { show: shown });
  }

  // ---- Zoom (ctrl/cmd + wheel, anchored at cursor) ----
  chart.over.addEventListener("wheel", (e: WheelEvent) => {
    if (!isZoomGesture(e)) return;
    e.preventDefault();

    const factor = e.deltaY > 0 ? PLOT_ZOOM_STEP : 1 / PLOT_ZOOM_STEP;
    const cx = chart.posToVal(e.offsetX, "x");
    zoomX(cx, factor);

    // Y zoom anchored at the cursor; snapshot the auto-fit to manual first
    // so the zoom is anchored to what's currently on screen.
    if (yAuto) {
      fitY();
      yAuto = false;
    }
    const cy = chart.posToVal(e.offsetY, "y");
    const nyMin = cy - (cy - yMin) / factor;
    const nyMax = cy + (yMax - cy) / factor;
    if (nyMax - nyMin > 1e-9) {
      yMin = nyMin;
      yMax = nyMax;
    }
    applyScales();
  });

  // ---- Pan (drag) ----
  let panning = false;
  let panLast = { x: 0, y: 0 };

  const unbindPan = bindPointerInput(chart.over, {
    onDown: (x, y) => {
      panning = true;
      panLast = { x, y };
    },
    onMove: (x, y) => {
      if (!panning) return;
      const dxPx = x - panLast.x;
      const dyPx = y - panLast.y;
      panLast = { x, y };

      const span = followed ? windowSeconds : xMax - xMin;
      const sPerPx = span / Math.max(chart.over.clientWidth, 1);
      if (dxPx !== 0) {
        if (followed) {
          // Dragging backs the view off the live edge into explicit mode.
          followed = false;
          xMin = Math.max(0, tNow - windowSeconds);
          xMax = tNow;
        }
        xMin -= dxPx * sPerPx;
        xMax -= dxPx * sPerPx;
      }

      if (dyPx !== 0) {
        if (yAuto) {
          // Freeze the current fit so vertical drag can pan it.
          fitY();
          yAuto = false;
        }
        const vPerPx = (yMax - yMin) / Math.max(chart.over.clientHeight, 1);
        yMin += dyPx * vPerPx;
        yMax += dyPx * vPerPx;
      }
      applyScales();
    },
    onUp: () => {
      panning = false;
    },
  });
  chart.over.addEventListener("dblclick", resetView);

  // Keep the chart sized to its container; also handles expand/collapse and
  // window resizes while expanded (the overlay is viewport-fixed).
  const resize = new ResizeObserver(() => sizeChart());
  resize.observe(wrap);

  function push(t: number, values: Record<string, number>): void {
    tNow = t;
    buffer.push({ t, values });
    const cutoff = t - maxWindow;
    while (buffer.length > 1 && buffer[0]!.t < cutoff) buffer.shift();
  }

  function render(): void {
    const n = buffer.length;
    if (n === 0) return;
    if (!sawFirstData) {
      // First real data: replace the pre-data initial window so the chart
      // immediately frames the incoming samples instead of showing blank
      // space from the construction-time scale.
      sawFirstData = true;
      resetView();
    }
    const xs = new Array(n);
    const cols: Array<Array<number | null>> = series.map(() => new Array(n).fill(null));
    for (let i = 0; i < n; i++) {
      const { t, values } = buffer[i]!;
      xs[i] = t;
      for (let s = 0; s < series.length; s++) {
        const v = values[series[s]!.key];
        if (v !== undefined) cols[s]![i] = v;
      }
    }
    syncX();
    if (yAuto) fitY();
    chart.batch(() => {
      chart.setData([xs as number[], ...cols] as unknown as uPlot.AlignedData);
      chart.setScale("x", { min: xMin, max: xMax });
      chart.setScale("y", { min: yMin, max: yMax });
    });
  }

  function reset(): void {
    buffer = [];
    resetView();
  }

  function destroy(): void {
    resize.disconnect();
    unbindPan();
    chart.destroy();
  }

  return { push, render, reset, resetView, setSeriesShown, setExpanded, sizeChart, destroy };
}

export const TimeSeriesPlot = forwardRef<TimeSeriesPlotHandle, TimeSeriesPlotProps>(
  function TimeSeriesPlot(props, ref) {
    const wrapRef = useRef<HTMLDivElement>(null);
    const holderRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<Engine | null>(null);
    const [expanded, setExpanded] = useState(false);
    const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());

    useEffect(() => {
      const engine = createEngine({
        series: props.series,
        windowSeconds: props.windowSeconds,
        minWindow: props.minWindowSeconds ?? 2,
        maxWindow: props.maxWindowSeconds ?? 120,
        baseHeight: props.height ?? 220,
        wrap: wrapRef.current!,
        holder: holderRef.current!,
      });
      engineRef.current = engine;
      return () => engine.destroy();
      // Config is fixed for the lifetime of a panel in this demo — mount-once.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Re-size after the expanded overlay's class lands in the DOM.
    useEffect(() => {
      engineRef.current?.setExpanded(expanded);
      engineRef.current?.sizeChart();
    }, [expanded]);

    useImperativeHandle(
      ref,
      () => ({
        push: (t, values) => engineRef.current?.push(t, values),
        render: () => engineRef.current?.render(),
        reset: () => engineRef.current?.reset(),
      }),
      [],
    );

    return (
      <div class={`plot${expanded ? " plot-expanded" : ""}`} ref={wrapRef}>
        <div class="plot-header">
          {props.yLabel && <div class="plot-title">{props.yLabel}</div>}
          <div class="plot-controls">
            <button
              type="button"
              class="plot-expand"
              title={expanded ? "Collapse" : "Expand"}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? <CollapseIcon /> : <ExpandIcon />}
            </button>
            <button type="button" class="plot-reset" onClick={() => engineRef.current?.resetView()}>
              reset zoom
            </button>
          </div>
        </div>
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
              // Series index in the uPlot data/series arrays is offset by 1
              // (index 0 is the x axis).
              const i = props.series.findIndex((s) => s.key === key);
              engineRef.current?.setSeriesShown(i + 1, nextShown);
            }}
          />
        </div>
        <div class="plot-chart" ref={holderRef} />
      </div>
    );
  },
);
