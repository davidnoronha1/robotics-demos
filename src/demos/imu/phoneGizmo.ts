import * as THREE from "three";

/**
 * Live orientation gizmo: a small 3D compass showing where the phone's body
 * axes (X/Y/Z) currently point, projected through the same camera basis used
 * for the main view. Redrawn every frame from the phone's live quaternion and
 * the orbit camera's yaw/pitch, so it actually tracks orientation instead of
 * sitting there as a fixed picture.
 */
export interface PhoneGizmo {
  el: HTMLElement;
  update(quaternion: THREE.Quaternion, camYaw: number, camPitch: number): void;
}

export function createPhoneGizmo(): PhoneGizmo {
  const el = document.createElement("div");
  el.className = "stage-axes";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 100");
  svg.setAttribute("class", "stage-axes-gizmo");

  const origin = { x: 60, y: 50 };
  const radius = 32;

  const axes = [
    { axis: "X", color: "#e8584c", local: new THREE.Vector3(1, 0, 0) },
    { axis: "Y", color: "#5ab55a", local: new THREE.Vector3(0, 1, 0) },
    { axis: "Z", color: "#4a7fe0", local: new THREE.Vector3(0, 0, 1) },
  ];

  const parts = axes.map((a) => {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("stroke", a.color);
    line.setAttribute("stroke-linecap", "round");
    svg.appendChild(line);

    const head = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    head.setAttribute("fill", a.color);
    svg.appendChild(head);

    const letter = document.createElementNS("http://www.w3.org/2000/svg", "text");
    letter.setAttribute("fill", "#e6e9f0");
    letter.setAttribute("text-anchor", "middle");
    letter.setAttribute("dominant-baseline", "central");
    letter.setAttribute("font-family", "monospace");
    letter.setAttribute("font-size", "11");
    letter.setAttribute("font-weight", "700");
    letter.textContent = a.axis;
    svg.appendChild(letter);

    return { ...a, line, head, letter };
  });

  const centerDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  centerDot.setAttribute("cx", `${origin.x}`);
  centerDot.setAttribute("cy", `${origin.y}`);
  centerDot.setAttribute("r", "2");
  centerDot.setAttribute("fill", "#7d8394");
  svg.appendChild(centerDot);

  el.appendChild(svg);

  // Static legend mapping each axis to the rotation it drives — this never
  // changes, so it lives outside the redrawn SVG.
  const caption = document.createElement("div");
  caption.className = "stage-axes-caption";
  for (const { axis, color, rot } of [
    { axis: "X", color: "#e8584c", rot: "roll" },
    { axis: "Y", color: "#5ab55a", rot: "pitch" },
    { axis: "Z", color: "#4a7fe0", rot: "yaw" },
  ]) {
    const item = document.createElement("span");
    item.style.color = color;
    item.textContent = `${axis}=${rot}`;
    caption.appendChild(item);
  }
  el.appendChild(caption);

  const tmp = {
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
    view: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    worldAxis: new THREE.Vector3(),
  };

  function update(quaternion: THREE.Quaternion, camYaw: number, camPitch: number): void {
    const { right, up, view, forward, worldAxis } = tmp;
    view.set(Math.cos(camPitch) * Math.sin(camYaw), Math.sin(camPitch), Math.cos(camPitch) * Math.cos(camYaw));
    forward.copy(view).negate();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    up.crossVectors(right, forward).normalize();

    // Draw back-to-front so nearer axes render on top.
    const withDepth = parts.map((p) => {
      worldAxis.copy(p.local).applyQuaternion(quaternion);
      const sx = worldAxis.dot(right);
      const sy = worldAxis.dot(up);
      const depth = worldAxis.dot(view);
      return { p, sx, sy, depth };
    });
    withDepth.sort((a, b) => a.depth - b.depth);

    for (const { p, sx, sy, depth } of withDepth) {
      const tipX = origin.x + sx * radius;
      const tipY = origin.y - sy * radius;
      const opacity = 0.45 + 0.55 * ((depth + 1) / 2);
      const width = 1.6 + 1.6 * ((depth + 1) / 2);

      p.line.setAttribute("x1", `${origin.x}`);
      p.line.setAttribute("y1", `${origin.y}`);
      p.line.setAttribute("x2", `${tipX}`);
      p.line.setAttribute("y2", `${tipY}`);
      p.line.setAttribute("stroke-width", `${width}`);
      p.line.setAttribute("opacity", `${opacity}`);
      svg.appendChild(p.line);

      const dx = tipX - origin.x;
      const dy = tipY - origin.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const headLen = 7;
      const bx = tipX - ux * headLen;
      const by = tipY - uy * headLen;
      const px = -uy * 4;
      const py = ux * 4;
      p.head.setAttribute("points", `${tipX},${tipY} ${bx + px},${by + py} ${bx - px},${by - py}`);
      p.head.setAttribute("opacity", `${opacity}`);
      svg.appendChild(p.head);

      p.letter.setAttribute("x", `${tipX + ux * 9}`);
      p.letter.setAttribute("y", `${tipY + uy * 9}`);
      p.letter.setAttribute("opacity", `${opacity}`);
      svg.appendChild(p.letter);
    }
  }

  return { el, update };
}
