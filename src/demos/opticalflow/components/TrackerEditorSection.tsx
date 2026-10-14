import type { RefObject } from "preact";

interface TrackerEditorSectionProps {
  editorHostRef: RefObject<HTMLDivElement>;
  onApply: () => void;
  onReset: () => void;
}

export function TrackerEditorSection({ editorHostRef, onApply, onReset }: TrackerEditorSectionProps) {
  return (
    <>
      <h3>Editable tracker code (ORB matcher)</h3>
      <div ref={editorHostRef} />
      <div class="imu-modes">
        <button type="button" onClick={onApply}>
          Apply
        </button>
        <button type="button" onClick={onReset}>
          Reset code
        </button>
      </div>
    </>
  );
}
