import { forwardRef } from "preact/compat";
import { useEffect, useImperativeHandle, useRef } from "preact/hooks";
import { createTimeSeriesPlot, type SeriesSpec, type TimeSeriesPlot } from "./plot";

export interface PlotPanelHandle {
  push(t: number, values: Record<string, number>): void;
  render(): void;
  reset(): void;
}

export interface PlotPanelProps {
  series: SeriesSpec[];
  yLabel?: string;
  height?: number;
  windowSeconds: number;
  minWindowSeconds?: number;
  maxWindowSeconds?: number;
}

/**
 * Thin Preact wrapper around the imperative uPlot-backed TimeSeriesPlot.
 * Pushes/renders happen through the ref handle, bypassing Preact's render
 * cycle entirely — the sim loop calls straight into uPlot, same as before,
 * since re-rendering a component 100x/sec for a streaming chart makes no
 * sense. Preact only owns creating/destroying the chart with the component's
 * lifecycle (fixing the leak the old vanilla-DOM version had on remount).
 */
export const PlotPanel = forwardRef<PlotPanelHandle, PlotPanelProps>(function PlotPanel(props, ref) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<TimeSeriesPlot | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const plot = createTimeSeriesPlot(props);
    plotRef.current = plot;
    host.appendChild(plot.el);
    return () => {
      plot.destroy();
      plotRef.current = null;
      host.removeChild(plot.el);
    };
    // Series/window config are fixed for the lifetime of a panel in this
    // demo — intentionally mount-once, not reactive to prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      push: (t, values) => plotRef.current?.push(t, values),
      render: () => plotRef.current?.render(),
      reset: () => plotRef.current?.reset(),
    }),
    [],
  );

  return <div ref={hostRef} />;
});
