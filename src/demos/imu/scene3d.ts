import * as THREE from "three";
import { PHONE_HALF } from "./physics";

export interface PhoneStage {
  el: HTMLElement;
  setPose(q: THREE.Quaternion, position?: THREE.Vector3 | [number, number, number]): void;
  onSpin(cb: (dxPixels: number, dyPixels: number) => void): void;
  onTranslate(cb: (worldForce: [number, number, number]) => void): void;
  render(): void;
  resize(): void;
  dispose(): void;
}

/**
 * three.js scene for the unified phone. The phone mesh's pose is synced from
 * the physics body (or the fused estimate on real hardware); left-drag spins
 * it, shift+left-drag moves it, right-drag orbits the camera, wheel zooms.
 */
export function createPhoneStage(opts: { height?: number }): PhoneStage {
  const height = opts.height ?? 340;

  const wrap = document.createElement("div");
  wrap.className = "stage";


  // Live orientation gizmo at bottom-right: a small 3D compass showing where
  // the phone's body axes (X/Y/Z) currently point, projected through the
  // same camera basis used for the main view. It's redrawn every frame from
  // the phone's live quaternion and the orbit camera's yaw/pitch, so it
  // actually tracks orientation instead of sitting there as a fixed picture.
  const axisBox = document.createElement("div");
  axisBox.className = "stage-axes";

  const gizmoSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  gizmoSvg.setAttribute("viewBox", "0 0 120 100");
  gizmoSvg.setAttribute("class", "stage-axes-gizmo");

  const gizmoOrigin = { x: 60, y: 50 };
  const gizmoRadius = 32;

  const gizmoAxes = [
    { axis: "X", color: "#e8584c", local: new THREE.Vector3(1, 0, 0) },
    { axis: "Y", color: "#5ab55a", local: new THREE.Vector3(0, 1, 0) },
    { axis: "Z", color: "#4a7fe0", local: new THREE.Vector3(0, 0, 1) },
  ];

  const gizmoParts = gizmoAxes.map((a) => {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("stroke", a.color);
    line.setAttribute("stroke-linecap", "round");
    gizmoSvg.appendChild(line);

    const head = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    head.setAttribute("fill", a.color);
    gizmoSvg.appendChild(head);

    const letter = document.createElementNS("http://www.w3.org/2000/svg", "text");
    letter.setAttribute("fill", "#e6e9f0");
    letter.setAttribute("text-anchor", "middle");
    letter.setAttribute("dominant-baseline", "central");
    letter.setAttribute("font-family", "monospace");
    letter.setAttribute("font-size", "11");
    letter.setAttribute("font-weight", "700");
    letter.textContent = a.axis;
    gizmoSvg.appendChild(letter);

    return { ...a, line, head, letter };
  });

  const gizmoCenterDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  gizmoCenterDot.setAttribute("cx", `${gizmoOrigin.x}`);
  gizmoCenterDot.setAttribute("cy", `${gizmoOrigin.y}`);
  gizmoCenterDot.setAttribute("r", "2");
  gizmoCenterDot.setAttribute("fill", "#7d8394");
  gizmoSvg.appendChild(gizmoCenterDot);

  axisBox.appendChild(gizmoSvg);

  // Static legend mapping each axis to the rotation it drives — this never
  // changes, so it lives outside the redrawn SVG.
  const gizmoCaption = document.createElement("div");
  gizmoCaption.className = "stage-axes-caption";
  for (const { axis, color, rot } of [
    { axis: "X", color: "#e8584c", rot: "roll" },
    { axis: "Y", color: "#5ab55a", rot: "pitch" },
    { axis: "Z", color: "#4a7fe0", rot: "yaw" },
  ]) {
    const item = document.createElement("span");
    item.style.color = color;
    item.textContent = `${axis}=${rot}`;
    gizmoCaption.appendChild(item);
  }
  axisBox.appendChild(gizmoCaption);

  wrap.appendChild(axisBox);

  const gizmoTmp = {
    right: new THREE.Vector3(),
    up: new THREE.Vector3(),
    view: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    worldAxis: new THREE.Vector3(),
  };

  function updateGizmo(): void {
    const { right, up, view, forward, worldAxis } = gizmoTmp;
    view.set(
      Math.cos(camPitch) * Math.sin(camYaw),
      Math.sin(camPitch),
      Math.cos(camPitch) * Math.cos(camYaw),
    );
    forward.copy(view).negate();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    up.crossVectors(right, forward).normalize();

    // Draw back-to-front so nearer axes render on top.
    const withDepth = gizmoParts.map((p) => {
      worldAxis.copy(p.local).applyQuaternion(phone.quaternion);
      const sx = worldAxis.dot(right);
      const sy = worldAxis.dot(up);
      const depth = worldAxis.dot(view);
      return { p, sx, sy, depth };
    });
    withDepth.sort((a, b) => a.depth - b.depth);

    for (const { p, sx, sy, depth } of withDepth) {
      const tipX = gizmoOrigin.x + sx * gizmoRadius;
      const tipY = gizmoOrigin.y - sy * gizmoRadius;
      const opacity = 0.45 + 0.55 * ((depth + 1) / 2);
      const width = 1.6 + 1.6 * ((depth + 1) / 2);

      p.line.setAttribute("x1", `${gizmoOrigin.x}`);
      p.line.setAttribute("y1", `${gizmoOrigin.y}`);
      p.line.setAttribute("x2", `${tipX}`);
      p.line.setAttribute("y2", `${tipY}`);
      p.line.setAttribute("stroke-width", `${width}`);
      p.line.setAttribute("opacity", `${opacity}`);
      gizmoSvg.appendChild(p.line);

      const dx = tipX - gizmoOrigin.x;
      const dy = tipY - gizmoOrigin.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const hx = 7;
      const bx = tipX - ux * hx;
      const by = tipY - uy * hx;
      const px = -uy * 4;
      const py = ux * 4;
      p.head.setAttribute("points", `${tipX},${tipY} ${bx + px},${by + py} ${bx - px},${by - py}`);
      p.head.setAttribute("opacity", `${opacity}`);
      gizmoSvg.appendChild(p.head);

      p.letter.setAttribute("x", `${tipX + ux * 9}`);
      p.letter.setAttribute("y", `${tipY + uy * 9}`);
      p.letter.setAttribute("opacity", `${opacity}`);
      gizmoSvg.appendChild(p.letter);
    }
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1117);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(2.6, 1.7, 3.2);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  wrap.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 0.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(3, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 20;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x6699cc, 0.4);
  fill.position.set(-3, -1, -2);
  scene.add(fill);

  // --- Phone model -----------------------------------------------------

  const phone = new THREE.Group();
  const [hx, hy, hz] = PHONE_HALF;

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.4, roughness: 0.55 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), bodyMat);
  body.castShadow = true;
  phone.add(body);

  const screenMat = new THREE.MeshStandardMaterial({ color: 0x1f6feb, emissive: 0x0b3a8c, emissiveIntensity: 0.25 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(hx * 1.7, hy * 1.7), screenMat);
  screen.position.z = hz + 0.001;
  phone.add(screen);

  const backMat = new THREE.MeshStandardMaterial({ color: 0x444b58, metalness: 0.6, roughness: 0.35 });
  const bump = new THREE.Mesh(new THREE.CylinderGeometry(hx * 0.16, hx * 0.16, 0.012, 16), backMat);
  bump.rotation.x = Math.PI / 2;
  bump.position.set(0, hy * 0.45, -hz - 0.007);
  phone.add(bump);

  // Body axes: X red, Y green, Z blue — makes orientation readable.
  const axes = new THREE.AxesHelper(1.1);
  phone.add(axes);

  phone.quaternion.set(0, 0, 0, 1);
  scene.add(phone);

  // --- Floor + grid ----------------------------------------------------

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.ShadowMaterial({ opacity: 0.35 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.3;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(8, 16, 0x2a3040, 0x1c2333);
  grid.position.y = -1.29;
  scene.add(grid);

  // --- Interaction -----------------------------------------------------

  let spinning = false;
  let translating = false;
  let lastX = 0;
  let lastY = 0;
  let orbiting = false;
  let lastOX = 0;
  let lastOY = 0;
  let camYaw = 0;
  let camPitch = 0.35;
  let camDist = 4.6;

  const canvas = renderer.domElement;
  const spinCbs: Array<(dx: number, dy: number) => void> = [];
  const translateCbs: Array<(worldForce: [number, number, number]) => void> = [];

  canvas.addEventListener("pointerdown", (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 2) {
      orbiting = true;
      lastOX = e.clientX;
      lastOY = e.clientY;
    } else if (e.shiftKey) {
      translating = true;
      lastX = e.clientX;
      lastY = e.clientY;
    } else {
      spinning = true;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });
  canvas.addEventListener("pointermove", (e: PointerEvent) => {
    if (orbiting) {
      camYaw -= (e.clientX - lastOX) * 0.01;
      camPitch = Math.max(-1.2, Math.min(1.2, camPitch + (e.clientY - lastOY) * 0.01));
      lastOX = e.clientX;
      lastOY = e.clientY;
    } else if (translating) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      // Move relative to the camera's current facing: dragging right/left
      // strafes along the camera's right vector, dragging up/down moves
      // straight along world up — both in the horizontal-yaw-only basis
      // `applyCamera` already uses, so it matches what the drag looks like.
      const SENSITIVITY = 18; // N per pixel of drag
      const rightX = Math.cos(camYaw);
      const rightZ = -Math.sin(camYaw);
      const fx = (dx * rightX) * SENSITIVITY;
      const fz = (dx * rightZ) * SENSITIVITY;
      const fy = -dy * SENSITIVITY;
      for (const cb of translateCbs) cb([fx, fy, fz]);
    } else if (spinning) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      for (const cb of spinCbs) cb(dx, dy);
    }
  });
  const up = (e: PointerEvent) => {
    spinning = false;
    orbiting = false;
    translating = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e: WheelEvent) => {
    e.preventDefault();
    camDist = Math.max(2, Math.min(12, camDist * (e.deltaY > 0 ? 1.1 : 1 / 1.1)));
  });

  function applyCamera(): void {
    camera.position.set(
      camDist * Math.cos(camPitch) * Math.sin(camYaw),
      camDist * Math.sin(camPitch),
      camDist * Math.cos(camPitch) * Math.cos(camYaw),
    );
    camera.lookAt(0, 0, 0);
  }

  function resize(): void {
    const w = wrap.clientWidth;
    const h = height;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(wrap);

  return {
    el: wrap,
    setPose(q: THREE.Quaternion, position) {
      phone.quaternion.copy(q);
      if (position) {
        if (Array.isArray(position)) phone.position.set(...position);
        else phone.position.copy(position);
      }
    },
    onSpin: (cb) => spinCbs.push(cb),
    onTranslate: (cb) => translateCbs.push(cb),
    render() {
      applyCamera();
      updateGizmo();
      renderer.render(scene, camera);
    },
    resize,
    dispose() {
      ro.disconnect();
      for (const child of [...scene.children]) {
        if (child instanceof THREE.Mesh || child instanceof THREE.Group) {
          child.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.geometry.dispose();
              const m = obj.material as THREE.Material;
              if (Array.isArray(m)) m.forEach((x) => x.dispose());
              else m.dispose();
            }
          });
        }
      }
      renderer.dispose();
      if (renderer.domElement.parentElement) renderer.domElement.parentElement.removeChild(renderer.domElement);
    },
  };
}
