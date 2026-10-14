import { useEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";
import { data, domainById } from "../data";
import type { SearchResult } from "../semanticSearch";

export const QUICK_PILLS = [
  "nvblox",
  "vslam",
  "curobo",
  "groot",
  "cosmos",
  "deepstream",
  "tensorrt",
  "alpamayo",
  "pose",
  "holoscan",
];

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function colorFor(domainId: string): string {
  return domainById.get(domainId)?.color ?? "#888888";
}

interface GraphToolbarProps {
  query: string;
  setQuery: (q: string) => void;
  matches: SearchResult[];
  isFocused: boolean;
  setIsFocused: (f: boolean) => void;
  searchWrapRef: RefObject<HTMLDivElement>;
  edgeMode: "curated" | "semantic";
  onToggleEdgeMode: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onDownloadContext: () => void;
  onJumpTo: (id: string) => void;
  onPillClick: (pill: string) => void;
  hasPanel?: boolean;
}

export function GraphToolbar({
  query,
  setQuery,
  matches,
  isFocused,
  setIsFocused,
  searchWrapRef,
  edgeMode,
  onToggleEdgeMode,
  onZoomIn,
  onZoomOut,
  onResetView,
  onDownloadContext,
  onJumpTo,
  onPillClick,
  hasPanel = false,
}: GraphToolbarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA");
      if (e.key === "/" && !isInput) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setIsFocused(true);
      } else if (e.key === "Escape" && isFocused) {
        setIsFocused(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFocused, setIsFocused]);

  const handleClear = () => {
    setQuery("");
    inputRef.current?.focus();
  };

  return (
    <header class={`graph-toolbar ${hasPanel ? "has-panel" : ""}`}>
      {/* Left section: Title & Repo count badge */}
      <div class="graph-toolbar-left">
        <span class="graph-brand-dot" aria-hidden="true" />
        <div class="graph-toolbar-title">
          <h1>NVIDIA robotics graph</h1>
          <span
            class="graph-count-badge"
            title={data.generatedAt ? `Updated ${formatDate(data.generatedAt)}` : ""}
          >
            {data.nodes.length} repos
          </span>
        </div>
      </div>

      {/* Center section: Integrated graph controls */}
      <div class="graph-toolbar-center">
        {/* Edge mode switcher */}
        <div class="graph-control-group graph-edge-mode-switch" role="group" aria-label="Edge connection mode">
          <button
            type="button"
            class={`graph-switch-btn ${edgeMode === "curated" ? "active" : ""}`}
            onClick={() => edgeMode !== "curated" && onToggleEdgeMode()}
            title="Hand-curated robotics workflows & architecture links"
          >
            Curated
          </button>
          <button
            type="button"
            class={`graph-switch-btn ${edgeMode === "semantic" ? "active" : ""}`}
            onClick={() => edgeMode !== "semantic" && onToggleEdgeMode()}
            title="NVIDIA Nemotron embeddings with dynamic semantic clustering"
          >
            Semantic
          </button>
        </div>

        {/* View actions button group */}
        <div class="graph-control-group graph-view-actions" role="group" aria-label="View actions">
          <button
            type="button"
            class="graph-icon-btn"
            title="Zoom in"
            onClick={onZoomIn}
            aria-label="Zoom in"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            type="button"
            class="graph-icon-btn"
            title="Zoom out"
            onClick={onZoomOut}
            aria-label="Zoom out"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            type="button"
            class="graph-icon-btn"
            title="Fit graph to screen"
            onClick={onResetView}
            aria-label="Fit graph to screen"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
          <span class="graph-btn-divider" aria-hidden="true" />
          <button
            type="button"
            class="graph-icon-btn"
            title="Download full project context for an AI agent (.md)"
            onClick={onDownloadContext}
            aria-label="Download agent context"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        </div>
      </div>

      {/* Right section: Search bar moved cleanly to the side */}
      <div class="graph-toolbar-right">
        <div class="graph-search-wrap" ref={searchWrapRef}>
          <div class={`graph-search-box ${isFocused ? "focused" : ""}`}>
            <svg
              class="graph-search-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder="Search projects (e.g. vslam, curobo)…"
              onFocus={() => setIsFocused(true)}
              onInput={(e) => {
                setQuery((e.target as HTMLInputElement).value);
                setIsFocused(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches[0]) {
                  onJumpTo(matches[0].node.id);
                }
              }}
            />
            {query ? (
              <button
                type="button"
                class="graph-search-clear"
                onClick={handleClear}
                title="Clear search"
                aria-label="Clear search"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            ) : (
              <kbd class="graph-search-kbd" title="Press / to search">/</kbd>
            )}
          </div>

          {/* Search dropdown */}
          {isFocused && (
            <div class="graph-search-dropdown" onWheel={(e) => e.stopPropagation()}>
              {query.trim().length === 0 ? (
                <div class="graph-search-suggestions">
                  <div class="graph-search-header">
                    <span>Explore Topics</span>
                  </div>
                  <div class="graph-dropdown-pills">
                    {QUICK_PILLS.map((pill) => (
                      <button
                        key={pill}
                        type="button"
                        class="graph-dropdown-pill-btn"
                        onClick={() => onPillClick(pill)}
                      >
                        {pill}
                      </button>
                    ))}
                  </div>
                  <p class="graph-search-hint">
                    Type keywords or concepts to find semantically related repositories.
                  </p>
                </div>
              ) : matches.length > 0 ? (
                <div class="graph-search-results">
                  <div class="graph-search-header">
                    <span>Semantic Matches ({matches.length})</span>
                  </div>
                  {matches.map((m) => {
                    const matchPct = Math.min(99, Math.round(m.score * 100));
                    const domainColor = colorFor(m.node.domain);
                    return (
                      <div
                        key={m.node.id}
                        class="graph-search-item"
                        onClick={() => onJumpTo(m.node.id)}
                      >
                        <div class="graph-search-item-head">
                          <div class="graph-search-item-title">
                            <span class="graph-domain-dot" style={`background: ${domainColor}`} />
                            {m.node.label}
                          </div>
                          <span class={`graph-search-score ${matchPct < 60 ? "medium" : ""}`}>
                            {matchPct}% match
                          </span>
                        </div>
                        {m.node.description && (
                          <div class="graph-search-item-desc">{m.node.description}</div>
                        )}
                      </div>
                    );
                  })}
                  <div class="graph-search-footer">
                    <span class="graph-pills-label">Suggestions:</span>
                    <div class="graph-footer-pills">
                      {QUICK_PILLS.slice(0, 5).map((pill) => (
                        <button
                          key={pill}
                          type="button"
                          class="graph-footer-pill-btn"
                          onClick={() => onPillClick(pill)}
                        >
                          {pill}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div class="graph-search-empty">
                  <p>No matches found for &ldquo;{query}&rdquo;</p>
                  <div class="graph-dropdown-pills">
                    {QUICK_PILLS.map((pill) => (
                      <button
                        key={pill}
                        type="button"
                        class="graph-dropdown-pill-btn"
                        onClick={() => onPillClick(pill)}
                      >
                        {pill}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
