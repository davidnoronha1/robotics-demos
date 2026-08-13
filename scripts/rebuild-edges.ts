/**
 * Rebuilds only the `edges` array in projects.data.json from
 * nvidia-projects.config.ts, without touching node metadata and without
 * calling the GitHub API. Mirrors the edge-building step of
 * fetch-nvidia-projects.ts exactly (curated edges + auto partOf-by-org).
 *
 * Use this after `apply:manifest` when you just want the graph's
 * connections to reflect a manifest edit — `fetch:projects` does the same
 * plus a full metadata refresh, which needs GITHUB_TOKEN for a set this
 * size (300+ repos blows through the unauthenticated 60/hr limit).
 *
 * Usage: bun run rebuild:edges
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../nvidia-projects.config.ts";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = resolve(rootDir, "src/nvidia-graph/projects.data.json");

interface NodeData {
  id: string;
  repo?: string;
}
interface EdgeData {
  source: string;
  target: string;
  type: string;
  score?: number;
}
interface DataFile {
  generatedAt: string;
  nodes: NodeData[];
  edges: EdgeData[];
}

const data = JSON.parse(readFileSync(dataFile, "utf8")) as DataFile;

const edges: EdgeData[] = [];
const edgeKey = new Set<string>();
const addEdge = (source: string, target: string, type: string, score?: number) => {
  const k = `${source}->${target}:${type}`;
  if (edgeKey.has(k)) return;
  edgeKey.add(k);
  edges.push({ source, target, type, score });
};

for (const n of data.nodes) {
  if (!n.repo) continue;
  const umbrella = config.orgProducts[n.repo.split("/")[0]!];
  if (umbrella) addEdge(n.repo, umbrella, "partOf", 0.4);
}
for (const e of config.edges) addEdge(e.source, e.target, e.type, e.score);

const known = new Set(data.nodes.map((n) => n.id));
const validEdges = edges.filter((e) => known.has(e.source) && known.has(e.target));

data.edges = validEdges;
data.generatedAt = new Date().toISOString();

writeFileSync(dataFile, JSON.stringify(data, null, 2) + "\n");
console.log(`Wrote ${validEdges.length} edges (${edges.length - validEdges.length} dropped for missing nodes)`);
