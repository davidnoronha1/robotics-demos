import katex from "katex";
import { useMemo } from "preact/hooks";
import "katex/dist/katex.min.css";

export interface MathTexProps {
  /** LaTeX source (no `$` delimiters — KaTeX is applied directly). */
  tex: string;
  /** Render as a centered block equation on its own line. */
  display?: boolean;
}

/** Renders one LaTeX expression. `renderToString` avoids KaTeX's DOM
 * auto-render pass (and the HTML-string workaround that forced on it): each
 * expression is compiled independently and injected via KaTeX's normal
 * output path. */
export function MathTex({ tex, display = false }: MathTexProps) {
  const html = useMemo(
    () => katex.renderToString(tex, { displayMode: display, throwOnError: false }),
    [tex, display],
  );
  if (display) return <div dangerouslySetInnerHTML={{ __html: html }} />;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
