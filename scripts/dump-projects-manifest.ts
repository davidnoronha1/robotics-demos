/**
 * Dumps the current graph to a CSV manifest for hand-editing (or for an LLM
 * to fill in): one row per project —
 *   <id>,<description>,<summary>,<readme-snippet>,<related-id-1>,<score-1>,<related-id-2>,<score-2>,...
 * The first four fields are read-only context (CSV-quoted since description/
 * summary/readme can contain commas or quotes); the related-id/score pairs
 * are the only part re-applied. Score is a 0-1 relation strength that drives
 * edge width/opacity and layout pull in the graph UI (see edgeScore() in
 * App.tsx).
 *
 * Delete a row to drop that project; edit its related-id/score pairs to
 * change which projects it's connected to and how strongly. Re-apply edits
 * with `bun run apply:manifest`, which rewrites `nvidia-projects.config.ts`
 * (`exclude` + `edges`) to match, then re-run `bun run fetch:projects`.
 *
 * Usage: bun run dump:manifest
 *        bun run dump:manifest:blank   (writes nvidia-projects-manifest-blank.csv
 *          instead — same rows, connections omitted — for handing to an LLM
 *          to fill in fresh, weighted connections for every project. Never
 *          overwrites the real manifest.)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = resolve(rootDir, "src/nvidia-graph/projects.data.json");
const blank = process.argv.includes("--blank");
// --blank writes to a separate file — it must never overwrite the real
// manifest and wipe out curated connections.
const manifestFile = resolve(rootDir, blank ? "nvidia-projects-manifest-blank.csv" : "nvidia-projects-manifest.csv");

interface NodeData {
  id: string;
  label: string;
  domain: string;
  stars?: number;
  description?: string;
  summary?: string;
  readme?: string;
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

const README_SNIPPET_LEN = 200;

const HTML_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  mdash: "—",
  ndash: "–",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code) => {
    if (code[0] === "#") {
      const cp = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return HTML_ENTITIES[code] ?? m;
  });
}

// Strips markdown/HTML noise (badges, images, links, headings, emphasis,
// inline code, tables) down to plain prose, so the manifest's context
// column reads as a sentence instead of raw badge/link soup. Mirrors
// stripMarkdown() in fetch-nvidia-projects.ts (used there for `summary`).
function stripMarkdown(md: string): string {
  return decodeEntities(
    md
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images/badges
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // inline links -> text
      .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1") // reference-style links -> text
      .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, " ") // reference-link definitions
      .replace(/https?:\/\/\S+/g, " ") // remaining bare urls
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/^>\s*/gm, "")
      .replace(/\|/g, " ")
      .replace(/[*_~]/g, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function readmeSnippet(readme?: string): string {
  if (!readme) return "";
  return stripMarkdown(readme).slice(0, README_SNIPPET_LEN);
}

// CSV-quote a field only when it needs it (contains a comma, quote, or newline).
function csvField(value: string): string {
  if (/[",\n]/.test(value)) return '"' + value.replace(/"/g, '""') + '"';
  return value;
}

const domainLabel = new Map(data.domains.map((d) => [d.id, d.label]));
const byDomain = new Map<string, NodeData[]>();
for (const n of data.nodes) {
  if (!byDomain.has(n.domain)) byDomain.set(n.domain, []);
  byDomain.get(n.domain)!.push(n);
}

const lines: string[] = [
  "# NVIDIA robotics graph manifest (CSV) — one row per project.",
  "# Format: <id>,<description>,<summary>,<readme-snippet>,<related-id-1>,<score-1>,<related-id-2>,<score-2>,...",
  "# The first 4 fields are read-only context (CSV-quoted); only the trailing",
  "# related-id/score pairs are re-applied by `apply:manifest`.",
  "# score is a 0-1 relation strength (drives edge width/opacity/layout pull).",
  "# Delete a whole row to drop that project from the graph.",
  "# Edit the trailing related-id/score pairs to add/remove/reweight connections (order does not matter).",
  "# project-id is the GitHub owner/repo, or the manual id for non-repo products",
  "# (isaac-sim, nvidia-omniverse, newton, nvidia-jetson, jetpack, isaac-ros, nvidia-halos, nvidia-isaac).",
  "# Only whole lines starting with # are comments — do not put # inside a row.",
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
    const context = [n.id, n.description ?? "", n.summary ?? "", readmeSnippet(n.readme)].map(csvField);
    const rel = blank ? [] : [...(related.get(n.id) ?? [])].sort((a, b) => a[0].localeCompare(b[0]));
    const pairs = rel.flatMap(([id, score]) => [id, String(score)]);
    lines.push([...context, ...pairs].join(","));
  }
  lines.push("");
}

writeFileSync(manifestFile, lines.join("\n"));
console.log(`Wrote ${manifestFile}${blank ? " (connections stripped)" : ""}`);
console.log(`  ${data.nodes.length} projects, ${data.edges.length} edges`);
