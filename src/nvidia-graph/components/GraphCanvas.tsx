import type { RefObject } from "preact";

interface GraphCanvasProps {
  containerRef: RefObject<HTMLDivElement>;
}

export function GraphCanvas({ containerRef }: GraphCanvasProps) {
  return <div ref={containerRef} class="graph-canvas" />;
}
