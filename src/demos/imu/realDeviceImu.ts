import type { ImuSample } from "./estimators";
import type { ImuSource } from "./sensorInput";

const DEG2RAD = Math.PI / 180;

/**
 * Real-device sensors via the `devicemotion` event (iOS 13+ permission
 * dance), plus the Magnetometer sensor API where Chrome exposes it. The
 * magnetometer is optional — if absent, `sample.mag` is null and the filter
 * falls back to gyro + accel.
 */
export class RealDeviceIMU implements ImuSource {
  private listener?: (e: DeviceMotionEvent) => void;
  private magSensor?: { addEventListener: (k: string, cb: () => void) => void; x: number | null; y: number | null; z: number | null };
  private callbacks: Array<(s: ImuSample) => void> = [];
  private magReading: [number, number, number] | null = null;
  private refCbs: Array<(m: [number, number, number]) => void> = [];
  private refAccum: Array<[number, number, number]> = [];

  static isSupported(): boolean {
    return typeof window !== "undefined" && "DeviceMotionEvent" in window;
  }

  static needsPermission(): boolean {
    const DME = (window as unknown as { DeviceMotionEvent?: { requestPermission?: unknown } }).DeviceMotionEvent;
    return typeof DME?.requestPermission === "function";
  }

  static async requestPermission(): Promise<boolean> {
    const DME = (window as unknown as {
      DeviceMotionEvent: { requestPermission: () => Promise<"granted" | "denied"> };
    }).DeviceMotionEvent;
    try {
      const result = await DME.requestPermission();
      return result === "granted";
    } catch {
      return false;
    }
  }

  onSample(cb: (s: ImuSample) => void): void {
    this.callbacks.push(cb);
  }

  /** Fired once the first ~40 mag readings have been smoothed into a usable
   * world-frame reference (caller should have asked the user to hold still). */
  onMagReference(cb: (m: [number, number, number]) => void): void {
    this.refCbs.push(cb);
    if (this.refAccum.length >= 40) cb(this.meanMag());
  }

  private meanMag(): [number, number, number] {
    const n = this.refAccum.length;
    const m: [number, number, number] = [0, 0, 0];
    for (const r of this.refAccum) for (let i = 0; i < 3; i++) m[i]! += r[i]! / n;
    return m;
  }

  start(): void {
    this.listener = (e: DeviceMotionEvent) => {
      const rr = e.rotationRate;
      const acc = e.accelerationIncludingGravity;
      if (!rr || !acc || rr.alpha == null || acc.x == null) return;

      const gyro: [number, number, number] = [(rr.beta ?? 0) * DEG2RAD, (rr.gamma ?? 0) * DEG2RAD, (rr.alpha ?? 0) * DEG2RAD];
      const accel: [number, number, number] = [acc.x ?? 0, acc.y ?? 0, acc.z ?? 0];
      const dt = e.interval ? e.interval / 1000 : 1 / 60;

      const sample: ImuSample = { gyro, accel, mag: this.magReading, dt };
      for (const cb of this.callbacks) cb(sample);
    };
    window.addEventListener("devicemotion", this.listener);

    // Optional Magnetometer API (Chromium). Absent everywhere else — fine.
    const MCtor = (window as unknown as { Magnetometer?: new (o: { frequency: number }) => unknown }).Magnetometer;
    if (MCtor) {
      try {
        this.magSensor = new MCtor({ frequency: 60 }) as RealDeviceIMU["magSensor"];
        this.magSensor!.addEventListener("reading", () => {
          const x = this.magSensor!.x;
          const y = this.magSensor!.y;
          const z = this.magSensor!.z;
          if (x != null && y != null && z != null) {
            this.magReading = [x, y, z];
            if (this.refAccum.length < 40) {
              this.refAccum.push([x, y, z]);
              if (this.refAccum.length === 40) {
                const m = this.meanMag();
                for (const cb of this.refCbs) cb(m);
              }
            }
          }
        });
        (this.magSensor as { start?: () => void }).start?.();
      } catch {
        this.magSensor = undefined;
      }
    }
  }

  stop(): void {
    if (this.listener) window.removeEventListener("devicemotion", this.listener);
    if (this.magSensor) (this.magSensor as { stop?: () => void }).stop?.();
  }
}
