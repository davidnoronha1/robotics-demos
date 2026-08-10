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
];

export function expandQuery(text: string): string {
  const textLower = text.toLowerCase().trim();
  const matchedExpansions: string[] = [];
  for (const entry of DOMAIN_SYNONYMS) {
    if (entry.keywords.some((k) => textLower.includes(k))) {
      matchedExpansions.push(entry.expansion);
    }
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

    // 2. Keyword & Substring Matching Boosts
    const labelLower = node.label.toLowerCase();
    const descLower = (node.description || "").toLowerCase();
    const summaryLower = (node.summary || "").toLowerCase();
    const topicsLower = (node.topics || []).map((t) => t.toLowerCase());

    if (labelLower === qClean) {
      score += 0.5;
    } else if (labelLower.includes(qClean)) {
      score += 0.35;
    } else if (descLower.includes(qClean) || summaryLower.includes(qClean)) {
      score += 0.2;
    } else if (topicsLower.some((t) => t.includes(qClean))) {
      score += 0.25;
    }

    // Include nodes with a positive score threshold
    if (score > 0.05) {
      results.push({ node: node as (typeof projectsData.nodes)[0], score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}
