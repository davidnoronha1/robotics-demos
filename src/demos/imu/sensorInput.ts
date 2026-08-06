import * as THREE from "three";
import type { ImuSample } from "./estimators";

export type MotionMode = "idle" | "walk" | "shake";

export interface ImuSource {
  start(): void;
  stop(): void;
  onSample(cb: (sample: ImuSample) => void): void;
}

export const WORLD_G: [number, number, number] = [0, 0, 9.81];
export const WORLD_M: [number, number, number] = [25, 0, 43.3];

/** Small helper: |Δyaw| between two attitudes, for the drift readout. */
export function angleBetweenYaw(a: THREE.Quaternion, b: THREE.Quaternion): number {
  const yawA = new THREE.Euler().setFromQuaternion(a, "ZYX").z;
  const yawB = new THREE.Euler().setFromQuaternion(b, "ZYX").z;
  let diff = (yawA - yawB) * (180 / Math.PI);
  diff = ((diff + 180) % 360 + 360) % 360 - 180;
  return Math.abs(diff);
}
