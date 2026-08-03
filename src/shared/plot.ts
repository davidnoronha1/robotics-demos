import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

export interface SeriesSpec {
  key: string;
  label: string;
  color: string;
}

export interface TimeSeriesPlot {
  el: HTMLElement;
  push(t: number, values: Record<string, number>): void;
  render(): void;
  reset(): void;
  destroy(): void;
}

const AXIS_COLOR = "#888";
const GRID_COLOR = "#8888882a";

/**
 * Streaming time-series chart backed by uPlot: full-width (ResizeObserver),
 * wheel-zoom + drag-pan on both axes, double-click to reset. The x axis
 * scrolls with a rolling window; the y axis auto-fits unless the user zooms.
 */
export function createTimeSeriesPlot(opts: {
  series: SeriesSpec[];
  windowSeconds: number;
  yLabel?: string;
  height?: number;
  minWindowSeconds?: number;
  maxWindowSeconds?: number;
}): TimeSeriesPlot {
  const height = opts.height ?? 220;
  const windowSeconds = opts.windowSeconds;
  const minWindow = opts.minWindowSeconds ?? 2;
  const maxWindow = opts.maxWindowSeconds ?? 120;

  const wrap = document.createElement("div");
  wrap.className = "plot";

  const legend = document.createElement("div");
  legend.className = "plot-legend";
  for (const s of opts.series) {
    const item = document.createElement("span");
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = s.color;
    item.append(swatch, document.createTextNode(s.label));
    legend.appendChild(item);
  }
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "plot-reset";
  resetBtn.textContent = "reset zoom";
  legend.appendChild(resetBtn);
  wrap.appendChild(legend);

  const holder = document.createElement("div");
  holder.className = "plot-chart";
  wrap.appendChild(holder);

  const chart = new uPlot(
    {
      width: 640,
      height,
      padding: [8, 8, 8, 8],
      scales: {
        // Sim time is relative seconds (0, 0.01, …), not epoch milliseconds —
        // a `time` scale would label the axis as 1970 dates and can lock in a
        // degenerate range on first render. Plain linear is what we want.
        x: { time: false },
        y: { auto: true },
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
          label: opts.yLabel ?? "",
          size: 54,
        },
      ],
      legend: { show: false },
      cursor: { y: true, drag: { x: false, y: false } },
      series: [
        {},
        ...opts.series.map((s) => ({ label: s.label, stroke: s.color, width: 1.75 })),
      ],
    },
    [new Array(10).fill(0), ...opts.series.map(() => new Array(10).fill(NaN))],
    holder,
  );

  let buffer: Array<{ t: number; values: Record<string, number> }> = [];
  let tNow = 0;

  // Current view. xSpan = visible window in seconds, anchored so that
  // viewXMax == tNow unless the user panned back in time.
  let xSpan = windowSeconds;
  let xMaxPinned: number | null = null; // null => follow tNow
  let yMode: "auto" | "manual" = "auto";
  let yMin = 0;
  let yMax = 1;
  let yBaseMin = 0;
  let yBaseMax = 1;

  function viewXMin(): number {
    const xMax = xMaxPinned ?? tNow;
    return xMax - xSpan;
  }

  function applyScales(): void {
    chart.setScale("x", { min: viewXMin(), max: xMaxPinned ?? tNow });
    if (yMode === "manual") chart.setScale("y", { min: yMin, max: yMax });
  }

  function resetView(): void {
    xSpan = windowSeconds;
    xMaxPinned = null;
    yMode = "auto";
    applyScales();
  }

  // uPlot's own auto-range from the placeholder all-zero seed data picks a
  // degenerate x-axis window (and locks in a coarse date-based tick format)
  // that later setScale calls during normal streaming don't fully correct —
  // set the real initial window immediately so the chart isn't stuck
  // showing a multi-year axis until the user manually clicks "reset zoom".
  applyScales();

  resetBtn.addEventListener("click", resetView);

  // Wheel zoom (both axes, anchored at the cursor) + drag pan + dblclick reset.
  let panning = false;
  let panLast = { x: 0, y: 0 };

  chart.over.addEventListener("wheel", (e: WheelEvent) => {
    e.preventDefault();
    const cx = chart.posToVal(e.offsetX, "x");
    const cy = chart.posToVal(e.offsetY, "y");
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;

    const xMin = viewXMin();
    const xMax = xMaxPinned ?? tNow;
    const nxMin = cx - (cx - xMin) * factor;
    const nxMax = cx + (xMax - cx) * factor;
    xSpan = Math.min(Math.max(nxMax - nxMin, minWindow), maxWindow);
    xMaxPinned = nxMax;

    if (yMode === "auto") {
      const ys = chart.scales.y;
      if (ys) {
        yBaseMin = ys.min ?? -1;
        yBaseMax = ys.max ?? 1;
        yMin = yBaseMin;
        yMax = yBaseMax;
        yMode = "manual";
      }
    }
    const nyMin = cy - (cy - yMin) * factor;
    const nyMax = cy + (yMax - cy) * factor;
    if (nyMax - nyMin > 1e-9) {
      yMin = nyMin;
      yMax = nyMax;
    }
    applyScales();
  });

  chart.over.addEventListener("pointerdown", (e: PointerEvent) => {
    panning = true;
    panLast = { x: e.offsetX, y: e.offsetY };
    chart.over.setPointerCapture(e.pointerId);
  });
  chart.over.addEventListener("pointermove", (e: PointerEvent) => {
    if (!panning) return;
    const dxPx = e.offsetX - panLast.x;
    const dyPx = e.offsetY - panLast.y;
    panLast = { x: e.offsetX, y: e.offsetY };
    const spanSeconds = xSpan;
    const sPerPx = spanSeconds / Math.max(chart.over.clientWidth, 1);
    if (xMaxPinned != null || dxPx !== 0) {
      xMaxPinned = (xMaxPinned ?? tNow) - dxPx * sPerPx;
    }
    if (yMode === "manual" && dyPx !== 0) {
      const vPerPx = (yMax - yMin) / Math.max(chart.over.clientHeight, 1);
      yMin += dyPx * vPerPx;
      yMax += dyPx * vPerPx;
    }
    applyScales();
  });
  const stopPan = (e: PointerEvent) => {
    panning = false;
    if (chart.over.hasPointerCapture(e.pointerId)) chart.over.releasePointerCapture(e.pointerId);
  };
  chart.over.addEventListener("pointerup", stopPan);
  chart.over.addEventListener("pointercancel", stopPan);
  chart.over.addEventListener("dblclick", resetView);

  const resize = new ResizeObserver(() => {
    const w = Math.max(holder.clientWidth, 200);
    chart.setSize({ width: w, height });
  });
  resize.observe(wrap);

  function push(t: number, values: Record<string, number>): void {
    tNow = t;
    buffer.push({ t, values });
    const cutoff = t - maxWindow;
    while (buffer.length > 1 && buffer[0]!.t < cutoff) buffer.shift();
  }

  // uPlot's own layout/auto-ranging on construction happens before any real
  // data exists (only the placeholder seed rows), so the explicit
  // `applyScales()` call above can get clobbered by uPlot's first internal
  // render pass. Forcing the view once more, right as real data first
  // arrives, is what "reset zoom" was doing manually — do it automatically
  // instead of leaving the chart stuck until the user notices and clicks it.
  let sawFirstData = false;

  function render(): void {
    const n = buffer.length;
    if (n === 0) return;
    if (!sawFirstData) {
      sawFirstData = true;
      resetView();
    }
    const xs = new Array(n);
    const cols: Array<Array<number | null>> = opts.series.map(() => new Array(n).fill(null));
    for (let i = 0; i < n; i++) {
      const { t, values } = buffer[i]!;
      xs[i] = t;
      for (let s = 0; s < opts.series.length; s++) {
        const v = values[opts.series[s]!.key];
        if (v !== undefined) cols[s]![i] = v;
      }
    }
    chart.setData([xs as number[], ...cols] as unknown as uPlot.AlignedData);
    applyScales();
    chart.redraw();
  }

  function reset(): void {
    buffer = [];
    resetView();
  }

  function destroy(): void {
    resize.disconnect();
    chart.destroy();
  }

  return { el: wrap, push, render, reset, destroy };
}
