import katex from "katex";
import type { ComponentChildren } from "preact";

const mathCache = new Map<string, string>();

/** Render a LaTeX equation string to HTML using KaTeX. */
export function renderKatex(tex: string, display = false): string {
  const key = `${display ? "d" : "i"}:${tex}`;
  let cached = mathCache.get(key);
  if (cached !== undefined) return cached;

  try {
    cached = katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
      output: "htmlAndMathml",
    });
  } catch (err) {
    cached = `<span class="katex-error">${tex}</span>`;
  }
  mathCache.set(key, cached);
  return cached;
}

export interface MathProps {
  children?: ComponentChildren;
  tex?: string;
  display?: boolean;
  class?: string;
}

/**
 * Concise component for rendering math via KaTeX.
 * Can be used as `<M>x</M>`, `<M tex="x" />`, or `<M display>{String.raw`...`}</M>`.
 */
export function Math({ children, tex, display = false, class: className }: MathProps) {
  const formula =
    tex ??
    (typeof children === "string"
      ? children.trim()
      : Array.isArray(children) && typeof children[0] === "string"
        ? children.join("").trim()
        : "");

  if (!formula) return null;
  const html = renderKatex(formula, display);

  if (display) {
    return <div class={`math-display ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <span class={`math-inline ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Short alias for <Math>. `<M>q</M>` or `<M display>...</M>` */
export const M = Math;

interface MathTextProps {
  children: string;
  as?: "p" | "span" | "div";
  class?: string;
}

/**
 * Renders text containing inline `$math$` and block `$$display$$` notation,
 * making content paragraphs readable and simple to edit without nesting JSX tags.
 */
export function MathText({ children, as: Tag = "span", class: className }: MathTextProps) {
  if (!children || typeof children !== "string") return null;

  // Pattern matches $$...$$ or $...$
  const regex = /\$\$([\s\S]+?)\$\$|\$([^\$\n]+?)\$/g;
  const parts: ComponentChildren[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(children)) !== null) {
    if (match.index > lastIndex) {
      parts.push(children.slice(lastIndex, match.index));
    }

    if (match[1] !== undefined) {
      // Display math $$...$$
      const html = renderKatex(match[1].trim(), true);
      parts.push(<div class="math-display" dangerouslySetInnerHTML={{ __html: html }} />);
    } else if (match[2] !== undefined) {
      // Inline math $...$
      const html = renderKatex(match[2].trim(), false);
      parts.push(<span class="math-inline" dangerouslySetInnerHTML={{ __html: html }} />);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < children.length) {
    parts.push(children.slice(lastIndex));
  }

  return <Tag class={className}>{parts}</Tag>;
}
