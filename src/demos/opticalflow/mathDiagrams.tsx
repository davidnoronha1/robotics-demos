import type { ComponentChildren } from "preact";
import { RADIUS, RING } from "./fastGeometries";

/** Small static pixel-grid illustrations for the math explainer — the same
 * idea as the live FAST inset, but fixed synthetic patches next to the
 * formula they illustrate, so the text never has to gesture at "the image
 * above" for a reader scrolling past. */

const CELL = 11;
const BIG_CELL = 18;
const RING_BRIGHT = "#5fb87a";
const RING_DARK = "#e0605c";
const CENTER_STROKE = "#f2c14e";

function grid(n: number, cell: number): { size: number; half: number } {
  return { size: n * cell, half: Math.floor(n / 2) };
}

/** A single square of gray pixels, `value(dx,dy)` in [0,255], dx/dy in ±half. */
function Patch({
  half,
  cell = CELL,
  value,
  children,
}: {
  half: number;
  cell?: number;
  value: (dx: number, dy: number) => number;
  children?: ComponentChildren;
}) {
  const n = half * 2 + 1;
  const size = n * cell;
  const cells = [];
  for (let dy = -half; dy <= half; dy++) {
    for (let dx = -half; dx <= half; dx++) {
      const v = Math.round(value(dx, dy));
      cells.push(
        <rect
          key={`${dx},${dy}`}
          x={(dx + half) * cell}
          y={(dy + half) * cell}
          width={cell}
          height={cell}
          fill={`rgb(${v},${v},${v})`}
          stroke="rgba(0,0,0,0.25)"
          stroke-width={0.5}
        />,
      );
    }
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} class="of-diagram-svg">
      {cells}
      <g transform={`translate(${half * cell},${half * cell})`}>{children}</g>
    </svg>
  );
}

/** Row of small labeled diagrams. */
function Row({ items }: { items: Array<{ label: string; el: ComponentChildren }> }) {
  return (
    <div class="of-diagram-row">
      {items.map((it) => (
        <figure key={it.label} class="of-diagram">
          {it.el}
          <figcaption>{it.label}</figcaption>
        </figure>
      ))}
    </div>
  );
}

const flat = (): number => 160;
const edge = (dx: number): number => (dx >= 1 ? 210 : 100);
const corner = (dx: number, dy: number): number => (dx >= 0 && dy <= 0 ? 215 : 95);

/** Flat / edge / corner patches — what the second-moment matrix "sees". */
export function FlatEdgeCornerDiagram() {
  const { half } = grid(5, CELL);
  return (
    <Row
      items={[
        { label: "flat — no info", el: <Patch half={half} value={flat} /> },
        { label: "edge — one direction", el: <Patch half={half} value={(dx) => edge(dx)} /> },
        { label: "corner — both directions", el: <Patch half={half} value={corner} /> },
      ]}
    />
  );
}

const ringSplit = (dx: number, dy: number): number => (dx === 0 && dy === 0 ? 150 : dy <= 0 ? 225 : 60);

/** The FAST ring on a synthetic patch: exactly 9 contiguous ring pixels read
 * "brighter than center + t" (the rest read darker), the boundary case that
 * makes it a corner. */
export function FastRingDiagram() {
  const half = RADIUS + 1;
  const t = 30;
  return (
    <Patch half={half} value={ringSplit}>
      {RING.map(([dx, dy]) => {
        const v = ringSplit(dx, dy);
        const center = ringSplit(0, 0);
        const cls = v > center + t ? RING_BRIGHT : v < center - t ? RING_DARK : "transparent";
        return (
          <circle key={`${dx},${dy}`} cx={dx * CELL} cy={dy * CELL} r={CELL * 0.32} fill={cls} stroke="#000a" stroke-width={0.5} />
        );
      })}
      <rect x={-CELL / 2} y={-CELL / 2} width={CELL} height={CELL} fill="none" stroke={CENTER_STROKE} stroke-width={1.5} />
    </Patch>
  );
}

/** Same patch as the ring diagram: brighter mass sits above the center, so
 * the intensity centroid — and the orientation arrow — points up. */
export function OrientationDiagram() {
  const half = RADIUS + 1;
  const cell = BIG_CELL;
  return (
    <Patch half={half} cell={cell} value={ringSplit}>
      <line x1={0} y1={0} x2={0} y2={-half * cell * 0.75} stroke={CENTER_STROKE} stroke-width={2.5} />
      <path
        d={`M ${-6},${-half * cell * 0.75 + 10} L 0,${-half * cell * 0.75} L 6,${-half * cell * 0.75 + 10} Z`}
        fill={CENTER_STROKE}
      />
      <circle cx={0} cy={0} r={3} fill={CENTER_STROKE} />
    </Patch>
  );
}

// A small textured patch (fixed values, not derived) so BRIEF's point pairs
// have something non-uniform to compare.
const BRIEF_VALUES = [
  [80, 90, 190, 200, 70, 60, 210],
  [85, 200, 195, 90, 75, 220, 65],
  [190, 205, 100, 95, 210, 70, 60],
  [90, 95, 150, 200, 90, 65, 215],
  [200, 85, 90, 95, 190, 205, 70],
  [70, 210, 200, 80, 95, 90, 195],
  [65, 75, 60, 205, 200, 90, 85],
];
const BRIEF_PAIRS: Array<readonly [number, number, number, number]> = [
  [-3, -2, 2, -3],
  [-2, 1, 3, 0],
  [0, -1, -3, 2],
  [1, 3, -1, -3],
  [2, 2, -2, -2],
];

/** BRIEF: a handful of the 256 point-pairs, each compared for brighter/darker
 * — filled dot = brighter of the pair, hollow = darker. */
export function BriefPairsDiagram() {
  const half = 3;
  const cell = BIG_CELL;
  const value = (dx: number, dy: number): number => BRIEF_VALUES[dy + half]![dx + half]!;
  return (
    <Patch half={half} cell={cell} value={value}>
      {BRIEF_PAIRS.map(([ax, ay, bx, by], i) => {
        const va = value(ax, ay);
        const vb = value(bx, by);
        const aBrighter = va >= vb;
        return (
          <g key={i}>
            <line x1={ax * cell} y1={ay * cell} x2={bx * cell} y2={by * cell} stroke={CENTER_STROKE} stroke-width={1.25} stroke-dasharray="2,2" opacity={0.85} />
            <circle cx={ax * cell} cy={ay * cell} r={cell * 0.28} fill={aBrighter ? "#fff" : "#000"} stroke={CENTER_STROKE} stroke-width={1} />
            <circle cx={bx * cell} cy={by * cell} r={cell * 0.28} fill={aBrighter ? "#000" : "#fff"} stroke={CENTER_STROKE} stroke-width={1} />
          </g>
        );
      })}
    </Patch>
  );
}

