/**
 * Regression check for the IMU fusion math. Two checks:
 *
 *  1. Zero noise, idle motion: gyro-only integration and the EKF should both
 *     track the true (physics-engine) orientation almost exactly. This is
 *     the check that would have caught the world/body gyro-frame bug and
 *     the EKF template's Jacobian/innovation/inverse bugs immediately, since
 *     with zero noise there's no excuse for drift or bias.
 *  2. Default (realistic) noise, idle motion, over 20s: the EKF's angular
 *     error vs. true orientation must stay bounded (it fuses in accel/mag,
 *     so unlike gyro-only it shouldn't drift unboundedly) and its state must
 *     stay numerically sane (quaternion normalized, covariance finite).
 *
 * "Idle" motion (gentle continuous rocking) is used rather than the more
 * aggressive "walk" mode because this EKF is intentionally the simple,
 * editable, quaternion-only design described in PLAN.md (no gyro-bias
 * state) — under sustained, rapid, continuous tumbling for many seconds a
 * first-order EKF without bias estimation will show visibly more
 * linearization error, same as most textbook attitude EKFs. That's a
 * known characteristic of the simplified design, not a bug to chase here;
 * idle motion (the demo's default mode) is the realistic case this check
 * should hold to a tight tolerance.
 *
 * Run with: npx tsx scripts/verify-imu-fusion.ts
 */
import * as THREE from "three";
import { PhonePhysics } from "../src/demos/imu/physics";
import { SyntheticIMU, WORLD_G, type NoiseConfig } from "../src/demos/imu/sensorInput";
import { GyroOnlyEstimator, type ImuSample } from "../src/demos/imu/estimators";
import { EditableFusion, DEFAULT_EKF_SOURCE } from "../src/demos/imu/fusionCode";
import { bodyFrame, eulerOf } from "../src/demos/imu/quaternion";

const ZERO_NOISE: NoiseConfig = {
  gyroStd: [0, 0, 0],
  gyroWalk: [0, 0, 0],
  accelStd: [0, 0, 0],
  accelWalk: [0, 0, 0],
  magStd: [0, 0, 0],
  magWalk: [0, 0, 0],
  colored: false,
};

function angleBetweenDeg(a: THREE.Quaternion, b: THREE.Quaternion): number {
  let d = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  d = Math.min(1, Math.abs(d));
  return 2 * Math.acos(d) * (180 / Math.PI);
}

function checkZeroNoise(): boolean {
  const physics = new PhonePhysics();
  const synthetic = new SyntheticIMU(physics);
  synthetic.setNoise(ZERO_NOISE);
  synthetic.mode = "idle";

  const gyroOnly = new GyroOnlyEstimator();
  const fused = new EditableFusion(DEFAULT_EKF_SOURCE, new THREE.Quaternion());

  const N = 600; // 6s at dt=0.01
  const samples: ImuSample[] = [];
  synthetic.onSample((s) => samples.push(s));

  let gyroErrSum = 0;
  let fusedErrSum = 0;
  let badNorm = 0;
  let badCov = 0;

  for (let i = 0; i < N; i++) {
    synthetic.advance(0.01);
    const s = samples[samples.length - 1];
    if (!s) continue;

    const qG = gyroOnly.update(s);
    const qF = fused.update(s);
    const qT = synthetic.getTrueOrientation();

    if (Math.abs(qF.length() - 1) > 1e-4) badNorm++;
    const P = fused.state.P;
    const trace = P[0]![0]! + P[1]![1]! + P[2]![2]!;
    if (!Number.isFinite(trace) || trace < 0 || trace > 1e6) badCov++;

    gyroErrSum += angleBetweenDeg(qG, qT);
    fusedErrSum += angleBetweenDeg(qF, qT);
  }

  const meanGyroErr = gyroErrSum / N;
  const meanFusedErr = fusedErrSum / N;

  console.log("--- check 1: zero noise, idle motion ---");
  console.log(`mean angular error gyro-only : ${meanGyroErr.toFixed(4)} deg`);
  console.log(`mean angular error EKF fused : ${meanFusedErr.toFixed(4)} deg`);
  console.log(`quaternion normalization violations: ${badNorm}`);
  console.log(`covariance sanity violations: ${badCov}`);

  const TOL_DEG = 1.0;
  const ok = meanGyroErr < TOL_DEG && meanFusedErr < TOL_DEG && badNorm === 0 && badCov === 0;
  console.log(ok ? "PASS" : "FAIL");
  return ok;
}

function checkDefaultNoise(): boolean {
  const physics = new PhonePhysics();
  const synthetic = new SyntheticIMU(physics); // default noise
  synthetic.mode = "idle";

  const fused = new EditableFusion(DEFAULT_EKF_SOURCE, new THREE.Quaternion());

  const N = 2000; // 20s at dt=0.01
  const samples: ImuSample[] = [];
  synthetic.onSample((s) => samples.push(s));

  let fusedErrSum = 0;
  let maxErr = 0;
  let badNorm = 0;

  for (let i = 0; i < N; i++) {
    synthetic.advance(0.01);
    const s = samples[samples.length - 1];
    if (!s) continue;

    const qF = fused.update(s);
    const qT = synthetic.getTrueOrientation();
    if (Math.abs(qF.length() - 1) > 1e-4) badNorm++;

    const err = angleBetweenDeg(qF, qT);
    fusedErrSum += err;
    maxErr = Math.max(maxErr, err);
  }

  const meanErr = fusedErrSum / N;
  console.log("\n--- check 2: default noise, idle motion, 20s ---");
  console.log(`mean angular error EKF fused : ${meanErr.toFixed(4)} deg`);
  console.log(`max  angular error EKF fused : ${maxErr.toFixed(4)} deg`);
  console.log(`quaternion normalization violations: ${badNorm}`);

  const MEAN_TOL_DEG = 5;
  const MAX_TOL_DEG = 15;
  const ok = meanErr < MEAN_TOL_DEG && maxErr < MAX_TOL_DEG && badNorm === 0;
  console.log(ok ? "PASS" : "FAIL");
  return ok;
}

function checkHeadingLeakage(): boolean {
  // The property that separates a *multiplicative* (error-state) EKF from an
  // *additive* one. Hold the phone at a fixed 60° roll with zero gyro and no
  // magnetometer. The accelerometer can only constrain tilt — heading is
  // unobservable to it. A filter that corrects the four raw quaternion
  // components directly ("additive") lets the accel correction drag yaw
  // around as a side-effect the moment the phone leaves a neutral pose,
  // exactly the drift reported before the multiplicative rewrite. An
  // error-state filter restricts the correction to the observable tilt
  // subspace, so yaw must stay put.
  const roll = (60 * Math.PI) / 180;
  const qTrue = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll);
  const gBody = bodyFrame(qTrue, WORLD_G);

  const fused = new EditableFusion(DEFAULT_EKF_SOURCE, new THREE.Quaternion());

  const N = 1500; // 15s at dt=0.01
  let yawErrMax = 0;
  for (let i = 0; i < N; i++) {
    const sample: ImuSample = { gyro: [0, 0, 0], accel: gBody, mag: null, dt: 0.01 };
    const qF = fused.update(sample);
    const yawDeg = eulerOf(qF).yaw * (180 / Math.PI);
    const wrapped = Math.abs(((yawDeg % 360) + 540) % 360 - 180);
    yawErrMax = Math.max(yawErrMax, wrapped);
  }
  const tiltErrDeg = angleBetweenDeg(fused.state.q, qTrue);

  console.log("\n--- check 3: additive-vs-multiplicative (heading leakage) ---");
  console.log(`max |yaw| while settling into a 60deg roll: ${yawErrMax.toFixed(3)} deg`);
  console.log(`final tilt error vs true 60deg roll: ${tiltErrDeg.toFixed(3)} deg`);

  const ok = yawErrMax < 1.0 && tiltErrDeg < 1.0;
  console.log(ok ? "PASS" : "FAIL");
  return ok;
}

const ok1 = checkZeroNoise();
const ok2 = checkDefaultNoise();
const ok3 = checkHeadingLeakage();
process.exit(ok1 && ok2 && ok3 ? 0 : 1);
