import * as THREE from "three";
import { Matrix, inverse } from "ml-matrix";
import type { ImuSample } from "./estimators";
import { WORLD_G, WORLD_M } from "./sensorInput";
import {
  bodyFrame,
  bodyJacobian,
  eulerOf,
  gyroMatrix,
  integrate,
  magHeading,
  skew,
  tiltFromAccel,
  withYaw,
} from "./quaternion";

/** Namespace injected into the editable fusion code so it can use the demo's
 * attitude helpers (three.js math underneath). */
const mathNS = {
  THREE,
  Matrix,
  inverse,
  integrate,
  tiltFromAccel,
  withYaw,
  magHeading,
  bodyFrame,
  bodyJacobian, // kept for experimentation; the shipped EKF below doesn't use it (see note there)
  gyroMatrix, // ditto
  skew,
  eulerOf,
  REF_G: WORLD_G, // world gravity reference
  REF_M: WORLD_M, // world magnetic-field reference (relocked on real devices)
  diag: (v: number[]) => {
    const m = Matrix.eye(v.length);
    v.forEach((x, i) => m.set(i, i, x));
    return m;
  },
};

export interface FusionState {
  q: THREE.Quaternion;
  P: number[][]; // 3×3 covariance of the local attitude-error vector (rad)
}

export type FusionStep = (state: FusionState, sample: ImuSample) => FusionState;

export interface FusionParams {
  qScale?: number;
  rAccel?: [number, number, number];
  rMag?: [number, number, number];
  alpha?: number;
  useMagYaw?: boolean;
  [key: string]: unknown;
}

/** Default EKF template. Every equation is tied to a `params` value the
 * sliders can rewrite (see the block at the top). */
export const DEFAULT_EKF_SOURCE = `// fusion-template: ekf
// Attitude EKF (multiplicative / error-state form). Fuses the gyro (motion
// model) with the accelerometer and magnetometer (measurements) using their
// covariances as trust values.
//
// The state is the attitude quaternion q PLUS the 3x3 covariance of a small
// body-frame attitude-error vector deltaTheta (not the raw quaternion
// components) — corrections are applied by *composing* a small rotation
// onto q, never by adding to q's [x,y,z,w] numbers directly. That distinction
// matters: q's components don't live on a flat space (q stays on the unit
// sphere), so a correction expressed in the raw components leaks into axes
// it has no business touching — e.g. an accel-only correction (which should
// only ever adjust tilt, never heading) visibly drags the heading around.
// Working in the local error vector avoids that.
//
// state  : { q: THREE.Quaternion, P: Matrix (3x3 attitude-error covariance) }
// sample : { gyro:[wx,wy,wz], accel:[ax,ay,az], mag:[mx,my,mz]|null, dt }
//
// params : trust values — edit them here, or let the sliders rewrite this
//          block for you (the "link" checkbox wires them up).
const params = {
  qScale: 0.0001,                       // process noise / second (higher = trust gyro less)
  rAccel: [0.0025, 0.0025, 0.0025],     // accel covariance, per axis (m/s^2)^2
  rMag: [4, 4, 4],                      // mag covariance, per axis (uT)^2
};

// World-frame references the synthetic sensors measure against. These come
// from math.REF_G / math.REF_M and get relocked to the device on real phones.
const G = math.REF_G;
const M = math.REF_M;

// One measurement correction. z is the raw reading, h = h(q) the predicted
// reading (e.g. math.bodyFrame(q, G)). The measurement Jacobian w.r.t. the
// local attitude error is H = skew(h) — to first order, perturbing q by a
// small body-frame rotation deltaTheta changes the predicted reading by
// skew(h)*deltaTheta (rotating h by -deltaTheta). Solving that back out for
// the deltaTheta the innovation implies is exactly what the Kalman gain does.
function correct(q, P, z, h, R) {
  const H = new Matrix(math.skew(h));
  const y = new Matrix([[z[0] - h[0]], [z[1] - h[1]], [z[2] - h[2]]]);  // innovation
  const S = H.mmul(P).mmul(H.transpose()).add(math.diag(R));           // S = HPH^T + R
  const K = P.mmul(H.transpose()).mmul(math.inverse(S));               // Kalman gain
  const deltaTheta = K.mmul(y).to1DArray();
  const qNew = math.integrate(q, deltaTheta, 1);                       // q ⊗ [deltaTheta/2, 1], normalized
  const I = Matrix.eye(3);
  const P1 = I.subtract(K.mmul(H)).mmul(P);
  return { q: qNew, P: P1.to2DArray() };
}

function step(state, sample) {
  const dt = sample.dt;

  // ---- predict: integrate the gyro, grow the covariance ----------------
  const q = math.integrate(state.q, sample.gyro, dt);
  const F = Matrix.eye(3).subtract(new Matrix(math.skew(sample.gyro)).mul(dt)); // linearized error dynamics
  const Q = Matrix.eye(3).mul(params.qScale * dt);
  const P = F.mmul(new Matrix(state.P)).mmul(F.transpose()).add(Q);

  // ---- correct with the accelerometer (tilt / gravity) -----------------
  const c1 = correct(q, P, sample.accel, math.bodyFrame(q, G), params.rAccel);

  // ---- correct with the magnetometer (heading / field direction) -------
  if (sample.mag) {
    const c2 = correct(c1.q, new Matrix(c1.P), sample.mag, math.bodyFrame(c1.q, M), params.rMag);
    return { q: c2.q, P: c2.P };
  }
  return { q: c1.q, P: c1.P };
}

return step;
`;

/** Default complementary template — the simpler alternative. */
export const DEFAULT_COMP_SOURCE = `// fusion-template: complementary
// A one-line blend: gyro attitude slerped toward the accel/mag tilt estimate.
//
// params : alpha blends the two; useMagYaw stops yaw drift with the compass.
const params = {
  alpha: 0.98,         // 1 = pure gyro, 0 = pure accel/mag
  useMagYaw: true,     // correct yaw with the magnetometer
};

function step(state, sample) {
  const qGyro = math.integrate(state.q, sample.gyro, sample.dt);
  let qTilt = math.tiltFromAccel(sample.accel);
  const yaw = params.useMagYaw && sample.mag
    ? math.magHeading(sample.accel, sample.mag)
    : math.eulerOf(qGyro).yaw;
  qTilt = math.withYaw(qTilt, yaw);
  return { q: qTilt.slerp(qGyro, params.alpha).normalize(), P: state.P };
}

return step;
`;

/** Relock the world magnetic-field reference (used when switching to a real
 * phone, whose local field differs from the synthetic one). */
export function setWorldMagReference(m: [number, number, number]): void {
  mathNS.REF_M = m;
}

export function compileFusion(source: string): { step?: FusionStep; templateId?: string; error?: string } {
  const templateId = /fusion-template:\s*(\w+)/.exec(source)?.[1] ?? "custom";
  const body = source.replace(/\bexport\s+function\b/, "function");
  try {
    const factory = new Function("THREE", "Matrix", "math", `"use strict";\n${body}\n`);
    const step = factory(THREE, Matrix, mathNS) as unknown;
    if (typeof step !== "function") return { error: "Your code must end with `return step;` (a function)." };
    return { step: step as FusionStep, templateId };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** Wraps a compiled fusion source so it can be hot-swapped at runtime. */
export class EditableFusion {
  private step: FusionStep;
  private templateId: string;
  state: FusionState;

  constructor(source: string, q0: THREE.Quaternion) {
    this.state = { q: q0.clone(), P: Matrix.eye(3).to2DArray() };
    const r = compileFusion(source);
    this.step = (r.step ?? compileFusion(DEFAULT_EKF_SOURCE).step)!;
    this.templateId = r.templateId ?? "ekf";
  }

  /** Recompile on edit. Same template keeps its state (no snap); a template
   * switch resets the covariance. On error the last good filter stays. */
  setSource(source: string): { ok: boolean; error?: string } {
    const r = compileFusion(source);
    if (r.error || !r.step) return { ok: false, error: r.error };
    if (r.templateId !== this.templateId) {
      this.state = { q: this.state.q.clone(), P: Matrix.eye(3).to2DArray() };
      this.templateId = r.templateId ?? "custom";
    }
    this.step = r.step;
    return { ok: true };
  }

  reset(q?: THREE.Quaternion): void {
    this.state = { q: (q ?? new THREE.Quaternion()).clone(), P: Matrix.eye(3).to2DArray() };
  }

  update(sample: ImuSample): THREE.Quaternion {
    try {
      this.state = this.step(this.state, sample);
    } catch {
      // The user's edit threw at runtime — keep the last good state so the
      // sim never dies mid-edit.
    }
    return this.state.q;
  }
}

// --- params block editing ------------------------------------------------

function findParamsBlock(src: string): { start: number; end: number; body: string } | null {
  // Must include "const " itself: `start` marks where injectParams() begins
  // its replacement, and formatParamsBlock() below re-emits "const params = "
  // as part of its output — if `start` pointed at "params" instead, the
  // original "const " prefix would survive the slice and get duplicated.
  const marker = "const params = {";
  const idx = src.indexOf(marker);
  if (idx < 0) return null;
  let depth = 0;
  for (let i = idx + marker.indexOf("{") + 1; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      if (depth === 0) return { start: idx, end: i + 1, body: src.slice(idx, i + 1) };
      depth--;
    }
  }
  return null;
}

/** Strip `//` line comments while leaving strings intact, so the params
 * block (which ships with human-readable trailing comments) can be parsed
 * as JSON. */
function stripComments(src: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += src[i + 1] ?? "";
        i++;
      } else if (c === '"' || c === "'") {
        inStr = false;
      }
    } else if (c === '"' || c === "'") {
      inStr = true;
      out += c;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += " ";
    } else {
      out += c;
    }
  }
  return out;
}

export function extractParams(source: string): FusionParams | null {
  const block = findParamsBlock(source);
  if (!block) return null;
  let json = block.body.slice(block.body.indexOf("{"));
  json = stripComments(json);
  json = json.replace(/,\s*([}\]])/g, "$1"); // trailing commas are legal JS, not JSON
  json = json.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');
  try {
    return JSON.parse(json) as FusionParams;
  } catch {
    return null;
  }
}

const fmt = (n: number): string => String(Number(n.toPrecision(4)));

function formatParamsBlock(obj: FusionParams): string {
  const lines: string[] = ["const params = {"];
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "number") lines.push(`  ${key}: ${fmt(value)},`);
    else if (typeof value === "boolean") lines.push(`  ${key}: ${value},`);
    else if (typeof value === "string") lines.push(`  ${key}: "${value}",`);
    else if (Array.isArray(value)) lines.push(`  ${key}: [${value.map((v) => fmt(Number(v))).join(", ")}],`);
  }
  lines.push("};");
  return lines.join("\n");
}

/** Rewrite the `params` literal in the editable source. Keeps any keys the
 * user added; only known values are overwritten, so editing by hand and
 * sliders can coexist. */
export function injectParams(source: string, overrides: FusionParams): string {
  const block = findParamsBlock(source);
  if (!block) return source;
  const current = extractParams(source) ?? {};
  const merged: FusionParams = { ...current };
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) merged[k] = v;
  }
  return source.slice(0, block.start) + formatParamsBlock(merged) + source.slice(block.end);
}
