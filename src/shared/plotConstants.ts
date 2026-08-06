/** Wheel-zoom step shared by the time-series and polar plots (their zoom
 * math differs — one scales a data-space span, the other a geometric
 * magnification — but both zoom by this same ratio per wheel tick). */
export const PLOT_ZOOM_STEP = 1.12;

/** Require a modifier so scrolling the page past a plot doesn't silently zoom it. */
export function isZoomGesture(e: WheelEvent): boolean {
  return e.ctrlKey || e.metaKey;
}
