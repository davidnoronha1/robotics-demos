import { useState } from "preact/hooks";
import { Tabs } from "../../../shared/Tabs";
import { Slider } from "../../../shared/ui/Slider";
import { Checkbox } from "../../../shared/ui/Checkbox";
import type { DetectorId } from "../flowController";

type PanelId = "detector" | "matching" | "overlay";

const PANELS: Array<{ id: PanelId; label: string }> = [
  { id: "detector", label: "Detector" },
  { id: "matching", label: "Matching" },
  { id: "overlay", label: "Overlay" },
];

interface OpticalFlowControlsProps {
  detector: DetectorId;
  setDetector: (d: DetectorId) => void;
  fastThreshold: number;
  setFastThreshold: (t: number) => void;
  shiMin: number;
  setShiMin: (m: number) => void;
  mirrored: boolean;
  setMirrored: (m: boolean) => void;

  maxTracks: number;
  setMaxTracks: (m: number) => void;
  minDist: number;
  ratio: number;
  applyMatchingParams: (params: { minDist?: number; ratio?: number }) => void;
  linkEnabled: boolean;
  setLinkEnabled: (l: boolean) => void;

  showCorners: boolean;
  setShowCorners: (v: boolean) => void;
  showTracks: boolean;
  setShowTracks: (v: boolean) => void;
  showMotion: boolean;
  setShowMotion: (v: boolean) => void;
  showPin: boolean;
  setShowPin: (v: boolean) => void;
  loupeColor: boolean;
  setLoupeColor: (v: boolean) => void;
  videoRate: number;
  setVideoRate: (r: number) => void;
  paused: boolean;
  onTogglePause: () => void;
  onPinCurrent: () => void;
  onClearPinned: () => void;
  onResetTracks: () => void;
}

export function OpticalFlowControls({
  detector,
  setDetector,
  fastThreshold,
  setFastThreshold,
  shiMin,
  setShiMin,
  mirrored,
  setMirrored,
  maxTracks,
  setMaxTracks,
  minDist,
  ratio,
  applyMatchingParams,
  linkEnabled,
  setLinkEnabled,
  showCorners,
  setShowCorners,
  showTracks,
  setShowTracks,
  showMotion,
  setShowMotion,
  showPin,
  setShowPin,
  loupeColor,
  setLoupeColor,
  videoRate,
  setVideoRate,
  paused,
  onTogglePause,
  onPinCurrent,
  onClearPinned,
  onResetTracks,
}: OpticalFlowControlsProps) {
  const [activePanel, setActivePanel] = useState<PanelId>("detector");

  return (
    <div class="control-panel">
      <Tabs specs={PANELS} active={activePanel} onChange={(id) => setActivePanel(id as PanelId)} />

      {activePanel === "detector" && (
        <div class="imu-panel-body">
          <div class="imu-modes">
            <button type="button" class={detector === "fast" ? "active" : ""} onClick={() => setDetector("fast")}>
              FAST
            </button>
            <button type="button" class={detector === "shi" ? "active" : ""} onClick={() => setDetector("shi")}>
              Shi–Tomasi
            </button>
          </div>
          <Slider label="Detector threshold" min={3} max={80} step={1} value={fastThreshold} onChange={setFastThreshold} />
          {detector === "shi" && (
            <Slider label="Shi–Tomasi min eigenvalue" value={shiMin} min={10} max={2000} step={10} onChange={setShiMin} />
          )}
          <Checkbox label="Mirror (selfie view)" checked={mirrored} onChange={setMirrored} />
        </div>
      )}

      {activePanel === "matching" && (
        <div class="imu-panel-body">
          <Slider label="Max tracks" value={maxTracks} min={20} max={400} step={10} onChange={setMaxTracks} />
          <Slider
            label="minDist (Hamming)"
            value={minDist}
            min={0}
            max={128}
            step={1}
            onChange={(v) => applyMatchingParams({ minDist: v })}
          />
          <Slider
            label="Ratio test"
            value={ratio}
            min={0.5}
            max={1}
            step={0.01}
            onChange={(v) => applyMatchingParams({ ratio: v })}
          />
          <Checkbox label="Link sliders → code params" checked={linkEnabled} onChange={setLinkEnabled} />
        </div>
      )}

      {activePanel === "overlay" && (
        <div class="imu-panel-body">
          <Checkbox label="Corners" checked={showCorners} onChange={setShowCorners} />
          <Checkbox label="Trails" checked={showTracks} onChange={setShowTracks} />
          <Checkbox label="Dominant motion" checked={showMotion} onChange={setShowMotion} />
          <Checkbox label="Pinned matches" checked={showPin} onChange={setShowPin} />
          <Checkbox label="Color pixels in loupe" checked={loupeColor} onChange={setLoupeColor} />
          <Slider
            label="Playback speed"
            value={videoRate}
            min={0.1}
            max={2}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={setVideoRate}
          />
          <div class="imu-modes">
            <button type="button" onClick={onPinCurrent}>
              Pin reference frame
            </button>
            <button type="button" onClick={onClearPinned}>
              Clear pin
            </button>
            <button type="button" onClick={onResetTracks}>
              Reset tracks
            </button>
            <button type="button" onClick={onTogglePause}>
              {paused ? "Resume" : "Pause"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
