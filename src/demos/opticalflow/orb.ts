import { BRIEF_BYTES, BRIEF_BITS, HALF_PATCH, type FeatureMatch, type Keypoint } from "./types";

/** The ORB core: orientation via the intensity centroid, the rotated BRIEF
 * binary descriptor, Hamming matching, and the Gaussian pre-smoothing that
 * descriptor sampling needs.
 *
 * The 256 pair offsets are generated once, deterministically (seeded PRNG),
 * so every frame — and every tab/session — samples the *same* positions;
 * otherwise descriptors from different frames could never match. */

// --- seeded RNG so the sampling pattern is stable across runs ------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x9e3779b9);
const gaussian = (): number => {
  // Box–Muller; one spare value is wasted, which is fine for a fixed seed.
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** The 256 (x1,y1,x2,y2) offsets, integer-rounded from a Gaussian with
 * σ = HALF_PATCH/3 (≈5) — matching BRIEF's recommended sampling, clipped to
 * the patch. */
export const PAIR_LIST: ReadonlyArray<readonly [number, number, number, number]> = (() => {
  const pairs: Array<readonly [number, number, number, number]> = [];
  for (let i = 0; i < BRIEF_BITS; i++) {
    const p = (): [number, number] => [
      clamp(Math.round(gaussian() * (HALF_PATCH / 3)), -HALF_PATCH, HALF_PATCH),
      clamp(Math.round(gaussian() * (HALF_PATCH / 3)), -HALF_PATCH, HALF_PATCH),
    ];
    const [x1, y1] = p();
    const [x2, y2] = p();
    pairs.push([x1, y1, x2, y2]);
  }
  return pairs;
})();

/** Circle-patch offsets for the intensity centroid (radius HALF_PATCH). */
const CENTROID_OFFSETS: Array<readonly [number, number]> = (() => {
  const out: Array<readonly [number, number]> = [];
  const r2 = HALF_PATCH * HALF_PATCH;
  for (let dy = -HALF_PATCH; dy <= HALF_PATCH; dy++) {
    for (let dx = -HALF_PATCH; dx <= HALF_PATCH; dx++) {
      if (dx * dx + dy * dy <= r2) out.push([dx, dy]);
    }
  }
  return out;
})();

/** Orientation by the intensity centroid (the "O" in ORB). The centroid of
 * the patch, weighted by intensity, points somewhere off-center; its angle
 * from the keypoint is a repeatable orientation. */
export function orient(gray: Uint8Array, w: number, h: number, x: number, y: number): number {
  let m10 = 0;
  let m01 = 0;
  for (const [dx, dy] of CENTROID_OFFSETS) {
    const px = x + dx;
    const py = y + dy;
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    m10 += dx * gray[py * w + px]!;
    m01 += dy * gray[py * w + px]!;
  }
  return Math.atan2(m01, m10);
}

/** Separable box blur (radius `r`, default 2 → 5×5). BRIEF's bit tests are
 * extraordinarily sensitive to single-pixel noise; OpenCV pre-blurs with a
 * 5×5 box. Sampling the blurred image makes matches far more stable. */
export function boxBlur(
  gray: Uint8Array,
  w: number,
  h: number,
  out: Uint8Array,
  scratch: Float32Array,
  r = 2,
): void {
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      let n = 0;
      for (let dx = -r; dx <= r; dx++) {
        const px = clamp(x + dx, 0, w - 1);
        acc += gray[row + px]!;
        n++;
      }
      scratch[row + x] = acc / n;
    }
  }
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let acc = 0;
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const py = clamp(y + dy, 0, h - 1);
        acc += scratch[py * w + x]!;
        n++;
      }
      out[row + x] = Math.round(acc / n);
    }
  }
}

const sampleClamped = (img: Uint8Array, w: number, h: number, x: number, y: number): number =>
  img[clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)]!;

/** Compute the rotated BRIEF-256 descriptor for a keypoint. `smooth` is the
 * pre-blurred frame; `kp.angle` steers the sampling pattern (rotation
 * invariance). Fills `kp.desc` and returns it. */
export function describe(
  smooth: Uint8Array,
  w: number,
  h: number,
  kp: Keypoint,
  pairs: ReadonlyArray<readonly [number, number, number, number]> = PAIR_LIST,
): Uint8Array {
  const desc = new Uint8Array(BRIEF_BYTES);
  const ca = Math.cos(kp.angle);
  const sa = Math.sin(kp.angle);
  const cx = Math.round(kp.x);
  const cy = Math.round(kp.y);
  let byte = 0;
  let byteIdx = 0;
  for (const [ax, ay, bx, by] of pairs) {
    const p1x = cx + Math.round(ax * ca - ay * sa);
    const p1y = cy + Math.round(ax * sa + ay * ca);
    const p2x = cx + Math.round(bx * ca - by * sa);
    const p2y = cy + Math.round(bx * sa + by * ca);
    if (sampleClamped(smooth, w, h, p1x, p1y) < sampleClamped(smooth, w, h, p2x, p2y)) {
      byte |= 1 << (byteIdx % 8);
    }
    byteIdx++;
    if (byteIdx % 8 === 0) {
      desc[byteIdx / 8 - 1] = byte;
      byte = 0;
    }
  }
  kp.desc = desc;
  return desc;
}

/** Hamming distance between two binary descriptors (popcount of their XOR).
 * Random descriptors of this length sit near 128; a good match is ≪ that. */
export function hamming(a: Uint8Array, b: Uint8Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += POPCOUNT[a[i]! ^ b[i]!]!;
  return d;
}

const POPCOUNT: Uint8Array = (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let n = i;
    let bits = 0;
    while (n) {
      bits += n & 1;
      n >>>= 1;
    }
    table[i] = bits;
  }
  return table;
})();

/** One-directional descriptor matching with Lowe's ratio test: a match is
 * only kept when the best distance is below `minDist` *and* beats the
 * second-best by at least the `ratio` factor. `fromDesc[i]` matches
 * `toDesc[j]`; the caller keeps the arrays parallel to its own keypoints. */
export function matchDescs(
  fromDesc: ReadonlyArray<Uint8Array>,
  toDesc: ReadonlyArray<Uint8Array>,
  minDist: number,
  ratio: number,
): FeatureMatch[] {
  const matches: FeatureMatch[] = [];
  for (let i = 0; i < fromDesc.length; i++) {
    const a = fromDesc[i]!;
    let best = Infinity;
    let second = Infinity;
    let bestJ = -1;
    for (let j = 0; j < toDesc.length; j++) {
      const d = hamming(a, toDesc[j]!);
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
