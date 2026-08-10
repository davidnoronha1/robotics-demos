/**
 * Dumps the current graph to a CSV manifest for hand-editing: one row per
 * project, `<id>,<related-id-1>,<score-1>,<related-id-2>,<score-2>,...`.
 * Score is a 0-1 relation strength that drives edge width/opacity and
 * layout pull in the graph UI (see edgeScore() in App.tsx).
 *
 * Delete a row to drop that project; edit its related-id/score pairs to
 * change which projects it's connected to and how strongly. Re-apply edits
 * with `bun run apply:manifest`, which rewrites `nvidia-projects.config.ts`
 * (`exclude` + `edges`) to match, then re-run `bun run fetch:projects`.
 *
 * Usage: bun run dump:manifest
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = resolve(rootDir, "src/nvidia-graph/projects.data.json");
const manifestFile = resolve(rootDir, "nvidia-projects-manifest.csv");

interface NodeData {
  id: string;
  label: string;
  domain: string;
  stars?: number;
}
interface EdgeData {
  source: string;
  target: string;
  type: string;
  score?: number;
}
interface DataFile {
  domains: { id: string; label: string }[];
  nodes: NodeData[];
  edges: EdgeData[];
}

const data = JSON.parse(readFileSync(dataFile, "utf8")) as DataFile;

// Default score for edges the fetch pipeline generated without one (curated
// dependsOn/partOf edges predating scoring, or auto org->umbrella edges).
function defaultScore(type: string): number {
  return type === "dependsOn" || type === "partOf" ? 0.8 : 0.4;
}

const related = new Map<string, Map<string, number>>();
for (const n of data.nodes) related.set(n.id, new Map());
for (const e of data.edges) {
  if (!related.has(e.source) || !related.has(e.target)) continue;
  const score = e.score ?? defaultScore(e.type);
  const a = related.get(e.source)!;
  const b = related.get(e.target)!;
  a.set(e.target, Math.max(a.get(e.target) ?? 0, score));
  b.set(e.source, Math.max(b.get(e.source) ?? 0, score));
}

const domainLabel = new Map(data.domains.map((d) => [d.id, d.label]));
const byDomain = new Map<string, NodeData[]>();
for (const n of data.nodes) {
  if (!byDomain.has(n.domain)) byDomain.set(n.domain, []);
  byDomain.get(n.domain)!.push(n);
}

const lines: string[] = [
  "# NVIDIA robotics graph manifest (CSV) — one row per project.",
  "# Format: <project-id>,<related-id-1>,<score-1>,<related-id-2>,<score-2>,...",
  "# score is a 0-1 relation strength (drives edge width/opacity/layout pull).",
  "# Delete a whole row to drop that project from the graph.",
  "# Edit the related-id/score pairs to add/remove/reweight connections (order does not matter).",
  "# project-id is the GitHub owner/repo, or the manual id for non-repo products",
  "# (isaac-sim, nvidia-omniverse, newton, nvidia-jetson, jetpack, isaac-ros, nvidia-halos, nvidia-isaac).",
  "# Everything after # on a row is a comment (stars/name, for reference) and is ignored on re-apply.",
  "#",
  "# After editing: bun run apply:manifest && bun run fetch:projects",
  "",
];

for (const [domainId, nodes] of [...byDomain.entries()].sort((a, b) =>
  (domainLabel.get(a[0]) ?? a[0]).localeCompare(domainLabel.get(b[0]) ?? b[0]),
)) {
  lines.push(`# === ${domainLabel.get(domainId) ?? domainId} ===`);
  nodes.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0));
  for (const n of nodes) {
    const rel = [...(related.get(n.id) ?? [])].sort((a, b) => a[0].localeCompare(b[0]));
    const pairs = rel.flatMap(([id, score]) => [id, String(score)]);
    const stars = n.stars != null ? ` ${n.stars}★` : "";
    lines.push([n.id, ...pairs].join(",") + `  #${stars} ${n.label}`);
  }
  lines.push("");
}

writeFileSync(manifestFile, lines.join("\n"));
console.log(`Wrote ${manifestFile}`);
console.log(`  ${data.nodes.length} projects, ${data.edges.length} edges`);
