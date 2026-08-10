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

/** Diagonal matrix from a vector — used to build the measurement noise R
 * inside the editable EKF template. */
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
 * sliders can rewrite (see the block at the top). The predict/correct math is
 * written out inline below — edit it and the phone reacts live. */
export const DEFAULT_EKF_SOURCE = `// fusion-template: ekf
// Attitude EKF (error-state form). The whole filter — predict, Jacobians,
// gain, update — is right here. Edit it and the phone reacts live.
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

// Predict: integrate the gyro to advance q, and grow the local attitude-error
// covariance P through the linearized error dynamics F = I - [omega]x * dt,
// adding process noise qScale*dt per axis.
function ekfPredict(q, P, gyro, dt, qScale) {
  const qNew = math.integrate(q, gyro, dt);
  const F = Matrix.eye(3).subtract(new Matrix(math.skew(gyro)).mul(dt));
  const Q = Matrix.eye(3).mul(qScale * dt);
  const Pnew = F.mmul(new Matrix(P)).mmul(F.transpose()).add(Q);
  return { q: qNew, P: Pnew.to2DArray() };
}

// Correct: fold reading z (predicted as h(q), covariance R) into (q, P) via
// the local attitude-error linearization. Innovation y = z - h; Jacobian
// H = [h]x (a small body-frame rotation deltaTheta perturbs the predicted
// reading by h x deltaTheta); gain K = P H^T (H P H^T + R)^-1; q is corrected
// by composing deltaTheta = K*y onto it (never by editing q's raw components
// — they don't live on a flat space) and P shrinks by (I - K H).
function kalmanCorrect(q, P, z, h, R) {
  const Pm = new Matrix(P);
  const H = new Matrix(math.skew(h));
  const y = new Matrix([[z[0] - h[0]], [z[1] - h[1]], [z[2] - h[2]]]);
  const S = H.mmul(Pm).mmul(H.transpose()).add(math.diag(R));
  const K = Pm.mmul(H.transpose()).mmul(math.inverse(S));
  const deltaTheta = K.mmul(y).to1DArray();
  const qNew = math.integrate(q, deltaTheta, 1);
  const P1 = Matrix.eye(3).subtract(K.mmul(H)).mmul(Pm);
  return { q: qNew, P: P1.to2DArray() };
}

function step(state, sample) {
  const predicted = ekfPredict(state.q, state.P, sample.gyro, sample.dt, params.qScale);

  const afterAccel = kalmanCorrect(
    predicted.q, predicted.P, sample.accel, math.bodyFrame(predicted.q, G), params.rAccel,
  );
  if (!sample.mag) return afterAccel;

  return kalmanCorrect(
    afterAccel.q, afterAccel.P, sample.mag, math.bodyFrame(afterAccel.q, M), params.rMag,
  );
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

  /** Set when the currently-applied `step` throws while running (as opposed
   * to a compile error from `setSource`, which is reported synchronously via
   * its return value instead). Cleared as soon as a step succeeds again. */
  runtimeError: string | null = null;

  constructor(source: string, q0: THREE.Quaternion) {
    this.state = { q: q0.clone(), P: Matrix.eye(3).to2DArray() };
    const r = compileFusion(source);
    this.step = (r.step ?? compileFusion(DEFAULT_EKF_SOURCE).step)!;
    this.templateId = r.templateId ?? "ekf";
  }

  /** Recompile on Apply. Same template keeps its state (no snap); a template
   * switch resets the covariance. On error the last good filter stays. */
  setSource(source: string): { ok: boolean; error?: string } {
    const r = compileFusion(source);
    if (r.error || !r.step) return { ok: false, error: r.error };
    if (r.templateId !== this.templateId) {
      this.state = { q: this.state.q.clone(), P: Matrix.eye(3).to2DArray() };
      this.templateId = r.templateId ?? "custom";
    }
    this.step = r.step;
    this.runtimeError = null;
    return { ok: true };
  }

  reset(q?: THREE.Quaternion): void {
    this.state = { q: (q ?? new THREE.Quaternion()).clone(), P: Matrix.eye(3).to2DArray() };
  }

  update(sample: ImuSample): THREE.Quaternion {
    try {
      this.state = this.step(this.state, sample);
      this.runtimeError = null;
    } catch (e) {
      // The user's edit threw at runtime — keep the last good state so the
      // sim never dies mid-edit; surface the error so it doesn't fail silently.
      this.runtimeError = e instanceof Error ? e.message : String(e);
    }
    return this.state.q;
  }
}

// --- params block editing ---------------------------------------------

// findParamsBlock / stripComments / extractParams / injectParams and the
// params-block formatter are shared across editable-code demos; they live in
// shared/codeParams.ts.

export { extractParams, injectParams } from "../../shared/codeParams";
