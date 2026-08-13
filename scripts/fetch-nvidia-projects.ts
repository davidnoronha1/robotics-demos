/**
 * Build-time fetcher for the NVIDIA robotics graph.
 *
 * Reads nvidia-projects.config.ts, pulls repo metadata + READMEs from the
 * GitHub API, and writes src/nvidia-graph/projects.data.json. That file is
 * committed to git so the page renders statically; this script just refreshes
 * it. On a fatal API error it exits non-zero WITHOUT overwriting the existing
 * data file (the committed copy keeps serving).
 *
 * Usage:
 *   bun run fetch:projects                 # full refresh (needs GITHUB_TOKEN for big sets)
 *   bun run fetch:projects -- --limit 20   # cap README fetches (dry run)
 *
 * Auth: reads GITHUB_TOKEN from the environment or from a root .env file.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config, minAutoStars } from "../nvidia-projects.config.ts";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = resolve(rootDir, "src/nvidia-graph/projects.data.json");
const envFile = resolve(rootDir, ".env");
const apiBase = "https://api.github.com";

// ---- env / token ----------------------------------------------------------

function loadEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(envFile)) return out;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/i);
    if (!m) continue;
    let val = m[2]!.trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[m[1]!] = val;
  }
  return out;
}

const token = process.env.GITHUB_TOKEN ?? loadEnv().GITHUB_TOKEN;
const hasToken = Boolean(token);

// ---- github api -----------------------------------------------------------

let apiCalls = 0;

async function gh<T>(path: string, opts: { raw?: boolean } = {}): Promise<T | null> {
  apiCalls += 1;
  const res = await fetch(`${apiBase}${path}`, {
    headers: {
      Accept: opts.raw
        ? "application/vnd.github.raw+json"
        : "application/vnd.github+json, application/vnd.github.mercy-preview+json",
      "User-Agent": "nvidia-robotics-graph-fetcher",
      ...(hasToken ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 429) {
    const retryAfter = res.headers.get("retry-after");
    const wait = retryAfter ? Number(retryAfter) * 1000 : 60_000;
    const msg = hasToken
      ? "rate limited (403/429) — will retry"
      : "rate limited (403/429). Pass GITHUB_TOKEN in .env to raise the 60/hr public limit";
    console.warn(`[warn] ${path}: ${msg}, retrying in ${Math.round(wait / 1000)}s`);
    await new Promise((r) => setTimeout(r, wait));
    return gh<T>(path, opts);
  }
  if (!res.ok) {
    throw new Error(`${path}: HTTP ${res.status} ${res.statusText}`);
  }

  const remaining = res.headers.get("x-ratelimit-remaining");
  if (remaining && Number(remaining) < 20) {
    console.warn(`[warn] GitHub rate limit running low: ${remaining} remaining`);
  }

  if (opts.raw) return (await res.text()) as unknown as T;
  return (await res.json()) as T;
}

interface GhRepo {
  full_name: string;
  name: string;
  description: string | null;
  html_url: string;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  license: { spdx_id: string | null } | null;
  topics: string[];
  archived: boolean;
  fork: boolean;
  default_branch: string;
  pushed_at: string | null;
}

async function orgRepos(org: string): Promise<GhRepo[]> {
  const all: GhRepo[] = [];
  for (let page = 1; page <= 20; page++) {
    const pageRepos = await gh<GhRepo[]>(`/orgs/${org}/repos?type=public&per_page=100&page=${page}`);
    if (!pageRepos || pageRepos.length === 0) break;
    all.push(...pageRepos);
    if (pageRepos.length < 100) break;
  }
  return all;
}

async function singleRepo(fullName: string): Promise<GhRepo | null> {
  return gh<GhRepo>(`/repos/${fullName}`);
}

async function readme(fullName: string): Promise<string | null> {
  const raw = await gh<string>(`/repos/${fullName}/readme`, { raw: true });
  return raw ?? null;
}

// ---- filtering & classification ------------------------------------------

const excludeSet = new Set(config.exclude.map((s) => s.toLowerCase()));
const includeSet = new Set(config.include.map((s) => s.toLowerCase()));

function isExcluded(r: GhRepo): boolean {
  const full = r.full_name.toLowerCase();
  if (excludeSet.has(full)) return true;
  if (excludeSet.has(r.name.toLowerCase())) return true;
  if (r.name.toLowerCase() === ".github") return true;
  if (/\.github\.io$/.test(r.name.toLowerCase())) return true;
  return false;
}

function matchesKeywords(r: GhRepo): boolean {
  const hay = [r.name, r.description ?? "", ...r.topics].join(" ").toLowerCase();
  return config.includeKeywords.some((k) => hay.includes(k.toLowerCase()));
}

function scoreDomain(r: { full_name: string; name: string; description: string | null; topics: string[] }): string {
  const override = config.domainOverrides[r.full_name];
  if (override) return override;
  const hay = [r.name, r.description ?? "", ...r.topics].join(" ").toLowerCase();
  let best: string | null = null;
  let bestScore = 0;
  for (const d of config.domains) {
    const score = d.keywords.reduce(
      (acc, k) => (hay.includes(k.toLowerCase()) ? acc + k.length : acc),
      0,
    );
    if (score > bestScore) {
      bestScore = score;
      best = d.id;
    }
  }
  return best ?? "data";
}

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

function makeSummary(r: GhRepo, readmeText: string | null): string {
  if (readmeText) {
    const lead = stripMarkdown(readmeText);
    if (lead.length > 30) return lead.slice(0, config.summaryMaxChars);
  }
  return (r.description ?? "").slice(0, config.summaryMaxChars);
}

// ---- main -----------------------------------------------------------------

interface NodeData {
  id: string;
  label: string;
  domain: string;
  repo?: string;
  url?: string;
  homepage?: string;
  defaultBranch?: string;
  description?: string;
  summary: string;
  stars?: number;
  forks?: number;
  language?: string | null;
  license?: string | null;
  topics?: string[];
  archived?: boolean;
  readme?: string;
  manual?: boolean;
}

interface EdgeData {
  source: string;
  target: string;
  type: string;
  score?: number;
}

interface DataFile {
  generatedAt: string;
  source: string;
  domains: { id: string; label: string; color: string }[];
  nodes: NodeData[];
  edges: EdgeData[];
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const readmeLimit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;

  console.log(`Fetching NVIDIA robotics projects${hasToken ? " (authenticated)" : " (NO TOKEN — READMEs only for the allowlist)"}`);

  const repoById = new Map<string, GhRepo>();

  // 1. Scan orgs.
  for (const { org, includeAll } of config.orgs) {
    let repos: GhRepo[];
    try {
      repos = await orgRepos(org);
    } catch (err) {
      console.warn(`[warn] org scan failed for "${org}": ${(err as Error).message} — skipping`);
      continue;
    }
    const picked = repos.filter((r) => {
      if (r.fork || isExcluded(r)) return false;
      if (includeAll) return true;
      if (includeSet.has(r.full_name.toLowerCase())) return true;
      return matchesKeywords(r) && r.stargazers_count >= minAutoStars;
    });
    for (const r of picked) repoById.set(r.full_name.toLowerCase(), r);
    console.log(`  ${org}: ${repos.length} repos -> ${picked.length} kept`);
  }

  // 2. Fetch allowlist entries that didn't come from an org scan. GitHub
  //    follows renames (e.g. NVIDIA-Omniverse/orbit -> isaac-sim/IsaacLab), so
  //    key by the repo's returned full_name to collapse redirects onto one id.
  for (const fullName of config.include) {
    const r = await singleRepo(fullName);
    if (!r || r.fork || isExcluded(r)) continue;
    const canonical = r.full_name.toLowerCase();
    if (repoById.has(canonical)) continue;
    repoById.set(canonical, r);
  }

  if (repoById.size === 0) {
    throw new Error("no repos collected — check the org list / token");
  }

  // 3. READMEs (parallel, capped). Without a token only fetch allowlist ones.
  const fetchReadmeFor = (full: string) =>
    hasToken || includeSet.has(full.toLowerCase());
  const keys = [...repoById.keys()];
  const pending = keys.filter((k) => fetchReadmeFor(repoById.get(k)!.full_name));
  const readmeByKey = new Map<string, string | null>();
  const concurrency = 6;
  let cursor = 0;
  let readmesFetched = 0;
  const workers = Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
    while (cursor < pending.length) {
      const key = pending[cursor++];
      const full = repoById.get(key)!.full_name;
      if (readmesFetched >= readmeLimit) {
        readmeByKey.set(key, null);
        continue;
      }
      try {
        const md = await readme(full);
        readmeByKey.set(key, md ? md.slice(0, config.readmeMaxBytes) : null);
        readmesFetched += 1;
      } catch (err) {
        console.warn(`[warn] readme failed for ${full}: ${(err as Error).message}`);
        readmeByKey.set(key, null);
      }
    }
  });
  await Promise.all(workers);
  const missing = pending.length - readmesFetched;
  if (missing > 0) console.log(`  fetched ${readmesFetched} READMEs${missing ? ` (${missing} skipped by --limit / no-token fallback)` : ""}`);

  // 4. Build nodes.
  const nodes: NodeData[] = config.manual.map((m) => ({
    id: m.id,
    label: m.label,
    domain: m.domain,
    homepage: m.homepage,
    description: m.description,
    summary: m.description.slice(0, config.summaryMaxChars),
    manual: true,
  }));

  for (const [key, r] of repoById) {
    const readmeText = readmeByKey.get(key) ?? null;
    nodes.push({
      id: r.full_name,
      label: r.name,
      domain: scoreDomain(r),
      repo: r.full_name,
      url: r.html_url,
      homepage: r.homepage ?? undefined,
      defaultBranch: r.default_branch,
      description: r.description ?? undefined,
      summary: makeSummary(r, readmeText),
      stars: r.stargazers_count,
      forks: r.forks_count,
      language: r.language,
      license: r.license?.spdx_id ?? null,
      topics: r.topics,
      archived: r.archived || undefined,
      readme: readmeText ?? undefined,
    });
  }

  // 5. Build edges (curated + auto partOf by org).
  const edges: EdgeData[] = [];
  const edgeKey = new Set<string>();
  const addEdge = (source: string, target: string, type: string, score?: number) => {
    const k = `${source}->${target}:${type}`;
    if (edgeKey.has(k)) return;
    edgeKey.add(k);
    edges.push({ source, target, type, score });
  };
  for (const r of repoById.values()) {
    const umbrella = config.orgProducts[r.full_name.split("/")[0]];
    // Auto org->umbrella edges aren't manifest-scored. Some orgs (e.g.
    // NVIDIA-AI-IOT, NVIDIA-ISAAC-ROS) have 60-90 repos all pointing at one
    // umbrella node — a strong score here pulls all of them into a dense
    // hub-and-spoke clump, so keep it moderate rather than "strong".
    if (umbrella) addEdge(r.full_name, umbrella, "partOf", 0.4);
  }
  for (const e of config.edges) addEdge(e.source, e.target, e.type, e.score);

  // Drop edges referencing missing nodes.
  const known = new Set(nodes.map((n) => n.id));
  const validEdges = edges.filter((e) => known.has(e.source) && known.has(e.target));

  const data: DataFile = {
    generatedAt: new Date().toISOString(),
    source: "github-api",
    domains: config.domains.map(({ id, label, color }) => ({ id, label, color })),
    nodes,
    edges: validEdges,
  };

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(data, null, 2) + "\n");
  console.log(`\nWrote ${outFile}`);
  console.log(`  ${nodes.length} nodes (${nodes.length - config.manual.length} repos, ${config.manual.length} manual products)`);
  console.log(`  ${validEdges.length} edges`);
  console.log(`  ${apiCalls} GitHub API calls`);

  warnAboutUnmanifestedProjects(nodes.map((n) => n.id));
}

// Reminds you to add newly-fetched projects to the manifest CSV so they get
// curated relatedTo edges instead of sitting unconnected in the graph.
function warnAboutUnmanifestedProjects(nodeIds: string[]): void {
  const manifestFile = resolve(dirname(fileURLToPath(import.meta.url)), "..", "nvidia-projects-manifest.csv");
  if (!existsSync(manifestFile)) return;

  const manifestIds = new Set<string>();
  for (const rawLine of readFileSync(manifestFile, "utf8").split("\n")) {
    const line = rawLine.split("#")[0]!.trim();
    if (!line) continue;
    const id = line.split(",")[0]!.trim();
    if (id) manifestIds.add(id);
  }

  const newIds = nodeIds.filter((id) => !manifestIds.has(id));
  if (newIds.length === 0) return;

  console.log(`\n⚠ ${newIds.length} project(s) not yet in nvidia-projects-manifest.csv (no curated edges):`);
  for (const id of newIds) console.log(`  - ${id}`);
  console.log("  Run: bun run dump:manifest, edit the new rows' related-id/score pairs, then bun run apply:manifest && bun run fetch:projects");
}

main().catch((err) => {
  console.error(`[error] ${(err as Error).message}`);
  console.error("Leaving the existing projects.data.json untouched.");
  process.exit(1);
});