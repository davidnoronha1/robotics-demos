import * as THREE from "three";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { setupCanvas } from "../../shared/canvas";
import type { TimeSeriesPlotHandle } from "../../shared/TimeSeriesPlot";
import type { PolarPlotHandle } from "../../shared/PolarPlot";
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
import { buildQrAffordance } from "../../shared/qr";
import { PlotFeed, type PlotId } from "./plotFeed";
import type { TrustValues } from "./TrustPanel";
import { CUBE_INFO, type CubeKey } from "./components/ImuStageView";
import type { ImuPanelId } from "./components/ImuControls";

const CUBE_CANVAS_W = 140;
const CUBE_CANVAS_H = 180;

const CUBE_QUATERNION: Record<CubeKey, (c: ImuController) => THREE.Quaternion> = {
  gyro: (c) => c.qGyro,
  accel: (c) => c.qAccel,
  heading: (c) => c.qMag,
  fused: (c) => c.qFused,
};

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

export function useImuDemo() {
  const restored = useMemo(() => loadPersisted(), []);

  const [mode, setMode] = useState<MotionMode>(restored?.mode ?? "idle");
  const [timescale, setTimescale] = useState(restored?.timescale ?? 1);
  const [noise, setNoise] = useState<NoiseConfig>(
    restored?.noise ?? { ...DEFAULT_NOISE, gyroStd: [...DEFAULT_NOISE.gyroStd] as [number, number, number] },
  );
  const [trust, setTrust] = useState<TrustValues>(restored?.trust ?? defaultTrustValues());
  const [linkEnabled, setLinkEnabled] = useState(restored?.linkEnabled ?? true);
  const [activePanel, setActivePanel] = useState<ImuPanelId>("motion");
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

  const compileErrorRef = useRef<string | null>(null);
  const shownErrorRef = useRef<string | null>(null);
  const appliedSourceRef = useRef<string | null>(null);

  function syncErrorDisplay(): void {
    const msg = compileErrorRef.current ?? getController().fused.runtimeError;
    if (msg !== shownErrorRef.current) {
      shownErrorRef.current = msg;
      editorRef.current?.showError(msg);
    }
  }

  function refreshFusion(source: string): void {
    const c = getController();
    const r = c.fused.setSource(source);
    if (r.ok) appliedSourceRef.current = source;
    compileErrorRef.current = r.ok ? null : (r.error ?? "Unknown error");
    syncErrorDisplay();
    if (r.ok && !stateRef.current.linkEnabled) {
      const p = extractParams(source);
      if (p) setTrust((prev) => ({ ...prev, ...p }));
    }
  }

  function applyTrust(partial: Partial<FusionParams>): void {
    setTrust((prev) => {
      const merged = { ...prev, ...partial };
      if (linkEnabled && editorRef.current) {
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

    const url = "https://robotics.neswk.workers.dev/demos/imu/";
    qrHostRef.current?.appendChild(
      buildQrAffordance({ url, text: "Scan to try this on your phone — real sensors beat any simulation." }),
    );

    c.mount(container);
    (window as unknown as { __imuDebug?: unknown }).__imuDebug = c;

    return () => {
      c.dispose();
      stage.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!editorHostRef.current) return;
    const initialSource =
      restored?.codeSource ??
      injectParams(restored?.activeFilter === "comp" ? DEFAULT_COMP_SOURCE : DEFAULT_EKF_SOURCE, stateRef.current.trust);
    const editor = createCodeEditor({ value: initialSource });
    editorRef.current = editor;
    editorHostRef.current.appendChild(editor.el);
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

  useEffect(() => {
    getController().setMode(mode);
  }, [mode]);
  useEffect(() => {
    getController().setTimescale(timescale);
  }, [timescale]);
  useEffect(() => {
    getController().setNoise(noise);
  }, [noise]);

  return {
    containerRef,
    stageHostRef,
    qrHostRef,
    cubeCanvasRefs,
    driftSpanRef,
    editorHostRef,
    polarPlotRef,
    plotRef,

    bannerText,
    isRealSupported: RealDeviceIMU.isSupported(),
    usingReal,
    enableBtnDisabled,
    handleEnableSensors,

    activePanel,
    setActivePanel,
    mode,
    setMode,
    handleShake: () => getController().shake(),
    handleReset,
    timescale,
    setTimescale,
    noise,
    setNoise,
    trust,
    applyTrust,
    linkEnabled,
    setLinkEnabled,

    activeFilter,
    selectFilter,
    applyEditorCode: () => {
      if (editorRef.current) refreshFusion(editorRef.current.getValue());
    },
    restoreDev,
    setRestoreDev,
  };
}
