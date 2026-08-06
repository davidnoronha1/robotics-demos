import { MathTex } from "../../shared/MathTex";
import type { FusionParams } from "./fusionCode";

interface MathExplainerProps {
  /** Called when a "set it and see" button rewrites a trust parameter. */
  onTrust: (partial: Partial<FusionParams>) => void;
}

/** The "why" of the demo, written out in collapsible sections. Each equation
 * is a <MathTex>; the buttons are real handlers that move the trust sliders. */
export function MathExplainer({ onTrust }: MathExplainerProps) {
  return (
    <div class="math-wrap">
      <details open>
        <summary>Frames, pose &amp; why quaternions</summary>
        <p>
          The phone has a <em>body</em> frame (X right, Y up the screen, Z out of the glass) and the room has a{" "}
          <em>world</em> frame (X north, Z up). A full 6D <strong>pose</strong> is rotation plus position,{" "}
          <MathTex tex="(q,\, \mathbf{x})" />: we store attitude as a unit quaternion <MathTex tex="q" />, which
          rotates body vectors into world vectors, and position as a plain world-frame vector <MathTex tex="\mathbf{x}" />
          :
        </p>
        <MathTex display tex={String.raw`\mathbf{a}_{\text{world}} = q\, \mathbf{a}_{\text{body}}\, q^{-1}`} />
        <p>
          We never use Euler angles for the rotation part — at pitch <MathTex tex="\pm 90°" /> two axes line up and
          one angle becomes undefined (gimbal lock). Quaternions have no such singularity. Position has no such
          trick to reach for: there's no gyroscope-equivalent "rate sensor" for translation whose integral is
          well-behaved, which is the whole problem the next two sections dig into.
        </p>
      </details>

      <details open>
        <summary>What the sensors measure</summary>
        <p>
          Each sensor reports a known quantity rotated into the body frame, corrupted by a bias <MathTex tex="b" /> and
          noise <MathTex tex="n" />:
        </p>
        <MathTex display tex={String.raw`\omega_m = \underbrace{\omega_{\text{true}}}_{\text{gyro: rotation rate}} + b_g + n_g`} />
        <MathTex display tex={String.raw`\mathbf{a}_m = \underbrace{R(q)\,\mathbf{g}}_{\text{accel: gravity } 9.81\,\text{m/s}^2} + \mathbf{a}_{\text{linear}} + n_a`} />
        <MathTex display tex={String.raw`\mathbf{m}_m = \underbrace{R(q)\,\mathbf{m}_\oplus}_{\text{mag: Earth's field }\sim 50\,\mu\text{T}} + b_m + n_m`} />
        <p>
          <MathTex tex="R(q)" /> is the rotation matrix of <MathTex tex="q" />. Noise here is <em>colored</em> (AR(1))
          plus a drifting bias — real IMUs, not clean white noise. The gyro's bias is why integrating it alone drifts
          forever.
        </p>
      </details>

      <details open>
        <summary>Gyro integration (the motion model)</summary>
        <p>The quaternion evolves as</p>
        <MathTex display tex={String.raw`\dot{q} = \tfrac12\, q \otimes [0,\; \omega]`} />
        <p>
          integrated each step and renormalized. Fast and smooth, but any constant bias in <MathTex tex="\omega" />{" "}
          integrates into an unbounded angle error — that's the <em>gyro-only</em> cube drifting.
        </p>
      </details>

      <details open>
        <summary>Position: integrating accel twice</summary>
        <p>
          There's no sensor for position, so we try the only thing we have: rotate the accel reading into the world
          frame with the current attitude estimate, subtract gravity to isolate the phone's own acceleration, and
          integrate it twice.
        </p>
        <MathTex
          display
          tex={String.raw`\mathbf{a}_{\text{world}} = q\,\mathbf{a}_m\,q^{-1} \qquad \mathbf{v}_k = \mathbf{v}_{k-1} + (\mathbf{a}_{\text{world}} - \mathbf{g})\,dt \qquad \mathbf{x}_k = \mathbf{x}_{k-1} + \mathbf{v}_k\,dt`}
        />
        <p>
          Two integrations instead of the gyro's one: any bias or noise in <MathTex tex="\mathbf{a}_m" /> becomes a
          random walk in <MathTex tex="\mathbf{v}" />, which is then itself integrated into <MathTex tex="\mathbf{x}" />{" "}
          — error grows roughly with <MathTex tex="t^2" /> instead of <MathTex tex="t" />. Nothing observes and
          corrects it the way accel/mag correct the gyro's attitude drift, so it's unbounded. That's the{" "}
          <em>accel pos</em> plot running away even though the phone only rotates in place — real systems bound this
          with GPS, wheel odometry, vision, or zero-velocity updates, not the accelerometer alone.
        </p>
      </details>

      <details open>
        <summary>Accelerometer tilt</summary>
        <p>At rest the accelerometer measures only gravity, so tilt follows by geometry:</p>
        <MathTex display tex={String.raw`\text{roll} = \operatorname{atan2}(a_y,\, a_z)\qquad \text{pitch} = \operatorname{atan2}(-a_x,\, \sqrt{a_y^2+a_z^2})`} />
        <p>
          No integration, no drift — but <strong>yaw is unobservable</strong> (spinning about gravity changes nothing the
          accelerometer sees), and linear acceleration contaminates the reading. The <em>accel-only</em> cube jitters
          under motion and never turns.
        </p>
      </details>

      <details open>
        <summary>Magnetometer heading</summary>
        <p>
          The compass measures the Earth's field in the body frame. Tilt it back to horizontal using the accel
          roll/pitch, and the yaw follows:
        </p>
        <MathTex display tex={String.raw`\psi = \operatorname{atan2}(-m'_y,\, m'_x)\quad\text{with}\quad m' = \text{tilt-corrected } \mathbf{m}_m`} />
        <p>
          Bounded and drift-free, but noisy and perturbed by local metal. This is what finally gives us yaw — the whole
          point of adding the sensor.
        </p>
      </details>

      <details open>
        <summary>Complementary filter</summary>
        <p>
          Blend the smooth-but-drifting gyro attitude with the jittery-but-bounded accel/mag tilt. One line, one knob:
        </p>
        <MathTex display tex={String.raw`q = \operatorname{slerp}\big(q_{\text{tilt}}^{(\psi)},\; q_{\text{gyro}},\; \alpha\big)`} />
        <p>
          <MathTex tex="\alpha" /> is the trust knob:
          <button type="button" onClick={() => onTrust({ alpha: 0.2 })}>
            α → 0 (trust accel)
          </button>
          <button type="button" onClick={() => onTrust({ alpha: 0.99 })}>
            α → 1 (trust gyro)
          </button>
          . The sliders write it straight into the editable code's <code>params</code> block.
        </p>
      </details>

      <details open>
        <summary>The EKF (extended Kalman filter)</summary>
        <p>
          State is the attitude quaternion <MathTex tex="q" /> plus the 3×3 covariance <MathTex tex="P" /> of a small{" "}
          <em>local attitude-error</em> vector <MathTex tex="\delta\theta" /> (a body-frame rotation, not raw quaternion
          components — corrections are applied by composing a small rotation onto <MathTex tex="q" />, never by adding to
          its <MathTex tex="[x,y,z,w]" /> numbers directly, since those don't live on a flat space and an additive
          correction leaks into axes it shouldn't touch). <strong>Predict</strong> — integrate the gyro, and grow{" "}
          <MathTex tex="P" /> by the linearized error dynamics plus process noise:
        </p>
        <MathTex display tex={String.raw`q_k = q_{k-1} \otimes [1,\; \omega\tfrac{dt}{2}]\qquad F = I - dt\,[\omega]_\times\qquad P_k = F P_{k-1} F^{\top} + Q`} />
        <p>
          <MathTex tex="[\omega]_\times" /> is the cross-product ("skew") matrix of <MathTex tex="\omega" />, and{" "}
          <MathTex tex="Q = q_{\text{scale}}\,dt\, I" /> is the process noise — your trust in the <em>gyro</em>.
          <button type="button" onClick={() => onTrust({ qScale: 0.02 })}>
            Q ↑ → trust gyro less
          </button>
          <button type="button" onClick={() => onTrust({ qScale: 1e-6 })}>
            Q ↓ → trust gyro more
          </button>
          .
        </p>
        <p>
          <strong>Correct</strong> — each measurement (accel then mag) compares the predicted sensor reading{" "}
          <MathTex tex="h(q)" /> against the actual one:
        </p>
        <MathTex display tex={String.raw`y = z - h(q)\qquad H = [h(q)]_\times\qquad S = H P_k H^{\top} + R\qquad K = P_k H^{\top} S^{-1}\qquad \delta\theta = Ky\qquad q \mathrel{\otimes}= [1,\; \tfrac{\delta\theta}{2}]`} />
        <p>
          <MathTex tex="H" /> is the Jacobian of <MathTex tex="h" /> with respect to <MathTex tex="\delta\theta" /> — a
          small body-frame rotation by <MathTex tex="\delta\theta" /> rotates the predicted reading by{" "}
          <MathTex tex="h(q) \times \delta\theta" />, so <MathTex tex="H=[h(q)]_\times" /> falls straight out of that.{" "}
          <MathTex tex="R" /> — the per-axis measurement covariance — is your trust in the <em>sensor</em>.
          <button type="button" onClick={() => onTrust({ rAccel: [0.25, 0.25, 0.25] })}>
            R_accel ↑ → trust gyro
          </button>
          <button type="button" onClick={() => onTrust({ rAccel: [1e-4, 1e-4, 1e-4] })}>
            R_accel ↓ → trust accel
          </button>
          <button type="button" onClick={() => onTrust({ rMag: [200, 200, 200] })}>
            R_mag ↑ → ignore compass
          </button>
          <button type="button" onClick={() => onTrust({ rMag: [0.1, 0.1, 0.1] })}>
            R_mag ↓ → lock onto heading
          </button>
          .
        </p>
      </details>

      <details open>
        <summary>What Q and R do</summary>
        <p>Two numbers, two behaviors:</p>
        <ul>
          <li>
            <strong>High <MathTex tex="R" /></strong> (little trust in a sensor): the filter barely corrects, so{" "}
            <MathTex tex="K \to 0" /> and the estimate stays smooth but can drift. Raise <MathTex tex="R_{\text{mag}}" />{" "}
            and watch yaw wander again.
          </li>
          <li>
            <strong>High <MathTex tex="Q" /></strong> (little trust in the gyro): <MathTex tex="P" /> grows, so{" "}
            <MathTex tex="K \to H^{-1}" /> and the filter snaps to the measurements — jittery, but never drifts. The{" "}
            <em>covariance trace</em> plot shows <MathTex tex="P" /> shrinking on each correction and regrowing between
            them.
          </li>
        </ul>
        <p>The whole filter — predict, Jacobians, gain, update — is the editable code below. Change the math itself and the phone reacts live.</p>
      </details>

      <details>
        <summary>The linear algebra, in plain words</summary>
        <p>
          A <strong>vector</strong> is a list of numbers — a point or direction (a sensor reading, the phone's 3D
          orientation error). A <strong>matrix</strong> is a grid of numbers that takes one list and produces another;
          think of it as a machine that stretches, rotates, or mixes things. Multiplying a matrix by a vector is "feeding
          it through the machine".
        </p>
        <p>
          The <strong>transpose</strong> <MathTex tex="A^{\top}" /> flips a matrix's rows and columns — its mirror image
          across the diagonal. The <strong>inverse</strong> <MathTex tex="A^{-1}" /> is the matrix that undoes{" "}
          <MathTex tex="A" />: <MathTex tex="A^{-1} A = I" />, where <MathTex tex="I" /> is the <em>identity</em> matrix
          (1s on the diagonal, the "do nothing" matrix). For a plain number the inverse is <MathTex tex="1/x" />:
          dividing by 2 undoes multiplying by 2. <MathTex tex="A^{-1}" /> exists only when <MathTex tex="A" /> is square
          and doesn't squash anything flat (a "singular" matrix has no inverse). In the Kalman gain{" "}
          <MathTex tex="K = P H^{\top} S^{-1}" /> the <MathTex tex="S^{-1}" /> acts like division by the measurement's
          uncertainty: noisier sensor → bigger <MathTex tex="S" /> → smaller gain → smaller correction.
        </p>
        <p>
          To <strong>integrate</strong> is to add up lots of tiny steps. The speedometer reports <em>rate</em>;
          integrating it (adding rate × time over and over) gives <em>distance</em>. The gyro is a rate sensor too — it
          says how fast the phone is turning right now. Integrating that accumulates the total turn: the quaternion
          update <MathTex tex="q \otimes [1,\; \omega\tfrac{dt}{2}]" /> folds a tiny rotation into <MathTex tex="q" />{" "}
          every sample and renormalizes. Do it forever and the errors add up too — that's the gyro-only cube drifting.
          Position needs integrating twice — accel is a rate of a rate (acceleration → velocity → position) — so its
          errors compound faster still, which is why the accel-only position plot runs away so much quicker than the
          gyro-only cube.
        </p>
        <p>
          The <strong>covariance</strong> matrix <MathTex tex="P" /> (and its relatives <MathTex tex="Q" />,{" "}
          <MathTex tex="R" />) is how the filter keeps score of its own uncertainty: the diagonal entries are each
          axis's variance (expected squared error), and the off-diagonal ones say how errors on different axes move
          together. Bigger numbers = less trust in whatever they describe.
        </p>
        <p>
          A <strong>Jacobian</strong> <MathTex tex="H" /> is a matrix of slopes (partial derivatives): "if I nudge the
          input a little, how much does each output move?" Here <MathTex tex="H = [h(q)]_\times" /> says how a small
          tilt <MathTex tex="\delta\theta" /> shifts the expected sensor reading — that's what turns "how wrong is the
          reading" (<MathTex tex="y = z - h" />) into "how wrong is the orientation" (<MathTex tex="\delta\theta = Ky" />).
        </p>
        <p>
          The <strong>skew</strong> matrix <MathTex tex="[\omega]_\times" /> is a notation trick: it repackages the
          cross product <MathTex tex="\omega \times v" /> as an ordinary matrix multiplication so the linear-algebra
          machinery applies. And <strong>slerp</strong> just means "blend along the shortest rotation path between two
          attitudes" — the complementary filter's one-line knob.
        </p>
      </details>
    </div>
  );
}
