/** README markdown -> sanitized HTML for the side panel.
 *
 * Uses `marked` for GFM parsing (tables, strikethrough, task lists, raw HTML
 * blocks, …) and `DOMPurify` to sanitize the result, since READMEs are
 * untrusted content. Links/images are re-routed through a custom renderer:
 * GitHub READMEs commonly use repo-relative paths (`docs/arch.png`) that only
 * resolve against the repo's raw/blob URLs, not this page's origin.
 */

import { Marked, Lexer, type Tokens } from "marked";
import DOMPurify from "dompurify";

export interface ReadmeContext {
  repo?: string; // "owner/name"
  branch?: string;
}

const ABSOLUTE_URL = /^(https?:|mailto:)/i;
const OTHER_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** Resolve a markdown link/image URL against the repo it came from. Returns
 * null when the URL can't be safely resolved (unknown scheme, or a relative
 * path with no repo context to resolve against) — callers drop the link. */
function resolveUrl(rawUrl: string, kind: "image" | "link", ctx: ReadmeContext): string | null {
  const url = rawUrl.trim();
  if (!url || url.startsWith("#")) return url || null;
  if (ABSOLUTE_URL.test(url)) return url;
  if (OTHER_SCHEME.test(url) || url.startsWith("//")) return null;
  if (!ctx.repo) return null;
  const branch = ctx.branch || "HEAD";
  const path = url.replace(/^\.\//, "").replace(/^\//, "");
  return kind === "image"
    ? `https://raw.githubusercontent.com/${ctx.repo}/${branch}/${path}`
    : `https://github.com/${ctx.repo}/blob/${branch}/${path}`;
}

// GitHub-flavored alert callouts: `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` /
// `[!WARNING]` / `[!CAUTION]` as the first line of a blockquote.
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/i;

const ALLOWED_TAGS = [
  "p", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "em", "del", "code", "pre",
  "a", "img",
  "ul", "ol", "li",
  "blockquote", "div",
  "table", "thead", "tbody", "tr", "th", "td",
  "span", "sub", "sup",
];
const ALLOWED_ATTR = [
  "href", "src", "alt", "title", "align", "colspan", "rowspan", "start",
  "loading", "decoding", "class",
];

let hooked = false;
function ensurePurifyHooks() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.hasAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

export function markdownToHtml(src: string, ctx: ReadmeContext = {}): string {
  ensurePurifyHooks();

  // Defensively strip comments before parsing rather than relying on marked's
  // inline HTML tokenizer to always recognize them — an unrecognized `<!--`
  // would otherwise get escaped and rendered as visible garbage text.
  const withoutComments = src.replace(/<!--[\s\S]*?-->/g, "");

  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({
    renderer: {
      link({ href, title, tokens }: Tokens.Link) {
        const text = this.parser.parseInline(tokens);
        const resolved = href ? resolveUrl(href, "link", ctx) : null;
        if (!resolved) return text;
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
        return `<a href="${escapeAttr(resolved)}"${titleAttr}>${text}</a>`;
      },
      image({ href, title, text }: Tokens.Image) {
        const alt = escapeAttr(text ?? "");
        const resolved = href ? resolveUrl(href, "image", ctx) : null;
        if (!resolved) return alt;
        const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
        return `<img src="${escapeAttr(resolved)}" alt="${alt}"${titleAttr} loading="lazy" decoding="async">`;
      },
      blockquote({ text, tokens }: Tokens.Blockquote) {
        const m = ALERT_RE.exec(text);
        if (!m) return `<blockquote>${this.parser.parse(tokens)}</blockquote>`;
        const kind = m[1]!.toUpperCase();
        const rest = text.slice(m[0].length);
        const body = rest.trim() ? this.parser.parse(Lexer.lex(rest, this.parser.options)) : "";
        return `<div class="gh-alert gh-alert-${kind.toLowerCase()}"><p class="gh-alert-title">${kind}</p>${body}</div>`;
      },
    },
  });

  const html = marked.parse(withoutComments, { async: false }) as string;
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}
