import * as THREE from "three";
import { createSimLoop } from "../../shared/simLoop";
import { onVisibilityChange } from "../../shared/visibility";
import { PhonePhysics } from "./physics";
import { angleBetweenYaw, type ImuSource, type MotionMode } from "./sensorInput";
import { DEFAULT_NOISE, SyntheticIMU, type NoiseConfig } from "./syntheticImu";
import { RealDeviceIMU } from "./realDeviceImu";
import { AccelOnlyEstimator, GyroOnlyEstimator, MagHeadingEstimator, type ImuSample } from "./estimators";
import { DEFAULT_EKF_SOURCE, EditableFusion, setWorldMagReference } from "./fusionCode";

/**
 * Owns the simulation: physics, sensor sources, estimators, the fused filter,
 * and the fixed-timestep sim loop. Deliberately has no DOM/rendering code —
 * it exposes current state as plain properties/getters and calls back into
 * whoever mounted it on every sample and every render tick, so Preact (or
 * anything else) can push that state into refs (canvases, plots, the three.js
 * stage) without the controller knowing those things exist.
 */
export class ImuController {
  readonly physics = new PhonePhysics();
  readonly synthetic: SyntheticIMU;
  readonly gyroOnly = new GyroOnlyEstimator();
  readonly accelOnly = new AccelOnlyEstimator();
  readonly magHeadingEst = new MagHeadingEstimator();
  readonly fused: EditableFusion;

  qGyro = new THREE.Quaternion();
  qAccel = new THREE.Quaternion();
  qMag = new THREE.Quaternion();
  qFused = new THREE.Quaternion();
  simTime = 0;
  usingReal = false;
  driftDeg = 0;

  private activeSource: ImuSource;
  private loop: ReturnType<typeof createSimLoop> | null = null;
  private stopVisibility: (() => void) | null = null;

  constructor(
    private readonly onSample: (sample: ImuSample) => void,
    private readonly onRenderFrame: () => void,
  ) {
    this.synthetic = new SyntheticIMU(this.physics);
    this.fused = new EditableFusion(DEFAULT_EKF_SOURCE, new THREE.Quaternion());
    this.activeSource = this.synthetic;
    this.synthetic.onSample((s) => this.handleSample(s));
    this.synthetic.start();
  }

  /** True orientation from the physics engine; null once a real device has
   * taken over (there's no independent ground truth to compare against). */
  get trueOrientation(): THREE.Quaternion | null {
    return this.usingReal ? null : this.synthetic.getTrueOrientation();
  }

  /** True position from the physics engine; null once a real device has
   * taken over (no position sensor to drive it, so it stays at the origin
   * instead of pretending to track it). */
  get truePosition(): [number, number, number] | null {
    return this.usingReal ? null : this.physics.position();
  }

  private handleSample(sample: ImuSample): void {
    this.simTime += sample.dt;
    this.qGyro = this.gyroOnly.update(sample);
    this.qAccel = this.accelOnly.update(sample);
    this.qMag = this.magHeadingEst.update(sample);
    this.qFused = this.fused.update(sample);
    this.driftDeg = this.usingReal
      ? angleBetweenYaw(this.qGyro, this.qFused)
      : angleBetweenYaw(this.qGyro, this.synthetic.getTrueOrientation());
    this.onSample(sample);
  }

  /** Starts the fixed-timestep sim loop, paused automatically while
   * `container` is scrolled out of view or the tab is hidden. */
  mount(container: HTMLElement): void {
    this.loop = createSimLoop(
      (dt) => {
        if (!this.usingReal) this.synthetic.advance(dt);
      },
      () => this.onRenderFrame(),
    );
    this.stopVisibility = onVisibilityChange(
      container,
      () => this.loop?.start(),
      () => this.loop?.stop(),
    );
  }

  dispose(): void {
    this.loop?.stop();
    this.stopVisibility?.();
    this.activeSource.stop();
  }

  setMode(mode: MotionMode): void {
    this.synthetic.mode = mode;
  }

  setTimescale(v: number): void {
    this.synthetic.timescale = v;
  }

  setNoise(n: NoiseConfig): void {
    this.synthetic.setNoise(n);
  }

  shake(): void {
    this.synthetic.shake();
  }

  dragTorque(dxPixels: number, dyPixels: number): void {
    if (!this.usingReal) this.physics.applyDragTorque(dxPixels, dyPixels);
  }

  dragForce(f: [number, number, number]): void {
    if (!this.usingReal) this.physics.applyDragForce(f);
  }

  reset(): void {
    this.physics.reset();
    this.gyroOnly.reset();
    this.accelOnly.reset();
    this.fused.reset();
    this.simTime = 0;
  }

  switchToReal(onStatus: (text: string) => void): void {
    this.activeSource.stop();
    const real = new RealDeviceIMU();
    real.onSample((s) => this.handleSample(s));
    real.onMagReference((m) => {
      setWorldMagReference(m);
      onStatus("mag reference locked, hold still... now move.");
    });
    real.start();
    this.activeSource = real;
    this.usingReal = true;
    this.fused.reset(new THREE.Quaternion());
  }
}

export { DEFAULT_NOISE };
export type { MotionMode, NoiseConfig };
