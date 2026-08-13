import projectsData from "./projects.data.json";
import rawEmbeddings from "./embeddings.json";

export interface NodeMatch {
  node: (typeof projectsData.nodes)[0];
  score: number;
}

const embeddings = rawEmbeddings as Record<string, number[]>;

// Robotics domain synonym & concept dictionary
const DOMAIN_SYNONYMS = [
  {
    keywords: ["aruco", "apriltag", "april tag", "fiducial", "tag marker", "marker tracking"],
    expansion: "aruco apriltag fiducial marker tag detection pose estimation visual tracking 2d barcode",
  },
  {
    keywords: ["slam", "vslam", "odometry", "visual odometry", "cuvslam"],
    expansion: "slam vslam visual odometry mapping localization tracking position estimation cuvslam",
  },
  {
    keywords: ["yolo", "retinanet", "object detection", "bounding box", "detector"],
    expansion: "object detection detector yolo retinanet bounding box vision perception",
  },
  {
    keywords: ["path planning", "motion planning", "cutamp", "trajectory", "nav2"],
    expansion: "path planning motion planning trajectory generation navigation cutamp swagger routing",
  },
  {
    keywords: ["robot arm", "manipulator", "manipulation", "kinematics", "cumotion"],
    expansion: "robot arm manipulator manipulation kinematics end effector cumotion",
  },
  {
    keywords: ["depth camera", "stereo", "disparity", "point cloud", "bi3d"],
    expansion: "depth camera stereo image disparity point cloud 3d vision bi3d",
  },
  {
    keywords: ["reinforcement learning", "rl", "gym", "isaac gym", "omniisaacgymenvs"],
    expansion: "reinforcement learning rl gym policy training omniisaacgymenvs",
  },
  {
    keywords: ["imu", "accelerometer", "gyroscope", "sensor fusion"],
    expansion: "imu accelerometer gyroscope sensor fusion orientation state estimation",
  },
  {
    keywords: ["lidar", "pointcloud", "point cloud"],
    expansion: "lidar point cloud range sensor 3d scanning velodyne hesai",
  },
  {
    keywords: ["humanoid", "biped", "locomotion"],
    expansion: "humanoid biped robot locomotion whole body control teleoperation",
  },
  {
    keywords: ["simulation", "isaac sim", "omniverse", "digital twin"],
    expansion: "simulation isaac sim omniverse digital twin physics engine warp",
  },
  {
    keywords: ["cupcl", "pcl", "point cloud", "pointcloud", "icp", "clustering"],
    expansion: "cupcl pcl point cloud 3d lidar icp voxel filter segmentation clustering pointpillars bevfusion",
  },
  {
    keywords: ["cuopt", "vrp", "vehicle routing", "logistics"],
    expansion: "cuopt vehicle routing vrp logistics optimization solver route planning combinatorial",
  },
  {
    keywords: ["cuspatial", "spatial", "gis", "trajectory analytics"],
    expansion: "cuspatial spatial gis trajectory analytics spatial index geometry distance",
  },
  {
    keywords: ["cusignal", "signal processing", "beamforming"],
    expansion: "cusignal signal processing fft filter beamforming spectrogram wave",
  },
  {
    keywords: ["cutlass", "gemm", "linear algebra"],
    expansion: "cutlass gemm matrix multiplication tensor core linear algebra cuda template",
  },
  {
    keywords: ["cccl", "thrust", "cub", "libcudacxx"],
    expansion: "cccl thrust cub libcudacxx cuda parallel algorithms primitives core",
  },
  {
    keywords: ["dali", "data loading", "data augmentation"],
    expansion: "dali data loading augmentation image decoding pipeline execution engine",
  },
];

// --- Fuzzy matching helpers (typo tolerance for the lexical half of search) ---

const FUZZY_MIN_QUERY_LEN = 3;
const FUZZY_KEYWORD_THRESHOLD = 0.75;
const FUZZY_FIELD_THRESHOLD = 0.72;

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  return dp[n]!;
}

// Normalized similarity in [0, 1]; 1 means identical strings.
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

function tokenize(s: string): string[] {
  return s.split(/[^a-z0-9]+/i).filter(Boolean);
}

// Best similarity between `query` and any token in `tokens`, skipping tokens
// whose length is wildly different (cheap pre-filter, avoids O(n*m) DP on
// obviously-unrelated pairs).
function bestTokenSimilarity(query: string, tokens: string[]): number {
  let best = 0;
  for (const tok of tokens) {
    if (tok === query) return 1;
    const maxLen = Math.max(query.length, tok.length);
    if (Math.abs(query.length - tok.length) / maxLen > 0.5) continue;
    const sim = similarity(query, tok);
    if (sim > best) best = sim;
  }
  return best;
}

/**
 * Tiered text match: exact -> substring -> fuzzy (typo-tolerant token match).
 * Returns a score in roughly [0, exactWeight].
 */
function textScore(qClean: string, text: string, exactWeight: number, substrWeight: number, fuzzyWeight: number): number {
  if (!text) return 0;
  if (text === qClean) return exactWeight;
  if (text.includes(qClean)) return substrWeight;
  if (qClean.length < FUZZY_MIN_QUERY_LEN) return 0;
  const sim = bestTokenSimilarity(qClean, tokenize(text));
  return sim >= FUZZY_FIELD_THRESHOLD ? fuzzyWeight * sim : 0;
}

export function expandQuery(text: string): string {
  const textLower = text.toLowerCase().trim();
  const queryTokens = tokenize(textLower);
  const matchedExpansions: string[] = [];
  for (const entry of DOMAIN_SYNONYMS) {
    const hit = entry.keywords.some((k) => {
      if (textLower.includes(k)) return true;
      // Fuzzy-match single-word keywords against query tokens so typos
      // (e.g. "arcuo") still trigger the domain expansion.
      if (!k.includes(" ") && k.length >= FUZZY_MIN_QUERY_LEN) {
        return bestTokenSimilarity(k, queryTokens) >= FUZZY_KEYWORD_THRESHOLD;
      }
      return false;
    });
    if (hit) matchedExpansions.push(entry.expansion);
  }
  return text + (matchedExpansions.length ? " " + matchedExpansions.join(" ") : "");
}

// Dot product for L2-normalized vectors (equivalent to Cosine Similarity)
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const valA = a[i];
    const valB = b[i];
    if (valA !== undefined && valB !== undefined) {
      dot += valA * valB;
    }
  }
  return dot;
}

// Lazy loaded ternlight embed function
let embedFn: ((text: string) => Float32Array) | null = null;
let initPromise: Promise<void> | null = null;

export async function initTernlight(): Promise<void> {
  if (embedFn) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const tern = await import("@ternlight/mini");
      embedFn = tern.embed;
      console.log("Ternlight WASM initialized successfully.");
    } catch (err) {
      console.warn("Could not initialize Ternlight WASM engine, falling back to keyword search:", err);
    }
  })();

  return initPromise;
}

export function isTernlightReady(): boolean {
  return embedFn !== null;
}

export interface SemanticEdge {
  source: string;
  target: string;
  score: number;
}

const SEMANTIC_TOP_K = 4;
// Sanity floor only (observed best-match scores range ~0.37-1.0) — not tuned
// as a quality cutoff. A per-node absolute cutoff here would strand any
// project whose embedding just sits in a sparser part of the space (e.g.
// niche/deprecated repos), even though it still has a clear best match.
// Every node keeps its top-K neighbors regardless of how weak the best one is.
const SEMANTIC_MIN_SCORE = 0.3;

let cachedSemanticEdges: SemanticEdge[] | null = null;

/**
 * Derives a graph purely from Ternlight embedding similarity: each node's
 * top-K nearest neighbors above a similarity floor, deduped by unordered
 * pair (higher score wins when both sides qualify). Computed once and
 * cached — offers an alternative to the hand-curated manifest edges so you
 * can compare what the embeddings think is related vs what was curated.
 */
export function getSemanticEdges(): SemanticEdge[] {
  if (cachedSemanticEdges) return cachedSemanticEdges;

  const ids = Object.keys(embeddings);
  const pairScore = new Map<string, number>();

  for (const id of ids) {
    const vec = embeddings[id];
    if (!vec) continue;
    const neighbors: { id: string; score: number }[] = [];
    for (const otherId of ids) {
      if (otherId === id) continue;
      const otherVec = embeddings[otherId];
      if (!otherVec) continue;
      const score = cosineSimilarity(vec, otherVec);
      if (score >= SEMANTIC_MIN_SCORE) neighbors.push({ id: otherId, score });
    }
    neighbors.sort((a, b) => b.score - a.score);
    for (const n of neighbors.slice(0, SEMANTIC_TOP_K)) {
      const key = [id, n.id].sort().join("::");
      pairScore.set(key, Math.max(pairScore.get(key) ?? 0, n.score));
    }
  }

  cachedSemanticEdges = [...pairScore.entries()].map(([key, score]) => {
    const [source, target] = key.split("::") as [string, string];
    return { source, target, score };
  });
  return cachedSemanticEdges;
}

/**
 * Perform hybrid semantic search using Ternlight embeddings + domain concept expansion.
 */
export function searchProjects(query: string, maxResults = 12): NodeMatch[] {
  const qClean = query.trim().toLowerCase();
  if (!qClean) return [];

  const expanded = expandQuery(qClean);

  let qVec: number[] | null = null;
  if (embedFn) {
    try {
      qVec = Array.from(embedFn(expanded));
    } catch (e) {
      console.warn("Embedding query failed, falling back:", e);
    }
  }

  const results: NodeMatch[] = [];

  for (const node of projectsData.nodes) {
    let score = 0;
    const targetVec = embeddings[node.id];

    if (qVec && targetVec) {
      // 1. Semantic Cosine Similarity
      score = cosineSimilarity(qVec, targetVec);
    }

    // 2. Keyword, Substring & Fuzzy (typo-tolerant) Matching Boosts
    const labelLower = node.label.toLowerCase();
    const descLower = (node.description || "").toLowerCase();
    const summaryLower = (node.summary || "").toLowerCase();
    const topicsLower = (node.topics || []).map((t) => t.toLowerCase());

    const labelScore = textScore(qClean, labelLower, 0.5, 0.35, 0.3);
    const descScore = Math.max(textScore(qClean, descLower, 0.2, 0.2, 0.15), textScore(qClean, summaryLower, 0.2, 0.2, 0.15));
    let topicsScore = 0;
    for (const t of topicsLower) {
      topicsScore = Math.max(topicsScore, textScore(qClean, t, 0.25, 0.25, 0.2));
    }

    score += Math.max(labelScore, descScore, topicsScore);

    // Include nodes with a positive score threshold
    if (score > 0.05) {
      results.push({ node: node as (typeof projectsData.nodes)[0], score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}
