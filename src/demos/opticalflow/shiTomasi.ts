import type { Keypoint } from "./types";

/** Shi–Tomasi corner detector (the "good features to track" criterion).
 *
 * A pixel is a corner when both eigenvalues of its patch's second-moment
 * (structure) matrix are large, i.e. the image varies sharply in two
 * directions. The score is the smaller eigenvalue λ_min; a high minimum means
 * a well-conditioned corner that Lucas–Kanade / descriptor matching can track
 * without the aperture problem.
 *
 * Buffers are allocated per-resolution and reused across frames. */
export class ShiTomasiDetector {
  private ix: Int16Array; // Sobel x-gradient (Int16 to cover [-2040, 2040])
  private iy: Int16Array; // Sobel y-gradient
  private scores: Float32Array;

  constructor(
    private readonly w: number,
    private readonly h: number,
  ) {
    this.ix = new Int16Array(w * h);
    this.iy = new Int16Array(w * h);
    this.scores = new Float32Array(w * h);
  }

  detect(gray: Uint8Array, minEigen: number, out?: Keypoint[]): Keypoint[] {
    const { w, h, ix, iy, scores } = this;
    const result = out ?? [];
    result.length = 0;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        // Sobel 3×3, centered at (x, y):
        //   Gx = (p[x-1,y+1] + 2p[x,y+1] + p[x+1,y+1])
        //      - (p[x-1,y-1] + 2p[x,y-1] + p[x+1,y-1])
        //   Gy = (p[x-1,y-1] + 2p[x-1,y] + p[x-1,y+1])
        //      - (p[x+1,y-1] + 2p[x+1,y] + p[x+1,y+1])
        // Note y increases downward, so "Gy" here takes the standard sign
        // convention; the direction does not matter for the tensor.
        const gx =
          (gray[idx - w - 1]! + 2 * gray[idx - 1]! + gray[idx + w - 1]!) -
          (gray[idx - w + 1]! + 2 * gray[idx + 1]! + gray[idx + w + 1]!);
        const gy =
          (gray[idx - w - 1]! + 2 * gray[idx - w]! + gray[idx - w + 1]!) -
          (gray[idx + w - 1]! + 2 * gray[idx + w]! + gray[idx + w + 1]!);
        ix[idx] = gx;
        iy[idx] = gy;
      }
    }

    // Accumulate the structure tensor over a 3×3 window (a straightforward
    // windowed sum — clarity over micro-opt; 3×3 windows at 320×240 are
    // cheap enough at these gradients).
    const W = 1; // window half-width (3×3 window)
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let sumA = 0;
        let sumB = 0;
        let sumC = 0;
        for (let dy = -W; dy <= W; dy++) {
          const row = (y + dy) * w;
          for (let dx = -W; dx <= W; dx++) {
            const gx = ix[row + x + dx]!;
            const gy = iy[row + x + dx]!;
            sumA += gx * gx;
            sumB += gx * gy;
            sumC += gy * gy;
          }
        }
        const idx = y * w + x;
        // λ_min = (A+C)/2 − sqrt((A−C)²/4 + B²)
        const half = (sumA + sumC) / 2;
        const root = Math.sqrt(((sumA - sumC) * (sumA - sumC)) / 4 + sumB * sumB);
        scores[idx] = half - root;
      }
    }

    // Non-maximum suppression over a 3×3 window, threshold on minEigen.
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = y * w + x;
        const s = scores[idx]!;
        if (s < minEigen) continue;
        let suppressed = false;
        for (let dy = -1; dy <= 1 && !suppressed; dy++) {
          const nb = (y + dy) * w;
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (scores[nb + x + dx]! > s) {
              suppressed = true;
              break;
            }
          }
        }
        if (!suppressed) result.push({ x, y, score: s, angle: 0, desc: null });
      }
    }

    return result;
  }
}