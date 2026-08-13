/**
 * Reads the hand-edited nvidia-projects-manifest.csv (see
 * dump-projects-manifest.ts) and rewrites nvidia-projects.config.ts to match:
 *   - a project row removed from the manifest -> added to config.exclude
 *     (repos) or dropped from config.manual (manual products).
 *   - each row's related-id/score pairs -> replaces config.edges entirely
 *     with scored "relatedTo" edges (dedup'd, unordered — when both sides of
 *     a pair give a score, the higher one wins). This manifest is the single
 *     source of truth for connections going forward, so previously curated
 *     dependsOn/partOf edges are not preserved.
 *
 * Run `bun run fetch:projects` afterward to regenerate projects.data.json
 * from the updated config.
 *
 * Usage: bun run apply:manifest
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../nvidia-projects.config.ts";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestFile = resolve(rootDir, "nvidia-projects-manifest.csv");
const dataFile = resolve(rootDir, "src/nvidia-graph/projects.data.json");
const configFile = resolve(rootDir, "nvidia-projects.config.ts");

interface ManifestEntry {
  id: string;
  related: { id: string; score: number }[];
}

// Quote-aware CSV row split (description/summary/readme context fields can
// contain commas, quotes, or "#" — a naive split(",") or split("#") would
// corrupt those).
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

// Leading context columns before the related-id/score pairs: id, description, summary, readme.
const CONTEXT_COLUMNS = 4;

function parseManifest(text: string): ManifestEntry[] {
  const entries: ManifestEntry[] = [];
  for (const rawLine of text.split("\n")) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) continue;
    const fields = parseCsvLine(rawLine).map((f) => f.trim());
    const id = fields[0];
    if (!id) continue;
    const rest = fields.slice(CONTEXT_COLUMNS).filter((f) => f.length > 0);
    const related: { id: string; score: number }[] = [];
    for (let i = 0; i < rest.length; i += 2) {
      const relId = rest[i]!;
      const scoreStr = rest[i + 1];
      const score = Number(scoreStr);
      if (scoreStr === undefined || !Number.isFinite(score)) {
        console.warn(`[warn] ${id}: related id "${relId}" has no valid score ("${scoreStr ?? ""}") — skipping`);
        continue;
      }
      if (score < 0 || score > 1) {
        console.warn(`[warn] ${id}: score ${score} for "${relId}" is outside 0-1 — keeping as-is`);
      }
      related.push({ id: relId, score });
    }
    entries.push({ id, related });
  }
  return entries;
}

const manifestEntries = parseManifest(readFileSync(manifestFile, "utf8"));
const keptIds = new Set(manifestEntries.map((e) => e.id));

interface DataFile {
  nodes: { id: string }[];
}
const data = JSON.parse(readFileSync(dataFile, "utf8")) as DataFile;
const originalIds = new Set(data.nodes.map((n) => n.id));

const removedIds = [...originalIds].filter((id) => !keptIds.has(id));
const manualIdSet = new Set(config.manual.map((m) => m.id));
const removedManualIds = removedIds.filter((id) => manualIdSet.has(id));
const removedRepoIds = removedIds.filter((id) => !manualIdSet.has(id));

// ---- scored relatedTo edges from the manifest, deduped by unordered pair ----
const pairScore = new Map<string, number>();
for (const entry of manifestEntries) {
  for (const rel of entry.related) {
    if (rel.id === entry.id) continue;
    if (!keptIds.has(rel.id)) {
      console.warn(`[warn] ${entry.id}: related id "${rel.id}" not found in manifest — skipping`);
      continue;
    }
    const key = [entry.id, rel.id].sort().join("::");
    pairScore.set(key, Math.max(pairScore.get(key) ?? 0, rel.score));
  }
}
const newEdges = [...pairScore.entries()].map(([key, score]) => {
  const [source, target] = key.split("::") as [string, string];
  return { source, target, type: "relatedTo" as const, score };
});

// ---- bracket/brace-aware text surgery on the config source ----
function findMatching(src: string, openIdx: number, open: string, close: string): number {
  let depth = 0;
  let inString: string | null = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i]!;
    if (inString) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inString = c;
      continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`no matching "${close}" found`);
}

function replaceArray(src: string, propName: string, items: string[]): string {
  const propRe = new RegExp(`${propName}\\s*:\\s*\\[`);
  const m = propRe.exec(src);
  if (!m) throw new Error(`property "${propName}" not found in config`);
  const openIdx = m.index + m[0].length - 1;
  const closeIdx = findMatching(src, openIdx, "[", "]");
  const body = items.length ? "\n" + items.map((s) => `    ${s},`).join("\n") + "\n  " : "";
  return src.slice(0, openIdx + 1) + body + src.slice(closeIdx);
}

function removeManualEntry(src: string, id: string): string {
  const arrayRe = /manual\s*:\s*\[/;
  const m = arrayRe.exec(src);
  if (!m) throw new Error(`"manual" array not found in config`);
  const arrayOpen = m.index + m[0].length - 1;
  const arrayClose = findMatching(src, arrayOpen, "[", "]");
  const idRe = new RegExp(`id\\s*:\\s*"${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`);
  const idMatch = idRe.exec(src.slice(arrayOpen, arrayClose));
  if (!idMatch) {
    console.warn(`[warn] manual id "${id}" not found in config.manual — skipping removal`);
    return src;
  }
  const idAbsIdx = arrayOpen + idMatch.index;
  const objOpen = src.lastIndexOf("{", idAbsIdx);
  const objClose = findMatching(src, objOpen, "{", "}");
  // Trim the object's trailing ", \n" (the separator before the next entry)
  // and its own leading indentation, but only ONE of the two newlines
  // bracketing it — otherwise prev/next entries end up mashed onto one line.
  let end = objClose + 1;
  while (src[end] === "," || src[end] === " ") end++;
  if (src[end] === "\n") end++;
  let start = objOpen;
  while (src[start - 1] === " ") start--;
  return src.slice(0, start) + src.slice(end);
}

let src = readFileSync(configFile, "utf8");

for (const id of removedManualIds) src = removeManualEntry(src, id);

const mergedExclude = [...new Set([...config.exclude, ...removedRepoIds])].sort();
src = replaceArray(src, "exclude", mergedExclude.map((s) => JSON.stringify(s)));

src = replaceArray(
  src,
  "edges",
  newEdges.map(
    (e) =>
      `{ source: ${JSON.stringify(e.source)}, target: ${JSON.stringify(e.target)}, type: "relatedTo", score: ${e.score} }`,
  ),
);

writeFileSync(configFile, src);

console.log(`Applied ${manifestFile}`);
console.log(`  ${removedRepoIds.length} repos newly excluded, ${removedManualIds.length} manual products removed`);
console.log(`  ${newEdges.length} relatedTo edges written`);
console.log("Now run: bun run fetch:projects");
