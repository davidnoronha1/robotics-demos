import type { RefObject } from "preact";
import { Readout } from "../../../shared/ui/Readout";

export interface OpticalFlowCounts {
  tracks: number;
  inliers: number;
  motion: string;
}

interface OpticalFlowStageProps {
  stageRef: RefObject<HTMLDivElement>;
  qrHostRef: RefObject<HTMLDivElement>;
  counts: OpticalFlowCounts;
  pinnedCount: number;
  onStageMove: (x: number, y: number) => void;
  onClearHover: () => void;
}

export function OpticalFlowStage({
  stageRef,
  qrHostRef,
  counts,
  pinnedCount,
  onStageMove,
  onClearHover,
}: OpticalFlowStageProps) {
  return (
    <>
      <div
        ref={stageRef}
        class="of-stage"
        onPointerMove={(e) => onStageMove(e.clientX, e.clientY)}
        onPointerLeave={onClearHover}
        onPointerUp={(e) => {
          if (e.pointerType === "touch") onClearHover();
        }}
      />

      <div class="of-readouts">
        <Readout label="Tracks" value={String(counts.tracks)} />
        <Readout label="Inliers (RANSAC)" value={String(counts.inliers)} />
        <Readout label="Dominant motion" value={counts.motion} />
        <Readout label="Pinned reference" value={pinnedCount ? `${pinnedCount} pts` : "none"} />
      </div>

      <div ref={qrHostRef} />
    </>
  );
}
