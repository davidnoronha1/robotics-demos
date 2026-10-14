import { data } from "../data";

interface GraphLegendProps {
  edgeMode: "curated" | "semantic";
}

export function GraphLegend({ edgeMode }: GraphLegendProps) {
  return (
    <div class="graph-legend">
      <details>
        <summary class="graph-legend-summary">
          <span class="graph-legend-title-wrap">
            <svg
              class="graph-legend-chevron"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span class="graph-legend-title">Legend</span>
          </span>
          <span class="graph-legend-badge">
            {edgeMode === "curated" ? `${data.domains.length} domains` : "Semantic Clusters"}
          </span>
        </summary>
        <ul class="graph-legend-list">
          {data.domains.map((d) => (
            <li key={d.id}>
              <span class="graph-domain-dot" style={`background: ${d.color}`} />
              <span>{d.label}</span>
            </li>
          ))}
        </ul>
        <p class="graph-legend-hint">
          {edgeMode === "curated"
            ? "Solid = part of · dashed orange = depends on · dotted = related. Click a node for details."
            : "Nodes clustered by NVIDIA Nemotron-3-embed-1b similarity. Purple lines = semantic connections."}
        </p>
      </details>
    </div>
  );
}
