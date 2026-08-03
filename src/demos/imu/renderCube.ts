import * as THREE from "three";

// Phone-shaped box: narrow, tall, thin — recognizable at a glance.
const HALF = { x: 0.55, y: 1.0, z: 0.08 };

const VERTICES: Array<[number, number, number]> = [
  [-HALF.x, -HALF.y, -HALF.z],
  [HALF.x, -HALF.y, -HALF.z],
  [HALF.x, HALF.y, -HALF.z],
  [-HALF.x, HALF.y, -HALF.z],
  [-HALF.x, -HALF.y, HALF.z],
  [HALF.x, -HALF.y, HALF.z],
  [HALF.x, HALF.y, HALF.z],
  [-HALF.x, HALF.y, HALF.z],
];

const EDGES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

// Marks the "top" edge of the phone (short edge at +Y) so orientation
// (not just axis) is visible, not only which way is "up".
const TOP_EDGE: [number, number] = [2, 3];

const tmp = new THREE.Vector3();

export function drawCube(
  ctx: CanvasRenderingContext2D,
  q: THREE.Quaternion,
  cx: number,
  cy: number,
  scale: number,
): void {
  const projected = VERTICES.map(([x, y, z]) => {
    tmp.set(x, y, z).applyQuaternion(q);
    // Simple orthographic projection with a mild z-based scale for depth cue.
    const depthScale = 1 + tmp.z * 0.15;
    return [cx + tmp.x * scale * depthScale, cy - tmp.y * scale * depthScale] as const;
  });

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#8b949e";
  ctx.beginPath();
  for (const [a, b] of EDGES) {
    const pa = projected[a]!;
    const pb = projected[b]!;
    ctx.moveTo(pa[0], pa[1]);
    ctx.lineTo(pb[0], pb[1]);
  }
  ctx.stroke();

  ctx.lineWidth = 3;
  ctx.strokeStyle = "#58a6ff";
  ctx.beginPath();
  const [ta, tb] = TOP_EDGE;
  const pa = projected[ta]!;
  const pb = projected[tb]!;
  ctx.moveTo(pa[0], pa[1]);
  ctx.lineTo(pb[0], pb[1]);
  ctx.stroke();
}
