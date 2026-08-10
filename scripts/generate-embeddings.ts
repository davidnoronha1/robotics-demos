import projectsData from "../src/nvidia-graph/projects.data.json";
import { embed } from "@ternlight/mini";
import * as fs from "fs";
import * as path from "path";

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

console.log("Generating embeddings for", projectsData.nodes.length, "nodes...");
const embeddingsMap: Record<string, number[]> = {};

for (const n of projectsData.nodes) {
  const rawText = `${n.label} ${n.description || ""} ${(n.topics || []).join(" ")} ${n.summary || ""}`;
  const expanded = expandText(rawText);
  const vec = Array.from(embed(expanded.slice(0, 300)));
  // Round to 4 decimal places to keep JSON compact (~790 KB)
  embeddingsMap[n.id] = vec.map((v) => Math.round(v * 10000) / 10000);
}

const outputPath = path.resolve(__dirname, "../src/nvidia-graph/embeddings.json");
fs.writeFileSync(outputPath, JSON.stringify(embeddingsMap));
console.log("Successfully wrote embeddings to", outputPath, `(${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB)`);
