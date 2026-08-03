import renderMathInElement from "katex/dist/contrib/auto-render.mjs";
import "katex/dist/katex.min.css";

type Actions = Record<string, () => void>;

/** The math section's markup lives in demos/imu/index.html. This module only
 * KaTeX-renders the `$...$`/`$$...$$` in it and wires the "set it and see"
 * buttons, which fire into the demo to move the sliders. */
export function mountMath(container: HTMLElement, actions: Actions): void {
  renderMathInElement(container, {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "$", right: "$", display: false },
    ],
    throwOnError: false,
  });

  // Clone-replace each action button so re-mounting (HMR) drops old wiring.
  for (const old of container.querySelectorAll<HTMLButtonElement>("[data-action]")) {
    const id = old.dataset.action;
    if (!id || !actions[id]) continue;
    const fresh = old.cloneNode(true) as HTMLButtonElement;
    old.replaceWith(fresh);
    fresh.addEventListener("click", actions[id]);
  }
}
