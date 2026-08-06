import { bodyFrame, eulerOf, worldFrame } from "./quaternion";
import { AngleUnwrap } from "./angleUnwrap";
import { WORLD_G, WORLD_M } from "./sensorInput";
import type { ImuSample } from "./estimators";
import type { ImuController } from "./simController";

const RAD2DEG = 180 / Math.PI;

export type PlotId =
  | "gyro"
  | "roll"
  | "pitch"
  | "yaw"
  | "heading"
  | "accel"
  | "accelVel"
  | "accelPos"
  | "mag"
  | "innov"
  | "cov";

export type PlotFrame = Partial<Record<PlotId, Record<string, number>>>;

function norm360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Turns one IMU sample plus the controller's current filter state into the
 * per-plot series values the demo streams into its charts. Owns the
 * angle-unwrap state (so roll/pitch/yaw plots don't show a ±180° sawtooth)
 * and the naive velocity/position double-integration used purely to
 * demonstrate accelerometer drift — kept out of App.tsx so the sample
 * handler there is just "compute a frame, push it," not the math itself.
 */
export class PlotFeed {
  private readonly unwraps = new Map<string, AngleUnwrap>();
  private velocity: [number, number, number] = [0, 0, 0];
  private position: [number, number, number] = [0, 0, 0];
  private lastAccelT: number | null = null;

  reset(): void {
    this.unwraps.clear();
    this.velocity = [0, 0, 0];
    this.position = [0, 0, 0];
    this.lastAccelT = null;
  }

  computeFrame(
    c: ImuController,
    sample: ImuSample,
    t: number,
  ): { plots: PlotFrame; polarYaw: { fused: number; true: number } } {
    const eG = eulerOf(c.qGyro);
    const eA = eulerOf(c.qAccel);
    const eF = eulerOf(c.qFused);
    const eT = c.trueOrientation ? eulerOf(c.trueOrientation) : null;

    const plots: PlotFrame = {
      roll: {
        fused: this.unwrap("rollF", eF.roll * RAD2DEG),
        gyro: this.unwrap("rollG", eG.roll * RAD2DEG),
        accel: this.unwrap("rollA", eA.roll * RAD2DEG),
        true: eT ? this.unwrap("rollT", eT.roll * RAD2DEG) : NaN,
      },
      pitch: {
        fused: this.unwrap("pitchF", eF.pitch * RAD2DEG),
        gyro: this.unwrap("pitchG", eG.pitch * RAD2DEG),
        accel: this.unwrap("pitchA", eA.pitch * RAD2DEG),
        true: eT ? this.unwrap("pitchT", eT.pitch * RAD2DEG) : NaN,
      },
      yaw: {
        fused: this.unwrap("yawF", eF.yaw * RAD2DEG),
        gyro: this.unwrap("yawG", eG.yaw * RAD2DEG),
        true: eT ? this.unwrap("yawT", eT.yaw * RAD2DEG) : NaN,
      },
      heading: {
        fused: this.unwrap("hdgF", eF.yaw * RAD2DEG),
        mag: this.unwrap("hdgM", eulerOf(c.qMag).yaw * RAD2DEG),
        true: eT ? this.unwrap("hdgT", eT.yaw * RAD2DEG) : NaN,
      },
      gyro: { x: sample.gyro[0], y: sample.gyro[1], z: sample.gyro[2] },
      accel: { x: sample.accel[0], y: sample.accel[1], z: sample.accel[2] },
    };

    if (sample.mag) plots.mag = { x: sample.mag[0], y: sample.mag[1], z: sample.mag[2] };

    // Rotate the accel reading into the world frame, subtract gravity to get
    // linear acceleration, then integrate twice. See the class doc comment.
    if (this.lastAccelT !== null) {
      const dt = t - this.lastAccelT;
      const aWorld = worldFrame(c.qFused, sample.accel);
      const v = this.velocity;
      const p = this.position;
      this.velocity = [
        v[0] + (aWorld[0] - WORLD_G[0]) * dt,
        v[1] + (aWorld[1] - WORLD_G[1]) * dt,
        v[2] + (aWorld[2] - WORLD_G[2]) * dt,
      ];
      this.position = [p[0] + v[0] * dt, p[1] + v[1] * dt, p[2] + v[2] * dt];
    }
    this.lastAccelT = t;
    plots.accelVel = { x: this.velocity[0], y: this.velocity[1], z: this.velocity[2] };
    plots.accelPos = { x: this.position[0], y: this.position[1], z: this.position[2] };

    const gBody = bodyFrame(c.qFused, WORLD_G);
    const resAccel = Math.hypot(sample.accel[0] - gBody[0], sample.accel[1] - gBody[1], sample.accel[2] - gBody[2]);
    let resMag = NaN;
    if (sample.mag) {
      const mBody = bodyFrame(c.qFused, WORLD_M);
      resMag = Math.hypot(sample.mag[0] - mBody[0], sample.mag[1] - mBody[1], sample.mag[2] - mBody[2]);
    }
    plots.innov = { accel: resAccel, mag: resMag };

    const trace = c.fused.state.P[0]![0]! + c.fused.state.P[1]![1]! + c.fused.state.P[2]![2]!;
    plots.cov = { trace };

    return {
      plots,
      polarYaw: {
        fused: norm360(eF.yaw * RAD2DEG),
        true: eT ? norm360(eT.yaw * RAD2DEG) : NaN,
      },
    };
  }

  private unwrap(key: string, deg: number): number {
    let u = this.unwraps.get(key);
    if (!u) {
      u = new AngleUnwrap();
      this.unwraps.set(key, u);
    }
    return u.next(deg);
  }
}
