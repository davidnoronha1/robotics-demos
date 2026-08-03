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

function diag(v: number[]): Matrix {
  const m = Matrix.eye(v.length);
  v.forEach((x, i) => m.set(i, i, x));
  return m;
}

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
  bodyJacobian, // kept for experimentation; not used by the shipped templates
  gyroMatrix, // ditto
  skew,
  eulerOf,
  REF_G: WORLD_G, // world gravity reference
  REF_M: WORLD_M, // world magnetic-field reference (relocked on real devices)
  diag,
};

/** Full 6-DOF pose: where the phone is, how fast it's going, and how it's
 * oriented. `P` is the covariance of the 9-vector *error* state
 * [δp, δv, δθ] — the attitude part is a small body-frame rotation, not raw
 * quaternion components. */
export interface FusionState {
  p: number[]; // world position (m)
  v: number[]; // world velocity (m/s)
  q: THREE.Quaternion; // body → world attitude
  P: number[][]; // 9×9
}

export type FusionStep = (state: FusionState, sample: ImuSample) => FusionState;

export interface FusionParams {
  qGyro?: number;
  qAccel?: number;
  rAccel?: [number, number, number];
  rMag?: [number, number, number];
  rPos?: [number, number, number];
  staticGate?: number;
  alpha?: number;
  useMagYaw?: boolean;
  [key: string]: unknown;
}

/** Identity-ish starting covariance: we know where the phone starts (it's the
 * origin by definition) far better than we know its attitude. */
function initialP(): number[][] {
  const P = Matrix.identity(9);
  for (let i = 0; i < 6; i++) P.set(i, i, 0.01);
  return P.to2DArray();
}

/** Default EKF template. Every equation is tied to a `params` value the
 * sliders can rewrite (see the block at the top). */
export const DEFAULT_EKF_SOURCE = `// fusion-template: ekf
// 6-DOF pose EKF, error-state (indirect) form.
//
// state  : p world position, v world velocity, q body->world attitude
// error  : dx = [dp, dv, dTheta] (9x1) — P is the covariance of *this*, not of
//          the state itself. A quaternion has no flat space to put a Gaussian
//          on; a small body-frame rotation dTheta does, so all the Kalman
//          algebra runs on the error and is composed back onto q at the end.
// sample : { gyro, accel, mag|null, posFix|null, dt }
//
// The IMU is not a sensor here, it's the *input*: the gyro drives attitude and
// the accelerometer drives velocity and position. That integration is what
// drifts. Gravity, the compass and the position fix are the measurements that
// pull it back.
//
// params : trust values — edit them here, or let the sliders rewrite this
//          block for you (the "link" checkbox wires them up).
const params = {
  qGyro: 0.0001,                        // gyro process noise, (rad/s)^2 per second
  qAccel: 0.05,                         // accel process noise, (m/s^2)^2 per second
  rAccel: [0.0025, 0.0025, 0.0025],     // gravity-direction covariance, (m/s^2)^2
  rMag: [4, 4, 4],                      // mag covariance, per axis (uT)^2
  rPos: [0.0025, 0.0025, 0.0025],       // position-fix covariance, per axis (m^2)
  staticGate: 0.6,                      // use accel as gravity when ||a|| - g is under this
};

// World-frame references the synthetic sensors measure against. These come
// from math.REF_G / math.REF_M and get relocked to the device on real phones.
const G = math.REF_G;
const M = math.REF_M;
const g = Math.hypot(G[0], G[1], G[2]);

function step(state, sample) {
  const { gyro, accel, mag, posFix, dt } = sample;

  // --- predict: integrate the IMU, and let the uncertainty grow -----------
  // q <- q (x) [1, w*dt/2], the small-angle form of q' = 1/2 q (x) [0, w].
  const dqGyro = new THREE.Quaternion(gyro[0] * dt / 2, gyro[1] * dt / 2, gyro[2] * dt / 2, 1);
  let q = state.q.clone().multiply(dqGyro).normalize();

  // Strapdown: the accelerometer reads specific force in the body frame.
  // Rotate it to world and subtract gravity to get the actual acceleration,
  // then integrate it twice.
  const aw = new THREE.Vector3(accel[0], accel[1], accel[2]).applyQuaternion(q);
  const a = [aw.x - G[0], aw.y - G[1], aw.z - G[2]];
  let p = state.p.map((pi, i) => pi + state.v[i] * dt + 0.5 * a[i] * dt * dt);
  let v = state.v.map((vi, i) => vi + a[i] * dt);

  // Error dynamics F (9x9), block by block. Position error grows with velocity
  // error; velocity error grows with tilt error, because tipping the estimate
  // by dTheta mis-rotates the specific force by a x dTheta and leaks gravity
  // into the horizontal axes — that block is why a position fix can correct
  // *attitude*. Attitude error itself just rotates with the body.
  const [wx, wy, wz] = gyro;
  const [ax, ay, az] = accel;
  const wCross = new Matrix([[0, -wz, wy], [wz, 0, -wx], [-wy, wx, 0]]);
  const aCross = new Matrix([[0, -az, ay], [az, 0, -ax], [-ay, ax, 0]]);
  const e = new THREE.Matrix4().makeRotationFromQuaternion(q).elements;  // column-major
  const R = new Matrix([[e[0], e[4], e[8]], [e[1], e[5], e[9]], [e[2], e[6], e[10]]]);

  const F = Matrix.identity(9);
  F.setSubMatrix(Matrix.identity(3).mul(dt), 0, 3);                    // dp <- dv
  F.setSubMatrix(R.mmul(aCross).mul(-dt), 3, 6);                       // dv <- dTheta
  F.setSubMatrix(Matrix.identity(3).subtract(wCross.mul(dt)), 6, 6);   // dTheta <- dTheta

  const Q = Matrix.zeros(9, 9);
  Q.setSubMatrix(Matrix.identity(3).mul(params.qAccel * dt), 3, 3);
  Q.setSubMatrix(Matrix.identity(3).mul(params.qGyro * dt), 6, 6);

  let P = F.mmul(new Matrix(state.P)).mmul(F.transpose()).add(Q);      // P <- F P F' + Q

  // --- update: fold in whatever measurements this step actually has -------
  // Gravity only tells you anything while the phone isn't accelerating —
  // otherwise linear acceleration masquerades as tilt, so gate on ||a|| ~ g.
  const updates = [];
  if (Math.abs(Math.hypot(ax, ay, az) - g) < params.staticGate) updates.push({ z: accel, ref: G, r: params.rAccel });
  if (mag) updates.push({ z: mag, ref: M, r: params.rMag });
  if (posFix) updates.push({ z: posFix, ref: null, r: params.rPos });

  for (const u of updates) {
    // h = what this sensor should read given the current state, H = how h
    // moves when the error state does.
    const H = Matrix.zeros(3, 9);
    let h;
    if (u.ref) {
      // A known world vector seen in the body frame: h = conj(q) * ref * q.
      // Rotating the body by dTheta moves it by h x dTheta, so dh/dTheta = [h]x.
      h = new THREE.Vector3(u.ref[0], u.ref[1], u.ref[2]).applyQuaternion(q.clone().invert()).toArray();
      H.setSubMatrix([[0, -h[2], h[1]], [h[2], 0, -h[0]], [-h[1], h[0], 0]], 0, 6);
    } else {
      h = p;                                                 // the fix measures p directly
      H.setSubMatrix(Matrix.identity(3), 0, 0);               // dh/dp = I
    }

    const y = new Matrix([[u.z[0] - h[0]], [u.z[1] - h[1]], [u.z[2] - h[2]]]);  // innovation
    const S = H.mmul(P).mmul(H.transpose()).add(Matrix.diag(u.r));   // S = H P H' + R
    const K = P.mmul(H.transpose()).mmul(math.inverse(S));           // K = P H' S^-1
    const dx = K.mmul(y).to1DArray();                                // [dp, dv, dTheta]

    p = p.map((pi, i) => pi + dx[i]);
    v = v.map((vi, i) => vi + dx[3 + i]);
    // Attitude is *composed*, not added — same small-angle step as the gyro.
    q = q.multiply(new THREE.Quaternion(dx[6] / 2, dx[7] / 2, dx[8] / 2, 1)).normalize();
    P = Matrix.identity(9).subtract(K.mmul(H)).mmul(P);              // P <- (I - K H) P
  }

  return { p, v, q, P: P.to2DArray() };
}

return step;
`;

/** Default complementary template — the simpler alternative. */
export const DEFAULT_COMP_SOURCE = `// fusion-template: complementary
// A one-line blend: gyro attitude slerped toward the accel/mag tilt estimate.
// Attitude only — p, v and P are carried through untouched, so switching to
// this filter parks the pose states rather than estimating them.
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
  return { ...state, q: qTilt.slerp(qGyro, params.alpha).normalize() };
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
    this.state = { p: [0, 0, 0], v: [0, 0, 0], q: q0.clone(), P: initialP() };
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
      this.state = { p: [0, 0, 0], v: [0, 0, 0], q: this.state.q.clone(), P: initialP() };
      this.templateId = r.templateId ?? "custom";
    }
    this.step = r.step;
    return { ok: true };
  }

  reset(q?: THREE.Quaternion): void {
    this.state = { p: [0, 0, 0], v: [0, 0, 0], q: (q ?? new THREE.Quaternion()).clone(), P: initialP() };
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
