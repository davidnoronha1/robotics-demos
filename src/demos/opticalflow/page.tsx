import { render } from "preact";
import { App } from "./App";

/** Page chrome in code rather than HTML, so demos/opticalflow/index.html can
 * stay a bare mount point (mirrors the IMU demo). */
function Shell() {
  return (
    <article>
      <a class="special return-index" href="/">
        Return To Index
      </a>

      <header>
        <h1>6. Webcam feature tracking (ORB)</h1>
        <p>
          Keypoints detected by FAST or Shi–Tomasi, described with binary BRIEF descriptors, and matched across
          frames by Hamming distance — the approach behind feature-based SLAM / visual odometry. Point a camera at
          a textured surface and watch features stick.
        </p>
      </header>

      <App />

      <footer>
        <a class="special return-index" href="/">
          Return To Index
        </a>
      </footer>
    </article>
  );
}

const root = document.getElementById("optical-root");
if (root) render(<Shell />, root);

// Hot reload: tear the whole Preact tree down (running every cleanup, which
// stops the camera/clip and the frame loop) before re-mounting.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    if (root) {
      render(null, root);
      render(<Shell />, root);
    }
  });
  import.meta.hot.dispose(() => {
    if (root) render(null, root);
  });
}