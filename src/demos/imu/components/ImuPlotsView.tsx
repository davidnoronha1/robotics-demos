import { useState } from "preact/hooks";
import { forwardRef } from "preact/compat";
import type { RefObject } from "preact";
import { Tabs } from "../../../shared/Tabs";
import {
  TimeSeriesPlot,
  type SeriesSpec,
  type TimeSeriesPlotHandle,
  type TimeSeriesPlotProps,
} from "../../../shared/TimeSeriesPlot";
import { PolarPlot, type PolarPlotHandle } from "../../../shared/PolarPlot";
import type { PlotId } from "../plotFeed";

type TabId = "angular" | "acceleration" | "heading" | "internals";

type ImuPlotProps = Omit<TimeSeriesPlotProps, "windowSeconds" | "minWindowSeconds" | "maxWindowSeconds">;

const ImuPlot = forwardRef<TimeSeriesPlotHandle, ImuPlotProps>(function ImuPlot(props, ref) {
  return <TimeSeriesPlot ref={ref} windowSeconds={15} minWindowSeconds={3} maxWindowSeconds={120} {...props} />;
});

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

interface ImuPlotsViewProps {
  plotRef: (id: PlotId) => (h: TimeSeriesPlotHandle | null) => void;
  polarPlotRef: RefObject<PolarPlotHandle>;
}

export function ImuPlotsView({ plotRef, polarPlotRef }: ImuPlotsViewProps) {
  const [activeTab, setActiveTab] = useState<TabId>("angular");

  return (
    <>
      <h3>
        Plots
      </h3>
      <p>drag to pan, ctrl/cmd+scroll to zoom, double-click to reset, click a legend entry to show/hide it</p>
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
    </>
  );
}
