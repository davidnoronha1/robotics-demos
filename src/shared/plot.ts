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
 */
export function createTimeSeriesPlot(opts: {
  series: SeriesSpec[];
  windowSeconds: number;
  yLabel?: string;
  height?: number;
  minWindowSeconds?: number;
  maxWindowSeconds?: number;
}): TimeSeriesPlot {
  const baseHeight = opts.height ?? 220;
  const windowSeconds = opts.windowSeconds;
  const minWindow = opts.minWindowSeconds ?? 2;
  const maxWindow = opts.maxWindowSeconds ?? 120;

  const wrap = document.createElement("div");
  wrap.className = "plot";

  // ---- Header: title on the left, controls on the right, legend below ----
  const header = document.createElement("div");
  header.className = "plot-header";

  if (opts.yLabel) {
    const title = document.createElement("div");
    title.className = "plot-title";
    title.textContent = opts.yLabel;
    header.appendChild(title);
  }

  const controls = document.createElement("div");
  controls.className = "plot-controls";

  const EXPAND_ICON =
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2H2v4M10 2h4v4M2 10v4h4M14 10v4h-4"/></svg>';
  const COLLAPSE_ICON =
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

  const expandBtn = document.createElement("button");
  expandBtn.type = "button";
  expandBtn.className = "plot-expand";
  expandBtn.innerHTML = EXPAND_ICON;
  expandBtn.title = "Expand";
  controls.appendChild(expandBtn);

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "plot-reset";
  resetBtn.textContent = "reset zoom";
  controls.appendChild(resetBtn);

  header.appendChild(controls);
  wrap.appendChild(header);

  const legend = document.createElement("div");
  legend.className = "plot-legend";
  opts.series.forEach((s, i) => {
    const item = document.createElement("span");
    item.className = "legend-item";
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = s.color;
    item.append(swatch, document.createTextNode(s.label));
    // Click a legend entry to show/hide that series — series index in the
    // uPlot data/series arrays is offset by 1 (index 0 is the x axis).
    item.addEventListener("click", () => {
      const seriesIdx = i + 1;
      const shown = chart.series[seriesIdx]!.show;
      chart.setSeries(seriesIdx, { show: !shown });
      item.classList.toggle("legend-off", shown);
    });
    legend.appendChild(item);
  });
  wrap.appendChild(legend);

  const holder = document.createElement("div");
  holder.className = "plot-chart";
  wrap.appendChild(holder);

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
      series: [
        {},
        ...opts.series.map((s) => ({ label: s.label, stroke: s.color, width: 1.75 })),
      ],
    },
    [[], ...opts.series.map(() => [])],
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

  // ---- Expand state ----
  let expanded = false;
  let currentHeight = baseHeight;

  // ---- Core scale helpers ----

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
      for (let s = 0; s < opts.series.length; s++) {
        const v = p.values[opts.series[s]!.key];
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

  // ---- Expand / collapse ----
  function setExpanded(next: boolean): void {
    if (next === expanded) return;
    expanded = next;
    wrap.classList.toggle("plot-expanded", expanded);
    expandBtn.innerHTML = expanded ? COLLAPSE_ICON : EXPAND_ICON;
    expandBtn.title = expanded ? "Collapse" : "Expand";
    sizeChart();
  }

  /** Re-read width/height and push the new size into uPlot. */
  function sizeChart(): void {
    const w = Math.max(holder.clientWidth || wrap.clientWidth, 200);
    if (expanded) {
      // Fill the overlay: full width, and height minus the header+legend chrome.
      const chrome = holder.offsetTop;
      const h = Math.max((wrap.clientHeight || 600) - chrome - 12, 160);
      currentHeight = h;
    } else {
      currentHeight = baseHeight;
    }
    chart.setSize({ width: Math.round(w), height: Math.round(currentHeight) });
  }

  // Immediately establish the real initial window so uPlot doesn't lock in a
  // degenerate range from the empty seed data.
  resetView();

  resetBtn.addEventListener("click", resetView);
  expandBtn.addEventListener("click", () => setExpanded(!expanded));

  // ---- Zoom (ctrl/cmd + wheel, anchored at cursor) ----
  chart.over.addEventListener("wheel", (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();

    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
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
  });
  const stopPan = (e: PointerEvent) => {
    panning = false;
    if (chart.over.hasPointerCapture(e.pointerId)) chart.over.releasePointerCapture(e.pointerId);
  };
  chart.over.addEventListener("pointerup", stopPan);
  chart.over.addEventListener("pointercancel", stopPan);
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

  let sawFirstData = false;

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
    const cols: Array<Array<number | null>> = opts.series.map(() => new Array(n).fill(null));
    for (let i = 0; i < n; i++) {
      const { t, values } = buffer[i]!;
      xs[i] = t;
      for (let s = 0; s < opts.series.length; s++) {
        const v = values[opts.series[s]!.key];
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
    chart.destroy();
  }

  return { el: wrap, push, render, reset, destroy };
}