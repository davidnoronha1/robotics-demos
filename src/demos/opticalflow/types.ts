/** Shared types for the optical-flow / feature-tracking demo. */

/** A keypoint found by a detector (FAST or Shi–Tomasi), with its orientation
 * (intensity centroid) and, once the tracker has described it, a binary
 * BRIEF descriptor. */
export interface Keypoint {
  x: number;
  y: number;
  /** Detector response — FAST score or Shi–Tomasi min eigenvalue. */
  score: number;
  /** Orientation in radians (intensity centroid). 0 until assigned. */
  angle: number;
  /** BRIEF-256 binary descriptor (32 bytes); null until described. */
  desc: Uint8Array | null;
}

/** An index pair produced by the editable tracker: kpPrev[from] matched
 * kpCurr[to] with Hamming distance `dist`. */
export interface FeatureMatch {
  from: number;
  to: number;
  dist: number;
}

export const BRIEF_BITS = 256;
export const BRIEF_BYTES = BRIEF_BITS / 8;
export const HALF_PATCH = 15;
export const TRAIL_MAX = 8;