import { RADIUS, RING } from "./fastGeometries";
import type { Keypoint } from "./types";

/** FAST-9 detector with non-maximum suppression.
 *
 * A `FastDetector` holds the score buffer (reused across frames, no GC churn)
 * for a fixed resolution. `detect` fills and returns the surviving keypoints.
 *
 * FAST tests the 16 pixels on a radius-3 circle around a center `c`. A corner
 * exists if at least 9 *contiguous* ring pixels are all brighter (or all
 * darker) than `c` by more than `threshold`. The score is the summed intensity
 * gap of the best qualifying arc, which feeds a cheap 3×3 non-maximum
 * suppression so corners don't cluster. */
export class FastDetector {
  private scores: Float32Array;
  private classify: Int8Array;

  constructor(
    private readonly w: number,
    private readonly h: number,
  ) {
    this.scores = new Float32Array(w * h);
    // Doubled so a >9 arc that crosses the ring seam (indices wrap 16→0) is
    // still seen as one run: copies 16..31 mirror 0..15.
    this.classify = new Int8Array(32);
  }

  detect(gray: Uint8Array, threshold: number, out?: Keypoint[]): Keypoint[] {
    const { w, h, scores, classify } = this;
    const result = out ?? [];
    result.length = 0;
    scores.fill(0);

    for (let y = RADIUS; y < h - RADIUS; y++) {
      const rowBase = y * w;
      for (let x = RADIUS; x < w - RADIUS; x++) {
        const idx = rowBase + x;
        const c = gray[idx]!;

        let pos = 0; // count of ring pixels brighter than c + t
        let neg = 0; // count of ring pixels darker than c - t
        for (let i = 0; i < 16; i++) {
          const v = gray[idx + RING[i]![1] * w + RING[i]![0]]!;
          if (v > c + threshold) {
            classify[i] = 1;
            pos++;
          } else if (v < c - threshold) {
            classify[i] = -1;
            neg++;
          } else {
            classify[i] = 0;
          }
        }
        // Necessary condition: a contiguous run of ≥9 of one polarity needs
        // at least 9 pixels of that polarity in total. Most pixels (flat or
        // texture-less neighbourhoods) fail this and skip the scan.
        if (pos < 9 && neg < 9) {
          scores[idx] = 0;
          continue;
        }
        for (let i = 0; i < 16; i++) classify[16 + i] = classify[i]!;

        // Find the best (longest) contiguous run of each polarity and its
        // summed gap. Iterate over the doubled buffer but only start runs in
        // the first copy (positions 0..15), so each real arc is visited once.
        let score = 0;
        let i = 0;
        while (i < 16) {
          const s = classify[i]!;
          if (s === 0) {
            i++;
            continue;
          }
          let j = i;
          let arcLen = 0;
          let gap = 0;
          while (j < 32 && classify[j] === s) {
            const ringIdx = idx + RING[j % 16]![1] * w + RING[j % 16]![0];
            const v = gray[ringIdx]!;
            if (s > 0) gap += v - c;
            else gap += c - v;
            arcLen++;
            j++;
          }
          if (arcLen >= 9 && gap > score) score = gap;
          i = j; // skip past this whole run (j may exceed 15; loop guard ends it)
        }

        scores[idx] = score;
      }
    }

    // Non-maximum suppression: keep a candidate only if no 3×3 neighbour has
    // a strictly higher score.
    for (let y = RADIUS; y < h - RADIUS; y++) {
      const rowBase = y * w;
      for (let x = RADIUS; x < w - RADIUS; x++) {
        const idx = rowBase + x;
        const s = scores[idx]!;
        if (s <= 0) continue;
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