# Plan: Demo 6 — Webcam feature tracking (ORB descriptor matching)

### What it is
Live camera feed → grayscale → **ORB-style keypoints with binary descriptors, matched across video frames**. This is the approach behind feature-based SLAM / visual odometry / AR: keypoints stick to objects and can be re-matched frame after frame (even after big motions, rotation, or brief occlusion), not just chased by sub-pixel optical flow.

**ORB = Oriented FAST + Rotated BRIEF.** FAST is not an alternative to ORB — it's ORB's corner detector. The "feature" is the binary BRIEF descriptor, which is what makes matching across frames possible. SIFT/SURF are the heavier, historically-patented alternatives; ORB is the free, fast, browser-friendly standard (binary descriptors, Hamming distance). Everything hand-rolled.

### Module layout — `src/demos/opticalflow/` (new)
Mirrors the IMU demo structure; everything new except where noted:

| File | Responsibility |
|---|---|
| `page.tsx` | Shell (return link, header, footer, HMR re-mount) — copy of IMU `page.tsx` pattern |
| `App.tsx` | State, camera lifecycle, rAF loop, overlay canvas, control panels, editor wiring |
| `cameraFeed.ts` | `getUserMedia`, `facingMode:"environment"`, permission handling, insecure-context detection |
| `videoSource.ts` | **Abstracts live cam vs. bundled-clip fallback** — both expose `capture(gray: Uint8Array): boolean`, so the pipeline never cares which |
| `capture.ts` | `drawImage` → offscreen 320×240 → `getImageData` → preallocated gray `Uint8Array`; horizontal mirroring for selfie feel |
| `fast.ts` | FAST-9 (Bresenham-16) + non-max suppression — the detector *inside* ORB |
| `shiTomasi.ts` | Optional second detector (gradient-based, well-conditioned corners) — a toggle to show FAST finds more, Shi–Tomasi finds trackable ones |
| `orb.ts` | **The core:** intensity-centroid orientation; rotated BRIEF-256 sampling; Hamming popcount; ratio test + bidirectional cross-check. Keypoint = `(x, y, response, angle, descriptor[32])` |
| `keyframe.ts` | Reference-frame management: features tracked by matching against the **previous frame** *and* a held **keyframe**, so tracks survive many frames and wide motions; automatic keyframe refresh on too few matches |
| `motionModel.ts` | RANSAC homography/similarity fit over matches → dominant-motion readout ("panning left, 12 px/frame", zoom/rotate) + inlier/outlier flags |
| `overlay.ts` | Draws keypoints as circles + orientation arrows, matched vs. unmatched, inlier/outlier coloring, trails (last ~8 positions), dominant-motion arrow/horizon, keyframe indicator |
| `fastInset.tsx` | Teaching inset: magnified pixel-grid showing the 16-pixel FAST ring, cells colored brighter/darker/similar + center pixel; follows the hovered pixel. Shows *how* ORB finds its keypoints |
| `trackerCode.ts` | Editable ORB template (detector threshold, descriptor patch radius/bit count, matcher ratio test) compiled via `new Function` like `fusionCode.ts`; params extraction/injection. Optional second template: classic pyramidal Lucas–Kanade as a comparison |
| `MathExplainer.tsx` | Collapsible sections: what makes a good keypoint (auto-correlation), FAST circle test, the orientation trick (intensity centroid), BRIEF binary descriptors + Hamming distance, why match-vs-track (wide baseline), RANSAC |

### Reused shared code
- `src/shared/ui/{Slider,Checkbox,Readout,Tabs}`, `src/shared/canvas.ts`, `src/shared/codeEditor.ts`, `MathTex`
- **Refactor:** extract `findParamsBlock`/`stripComments`/`extractParams`/`injectParams`/`formatParamsBlock` out of `src/demos/imu/fusionCode.ts` into `src/shared/codeParams.ts` (shared, typed `Record<string,unknown>`); IMU imports from there
- **Refactor:** generalize `src/demos/imu/qr.ts` → `src/shared/qr.ts` taking `(url, text)`; IMU keeps its URL, optical flow gets `…/demos/opticalflow/`

### The pipeline (all hand-rolled, ~400 lines of core)
1. **Detect:** FAST-9 or Shi–Tomasi keypoints at 320×240, NMS, cap ~200
2. **Orient:** intensity centroid over the patch: `θ = atan2(m01, m10)` — makes descriptors rotation-aware (the "O" in ORB)
3. **Describe:** blur, sample 256 pre-generated Gaussian pair offsets, rotate by θ, one bit per pair (`I(xi)>I(xj)`) → 32-byte binary descriptor
4. **Match** vs. previous frame: Hamming (popcount of XOR), Lowe ratio test + bidirectional cross-check to kill ambiguous matches
5. **Persist:** match also against the held **keyframe** so features survive many frames; RANSAC on matches; cull outliers, backfill with fresh detections, auto-refresh keyframe when match count drops
6. **Motion:** RANSAC similarity/homography → dominant-motion readout; inliers drive the arrow/horizon

### Editable code
- The ORB template is the editable centerpiece — detector threshold, descriptor sampling, matcher ratio test live in a `params` block; sliders inject into it (IMU link-sliders→code pattern); Apply recompiles via `new Function`, errors shown in the editor.
- Optional second template: pyramidal Lucas–Kanade, to contrast descriptor matching with classic optical flow.

### Bundled-clip fallback
- `scripts/generate-fallback-clip.sh` renders a short (~6 s, 320×240, small WebM) clip with ffmpeg — camera panning over a textured desk with moving shapes, so keypoints and matches are unambiguous. License-safe, reproducible, no network dependency. Output committed to `demos/opticalflow/assets/fallback.webm` (Vite imports it as a URL asset). A synthetic moving-shapes scene stays as an internal dev/test tool.

### Wiring
- `vite.config.ts`: add `optical: root("./demos/opticalflow/index.html")` to `rollupOptions.input`
- `demos/opticalflow/index.html`: bare mount point `#optical-root` (copy of IMU pattern)
- `index.html`: make demo 6 an `<a href="/demos/opticalflow/">` link; update its title/description from "corner detection + optical flow" to feature-tracking framing

### UI layout (following IMU conventions)
Banner (enable-camera / privacy note / fallback note) → stage (video + overlay with orientation-arrow keypoints, aspect-correct) → QR affordance → control panel with tabs (Detector / Matching / Overlay) → FAST-circle inset section → dominant-motion readout → MathExplainer → editable ORB code section

### Verification
- New `scripts/verify-optical-flow.ts` (tsx, like `verify-imu-fusion.ts`): generate a synthetic textured image; translate and rotate it; run FAST→ORB→match→RANSAC and assert recovered transform within tolerance; same for Shi–Tomasi and the LK template. `npm run verify:opticalflow`.
- `npm run build` + confirm the WebM bundles and demos/imu still builds after the `codeParams`/`qr` refactors.
- Browser smoke test on the live feed.

### Assumptions / scope notes
- **Performance:** main thread first; 320×240, all buffers preallocated. Worker/OffscreenCanvas is the documented escalation path, not initial scope.
- **Scale invariance:** classic ORB is scale-aware via an image pyramid; initial version can be single-scale (like the common mobile use) with pyramid matching as an extension. If you want scale-invariance from the start, it's an extra pyramid + descriptor per level — say the word.
- LK template is optional; dropping it trims `lk.ts` + one template.
