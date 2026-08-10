/** Dominant-motion estimation: fit a 2D *similarity transform* (scale +
 * rotation + translation) to the tracked feature displacements with RANSAC,
 * so a few wild/bad matches can't drag the estimate. This is what drives the
 * "panning left, 12 px/frame" readout and the inlier/outlier coloring.
 *
 * A similarity transform maps (x, y) → (x', y') with
 *   x' = a·x − b·y + tx      y' = b·x + a·y + ty
 * where scale = √(a²+b²) and rotation = atan2(b, a). It is the cheapest model
 * that still distinguishes pan / tilt / zoom / spin — 2 point pairs give an
 * exact solution, which suits RANSAC. */

export interface SimilarityMotion {
  a: number;
  b: number;
  tx: number;
  ty: number;
  scale: number;
  angleDeg: number;
  /** One boolean per correspondence, aligned with the input arrays. */
  inliers: boolean[];
  inlierCount: number;
}

interface LsResult {
  a: number;
  b: number;
  tx: number;
  ty: number;
}

/** Least-squares similarity fit (Umeyama-style) on a set of correspondences.
 * `fitLS` below also works as the 2-pair RANSAC solver: with 2 distinct
 * points the centroid equations give the exact transform. */
function fitLS(fromX: number[], fromY: number[], toX: number[], toY: number[], count: number): LsResult {
  let scx = 0;
  let scy = 0;
  let tcx = 0;
  let tcy = 0;
  for (let i = 0; i < count; i++) {
    scx += fromX[i]!;
    scy += fromY[i]!;
    tcx += toX[i]!;
    tcy += toY[i]!;
  }
  scx /= count;
  scy /= count;
  tcx /= count;
  tcy /= count;

  let denom = 0;
  let numA = 0;
  let numB = 0;
  for (let i = 0; i < count; i++) {
    const x = fromX[i]! - scx;
    const y = fromY[i]! - scy;
    const u = toX[i]! - tcx;
    const v = toY[i]! - tcy;
    denom += x * x + y * y;
    numA += x * u + y * v;
    numB += x * v - y * u;
  }
  const a = numA / denom;
  const b = numB / denom;
  const tx = tcx - (a * scx - b * scy);
  const ty = tcy - (b * scx + a * scy);
  return { a, b, tx, ty };
}

const residual = (
  m: LsResult,
  fromX: number[],
  fromY: number[],
  toX: number[],
  toY: number[],
  idx: number,
): number => {
  const ex = toX[idx]! - (m.a * fromX[idx]! - m.b * fromY[idx]! + m.tx);
  const ey = toY[idx]! - (m.b * fromX[idx]! + m.a * fromY[idx]! + m.ty);
  return ex * ex + ey * ey;
};

/** RANSAC similarity fit. Returns null when there are too few correspondences
 * to fit (fewer than 2). `tol` is the inlier threshold in pixels. */
export function fitSimilarityRansac(
  fromX: number[],
  fromY: number[],
  toX: number[],
  toY: number[],
  tol = 2,
  iterations = 64,
): SimilarityMotion | null {
  const count = fromX.length;
  const inliers = new Array<boolean>(count).fill(false);
  if (count < 2) return null;
  if (count === 2) {
    const m = fitLS(fromX, fromY, toX, toY, count);
    return {
      ...m,
      scale: Math.hypot(m.a, m.b),
      angleDeg: (Math.atan2(m.b, m.a) * 180) / Math.PI,
      inliers,
      inlierCount: 2,
    };
  }

  const tol2 = tol * tol;
  let best: LsResult | null = null;
  let bestCount = 0;

  for (let iter = 0; iter < iterations; iter++) {
    // Pick 2 distinct correspondences.
    let i = Math.floor(Math.random() * count);
    let j = Math.floor(Math.random() * count);
    if (i === j) j = (j + 1) % count;
    const m = fitLS([fromX[i]!, fromX[j]!], [fromY[i]!, fromY[j]!], [toX[i]!, toX[j]!], [toY[i]!, toY[j]!], 2);
    if (!Number.isFinite(m.a)) continue;

    let n = 0;
    for (let k = 0; k < count; k++) {
      if (residual(m, fromX, fromY, toX, toY, k) <= tol2) n++;
    }
    if (n > bestCount) {
      best = m;
      bestCount = n;
      if (n === count) break; // all inliers — nothing left to find
    }
  }

  if (!best) return null;

  // Refine on all inliers.
  const inIdx: number[] = [];
  for (let k = 0; k < count; k++) {
    if (residual(best, fromX, fromY, toX, toY, k) <= tol2) inIdx.push(k);
  }
  if (inIdx.length >= 2) {
    const subset = (arr: number[]): number[] => inIdx.map((k) => arr[k]!);
    best = fitLS(subset(fromX), subset(fromY), subset(toX), subset(toY), inIdx.length);
  }
  bestCount = inIdx.length;
  for (const k of inIdx) inliers[k] = true;

  return {
    a: best.a,
    b: best.b,
    tx: best.tx,
    ty: best.ty,
    scale: Math.hypot(best.a, best.b),
    angleDeg: (Math.atan2(best.b, best.a) * 180) / Math.PI,
    inliers,
    inlierCount: bestCount,
  };
}
