/** Fixed-timestep accumulator loop, decoupled physics from rendering. */
export interface SimLoop {
  start(): void;
  stop(): void;
}

export function createSimLoop(
  step: (dt: number) => void,
  render: (alpha: number) => void,
  dt = 1 / 100,
): SimLoop {
  // Caps how much sim time one rendered frame can advance, so a stall (tab
  // backgrounded, debugger paused) doesn't dump seconds of accumulated steps
  // into a single burst when it resumes.
  const MAX_FRAME_DELTA_S = 0.25;

  let raf = 0;
  let running = false;
  let acc = 0;
  let last = 0;

  function frame(now: number) {
    if (!running) return;
    acc += Math.min((now - last) / 1000, MAX_FRAME_DELTA_S);
    last = now;
    while (acc >= dt) {
      step(dt);
      acc -= dt;
    }
    render(acc / dt);
    raf = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      acc = 0;
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
  };
}
