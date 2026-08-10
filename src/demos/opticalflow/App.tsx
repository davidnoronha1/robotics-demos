import { useEffect, useRef, useState } from "preact/hooks";
import { Tabs } from "../../shared/Tabs";
import { Slider } from "../../shared/ui/Slider";
import { Checkbox } from "../../shared/ui/Checkbox";
import { Readout } from "../../shared/ui/Readout";
import { createCodeEditor, type CodeEditor } from "../../shared/codeEditor";
import { buildQrAffordance } from "../../shared/qr";
import { GrayscaleCapture } from "./capture";
import { FlowController, type DetectorId } from "./flowController";
import { CameraSource, ClipSource, type VideoSource } from "./videoSource";
import { extractParams, injectParams, DEFAULT_ORB_SOURCE } from "./trackerCode";
import { drawOverlay, type OverlayState } from "./overlay";
import { FastInset, type FastInsetHandle } from "./fastInset";
import { MathExplainer } from "./MathExplainer";
import type { SimilarityMotion } from "./motionModel";
import fallbackClip from "../../../demos/opticalflow/assets/fallback.webm";

const CAMERA_WIDTH = 320;
const CAMERA_HEIGHT = 240;

type PanelId = "detector" | "matching" | "overlay";

const PANELS: Array<{ id: PanelId; label: string }> = [
  { id: "detector", label: "Detector" },
  { id: "matching", label: "Matching" },
  { id: "overlay", label: "Overlay" },
];

interface PersistedState {
  detector: DetectorId;
  fastThreshold: number;
  shiMin: number;
  maxTracks: number;
  minDist: number;
  ratio: number;
  mirrored: boolean;
  linkEnabled: boolean;
  codeSource: string;
  videoRate: number;
}

const STORAGE_KEY = "optical-demo-dev-state";

function loadPersisted(): PersistedState | null {
  if (!import.meta.env.DEV) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedState) : null;
  } catch {
    return null;
  }
}

/** Sizes the overlay canvas's backing store to match how large it's actually
 * displayed (CSS can stretch it far past 320×240 on wide viewports) so
 * drawing stays crisp instead of being upscaled and blurred. Draw calls
 * still use logical 320×240 (gray-buffer) coordinates — the transform maps
 * them onto however many real device pixels the canvas currently occupies. */
function resizeOverlay(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
  const displayW = canvas.clientWidth || canvas.parentElement?.clientWidth || w;
  const displayH = canvas.clientHeight || canvas.parentElement?.clientHeight || h;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const pixelW = Math.max(1, Math.round(displayW * dpr));
  const pixelH = Math.max(1, Math.round(displayH * dpr));
  if (canvas.width !== pixelW) canvas.width = pixelW;
  if (canvas.height !== pixelH) canvas.height = pixelH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(pixelW / w, 0, 0, pixelH / h, 0, 0);
  return ctx;
}

function motionText(m: SimilarityMotion | null): string {
  if (!m || m.inlierCount < 2) return "—";
  const mag = Math.hypot(m.tx, m.ty);
  const spinning = Math.abs(m.angleDeg) >= 0.3;
  const zooming = Math.abs(m.scale - 1) >= 0.02;
  if (mag < 0.3 && !spinning && !zooming) return "static";
  const parts: string[] = [];
  if (mag >= 0.3) {
    const dir =
      Math.abs(m.tx) >= Math.abs(m.ty) ? (m.tx < 0 ? "left" : "right") : (m.ty < 0 ? "up" : "down");
    parts.push(`${dir} ${(Math.round(mag * 10) / 10).toFixed(1)} px/frame`);
  }
  if (spinning) parts.push(`rotate ${Math.round(m.angleDeg)}°/frame`);
  if (zooming) parts.push(`zoom ${Math.round(m.scale * 100)}%`);
  return parts.join(" · ");
}

export function App() {
  const restored = useRef(loadPersisted()).current;

  const [detector, setDetector] = useState<DetectorId>(restored?.detector === "shi" ? "shi" : "fast");
  const [fastThreshold, setFastThreshold] = useState(restored?.fastThreshold ?? 25);
  const [shiMin, setShiMin] = useState(restored?.shiMin ?? 300);
  const [maxTracks, setMaxTracks] = useState(restored?.maxTracks ?? 150);
  const [minDist, setMinDist] = useState(restored?.minDist ?? 50);
  const [ratio, setRatio] = useState(restored?.ratio ?? 0.75);
  const [mirrored, setMirrored] = useState(restored?.mirrored ?? false);
  const [linkEnabled, setLinkEnabled] = useState(restored?.linkEnabled ?? true);
  const [showCorners, setShowCorners] = useState(true);
  const [showTracks, setShowTracks] = useState(true);
  const [showMotion, setShowMotion] = useState(true);
  const [showPin, setShowPin] = useState(false);
  const [loupeColor, setLoupeColor] = useState(false);
  const [paused, setPaused] = useState(false);
  const [videoRate, setVideoRate] = useState(restored?.videoRate ?? 1);
  const [activePanel, setActivePanel] = useState<PanelId>("detector");
  const [banner, setBanner] = useState(
    "Using the bundled demo clip — enable your webcam for live footage. All processing is local.",
  );
  const [canCamera, setCanCamera] = useState(CameraSource.supported());
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [counts, setCounts] = useState({ tracks: 0, inliers: 0, motion: "—" });
  const [pinnedCount, setPinnedCount] = useState(0);

  const stageRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const insetRef = useRef<FastInsetHandle | null>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CodeEditor | null>(null);
  const qrHostRef = useRef<HTMLDivElement>(null);

  const controllerRef = useRef<FlowController>(new FlowController(CAMERA_WIDTH, CAMERA_HEIGHT));
  const captureRef = useRef(new GrayscaleCapture(CAMERA_WIDTH, CAMERA_HEIGHT));
  const sourceRef = useRef<VideoSource | null>(null);

  // Mirrors reactive state into refs so the mount-only rAF loop (whose
  // closures are frozen at first render) always reads current values.
  const stateRef = useRef({
    detector,
    fastThreshold,
    shiMin,
    maxTracks,
    minDist,
    ratio,
    mirrored,
    linkEnabled,
    paused,
    videoRate,
  });
  const viewRef = useRef({ showTracks, showCorners, showMotion, showPin, loupeColor });
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    hoverRef.current = hover;
  }, [hover]);
  useEffect(() => {
    stateRef.current = {
      detector,
      fastThreshold,
      shiMin,
      maxTracks,
      minDist,
      ratio,
      mirrored,
      linkEnabled,
      paused,
      videoRate,
    };
  });
  useEffect(() => {
    viewRef.current = { showTracks, showCorners, showMotion, showPin, loupeColor };
  });

  const appliedSourceRef = useRef<string | null>(null);
  const compileErrorRef = useRef<string | null>(null);
  const shownErrorRef = useRef<string | null>(null);

  function syncErrorDisplay(): void {
    const msg = compileErrorRef.current ?? controllerRef.current?.tracker.runtimeError ?? null;
    if (msg !== shownErrorRef.current) {
      shownErrorRef.current = msg;
      editorRef.current?.showError(msg);
    }
  }

  function refreshTracker(source: string): void {
    const c = controllerRef.current!;
    const r = c.tracker.setSource(source);
    if (r.ok) {
      appliedSourceRef.current = source;
      compileErrorRef.current = null;
    } else {
      compileErrorRef.current = r.error ?? "Unknown error";
    }
    if (r.ok && !stateRef.current.linkEnabled) {
      const p = extractParams(source);
      if (p) {
        if (typeof p.minDist === "number") setMinDist(p.minDist);
        if (typeof p.ratio === "number") setRatio(p.ratio);
      }
    }
    syncErrorDisplay();
  }

  function applyMatchingParams(partial: { minDist?: number; ratio?: number }): void {
    const c = controllerRef.current!;
    if (partial.minDist !== undefined) c.minDist = partial.minDist;
    if (partial.ratio !== undefined) c.ratio = partial.ratio;
    setMinDist(c.minDist);
    setRatio(c.ratio);
    if (stateRef.current.linkEnabled && editorRef.current) {
      const wasClean = editorRef.current.getValue() === appliedSourceRef.current;
      const src = injectParams(editorRef.current.getValue(), { minDist: c.minDist, ratio: c.ratio });
      editorRef.current.setValue(src);
      if (wasClean) refreshTracker(src);
    }
  }

  /** Put a video element on the stage, keeping the overlay canvas on top. */
  function setStageVideo(video: HTMLVideoElement): void {
    const stage = stageRef.current;
    const overlay = overlayRef.current;
    if (!stage || !overlay) return;
    stage.replaceChildren(video, overlay);
  }

  async function useCamera(): Promise<void> {
    setCanCamera(false);
    setBanner("Requesting your webcam…");
    const cam = new CameraSource();
    const ok = await cam.start();
    if (!ok) {
      setCanCamera(true);
      setBanner("Webcam unavailable or permission denied — staying on the bundled clip.");
      return;
    }
    sourceRef.current?.stop();
    sourceRef.current = cam;
    setStageVideo(cam.el);
    setBanner("Using your webcam. All processing is local — nothing leaves this device.");
  }

  // Mount: create the overlay canvas, attach the fallback clip, add the QR
  // affordance, and run the frame loop for as long as the component lives.
  useEffect(() => {
    const c = controllerRef.current!;
    c.fastThreshold = restored?.fastThreshold ?? 25;
    c.shiMinThreshold = restored?.shiMin ?? 300;
    c.maxTracks = restored?.maxTracks ?? 150;
    c.minDist = restored?.minDist ?? 50;
    c.ratio = restored?.ratio ?? 0.75;

    const overlay = document.createElement("canvas");
    overlay.className = "of-overlay";
    overlayRef.current = overlay;

    const clip = new ClipSource(fallbackClip);
    sourceRef.current = clip;
    setStageVideo(clip.el);
    void clip.start().then((ok) => {
      if (!ok) setBanner("Bundled clip failed to play — enable your webcam instead.");
    });

    overlayCtxRef.current = resizeOverlay(overlay, CAMERA_WIDTH, CAMERA_HEIGHT);
    const ro = new ResizeObserver(() => {
      overlayCtxRef.current = resizeOverlay(overlay, CAMERA_WIDTH, CAMERA_HEIGHT);
    });
    if (stageRef.current) ro.observe(stageRef.current);

    if (qrHostRef.current) {
      qrHostRef.current.appendChild(
        buildQrAffordance({
          url: "https://robotics-demos.pages.dev/demos/opticalflow/",
          text: "Scan to try this on your phone — point it at a textured surface.",
        }),
      );
    }

    let raf = 0;
    let running = true;

    const loop = (): void => {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      const src = sourceRef.current;
      if (!src) return;
      if (src.el.playbackRate !== stateRef.current.videoRate) src.el.playbackRate = stateRef.current.videoRate;
      if (stateRef.current.paused) return;
      const got = captureRef.current.grab(src.el, c.gray, stateRef.current.mirrored);
      if (!got) return;
      c.process();

      const ctx = overlayCtxRef.current;
      if (ctx) {
        const v = viewRef.current;
        const state: OverlayState = {
          tracks: c.getTrackSnapshot(),
          keypoints: c.lastKeypoints,
          pinLines: c.lastPinLines,
          motion: c.lastMotion,
          showTracks: v.showTracks,
          showCorners: v.showCorners,
          showMotion: v.showMotion,
          showPin: v.showPin,
          loupeColor: v.loupeColor,
          hover: hoverRef.current
            ? { ...hoverRef.current, gray: c.gray, color: captureRef.current.color, grayW: c.w, grayH: c.h }
            : null,
        };
        drawOverlay(ctx, CAMERA_WIDTH, CAMERA_HEIGHT, state);
      }
      insetRef.current?.render();
      syncErrorDisplay();

      const motion = motionText(c.lastMotion);
      setCounts((prev) => {
        const next = { tracks: c.trackCount, inliers: c.lastMotion?.inlierCount ?? 0, motion };
        return prev.tracks === next.tracks && prev.inliers === next.inliers && prev.motion === next.motion
          ? prev
          : next;
      });
      setPinnedCount(c.pinned.count);
    };

    raf = requestAnimationFrame(loop);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      sourceRef.current?.stop();
      sourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push slider/panel state into the controller as it changes.
  useEffect(() => {
    controllerRef.current!.fastThreshold = fastThreshold;
  }, [fastThreshold]);
  useEffect(() => {
    controllerRef.current!.shiMinThreshold = shiMin;
  }, [shiMin]);
  useEffect(() => {
    controllerRef.current!.maxTracks = maxTracks;
  }, [maxTracks]);
  useEffect(() => {
    controllerRef.current!.minDist = minDist;
  }, [minDist]);
  useEffect(() => {
    controllerRef.current!.ratio = ratio;
  }, [ratio]);
  useEffect(() => {
    controllerRef.current!.detector = detector;
  }, [detector]);

  // Editable-code editor (mount once).
  useEffect(() => {
    if (!editorHostRef.current) return;
    const initial =
      restored?.codeSource ??
      injectParams(DEFAULT_ORB_SOURCE, { minDist: restored?.minDist ?? 50, ratio: restored?.ratio ?? 0.75 });
    const editor = createCodeEditor({ value: initial });
    editorRef.current = editor;
    editorHostRef.current.appendChild(editor.el);
    appliedSourceRef.current = initial;
    if (restored?.codeSource) refreshTracker(restored.codeSource);

    return () => {
      editor.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dev-only: persist tuning across reloads.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onUnload = (): void => {
      try {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...stateRef.current, codeSource: editorRef.current?.getValue() ?? "" }),
        );
      } catch {
        /* sessionStorage unavailable — dev-only convenience, safe to skip */
      }
    };
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, []);

  function onStageMove(clientX: number, clientY: number): void {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((clientX - rect.left) / rect.width) * CAMERA_WIDTH;
    const y = ((clientY - rect.top) / rect.height) * CAMERA_HEIGHT;
    setHover({ x: Math.max(0, Math.min(CAMERA_WIDTH - 1, x)), y: Math.max(0, Math.min(CAMERA_HEIGHT - 1, y)) });
  }

  return (
    <div>
      <div class="imu-banner">
        <span>{banner}</span>
        {canCamera && (
          <button type="button" onClick={useCamera}>
            Enable webcam
          </button>
        )}
      </div>

      <div
        ref={stageRef}
        class="of-stage"
        onPointerMove={(e) => onStageMove(e.clientX, e.clientY)}
        onPointerLeave={() => setHover(null)}
        onPointerUp={(e) => {
          if (e.pointerType === "touch") setHover(null);
        }}
      />

      <div class="of-readouts">
        <Readout label="Tracks" value={String(counts.tracks)} />
        <Readout label="Inliers (RANSAC)" value={String(counts.inliers)} />
        <Readout label="Dominant motion" value={counts.motion} />
        <Readout label="Pinned reference" value={pinnedCount ? `${pinnedCount} pts` : "none"} />
      </div>

      <div ref={qrHostRef} />

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
              <button type="button" onClick={() => controllerRef.current!.pinCurrent()}>
                Pin reference frame
              </button>
              <button type="button" onClick={() => controllerRef.current!.clearPinned()}>
                Clear pin
              </button>
              <button type="button" onClick={() => controllerRef.current!.resetTracks()}>
                Reset tracks
              </button>
              <button type="button" onClick={() => setPaused((p) => !p)}>
                {paused ? "Resume" : "Pause"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div class="of-inset-row">
        <div>
          <h3>FAST at a glance</h3>
          <FastInset
            ref={insetRef}
            gray={controllerRef.current!.gray}
            w={CAMERA_WIDTH}
            h={CAMERA_HEIGHT}
            x={detector === "fast" ? hover?.x ?? null : null}
            y={detector === "fast" ? hover?.y ?? null : null}
            threshold={fastThreshold}
          />
        </div>
        <p class="imu-note">
          Hover the feed to inspect the raw pixels. Green squares are brighter than the center by more than the
          threshold, red ones darker, translucent ones similar. Nine in a row = a FAST corner. (Follows the detector:
          it only applies when FAST is selected.)
        </p>
      </div>

      <h3>Editable tracker code (ORB matcher)</h3>
      <div ref={editorHostRef} />
      <div class="imu-modes">
        <button
          type="button"
          onClick={() => {
            const src = editorRef.current?.getValue();
            if (src) refreshTracker(src);
          }}
        >
          Apply
        </button>
        <button
          type="button"
          onClick={() => {
            const src = injectParams(DEFAULT_ORB_SOURCE, { minDist, ratio });
            editorRef.current?.setValue(src);
            refreshTracker(src);
            setLinkEnabled(true);
          }}
        >
          Reset code
        </button>
      </div>

      <MathExplainer />
    </div>
  );
}
