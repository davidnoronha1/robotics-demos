import { TRAIL_MAX } from "./types";
import type { Keypoint } from "./types";
import type { Track } from "./flowController";
import type { SimilarityMotion } from "./motionModel";

/** Draws the vision overlay onto a canvas whose backing store is the 320×240
 * gray resolution, stretched via CSS to sit directly on top of the cover-
 * cropped video — so pixel coordinates map 1:1 onto what's visible. */

export interface OverlayState {
  tracks: readonly Track[];
  keypoints: readonly Keypoint[];
  /** (x0, y0, x1, y1) lines from pinned keypoints to their current match. */
  pinLines: ReadonlyArray<readonly [number, number, number, number]>;
  motion: SimilarityMotion | null;
  showTracks: boolean;
  showCorners: boolean;
  showMotion: boolean;
  showPin: boolean;
  /** Loupe pixels in grayscale (what the detector sees) vs. RGB color. */
  loupeColor: boolean;
  /** Hovered point (in gray-buffer pixel space) + the buffers to sample —
   * draws the pixel-grid loupe. Null hides it. */
  hover: { x: number; y: number; gray: Uint8Array; color: Uint8ClampedArray; grayW: number; grayH: number } | null;
}

const INLIER = "#5fb87a";
const OUTLIER = "#e0605c";
const CORNER = "#39ff14";
const PIN = "#c678dd";

export function drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, s: OverlayState): void {
  ctx.clearRect(0, 0, w, h);

  if (s.showPin) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = PIN;
    ctx.globalAlpha = 0.45;
    for (const [x0, y0, x1, y1] of s.pinLines) {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.fillStyle = PIN;
      ctx.beginPath();
      ctx.arc(x1, y1, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (s.showTracks) {
    ctx.lineWidth = 1.5;
    for (const t of s.tracks) {
      if (t.trailCount < 2) continue;
      ctx.strokeStyle = t.inlier ? INLIER : OUTLIER;
      const start = (t.trailHead - t.trailCount + TRAIL_MAX) % TRAIL_MAX;
      ctx.beginPath();
      for (let k = 0; k < t.trailCount; k++) {
        const idx = (start + k) % TRAIL_MAX;
        const x = t.trailX[idx]!;
        const y = t.trailY[idx]!;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  if (s.showCorners) {
    ctx.fillStyle = CORNER;
    for (const kp of s.keypoints) {
      ctx.beginPath();
      ctx.arc(kp.x, kp.y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (s.showMotion && s.motion && s.motion.inlierCount >= 2) {
    drawMotionArrow(ctx, w, h, s.motion);
  }

  if (s.hover) drawLoupe(ctx, s.hover, s.loupeColor);
}

const LOUPE_RADIUS = 46;
const LOUPE_ZOOM = 10;

/** A magnifying-glass loupe: a circle of exploded, gridded pixels centered
 * exactly on the hovered point — "what the detector actually sees" made
 * literal (or the true color, when `colorOn`). */
function drawLoupe(
  ctx: CanvasRenderingContext2D,
  hover: { x: number; y: number; gray: Uint8Array; color: Uint8ClampedArray; grayW: number; grayH: number },
  colorOn: boolean,
): void {
  const { x: cx, y: cy, gray, color, grayW, grayH } = hover;
  const px = Math.round(cx);
  const py = Math.round(cy);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, LOUPE_RADIUS, 0, Math.PI * 2);
  ctx.save();
  ctx.clip();

  const half = Math.ceil(LOUPE_RADIUS / LOUPE_ZOOM) + 1;
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const sx = Math.max(0, Math.min(grayW - 1, px + dx));
      const sy = Math.max(0, Math.min(grayH - 1, py + dy));
      const i = sy * grayW + sx;
      if (colorOn && color.length >= (i + 1) * 4) {
        ctx.fillStyle = `rgb(${color[i * 4]},${color[i * 4 + 1]},${color[i * 4 + 2]})`;
      } else {
        const v = gray[i]!;
        ctx.fillStyle = `rgb(${v},${v},${v})`;
      }
      ctx.fillRect(cx + dx * LOUPE_ZOOM - LOUPE_ZOOM / 2, cy + dy * LOUPE_ZOOM - LOUPE_ZOOM / 2, LOUPE_ZOOM, LOUPE_ZOOM);
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(cx + dx * LOUPE_ZOOM - LOUPE_ZOOM / 2, cy + dy * LOUPE_ZOOM - LOUPE_ZOOM / 2, LOUPE_ZOOM, LOUPE_ZOOM);
    }
  }

  // Highlight the exact pixel under the cursor.
  ctx.strokeStyle = "#f2c14e";
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - LOUPE_ZOOM / 2, cy - LOUPE_ZOOM / 2, LOUPE_ZOOM, LOUPE_ZOOM);
  ctx.restore();

  ctx.lineWidth = 0.75;
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.beginPath();
  ctx.arc(cx, cy, LOUPE_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Dominant-motion cue in the corner: a vector arrow for the translation,
 * plus a dashed ring that grows with rotation and zoom. */
function drawMotionArrow(ctx: CanvasRenderingContext2D, w: number, h: number, m: SimilarityMotion): void {
  const cx = w - 34;
  const cy = h - 30;
  const scale = 2.2; // px of arrow per px of per-frame motion
  const dx = m.tx * scale;
  const dy = m.ty * scale;

  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = INLIER;
  ctx.fillStyle = INLIER;

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + dx, cy + dy);
  ctx.stroke();
  const ang = Math.atan2(dy, dx);
  const head = 6;
  ctx.beginPath();
  ctx.moveTo(cx + dx, cy + dy);
  ctx.lineTo(cx + dx - head * Math.cos(ang - 0.45), cy + dy - head * Math.sin(ang - 0.45));
  ctx.moveTo(cx + dx, cy + dy);
  ctx.lineTo(cx + dx - head * Math.cos(ang + 0.45), cy + dy - head * Math.sin(ang + 0.45));
  ctx.stroke();

  if (Math.abs(m.angleDeg) >= 0.2 || Math.abs(m.scale - 1) >= 0.01) {
    ctx.globalAlpha = 0.7;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(cx, cy, 10 + Math.min(Math.abs(m.angleDeg), 12) + Math.abs(m.scale - 1) * 40, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}
