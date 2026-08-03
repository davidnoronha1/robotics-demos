import * as CANNON from "cannon-es";
import * as THREE from "three";
import type { Vec3 } from "./quaternion";

/** Phone half-extents in meters, matching the renderer's proportions. */
export const PHONE_HALF: Vec3 = [0.45, 0.9, 0.06];

/**
 * The phone's true orientation, owned by a real rigid-body physics engine
 * (cannon-es). We never integrate orientation ourselves — the engine does,
 * and the synthetic IMU just reads its quaternion and angular velocity.
 *
 * Position is pinned to the origin (linearFactor = 0) so the phone only
 * rotates — it's a spinning phone on an invisible pedestal, not something
 * that flies off screen.
 */
export class PhonePhysics {
  readonly world: CANNON.World;
  readonly body: CANNON.Body;

  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
    this.world.allowSleep = true;

    this.body = new CANNON.Body({
      mass: 0.2,
      shape: new CANNON.Box(new CANNON.Vec3(...PHONE_HALF)),
      angularDamping: 0.25,
      material: new CANNON.Material({ friction: 0.3, restitution: 0.4 }),
    });
    this.body.linearFactor = new CANNON.Vec3(0, 0, 0);
    this.body.allowSleep = true;
    this.body.sleepSpeedLimit = 0.005;
    this.body.sleepTimeLimit = 0.5;
    this.world.addBody(this.body);
  }

  /** Fixed-timestep advance. Call from the sim loop's `step`. */
  step(dt: number): void {
    this.world.step(dt);
  }

  /** Pointer drag (pixel deltas) becomes a torque about world X (pitch) and
   * world Z (yaw) — the engine turns torque into rotation. */
  applyDragTorque(dxPixels: number, dyPixels: number): void {
    const SENSITIVITY = 0.55; // N·m per pixel of drag
    this.body.applyTorque(new CANNON.Vec3(dyPixels * SENSITIVITY, 0, -dxPixels * SENSITIVITY));
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
    this.body.wakeUp();
  }

  /** True orientation as a THREE.Quaternion. */
  quaternion(): THREE.Quaternion {
    const q = this.body.quaternion;
    return new THREE.Quaternion(q.x, q.y, q.z, q.w);
  }

  /** True angular velocity, rad/s, in the WORLD frame (cannon-es convention —
   * callers wanting body-frame must rotate by conj(q) themselves). */
  angularVelocity(): Vec3 {
    const v = this.body.angularVelocity;
    return [v.x, v.y, v.z];
  }
}
