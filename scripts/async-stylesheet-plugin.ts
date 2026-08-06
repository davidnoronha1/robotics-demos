import type { Plugin } from "vite";

const asyncStylesheet = (href: string) =>
  `<link rel="preload" href="${href}" as="style" onload="this.onload=null;this.rel='stylesheet'">` +
  `<noscript><link rel="stylesheet" href="${href}"></noscript>`;

/** Build-time HTML enrichment:
 *  1. Make stylesheets non-render-blocking (preload + swap rel on load, with a
 *     `<noscript>` fallback) so first paint doesn't wait on CSS.
 *  2. Add `<link rel="modulepreload">` ahead of each entry module script so the
 *     JS (and its import graph) is discovered + fetched by the preload scanner
 *     before the parser reaches the deferred `<script type="module">`. */
export function asyncStylesheets(): Plugin {
  return {
    name: "async-stylesheets",
    apply: "build",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const withModulePreloads = html.replace(
          /<script([^>]*?)type="module"([^>]*?)src="([^"]+)"[^>]*><\/script>/g,
          (_m, a, b, src) =>
            `<link rel="modulepreload" href="${src}">` +
            `<script${a}type="module"${b}src="${src}"></script>`,
        );
        return withModulePreloads.replace(
          /<link\s+rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
          (_m, href) => asyncStylesheet(href),
        );
      },
    },
  };
}