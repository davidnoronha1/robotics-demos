import { useMemo } from "preact/hooks";
import { mathSvgs } from "virtual:math-svgs";

export interface MathTexProps {
  /** LaTeX source (no `$` delimiters — MathJax is applied at build time). */
  tex: string;
  /** Render as a centered block equation on its own line. */
  display?: boolean;
}

/** Renders one LaTeX expression as an inline SVG baked at build time by the
 * `math-svgs` Vite plugin (MathJax → SVG). No runtime math library or font
 * payload ships to the browser. */
export function MathTex({ tex, display = false }: MathTexProps) {
  const html = useMemo(
    () => mathSvgs[`${display ? "d" : "i"}\u0000${tex}`] ?? "",
    [tex, display],
  );
  if (!html) return null;
  if (display) return <div class="math-display" dangerouslySetInnerHTML={{ __html: html }} />;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
