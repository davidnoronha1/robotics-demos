export interface TabSpec {
  id: string;
  label: string;
}

export interface TabsProps {
  specs: TabSpec[];
  active: string;
  onChange: (id: string) => void;
}

export function Tabs({ specs, active, onChange }: TabsProps) {
  return (
    <div class="tabs">
      {specs.map((spec) => (
        <button
          type="button"
          key={spec.id}
          class={spec.id === active ? "active" : ""}
          onClick={() => onChange(spec.id)}
        >
          {spec.label}
        </button>
      ))}
    </div>
  );
}
