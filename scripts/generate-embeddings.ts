import projectsData from "../src/nvidia-graph/projects.data.json";
import * as fs from "fs";
import * as path from "path";

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

const SYNONYMS = [
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

export function expandText(text: string): string {
  const textLower = text.toLowerCase();
  const matchedExpansions: string[] = [];
  for (const entry of SYNONYMS) {
    if (entry.keywords.some((k) => textLower.includes(k))) {
      matchedExpansions.push(entry.expansion);
    }
  }
  return text + (matchedExpansions.length ? " " + matchedExpansions.join(" ") : "");
}

function getNodeText(n: (typeof projectsData.nodes)[0]): string {
  const parts: string[] = [];
  if (n.label) parts.push(`Project: ${n.label}`);
  if (n.domain) parts.push(`Domain: ${n.domain}`);
  if (n.description) parts.push(`Description: ${n.description}`);
  if (n.summary) parts.push(`Summary: ${n.summary}`);
  if ("topics" in n && Array.isArray(n.topics) && n.topics.length) {
    parts.push(`Topics: ${n.topics.join(", ")}`);
  }
  const raw = parts.join(". ");
  return expandText(raw);
}

async function fetchBatchEmbeddings(texts: string[], maxRetries = 3): Promise<number[][]> {
  const url = "https://integrate.api.nvidia.com/v1/embeddings";
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NVIDIA_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "nvidia/nemotron-3-embed-1b",
          input: texts,
          input_type: "passage",
          encoding_format: "float",
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText}`);
      }

      const json = (await res.json()) as { data: { embedding: number[] }[] };
      return json.data.map((item) => item.embedding);
    } catch (err) {
      console.warn(`[Batch] Attempt ${attempt}/${maxRetries} failed:`, err);
      if (attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
  throw new Error("Failed to fetch embeddings after retries");
}

async function main() {
  if (!NVIDIA_API_KEY) {
    throw new Error("Set NVIDIA_API_KEY to generate embeddings.");
  }
  console.log(`Starting embedding generation using nvidia/nemotron-3-embed-1b for ${projectsData.nodes.length} nodes...`);
  const BATCH_SIZE = 25;
  const embeddingsMap: Record<string, number[]> = {};
  const startTime = Date.now();

  const nodes = projectsData.nodes;
  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const chunk = nodes.slice(i, i + BATCH_SIZE);
    const chunkTexts = chunk.map((n) => getNodeText(n));
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(nodes.length / BATCH_SIZE);

    process.stdout.write(`Batch ${batchNum}/${totalBatches} (${chunk.length} items)... `);
    const batchStart = Date.now();
    const vectors = await fetchBatchEmbeddings(chunkTexts);
    const elapsed = Date.now() - batchStart;

    chunk.forEach((node, idx) => {
      const vec = vectors[idx];
      if (vec) {
        // Round to 4 decimal places to keep JSON compact (~3.7 MB)
        embeddingsMap[node.id] = vec.map((v) => Math.round(v * 10000) / 10000);
      }
    });

    console.log(`done in ${elapsed}ms (${Object.keys(embeddingsMap).length}/${nodes.length} complete)`);
  }

  const outputPath = path.resolve(process.cwd(), "src/nvidia-graph/embeddings.json");
  fs.writeFileSync(outputPath, JSON.stringify(embeddingsMap));
  const fileSizeMb = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
  const totalElapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\nSuccessfully wrote ${Object.keys(embeddingsMap).length} embeddings to ${outputPath}`);
  console.log(`File size: ${fileSizeMb} MB, Total time: ${totalElapsedSec}s`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
