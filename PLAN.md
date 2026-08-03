# Browser Robotics Demos — Build Spec

Six interactive demos, ordered roughly by build difficulty. Each section covers what it shows, the interactions, the math, the rendering approach, and the performance traps.

---

## Shared infrastructure

Build this once, reuse across all six. It's maybe 300 lines and it saves you from six different framerate bugs.

**Sim loop.** Decouple physics from rendering. Fixed timestep accumulator:

```js
const DT = 1/100;              // sim step
let acc = 0, last = performance.now();
function frame(now) {
  acc += Math.min((now - last)/1000, 0.25);  // clamp to avoid spiral of death
  last = now;
  while (acc >= DT) { step(DT); acc -= DT; }
  render(acc / DT);            // alpha for interpolation
  raf = requestAnimationFrame(frame);
}
```

Without this, your particle filter converges differently on a 120Hz iPad than a 60Hz laptop, and your EKF tuning is meaningless.

**Canvas setup.** Cap DPR at 2 — phones report 3 and you'll render 9× the pixels for no visible gain.

```js
const dpr = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = cssW * dpr; canvas.height = cssH * dpr;
ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
```

**Input.** Pointer Events only (`pointerdown`/`pointermove`/`pointerup` + `setPointerCapture`). One code path for mouse, touch, and stylus. Set `touch-action: none` on the canvas or the page scrolls under your drag.

**Visibility.** `IntersectionObserver` to cancel the rAF loop when the demo scrolls out of view, plus `visibilitychange` for tab switches. Six demos all running simultaneously will melt a phone.

**Workers.** The C-space rasterizer and the particle filter update both want a worker. Use `SharedArrayBuffer` if you can set COOP/COEP headers, otherwise transferable `ArrayBuffer` ping-pong is fine at these data sizes.

**Loading.** Each demo is an independent island, dynamically imported on intersection. Nothing loads until you scroll near it.

**Stack recommendation.** Vanilla JS + Canvas2D for five of the six. Add WebGL only where noted. Skip three.js entirely — none of these need a scene graph, and it's a large dependency for what amounts to drawing a wireframe cube. If you want component structure for the control panels, Preact (~4KB) over React. TypeScript is worth it here because you'll be juggling a lot of coordinate frames and typed arrays.

> **Update (IMU demo only):** this demo now deviates deliberately — it uses `three.js` + `cannon-es` for the unified, manipulable phone model, `uplot` for zoomable charts, `katex` for math, and `codemirror` for the editable fusion code. Every other demo still follows the lean-Canvas2D guidance above.

**Shared UI kit.** Labeled slider, checkbox layer toggle, play/pause/step/reset transport, and a small numeric readout component. Consistent across all demos so the site feels like one thing.

---

## 1. Camera model + distortion

**Difficulty: low.** Good first build — it establishes the UI kit and has no real algorithmic risk.

### What it shows

The pinhole model plus Brown–Conrady distortion, and the fact that undistortion is not simply the inverse formula.

Intrinsics: `fx, fy, cx, cy` (skew ignored). Distortion: radial `k1, k2, k3`, tangential `p1, p2`.

Forward model, normalized coords `(x, y)`, `r² = x² + y²`:

```
x_d = x(1 + k1r² + k2r⁴ + k3r⁶) + 2p1xy + p2(r² + 2x²)
y_d = y(1 + k1r² + k2r⁴ + k3r⁶) + p1(r² + 2y²) + 2p2xy
u = fx·x_d + cx,  v = fy·y_d + cy
```

### Interactions

- Sliders for every parameter, with a horizontal FOV readout derived from `fx` (`2·atan(w/2fx)`)
- Preset buttons: GoPro-ish barrel, cheap webcam, telephoto, fisheye-adjacent
- Three view modes: **ideal**, **distorted**, **undistorted**
- A second set of "assumed" distortion params for the undistortion pass — deliberately mismatch them against the true params to show what a bad calibration looks like. This is the payoff of the whole demo.
- Displacement field overlay: quiver arrows from ideal to distorted pixel position, colored by magnitude
- Toggle between a checkerboard target and a synthetic 3D scene (a grid floor + a few boxes) so it doesn't feel like a calibration screenshot

### Rendering

Two approaches, pick based on how far you want to take it:

**Vertex warping (Canvas2D).** Render the target as line segments, subdivide each segment into ~20 points, push every point through the forward model, stroke the polyline. Cheap, exact for line art, runs anywhere. This is enough for a checkerboard or grid.

**Fragment shader (WebGL).** One quad, the inverse map in GLSL. For each output pixel, compute where to sample from. Necessary if you want to warp an actual photo or webcam feed. About 20 lines of shader.

### The subtlety worth surfacing

Undistortion has no closed form. You either iterate (fixed-point, ~5 iterations converges for typical `k1`) or build a remap LUT once and sample it. Show the iteration count as a slider and let people watch it converge — most people who've only run `cv2.undistort()` have no idea this is happening.

### Extras

- Show reprojection error numerically when true and assumed params diverge
- Principal point offset visualized as a crosshair drifting off center
- A "why `k3` matters" toggle that shows the tail behavior at large radius

---

## 2. Value iteration on a gridworld

**Difficulty: low.** Fastest to build, and it's honest to what you're currently studying.

### What it shows

Dynamic programming solving an MDP. The value heatmap converging sweep by sweep, then the greedy policy crystallizing out of it.

Bellman optimality update:

```
V(s) ← max_a Σ_s' P(s'|s,a)[R(s,a,s') + γV(s')]
```

Stochastic transitions: intended direction with probability `1−slip`, perpendicular directions splitting `slip`. This is the classic Russell & Norvig 4×3 setup generalized.

### Interactions

- Click to paint: walls, goal (+1), pit (−1), and a free-value mode with a numeric entry
- Sliders: `γ`, slip probability, step cost (living reward)
- Transport: single sweep / run / reset, with a speed control
- Toggle **synchronous** vs **in-place (Gauss–Seidel)** sweeps — in-place converges noticeably faster and the sweep-order artifact is visible in the heatmap
- Toggle **value iteration** vs **policy iteration** and compare iteration counts side by side
- Display mode: `V(s)` heatmap, `Q(s,a)` as the four-triangle cell split, or policy arrows

### Rendering

Canvas2D, 20×20 max. Diverging colormap for values (blue-white-red), signed around zero. The four-triangle Q rendering is worth the effort — it's the visual that makes the max operator concrete.

### Extras that fit your reading

- Bellman residual `max_s |V_{k+1}(s) − V_k(s)|` plotted per sweep on a log axis
- Drop a Q-learning or TD(0) agent into the same grid, run it alongside, and show its value estimate converging toward the DP solution. The contrast between "model-based, instant, needs `P`" and "model-free, slow, needs experience" is the single most useful thing in early Sutton & Barto.
- Step cost sweep: animate the living reward from 0 to −2 and watch the policy flip from cautious-long-way-around to risky-shortcut. Very satisfying, and it's one line of animation.

---

## 3. IMU attitude estimation (real phone sensors) — UPGRADE

**Difficulty: low–medium.** The technical content is easy; the platform quirks are the work.

### What it shows (the upgrade)

A single **physics-driven phone** the visitor grabs and spins, with four per-sensor attitude estimates rendered underneath, realistic noisy sensors (gyro + accel + **magnetometer**), a full **editable EKF** that fuses them, zoomable full-width plots, and a detailed math explainer. The narrative upgrades from *"yaw drifts"* to *"yaw drifts until you trust the magnetometer."*

Layout top-to-bottom:

```
Banner (status + "Enable motion sensors" + QR)
────────────────────────────────────────────────
STAGE — three.js scene: one phone, physics-driven, drag to spin
────────────────────────────────────────────────
PER-SENSOR RENDERS — 4 small wireframe cubes:
  gyro-only | accel-only | fused (EKF/complementary) | mag heading
────────────────────────────────────────────────
CONTROL PANEL (grouped):
  Motion: Idle / Walk / Shake · Reset · Timescale (0.1–1×)
  Noise:  per-axis σ + bias-walk (gyro, accel, mag) + colored-noise toggle
  Trust:  Q (gyro/process), R_accel, R_mag per axis + complementary α
  Filter: select EKF (editable) or Complementary
  Drift:  readout "gyro-only yaw error vs true"
────────────────────────────────────────────────
PLOTS — tabs:
  Attitude:   roll · pitch · yaw · heading (fused vs unfused vs true)
  Sensors:    gyro xyz · accel xyz · mag xyz (noisy raw vs true)
  Internals:  innovation residuals + covariance trace
────────────────────────────────────────────────
THE MATH — KaTeX sections (see §"The math")
────────────────────────────────────────────────
EDITABLE FUSION CODE — CodeMirror, live hot-reload, Apply/Reset, error bar
```

### Dependencies

| Package | Why |
|---|---|
| `cannon-es` | Rigid-body physics — the phone's true orientation/angular velocity come from the engine, not our code |
| `three` + `@types/three` | 3D scene for the unified phone (lit box, floor, shadow, drag) |
| `uplot` | Charts — zoom/pan plugin, streaming, tiny |
| `katex` | Math rendering (`katex/dist/contrib/auto-render.mjs` auto-renders `$...$`/`$$...$$`) |
| `codemirror` + `@codemirror/lang-javascript` + `@codemirror/theme-one-dark` | Editable fusion code with highlighting |

All ship their own types except `three` (add `@types/three`).

### Physics + 3D (cannon-es + three.js)

**`physics.ts` (cannon-es).** `PhonePhysics` class: `World` (gravity, damping), phone `Body` (`BoxShape` phone proportions, mass ≈0.2 kg, restitution ≈0.3), **pinned position (`linearFactor=0`) so it only rotates** and stays on screen. Exposes `step(dt)` (fixed timestep via the existing `createSimLoop`), `applyDragTorque(dx, dy)`, `reset()`, and getters for the body's quaternion (converted to the demo's `Quat`) and angular velocity. **No physics math written by us.** Optional later: a free-fall/bounce mode toggle.

**`scene3d.ts` (three.js).** Renderer + perspective camera + hemisphere/directional lights + phone mesh (phone-proportioned box, screen face, camera bump) + `ShadowMaterial` floor + `GridHelper`. `setPose(q)` syncs the mesh to the physics body every frame. Drag = pointer-delta → `applyDragTorque` (no raycast needed — phone is centered; matches the existing "drag to spin" UX).

**`renderCube.ts` (keep).** Used for the four small per-sensor wireframe cubes.

### Sensor model — realistic noise

**`sensorInput.ts` (rewrite).** `SyntheticIMU` becomes **physics-driven**: each tick reads the true quaternion + angular velocity from the `PhonePhysics` body and derives samples:

- **gyro** = ω_body + per-axis **random-walk bias** + per-axis **colored (AR(1)) Gaussian** noise
- **accel** = gravity rotated to body frame + mode disturbance (walk bounce / shake impulses) + per-axis noise
- **mag** = earth magnetic field (with dip angle) rotated to body frame + noise + bias walk
- exposes `getTrueOrientation()` (physics body quat) and `getTrueAngularVelocity()`

Noise parameters, all user-controllable: per-axis σ for gyro/accel/mag, bias-walk rates, and a "colored noise" toggle (AR(1), `φ`). This is what makes the plots stop looking "way too clean."

`RealDeviceIMU` adds magnetometer sampling via `devicemagnetometer`/`magnetometer` where available, degrading gracefully (if no mag, the filter runs on gyro+accel alone).

### Estimators

**`estimators.ts` (rewrite).**
- Keep `GyroOnlyEstimator`, `AccelOnlyEstimator` (yaw pinned, as today).
- Add `MagHeadingEstimator` — tilt-compensated compass heading from mag + accel.
- Extend `ComplementaryEstimator` with optional mag-yaw correction (yaw stops drifting when mag is trusted).
- Add **`EKFAttitudeEstimator`** — quaternion state; predict via `q̇ = ½q⊗[0,ω]` with `P = FPFᵀ+Q`; measurements = predicted gravity + predicted earth-mag vector in body frame; standard innovation / `K = PHᵀ(HPHᵀ+R)⁻¹` / update; renormalize. Params: `Q` (gyro/process), `R_accel` (per-axis), `R_mag` (per-axis) — the "trust" values.

**`quaternion.ts` (extend).** Add `pitchOf`, tilt-compensated `headingOf(q, magBody, accelBody)`, quaternion↔rotation-matrix, and the Jacobians the default EKF source needs (4×4 `d(q̇)/dq` and the measurement Jacobians).

### Plots — uPlot, full-width, zoomable

**`plot.ts` (rewrite).** Same public API (`createTimeSeriesPlot → {el, push, render, reset}`) backed by uPlot: streaming via `setData(data, false)`, `ResizeObserver` → `setSize` for full-width (plots "take up the space they need"), wheel/drag zoom. Use the official `uPlot.zoom` plugin if its Vite import path resolves (`uplot/dist/plugins/zoom.js`); fallback ~40 lines of manual wheel-zoom/drag-pan via `u.setScale('x'/'y', {min,max})` bounded to the rolling window. Per-chart "reset zoom." `polarPlot.ts` stays for heading/yaw dials.

Charts (tabs: **Attitude** / **Sensors** / **Internals**):
- Attitude: roll, pitch, yaw, heading — fused vs gyro-only vs accel-only (vs true when simulated)
- Sensors: gyro xyz, accel xyz, mag xyz — noisy raw vs true
- Internals: innovation residuals + covariance trace (shows what `Q`/`R` are actually doing)

### Editable fusion code — live hot-reload

**`fusionCode.ts` (new).** Two editable templates (`step(state, sample, params)` for EKF and for complementary) stored as strings; `compileFusion(src)` wraps in `new Function` with a math-helper namespace injected, throws on syntax error.

**`codeEditor.ts` (new, shared).** CodeMirror 6 wrapper: `{el, getValue, setValue, onChange, onApply(cb), showError(msg)}` with JS language + one-dark theme.

**Live recompile (this is the "hot reload"):**
- Every edit triggers a debounced (~300 ms) recompile. No Apply needed — Apply becomes optional; "Reset" restores the default template.
- **Hot-swap without losing the sim:** the running estimator is replaced in place on every successful compile. Same template type (EKF→EKF, complementary→complementary): carry the existing state forward (`{quat, P}`) so editing coefficients keeps the filter continuous. Different template type: state resets; plots continue.
- **Fail-safe:** on syntax/compile error, show the error in an error bar (line/column) and **keep the last good compiled estimator running** — the sim never dies from a bad edit.
- **Param linkage (both sliders and code):** a delimited `params` literal sits at the top of the code. A "link control panel → code" checkbox (default on) rewrites that literal live when trust/noise controls change; when off, the code's literal is authoritative. Either direction flows through the same debounced recompile.
- Swapping only swaps the fused estimator function; gyro-only/accel-only/heading cubes, plots, and physics are untouched.

### The math (KaTeX)

**`mathExplain.ts` (new).** Built as HTML with `$...$`/`$$...$$`, then auto-rendered with `renderMathInElement`. Sections:

1. Coordinate frames & why quaternions (no gimbal lock)
2. Sensor models: gyro `ω = ω_true + b + n`, accel `a = R(q)·g + a_lin + n`, mag `m = R(q)·m_e + n`
3. Quaternion kinematics `q̇ = ½ q ⊗ [0,ω]`
4. Accel-only tilt (roll/pitch via `atan2`)
5. Magnetometer heading (tilt compensation)
6. Complementary filter `q = slerp(q_gyro, q_meas, 1−α)`
7. **EKF walkthrough** — predict, measurement model, Jacobians, Kalman gain, update — each equation cross-referenced to the slider/code param that controls it
8. "What Q and R do" — higher `R` ⇒ trust gyro more (smooth but drifts); higher `Q` ⇒ trust measurements more (jittery but bounded). Each paragraph gets a "set it and see" button.

### Dev workflow — Vite HMR

- **`page.ts`** adds `import.meta.hot.accept()` (typed via `vite/client` in tsconfig): editing any demo module re-mounts the demo in place instead of a full browser reload.
- **Teardown on dispose** — `mount()`'s `() => void` cleanup doubles as an `import.meta.hot.dispose` handler: stop sim loop + visibility observer + sensor source + pointer unbinds, plus `renderer.dispose()` and dispose three.js geometry/materials, destroy the cannon-es world, `u.destroy()` each uPlot, `view.destroy()` CodeMirror, remove `ResizeObserver`s. Prevents duplicate contexts/GPU leaks across partial updates.
- **State preservation across reloads** — control values (noise σ / bias-walk, Q/R trust, α, filter selection, mode, timescale) **and the CodeMirror source** persist to `sessionStorage` on dispose and restore on mount (behind a dev-only "restore state" toggle), so editing the fusion code by hand doesn't throw away your tuning.
- **`vite.config.ts`** — add `optimizeDeps.include: ["three", "cannon-es", "uplot", "katex", "codemirror", "@codemirror/lang-javascript"]` for fast first reload.

### Verification

- `npx tsc --noEmit` (strict) and `npm run build` clean.
- `npm run dev` on Linux (per TODO.md "verify it works on linux"): drag phone → cubes follow, mag kills yaw drift, zoom/pan works, CodeMirror edits apply live without restart, KaTeX renders, real-device permission path intact.

### Decisions & risks

- **three.js** (~150 KB gzipped) reverses the PLAN.md "skip three.js" note for this demo only — explicit choice for a manipulable phone.
- **uPlot zoom plugin** Vite import path is the one uncertain dependency path — manual zoom fallback is ~40 lines and pre-scoped.
- **EKF state is quaternion-only** (no bias state) to keep the editable code approachable; gyro bias manifests as a bounded heading offset / drift, which is itself a teaching point.
- **Colored (AR(1)) noise + random-walk bias** replaces white noise — this is what makes sensor plots look real.

### The API (kept from the original spec)

```js
// iOS 13+: must be called from inside a user gesture, HTTPS only
if (typeof DeviceMotionEvent.requestPermission === 'function') {
  const res = await DeviceMotionEvent.requestPermission();
  if (res !== 'granted') return showFallback();
}
window.addEventListener('devicemotion', e => {
  const { x, y, z } = e.accelerationIncludingGravity;  // m/s²
  const { alpha, beta, gamma } = e.rotationRate;       // deg/s (!)
  const dt = e.interval;                                // seconds
});
```

Traps (all still apply): `rotationRate` is **deg/s** — convert; axis conventions differ iOS/Android — sign flips live in one isolated spot; sample rate varies (30–60Hz) — use reported `interval`; iOS needs HTTPS + a user gesture; `DeviceOrientationEvent` is someone else's filter — never present it as one of our estimators.

### File map

```
src/demos/imu/
  index.ts            — rewrite: page composition + wiring
  page.ts             — + import.meta.hot.accept / dispose
  quaternion.ts       — + pitchOf, headingOf, matrices, EKF Jacobians
  physics.ts          — new: cannon-es world + phone body + drag torque
  scene3d.ts          — new: three.js scene, phone mesh, floor, shadow
  renderCube.ts       — keep (per-sensor mini cubes)
  estimators.ts       — rewrite: + MagHeading, complementary w/ mag, EKF
  fusionCode.ts       — new: editable templates + compile + param sync
  sensorInput.ts      — rewrite: physics-driven synthetic, mag, AR(1) noise
  mathExplain.ts      — new: KaTeX sections
src/shared/
  plot.ts             — rewrite: uPlot wrapper (zoom, responsive, stream)
  uiKit.ts            — + numberInput control
  codeEditor.ts       — new: CodeMirror 6 wrapper
  (canvas, simLoop, tabs, polarPlot, pointerInput, visibility — keep)
```

---

## 4. Configuration space visualizer

**Difficulty: medium.** The highest concept-per-line ratio of the six.

### What it shows

Split screen. Left: a 2-link planar arm in a workspace with draggable obstacles. Right: the θ₁/θ₂ configuration space, with the collision set rendered as a bitmap.

Drag an obstacle in the workspace and the corresponding blob in C-space morphs live. Then plan in C-space and watch the arm sweep the path in workspace. This is the demo that makes "configuration space" stop being a phrase people nod at.

### The computation

For each cell in a 256×256 θ grid, check whether the arm at that configuration collides.

Keep obstacles as **circles and capsules** so the test is a segment-to-circle distance check — branchless, no allocation, a handful of flops:

```js
function segCircleHit(ax, ay, bx, by, cx, cy, r) {
  const dx = bx-ax, dy = by-ay;
  const t = Math.max(0, Math.min(1, ((cx-ax)*dx + (cy-ay)*dy) / (dx*dx + dy*dy)));
  const px = ax + t*dx - cx, py = ay + t*dy - cy;
  return px*px + py*py < r*r;
}
```

65k cells × 2 links × N obstacles. With N=4 that's ~500k tests per full rebuild — call it 5–15ms in JS with flat typed arrays. Fast enough for drag if you debounce, and comfortable in a worker.

Optimizations if you need them: precompute link endpoints per θ₁ row (link 1's position doesn't depend on θ₂), drop to 128×128 on narrow viewports, and rebuild at low resolution during drag then refine on release.

### Rendering the C-space

`ImageData` + `putImageData`. Free space light, collision dark, and give each obstacle a distinct hue so you can see which workspace obstacle produced which C-space blob. That color correspondence is what sells the whole thing.

### Interactions

- Drag obstacles in workspace → C-space updates live
- Drag the arm (IK) or drag a cursor in C-space → the other pane's cursor follows. Bidirectional linking is essential.
- Set start and goal, then run a planner: BFS or A* on the C-space grid is simplest and always finds the optimum; RRT is more visually interesting because you watch the tree grow. Offer both.
- Animate the found path simultaneously in both panes
- Joint limit bands, and a self-collision region toggle

### The torus

C-space here is a torus — θ wraps at 2π in both axes. Show it. Either tile the C-space image 3×3 at low opacity around the main view, or add a toggle that lets paths wrap off one edge and reappear on the other. Paths that wrap are usually shorter, and that surprises people.

### The payoff to make explicit

A straight line in workspace is a curve in C-space, and a straight line in C-space is a curve in workspace. Add a "linear interpolation in workspace vs in C-space" toggle showing both trajectories — this is exactly the difference between Cartesian and joint-space motion planning, and it's a thing people ship bugs over.

---

## 5. Particle filter localization + SLAM

**Difficulty: medium–high.** Most moving parts, best payoff as a centerpiece.

### Structuring the merge

You've said you want to merge MCL with the SLAM demo. Don't run FastSLAM (a map per particle gets expensive fast). Sequence it as a narrative in three acts instead:

**Act 1 — Mapping.** Robot drives with known pose. Lidar rays raycast against user-drawn walls. Occupancy grid builds up via log-odds. The user watches the map appear.

**Act 2 — Kidnapping.** User picks the robot up and drops it anywhere. Particles reinitialize uniformly across free space.

**Act 3 — Relocalization.** Robot drives. The particle cloud collapses. In a symmetric corridor it collapses into *two* clusters and stays ambiguous until the robot reaches a distinguishing feature, at which point one cluster dies. That moment is the best thing in the demo, and it's the thing an EKF fundamentally cannot show you.

Design one of your preset maps to have deliberate symmetry so this always happens.

### The algorithms

**Occupancy grid.** Log-odds update, Bresenham along each ray marking free, endpoint marking occupied. Clamp log-odds to ±5 or so to keep the map responsive to change.

**Motion model.** Sample-based odometry model (Probabilistic Robotics 5.4): decompose into rot1, trans, rot2, add noise to each with `α₁…α₄` coefficients exposed as sliders.

**Sensor model.** Use the **likelihood field**, not beam model. Precompute a Euclidean distance transform of the occupancy grid once per map change (two-pass chamfer or Felzenszwalb — the latter is exact and still O(n)). Then scoring a ray is: transform endpoint to world, look up distance, evaluate a Gaussian. One table lookup and one exp per ray.

Budget: 3000 particles × 30 rays = 90k lookups per update at 10Hz. Comfortable in JS with typed arrays, trivial in a worker.

**Resampling.** Low-variance (systematic) resampling — single random draw, one pass, O(n), and it preserves diversity far better than naive multinomial. Add an effective-sample-size trigger (`N_eff = 1/Σw²`) so you only resample when the cloud has actually degenerated. Expose the ESS as a live plot; watching it crash and recover is genuinely informative.

### Performance

Flat `Float32Array` for particles — `[x, y, θ, w]` interleaved or four parallel arrays. **No object allocation in the hot loop**; a per-particle `{x, y}` literal will have the GC thrashing at 3000 particles × 10Hz.

Precompute `sin`/`cos` per particle once per update. Raycast with DDA on the grid rather than fine stepping.

### Layers (checkboxes, all independently toggleable)

Ground truth pose · particle cloud (arrows, opacity ∝ weight) · weighted mean estimate + covariance ellipse · lidar rays · occupancy grid · likelihood field (as a heatmap — visually striking on its own) · walls

Being able to peel it back to just the raw scans is what makes it teachable rather than just busy.

### Interactions

- Draw and erase walls at any time, including mid-run — watch the map update and the particles react
- Drag the robot to kidnap it
- Sliders: particle count, motion noise, sensor noise, ray count, max range
- **Toggle resampling off** to demonstrate particle deprivation — the cloud never concentrates. Good failure-mode teaching.
- Drive manually (WASD / on-screen joystick) or let it follow a path

---

## 6. Webcam corner detection + optical flow

**Difficulty: high.** Not conceptually — performance is the whole problem.

### What it shows

Live FAST corners and Lucas–Kanade tracks on the visitor's camera feed. Point a phone at a desk, move it, watch features stick to real objects.

### Pipeline

```
getUserMedia → <video> → drawImage into 320×240 offscreen canvas
  → getImageData → grayscale Uint8Array
  → FAST-9 + non-max suppression
  → pyramidal Lucas–Kanade against previous frame
  → draw overlay on a separate canvas above the video
```

Resolution is the main performance lever. 320×240 is the right target; 640×480 will not hold framerate in plain JS on a phone.

### Corner detector

**FAST-9** with the Bresenham-16 circle. Fast, simple, and the circle itself is a great teaching visual — add a magnified inset showing the 16-pixel ring around a hovered pixel with the brighter/darker/similar classification colored in. That inset may be the most educational element in the whole set of demos.

**Shi–Tomasi** gives better tracking quality (it selects corners that are actually well-conditioned for LK) but needs gradient computation and a 2×2 eigenvalue solve per pixel. Offer both and show that FAST finds more corners while Shi–Tomasi finds *trackable* ones.

### Tracking

Pyramidal LK, 3 levels, 15×15 window, ~5 Gauss–Newton iterations per level. Track 100–200 features. Cull on high residual, backfill with new detections when the count drops below a threshold.

Add a forward-backward check (track forward, then back, reject if it doesn't return to within a pixel) — it's cheap and it kills most bad tracks.

### Performance strategy

Start in plain JS with typed arrays and profile. Rules that matter:

- One `getImageData` per frame, never per-region
- Preallocate every buffer, reuse across frames
- Grayscale into a `Uint8Array`, not an array of objects
- No closures in inner loops

If that's not enough, in order of preference: (1) move to a Worker with `OffscreenCanvas` so the main thread stays smooth, (2) push gradient and corner-response computation into WebGL fragment shaders and read back only the candidate list, (3) compile the detector and tracker to WASM.

**Avoid OpenCV.js** — it's 8MB+ and directly violates your download constraint. `jsfeat` is ~50KB and implements exactly FAST + pyramidal LK; worth reading even if you write your own.

### Visualization

- Corners as small circles, sized by response strength
- Flow as short trails (keep the last ~8 positions per feature)
- A dominant-motion estimate from the flow field — fit a similarity transform with RANSAC, then drive a small readout: *panning left, 12 px/frame* or a toy artificial horizon
- Threshold slider so people can watch the detector go from 5 corners to 5000 and understand why the threshold matters

### Practical

- Requires HTTPS. `facingMode: 'environment'` for the rear camera on phones.
- Handle permission denial gracefully — fall back to a bundled short video clip, or a synthetic scene of moving shapes, so desktop visitors without a webcam still get the demo.
- State plainly in the UI that all processing is local and no video leaves the device. People will care.

---

## Suggested build order

1. **Value iteration** — smallest, establishes the UI kit
2. **Camera distortion** — no algorithmic risk, gets you comfortable with the rendering layer
3. **IMU** — high impact for low effort, but budget time for iOS/Android quirks
4. **C-space** — first one needing a worker
5. **Particle filter + SLAM** — the centerpiece, build it when the infrastructure is proven
6. **Optical flow** — last, because it's the one most likely to need a fallback plan

Rough total: 4000–6000 lines across all six, sharing maybe 500 lines of common code. Nothing here needs a dependency larger than Preact.
