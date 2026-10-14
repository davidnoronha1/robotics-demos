# Repository guide

## Purpose and stack

This repository contains interactive robotics and perception demos that run in
the browser. Camera frames and device sensor data are processed locally. There
is no application backend for demo processing.

- Vite 5 builds a multi-page site with Preact and TypeScript, targeting ES2022.
- Three.js renders the IMU scene; uPlot renders time-series plots.
- CodeMirror provides editable algorithm examples.
- KaTeX renders math through `src/shared/Math.tsx`. `MathTex.tsx` is a
  compatibility wrapper; the old build-time MathJax SVG plugin was removed.
- Cytoscape with the fcose layout powers the NVIDIA graph. Ternlight supplies
  browser-side WASM embeddings for search; committed project embeddings are
  generated separately using NVIDIA's embedding API.
- Cloudflare Workers serves the built static assets in `dist/`. The GitHub
  Actions workflow deploys on pushes to `main`.

Use source files, `package.json`, `vite.config.ts`, `wrangler.toml`, and
`.github/workflows/deploy.yml` as the source of truth. Some README statements
about math rendering, embeddings, deployment, and licensing are outdated.

## Architecture and file ownership

- `index.html`: landing page and demo links.
- `demos/<slug>/index.html`: each demo's HTML mount point and module entry.
- `src/demos/<slug>/page.tsx`: page shell, title, return links, Preact mounting,
  and hot-reload teardown.
- `src/demos/<slug>/App.tsx`: composition of the demo's UI.
- `src/demos/<slug>/components/`: focused visual sections and controls.
- `src/demos/<slug>/use*Demo.ts`: demo state, resource ownership, and lifecycle.
- Other demo-local modules: algorithms, controllers, sensor/video input,
  rendering, and editable source templates.
- `src/shared/`: reusable math, plots, code editor, simulation loop, canvas,
  pointer handling, visibility helpers, and UI controls.
- `src/style.css`: shared site and demo styles. `src/vendor/styles/` contains
  the vendored base theme; prefer local overrides over editing vendor files.
- `nvidia-graph/index.html` and `src/nvidia-graph/`: separate graph page with
  its own hook, components, styles, search, and detail panel.
- `scripts/`: data generation, asset tooling, and algorithm verification.

Keep algorithms independent of Preact and the DOM where practical. UI components
should compose controls and views; hooks/controllers should own mutable resources
and loops. Move code into `src/shared/` when there is actual reuse.

## Formatting and change conventions

- Match surrounding code: two-space indentation, double-quoted TypeScript
  strings, semicolons, and trailing commas in multiline structures. End new
  files with a newline. No formatter or linter command is currently configured.
- Use `.tsx` for JSX and `.ts` for logic. Use Preact imports and JSX `class`.
  Components and component files use PascalCase; hooks start with `use`;
  functions and variables use camelCase. Follow nearby module naming patterns.
- Keep TypeScript strict and handle possibly missing array entries;
  `noUncheckedIndexedAccess` is enabled. Prefer explicit types at module
  boundaries and avoid adding `any` or suppressing diagnostics.
- Keep changes scoped to the request. Preserve existing user edits and avoid
  unrelated formatting, generated-data churn, or dependency upgrades.
- Reuse shared UI controls, plots, and math helpers. Use `M`, `Math`, or
  `MathText` for equations; `String.raw` is useful for LaTeX backslashes.
- Keep controls accessible with labels, keyboard interaction, and semantic
  buttons. Preserve mobile layouts and light/dark theme support.
- Dispose every resource on unmount and hot reload: animation frames, event
  listeners, timers, observers, camera streams, editors, plots, and 3D/graph
  instances. Keep per-frame work out of Preact state updates where possible.
- Keep sensor/camera permissions user initiated and provide a usable simulated
  or bundled-data fallback where relevant. Never upload user camera/sensor data
  as part of normal demo operation.
- Keep credentials in environment variables, never source or client bundles.
  `.env` files are ignored. Do not expose API keys through `VITE_*` variables.
- When changing dependencies, update the corresponding lockfile with the
  package manager used; CI installs with Bun. Do not hand-edit lockfiles.

## Adding a demo

1. Choose a stable slug and create `demos/<slug>/index.html`. Follow an existing
   demo's viewport, color-scheme, and stylesheet links; provide a unique root
   element and load `/src/demos/<slug>/page.tsx` as a module.
2. Create the matching source directory with `page.tsx`, `App.tsx`, focused
   components, and algorithm/controller modules. Use a lifecycle hook as the
   demo grows. Follow the existing page shell and hot-reload cleanup pattern.
3. Register the HTML file in `build.rollupOptions.input` in `vite.config.ts`.
   These pages use separate HTML entries rather than a client-side router.
4. Add or activate its link in the root `index.html` and update the README's
   demo list. Keep demo numbering and labels consistent across the index,
   page title, and documentation.
5. Reuse shared styles and helpers. Keep demo-specific assets in its directory
   and import assets through Vite. Add required dependencies only when existing
   tools cannot reasonably handle the task.
6. Provide clear defaults, reset/start/pause controls where useful, explanatory
   text, and a useful fallback for unavailable hardware. Clean up all resources.
7. Build and open the demo directly at `/demos/<slug>/`. Check controls, resizing,
   mobile layout, theme, fallback behavior, and navigating away/hot reloading.
   Add deterministic algorithm verification when it protects meaningful behavior.

## NVIDIA graph data

The graph runs from committed static JSON; it does not fetch GitHub project data
on each page load. Curated inputs live in `nvidia-projects.config.ts` and
`nvidia-projects-manifest.csv`.

- `bun run fetch:projects`: refresh project metadata/READMEs; `GITHUB_TOKEN`
  increases GitHub API limits.
- `bun run dump:manifest` / `bun run apply:manifest`: export/import the curated
  CSV manifest. Review which file is authoritative before running either.
- `bun run rebuild:edges`: regenerate curated graph edges.
- `bun run generate:embeddings`: regenerate project embeddings using NVIDIA's
  API; requires `NVIDIA_API_KEY` and makes external API calls.

Regenerate only when the task needs it and review resulting diffs. Keep project
IDs and embedding keys aligned. Query and project vectors must have matching
dimensions for cosine similarity; retain the lexical fallback for other cases.
Do not run generation scripts just to validate a UI change.

## Development and verification

- Install: `bun install` (CI's package manager); npm is also supported.
- Develop: `bun run dev` or `npm run dev`.
- Build: `bun run build` or `npm run build`; output is `dist/` (ignored).
- Preview the build: `bun run preview` or `npm run preview`.
- Type check: `./node_modules/.bin/tsc --noEmit`. Vite's build transpiles
  TypeScript but does not perform a complete type check.
- IMU algorithm changes: `npm run verify:imu`.
- Optical-flow algorithm changes:
  `./node_modules/.bin/tsx scripts/verify-optical-flow.ts`.
- Before committing, review `git diff` and run `git diff --check`. Run the build
  for code or dependency changes and applicable verification for affected
  algorithms. Documentation-only edits need a content/diff review.

For UI changes, exercise the affected interaction in a browser when available.
Report checks actually run and any failures or unverified behavior. Do not claim
a successful build proves numerical correctness or interaction quality. Do not
commit `dist/`, `node_modules/`, local environment files, or credentials. Pushes
to `main` trigger deployment; only commit/push when the user requests it.
