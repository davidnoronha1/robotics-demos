import { FastDetector } from "./fast";
import { ShiTomasiDetector } from "./shiTomasi";
import { boxBlur, orient } from "./orb";
import { EditableTracker, DEFAULT_ORB_SOURCE, type TrackerInput } from "./trackerCode";
import { fitSimilarityRansac, type SimilarityMotion } from "./motionModel";
import { PinnedReference } from "./keyframe";
import { TRAIL_MAX, type FeatureMatch, type Keypoint } from "./types";

export type DetectorId = "fast" | "shi";

/** A persistent feature: matched across frames by descriptor, keeping a short
 * trail of its recent positions for the overlay. */
export interface Track {
  id: number;
  /** Current best-known position (where it was last matched). */
  x: number;
  y: number;
  /** Position before the most recent match — this frame's displacement. */
  px: number;
  py: number;
  angle: number;
  age: number;
  missed: number;
  /** Frame number in which it was last matched (used to detect stragglers). */
  lastMatchedFrame: number;
  /** Last descriptor, refreshed on each match. */
  desc: Uint8Array | null;
  trailX: Float32Array;
  trailY: Float32Array;
  trailCount: number;
  trailHead: number;
  inlier: boolean;
}

const MISS_DROP = 4; // consecutive missed frames before a track is culled
const MAX_JUMP_SQ = 60 * 60; // squared max allowed per-frame displacement

const pushTrail = (t: Track, x: number, y: number): void => {
  const head = t.trailHead;
  t.trailX[head] = x;
  t.trailY[head] = y;
  t.trailHead = (head + 1) % TRAIL_MAX;
  if (t.trailCount < TRAIL_MAX) t.trailCount++;
};

/** Orchestrates the whole pipeline. The App writes a fresh grayscale frame
 * into `gray`, then calls `process()`; the frame runs detector → orient →
 * describe → match → persist → RANSAC and updates the overlay readouts. All
 * intermediate buffers are reused to keep GC chatter low. */
export class FlowController {
  readonly w: number;
  readonly h: number;
  /** Grayscale buffer the App's capture writes into before each process(). */
  readonly gray: Uint8Array;
  private smooth: Uint8Array;
  private blurScratch: Float32Array;
  private fast: FastDetector;
  private shi: ShiTomasiDetector;
  readonly tracker: EditableTracker;

  detector: DetectorId = "fast";
  fastThreshold = 25;
  shiMinThreshold = 300;
  maxTracks = 150;
  /** Match params (kept in sync with the editable template's param block). */
  minDist = 50;
  ratio = 0.75;

  private tracks: Track[] = [];
  private nextId = 1;
  private frameNumber = 0;

  /** Keypoints of the last processed frame (for the corner overlay). */
  lastKeypoints: Keypoint[] = [];
  lastMotion: SimilarityMotion | null = null;
  lastPinMatches: FeatureMatch[] | null = null;
  /** (pinned→current) line pairs for the overlay, when a frame is pinned. */
  lastPinLines: Array<[number, number, number, number]> = [];
  readonly pinned = new PinnedReference();

  private mFromX: number[] = [];
  private mFromY: number[] = [];
  private mToX: number[] = [];
  private mToY: number[] = [];

  constructor(w = 320, h = 240) {
    this.w = w;
    this.h = h;
    this.gray = new Uint8Array(w * h);
    this.smooth = new Uint8Array(w * h);
    this.blurScratch = new Float32Array(w * h);
    this.fast = new FastDetector(w, h);
    this.shi = new ShiTomasiDetector(w, h);
    this.tracker = new EditableTracker(DEFAULT_ORB_SOURCE);
  }

  process(): void {
    const { w, h, gray } = this;
    this.frameNumber++;
    const frame = this.frameNumber;

    // 1. Detect keypoints in the raw frame.
    const kpCurr =
      this.detector === "fast"
        ? this.fast.detect(gray, this.fastThreshold)
        : this.shi.detect(gray, this.shiMinThreshold);

    // 2. Orient via the intensity centroid (on raw gray, not blurred).
    for (const kp of kpCurr) kp.angle = orient(gray, w, h, kp.x, kp.y);

    // 3. Pre-smooth for descriptor sampling.
    boxBlur(gray, w, h, this.smooth, this.blurScratch);

    // 4. Previous-frame keypoint set = the tracked points (with descriptors).
    const kpPrev: Keypoint[] = [];
    for (const t of this.tracks) {
      kpPrev.push({ x: t.x, y: t.y, score: 0, angle: t.angle, desc: t.desc });
    }

    // 5. Editable tracker: describe current keypoints + match prev → curr.
    const input: TrackerInput = { gray, smooth: this.smooth, w, h, kpCurr, kpPrev };
    const matches = this.tracker.stepFrame(input);

    // 6. Apply matches greedily (best distance first); one current keypoint
    //    can satisfy at most one track.
    const claimed = new Uint8Array(kpCurr.length);
    matches.sort((ma, mb) => ma.dist - mb.dist);
    for (const m of matches) {
      const kp = kpCurr[m.to];
      const t = this.tracks[m.from];
      if (!kp || !t || claimed[m.to]) continue;
      const dx = kp.x - t.x;
      const dy = kp.y - t.y;
      if (dx * dx + dy * dy > MAX_JUMP_SQ) continue; // implausible — drop
      claimed[m.to] = 1;
      t.px = t.x;
      t.py = t.y;
      t.x = kp.x;
      t.y = kp.y;
      t.angle = kp.angle;
      t.desc = kp.desc;
      t.lastMatchedFrame = frame;
      pushTrail(t, kp.x, kp.y);
    }

    // 7. Bookkeeping: age everything, reset missed on still-matched tracks,
    //    and collect correspondences for the motion fit.
    this.mFromX.length = 0;
    this.mFromY.length = 0;
    this.mToX.length = 0;
    this.mToY.length = 0;
    for (const t of this.tracks) {
      t.age++;
      if (t.lastMatchedFrame === frame) {
        t.missed = 0;
        this.mFromX.push(t.px);
        this.mFromY.push(t.py);
        this.mToX.push(t.x);
        this.mToY.push(t.y);
      } else {
        t.missed++;
      }
    }

    // 8. Dominant motion (RANSAC similarity) + per-track inlier flag.
    this.lastMotion =
      this.mFromX.length >= 2 ? fitSimilarityRansac(this.mFromX, this.mFromY, this.mToX, this.mToY, 2, 64) : null;
    const inliers = this.lastMotion?.inliers;
    for (let i = 0; i < this.tracks.length; i++) this.tracks[i]!.inlier = !!inliers?.[i];

    // 9. Back-fill: promote unclaimed current keypoints to new tracks.
    for (let j = 0; j < kpCurr.length && this.tracks.length < this.maxTracks; j++) {
      if (claimed[j]) continue;
      const kp = kpCurr[j]!;
      const t: Track = {
        id: this.nextId++,
        x: kp.x,
        y: kp.y,
        px: kp.x,
        py: kp.y,
        angle: kp.angle,
        age: 0,
        missed: 0,
        lastMatchedFrame: -1,
        desc: kp.desc,
        trailX: new Float32Array(TRAIL_MAX),
        trailY: new Float32Array(TRAIL_MAX),
        trailCount: 0,
        trailHead: 0,
        inlier: false,
      };
      pushTrail(t, kp.x, kp.y);
      this.tracks.push(t);
    }

    // 10. Cull: gone too long, or out of frame.
    this.tracks = this.tracks.filter(
      (t) => t.missed < MISS_DROP && t.x >= 2 && t.x <= w - 3 && t.y >= 2 && t.y <= h - 3,
    );

    // 11. Pin-reference matches (overlay lines), if a frame is pinned.
    if (this.pinned.hasFrame) {
      this.lastPinMatches = this.pinned.match(kpCurr, this.minDist, this.ratio);
      const lines: Array<[number, number, number, number]> = [];
      const pinned = this.pinned;
      for (const m of this.lastPinMatches ?? []) {
        const from = pinned.keypointAt(m.from);
        const to = kpCurr[m.to];
        if (from && to) lines.push([from.x, from.y, to.x, to.y]);
      }
      this.lastPinLines = lines;
    } else {
      this.lastPinMatches = null;
      this.lastPinLines = [];
    }

    // 12. Corners for the overlay.
    this.lastKeypoints = kpCurr;
  }

  pinCurrent(): void {
    if (this.lastKeypoints.length > 0) this.pinned.pin(this.lastKeypoints);
  }

  clearPinned(): void {
    this.pinned.clear();
  }

  resetTracks(): void {
    this.tracks = [];
    this.nextId = 1;
    this.lastMotion = null;
    this.lastPinMatches = null;
  }

  get trackCount(): number {
    return this.tracks.length;
  }

  getTrackSnapshot(): readonly Track[] {
    return this.tracks;
  }
}