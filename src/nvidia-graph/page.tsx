import { render } from "preact";
import { App } from "./App";

function Shell() {
  return <App />;
}

const root = document.getElementById("graph-root");
if (root) render(<Shell />, root);

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