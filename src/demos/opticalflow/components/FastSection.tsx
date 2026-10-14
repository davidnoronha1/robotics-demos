import type { RefObject } from "preact";
import { FastInset, type FastInsetHandle } from "../fastInset";

interface FastSectionProps {
  insetRef: RefObject<FastInsetHandle>;
  gray: Uint8Array;
  w: number;
  h: number;
  x: number | null;
  y: number | null;
  threshold: number;
}

export function FastSection({ insetRef, gray, w, h, x, y, threshold }: FastSectionProps) {
  return (
    <div class="of-inset-row">
      <div>
        <h3>FAST at a glance</h3>
        <FastInset ref={insetRef} gray={gray} w={w} h={h} x={x} y={y} threshold={threshold} />
      </div>
      <p class="imu-note">
        Hover the feed to inspect the raw pixels. Green squares are brighter than the center by more than the
        threshold, red ones darker, translucent ones similar. Nine in a row = a FAST corner. (Follows the detector:
        it only applies when FAST is selected.)
      </p>
    </div>
  );
}
