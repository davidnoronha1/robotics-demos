import { useOpticalFlowDemo, CAMERA_WIDTH, CAMERA_HEIGHT } from "./useOpticalFlowDemo";
import { OpticalFlowBanner } from "./components/OpticalFlowBanner";
import { OpticalFlowStage } from "./components/OpticalFlowStage";
import { OpticalFlowControls } from "./components/OpticalFlowControls";
import { FastSection } from "./components/FastSection";
import { TrackerEditorSection } from "./components/TrackerEditorSection";
import { M } from "../../shared/Math";
import {
  BriefPairsDiagram,
  FastRingDiagram,
  FlatEdgeCornerDiagram,
  OrientationDiagram,
} from "./mathDiagrams";

export function App() {
  const demo = useOpticalFlowDemo();

  return (
    <div>
      <OpticalFlowBanner
        banner={demo.banner}
        canCamera={demo.canCamera}
        onEnableCamera={demo.useCamera}
      />

      <OpticalFlowStage
        stageRef={demo.stageRef}
        qrHostRef={demo.qrHostRef}
        counts={demo.counts}
        pinnedCount={demo.pinnedCount}
        onStageMove={demo.onStageMove}
        onClearHover={demo.onClearHover}
      />

      <OpticalFlowControls
        detector={demo.detector}
        setDetector={demo.setDetector}
        fastThreshold={demo.fastThreshold}
        setFastThreshold={demo.setFastThreshold}
        shiMin={demo.shiMin}
        setShiMin={demo.setShiMin}
        mirrored={demo.mirrored}
        setMirrored={demo.setMirrored}
        maxTracks={demo.maxTracks}
        setMaxTracks={demo.setMaxTracks}
        minDist={demo.minDist}
        ratio={demo.ratio}
        applyMatchingParams={demo.applyMatchingParams}
        linkEnabled={demo.linkEnabled}
        setLinkEnabled={demo.setLinkEnabled}
        showCorners={demo.showCorners}
        setShowCorners={demo.setShowCorners}
        showTracks={demo.showTracks}
        setShowTracks={demo.setShowTracks}
        showMotion={demo.showMotion}
        setShowMotion={demo.setShowMotion}
        showPin={demo.showPin}
        setShowPin={demo.setShowPin}
        loupeColor={demo.loupeColor}
        setLoupeColor={demo.setLoupeColor}
        videoRate={demo.videoRate}
        setVideoRate={demo.setVideoRate}
        paused={demo.paused}
        onTogglePause={demo.togglePause}
        onPinCurrent={demo.pinCurrent}
        onClearPinned={demo.clearPinned}
        onResetTracks={demo.resetTracks}
      />

      <FastSection
        insetRef={demo.insetRef}
        gray={demo.controller.gray}
        w={CAMERA_WIDTH}
        h={CAMERA_HEIGHT}
        x={demo.detector === "fast" ? demo.hover?.x ?? null : null}
        y={demo.detector === "fast" ? demo.hover?.y ?? null : null}
        threshold={demo.fastThreshold}
      />

      <TrackerEditorSection
        editorHostRef={demo.editorHostRef}
        onApply={demo.applyEditorCode}
        onReset={demo.resetEditorCode}
      />

      {/* --- Math & Concept Explainer --- */}
      <div class="math-wrap">
        <details open>
          <summary>What makes a pixel trackable? (auto-correlation)</summary>
          <p>
            A good feature stands out locally: move a small window around and you should be able to tell exactly where
            it was. The <em>second-moment matrix</em> of the patch captures that. For gradients <M>I_x</M>, <M>I_y</M>:
          </p>
          <M display>{String.raw`M = \begin{bmatrix}\sum I_x^2 & \sum I_x I_y \\ \sum I_x I_y & \sum I_y^2\end{bmatrix}`}</M>
          <p>
            Its two eigenvalues say how sharply the patch varies in its two principal directions. If both are large you
            have a corner (unambiguous in every direction — great to track); if only one is large, an edge (the{" "}
            <em>aperture problem</em>); if neither, flat. Shi–Tomasi scores a pixel by the <em>minimum</em> eigenvalue{" "}
            <M tex="\lambda_{\min}" /> — a high minimum is exactly "well-conditioned to track".
          </p>
          <FlatEdgeCornerDiagram />
        </details>

        <details open>
          <summary>FAST — the much cheaper detector</summary>
          <p>
            Shi–Tomasi needs gradients everywhere, which is costly. FAST replaces that with a pixel test: look at the 16
            pixels on a radius-3 circle (you can see it magnified above). A corner exists when at least 9{" "}
            <em>contiguous</em> ring pixels are all brighter, or all darker, than the center by a threshold <M>t</M>:
          </p>
          <M display>{String.raw`|\text{ring}_i - \text{center}| > t\ \ \text{for } {\textstyle\ge 9}\ \text{in a row}`}</M>
          <p>
            That's it. It's called FAST because it needs no math richer than comparisons — a dozen integer adds per pixel.
            Non-maximum suppression then thins clusters to one per corner. Raising the threshold (slider) removes weak
            corners; lowering it finds thousands. Most of them are useless for tracking.
          </p>
          <FastRingDiagram />
        </details>

        <details open>
          <summary>Why an orientation? (the "O" in ORB)</summary>
          <p>
            A descriptor that always samples the same pixel offsets breaks when the image rotates. ORB fixes this by
            giving each keypoint a repeatable orientation — the angle of its patch's intensity-weighted <em>centroid</em>:
          </p>
          <M display>{String.raw`m_{10}=\sum_x x\,I(x,y)\qquad m_{01}=\sum_y y\,I(x,y)\qquad \theta=\operatorname{atan2}(m_{01},m_{10})`}</M>
          <p>
            The centroid points from the keypoint toward the "heavier" side of the patch, so it rotates with the image —
            and the descriptor samples the same physical features regardless of rotation.
          </p>
          <OrientationDiagram />
        </details>

        <details open>
          <summary>BRIEF: turning a patch into 256 bits</summary>
          <p>
            Rather than store the patch, BRIEF stores only sorted comparisons. Pick 256 pre-chosen pairs of points
            within the patch; for each pair, record one bit — is the first brighter than the second? The whole patch
            becomes a 32-byte string:
          </p>
          <M display>{String.raw`\text{bit}_k = \big[ I(x_k,y_k) < I(x'_k,y'_k) \big]`}</M>
          <p>
            Descriptors are <em>equal</em> across frames only if built from a pre-smoothed image (single-pixel noise
            flips bits), which is why the demo blurs first. Matching two descriptors reduces to the Hamming distance —
            count the differing bits (XOR + popcount) — a few dozen native ops, hence ORB's speed.
          </p>
          <BriefPairsDiagram />
        </details>

        <details open>
          <summary>Matching, and why features "stick"</summary>
          <p>
            It hashes: next frame we describe its keypoints the same way, then for each tracked point find the current
            point whose descriptor is nearest in Hamming space. Two guards keep matches honest: a minimum distance{" "}
            <M tex="\text{best} < d_{\min}" /> and Lowe's <em>ratio test</em>, which require the best match to clearly beat its runner-up:
          </p>
          <M display>{String.raw`\frac{\text{best}}{\text{2nd-best}} < r \quad(\text{typically } r \approx 0.75)`}</M>
          <p>
            Because a descriptor recognizes its patch, a tracked feature keeps identity across many frames even if the
            camera pans — the "recognition" old trackers lack. That's the whole point.
          </p>
        </details>

        <details open>
          <summary>RANSAC: motion in a sea of outliers</summary>
          <p>
            Some matches are always wrong. Rather than average them all, fit the dominant motion with <strong>RANSAC</strong>:
            repeatedly pick a few matches, fit a candidate transform, count how many others agree, keep the best. For a
            nice middle ground this demo fits a <em>similarity</em> transform (pan + rotate + zoom),
          </p>
          <M display>{String.raw`\begin{bmatrix}x' \\ y'\end{bmatrix} = \begin{bmatrix}a & -b \\ b & a\end{bmatrix}\begin{bmatrix}x \\ y\end{bmatrix} + \begin{bmatrix}t_x \\ t_y\end{bmatrix}`}</M>
          <p>
            What survives is the majority motion — the "panning left" gauge, and why the rejected feature trails are
            drawn in red.
          </p>
        </details>
      </div>
    </div>
  );
}
