import { HALF_PATCH } from "./types";
import type { FeatureMatch, Keypoint } from "./types";
import { describe, hamming, orient, PAIR_LIST } from "./orb";
import { extractParams, injectParams } from "../../shared/codeParams";

/** The editable tracker. The controller runs the (fixed) corner detector and
 * orientation, then calls the compiled template to describe the current
 * keypoints and match them to the previous frame's. The match loop, the ratio
 * test, and the `params` block are all user-editable source — exactly like the
 * IMU demo's editable fusion code. */

export interface TrackerInput {
  /** Raw current-frame grayscale (un-blurred). */
  gray: Uint8Array;
  /** Pre-smoothed current frame — what descriptor sampling reads. */
  smooth: Uint8Array;
  w: number;
  h: number;
  /** Keypoints detected in the current frame (un-described). The template is
   * expected to fill `kp.desc` on these. */
  kpCurr: Keypoint[];
  /** The previous frame's keypoints, already carrying descriptors. */
  kpPrev: Keypoint[];
}

export type TrackerStep = (input: TrackerInput) => FeatureMatch[];

const mathNS = {
  describe,
  orient,
  hamming,
  pairs: PAIR_LIST,
  HALF_PATCH,
};

export const DEFAULT_ORB_SOURCE = `// tracker-template: orb
// Match the previous frame's keypoints to the current frame's by their
// binary BRIEF descriptors. Descriptors are computed below (math.describe
// samples the pre-blurred image at the keypoint at its orientation), then
// every previous keypoint is compared to every current one by Hamming
// distance — count of bits that differ. A match only survives the Lowe ratio
// test: it must clearly beat its runner-up, so ambiguous / flat patches don't
// sneak in.
const params = {
  minDist: 50,   // Hamming ceiling: a "good" match is below this
  ratio: 0.75,   // Lowe ratio: best must beat second-best by this factor
};

function step(input) {
  const { smooth, w, h, kpCurr, kpPrev } = input;
  for (const kp of kpCurr) kp.desc = math.describe(smooth, w, h, kp);

  const matches = [];
  for (let i = 0; i < kpPrev.length; i++) {
    const a = kpPrev[i].desc;
    if (!a) continue;
    let best = Infinity;
    let second = Infinity;
    let bestJ = -1;
    for (let j = 0; j < kpCurr.length; j++) {
      const d = math.hamming(a, kpCurr[j].desc);
      if (d < best) { second = best; best = d; bestJ = j; }
      else if (d < second) second = d;
    }
    if (best < params.minDist && best < params.ratio * second) {
      matches.push({ from: i, to: bestJ, dist: best });
    }
  }
  return matches;
}

return step;
`;

export interface TrackerParams {
  minDist?: number;
  ratio?: number;
  [key: string]: unknown;
}

export function compileTracker(source: string): { step?: TrackerStep; templateId?: string; error?: string } {
  const templateId = /tracker-template:\s*(\w+)/.exec(source)?.[1] ?? "custom";
  try {
    const factory = new Function("math", `"use strict";\n${source}\n`);
    const step = factory(mathNS) as unknown;
    if (typeof step !== "function") return { error: "Your code must end with `return step;` (a function)." };
    return { step: step as TrackerStep, templateId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Wraps a compiled tracker template so it can be hot-swapped at runtime, with
 * the previous frame's descriptors surviving a recompile. */
export class EditableTracker {
  private step: TrackerStep;
  templateId: string;
  /** Set when the applied step throws mid-frame; cleared on the next success. */
  runtimeError: string | null = null;

  constructor(source: string) {
    const r = compileTracker(source);
    this.step = r.step ?? compileTracker(DEFAULT_ORB_SOURCE).step!;
    this.templateId = r.templateId ?? "generic";
  }

  setSource(source: string): { ok: boolean; error?: string } {
    const r = compileTracker(source);
    if (r.error || !r.step) return { ok: false, error: r.error };
    this.step = r.step;
    this.templateId = r.templateId ?? "generic";
    this.runtimeError = null;
    return { ok: true };
  }

  stepFrame(input: TrackerInput): FeatureMatch[] {
    try {
      const matches = this.step(input);
      this.runtimeError = null;
      return matches;
    } catch (e) {
      this.runtimeError = e instanceof Error ? e.message : String(e);
      return [];
    }
  }
}

export { extractParams, injectParams };