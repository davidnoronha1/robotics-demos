import type { SeriesSpec } from "./TimeSeriesPlot";

/** Click-to-toggle legend entries shared by the time-series and polar plots.
 * `onToggle` receives the series key and the visibility it should have after
 * the click. Renders bare `.legend-item` spans (no wrapping element) so
 * callers can place them inside their own `.plot-legend` container alongside
 * other controls (reset buttons, readouts). */
export function PlotLegend({
  series,
  hidden,
  onToggle,
}: {
  series: SeriesSpec[];
  hidden: ReadonlySet<string>;
  onToggle: (key: string, nextShown: boolean) => void;
}) {
  return (
    <>
      {series.map((s) => {
        const shown = !hidden.has(s.key);
        return (
          <span key={s.key} class={`legend-item${shown ? "" : " legend-off"}`} onClick={() => onToggle(s.key, !shown)}>
            <span class="swatch" style={{ background: s.color }} />
            {s.label}
          </span>
        );
      })}
    </>
  );
}
