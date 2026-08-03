/**
 * Calls onEnter/onLeave as an element scrolls in/out of view or the tab is
 * backgrounded. Used to start/stop a demo's sim loop so six demos on one
 * page don't all run at once.
 */
export function onVisibilityChange(
  el: Element,
  onEnter: () => void,
  onLeave: () => void,
): () => void {
  let intersecting = false;
  let tabVisible = document.visibilityState === "visible";

  function sync() {
    if (intersecting && tabVisible) onEnter();
    else onLeave();
  }

  const io = new IntersectionObserver(
    ([entry]) => {
      intersecting = !!entry?.isIntersecting;
      sync();
    },
    { threshold: 0.05 },
  );
  io.observe(el);

  function onVis() {
    tabVisible = document.visibilityState === "visible";
    sync();
  }
  document.addEventListener("visibilitychange", onVis);

  return () => {
    io.disconnect();
    document.removeEventListener("visibilitychange", onVis);
  };
}
