import { readFileSync, writeFileSync } from "fs";
import * as path from "path";

const rootDir = path.resolve(__dirname, "..");
const dataFile = path.resolve(rootDir, "src/nvidia-graph/projects.data.json");

interface CudaRepoDef {
  id: string;
  label: string;
  domain: string;
  customDesc?: string;
  customSummary?: string;
  extraTopics?: string[];
}

const CUDA_LIBRARIES: CudaRepoDef[] = [
  {
    id: "NVIDIA-AI-IOT/cuPCL",
    label: "cuPCL",
    domain: "hardware",
    customDesc: "CUDA-accelerated Point Cloud Library (ICP, voxel grid, pass-through filter, RANSAC, euclidean clustering, PointPillars, BEVFusion)",
    customSummary: "cuPCL is NVIDIA's CUDA-accelerated Point Cloud Library for high-performance 3D point cloud processing, ICP alignment, voxel grid filtering, Euclidean cluster extraction, and 3D LiDAR perception on NVIDIA GPUs and Jetson platforms.",
    extraTopics: ["cupcl", "pcl", "pointcloud", "point-cloud", "icp", "clustering", "lidar", "jetson", "cuda", "nvidia"],
  },
  {
    id: "NVIDIA/cuOpt-resources",
    label: "cuOpt",
    domain: "learning",
    customDesc: "NVIDIA cuOpt: GPU-accelerated decision optimization, vehicle routing (VRP), logistics, and combinatorial task optimization solver",
    customSummary: "NVIDIA cuOpt is a GPU-accelerated decision optimization engine for solving complex vehicle routing (VRP), logistics, and combinatorial path/task planning problems at scale.",
    extraTopics: ["cuopt", "vrp", "vehicle-routing", "optimization", "logistics", "path-planning", "cuda"],
  },
  {
    id: "rapidsai/cuspatial",
    label: "cuSpatial",
    domain: "hardware",
    customDesc: "CUDA-accelerated GIS, spatial data management, trajectory analytics, and 3D spatial indexing",
    customSummary: "cuSpatial is a RAPIDS GPU library providing CUDA-accelerated GIS operations, spatial indexing, distance computations, and trajectory analytics for spatial data.",
    extraTopics: ["cuspatial", "spatial", "gis", "trajectory", "geometry", "cuda", "rapids"],
  },
  {
    id: "rapidsai/cusignal",
    label: "cuSignal",
    domain: "hardware",
    customDesc: "CUDA-accelerated Signal Processing GPU Library (FFT, filtering, beamforming, resampling)",
    customSummary: "cuSignal provides GPU-accelerated signal processing routines including FFT, filtering, polyphase resampling, and beamforming leveraging CUDA.",
    extraTopics: ["cusignal", "signal-processing", "fft", "filtering", "cuda", "rapids"],
  },
  {
    id: "NVIDIA/cutlass",
    label: "CUTLASS",
    domain: "hardware",
    customDesc: "CUDA Templates and Python DSLs for High-Performance Linear Algebra (GEMM, Convolution, Tensor Cores)",
    customSummary: "CUTLASS is a collection of CUDA C++ template abstractions and Python DSLs for implementing high-performance matrix-multiplication (GEMM) and linear algebra routines using Tensor Cores.",
    extraTopics: ["cutlass", "gemm", "tensor-cores", "linear-algebra", "cuda", "nvidia"],
  },
  {
    id: "NVIDIA/cccl",
    label: "CCCL",
    domain: "hardware",
    customDesc: "CUDA C++ Core Libraries (Thrust parallel algorithms, CUB GPU primitives, libcudacxx)",
    customSummary: "CUDA C++ Core Libraries (CCCL) provides high-performance GPU abstractions, parallel algorithms (Thrust), and block-level primitives (CUB) for CUDA developers.",
    extraTopics: ["cccl", "thrust", "cub", "cuda", "parallel-algorithms", "libcudacxx"],
  },
  {
    id: "NVIDIA/DALI",
    label: "DALI",
    domain: "data",
    customDesc: "NVIDIA Data Loading and Augmentation Library for GPU-accelerated data processing pipelines",
    customSummary: "NVIDIA DALI is a GPU-accelerated library containing highly optimized building blocks and an execution engine for image, video, and audio data processing pipelines.",
    extraTopics: ["dali", "data-loading", "augmentation", "image-processing", "cuda", "nvidia"],
  },
  {
    id: "NVIDIA/nvmath-python",
    label: "nvmath-python",
    domain: "hardware",
    customDesc: "NVIDIA Math Libraries for Python (cuFFT, cuBLAS, Tensor Cores, Matrix Factorization)",
    customSummary: "nvmath-python brings NVIDIA's high-performance CUDA Math Libraries (cuBLAS, cuFFT) directly to Python with NumPy and PyTorch interoperability.",
    extraTopics: ["nvmath", "cufft", "cublas", "python", "cuda", "nvidia"],
  },
  {
    id: "rapidsai/cugraph",
    label: "cuGraph",
    domain: "hardware",
    customDesc: "cuGraph: RAPIDS GPU-Accelerated Graph Analytics Library",
    customSummary: "cuGraph is a GPU-accelerated graph analytics library providing parallel algorithms for PageRank, shortest paths, BFS, and graph neural network primitives.",
    extraTopics: ["cugraph", "graph-analytics", "cuda", "rapids", "network-analysis"],
  },
  {
    id: "rapidsai/cudf",
    label: "cuDF",
    domain: "data",
    customDesc: "cuDF: GPU-Accelerated DataFrame Library for tabular data analytics",
    customSummary: "cuDF is a GPU DataFrame library providing a Pandas-like API for loading, filtering, joining, and manipulating tabular data on GPUs using CUDA.",
    extraTopics: ["cudf", "dataframe", "pandas", "cuda", "rapids", "data-analytics"],
  },
  {
    id: "rapidsai/rmm",
    label: "RMM",
    domain: "hardware",
    customDesc: "RAPIDS Memory Manager (RMM): Centralized CUDA Memory Allocation and Pool Management",
    customSummary: "RAPIDS Memory Manager (RMM) provides fast, customizable CUDA memory allocation, pooling, and memory management for GPU applications.",
    extraTopics: ["rmm", "memory-manager", "cuda", "rapids", "memory-pool"],
  },
  {
    id: "NVIDIA/cuda-samples",
    label: "CUDA Samples",
    domain: "hardware",
    customDesc: "Official CUDA Developer Code Samples demonstrating CUDA Toolkit capabilities and GPU acceleration",
    customSummary: "Official NVIDIA CUDA Developer Samples demonstrating GPU acceleration, CUDA API usage, matrix operations, and parallel computing techniques.",
    extraTopics: ["cuda-samples", "cuda", "gpu-computing", "samples", "nvidia"],
  },
  {
    id: "NVIDIA/CUDALibrarySamples",
    label: "CUDA Library Samples",
    domain: "hardware",
    customDesc: "Code samples for NVIDIA CUDA Libraries (cuBLAS, cuFFT, cuRAND, cuSOLVER, cuSPARSE, TensorRT)",
    customSummary: "NVIDIA CUDA Library Samples demonstrating usage of cuBLAS, cuFFT, cuRAND, cuSOLVER, cuSPARSE, and NPP libraries.",
    extraTopics: ["cuda-libraries", "cublas", "cufft", "cusparse", "cuda"],
  },
  {
    id: "NVIDIA/nvImageCodec",
    label: "nvImageCodec",
    domain: "hardware",
    customDesc: "GPU-accelerated image decoding and encoding codecs library",
    customSummary: "nvImageCodec is an NVIDIA library of GPU- and CPU-accelerated codecs for fast image decoding and encoding.",
    extraTopics: ["nvimagecodec", "image-codecs", "jpeg", "cuda", "nvidia"],
  },
];

async function run() {
  console.log("Fetching CUDA libraries metadata and READMEs...");

  const data = JSON.parse(readFileSync(dataFile, "utf8"));
  const existingMap = new Map(data.nodes.map((n: any) => [n.id, n]));

  let addedCount = 0;

  for (const item of CUDA_LIBRARIES) {
    try {
      const apiRes = await fetch(`https://api.github.com/repos/${item.id}`, {
        headers: { "User-Agent": "nvidia-robotics-graph-fetcher" },
      });

      if (!apiRes.ok) {
        console.warn(`[warn] Failed to fetch metadata for ${item.id}: ${apiRes.status}`);
        continue;
      }

      const repoData = await apiRes.json();

      let readme = "";
      for (const branch of [repoData.default_branch, "main", "master"]) {
        const rawRes = await fetch(`https://raw.githubusercontent.com/${item.id}/${branch}/README.md`);
        if (rawRes.ok) {
          readme = await rawRes.text();
          if (readme) break;
        }
      }

      const mergedTopics = Array.from(new Set([...(repoData.topics || []), ...(item.extraTopics || [])]));

      const newNode = {
        id: item.id,
        label: item.label,
        domain: item.domain,
        repo: item.id,
        url: repoData.html_url,
        homepage: repoData.homepage || undefined,
        defaultBranch: repoData.default_branch || "main",
        description: item.customDesc || repoData.description || "",
        summary: item.customSummary || `${item.label}: ${repoData.description || ""}`,
        stars: repoData.stargazers_count,
        forks: repoData.forks_count,
        language: repoData.language,
        license: repoData.license ? repoData.license.spdx_id : null,
        topics: mergedTopics,
        archived: repoData.archived || false,
        readme: readme.slice(0, 50000) || `# ${item.label}\n\n${item.customDesc || ""}\n\nGitHub: ${repoData.html_url}`,
      };

      existingMap.set(item.id, newNode);
      addedCount++;
      console.log(`[+] Processed ${item.id} (${repoData.stargazers_count} stars, README ${readme.length} chars)`);
    } catch (e) {
      console.error(`Error processing ${item.id}:`, e);
    }
  }

  data.nodes = Array.from(existingMap.values());
  writeFileSync(dataFile, JSON.stringify(data, null, 2));
  console.log(`\nUpdated projects.data.json — total nodes: ${data.nodes.length} (+${addedCount} added/updated).`);
}

run();
