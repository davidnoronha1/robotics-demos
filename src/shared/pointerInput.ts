/** Pointer Events helper: one code path for mouse, touch, and stylus. */
export interface PointerHandlers {
  onDown?(x: number, y: number, e: PointerEvent): void;
  onMove?(x: number, y: number, e: PointerEvent): void;
  onUp?(x: number, y: number, e: PointerEvent): void;
}

export function bindPointerInput(el: HTMLElement, handlers: PointerHandlers): () => void {
  el.style.touchAction = "none";

  function localXY(e: PointerEvent): [number, number] {
    const r = el.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function down(e: PointerEvent) {
    el.setPointerCapture(e.pointerId);
    const [x, y] = localXY(e);
    handlers.onDown?.(x, y, e);
  }
  function move(e: PointerEvent) {
    const [x, y] = localXY(e);
    handlers.onMove?.(x, y, e);
  }
  function up(e: PointerEvent) {
    const [x, y] = localXY(e);
    handlers.onUp?.(x, y, e);
  }

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);

  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
  };
}
