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
  // Trims trailing zeros (round-trip through Number) rather than a fixed
  // precision like Slider's default: NumberInput values here span several
  // orders of magnitude (e.g. qScale ~1e-4 vs rMag ~4), so a flat toFixed(2)
  // would either truncate the small ones or pad the large ones with zeros.
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
