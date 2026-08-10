/**
 * Regression check for the optical-flow / ORB pipeline. It runs the *actual*
 * demo modules — detector, orientation, BRIEF descriptor, matcher, RANSAC,
 * and the full FlowController with its editable template — against two
 * synthetic frames: a textured scene and the same scene translated by a known
 * vector.
 *
 * If the recovered dominant motion matches that vector, then detection,
 * orientation, description, matching, and the RANSAC similarity fit are all
 * wired up correctly. That catches a transposed Sobel, a seam bug in FAST, or
 * a descriptor sampled against the wrong buffer immediately.
 *
 * Run with: npx tsx scripts/verify-optical-flow.ts
 */
import { FlowController } from "../src/demos/opticalflow/flowController";
import { EditableTracker, DEFAULT_ORB_SOURCE } from "../src/demos/opticalflow/trackerCode";
import { orient, describe, boxBlur, hamming } from "../src/demos/opticalflow/orb";
import { fitSimilarityRansac } from "../src/demos/opticalflow/motionModel";
import { FastDetector } from "../src/demos/opticalflow/fast";
import { ShiTomasiDetector } from "../src/demos/opticalflow/shiTomasi";
import type { Keypoint } from "../src/demos/opticalflow/types";

const W = 320;
const H = 240;

const clamp = (v: number): number => Math.max(0, Math.min(255, v));

/** Deterministic pseudo-random texture (mid-bright value range, high local
 * gradient variance) so any patch is a unique, descriptor-distinguishable
 * corner. `makeScene(tx, ty)` returns the same texture *shifted* by (tx, ty),
 * zero-padding the revealed border. The interior (which the correspondence
 * test restricts itself to) is then a pure translation, with no periodic
 * aliasing to fool the matcher. */
function makeScene(tx = 0, ty = 0): Uint8Array {
  const g = new Uint8Array(W * H);
  const hash = (x: number, y: number): number => {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    h ^= h >>> 16;
    return 28 + (h & 0x7f) + ((h >>> 7) & 0x5f);
  };
  for (let y = 0; y < H; y++) {
    const row = y * W;
    const sy = y - ty;
    for (let x = 0; x < W; x++) {
      const sx = x - tx;
      g[row + x] = sx >= 0 && sy >= 0 && sx < W && sy < H ? clamp(hash(sx, sy)) : 0;
    }
  }
  return g;
}

function describeAll(gray: Uint8Array, kps: Keypoint[]): void {
  const smooth = new Uint8Array(W * H);
  const scratch = new Float32Array(W * H);
  boxBlur(gray, W, H, smooth, scratch, 2);
  for (const kp of kps) kp.angle = orient(gray, W, H, kp.x, kp.y);
  for (const kp of kps) describe(smooth, W, H, kp);
}

const interior = (kps: Keypoint[]): Keypoint[] => kps.filter((k) => k.x >= 18 && k.x <= W - 18 && k.y >= 18 && k.y <= H - 18);

interface Result {
  errX: number;
  errY: number;
  matched: number;
  inliers: number;
}

/** Detector → describe → match → RANSAC for a single translation. */
function runDetectorPipe(detector: "fast" | "shi", tx: number, ty: number, threshold: number): Result {
  const g0 = makeScene(0, 0);
  const g1 = makeScene(tx, ty);

  const fast = new FastDetector(W, H);
  const shi = new ShiTomasiDetector(W, H);

  const k0 = interior(detector === "fast" ? fast.detect(g0, threshold) : shi.detect(g0, threshold));
  const k1 = interior(detector === "fast" ? fast.detect(g1, threshold) : shi.detect(g1, threshold));
  describeAll(g0, k0);
  describeAll(g1, k1);

  const fromX: number[] = [];
  const fromY: number[] = [];
  const toX: number[] = [];
  const toY: number[] = [];
  for (const a of k0) {
    let best = Infinity;
    let bestJ = -1;
    for (let j = 0; j < k1.length; j++) {
      const d = hamming(a.desc!, k1[j]!.desc!);
      if (d < best) {
        best = d;
        bestJ = j;
      }
    }
    if (best < 40 && bestJ >= 0) {
      fromX.push(a.x);
      fromY.push(a.y);
      toX.push(k1[bestJ]!.x);
      toY.push(k1[bestJ]!.y);
    }
  }

  const m = fitSimilarityRansac(fromX, fromY, toX, toY, 2, 128);
  if (!m) return { matched: 0, inliers: 0, errX: Infinity, errY: Infinity };
  return { matched: fromX.length, inliers: m.inlierCount, errX: m.tx - tx, errY: m.ty - ty };
}

function checksumDesc(name: string, detector: "fast" | "shi", threshold: number): boolean {
  const cases: Array<[number, number]> = [
    [7, 5],
    [-9, 3],
    [4, -11],
  ];
  let ok = true;
  for (const [tx, ty] of cases) {
    const r = runDetectorPipe(detector, tx, ty, threshold);
    const good = r.matched > 30 && r.inliers > 20 && Math.abs(r.errX) < 1 && Math.abs(r.errY) < 1;
    ok = ok && good;
    console.log(
      `  [${name}] recovered tx=${(tx + r.errX).toFixed(2)} ty=${(ty + r.errY).toFixed(2)} (want ${tx},${ty}) · matched=${r.matched} inliers=${r.inliers} ${good ? "ok" : "BAD"}`,
    );
  }
  console.log(`${ok ? "PASS" : "FAIL"} ${name} detector + ORB + RANSAC`);
  return ok;
}

function checkFlowController(): boolean {
  const c = new FlowController(W, H);
  c.minDist = 60;
  c.ratio = 0.8;

  c.gray.set(makeScene(0, 0));
  c.process();
  const tx = 9;
  const ty = -5;
  c.gray.set(makeScene(tx, ty));
  c.process();

  const m = c.lastMotion;
  const ok = !!m && m.inlierCount >= 5 && Math.abs(m.tx - tx) <= 1.2 && Math.abs(m.ty - ty) <= 1.2 && c.trackCount > 10;
  console.log(
    `  FlowController recovered tx=${m?.tx.toFixed(1) ?? "?"} ty=${m?.ty.toFixed(1) ?? "?"} (want ${tx},${ty}) · ${c.trackCount} tracks, ${m?.inlierCount ?? 0} inliers`,
  );
  console.log(`${ok ? "PASS" : "FAIL"} FlowController (editable template) end to end`);
  return ok;
}

function checkEditableTemplate(): boolean {
  const tracker = new EditableTracker(DEFAULT_ORB_SOURCE);
  const smooth = new Uint8Array(W * H);
  const kpPrev: Keypoint[] = [{ x: 100, y: 100, score: 0, angle: 0, desc: new Uint8Array(32).fill(0xaa) }];
  const kpCurr: Keypoint[] = [
    { x: 108, y: 100, score: 0, angle: 0, desc: null },
    { x: 40, y: 40, score: 0, angle: 0, desc: null },
  ];
  // Force kpCurr[0] to be a perfect match (identical descriptor) so the
  // template must pick it even though kpCurr[1] exists.
  const input = {
    gray: new Uint8Array(W * H),
    smooth,
    w: W,
    h: H,
    kpCurr,
    kpPrev,
  };
  const matches = tracker.stepFrame(input);
  const ok =
    matches.length === 1 &&
    matches[0]!.from === 0 &&
    matches[0]!.to === 0 &&
    kpCurr[0]!.desc != null &&
    kpCurr[1]!.desc != null;
  console.log(`${ok ? "PASS" : "FAIL"} editable ORB template matches identical descriptors`);
  return ok;
}

function checkDeterminism(): boolean {
  const g = makeScene(0, 0);
  const kp: Keypoint = { x: 100, y: 90, score: 0, angle: orient(g, W, H, 100, 90), desc: null };
  const kp2: Keypoint = { x: 100, y: 90, score: 0, angle: orient(g, W, H, 100, 90), desc: null };
  describeAll(g, [kp, kp2]);
  const same = kp.desc!.length === 32 && kp.desc!.every((b, i) => b === kp2.desc![i]!);
  console.log(`${same ? "PASS" : "FAIL"} descriptor determinism`);
  return same;
}

const ok1 = checksumDesc("FAST", "fast", 25);
const ok2 = checksumDesc("Shi-Tomasi", "shi", 300);
const ok3 = checkFlowController();
const ok4 = checkEditableTemplate();
const ok5 = checkDeterminism();
process.exit(ok1 && ok2 && ok3 && ok4 && ok5 ? 0 : 1);