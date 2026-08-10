import { forwardRef, useImperativeHandle, useRef } from "preact/compat";
import { RADIUS, RING } from "./fastGeometries";

/** The teaching inset: a magnified view of the pixels around the hovered
 * spot with the FAST-9 ring drawn on top, each ring pixel colored by its
 * classification against the center — brighter (green), darker (red), or
 * similar (neutral). This is the entire FAST test made visible.
 *
 * Exposes `render()` via ref so the demo loop can redraw it every frame. */

export interface FastInsetHandle {
  render(): void;
}

export interface FastInsetProps {
  gray: Uint8Array;
  w: number;
  h: number;
  /** Pixel being inspected, or null when the mouse isn't over the feed. */
  x: number | null;
  y: number | null;
  threshold: number;
}

const PATCH = RADIUS + 1; // ±4 pixels so the whole ring + context is visible
const CELL = 14; // display px per source pixel

const CENTER = "#ffffff";
const BRIGHT = "#5fb87a";
const DARK = "#e0605c";
const SIMILAR = "rgba(255,255,255,0.35)";

export const FastInset = forwardRef<FastInsetHandle, FastInsetProps>(function FastInset(
  { gray, w, h, x, y, threshold },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useImperativeHandle(ref, () => ({
    render() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = (PATCH * 2 + 1) * CELL;
      if (canvas.width !== Math.round(size * dpr)) {
        canvas.width = Math.round(size * dpr);
        canvas.height = Math.round(size * dpr);
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.fillStyle = "#0d1117";
      ctx.fillRect(0, 0, size, size);

      if (x == null || y == null) {
        ctx.fillStyle = "#88909c";
        ctx.font = "12px monospace";
        ctx.textAlign = "center";
        ctx.fillText("hover the feed to inspect", size / 2, size / 2);
        return;
      }

      const cx = Math.round(x);
      const cy = Math.round(y);
      const centerIdx = cy * w + cx;
      if (centerIdx < 0 || centerIdx >= w * h) return;

      const sample = (px: number, py: number): number =>
        gray[Math.max(0, Math.min(h - 1, py)) * w + Math.max(0, Math.min(w - 1, px))]!;

      const centerVal = sample(cx, cy);

      // Grayscale patch.
      for (let dy = -PATCH; dy <= PATCH; dy++) {
        for (let dx = -PATCH; dx <= PATCH; dx++) {
          const v = sample(cx + dx, cy + dy);
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect((dx + PATCH) * CELL, (dy + PATCH) * CELL, CELL, CELL);
        }
      }

      // FAST ring, colored by classification.
      for (const [dx, dy] of RING) {
        const v = sample(cx + dx, cy + dy);
        const cls = v > centerVal + threshold ? BRIGHT : v < centerVal - threshold ? DARK : SIMILAR;
        ctx.fillStyle = cls;
        ctx.globalAlpha = cls === SIMILAR ? 0.5 : 0.85;
        ctx.fillRect((dx + PATCH) * CELL, (dy + PATCH) * CELL, CELL, CELL);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "#0008";
        ctx.lineWidth = 1;
        ctx.strokeRect((dx + PATCH) * CELL + 0.5, (dy + PATCH) * CELL + 0.5, CELL - 1, CELL - 1);
      }

      // Center pixel highlight.
      ctx.strokeStyle = CENTER;
      ctx.lineWidth = 2;
      ctx.strokeRect(PATCH * CELL + 1, PATCH * CELL + 1, CELL - 2, CELL - 2);
    },
  }));

  return (
    <div class="of-inset">
      <canvas ref={canvasRef} />
      <div class="of-inset-legend">
        <span>
          <span class="of-dot" style={{ background: BRIGHT }} /> brighter than center ± t
        </span>
        <span>
          <span class="of-dot" style={{ background: DARK }} /> darker than center ± t
        </span>
        <span>
          <span class="of-dot" style={{ background: SIMILAR, border: "1px solid #666" }} /> similar
        </span>
        <span>≥ 9 of these in a row → corner</span>
      </div>
    </div>
  );
});
