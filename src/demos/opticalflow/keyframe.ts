import type { FeatureMatch, Keypoint } from "./types";
import { hamming } from "./orb";

/** A held reference frame: the keypoints (with descriptors) from one chosen
 * frame. Current keypoints are also matched against this set, so you can pin
 * a frame, wave the camera around, and watch tracks that left the view for a
 * moment get re-associated when they come back — the "match against a
 * reference, not just the previous frame" idea behind feature-based SLAM. */
export class PinnedReference {
  private kp: Keypoint[] = [];

  /** Snapshot the current keypoints. Descriptors are copied (the array
   * handed in is reused/overwritten by the tracker each frame). */
  pin(kp: Keypoint[]): void {
    this.kp = kp.map((k) => ({ x: k.x, y: k.y, score: k.score, angle: k.angle, desc: k.desc }));
  }

  clear(): void {
    this.kp = [];
  }

  get hasFrame(): boolean {
    return this.kp.length > 0;
  }

  get count(): number {
    return this.kp.length;
  }

  /** The pinned keypoint at an index (or null if out of range). */
  keypointAt(idx: number): Keypoint | undefined {
    return this.kp[idx];
  }

  /** Match the pinned reference's descriptors to the current keypoints.
   * Returns null when nothing is pinned. `current` must already be described
   * (the tracker does that). `from` indexes this.pinned's keypoints, `to`
   * indexes `current` — alignment is preserved so the overlay can draw lines
   * between the two positions. */
  match(current: Keypoint[], minDist: number, ratio: number): FeatureMatch[] | null {
    if (this.kp.length === 0) return null;
    const matches: FeatureMatch[] = [];
    for (let i = 0; i < this.kp.length; i++) {
      const a = this.kp[i]!.desc;
      if (!a) continue;
      let best = Infinity;
      let second = Infinity;
      let bestJ = -1;
      for (let j = 0; j < current.length; j++) {
        const b = current[j]!.desc;
        if (!b) continue;
        const d = hamming(a, b);
        if (d < best) {
          second = best;
          best = d;
          bestJ = j;
        } else if (d < second) {
          second = d;
        }
      }
      if (best < minDist && best < ratio * second) {
        matches.push({ from: i, to: bestJ, dist: best });
      }
    }
    return matches;
  }
}
