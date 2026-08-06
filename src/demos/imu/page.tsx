import { render } from "preact";
import { App } from "./App";

/** Page chrome (return link, title, footer) lives in code rather than the
 * HTML file, so demos/imu/index.html stays a bare mount point. */
function Shell() {
  return (
    <article>
      <a class="special return-index" href="/">
        Return To Index
      </a>

      <header>
        <h1>3. IMU attitude estimation</h1>
        <p>
          Three attitude estimates from your own phone's sensors: gyro-only, accel-only, and complementary fusion. Pick
          up your phone and feel why fusion exists.
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

const root = document.getElementById("imu-root");
if (root) render(<Shell />, root);

// Hot reload: any edited demo module re-mounts the demo in place instead of
// a full page reload. Rendering null first tears down the whole Preact tree
// (running every component's effect cleanup — physics/scene/editors/plots)
// before the fresh tree mounts.
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
