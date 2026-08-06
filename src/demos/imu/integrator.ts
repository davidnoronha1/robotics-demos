import * as THREE from "three";
import { integrate, type Vec3 } from "./quaternion";

/** Phone half-extents in meters, matching the renderer's proportions. */
export const PHONE_HALF: Vec3 = [0.45, 0.9, 0.06];

/** Soft bounds on position, in meters — there's no floor collider or walls,
 * so drifting off past the visible grid is stopped here instead. */
const POS_BOUNDS = { x: 3, y: [-1, 2] as [number, number], z: 3 };

const MASS = 1.5;
// Uniform scalar inertia (average of the box's three principal inertias) —
// good enough for the interactive feel; see REPLACE_PHYSICS.md for why a
// single scalar was chosen over a full 3×3 tensor.
const [hx, hy, hz] = PHONE_HALF;
const I =
  (((1 / 12) * MASS * ((2 * hy) ** 2 + (2 * hz) ** 2) +
    (1 / 12) * MASS * ((2 * hx) ** 2 + (2 * hz) ** 2) +
    (1 / 12) * MASS * ((2 * hx) ** 2 + (2 * hy) ** 2)) /
    3);
const ANGULAR_DAMPING = 0.35;
const LINEAR_DAMPING = 0.9;

const SLEEP_SPEED_LIMIT = 0.005;
const SLEEP_TIME_LIMIT = 0.5;

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/**
 * The phone's true orientation, owned by a small hand-rolled rigid-body
 * integrator (one body, no colliders, no joints, no contacts — see
 * REPLACE_PHYSICS.md for why this replaced cannon-es). We never integrate
 * orientation from outside — this does, and the synthetic IMU just reads
 * the quaternion and angular velocity.
 *
 * Position is also driven here (drag applies a force, same as drag applying
 * a torque for rotation) rather than set directly, so it inherits momentum
 * and damping instead of teleporting.
 */
export class PhonePhysics {
  private q = new THREE.Quaternion();
  private omega: Vec3 = [0, 0, 0];
  private v: Vec3 = [0, 0, 0];
  private x: Vec3 = [0, 0, 0];
  private torque: Vec3 = [0, 0, 0];
  private force: Vec3 = [0, 0, 0];
  private lastLinearAccel: Vec3 = [0, 0, 0];
  private asleep = false;
  private sleepTimer = 0;

  private wake(): void {
    this.asleep = false;
    this.sleepTimer = 0;
  }

  /** Fixed-timestep advance. Call from the sim loop's `step`. */
  step(dt: number): void {
    const v0 = this.v;

    if (norm(this.omega) < SLEEP_SPEED_LIMIT && norm(this.v) < SLEEP_SPEED_LIMIT) {
      this.sleepTimer += dt;
      if (this.sleepTimer > SLEEP_TIME_LIMIT) this.asleep = true;
    } else {
      this.sleepTimer = 0;
    }

    if (!this.asleep) {
      // Angular: semi-implicit Euler, exponential damping, then quaternion integration.
      const alpha = scale(this.torque, 1 / I);
      this.omega = add(this.omega, scale(alpha, dt));
      this.omega = scale(this.omega, 1 - ANGULAR_DAMPING * dt);
      this.q = integrate(this.q, this.omega, dt);

      // Linear: semi-implicit Euler with damping folded into the acceleration.
      const aLinear = scale(this.force, 1 / MASS);
      this.v = add(this.v, scale(add(aLinear, scale(this.v, -LINEAR_DAMPING)), dt));
      this.x = add(this.x, scale(this.v, dt));
    }

    this.torque = [0, 0, 0];
    this.force = [0, 0, 0];

    // Soft walls: clamp position and kill outward velocity at the bound,
    // rather than a hard collider (there isn't one).
    const p = this.x;
    const v = this.v;
    if (p[0] > POS_BOUNDS.x || p[0] < -POS_BOUNDS.x) {
      p[0] = Math.max(-POS_BOUNDS.x, Math.min(POS_BOUNDS.x, p[0]));
      v[0] = 0;
    }
    if (p[1] > POS_BOUNDS.y[1] || p[1] < POS_BOUNDS.y[0]) {
      p[1] = Math.max(POS_BOUNDS.y[0], Math.min(POS_BOUNDS.y[1], p[1]));
      v[1] = 0;
    }
    if (p[2] > POS_BOUNDS.z || p[2] < -POS_BOUNDS.z) {
      p[2] = Math.max(-POS_BOUNDS.z, Math.min(POS_BOUNDS.z, p[2]));
      v[2] = 0;
    }

    // World-frame linear acceleration this step, from the actual velocity
    // change — needed so the synthetic accelerometer notices translation
    // (drag-to-move), not just gravity.
    this.lastLinearAccel = dt > 0 ? scale(add(this.v, scale(v0, -1)), 1 / dt) : [0, 0, 0];
  }

  /** World-frame linear acceleration from the last `step()`, in m/s². */
  linearAcceleration(): Vec3 {
    return this.lastLinearAccel;
  }

  /** Pointer drag (pixel deltas) becomes a torque about world X (pitch) and
   * world Z (yaw) — the integrator turns torque into rotation. */
  applyDragTorque(dxPixels: number, dyPixels: number): void {
    const DRAG_TORQUE_PER_PX = 0.55; // N·m per pixel of drag
    this.torque = add(this.torque, [dyPixels * DRAG_TORQUE_PER_PX, 0, -dxPixels * DRAG_TORQUE_PER_PX]);
    this.wake();
  }

  /** A world-frame force (already resolved from screen-space drag by the
   * caller, which knows the camera basis) — same drag-as-force pattern as
   * `applyDragTorque`, so moving inherits momentum/damping instead of
   * teleporting. */
  applyDragForce(f: Vec3): void {
    this.force = add(this.force, f);
    this.wake();
  }

  /** Ambient torque for scripted motion modes (idle/walk rocking). */
  applyAmbientTorque(t: Vec3): void {
    this.torque = add(this.torque, t);
    this.wake();
  }

  /** Apply a one-shot "shake" kick to all three axes. */
  shake(): void {
    this.omega = add(this.omega, [
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 6,
    ]);
    this.wake();
  }

  /** Random spin for the "idle" motion mode. */
  idleSpin(): void {
    this.omega = add(this.omega, [
      (Math.random() - 0.5) * 0.4,
      (Math.random() - 0.5) * 0.4,
      (Math.random() - 0.5) * 0.4,
    ]);
    this.wake();
  }

  reset(q?: THREE.Quaternion): void {
    this.q = q ? q.clone() : new THREE.Quaternion();
    this.omega = [0, 0, 0];
    this.torque = [0, 0, 0];
    this.x = [0, 0, 0];
    this.v = [0, 0, 0];
    this.force = [0, 0, 0];
    this.wake();
  }

  /** True orientation as a THREE.Quaternion. */
  quaternion(): THREE.Quaternion {
    return this.q.clone();
  }

  /** True position, in meters, world frame. */
  position(): Vec3 {
    return this.x;
  }

  /** True angular velocity, rad/s, in the WORLD frame (matching the old
   * cannon-es convention — callers wanting body-frame must rotate by
   * conj(q) themselves). */
  angularVelocity(): Vec3 {
    return this.omega;
  }
}
