export interface SliderProps {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

export function Slider({ label, min, max, step, value, format = (v) => v.toFixed(2), onChange }: SliderProps) {
  return (
    <label class="ctrl ctrl-slider">
      <div class="ctrl-row">
        <span>{label}</span>
        <span class="ctrl-value">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onChange((e.currentTarget as HTMLInputElement).valueAsNumber)}
      />
    </label>
  );
}
