import projectsData from "./projects.data.json";

export interface Domain {
  id: string;
  label: string;
  color: string;
}

export interface NodeData {
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

export interface EdgeData {
  source: string;
  target: string;
  type: string;
  score?: number;
}

export interface DataFile {
  generatedAt: string;
  source: string;
  domains: Domain[];
  nodes: NodeData[];
  edges: EdgeData[];
}

export const data = projectsData as unknown as DataFile;

export const nodesById = new Map(data.nodes.map((n) => [n.id, n]));
export const domainById = new Map(data.domains.map((d) => [d.id, d]));