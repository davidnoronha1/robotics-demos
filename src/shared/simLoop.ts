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
  let raf = 0;
  let running = false;
  let acc = 0;
  let last = 0;

  function frame(now: number) {
    if (!running) return;
    acc += Math.min((now - last) / 1000, 0.25);
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
