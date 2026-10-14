import { domainById, EdgeData, NodeData, nodesById } from "./data";
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

      {node.steDescription ? (
        <div class="graph-ste-description">
          {node.steDescription.split("\n").map((line, idx) => (
            <p key={idx} class="graph-ste-line">
              {line}
            </p>
          ))}
        </div>
      ) : (
        <p class="graph-summary">{node.summary || node.description}</p>
      )}

      <div class="graph-meta">
        {node.stars != null && (
          <span class="graph-meta-item" title="GitHub stars">
            ★ {formatCount(node.stars)}
          </span>
        )}
        {node.forks != null && <span class="graph-meta-item">⑂ {formatCount(node.forks)}</span>}
        {node.language && <span class="graph-meta-item">{node.language}</span>}
        {node.license && node.license !== "NOASSERTION" && (
          <span class="graph-meta-item">{node.license}</span>
        )}
      </div>

      {(node.url || node.homepage) && (
        <div class="graph-links">
          {node.url && (
            <a
              class="graph-link-btn graph-link-btn-github"
              href={node.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg
                class="graph-link-icon"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                />
              </svg>
              <span>GitHub</span>
              <span class="graph-link-arrow" aria-hidden="true">↗</span>
            </a>
          )}
          {node.homepage && (
            <a
              class="graph-link-btn graph-link-btn-homepage"
              href={node.homepage}
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg
                class="graph-link-icon"
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
              <span>Homepage</span>
              <span class="graph-link-arrow" aria-hidden="true">↗</span>
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
          <h3>Relations ({relations.length})</h3>
          <ul>
            {relations.map((e) => {
              const otherId = e.source === node.id ? e.target : e.source;
              const otherNode = nodesById.get(otherId);
              const otherDomain = otherNode ? domainById.get(otherNode.domain) : null;
              const displayLabel = otherNode?.label ?? otherId;
              const verb =
                e.type === "dependsOn"
                  ? e.source === node.id
                    ? "depends on"
                    : "dependency of"
                  : e.type === "partOf"
                    ? "part of"
                    : e.type === "semantic"
                      ? "similar to"
                      : "related to";
              const link = (
                <button
                  type="button"
                  class="graph-relation-link"
                  onClick={() => onNavigate(otherId)}
                  title={`Navigate to ${displayLabel} (${otherId})`}
                >
                  {otherDomain && (
                    <span
                      class="graph-domain-dot"
                      style={`background: ${otherDomain.color}; width: 0.6em; height: 0.6em; display: inline-block; margin-right: 4px; vertical-align: middle;`}
                    />
                  )}
                  {displayLabel}
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

      {node.readme && (
        <div class="graph-readme">
          <details>
            <summary>Original README</summary>
            <div
              class="graph-readme-body"
              dangerouslySetInnerHTML={{
                __html: markdownToHtml(node.readme, { repo: node.repo, branch: node.defaultBranch }),
              }}
            />
          </details>
        </div>
      )}
    </aside>
  );
}