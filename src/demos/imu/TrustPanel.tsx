import { Checkbox } from "../../shared/ui/Checkbox";
import { NumberInput } from "../../shared/ui/NumberInput";
import { Slider } from "../../shared/ui/Slider";
import type { FusionParams } from "./fusionCode";

export type TrustValues = Required<
  Pick<FusionParams, "qGyro" | "qAccel" | "rAccel" | "rMag" | "rPos" | "alpha" | "useMagYaw">
>;

export interface TrustPanelProps {
  trust: TrustValues;
  onChange: (p: Partial<FusionParams>) => void;
}

const AXES = ["x", "y", "z"] as const;
const fmt = (v: number) => String(v);

export function TrustPanel({ trust, onChange }: TrustPanelProps) {
  return (
    <div class="imu-trust">
      <div class="imu-trust-grid">
        <NumberInput
          label="Q_gyro · attitude process noise"
          value={trust.qGyro}
          step={1e-4}
          min={0}
          format={fmt}
          onChange={(v) => onChange({ qGyro: v })}
        />
        <NumberInput
          label="Q_accel · velocity process noise"
          value={trust.qAccel}
          step={1e-2}
          min={0}
          format={fmt}
          onChange={(v) => onChange({ qAccel: v })}
        />
        {AXES.map((axis, i) => (
          <NumberInput
            key={`ra-${axis}`}
            label={`R_accel·${axis}`}
            value={trust.rAccel[i]!}
            step={1e-3}
            min={0}
            format={fmt}
            onChange={(v) => {
              const r = [...trust.rAccel] as [number, number, number];
              r[i] = v;
              onChange({ rAccel: r });
            }}
          />
        ))}
        {AXES.map((axis, i) => (
          <NumberInput
            key={`rm-${axis}`}
            label={`R_mag·${axis}`}
            value={trust.rMag[i]!}
            step={1}
            min={0}
            format={fmt}
            onChange={(v) => {
              const r = [...trust.rMag] as [number, number, number];
              r[i] = v;
              onChange({ rMag: r });
            }}
          />
        ))}
        {AXES.map((axis, i) => (
          <NumberInput
            key={`rp-${axis}`}
            label={`R_pos·${axis}`}
            value={trust.rPos[i]!}
            step={1e-3}
            min={0}
            format={fmt}
            onChange={(v) => {
              const r = [...trust.rPos] as [number, number, number];
              r[i] = v;
              onChange({ rPos: r });
            }}
          />
        ))}
        <Slider
          label="Complementary α"
          min={0}
          max={1}
          step={0.01}
          value={trust.alpha}
          format={(v) => v.toFixed(2)}
          onChange={(v) => onChange({ alpha: v })}
        />
        <Checkbox label="Mag-correct yaw" checked={trust.useMagYaw} onChange={(v) => onChange({ useMagYaw: v })} />
      </div>
    </div>
  );
}
