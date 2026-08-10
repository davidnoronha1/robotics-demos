import { MathTex } from "../../shared/MathTex";
import { BriefPairsDiagram, FastRingDiagram, FlatEdgeCornerDiagram, OrientationDiagram } from "./mathDiagrams";

/** The "why" of the demo, in collapsible sections — every idea that makes
 * feature detection + matching work, from the pixel test to the binary
 * descriptor and RANSAC. */
export function MathExplainer() {
  return (
    <div class="math-wrap">
      <details open>
        <summary>What makes a pixel trackable? (auto-correlation)</summary>
        <p>
          A good feature stands out locally: move a small window around and you should be able to tell exactly where
          it was. The <em>second-moment matrix</em> of the patch captures that. For gradients <MathTex tex="I_x" />
          , <MathTex tex="I_y" />:
        </p>
        <MathTex display tex={String.raw`M = \begin{bmatrix}\sum I_x^2 & \sum I_x I_y \\ \sum I_x I_y & \sum I_y^2\end{bmatrix}`} />
        <p>
          Its two eigenvalues say how sharply the patch varies in its two principal directions. If both are large you
          have a corner (unambiguous in every direction — great to track); if only one is large, an edge (the{" "}
          <em>aperture problem</em>); if neither, flat. Shi–Tomasi scores a pixel by the <em>minimum</em> eigenvalue{" "}
          <MathTex tex="\lambda_{\min}" /> — a high minimum is exactly "well-conditioned to track".
        </p>
        <FlatEdgeCornerDiagram />
      </details>

      <details open>
        <summary>FAST — the much cheaper detector</summary>
        <p>
          Shi–Tomasi needs gradients everywhere, which is costly. FAST replaces that with a pixel test: look at the 16
          pixels on a radius-3 circle (you can see it magnified above). A corner exists when at least 9{" "}
          <em>contiguous</em> ring pixels are all brighter, or all darker, than the center by a threshold{" "}
          <MathTex tex="t" />:
        </p>
        <MathTex display tex={String.raw`|\text{ring}_i - \text{center}| > t\ \ \text{for } {\textstyle\ge 9}\ \text{in a row}`} />
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
        <MathTex display tex={String.raw`m_{10}=\sum_x x\,I(x,y)\qquad m_{01}=\sum_y y\,I(x,y)\qquad \theta=\operatorname{atan2}(m_{01},m_{10})`} />
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
        <MathTex display tex={String.raw`\text{bit}_k = \big[ I(x_k,y_k) < I(x'_k,y'_k) \big]`} />
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
          point whose descriptor is nearest in Hamming space. Two guards keep matches honest: a {`minimum`} distance{" "}
          <MathTex tex="\text{best} < d_\text{min}" /> and Lowe's <em>ratio test</em>
          , which require the best match to clearly beat its runner-up:
        </p>
        <MathTex display tex={String.raw`\frac{\text{best}}{\text{2nd-best}} < r \quad(\text{typically } r \approx 0.75)`} />
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
        <MathTex display tex={String.raw`\begin{bmatrix}x' \\ y'\end{bmatrix} = \begin{bmatrix}a & -b \\ b & a\end{bmatrix}\begin{bmatrix}x \\ y\end{bmatrix} + \begin{bmatrix}t_x \\ t_y\end{bmatrix}`} />
        <p>
          What survives is the majority motion — the "panning left" gauge, and why the rejected feature trails are
          drawn in red.
        </p>
      </details>
    </div>
  );
}