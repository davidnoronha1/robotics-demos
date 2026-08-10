import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import cytoscape, { Core, ElementDefinition, NodeSingular, StylesheetJson } from "cytoscape";
import fcose from "cytoscape-fcose";
import { data, domainById, nodesById } from "./data";
import { Panel } from "./Panel";
import { initTernlight, isTernlightReady, searchProjects } from "./semanticSearch";

cytoscape.use(fcose);

function themeVar(name: string, fallback: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

function colorFor(domainId: string): string {
  return domainById.get(domainId)?.color ?? "#888888";
}

function edgeScore(ele: cytoscape.EdgeSingular): number {
  const s = ele.data("score");
  return typeof s === "number" ? s : 0.5;
}
function edgeWidth(ele: cytoscape.EdgeSingular): number {
  return Math.max(1, Math.min(3.5, 0.8 + edgeScore(ele) * 1.4));
}
function edgeOpacity(ele: cytoscape.EdgeSingular): number {
  return Math.max(0.2, Math.min(0.9, 0.2 + edgeScore(ele) * 0.7));
}

function nodeSize(ele: NodeSingular): number {
  const stars = ele.data("stars");
  if (typeof stars !== "number") return 14;
  return Math.max(10, Math.min(32, 10 + Math.log10(stars + 1) * 5.5));
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

const QUICK_PILLS = ["aruco", "cuPCL", "vslam", "yolo", "path planning", "robot arm", "depth camera"];

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [ternReady, setTernReady] = useState(isTernlightReady());
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    initTernlight().then(() => {
      setTernReady(true);
    });
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setIsFocused(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const elements = useMemo<ElementDefinition[]>(() => {
    const counts = new Map<string, number>();
    for (const n of data.nodes) counts.set(n.domain, (counts.get(n.domain) ?? 0) + 1);

    const els: ElementDefinition[] = [];
    for (const d of data.domains) {
      const count = counts.get(d.id) ?? 0;
      els.push({
        data: {
          id: `cluster-${d.id}`,
          label: `${d.label} (${count})`,
          domain: d.id,
          isCluster: true,
        },
      });
    }
    for (const n of data.nodes) {
      els.push({
        data: {
          id: n.id,
          parent: `cluster-${n.domain}`,
          label: n.label,
          domain: n.domain,
          labelWidth: 110,
          stars: n.stars,
        },
      });
    }
    for (const e of data.edges) {
      els.push({
        data: {
          id: `${e.source}->${e.target}:${e.type}`,
          source: e.source,
          target: e.target,
          type: e.type,
          score: e.score,
        },
        classes: `e-${e.type}`,
      });
    }
    return els;
  }, []);

  const styles = useMemo<StylesheetJson>(() => {
    const labelColor = themeVar("--black", "#1f2328");
    const edgeColor = themeVar("--gray", "#8c959f");
    const displayFont = themeVar("--display-font", "ui-sans-serif, system-ui, sans-serif");
    const pageBg = themeVar("--white", "#ffffff");

    return [
      {
        selector: "node",
        style: {
          label: "data(label)",
          "font-family": displayFont,
          "font-size": 10,
          color: labelColor,
          "text-wrap": "wrap",
          "text-max-width": "data(labelWidth)",
          "text-halign": "center",
          "text-valign": "bottom",
          "text-margin-y": 3,
        },
      },
      {
        selector: "node:child",
        style: {
          width: nodeSize,
          height: nodeSize,
          "background-color": (ele: NodeSingular) => colorFor(ele.data("domain")),
          "border-width": 1.5,
          "border-color": (ele: NodeSingular) => colorFor(ele.data("domain")),
        },
      },
      {
        selector: "node[?isCluster]",
        style: {
          shape: "roundrectangle",
          padding: "28px",
          "compound-sizing-wrt-labels": "include",
          "background-color": (ele: NodeSingular) => colorFor(ele.data("domain")),
          "background-opacity": 0.07,
          "border-width": 1,
          "border-color": (ele: NodeSingular) => colorFor(ele.data("domain")),
          "border-style": "dashed",
          "font-size": 14,
          "font-weight": "bold",
          "text-valign": "top",
          "text-halign": "center",
          "text-margin-y": 10,
          "text-max-width": "200px",
        },
      },
      {
        selector: "node.dim",
        style: { opacity: 0.12 },
      },
      {
        selector: "edge",
        style: {
          width: edgeWidth,
          "line-color": edgeColor,
          "target-arrow-color": edgeColor,
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.7,
          "curve-style": "bezier",
          opacity: edgeOpacity,
        },
      },
      {
        selector: "edge.e-dependsOn",
        style: {
          "line-style": "dashed",
          "line-color": "#d29922",
          "target-arrow-color": "#d29922",
        },
      },
      {
        selector: "edge.e-relatedTo",
        style: {
          "line-style": "dotted",
          "line-color": "#58a6ff",
          "target-arrow-color": "#58a6ff",
        },
      },
      {
        selector: "node.hover-fade, edge.hover-fade",
        style: { opacity: 0.35 },
      },
      {
        selector: "node.hover-active",
        style: {
          "border-width": 4,
          "border-color": labelColor,
          width: (ele: NodeSingular) => nodeSize(ele) + 8,
          height: (ele: NodeSingular) => nodeSize(ele) + 8,
          "z-index": 999,
          "font-size": 14,
          "font-weight": "bold",
          color: labelColor,
          "text-background-color": pageBg,
          "text-background-opacity": 0.9,
          "text-background-shape": "roundrectangle",
          "text-background-padding": "3px",
          "text-margin-y": 6,
        },
      },
      {
        selector: "edge.hover-active",
        style: {
          opacity: 1,
          width: (ele: cytoscape.EdgeSingular) => edgeWidth(ele) + 1.5,
          "z-index": 998,
        },
      },
    ];
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const cy = cytoscape({
      container: el,
      elements,
      style: styles,
      wheelSensitivity: 0.8,
      minZoom: 0.05,
      maxZoom: 6,
    });
    cyRef.current = cy;

    cy.on("tap", "node", (evt) => {
      const n = evt.target as cytoscape.NodeSingular;
      if (n.data("isCluster")) {
        cy.animate({ center: { eles: n }, zoom: 2.4, duration: 350 });
        return;
      }
      setSelectedId(n.id());
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) setSelectedId(null);
    });

    cy.on("mouseover", "node:child", (evt) => {
      const n = evt.target as cytoscape.NodeSingular;
      const neighborhood = n.closedNeighborhood();
      cy.elements().difference(neighborhood).addClass("hover-fade");
      neighborhood.addClass("hover-active");
    });
    cy.on("mouseout", "node:child", () => {
      cy.elements().removeClass("hover-fade hover-active");
    });

    const fcoseOptions = {
      name: "fcose",
      animate: false,
      fit: true,
      padding: 90,
      quality: "proof",
      nodeSeparation: 500,
      idealEdgeLength: (edge: cytoscape.EdgeSingular) => 220 + (1 - edgeScore(edge)) * 220,
      edgeElasticity: (edge: cytoscape.EdgeSingular) => 0.06 + edgeScore(edge) * 0.18,
      nodeRepulsion: 150000,
      tilingPaddingVertical: 40,
      tilingPaddingHorizontal: 40,
      packComponents: true,
      tile: true,
      nestingFactor: 0.1,
    };
    cy.layout(fcoseOptions as unknown as cytoscape.LayoutOptions).run();

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [elements, styles]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !selectedId) return;
    const n = cy.getElementById(selectedId);
    if (n.length > 0) {
      cy.animate({ center: { eles: n }, zoom: Math.max(cy.zoom(), 1.8), duration: 400 });
    }
  }, [selectedId]);

  const matches = useMemo(() => {
    if (!query.trim()) return [];
    return searchProjects(query, 12);
  }, [query, ternReady]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const q = query.trim();
    cy.batch(() => {
      cy.nodes("node:child").removeClass("dim");
      if (q) {
        const matchIds = new Set(matches.map((m) => m.node.id));
        cy.nodes("node:child").forEach((n) => {
          if (!matchIds.has(n.id())) n.addClass("dim");
        });
      }
    });
  }, [query, matches]);

  const selectedNode = selectedId ? nodesById.get(selectedId) ?? null : null;

  const zoomBy = (factor: number) => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom({
      level: cy.zoom() * factor,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  };
  const resetView = () => cyRef.current?.fit(undefined, 90);

  const jumpTo = (id: string) => {
    setIsFocused(false);
    setSelectedId(id);
  };

  const handlePillClick = (pill: string) => {
    setQuery(pill);
    setIsFocused(true);
    const results = searchProjects(pill, 1);
    if (results.length > 0 && results[0]) {
      jumpTo(results[0].node.id);
    }
  };

  return (
    <div class="graph-app">
      <div ref={containerRef} class="graph-canvas" />

      <div class="graph-toolbar">
        <div class="graph-toolbar-title">
          <h1>NVIDIA robotics graph</h1>
          <p>
            {data.nodes.length} projects fetched from GitHub{" "}
            {data.generatedAt ? `· updated ${formatDate(data.generatedAt)}` : ""}
          </p>
        </div>

        <div class="graph-search-wrap" ref={searchWrapRef}>
          <div class="graph-search-box">
            <input
              type="text"
              value={query}
              placeholder="Semantic search (e.g., aruco, vslam)…"
              onFocus={() => setIsFocused(true)}
              onInput={(e) => {
                setQuery((e.target as HTMLInputElement).value);
                setIsFocused(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && matches[0]) {
                  jumpTo(matches[0].node.id);
                }
              }}
            />
          </div>

          <div class="graph-pills">
            <span class="graph-pills-label">Try:</span>
            {QUICK_PILLS.map((pill) => (
              <button
                key={pill}
                type="button"
                class={`graph-pill-btn ${query.toLowerCase() === pill ? "active" : ""}`}
                onClick={() => handlePillClick(pill)}
              >
                {pill}
              </button>
            ))}
          </div>

          {isFocused && matches.length > 0 && (
            <div class="graph-search-dropdown">
              <div class="graph-search-header">
                <span>Semantic Matches ({matches.length})</span>
                <span>Ternlight WASM</span>
              </div>
              {matches.map((m) => {
                const matchPct = Math.min(99, Math.round(m.score * 100));
                const domainColor = colorFor(m.node.domain);
                return (
                  <div
                    key={m.node.id}
                    class="graph-search-item"
                    onClick={() => jumpTo(m.node.id)}
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
            </div>
          )}
        </div>

        <div class="graph-zoom">
          <button title="Zoom in" onClick={() => zoomBy(1.3)}>
            +
          </button>
          <button title="Zoom out" onClick={() => zoomBy(1 / 1.3)}>
            &minus;
          </button>
          <button title="Reset view" onClick={resetView}>
            ⟳
          </button>
        </div>
      </div>

      <div class="graph-legend">
        <details>
          <summary>Legend</summary>
          <ul>
            {data.domains.map((d) => (
              <li key={d.id}>
                <span class="graph-domain-dot" style={`background: ${d.color}`} />
                {d.label}
              </li>
            ))}
          </ul>
          <p class="graph-legend-hint">
            Solid = part of · dashed orange = depends on · dotted = related. Click a node for details.
          </p>
        </details>
      </div>

      {selectedNode && (
        <Panel
          node={selectedNode}
          edges={data.edges}
          onClose={() => setSelectedId(null)}
          onNavigate={jumpTo}
        />
      )}
    </div>
  );
}