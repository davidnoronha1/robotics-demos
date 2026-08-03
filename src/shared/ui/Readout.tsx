export interface ReadoutProps {
  label: string;
  value: string;
}

export function Readout({ label, value }: ReadoutProps) {
  return (
    <div class="ctrl ctrl-readout">
      <span>{label}</span>
      <span class="ctrl-value">{value}</span>
    </div>
  );
}
