import { domainById, EdgeData, NodeData } from "./data";
import { markdownToHtml } from "./markdownToHtml";

interface PanelProps {
  node: NodeData;
  edges: EdgeData[];
  onClose: () => void;
  onNavigate: (id: string) => void;
}

function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function Panel({ node, edges, onClose, onNavigate }: PanelProps) {
  const domain = domainById.get(node.domain);
  const relations = edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return (
    <aside class="graph-panel">
      <div class="graph-panel-head">
        <div class="graph-panel-title">
          <span class="graph-domain-dot" style={`background: ${domain?.color ?? "#888"}`} />
          <h2>{node.label}</h2>
        </div>
        <button class="graph-panel-close" onClick={onClose} aria-label="Close panel" title="Close">
          &times;
        </button>
      </div>

      {node.archived && <div class="graph-archived-tag">archived / legacy</div>}
      {domain && <div class="graph-panel-domain">{domain.label}</div>}

      {node.repo && (
        <p class="graph-repo">
          <a href={node.url} target="_blank" rel="noopener noreferrer">
            {node.repo}
          </a>
        </p>
      )}

      <p class="graph-summary">{node.summary || node.description}</p>

      <div class="graph-meta">
        {node.stars != null && (
          <span class="graph-meta-item" title="GitHub stars">
            ★ {formatCount(node.stars)}
          </span>
        )}
        {node.forks != null && <span class="graph-meta-item">⑂ {formatCount(node.forks)}</span>}
        {node.language && <span class="graph-meta-item">{node.language}</span>}
        {node.license && <span class="graph-meta-item">{node.license}</span>}
      </div>

      {(node.url || node.homepage) && (
        <div class="graph-links">
          {node.url && (
            <a class="graph-link-btn" href={node.url} target="_blank" rel="noopener noreferrer">
              GitHub ↗
            </a>
          )}
          {node.homepage && (
            <a class="graph-link-btn" href={node.homepage} target="_blank" rel="noopener noreferrer">
              Homepage ↗
            </a>
          )}
        </div>
      )}

      {node.topics && node.topics.length > 0 && (
        <div class="graph-topics">
          {node.topics.slice(0, 12).map((t) => (
            <span class="graph-topic" key={t}>
              {t}
            </span>
          ))}
        </div>
      )}

      {relations.length > 0 && (
        <div class="graph-relations">
          <h3>Relations</h3>
          <ul>
            {relations.map((e) => {
              const otherId = e.source === node.id ? e.target : e.source;
              const verb =
                e.type === "dependsOn"
                  ? e.source === node.id
                    ? "depends on"
                    : "dependency of"
                  : e.type === "partOf"
                    ? "part of"
                    : e.type === "semantic"
                      ? "semantically similar to"
                      : "related to";
              const link = (
                <button
                  type="button"
                  class="graph-relation-link"
                  onClick={() => onNavigate(otherId)}
                  title={`Go to ${otherId}`}
                >
                  {otherId}
                </button>
              );
              return (
                <li key={`${e.source}-${e.target}-${e.type}`}>
                  {e.type === "dependsOn" && e.target === node.id ? (
                    <>dependency of {link}</>
                  ) : (
                    <>
                      {verb} {link}
                    </>
                  )}
                  {e.score != null && <span class="graph-relation-score">{e.score}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div class="graph-readme">
        <h3>README</h3>
        {node.readme ? (
          <div
            class="graph-readme-body"
            dangerouslySetInnerHTML={{
              __html: markdownToHtml(node.readme, { repo: node.repo, branch: node.defaultBranch }),
            }}
          />
        ) : node.manual ? (
          <p class="graph-readme-empty">Product page — no README available.</p>
        ) : (
          <p class="graph-readme-empty">README not captured for this repo.</p>
        )}
      </div>
    </aside>
  );
}