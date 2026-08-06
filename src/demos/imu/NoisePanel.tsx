import { Checkbox } from "../../shared/ui/Checkbox";
import { NumberInput } from "../../shared/ui/NumberInput";
import type { NoiseConfig } from "./syntheticImu";

interface Spec {
  key: "gyro" | "accel" | "mag";
  label: string;
  stdKey: "gyroStd" | "accelStd" | "magStd";
  walkKey: "gyroWalk" | "accelWalk" | "magWalk";
  stdUnit: string;
  stepStd: number;
  stepWalk: number;
}

const SPECS: Spec[] = [
  { key: "gyro", label: "Gyro", stdKey: "gyroStd", walkKey: "gyroWalk", stdUnit: "rad/s", stepStd: 0.001, stepWalk: 0.001 },
  { key: "accel", label: "Accel", stdKey: "accelStd", walkKey: "accelWalk", stdUnit: "m/s²", stepStd: 0.01, stepWalk: 0.01 },
  { key: "mag", label: "Mag", stdKey: "magStd", walkKey: "magWalk", stdUnit: "µT", stepStd: 0.5, stepWalk: 0.05 },
];

export interface NoisePanelProps {
  noise: NoiseConfig;
  onChange: (n: NoiseConfig) => void;
}

export function NoisePanel({ noise, onChange }: NoisePanelProps) {
  return (
    <div class="imu-noise">
      <Checkbox
        label="Colored (AR-1) noise"
        checked={noise.colored}
        onChange={(v) => onChange({ ...noise, colored: v })}
      />
      {SPECS.map((spec) => (
        <fieldset class="imu-noise-group" key={spec.key}>
          <legend>{spec.label}</legend>
          <div class="imu-noise-row">
            {([0, 1, 2] as const).map((i) => (
              <NumberInput
                key={i}
                label={`σ${["x", "y", "z"][i]} (${spec.stdUnit})`}
                value={noise[spec.stdKey][i]}
                step={spec.stepStd}
                min={0}
                onChange={(v) => {
                  const std = [...noise[spec.stdKey]] as [number, number, number];
                  std[i] = v;
                  onChange({ ...noise, [spec.stdKey]: std });
                }}
              />
            ))}
            <NumberInput
              label="bias walk"
              value={noise[spec.walkKey][0]}
              step={spec.stepWalk}
              min={0}
              onChange={(v) => onChange({ ...noise, [spec.walkKey]: [v, v, v] })}
            />
          </div>
        </fieldset>
      ))}
    </div>
  );
}
