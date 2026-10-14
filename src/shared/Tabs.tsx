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
    <nav class="tabs" role="tablist">
      {specs.map((spec) => {
        const isActive = spec.id === active;
        return (
          <button
            type="button"
            key={spec.id}
            role="tab"
            aria-selected={isActive}
            class={isActive ? "tab-item active" : "tab-item"}
            onClick={() => onChange(spec.id)}
          >
            {spec.label}
          </button>
        );
      })}
    </nav>
  );
}
