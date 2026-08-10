# PLAN_NV — NVIDIA robotics graph page

Interactive graph of NVIDIA's robotics ecosystem: nodes are projects (Isaac Sim,
Isaac Lab, GR00T, Cosmos, Isaac ROS packages, Jetson/AI-IOT, NVlabs research…),
grouped into labeled domain clusters. Clicking a node opens a side panel with a
summary and the project's README. Data is fetched from the GitHub API at build
time and committed, so the page renders statically with no runtime API calls.

## Architecture

```
npm run fetch:projects            ──►  nvidia-projects.config.ts (curated manifest)
        │                                │
        │ GitHub API (token from .env)   │ orgs, keywords, allowlist, domains, edges
        ▼                                ▼
src/nvidia-graph/projects.data.json  (committed, static fallback)
        │
        ▼   imported at build time (Vite JSON import)
nvidia-graph/index.html ─► src/nvidia-graph/page.tsx ─► App.tsx
                                                          │  cytoscape (pan/zoom/compound clusters/layout)
                                                          ├── Panel.tsx        (click node → README drawer)
                                                          └── markdownToHtml.ts (safe markdown → DOM)
```

## Data pipeline

- **`nvidia-projects.config.ts`** (root) — the only file you tune. It declares:
  - `orgs`: GitHub orgs to scan. `includeAll` orgs (ISAAC-ROS, isaac-sim,
    NVIDIA-Cosmos) take every non-fork repo; others are keyword-filtered.
    Includes `triton-inference-server` for edge/cloud inference-serving repos.
  - `includeKeywords`: robotics terms plus video/edge-inference terms
    (deepstream, tensorrt, triton, video analytics, pose estimation, camera,
    computer vision, …) — a keyword-matched repo must also pass
    `minAutoStars` (50 ⭐) to keep tiny experiments off the map.
  - `include` / `exclude`: explicit owner/repo allow / skip lists.
  - `domains`: cluster id, label, color, scoring keywords (Simulation & Physics,
    Robot Learning, Foundation Models, Isaac ROS & Middleware, Jetson & Edge,
    Teleoperation & Motion, Data & Generative AI). "Jetson & Edge" also scores
    deepstream/tensorrt/triton/video-analytics terms.
  - `domainOverrides`: owner/repo → domain id, applied before keyword scoring
    in the fetch script (was declared but unused — wired up; used to pin
    Triton's inference-serving repos to the hardware/edge domain instead of
    whatever generic keyword happens to score highest).
  - `manual`: non-repo products on the map (Isaac Sim, AddOmniverse, Newton,
    Jetson, JetPack, Isaac ROS, Halos, Isaac umbrella).
  - `orgProducts`: org → umbrella `partOf` edges (auto).
  - `edges`: curated `dependsOn` / `relatedTo` / `partOf` edges.
- **`scripts/fetch-nvidia-projects.ts`** — run with `bun run fetch:projects`
  (invoked as `bun scripts/fetch-nvidia-projects.ts` — `tsx` fails to load
  under this Bun version, so the script runs directly under Bun's built-in TS
  support instead). Reads `GITHUB_TOKEN` from env or root `.env`. Per repo
  stores metadata (stars, forks, language, license, topics) + README (capped
  64 KB), and a plain-text summary (first ~500 chars of the README with
  markdown stripped).
  - Redirects: GitHub renames (e.g. `NVIDIA-Omniverse/orbit` → `isaac-sim/IsaacLab`)
    are collapsed by keying on the API's returned `full_name`.
  - On a fatal error it exits non-zero **without overwriting** the existing
    data file — the committed copy keeps serving.
  - No token → READMEs are fetched only for the allowlist (60/hr public limit).

## Graph UI

- **`src/nvidia-graph/App.tsx`** — creates the Cytoscape instance:
  - compound nodes (one per domain cluster) with the colored child nodes inside;
  - `cose` layout, colored by domain, built-in pan/zoom;
  - `tap` node → select; tap background → deselect; cluster tap → fly to it;
  - dims non-matching nodes while searching; zoom in/out/reset buttons;
  - `projects.data.json` imported statically.
- **`src/nvidia-graph/Panel.tsx`** — right-hand drawer: name, domain badge,
  archived tag, repo link, summary, stars/forks/language/license, GitHub +
  homepage buttons, topic chips, relation list, and the README.
- **`src/nvidia-graph/markdownToHtml.ts`** — tiny hand-rolled, safe subset
  (headings, paragraphs, code fences, inline code, links, images, lists, quotes,
  hr). Everything is HTML-escaped first; links/images restricted to http/https
  so README content can't inject scripts. Rendered as normal DOM so links,
  images and scrolling just work.
- **`src/nvidia-graph/style.css`** — full-screen standalone layout using the
  site's CSS variables (theme-aware light/dark).
- **`src/nvidia-graph/data.ts`** — types + typed accessors for the JSON.

## Integration

- `nvidia-graph/index.html` (bare mount point) wired into
  `rollupOptions.input` in `vite.config.ts` (entry `graph`).
- Link added to the root `index.html` as item 7 ("NVIDIA robotics map").
- `.env` now gitignored (token never committed).
- New deps: `cytoscape` (runtime), `@types/cytoscape` (dev), `fetch:projects`
  script in `package.json`.

## The graph as of generation

- 256 nodes (248 GitHub repos + 8 manual products), 129 edges, data fetched
  with the real GitHub token on 2026-08-10. Domains: Simulation & Physics,
  Robot Learning, Foundation Models, Isaac ROS & Middleware, Jetson & Edge,
  Teleoperation & Motion, Data & Generative AI.

## Verification

```sh
bun run fetch:projects          # refresh data (needs .env GITHUB_TOKEN)
bun x tsc --noEmit               # typecheck
bun run build                   # vite multi-entry build
bun run preview                 # live check of /nvidia-graph/
```

Verified: typecheck clean, `bun run build` succeeds, and a Playwright smoke
run against `bun run preview` confirms the graph mounts, search + node click
opens the README panel, and there are no console/page errors.

Optional next steps:
- Re-run `fetch:projects` periodically (or in CI) to refresh stars/READMEs.
- Code-split the graph bundle (`projects.data.json` import dominates the
  ~3.1 MB `graph` chunk) if load time on `/nvidia-graph/` becomes a concern.

## File map

```
nvidia-projects.config.ts            curated manifest (tune here)
PLAN_NV.md
scripts/fetch-nvidia-projects.ts     build-time fetcher
src/nvidia-graph/projects.data.json  generated data (committed)
src/nvidia-graph/data.ts             types + data access
src/nvidia-graph/App.tsx             cytoscape graph + toolbar/legend/search
src/nvidia-graph/Panel.tsx           node detail drawer (README)
src/nvidia-graph/markdownToHtml.ts   safe markdown renderer
src/nvidia-graph/style.css           full-screen layout
src/nvidia-graph/page.tsx            entry (Preact mount + HMR)
nvidia-graph/index.html              vite entry
```