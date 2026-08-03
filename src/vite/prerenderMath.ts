import katex from "katex";
import type { Plugin } from "vite";

/**
 * Renders the `$…$` / `$$…$$` in each page's HTML to KaTeX markup at build
 * time, so the math ships as plain spans: no flash of raw TeX on load, no
 * layout shift, and nothing to render on the main thread. The runtime
 * auto-render pass (see mathExplain.ts) then finds no delimiters left and is
 * a no-op in production, while still doing the work during `vite dev`.
 *
 * Only text outside tags is touched — a `$` inside an attribute or a
 * <script>/<style> body is left alone.
 */
export function prerenderMath(): Plugin {
  return {
    name: "prerender-math",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return renderMathInHtml(html);
      },
    },
  };
}

/** Splits on tags and skipped element bodies, rendering only the text between. */
export function renderMathInHtml(html: string): string {
  const skipBody = /<(script|style|textarea|pre|code)\b[\s\S]*?<\/\1>/gi;
  const segments: string[] = [];
  let cursor = 0;

  for (const match of html.matchAll(skipBody)) {
    segments.push(renderTextSegments(html.slice(cursor, match.index)), match[0]);
    cursor = match.index + match[0].length;
  }
  segments.push(renderTextSegments(html.slice(cursor)));
  return segments.join("");
}

/** Renders math in the text nodes of `chunk`, leaving tags untouched. */
function renderTextSegments(chunk: string): string {
  return chunk.replace(/>([^<]+)</g, (whole, text: string) => {
    const rendered = renderDelimiters(text);
    return rendered === text ? whole : `>${rendered}<`;
  });
}

const DISPLAY = /\$\$([\s\S]+?)\$\$/g;
const INLINE = /(?<!\$)\$([^$\n]+?)\$(?!\$)/g;

function renderDelimiters(text: string): string {
  if (!text.includes("$")) return text;
  return text
    .replace(DISPLAY, (whole, tex: string) => render(whole, tex, true))
    .replace(INLINE, (whole, tex: string) => render(whole, tex, false));
}

function render(whole: string, tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(decodeEntities(tex.trim()), {
      displayMode,
      throwOnError: false,
      output: "html",
    });
  } catch {
    return whole; // leave the source visible rather than dropping the equation
  }
}

/** The HTML source may carry entities inside math (`&amp;`, `&lt;`); KaTeX
 * wants the raw characters. */
function decodeEntities(tex: string): string {
  return tex
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
