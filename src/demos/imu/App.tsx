import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { forwardRef } from "preact/compat";
import { setupCanvas } from "../../shared/canvas";
import { Checkbox } from "../../shared/ui/Checkbox";
import { Slider } from "../../shared/ui/Slider";
import { Tabs } from "../../shared/Tabs";
import {
  TimeSeriesPlot,
  type SeriesSpec,
  type TimeSeriesPlotHandle,
  type TimeSeriesPlotProps,
} from "../../shared/TimeSeriesPlot";
import { PolarPlot, type PolarPlotHandle } from "../../shared/PolarPlot";
import { createCodeEditor, type CodeEditor } from "../../shared/codeEditor";
import { drawCube } from "./renderCube";
import { createPhoneStage, type PhoneStage } from "./scene3d";
import { ImuController, DEFAULT_NOISE, type MotionMode, type NoiseConfig } from "./simController";
import { RealDeviceIMU } from "./realDeviceImu";
import type { ImuSample } from "./estimators";
import {
  DEFAULT_COMP_SOURCE,
  DEFAULT_EKF_SOURCE,
  extractParams,
  injectParams,
  type FusionParams,
} from "./fusionCode";
import { buildQrAffordance } from "./qr";
import { PlotFeed, type PlotId } from "./plotFeed";
import { MathExplainer } from "./MathExplainer";
import { NoisePanel } from "./NoisePanel";
import { TrustPanel, type TrustValues } from "./TrustPanel";

const PANEL_SPECS = [
  { id: "motion", label: "Motion" },
  { id: "noise", label: "Sensor noise" },
  { id: "ekf", label: "EKF config" },
] as const;
type PanelId = (typeof PANEL_SPECS)[number]["id"];

/** All plots use the same 15 s streaming window; this is the only knob the
 * demos themselves touch (the shared plot defaults are broader). */
type ImuPlotProps = Omit<TimeSeriesPlotProps, "windowSeconds" | "minWindowSeconds" | "maxWindowSeconds">;

const ImuPlot = forwardRef<TimeSeriesPlotHandle, ImuPlotProps>(function ImuPlot(props, ref) {
  return <TimeSeriesPlot ref={ref} windowSeconds={15} minWindowSeconds={3} maxWindowSeconds={120} {...props} />;
});


/** All "fused" series everywhere in this demo are the same estimate: the
 * active filter (EKF or complementary) blending gyro + accel + mag. */
const FUSED_LABEL = "fused (gyro+accel+mag)";

const C = {
  fused: "#5fb87a",
  gyro: "#e0605c",
  accel: "#e0a34c",
  mag: "#58a6ff",
  true: "#c678dd",
  x: "#e0605c",
  y: "#5fb87a",
  z: "#58a6ff",
};

type CubeKey = "gyro" | "accel" | "fused" | "heading";

const CUBE_CANVAS_W = 140;
const CUBE_CANVAS_H = 180;

const TIMESCALE_MIN = 0.1;
const TIMESCALE_MAX = 2;
const TIMESCALE_STEP = 0.1;

const CUBE_QUATERNION: Record<CubeKey, (c: ImuController) => THREE.Quaternion> = {
  gyro: (c) => c.qGyro,
  accel: (c) => c.qAccel,
  heading: (c) => c.qMag,
  fused: (c) => c.qFused,
};

const CUBE_INFO: Array<{ key: CubeKey; label: string; color: string }> = [
  { key: "gyro", label: "Gyro integration only — drifts", color: C.gyro },
  { key: "accel", label: "Accelerometer only — no yaw, jitters", color: C.accel },
  { key: "fused", label: "Fused (EKF / editable, gyro+accel+mag) — stable", color: C.fused },
  { key: "heading", label: "Magnetometer heading — bounded, noisy", color: C.mag },
];

type TabId = "angular" | "acceleration" | "heading" | "internals";

interface PlotSpec {
  id: PlotId;
  tab: TabId;
  series: SeriesSpec[];
  yLabel: string;
}

const ANGLE_SERIES = (extra: SeriesSpec[]): SeriesSpec[] => [
  { key: "fused", label: FUSED_LABEL, color: C.fused },
  ...extra,
  { key: "true", label: "true", color: C.true },
];
const XYZ_SERIES = (yLabel: string): SeriesSpec[] => [
  { key: "x", label: `${yLabel}x`, color: C.x },
  { key: "y", label: `${yLabel}y`, color: C.y },
  { key: "z", label: `${yLabel}z`, color: C.z },
];

const PLOT_SPECS: PlotSpec[] = [
  { id: "gyro", tab: "angular", series: XYZ_SERIES("ω"), yLabel: "gyro (rad/s)" },
  {
    id: "roll",
    tab: "angular",
    series: ANGLE_SERIES([
      { key: "gyro", label: "gyro-only", color: C.gyro },
      { key: "accel", label: "accel-only", color: C.accel },
    ]),
    yLabel: "roll (deg)",
  },
  {
    id: "pitch",
    tab: "angular",
    series: ANGLE_SERIES([
      { key: "gyro", label: "gyro-only", color: C.gyro },
      { key: "accel", label: "accel-only", color: C.accel },
    ]),
    yLabel: "pitch (deg)",
  },
  {
    id: "yaw",
    tab: "angular",
    series: ANGLE_SERIES([{ key: "gyro", label: "gyro-only", color: C.gyro }]),
    yLabel: "yaw (deg)",
  },
  { id: "accel", tab: "acceleration", series: XYZ_SERIES("a"), yLabel: "m/s²" },
  {
    id: "accelVel",
    tab: "acceleration",
    series: [
      { key: "x", label: "X vel", color: C.x },
      { key: "y", label: "Y vel", color: C.y },
      { key: "z", label: "Z vel", color: C.z },
    ],
    yLabel: "m/s",
  },
  {
    id: "accelPos",
    tab: "acceleration",
    series: [
      { key: "x", label: "X pos", color: C.x },
      { key: "y", label: "Y pos", color: C.y },
      { key: "z", label: "Z pos", color: C.z },
    ],
    yLabel: "movement (m)",
  },
  { id: "mag", tab: "heading", series: XYZ_SERIES("m"), yLabel: "magnetometer (µT)" },
  {
    id: "heading",
    tab: "heading",
    series: ANGLE_SERIES([{ key: "mag", label: "mag-only", color: C.mag }]),
    yLabel: "heading (deg)",
  },
  {
    id: "innov",
    tab: "internals",
    series: [
      { key: "accel", label: "accel residual", color: C.accel },
      { key: "mag", label: "mag residual", color: C.mag },
    ],
    yLabel: "|innovation|",
  },
  {
    id: "cov",
    tab: "internals",
    series: [{ key: "trace", label: "trace(P)", color: C.fused }],
    yLabel: "attitude covariance",
  },
];

/** Both templates' `params` blocks together are the single source of truth
 * for the trust panel's defaults — no separately hand-typed numbers here. */
function defaultTrustValues(): TrustValues {
  const ekf = extractParams(DEFAULT_EKF_SOURCE) ?? {};
  const comp = extractParams(DEFAULT_COMP_SOURCE) ?? {};
  return {
    qScale: (ekf.qScale as number | undefined) ?? 1e-4,
    rAccel: (ekf.rAccel as [number, number, number] | undefined) ?? [0.0025, 0.0025, 0.0025],
    rMag: (ekf.rMag as [number, number, number] | undefined) ?? [4, 4, 4],
    alpha: (comp.alpha as number | undefined) ?? 0.98,
    useMagYaw: (comp.useMagYaw as boolean | undefined) ?? true,
  };
}

interface PersistedState {
  mode: MotionMode;
  timescale: number;
  noise: NoiseConfig;
  trust: TrustValues;
  activeFilter: "ekf" | "comp";
  linkEnabled: boolean;
  codeSource: string;
}

const STORAGE_KEY = "imu-demo-dev-state";

function loadPersisted(): PersistedState | null {
  if (!import.meta.env.DEV) return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedState) : null;
  } catch {
    return null;
  }
}

function savePersisted(state: PersistedState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage unavailable (private mode, quota, etc.) — dev-only convenience, safe to skip
  }
}

export function App() {
  const restored = useMemo(() => loadPersisted(), []);

  const [mode, setMode] = useState<MotionMode>(restored?.mode ?? "idle");
  const [timescale, setTimescale] = useState(restored?.timescale ?? 1);
  const [noise, setNoise] = useState<NoiseConfig>(
    restored?.noise ?? { ...DEFAULT_NOISE, gyroStd: [...DEFAULT_NOISE.gyroStd] as [number, number, number] },
  );
  const [trust, setTrust] = useState<TrustValues>(restored?.trust ?? defaultTrustValues());
  const [linkEnabled, setLinkEnabled] = useState(restored?.linkEnabled ?? true);
  const [activeTab, setActiveTab] = useState<TabId>("angular");
  const [activePanel, setActivePanel] = useState<PanelId>("motion");
  const [activeFilter, setActiveFilter] = useState<"ekf" | "comp">(restored?.activeFilter ?? "ekf");
  const [bannerText, setBannerText] = useState("Using simulated sensors (desktop fallback).");
  const [usingReal, setUsingReal] = useState(false);
  const [enableBtnDisabled, setEnableBtnDisabled] = useState(false);
  const [restoreDev, setRestoreDev] = useState(true);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageHostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<PhoneStage | null>(null);
  const cubeCanvasRefs = useRef<Partial<Record<CubeKey, HTMLCanvasElement>>>({});
  const cubeCtxRefs = useRef<Partial<Record<CubeKey, CanvasRenderingContext2D>>>({});
  const qrHostRef = useRef<HTMLDivElement>(null);
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CodeEditor | null>(null);
  const driftSpanRef = useRef<HTMLSpanElement>(null);
  const polarPlotRef = useRef<PolarPlotHandle | null>(null);

  const plotRefs = useRef<Partial<Record<PlotId, TimeSeriesPlotHandle>>>({});
  function plotRef(id: PlotId) {
    return (h: TimeSeriesPlotHandle | null) => {
      if (h) plotRefs.current[id] = h;
    };
  }

  const feedRef = useRef(new PlotFeed());

  // Mirrors the latest reactive state into a ref so the dispose/HMR cleanup
  // (a closure captured on first render) can read current values without
  // needing every setter to also write into a ref by hand.
  const stateRef = useRef({ mode, timescale, noise, trust, activeFilter, linkEnabled });
  useEffect(() => {
    stateRef.current = { mode, timescale, noise, trust, activeFilter, linkEnabled };
  });
  const restoreDevRef = useRef(restoreDev);
  useEffect(() => {
    restoreDevRef.current = restoreDev;
  });

  const controllerRef = useRef<ImuController | null>(null);
  function getController(): ImuController {
    if (!controllerRef.current) {
      controllerRef.current = new ImuController(handleSample, handleRenderFrame);
    }
    return controllerRef.current;
  }

  function handleSample(sample: ImuSample): void {
    const c = getController();
    const t = c.simTime;
    const { plots, polarYaw } = feedRef.current.computeFrame(c, sample, t);
    for (const [id, values] of Object.entries(plots)) plotRefs.current[id as PlotId]?.push(t, values);
    polarPlotRef.current?.push(t, polarYaw);
  }

  function handleRenderFrame(): void {
    const c = getController();
    for (const info of CUBE_INFO) {
      const ctx = cubeCtxRefs.current[info.key];
      if (!ctx) continue;
      ctx.clearRect(0, 0, CUBE_CANVAS_W, CUBE_CANVAS_H);
      drawCube(ctx, CUBE_QUATERNION[info.key](c), CUBE_CANVAS_W / 2, CUBE_CANVAS_H / 2, 60);
    }

    stageRef.current?.setPose(
      c.usingReal ? c.qFused : (c.trueOrientation ?? new THREE.Quaternion()),
      c.truePosition ?? [0, 0, 0],
    );
    stageRef.current?.render();

    if (driftSpanRef.current) {
      driftSpanRef.current.textContent = c.usingReal
        ? `${c.driftDeg.toFixed(1)}° vs fused`
        : `${c.driftDeg.toFixed(1)}° vs true`;
    }

    syncErrorDisplay();

    for (const h of Object.values(plotRefs.current)) h?.render();
    polarPlotRef.current?.render();
  }

  function refreshFusion(source: string): void {
    const c = getController();
    const r = c.fused.setSource(source);
    if (r.ok) appliedSourceRef.current = source;
    compileErrorRef.current = r.ok ? null : (r.error ?? "Unknown error");
    syncErrorDisplay();
    // Reads via stateRef, not the closed-over `linkEnabled`: this is called
    // from the code editor's onChange, registered once in a mount-only
    // effect, so a captured `linkEnabled` would be frozen at its first-render
    // value forever.
    if (r.ok && !stateRef.current.linkEnabled) {
      const p = extractParams(source);
      if (p) setTrust((prev) => ({ ...prev, ...p }));
    }
  }

  /** The editor shows whichever error is more relevant right now: a compile
   * error from the last Apply takes priority (it explains why Apply didn't
   * take effect); otherwise a runtime error from the currently-running
   * filter throwing mid-step. Diffed against what's currently displayed so
   * this can be called every render frame without hammering the DOM. */
  const compileErrorRef = useRef<string | null>(null);
  const shownErrorRef = useRef<string | null>(null);
  /** Source text as of the last successful Apply — lets `applyTrust` tell a
   * clean buffer from unapplied edits (see below). */
  const appliedSourceRef = useRef<string | null>(null);
  function syncErrorDisplay(): void {
    const msg = compileErrorRef.current ?? getController().fused.runtimeError;
    if (msg !== shownErrorRef.current) {
      shownErrorRef.current = msg;
      editorRef.current?.showError(msg);
    }
  }

  function applyTrust(partial: Partial<FusionParams>): void {
    setTrust((prev) => {
      const merged = { ...prev, ...partial };
      if (linkEnabled && editorRef.current) {
        // Only auto-apply the slider-driven rewrite if the buffer had no
        // unapplied edits of its own — otherwise a slider nudge would
        // silently apply whatever unfinished code happens to be sitting in
        // the editor, defeating the explicit Apply button.
        const wasClean = editorRef.current.getValue() === appliedSourceRef.current;
        const src = injectParams(editorRef.current.getValue(), merged);
        editorRef.current.setValue(src);
        if (wasClean) refreshFusion(src);
      }
      return merged;
    });
  }

  function selectFilter(id: "ekf" | "comp"): void {
    const src = injectParams(id === "ekf" ? DEFAULT_EKF_SOURCE : DEFAULT_COMP_SOURCE, trust);
    editorRef.current?.setValue(src);
    refreshFusion(src);
    setActiveFilter(id);
  }

  function handleReset(): void {
    const c = getController();
    c.reset();
    feedRef.current.reset();
    for (const h of Object.values(plotRefs.current)) h?.reset();
    polarPlotRef.current?.reset();
  }

  async function handleEnableSensors(): Promise<void> {
    setEnableBtnDisabled(true);
    if (RealDeviceIMU.needsPermission()) {
      const granted = await RealDeviceIMU.requestPermission();
      if (!granted) {
        setBannerText("Motion permission denied — staying on simulated sensors.");
        setEnableBtnDisabled(false);
        return;
      }
    }
    getController().switchToReal((extra) => setBannerText((prev) => `${prev} — ${extra}`));
    setUsingReal(true);
    setBannerText("Using this device's real sensors.");
  }

  // --- one-time mount: stage, cubes, QR, math section, sim loop ----------
  useEffect(() => {
    const c = getController();
    const container = containerRef.current!;

    const stage = createPhoneStage({ height: 340 });
    stageRef.current = stage;
    stageHostRef.current!.appendChild(stage.el);
    stage.onSpin((dx, dy) => c.dragTorque(dx, dy));
    stage.onTranslate((f) => c.dragForce(f));

    for (const info of CUBE_INFO) {
      const canvas = cubeCanvasRefs.current[info.key];
      if (canvas) cubeCtxRefs.current[info.key] = setupCanvas(canvas, CUBE_CANVAS_W, CUBE_CANVAS_H);
    }

    qrHostRef.current?.appendChild(buildQrAffordance());

    c.mount(container);
    (window as unknown as { __imuDebug?: unknown }).__imuDebug = c;

    return () => {
      c.dispose();
      stage.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- editable fusion code editor (mount once) ---------------------------
  useEffect(() => {
    if (!editorHostRef.current) return;
    const initialSource =
      restored?.codeSource ??
      injectParams(restored?.activeFilter === "comp" ? DEFAULT_COMP_SOURCE : DEFAULT_EKF_SOURCE, stateRef.current.trust);
    const editor = createCodeEditor({ value: initialSource });
    editorRef.current = editor;
    editorHostRef.current.appendChild(editor.el);
    // The controller's filter was already constructed from equivalent
    // params (see defaultTrustValues), so only a *restored* source needs an
    // explicit re-apply — either way, the buffer starts in sync.
    appliedSourceRef.current = initialSource;
    if (restored?.codeSource) refreshFusion(restored.codeSource);

    return () => {
      if (restoreDevRef.current) {
        savePersisted({ ...stateRef.current, codeSource: editor.getValue() });
      }
      editor.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- push reactive control state into the controller --------------------
  useEffect(() => {
    getController().setMode(mode);
  }, [mode]);
  useEffect(() => {
    getController().setTimescale(timescale);
  }, [timescale]);
  useEffect(() => {
    getController().setNoise(noise);
  }, [noise]);

  return (
    <div ref={containerRef}>
      <div class="imu-banner">
        <span>{bannerText}</span>
        {RealDeviceIMU.isSupported() && !usingReal && (
          <button type="button" class="imu-enable" disabled={enableBtnDisabled} onClick={handleEnableSensors}>
            Enable motion sensors
          </button>
        )}
      </div>

      <div ref={qrHostRef} />

      <div ref={stageHostRef} />

      {!usingReal && (
        <p class="imu-note">
          Drag the phone to spin it (physics engine), shift+drag to move it, right-drag to orbit the camera, scroll
          to zoom. Idle / walk /
          shake below drive the sensors.
        </p>
      )}

      <div class="imu-cubes imu-cubes-4">
        {CUBE_INFO.map((info) => (
          <div class="imu-cube" key={info.key}>
            <canvas
              ref={(el) => {
                if (el) cubeCanvasRefs.current[info.key] = el;
              }}
            />
            <div class="imu-cube-label" style={{ color: info.color }}>
              {info.label}
            </div>
          </div>
        ))}
      </div>

      <div class="control-panel">
        <Tabs
          specs={PANEL_SPECS.filter((s) => s.id === "ekf" || !usingReal)}
          active={usingReal ? "ekf" : activePanel}
          onChange={(id) => setActivePanel(id as PanelId)}
        />

        {!usingReal && activePanel === "motion" && (
          <div class="imu-panel-body">
            <div class="imu-modes">
              {(["idle", "walk"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  class={`imu-mode${mode === m ? " active" : ""}`}
                  onClick={() => setMode(m)}
                >
                  {m === "idle" ? "Idle" : "Walk (accel lies about tilt)"}
                </button>
              ))}
              <button type="button" onClick={() => getController().shake()}>
                Shake
              </button>
            </div>
            <button type="button" onClick={handleReset}>
              Reset orientation
            </button>
            <Slider
              label="Sim time scale"
              min={TIMESCALE_MIN}
              max={TIMESCALE_MAX}
              step={TIMESCALE_STEP}
              value={timescale}
              format={(v) => `${v.toFixed(1)}×`}
              onChange={setTimescale}
            />
          </div>
        )}

        {!usingReal && activePanel === "noise" && (
          <div class="imu-panel-body">
            <NoisePanel noise={noise} onChange={setNoise} />
          </div>
        )}

        {(usingReal || activePanel === "ekf") && (
          <div class="imu-panel-body">
            <TrustPanel trust={trust} onChange={applyTrust} />
            <Checkbox label="Link sliders → code params" checked={linkEnabled} onChange={setLinkEnabled} />
            <div class="ctrl ctrl-readout">
              <span>Gyro-only yaw error</span>
              <span class="ctrl-value" ref={driftSpanRef} />
            </div>
          </div>
        )}
      </div>

      <h3>
        Plots (drag to pan, ctrl/cmd+scroll to zoom, double-click to reset, click a legend entry to show/hide it)
      </h3>
      <Tabs
        specs={[
          { id: "angular", label: "Angular (gyro + fused angles)" },
          { id: "acceleration", label: "Acceleration (raw + integrated velocity)" },
          { id: "heading", label: "Heading (mag + fused yaw)" },
          { id: "internals", label: "Filter internals" },
        ]}
        active={activeTab}
        onChange={(id) => setActiveTab(id as TabId)}
      />

      <div class="plot-grid" hidden={activeTab !== "angular"}>
        {PLOT_SPECS.filter((s) => s.tab === "angular").map((s) => (
          <ImuPlot key={s.id} ref={plotRef(s.id)} series={s.series} yLabel={s.yLabel} height={210} />
        ))}
      </div>

      <div class="plot-grid" hidden={activeTab !== "acceleration"}>
        {PLOT_SPECS.filter((s) => s.tab === "acceleration").map((s) => (
          <ImuPlot key={s.id} ref={plotRef(s.id)} series={s.series} yLabel={s.yLabel} height={210} />
        ))}
        <p class="imu-note">
          Velocity and position by integrating the accelerometer
          (gravity-compensated, fused orientation used to rotate it into the
          world frame). The phone here only rotates in place — see the sim's
          physics — so true velocity and position are always 0; any drift away
          from 0 is the classic accelerometer problem: noise and bias
          integrate into an unbounded random walk with nothing to correct it,
          made worse by the second integration into position, which is why
          real systems fuse in GPS, wheel odometry, vision, or zero-velocity
          updates rather than trusting this.
        </p>
      </div>

      <div class="plot-grid" hidden={activeTab !== "heading"}>
        {PLOT_SPECS.filter((s) => s.tab === "heading").map((s) => (
          <ImuPlot key={s.id} ref={plotRef(s.id)} series={s.series} yLabel={s.yLabel} height={210} />
        ))}
        <div class="polar-plot-host">
          <PolarPlot
            ref={polarPlotRef}
            series={[
              { key: "fused", label: FUSED_LABEL, color: C.fused },
              { key: "true", label: "true", color: C.true },
            ]}
            windowSeconds={8}
            size={220}
          />
          <p class="imu-note">Drag to pan · ctrl/cmd+scroll to zoom · double-click or “reset zoom” to reset</p>
        </div>
        <p class="imu-note">
          The magnetometer looks far noisier than the gyro because Earth's field
          is only ~50&nbsp;µT while the default per-axis σ is 2&nbsp;µT — roughly
          4% per axis, which maps to several degrees of heading jitter. Real
          compasses are worse (nearby metal, hard/soft-iron distortion). Nothing
          stabilizes the raw reading, which is exactly why heading is fused with
          the gyro rather than trusted on its own.
        </p>
      </div>

      <div class="plot-grid" hidden={activeTab !== "internals"}>
        {PLOT_SPECS.filter((s) => s.tab === "internals").map((s) => (
          <ImuPlot key={s.id} ref={plotRef(s.id)} series={s.series} yLabel={s.yLabel} height={210} />
        ))}
      </div>

      <MathExplainer onTrust={applyTrust} />

      <h3>Editable fusion code</h3>
      <div class="imu-modes">
        <button type="button" class={activeFilter === "ekf" ? "active" : ""} onClick={() => selectFilter("ekf")}>
          EKF (extended Kalman)
        </button>
        <button type="button" class={activeFilter === "comp" ? "active" : ""} onClick={() => selectFilter("comp")}>
          Complementary (simple)
        </button>
      </div>
      <div ref={editorHostRef} />
      <div class="imu-modes">
        <button
          type="button"
          onClick={() => {
            if (editorRef.current) refreshFusion(editorRef.current.getValue());
          }}
        >
          Apply
        </button>
        <button type="button" onClick={() => selectFilter("ekf")}>
          Reset code
        </button>
      </div>

      {import.meta.env.DEV && (
        <Checkbox label="Dev: restore tuning across reload (sessionStorage)" checked={restoreDev} onChange={setRestoreDev} />
      )}
    </div>
  );
}
