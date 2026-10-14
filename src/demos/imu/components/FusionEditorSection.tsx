import type { RefObject } from "preact";
import { Checkbox } from "../../../shared/ui/Checkbox";

interface FusionEditorSectionProps {
  activeFilter: "ekf" | "comp";
  onSelectFilter: (filter: "ekf" | "comp") => void;
  editorHostRef: RefObject<HTMLDivElement>;
  onApplyCode: () => void;
  restoreDev: boolean;
  setRestoreDev: (r: boolean) => void;
}

export function FusionEditorSection({
  activeFilter,
  onSelectFilter,
  editorHostRef,
  onApplyCode,
  restoreDev,
  setRestoreDev,
}: FusionEditorSectionProps) {
  return (
    <>
      <h3>Editable fusion code</h3>
      <div class="imu-modes">
        <button
          type="button"
          class={activeFilter === "ekf" ? "active" : ""}
          onClick={() => onSelectFilter("ekf")}
        >
          EKF (extended Kalman)
        </button>
        <button
          type="button"
          class={activeFilter === "comp" ? "active" : ""}
          onClick={() => onSelectFilter("comp")}
        >
          Complementary (simple)
        </button>
      </div>

      <div ref={editorHostRef} />

      <div class="imu-modes">
        <button type="button" onClick={onApplyCode}>
          Apply
        </button>
        <button type="button" onClick={() => onSelectFilter("ekf")}>
          Reset code
        </button>
      </div>

      {import.meta.env.DEV && (
        <Checkbox
          label="Dev: restore tuning across reload (sessionStorage)"
          checked={restoreDev}
          onChange={setRestoreDev}
        />
      )}
    </>
  );
}
