import * as THREE from "three";
import type { ImuSample } from "./estimators";
import type { PhonePhysics } from "./physics";
import { bodyFrame } from "./quaternion";
import { WORLD_G, WORLD_M, type ImuSource, type MotionMode } from "./sensorInput";

/** Per-axis noise model. σ is white-noise std; walk is a bias random walk
 * (rad/s·s, m/s²·s, µT·s). `colored` turns on AR(1) correlated noise, which
 * is what makes sensor traces look real instead of clean. */
export interface NoiseConfig {
  gyroStd: [number, number, number]; // rad/s
  gyroWalk: [number, number, number]; // rad/s per sqrt(s)
  accelStd: [number, number, number]; // m/s²
  accelWalk: [number, number, number]; // m/s² per sqrt(s)
  magStd: [number, number, number]; // µT
  magWalk: [number, number, number]; // µT per sqrt(s)
  colored: boolean;
}

export const DEFAULT_NOISE: NoiseConfig = {
  gyroStd: [0.01, 0.01, 0.01],
  gyroWalk: [0.004, 0.004, 0.004],
  accelStd: [0.08, 0.08, 0.08],
  accelWalk: [0.01, 0.01, 0.01],
  magStd: [2, 2, 2],
  magWalk: [0.2, 0.2, 0.2],
  colored: true,
};

function gaussian(): number {
  // Box-Muller
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** AR(1) colored noise: nₜ = φ nₜ₋₁ + σ√(1−φ²) εₜ. */
class ColoredNoise {
  private prev = 0;
  constructor(private phi: number) {}

  next(std: number): number {
    const eps = gaussian() * std * Math.sqrt(1 - this.phi * this.phi);
    this.prev = this.phi * this.prev + eps;
    return this.prev;
  }
}

/** One stateful noise channel: white or colored noise plus a bias random
 * walk (Brownian drift), per axis. */
class NoiseAxis {
  bias = 0;
  private colored: ColoredNoise | null = null;

  constructor(
    private std: number,
    private walk: number,
    useColored: boolean,
  ) {
    if (useColored) this.colored = new ColoredNoise(0.85);
  }

  setConfig(std: number, walk: number, useColored: boolean): void {
    this.std = std;
    this.walk = walk;
    if (useColored && !this.colored) this.colored = new ColoredNoise(0.85);
    if (!useColored) this.colored = null;
  }

  /** Total error: drifting bias + (colored or white) noise, in unit/sqrt(s). */
  draw(dt: number): number {
    this.bias += this.walk * Math.sqrt(dt) * gaussian();
    const n = this.colored ? this.colored.next(this.std) : gaussian() * this.std;
    return this.bias + n;
  }
}

/** Draws one noisy sample per axis: `base[i] + axes[i].draw(dt)`. */
function sampleAxes(axes: NoiseAxis[], base: [number, number, number], dt: number): [number, number, number] {
  return [base[0] + axes[0]!.draw(dt), base[1] + axes[1]!.draw(dt), base[2] + axes[2]!.draw(dt)];
}

/**
 * Desktop fallback. The phone's true orientation is owned by the physics
 * integrator (`PhonePhysics`); we derive noisy gyro/accel/mag samples from
 * the body's quaternion and angular velocity — the same way a real IMU
 * would. Ground
 * truth stays available to drive the drift readout and comparison plots.
 *
 * This is driven externally by the sim loop (`advance(dt)`), not its own
 * timer, so physics, estimators, and rendering all share one clock.
 */
export class SyntheticIMU implements ImuSource {
  mode: MotionMode = "idle";
  timescale = 1;
  noise: NoiseConfig = { ...DEFAULT_NOISE, gyroStd: [...DEFAULT_NOISE.gyroStd] as [number, number, number] };

  private callbacks: Array<(s: ImuSample) => void> = [];
  private t = 0;
  private shakeUntil = 0;
  private gyroAxes: NoiseAxis[];
  private accelAxes: NoiseAxis[];
  private magAxes: NoiseAxis[];

  constructor(private physics: PhonePhysics) {
    const n = this.noise;
    this.gyroAxes = [0, 1, 2].map((i) => new NoiseAxis(n.gyroStd[i]!, n.gyroWalk[i]!, n.colored));
    this.accelAxes = [0, 1, 2].map((i) => new NoiseAxis(n.accelStd[i]!, n.accelWalk[i]!, n.colored));
    this.magAxes = [0, 1, 2].map((i) => new NoiseAxis(n.magStd[i]!, n.magWalk[i]!, n.colored));
  }

  onSample(cb: (s: ImuSample) => void): void {
    this.callbacks.push(cb);
  }

  start(): void {
    // driven externally via advance()
  }

  stop(): void {
    // driven externally via advance()
  }

  setNoise(n: NoiseConfig): void {
    this.noise = n;
    for (let i = 0; i < 3; i++) {
      this.gyroAxes[i]!.setConfig(n.gyroStd[i]!, n.gyroWalk[i]!, n.colored);
      this.accelAxes[i]!.setConfig(n.accelStd[i]!, n.accelWalk[i]!, n.colored);
      this.magAxes[i]!.setConfig(n.magStd[i]!, n.magWalk[i]!, n.colored);
    }
  }

  shake(): void {
    this.shakeUntil = this.t + 1.2;
    this.physics.shake();
  }

  getTrueOrientation(): THREE.Quaternion {
    return this.physics.quaternion();
  }

  getTrueAngularVelocity(): [number, number, number] {
    return this.physics.angularVelocity();
  }

  /** Called once per sim step. Advances physics by dt·timescale, derives a
   * noisy sample from the body state, and emits it. */
  advance(dt: number): void {
    const sdt = dt * this.timescale;
    this.t += sdt;
    this.physics.step(sdt);

    // Ambient driving per mode so there's always something to look at.
    const torque = this.ambientTorque();
    if (torque) this.physics.applyAmbientTorque(torque);

    const q = this.physics.quaternion();
    // The integrator reports angularVelocity in the world frame; the gyro
    // measures it in the body frame, same as gravity/mag below.
    const omegaBody = bodyFrame(q, this.physics.angularVelocity());
    const gyro = sampleAxes(this.gyroAxes, omegaBody, sdt);

    const gravityBody = bodyFrame(q, WORLD_G);
    // Specific force = gravity reaction *plus* whatever linear acceleration
    // the body actually has (e.g. shift+drag translating it) — without this
    // term, moving the phone is invisible to the accelerometer.
    const linAccelBody = bodyFrame(q, this.physics.linearAcceleration());
    const disturbance = this.accelDisturbance();
    const specificForce: [number, number, number] = [
      gravityBody[0] + linAccelBody[0] + disturbance[0],
      gravityBody[1] + linAccelBody[1] + disturbance[1],
      gravityBody[2] + linAccelBody[2] + disturbance[2],
    ];
    const accel = sampleAxes(this.accelAxes, specificForce, sdt);

    const fieldBody = bodyFrame(q, WORLD_M);
    const mag = sampleAxes(this.magAxes, fieldBody, sdt);

    const sample: ImuSample = { gyro, accel, mag, dt: sdt };
    for (const cb of this.callbacks) cb(sample);
  }

  private ambientTorque(): [number, number, number] | null {
    // Scaled to stay gentle under *continuous* application (this runs every
    // step, forever, not just a brief pre-sleep twitch): the phone's tiny
    // moment of inertia (~0.01-0.07 kg·m²) combined with angularDamping=0.25
    // means even a small constant torque settles at a surprisingly large
    // steady-state angular velocity (w_ss ≈ torque / (I · k), k≈0.29/s here)
    // — unscaled, these numbers spun the phone at several rad/s.
    const AMBIENT_SCALE = 1 / 60;
    if (this.mode === "shake") {
      // Shake impulses come from shake() itself; add a little wobble.
      return [
        AMBIENT_SCALE * 0.05 * Math.sin(this.t * 2.1),
        AMBIENT_SCALE * 0.03 * Math.cos(this.t * 1.7),
        AMBIENT_SCALE * 0.06 * Math.sin(this.t * 2.9),
      ];
    }
    if (this.mode === "walk") {
      return [
        AMBIENT_SCALE * 0.12 * Math.sin(this.t * 1.3),
        AMBIENT_SCALE * 0.09 * Math.cos(this.t * 0.9),
        AMBIENT_SCALE * 0.1 * Math.sin(this.t * 0.6),
      ];
    }
    // idle: a short, exponentially-decaying kick after (re)start so the phone
    // settles to rest instead of spinning forever. A constant torque would
    // keep it in perpetual motion — which reads as "broken", not "alive".
    const settle = Math.exp(-this.t / 1.5);
    return [
      AMBIENT_SCALE * 0.06 * settle * Math.sin(this.t * 0.5),
      AMBIENT_SCALE * 0.04 * settle * Math.cos(this.t * 0.37),
      AMBIENT_SCALE * 0.05 * settle * Math.sin(this.t * 0.23),
    ];
  }

  private accelDisturbance(): [number, number, number] {
    // Linear acceleration the accelerometer can't separate from gravity.
    if (this.t < this.shakeUntil) {
      const k = 18;
      return [k * Math.sin(this.t * 40), k * Math.cos(this.t * 47), k * Math.sin(this.t * 53)];
    }
    if (this.mode === "walk") {
      const bounce = 4.5 * Math.abs(Math.sin(this.t * 6));
      return [0.4 * Math.sin(this.t * 3), 0, bounce];
    }
    return [0, 0, 0];
  }
}
