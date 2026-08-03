export interface NumberInputProps {
  label: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}

export function NumberInput({
  label,
  value,
  step,
  min,
  max,
  format = (v) => String(Number(v.toFixed(4))),
  onChange,
}: NumberInputProps) {
  return (
    <label class="ctrl ctrl-number">
      <div class="ctrl-row">
        <span>{label}</span>
        <span class="ctrl-value">{format(value)}</span>
      </div>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onInput={(e) => {
          const v = (e.currentTarget as HTMLInputElement).valueAsNumber;
          if (!Number.isNaN(v)) onChange(v);
        }}
      />
    </label>
  );
}
