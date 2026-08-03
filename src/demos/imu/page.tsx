import { render } from "preact";
import { App } from "./App";

const root = document.getElementById("imu-root");
if (root) render(<App />, root);

// Hot reload: any edited demo module re-mounts the demo in place instead of
// a full page reload. Rendering null first tears down the whole Preact tree
// (running every component's effect cleanup — physics/scene/editors/plots)
// before the fresh tree mounts.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    if (root) {
      render(null, root);
      render(<App />, root);
    }
  });
  import.meta.hot.dispose(() => {
    if (root) render(null, root);
  });
}
