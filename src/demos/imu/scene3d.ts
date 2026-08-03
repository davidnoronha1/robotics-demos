import * as THREE from "three";
import { PHONE_HALF } from "./physics";

export interface PhoneStage {
  el: HTMLElement;
  setPose(q: THREE.Quaternion): void;
  onSpin(cb: (dxPixels: number, dyPixels: number) => void): void;
  render(): void;
  resize(): void;
  dispose(): void;
}

/**
 * three.js scene for the unified phone. The phone mesh's pose is synced from
 * the physics body (or the fused estimate on real hardware); left-drag spins
 * it, right-drag orbits the camera, wheel zooms.
 */
export function createPhoneStage(opts: { height?: number }): PhoneStage {
  const height = opts.height ?? 340;

  const wrap = document.createElement("div");
  wrap.className = "stage";

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

  canvas.addEventListener("pointerdown", (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    if (e.button === 2) {
      orbiting = true;
      lastOX = e.clientX;
      lastOY = e.clientY;
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
    setPose(q: THREE.Quaternion) {
      phone.quaternion.copy(q);
    },
    onSpin: (cb) => spinCbs.push(cb),
    render() {
      applyCamera();
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
