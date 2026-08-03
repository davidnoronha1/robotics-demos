import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { setupCanvas } from "../../shared/canvas";
import { Checkbox } from "../../shared/ui/Checkbox";
import { Slider } from "../../shared/ui/Slider";
import { Tabs } from "../../shared/Tabs";
import { PlotPanel, type PlotPanelHandle } from "../../shared/PlotPanel";
import { createPolarPlot } from "../../shared/polarPlot";
import { createCodeEditor, type CodeEditor } from "../../shared/codeEditor";
import { drawCube } from "./renderCube";
import { createPhoneStage, type PhoneStage } from "./scene3d";
import { ImuController, DEFAULT_NOISE, type MotionMode, type NoiseConfig } from "./simController";
import { RealDeviceIMU, WORLD_G, WORLD_M } from "./sensorInput";
import type { ImuSample } from "./estimators";
import {
  DEFAULT_COMP_SOURCE,
  DEFAULT_EKF_SOURCE,
  extractParams,
  injectParams,
  type FusionParams,
} from "./fusionCode";
import { bodyFrame, eulerOf, worldFrame } from "./quaternion";
import { AngleUnwrap } from "./angleUnwrap";
import { buildQrAffordance } from "./qr";
import { mountMath } from "./mathExplain";
import { NoisePanel } from "./NoisePanel";
import { TrustPanel, type TrustValues } from "./TrustPanel";

const RAD2DEG = 180 / Math.PI;

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

const CUBE_INFO: Array<{ key: CubeKey; label: string; color: string }> = [
  { key: "gyro", label: "Gyro integration only — drifts", color: C.gyro },
  { key: "accel", label: "Accelerometer only — no yaw, jitters", color: C.accel },
  { key: "fused", label: "Fused (EKF / editable, gyro+accel+mag) — stable", color: C.fused },
  { key: "heading", label: "Magnetometer heading — bounded, noisy", color: C.mag },
];

type TabId = "angular" | "acceleration" | "heading" | "internals";
const TAB_SPECS = [
  { id: "angular", label: "Angular (gyro + fused angles)" },
  { id: "acceleration", label: "Acceleration (raw + integrated velocity)" },
  { id: "heading", label: "Heading (mag + fused yaw)" },
  { id: "internals", label: "Filter internals" },
];

/** Both templates' `params` blocks together are the single source of truth
 * for the trust panel's defaults — no separately hand-typed numbers here. */
function defaultTrustValues(): TrustValues {
  const ekf = extractParams(DEFAULT_EKF_SOURCE) ?? {};
  const comp = extractParams(DEFAULT_COMP_SOURCE) ?? {};
  return {
    qGyro: (ekf.qGyro as number | undefined) ?? 1e-4,
    qAccel: (ekf.qAccel as number | undefined) ?? 0.05,
    rAccel: (ekf.rAccel as [number, number, number] | undefined) ?? [0.0025, 0.0025, 0.0025],
    rMag: (ekf.rMag as [number, number, number] | undefined) ?? [4, 4, 4],
    rPos: (ekf.rPos as [number, number, number] | undefined) ?? [0.0025, 0.0025, 0.0025],
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
  // A session persisted before the filter went 6-DOF has no qGyro/rPos in it;
  // fall back rather than feeding undefined into the number inputs.
  const [trust, setTrust] = useState<TrustValues>(
    restored?.trust?.qGyro !== undefined && restored.trust.rPos !== undefined
      ? restored.trust
      : defaultTrustValues(),
  );
  const [linkEnabled, setLinkEnabled] = useState(restored?.linkEnabled ?? true);
  const [activeTab, setActiveTab] = useState<TabId>("angular");
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
  const debounceRef = useRef(0);
  const driftSpanRef = useRef<HTMLSpanElement>(null);
  const unwrapsRef = useRef(new Map<string, AngleUnwrap>());
  const polarHostRef = useRef<HTMLDivElement>(null);
  const polarPlotRef = useRef<ReturnType<typeof createPolarPlot> | null>(null);

  const rollRef = useRef<PlotPanelHandle>(null);
  const pitchRef = useRef<PlotPanelHandle>(null);
  const yawRef = useRef<PlotPanelHandle>(null);
  const headingRef = useRef<PlotPanelHandle>(null);
  const gyroPlotRef = useRef<PlotPanelHandle>(null);
  const accelPlotRef = useRef<PlotPanelHandle>(null);
  const magPlotRef = useRef<PlotPanelHandle>(null);
  const accelVelRef = useRef<PlotPanelHandle>(null);
  const accelPosRef = useRef<PlotPanelHandle>(null);
  const posErrRef = useRef<PlotPanelHandle>(null);
  const innovRef = useRef<PlotPanelHandle>(null);
  const covRef = useRef<PlotPanelHandle>(null);
  const allPlotRefs = [
    rollRef,
    pitchRef,
    yawRef,
    headingRef,
    gyroPlotRef,
    accelPlotRef,
    magPlotRef,
    accelVelRef,
    accelPosRef,
    posErrRef,
    innovRef,
    covRef,
  ];

  // Naive double-integration of gravity-compensated acceleration, in the
  // world frame — the same strapdown propagation the EKF does, but with no
  // measurement ever correcting it. Kept alongside the filter's own p/v so
  // the two can be plotted against each other: this one's error grows without
  // bound, the filter's is pulled back by every position fix.
  const velocityRef = useRef<[number, number, number]>([0, 0, 0]);
  const positionRef = useRef<[number, number, number]>([0, 0, 0]);
  const lastAccelTRef = useRef<number | null>(null);

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
    const eG = eulerOf(c.qGyro);
    const eA = eulerOf(c.qAccel);
    const eF = eulerOf(c.qFused);
    const eM = eulerOf(c.qMag);
    const trueQ = c.trueOrientation;
    const eT = trueQ ? eulerOf(trueQ) : null;

    function unwrap(key: string, deg: number): number {
      let u = unwrapsRef.current.get(key);
      if (!u) {
        u = new AngleUnwrap();
        unwrapsRef.current.set(key, u);
      }
      return u.next(deg);
    }

    rollRef.current?.push(t, {
      fused: unwrap("rollF", eF.roll * RAD2DEG),
      gyro: unwrap("rollG", eG.roll * RAD2DEG),
      accel: unwrap("rollA", eA.roll * RAD2DEG),
      true: eT ? unwrap("rollT", eT.roll * RAD2DEG) : NaN,
    });
    pitchRef.current?.push(t, {
      fused: unwrap("pitchF", eF.pitch * RAD2DEG),
      gyro: unwrap("pitchG", eG.pitch * RAD2DEG),
      accel: unwrap("pitchA", eA.pitch * RAD2DEG),
      true: eT ? unwrap("pitchT", eT.pitch * RAD2DEG) : NaN,
    });
    yawRef.current?.push(t, {
      fused: unwrap("yawF", eF.yaw * RAD2DEG),
      gyro: unwrap("yawG", eG.yaw * RAD2DEG),
      true: eT ? unwrap("yawT", eT.yaw * RAD2DEG) : NaN,
    });
    headingRef.current?.push(t, {
      fused: unwrap("hdgF", eF.yaw * RAD2DEG),
      mag: unwrap("hdgM", eM.yaw * RAD2DEG),
      true: eT ? unwrap("hdgT", eT.yaw * RAD2DEG) : NaN,
    });

    gyroPlotRef.current?.push(t, { x: sample.gyro[0], y: sample.gyro[1], z: sample.gyro[2] });
    accelPlotRef.current?.push(t, { x: sample.accel[0], y: sample.accel[1], z: sample.accel[2] });
    if (sample.mag) magPlotRef.current?.push(t, { x: sample.mag[0], y: sample.mag[1], z: sample.mag[2] });

    // Velocity by naive integration: rotate the accel reading into the world
    // frame and subtract gravity to get linear acceleration, then integrate.
    const lastAccelT = lastAccelTRef.current;
    if (lastAccelT !== null) {
      const dt = t - lastAccelT;
      const aWorld = worldFrame(c.qFused, sample.accel);
      const v = velocityRef.current;
      const p = positionRef.current;
      velocityRef.current = [
        v[0] + (aWorld[0] - WORLD_G[0]) * dt,
        v[1] + (aWorld[1] - WORLD_G[1]) * dt,
        v[2] + (aWorld[2] - WORLD_G[2]) * dt,
      ];
      positionRef.current = [p[0] + v[0] * dt, p[1] + v[1] * dt, p[2] + v[2] * dt];
    }
    lastAccelTRef.current = t;
    accelVelRef.current?.push(t, {
      x: velocityRef.current[0],
      y: velocityRef.current[1],
      z: velocityRef.current[2],
    });
    accelPosRef.current?.push(t, {
      x: positionRef.current[0],
      y: positionRef.current[1],
      z: positionRef.current[2],
    });

    // The 6-DOF payoff: dead reckoning vs the same integration with position
    // fixes folded in, both measured against the physics engine's truth.
    const truthP = c.truePosition;
    if (truthP) {
      const fp = c.fusedPosition;
      const dr = positionRef.current;
      posErrRef.current?.push(t, {
        dead: Math.hypot(dr[0] - truthP[0], dr[1] - truthP[1], dr[2] - truthP[2]),
        ekf: Math.hypot(fp[0] - truthP[0], fp[1] - truthP[1], fp[2] - truthP[2]),
      });
    }

    const gBody = bodyFrame(c.qFused, WORLD_G);
    const resAccel = Math.hypot(sample.accel[0] - gBody[0], sample.accel[1] - gBody[1], sample.accel[2] - gBody[2]);
    let resMag = NaN;
    if (sample.mag) {
      const mBody = bodyFrame(c.qFused, WORLD_M);
      resMag = Math.hypot(sample.mag[0] - mBody[0], sample.mag[1] - mBody[1], sample.mag[2] - mBody[2]);
    }
    let resPos = NaN;
    if (sample.posFix) {
      const fp = c.fusedPosition;
      resPos = Math.hypot(
        sample.posFix[0] - fp[0],
        sample.posFix[1] - fp[1],
        sample.posFix[2] - fp[2],
      );
    }
    innovRef.current?.push(t, { accel: resAccel, mag: resMag, pos: resPos });
    // P is the 9x9 error-state covariance: [dp, dv, dTheta]. Trace of the
    // position block (0..2) and of the attitude block (6..8).
    const P = c.fused.state.P;
    covRef.current?.push(t, {
      pos: P[0]![0]! + P[1]![1]! + P[2]![2]!,
      att: P[6]![6]! + P[7]![7]! + P[8]![8]!,
    });

    const norm360 = (deg: number) => ((deg % 360) + 360) % 360;
    polarPlotRef.current?.push(t, {
      fused: norm360(eF.yaw * RAD2DEG),
      true: eT ? norm360(eT.yaw * RAD2DEG) : NaN,
    });
  }

  function handleRenderFrame(): void {
    const c = getController();
    for (const info of CUBE_INFO) {
      const ctx = cubeCtxRefs.current[info.key];
      if (!ctx) continue;
      ctx.clearRect(0, 0, 140, 180);
      const q = info.key === "gyro" ? c.qGyro : info.key === "accel" ? c.qAccel : info.key === "heading" ? c.qMag : c.qFused;
      drawCube(ctx, q, 70, 90, 60);
    }

    const stageQ = c.usingReal ? c.qFused : (c.trueOrientation ?? new THREE.Quaternion());
    const stagePos = c.truePosition ?? [0, 0, 0];
    stageRef.current?.setPose(stageQ, stagePos);
    stageRef.current?.render();

    if (driftSpanRef.current) {
      driftSpanRef.current.textContent = c.usingReal
        ? `${c.driftDeg.toFixed(1)}° vs fused`
        : `${c.driftDeg.toFixed(1)}° vs true`;
    }

    for (const ref of allPlotRefs) ref.current?.render();
    polarPlotRef.current?.render();
  }

  function refreshFusion(source: string): void {
    const c = getController();
    const r = c.fused.setSource(source);
    editorRef.current?.showError(r.ok ? null : (r.error ?? null));
    if (r.ok && !linkEnabled) {
      const p = extractParams(source);
      if (p) setTrust((prev) => ({ ...prev, ...p }));
    }
  }

  function applyTrust(partial: Partial<FusionParams>): void {
    setTrust((prev) => {
      const merged = { ...prev, ...partial };
      if (linkEnabled && editorRef.current) {
        const src = injectParams(editorRef.current.getValue(), merged);
        editorRef.current.setValue(src);
        refreshFusion(src);
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
    unwrapsRef.current.clear();
    velocityRef.current = [0, 0, 0];
    positionRef.current = [0, 0, 0];
    lastAccelTRef.current = null;
    for (const ref of allPlotRefs) ref.current?.reset();
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
      if (canvas) cubeCtxRefs.current[info.key] = setupCanvas(canvas, 140, 180);
    }

    const polar = createPolarPlot({
      series: [
        { key: "fused", label: FUSED_LABEL, color: C.fused },
        { key: "true", label: "true", color: C.true },
      ],
      windowSeconds: 8,
      size: 220,
    });
    polarPlotRef.current = polar;
    polarHostRef.current?.appendChild(polar.el);

    const qr = buildQrAffordance();
    qrHostRef.current?.appendChild(qr);

    const mathEl = document.getElementById("imu-math");
    if (mathEl) {
      mountMath(mathEl, {
        "alpha-low": () => applyTrust({ alpha: 0.2 }),
        "alpha-high": () => applyTrust({ alpha: 0.99 }),
        "q-high": () => applyTrust({ qGyro: 0.02 }),
        "q-low": () => applyTrust({ qGyro: 1e-6 }),
        "r-accel-high": () => applyTrust({ rAccel: [0.25, 0.25, 0.25] }),
        "r-accel-low": () => applyTrust({ rAccel: [1e-4, 1e-4, 1e-4] }),
        "r-mag-high": () => applyTrust({ rMag: [200, 200, 200] }),
        "r-mag-low": () => applyTrust({ rMag: [0.1, 0.1, 0.1] }),
        "r-pos-high": () => applyTrust({ rPos: [10, 10, 10] }),
        "r-pos-low": () => applyTrust({ rPos: [1e-4, 1e-4, 1e-4] }),
      });
    }

    c.mount(container);
    (window as unknown as { __imuDebug?: unknown }).__imuDebug = c;

    return () => {
      c.dispose();
      stage.dispose();
      polar.destroy();
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
    if (restored?.codeSource) refreshFusion(restored.codeSource);

    editor.onChange((src) => {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => refreshFusion(src), 300);
    });

    return () => {
      window.clearTimeout(debounceRef.current);
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
        {!usingReal && (
          <div class="imu-section">
            <h4>Motion</h4>
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
              min={0.1}
              max={2}
              step={0.1}
              value={timescale}
              format={(v) => `${v.toFixed(1)}×`}
              onChange={setTimescale}
            />
          </div>
        )}

        {!usingReal && (
          <div class="imu-section">
            <h4>Sensor noise</h4>
            <NoisePanel noise={noise} onChange={setNoise} />
          </div>
        )}

        <div class="imu-section">
          <h4>Trust (covariances)</h4>
          <TrustPanel trust={trust} onChange={applyTrust} />
          <Checkbox label="Link sliders → code params" checked={linkEnabled} onChange={setLinkEnabled} />
          <div class="ctrl ctrl-readout">
            <span>Gyro-only yaw error</span>
            <span class="ctrl-value" ref={driftSpanRef} />
          </div>
        </div>
      </div>

      <h3>
        Plots (drag to pan, ctrl/cmd+scroll to zoom, double-click to reset, click a legend entry to show/hide it)
      </h3>
      <Tabs specs={TAB_SPECS} active={activeTab} onChange={(id) => setActiveTab(id as TabId)} />

      <div class="plot-grid" hidden={activeTab !== "angular"}>
        <PlotPanel
          ref={gyroPlotRef}
          series={[
            { key: "x", label: "ωx", color: C.x },
            { key: "y", label: "ωy", color: C.y },
            { key: "z", label: "ωz", color: C.z },
          ]}
          yLabel="gyro (rad/s)"
          height={210}
          windowSeconds={15}
          minWindowSeconds={3}
          maxWindowSeconds={120}
        />
        <PlotPanel
          ref={rollRef}
          series={[
            { key: "fused", label: FUSED_LABEL, color: C.fused },
            { key: "gyro", label: "gyro-only", color: C.gyro },
            { key: "accel", label: "accel-only", color: C.accel },
            { key: "true", label: "true", color: C.true },
          ]}
          yLabel="roll (deg)"
          height={210}
          windowSeconds={15}
          minWindowSeconds={3}
          maxWindowSeconds={120}
        />
        <PlotPanel
          ref={pitchRef}
          series={[
            { key: "fused", label: FUSED_LABEL, color: C.fused },
            { key: "gyro", label: "gyro-only", color: C.gyro },
            { key: "accel", label: "accel-only", color: C.accel },
            { key: "true", label: "true", color: C.true },
          ]}
          yLabel="pitch (deg)"
          height={210}
          windowSeconds={15}
          minWindowSeconds={3}
          maxWindowSeconds={120}
        />
        <PlotPanel
          ref={yawRef}
          series={[
            { key: "fused", label: FUSED_LABEL, color: C.fused },
            { key: "gyro", label: "gyro-only", color: C.gyro },
            { key: "true", label: "true", color: C.true },
          ]}
          yLabel="yaw (deg)"
          height={210}
          windowSeconds={15}
          minWindowSeconds={3}
          maxWindowSeconds={120}
        />
      </div>

      <div class="plot-grid" hidden={activeTab !== "acceleration"}>
        <PlotPanel
          ref={accelPlotRef}
          series={[
            { key: "x", label: "ax", color: C.x },
            { key: "y", label: "ay", color: C.y },
            { key: "z", label: "az", color: C.z },
          ]}
          yLabel="m/s²"
          height={210}
          windowSeconds={15}
          minWindowSeconds={3}
          maxWindowSeconds={120}
        />
        <PlotPanel
          ref={accelVelRef}
          series={[
            { key: "x", label: "X vel", color: C.x },
            { key: "y", label: "Y vel", color: C.y },
            { key: "z", label: "Z vel", color: C.z },
          ]}
          yLabel="m/s"
          height={210}
          windowSeconds={15}
          minWindowSeconds={3}
          maxWindowSeconds={120}
        />
        <PlotPanel
          ref={accelPosRef}
          series={[
            { key: "x", label: "X pos", color: C.x },
            { key: "y", label: "Y pos", color: C.y },
            { key: "z", label: "Z pos", color: C.z },
          ]}
          yLabel="movement (m)"
          height={210}
          windowSeconds={15}
          minWindowSeconds={3}
          maxWindowSeconds={120}
        />
        <PlotPanel
          ref={posErrRef}
          series={[
            { key: "dead", label: "dead reckoning", color: C.accel },
            { key: "ekf", label: "EKF (with position fixes)", color: C.fused },
          ]}
          yLabel="position error (m)"
          height={210}
          windowSeconds={15}
          minWindowSeconds={3}
          maxWindowSeconds={120}
        />
        <p class="imu-note">
          Velocity and position by integrating the accelerometer
          (gravity-compensated, fused orientation used to rotate it into the
          world frame). Shift-drag the phone to actually move it. The two
          traces above are the same integration: dead reckoning has nothing
          correcting it, so accelerometer noise and bias become an unbounded
          random walk — doubly so after the second integration into position.
          The EKF runs the identical propagation but folds in a 2&nbsp;Hz noisy
          position fix (a stand-in for GPS, UWB, vision, or wheel odometry),
          and its error stays bounded at roughly the fix's own noise level.
          Raise <code>R_pos</code> and the two converge again.
        </p>
      </div>

      <div class="plot-grid" hidden={activeTab !== "heading"}>
        <PlotPanel
          ref={magPlotRef}
          series={[
            { key: "x", label: "mx", color: C.x },
            { key: "y", label: "my", color: C.y },
            { key: "z", label: "mz", color: C.z },
          ]}
          yLabel="magnetometer (µT)"
          height={210}
          windowSeconds={15}
          minWindowSeconds={3}
          maxWindowSeconds={120}
        />
        <PlotPanel
          ref={headingRef}
          series={[
            { key: "fused", label: FUSED_LABEL, color: C.fused },
            { key: "mag", label: "mag-only", color: C.mag },
            { key: "true", label: "true", color: C.true },
          ]}
          yLabel="heading (deg)"
          height={210}
          windowSeconds={15}
          minWindowSeconds={3}
          maxWindowSeconds={120}
        />
        <div class="polar-plot-host">
          <div ref={polarHostRef} />
          <p class="imu-note">
            The magnetometer looks far noisier than the gyro because Earth's field
            is only ~50&nbsp;µT while the default per-axis σ is 2&nbsp;µT — roughly
            4% per axis, which maps to several degrees of heading jitter. Real
            compasses are worse (nearby metal, hard/soft-iron distortion). Nothing
            stabilizes the raw reading, which is exactly why heading is fused with
            the gyro rather than trusted on its own.
          </p>
        </div>
      </div>

      <div class="plot-grid" hidden={activeTab !== "internals"}>
        <PlotPanel
          ref={innovRef}
          series={[
            { key: "accel", label: "accel residual", color: C.accel },
            { key: "mag", label: "mag residual", color: C.mag },
            { key: "pos", label: "position-fix residual", color: C.true },
          ]}
          yLabel="|innovation|"
          height={210}
          windowSeconds={15}
          minWindowSeconds={3}
          maxWindowSeconds={120}
        />
        <PlotPanel
          ref={covRef}
          series={[
            { key: "att", label: "trace(P) attitude", color: C.fused },
            { key: "pos", label: "trace(P) position", color: C.true },
          ]}
          yLabel="covariance"
          height={210}
          windowSeconds={15}
          minWindowSeconds={3}
          maxWindowSeconds={120}
        />
      </div>

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
      <button type="button" onClick={() => selectFilter("ekf")}>
        Reset code
      </button>

      <div ref={qrHostRef} />

      {import.meta.env.DEV && (
        <Checkbox label="Dev: restore tuning across reload (sessionStorage)" checked={restoreDev} onChange={setRestoreDev} />
      )}
    </div>
  );
}
