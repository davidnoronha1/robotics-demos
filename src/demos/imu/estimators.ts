import * as THREE from "three";
import { type Vec3, bodyFrame, eulerOf, integrate, magHeading, tiltFromAccel, withYaw } from "./quaternion";

export interface ImuSample {
  gyro: Vec3; // rad/s, body frame
  accel: Vec3; // m/s^2, body frame, includes gravity
  mag: Vec3 | null; // µT, body frame; null when no magnetometer
  dt: number; // s
}

export interface Estimator {
  reset(): void;
  update(sample: ImuSample): THREE.Quaternion;
}

/** Pure gyro integration. Smooth and responsive, drifts visibly within ~20s
 * because any bias or noise in the gyro accumulates without bound. */
export class GyroOnlyEstimator implements Estimator {
  private q = new THREE.Quaternion();

  reset(): void {
    this.q.identity();
  }

  update(sample: ImuSample): THREE.Quaternion {
    this.q = integrate(this.q, sample.gyro, sample.dt);
    return this.q;
  }
}

/** Tilt from gravity direction only. No drift, but jitters under any linear
 * acceleration, and yaw is unobservable — it's pinned at 0. */
export class AccelOnlyEstimator implements Estimator {
  reset(): void {
    // stateless
  }

  update(sample: ImuSample): THREE.Quaternion {
    return tiltFromAccel(sample.accel);
  }
}

/** Compass heading only: tilt-corrected magnetometer reading stamped onto the
 * accel tilt. Bounded (no drift) but noisy, and needs a magnetometer. */
export class MagHeadingEstimator implements Estimator {
  reset(): void {
    // stateless
  }

  update(sample: ImuSample): THREE.Quaternion {
    const tilt = tiltFromAccel(sample.accel);
    if (!sample.mag) return tilt;
    return withYaw(tilt, magHeading(sample.accel, sample.mag));
  }
}

/** Small reference for checking a filter's estimate against the truth. */
export function trueEuler(q: THREE.Quaternion): { roll: number; pitch: number; yaw: number } {
  return eulerOf(q);
}

export function gravityInBody(q: THREE.Quaternion): Vec3 {
  return bodyFrame(q, [0, 0, 9.81]);
}
