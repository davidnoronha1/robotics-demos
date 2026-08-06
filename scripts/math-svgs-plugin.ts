import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

const VIRTUAL_ID = "virtual:math-svgs";

/** Render a block of LaTeX to an inline SVG string via MathJax's Node API. */
async function buildRenderer() {
  const { mathjax } = await import("mathjax-full/js/mathjax.js");
  const { TeX } = await import("mathjax-full/js/input/tex.js");
  const { SVG } = await import("mathjax-full/js/output/svg.js");
  const { liteAdaptor } = await import("mathjax-full/js/adaptors/liteAdaptor.js");
  const { RegisterHTMLHandler } = await import("mathjax-full/js/handlers/html.js");
  const { AllPackages } = await import("mathjax-full/js/input/tex/AllPackages.js");

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const tex = new TeX({ packages: AllPackages });
  const svgJax = new SVG({ fontCache: "none" });
  const doc = mathjax.document("", {
    InputJax: tex,
    OutputJax: svgJax,
    MmlFactory: tex.mmlFactory,
  });

  return (latex: string, display: boolean) => {
    const node = doc.convert(latex, {
      display,
      em: 16,
      ex: 8,
      containerWidth: 1e9,
    });
    return adaptor.innerHTML(node);
  };
}

/** Collect every (tex, display) pair used by <MathTex> in the source tree. */
function collectMath(srcDir: string): Array<{ tex: string; display: boolean }> {
  const items: Array<{ tex: string; display: boolean }> = [];
  for (const name of readdirSync(srcDir)) {
    const p = join(srcDir, name);
    if (statSync(p).isDirectory()) {
      items.push(...collectMath(p));
      continue;
    }
    if (!/\.(tsx|ts)$/.test(name)) continue;
    const src = readFileSync(p, "utf8");
    for (const m of src.matchAll(/\btex\s*=\s*"((?:[^"\\]|\\.)*)"/g)) {
      items.push({ tex: m[1], display: false });
    }
    for (const m of src.matchAll(/\btex\s*=\s*\{\s*String\.raw\s*`([^`]*)`\s*\}/g)) {
      items.push({ tex: m[1], display: false });
    }
    for (const m of src.matchAll(/<MathTex\s+display[^>]*tex=\{\s*String\.raw\s*`([^`]*)`\s*\}/g)) {
      items.push({ tex: m[1], display: true });
    }
  }
  return items;
}

/** Bake LaTeX in <MathTex tex=.../> to inline SVGs at build time. Exposed as a
 *  virtual module so nothing runs in the browser and the map can never go stale. */
export function mathSvgs(): Plugin {
  const srcDir = join(process.cwd(), "src");
  let render: ((latex: string, display: boolean) => string) | undefined;

  return {
    name: "math-svgs",
    enforce: "pre",
    async buildStart() {
      render = await buildRenderer();
    },
    async configResolved() {
      render ??= await buildRenderer();
    },
    resolveId(id) {
      if (id === VIRTUAL_ID) return "\0" + VIRTUAL_ID;
    },
    async load(id) {
      if (id !== "\0" + VIRTUAL_ID) return;
      render ??= await buildRenderer();
      const entries = new Map<string, string>();
      for (const { tex, display } of collectMath(srcDir)) {
        const key = `${display ? "d" : "i"}\u0000${tex}`;
        if (entries.has(key)) continue;
        try {
          entries.set(key, render(tex, display));
        } catch (err) {
          this.error(`math-svgs: failed to render ${JSON.stringify(tex)}: ${err?.message ?? err}`);
        }
      }
      const body = [...entries.entries()]
        .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
        .join(",\n");
      return `export const mathSvgs = {\n${body},\n};\n`;
    },
    handleHotUpdate(ctx) {
      if (ctx.file.endsWith(".tsx") || ctx.file.endsWith(".ts")) {
        const mod = ctx.server.moduleGraph.getModuleById("\0" + VIRTUAL_ID);
        if (mod) {
          ctx.server.moduleGraph.invalidateModule(mod);
          return [...ctx.modules, mod];
        }
      }
    },
  };
}
