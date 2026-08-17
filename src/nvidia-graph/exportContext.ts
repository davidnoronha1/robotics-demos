import { DataFile } from "./data";

export function buildContextMarkdown(data: DataFile): string {
  const lines: string[] = [];

  lines.push("# NVIDIA robotics graph — full project context");
  lines.push("");
  lines.push(
    `Generated from ${data.source ?? "the NVIDIA robotics graph"}${
      data.generatedAt ? ` on ${data.generatedAt}` : ""
    }. ${data.nodes.length} projects across ${data.domains.length} domains.`,
  );
  lines.push("");

  for (const domain of data.domains) {
    const nodes = data.nodes.filter((n) => n.domain === domain.id);
    if (nodes.length === 0) continue;

    lines.push(`## ${domain.label} (${nodes.length})`);
    lines.push("");

    for (const node of nodes) {
      lines.push(`### ${node.label}`);
      lines.push("");
      lines.push(`- id: \`${node.id}\``);
      if (node.repo) lines.push(`- repo: ${node.repo}`);
      if (node.url) lines.push(`- url: ${node.url}`);
      if (node.homepage) lines.push(`- homepage: ${node.homepage}`);
      if (node.stars != null) lines.push(`- stars: ${node.stars}`);
      if (node.forks != null) lines.push(`- forks: ${node.forks}`);
      if (node.language) lines.push(`- language: ${node.language}`);
      if (node.license) lines.push(`- license: ${node.license}`);
      if (node.archived) lines.push(`- archived: true`);
      if (node.topics && node.topics.length > 0) {
        lines.push(`- topics: ${node.topics.join(", ")}`);
      }
      lines.push("");

      const summary = node.summary || node.description;
      if (summary) {
        lines.push(summary);
        lines.push("");
      }

      if (node.readme) {
        lines.push("**README:**");
        lines.push("");
        lines.push(node.readme.trim());
        lines.push("");
      }

      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function downloadContextFile(data: DataFile): void {
  const markdown = buildContextMarkdown(data);
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "nvidia-robotics-graph-context.md";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
