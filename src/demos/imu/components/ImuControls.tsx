import type { RefObject } from "preact";
import { Tabs } from "../../../shared/Tabs";
import { Slider } from "../../../shared/ui/Slider";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { NoisePanel } from "../NoisePanel";
import { TrustPanel, type TrustValues } from "../TrustPanel";
import type { MotionMode, NoiseConfig } from "../simController";
import type { FusionParams } from "../fusionCode";

const PANEL_SPECS = [
  { id: "motion", label: "Motion" },
  { id: "noise", label: "Sensor noise" },
  { id: "ekf", label: "EKF config" },
] as const;

export type ImuPanelId = (typeof PANEL_SPECS)[number]["id"];

interface ImuControlsProps {
  usingReal: boolean;
  activePanel: ImuPanelId;
  setActivePanel: (p: ImuPanelId) => void;
  mode: MotionMode;
  setMode: (m: MotionMode) => void;
  onShake: () => void;
  onReset: () => void;
  timescale: number;
  setTimescale: (t: number) => void;
  noise: NoiseConfig;
  setNoise: (n: NoiseConfig) => void;
  trust: TrustValues;
  applyTrust: (p: Partial<FusionParams>) => void;
  linkEnabled: boolean;
  setLinkEnabled: (l: boolean) => void;
  driftSpanRef: RefObject<HTMLSpanElement>;
}

export function ImuControls({
  usingReal,
  activePanel,
  setActivePanel,
  mode,
  setMode,
  onShake,
  onReset,
  timescale,
  setTimescale,
  noise,
  setNoise,
  trust,
  applyTrust,
  linkEnabled,
  setLinkEnabled,
  driftSpanRef,
}: ImuControlsProps) {
  return (
    <div class="control-panel">
      <Tabs
        specs={PANEL_SPECS.filter((s) => s.id === "ekf" || !usingReal)}
        active={usingReal ? "ekf" : activePanel}
        onChange={(id) => setActivePanel(id as ImuPanelId)}
      />

      {!usingReal && activePanel === "motion" && (
        <div class="imu-panel-body">
          <div class="imu-modes">
            {(["idle", "walk"] as const).map((m) => (
              <button
                key={m}
                type="button"
                class={`imu-mode${mode === m ? " active" : ""}`}
                onClick={() => setMode(m)}
              >
                {m === "idle" ? "Idle" : "Walk (accel lies about tilt)"}
              </button>
            ))}
            <button type="button" onClick={onShake}>
              Shake
            </button>
          </div>
          <button type="button" onClick={onReset}>
            Reset orientation
          </button>
          <Slider
            label="Sim time scale"
            min={0.1}
            max={2}
            step={0.1}
            value={timescale}
            format={(v) => `${v.toFixed(1)}×`}
            onChange={setTimescale}
          />
        </div>
      )}

      {!usingReal && activePanel === "noise" && (
        <div class="imu-panel-body">
          <NoisePanel noise={noise} onChange={setNoise} />
        </div>
      )}

      {(usingReal || activePanel === "ekf") && (
        <div class="imu-panel-body">
          <TrustPanel trust={trust} onChange={applyTrust} />
          <Checkbox label="Link sliders → code params" checked={linkEnabled} onChange={setLinkEnabled} />
          <div class="ctrl ctrl-readout">
            <span>Gyro-only yaw error</span>
            <span class="ctrl-value" ref={driftSpanRef} />
          </div>
        </div>
      )}
    </div>
  );
}
