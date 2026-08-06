import * as CANNON from "cannon-es";
import * as THREE from "three";
import type { Vec3 } from "./quaternion";

/** Phone half-extents in meters, matching the renderer's proportions. */
export const PHONE_HALF: Vec3 = [0.45, 0.9, 0.06];

/** Soft bounds on position, in meters — there's no floor collider or walls,
 * so drifting off past the visible grid is stopped here instead. */
const POS_BOUNDS = { x: 3, y: [-1, 2] as [number, number], z: 3 };

/**
 * The phone's true orientation, owned by a real rigid-body physics engine
 * (cannon-es). We never integrate orientation ourselves — the engine does,
 * and the synthetic IMU just reads its quaternion and angular velocity.
 *
 * Position is also driven by the engine (drag applies a force, same as drag
 * applying a torque for rotation) rather than set directly, so it inherits
 * momentum and damping instead of teleporting.
 */
export class PhonePhysics {
  readonly world: CANNON.World;
  readonly body: CANNON.Body;

  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
    this.world.allowSleep = true;

    this.body = new CANNON.Body({
      mass: 1.5,
      shape: new CANNON.Box(new CANNON.Vec3(...PHONE_HALF)),
      angularDamping: 0.35,
      linearDamping: 0.9,
      material: new CANNON.Material({ friction: 0.3, restitution: 0.4 }),
    });
    this.body.allowSleep = true;
    this.body.sleepSpeedLimit = 0.005;
    this.body.sleepTimeLimit = 0.5;
    this.world.addBody(this.body);
  }

  private lastLinearAccel: CANNON.Vec3 = new CANNON.Vec3();

  /** Fixed-timestep advance. Call from the sim loop's `step`. */
  step(dt: number): void {
    const v0 = this.body.velocity.clone();
    this.world.step(dt);

    // Soft walls: clamp position and kill outward velocity at the bound,
    // rather than a hard collider (there isn't one).
    const p = this.body.position;
    const v = this.body.velocity;
    if (p.x > POS_BOUNDS.x || p.x < -POS_BOUNDS.x) {
      p.x = Math.max(-POS_BOUNDS.x, Math.min(POS_BOUNDS.x, p.x));
      v.x = 0;
    }
    if (p.y > POS_BOUNDS.y[1] || p.y < POS_BOUNDS.y[0]) {
      p.y = Math.max(POS_BOUNDS.y[0], Math.min(POS_BOUNDS.y[1], p.y));
      v.y = 0;
    }
    if (p.z > POS_BOUNDS.z || p.z < -POS_BOUNDS.z) {
      p.z = Math.max(-POS_BOUNDS.z, Math.min(POS_BOUNDS.z, p.z));
      v.z = 0;
    }

    // World-frame linear acceleration this step, from the actual velocity
    // change — needed so the synthetic accelerometer notices translation
    // (drag-to-move), not just gravity.
    this.lastLinearAccel = dt > 0 ? v.vsub(v0).scale(1 / dt) : new CANNON.Vec3();
  }

  /** World-frame linear acceleration from the last `step()`, in m/s². */
  linearAcceleration(): Vec3 {
    const a = this.lastLinearAccel;
    return [a.x, a.y, a.z];
  }

  /** Pointer drag (pixel deltas) becomes a torque about world X (pitch) and
   * world Z (yaw) — the engine turns torque into rotation. */
  applyDragTorque(dxPixels: number, dyPixels: number): void {
    const DRAG_TORQUE_PER_PX = 0.55; // N·m per pixel of drag
    this.body.applyTorque(new CANNON.Vec3(dyPixels * DRAG_TORQUE_PER_PX, 0, -dxPixels * DRAG_TORQUE_PER_PX));
    this.body.wakeUp();
  }

  /** A world-frame force (already resolved from screen-space drag by the
   * caller, which knows the camera basis) — same drag-as-force pattern as
   * `applyDragTorque`, so moving inherits momentum/damping instead of
   * teleporting. */
  applyDragForce(f: Vec3): void {
    this.body.applyForce(new CANNON.Vec3(...f));
    this.body.wakeUp();
  }

  /** Ambient torque for scripted motion modes (idle/walk rocking). */
  applyAmbientTorque(t: Vec3): void {
    this.body.applyTorque(new CANNON.Vec3(...t));
    this.body.wakeUp();
  }

  /** Apply a one-shot "shake" kick to all three axes. */
  shake(): void {
    this.body.angularVelocity.x += (Math.random() - 0.5) * 6;
    this.body.angularVelocity.y += (Math.random() - 0.5) * 6;
    this.body.angularVelocity.z += (Math.random() - 0.5) * 6;
    this.body.wakeUp();
  }

  /** Random spin for the "idle" motion mode. */
  idleSpin(): void {
    this.body.angularVelocity.x += (Math.random() - 0.5) * 0.4;
    this.body.angularVelocity.y += (Math.random() - 0.5) * 0.4;
    this.body.angularVelocity.z += (Math.random() - 0.5) * 0.4;
    this.body.wakeUp();
  }

  reset(q?: THREE.Quaternion): void {
    this.body.quaternion.set(q?.x ?? 0, q?.y ?? 0, q?.z ?? 0, q?.w ?? 1);
    this.body.angularVelocity.set(0, 0, 0);
    this.body.torque.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.body.velocity.set(0, 0, 0);
    this.body.force.set(0, 0, 0);
    this.body.wakeUp();
  }

  /** True orientation as a THREE.Quaternion. */
  quaternion(): THREE.Quaternion {
    const q = this.body.quaternion;
    return new THREE.Quaternion(q.x, q.y, q.z, q.w);
  }

  /** True position, in meters, world frame. */
  position(): Vec3 {
    const p = this.body.position;
    return [p.x, p.y, p.z];
  }

  /** True angular velocity, rad/s, in the WORLD frame (cannon-es convention —
   * callers wanting body-frame must rotate by conj(q) themselves). */
  angularVelocity(): Vec3 {
    const v = this.body.angularVelocity;
    return [v.x, v.y, v.z];
  }
}
