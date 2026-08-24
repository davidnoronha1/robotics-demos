# Browser Robotics Demos

Interactive perception and planning demos running entirely in your browser — no backend, no video upload.

Live: https://robotics-demos.pages.dev/

| # | Demo | Status | What it shows |
|---|------|--------|---------------|
| 1 | Value iteration on gridworld | coming soon | DP solving an MDP, heatmap + policy |
| 2 | Camera model + distortion | coming soon | Pinhole + Brown–Conrady, undistortion is iterative |
| 3 | [IMU attitude estimation](/demos/imu/) | **live** | Gyro / accel / mag fusion (complementary + editable EKF) from real phone sensors or physics sim |
| 4 | Configuration space | coming soon | 2-link arm, C-space bitmap morphs live |
| 5 | Particle filter + SLAM | coming soon | Kidnapping + relocalization, likelihood field |
| 6 | [Webcam feature tracking](/demos/opticalflow/) | **live** | FAST / Shi–Tomasi + ORB + pyramidal Lucas–Kanade on your camera feed |
| 7 | [NVIDIA robotics map](/nvidia-graph/) | **live** | 250+ Isaac / GR00T / Cosmos / Jetson repos as an interactive graph |

## Stack

Vite 5 + Preact + TypeScript. Per-demo extras: `three` + hand-rolled integrator for IMU 3D, `uPlot` for plots, `CodeMirror` for editable fusion code, build-time `mathjax-full` for math, `Cytoscape` + `fcose` for the graph, `@ternlight` WASM for on-device semantic search.

## Getting started

```bash
bun install        # or npm install
bun run dev        # http://localhost:5173
bun run build      # -> dist/ (multi-entry: /, /demos/imu/, /demos/opticalflow/, /nvidia-graph/)
bun run preview
```

Requires Node 18+ / Bun 1+.

## NVIDIA graph data

The graph at `/nvidia-graph/` is static — data is fetched at build time and committed to `src/nvidia-graph/projects.data.json`.

```bash
# needs GITHUB_TOKEN for >60 req/hr (put in .env, gitignored)
# .env is never committed - see .env.example pattern
GITHUB_TOKEN=github_pat_... bun run fetch:projects
bun run fetch:projects -- --limit 20   # cap README fetches

# helpers
bun run dump:manifest       # config -> nvidia-projects-manifest.csv
bun run apply:manifest      # csv -> nvidia-projects.config.ts
bun run generate:embeddings # Ternlight embeddings -> src/nvidia-graph/embeddings.json
```

Tuning: edit `nvidia-projects.config.ts` (orgs, keywords, allowlist, domains, edges).

## Project structure

```
index.html                      landing / demo list
demos/imu/index.html           \
demos/opticalflow/index.html    vite multi-entry inputs
nvidia-graph/index.html        /
src/demos/imu/                  IMU demo (physics, estimators, EKF, plots)
src/demos/opticalflow/          optical flow (FAST, Shi-Tomasi, ORB, LK)
src/nvidia-graph/               graph (cytoscape, panel, search)
src/shared/                     simLoop, canvas, plots, QR, UI kit
src/vendor/styles/              vendored site theme
scripts/fetch-nvidia-projects.ts  GitHub API fetcher
nvidia-projects.config.ts       curated manifest for the graph
wrangler.toml                   Cloudflare Pages config
```

## Deploy

Push to `main` deploys via `.github/workflows/deploy.yml` (Cloudflare Pages, `wrangler-action` with `secrets.CLOUDFLARE_API_TOKEN`).

Manual: `bun run build && npx wrangler pages deploy dist --project-name=robotics-demos`

## License

No license file yet — treat as all rights reserved until one is added.
