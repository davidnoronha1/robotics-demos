import * as THREE from "three";

/**
 * Attitude math built on three.js primitives. Everything generic — quaternion
 * algebra, vector rotation, Euler extraction, slerp — comes from `three`; the
 * only code here is the handful of domain formulas (gyro integration, tilt
 * from gravity, tilt-compensated heading, the EKF measurement Jacobian).
 * The EKF's covariance math lives in the editable fusion code via `ml-matrix`.
 */

export type Vec3 = [number, number, number];

/** Roll/pitch/yaw in radians (intrinsic ZYX, north = world +X). */
export function eulerOf(q: THREE.Quaternion): { roll: number; pitch: number; yaw: number } {
  const e = new THREE.Euler().setFromQuaternion(q, "ZYX");
  return { roll: e.x, pitch: e.y, yaw: e.z };
}

/** q ← q ⊗ [1, ω·dt/2], the discrete gyro step q̇ = ½ q ⊗ [0, ω]. */
export function integrate(q: THREE.Quaternion, omega: Vec3, dt: number): THREE.Quaternion {
  const dq = new THREE.Quaternion(omega[0] * dt / 2, omega[1] * dt / 2, omega[2] * dt / 2, 1);
  return q.clone().multiply(dq).normalize();
}

/** Roll/pitch only, from the gravity direction the accelerometer measures.
 * Yaw is unobservable here, so it's pinned at 0. */
export function tiltFromAccel(accel: Vec3): THREE.Quaternion {
  const [ax, ay, az] = accel;
  const roll = Math.atan2(ay, az);
  const pitch = Math.atan2(-ax, Math.hypot(ay, az) || 1e-9);
  const qR = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), roll);
  const qP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), pitch);
  return qP.multiply(qR);
}

/** Stamp a yaw onto a roll/pitch-only quaternion: q = Rz(yaw) ⊗ qTilt. */
export function withYaw(qTilt: THREE.Quaternion, yaw: number): THREE.Quaternion {
  const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), yaw);
  return qYaw.multiply(qTilt);
}

/**
 * Tilt-compensated magnetic heading (radians) from raw body-frame accel + mag
 * readings. Same convention as `eulerOf(q).yaw` (north = world +X), so an
 * accurate attitude and the raw compass agree.
 */
export function magHeading(accel: Vec3, mag: Vec3): number {
  const [ax, ay, az] = accel;
  const roll = Math.atan2(ay, az);
  const pitch = Math.atan2(-ax, Math.hypot(ay, az) || 1e-9);
  const sinR = Math.sin(roll);
  const cosR = Math.cos(roll);
  const sinP = Math.sin(pitch);
  const cosP = Math.cos(pitch);
  const [mx, my, mz] = mag;
  const x = mx * cosP + my * sinP * sinR + mz * sinP * cosR;
  const y = my * cosR - mz * sinR;
  return Math.atan2(-y, x);
}

/** Body-frame view of a world vector: conj(q) applied to v. */
export function bodyFrame(q: THREE.Quaternion, v: Vec3): Vec3 {
  const out = new THREE.Vector3(...v).applyQuaternion(q.clone().invert());
  return [out.x, out.y, out.z];
}

/** World-frame view of a body vector: q applied to v (inverse of `bodyFrame`). */
export function worldFrame(q: THREE.Quaternion, v: Vec3): Vec3 {
  const out = new THREE.Vector3(...v).applyQuaternion(q);
  return [out.x, out.y, out.z];
}

/**
 * Numeric 3×4 Jacobian of h(q) = bodyFrame(q, v) w.r.t. the quaternion
 * components [x, y, z, w]. Finite differences on three's own math — no
 * hand-derived derivative table to get wrong.
 */
export function bodyJacobian(q: THREE.Quaternion, v: Vec3): number[][] {
  const eps = 1e-5;
  const comps: [number, number, number, number] = [q.x, q.y, q.z, q.w];
  const rows: number[][] = [];
  for (let j = 0; j < 3; j++) {
    const row: number[] = [];
    for (let i = 0; i < 4; i++) {
      const qp = q.clone();
      const qm = q.clone();
      const base = comps[i]!;
      const pp = comps.slice() as [number, number, number, number];
      const pm = comps.slice() as [number, number, number, number];
      pp[i] = base + eps;
      pm[i] = base - eps;
      qp.set(pp[0], pp[1], pp[2], pp[3]);
      qm.set(pm[0], pm[1], pm[2], pm[3]);
      row.push((bodyFrame(qp, v)[j]! - bodyFrame(qm, v)[j]!) / (2 * eps));
    }
    rows.push(row);
  }
  return rows;
}

/** 3×3 cross-product ("skew-symmetric") matrix of v, with skew(v)·x = v × x. */
export function skew(v: Vec3): number[][] {
  const [x, y, z] = v;
  return [
    [0, -z, y],
    [z, 0, -x],
    [-y, x, 0],
  ];
}

/** 4×4 matrix M(ω) with q̇ = ½ M(ω)·q, for [x, y, z, w]-ordered q (this
 * codebase's — and three.js's — convention). Used for the EKF prediction's
 * state-transition Jacobian. */
export function gyroMatrix(omega: Vec3): number[][] {
  const [wx, wy, wz] = omega;
  return [
    [0, wz, -wy, wx],
    [-wz, 0, wx, wy],
    [wy, -wx, 0, wz],
    [-wx, -wy, -wz, 0],
  ];
}
