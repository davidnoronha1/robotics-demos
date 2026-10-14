import type { RefObject } from "preact";

export type CubeKey = "gyro" | "accel" | "fused" | "heading";

export const CUBE_INFO: Array<{ key: CubeKey; label: string; color: string }> = [
  { key: "gyro", label: "Gyro integration only — drifts", color: "#e0605c" },
  { key: "accel", label: "Accelerometer only — no yaw, jitters", color: "#e0a34c" },
  { key: "fused", label: "Fused (EKF / editable, gyro+accel+mag) — stable", color: "#5fb87a" },
  { key: "heading", label: "Magnetometer heading — bounded, noisy", color: "#58a6ff" },
];

interface ImuStageViewProps {
  qrHostRef: RefObject<HTMLDivElement>;
  stageHostRef: RefObject<HTMLDivElement>;
  usingReal: boolean;
  cubeCanvasRefs: RefObject<Partial<Record<CubeKey, HTMLCanvasElement>>>;
}

export function ImuStageView({
  qrHostRef,
  stageHostRef,
  usingReal,
  cubeCanvasRefs,
}: ImuStageViewProps) {
  return (
    <>
      <div ref={qrHostRef} />

      <div ref={stageHostRef} />

      {!usingReal && (
        <p class="imu-note">
          Drag the phone to spin it (physics engine), shift+drag to move it, right-drag to orbit the camera, scroll
          to zoom. Idle / walk / shake below drive the sensors.
        </p>
      )}

      <div class="imu-cubes imu-cubes-4">
        {CUBE_INFO.map((info) => (
          <div class="imu-cube" key={info.key}>
            <canvas
              ref={(el) => {
                if (el && cubeCanvasRefs.current) {
                  cubeCanvasRefs.current[info.key] = el;
                }
              }}
            />
            <div class="imu-cube-label" style={{ color: info.color }}>
              {info.label}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
