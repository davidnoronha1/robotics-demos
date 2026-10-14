import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import cytoscape, { Core, ElementDefinition, NodeSingular, StylesheetJson } from "cytoscape";
import fcose from "cytoscape-fcose";
import { data, domainById, nodesById, type EdgeData, type NodeData } from "./data";
import { downloadContextFile } from "./exportContext";
import { getSemanticEdges, initTernlight, isTernlightReady, searchProjects, type SearchResult } from "./semanticSearch";

cytoscape.use(fcose);

const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;

function themeVar(name: string, fallback: string): string {
  const val = getComputedStyle(document.body).getPropertyValue(name).trim();
  if (!val || val.includes("color-mix")) return fallback;
  return val;
}

export function colorFor(domainId: string): string {
  return domainById.get(domainId)?.color ?? "#888888";
}

function edgeScore(ele: cytoscape.EdgeSingular): number {
  const s = ele.data("score");
  return typeof s === "number" ? s : 0.5;
}

function edgeWidth(ele: cytoscape.EdgeSingular): number {
  return Math.max(1, Math.min(3.5, 0.8 + edgeScore(ele) * 1.4));
}

const SELECTION_HIGHLIGHT_DEPTH = 3;
const SELECTION_HIGHLIGHT_FLOOR = 0.5;
const SELECTION_INACTIVE_OPACITY = 0.12;

function selectionOpacity(dist: number | undefined): number {
  if (dist === undefined || dist <= 0) return 1;
  if (dist > SELECTION_HIGHLIGHT_DEPTH) return SELECTION_INACTIVE_OPACITY;
  const t = (dist - 1) / Math.max(1, SELECTION_HIGHLIGHT_DEPTH - 1);
  return 1 - t * (1 - SELECTION_HIGHLIGHT_FLOOR);
}

function edgeOpacity(ele: cytoscape.EdgeSingular): number {
  const base = Math.max(0.2, Math.min(0.9, 0.2 + edgeScore(ele) * 0.7));
  return base * selectionOpacity(ele.data("hlDist"));
}

function bfsDistances(cy: Core, rootId: string, maxDepth: number): Map<string, number> {
  const dist = new Map<string, number>([[rootId, 0]]);
  let frontier = cy.getElementById(rootId);
  for (let d = 1; d <= maxDepth && frontier.length > 0; d++) {
    const next = frontier.openNeighborhood("node[!isCluster]").filter((n) => !dist.has(n.id()));
    next.forEach((n) => {
      dist.set(n.id(), d);
    });
    frontier = next;
  }
  return dist;
}

function nodeSize(ele: NodeSingular): number {
  const stars = ele.data("stars");
  if (typeof stars !== "number") return 14;
  return Math.max(10, Math.min(32, 10 + Math.log10(stars + 1) * 5.5));
}

export function useGraphView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const [query, setQuery] = useState("");
  const [ternReady, setTernReady] = useState(isTernlightReady());
  const [isFocused, setIsFocused] = useState(false);
  const [edgeMode, setEdgeMode] = useState<"curated" | "semantic">("curated");

  const curatedPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const semanticPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  useEffect(() => {
    initTernlight().then(() => {
      setTernReady(true);
    });
  }, []);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target as Node)) {
        setIsFocused(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const activeEdges = useMemo<EdgeData[]>(() => {
    if (edgeMode === "curated") return data.edges;
    return getSemanticEdges().map((e) => ({ ...e, type: "semantic" }));
  }, [edgeMode]);

  const clusterElements = useMemo<ElementDefinition[]>(() => {
    const counts = new Map<string, number>();
    for (const n of data.nodes) counts.set(n.domain, (counts.get(n.domain) ?? 0) + 1);

    return data.domains.map((d) => ({
      data: {
        id: `cluster-${d.id}`,
        label: `${d.label} (${counts.get(d.id) ?? 0})`,
        domain: d.id,
        isCluster: true,
      },
    }));
  }, []);

  const curatedEdgeElements = useMemo<ElementDefinition[]>(() => {
    return data.edges.map((e) => {
      const sNode = nodesById.get(e.source);
      const tNode = nodesById.get(e.target);
      const isCrossDomain = Boolean(sNode && tNode && sNode.domain !== tNode.domain);
      return {
        data: {
          id: `${e.source}->${e.target}:${e.type}`,
          source: e.source,
          target: e.target,
          type: e.type,
          score: e.score,
          isCrossDomain,
        },
        classes: `e-${e.type}`,
      };
    });
  }, []);

  const semanticEdgeElements = useMemo<ElementDefinition[]>(() => {
    return getSemanticEdges().map((e) => {
      const sNode = nodesById.get(e.source);
      const tNode = nodesById.get(e.target);
      const isCrossDomain = Boolean(sNode && tNode && sNode.domain !== tNode.domain);
      return {
        data: {
          id: `${e.source}->${e.target}:semantic`,
          source: e.source,
          target: e.target,
          type: "semantic",
          score: e.score,
          isCrossDomain,
        },
        classes: "e-semantic",
      };
    });
  }, []);

  const initialElements = useMemo<ElementDefinition[]>(() => {
    const els: ElementDefinition[] = [...clusterElements];

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

    els.push(...curatedEdgeElements);
    return els;
  }, [clusterElements, curatedEdgeElements]);

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
          "min-zoomed-font-size": 4.5,
        },
      },
      {
        selector: "node[!isCluster]",
        style: {
          width: nodeSize,
          height: nodeSize,
          "background-color": (ele: NodeSingular) => colorFor(ele.data("domain")),
          "border-width": 1.5,
          "border-color": (ele: NodeSingular) => colorFor(ele.data("domain")),
          opacity: (ele: NodeSingular) => selectionOpacity(ele.data("hlDist")),
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
        selector: "edge.e-semantic",
        style: {
          "line-style": "solid",
          "line-color": "#8957e5",
          "target-arrow-color": "#8957e5",
          "target-arrow-shape": "none",
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
        selector: "node[hlDist = 0]",
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
      elements: initialElements,
      style: styles,
      wheelSensitivity: 2,
      minZoom: 0.05,
      maxZoom: 6,
      autoungrabify: isTouchDevice,
    });
    cyRef.current = cy;
    (window as any).cy = cy;

    cy.on("tap", "node", (evt) => {
      const n = evt.target as cytoscape.NodeSingular;
      if (n.data("isCluster")) {
        setSelectedId(null);
        return;
      }
      setSelectedId(n.id());
    });
    cy.on("tap", "edge", (evt) => {
      const e = evt.target as cytoscape.EdgeSingular;
      const srcId = e.source().id();
      const tgtId = e.target().id();
      if (selectedIdRef.current === srcId) {
        setSelectedId(tgtId);
      } else if (selectedIdRef.current === tgtId) {
        setSelectedId(srcId);
      } else {
        setSelectedId(tgtId);
      }
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) setSelectedId(null);
    });

    if (!isTouchDevice) {
      cy.on("mouseover", "node[!isCluster]", (evt) => {
        if (selectedIdRef.current) return;
        const n = evt.target as cytoscape.NodeSingular;
        const neighborhood = n.closedNeighborhood();
        cy.elements().difference(neighborhood).addClass("hover-fade");
        neighborhood.addClass("hover-active");
      });
      cy.on("mouseout", "node[!isCluster]", () => {
        if (selectedIdRef.current) return;
        cy.elements().removeClass("hover-fade hover-active");
      });
    }

    const fcoseOptions = {
      name: "fcose",
      animate: false,
      fit: true,
      padding: 60,
      quality: "default",
      randomize: true,
      nodeSeparation: 100,
      idealEdgeLength: (edge: cytoscape.EdgeSingular) => {
        if (edge.data("isCrossDomain")) return 650;
        return 110 + (1 - edgeScore(edge)) * 100;
      },
      edgeElasticity: (edge: cytoscape.EdgeSingular) => {
        if (edge.data("isCrossDomain")) return 0.04;
        return 0.45;
      },
      nodeRepulsion: 5000,
      gravity: 0.25,
      gravityCompound: 4.0,
      gravityRangeCompound: 3.5,
      nestingFactor: 1.5,
      tilingPaddingVertical: 50,
      tilingPaddingHorizontal: 50,
      packComponents: true,
      tile: true,
      stop: () => {
        cy.nodes("[!isCluster]").forEach((n) => {
          curatedPositionsRef.current.set(n.id(), { ...n.position() });
        });
      },
    };
    cy.layout(fcoseOptions as unknown as cytoscape.LayoutOptions).run();

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [initialElements, styles]);

  const isInitialMount = useRef(true);
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (edgeMode === "semantic") {
      // Switch to semantic mode:
      // 1. Remove curated domain groups (unparent child nodes and remove compound boxes)
      // 2. Add semantic edges
      cy.batch(() => {
        cy.remove("edge");
        cy.nodes().forEach((n) => {
          if (!n.data("isCluster") && n.data("parent")) {
            n.move({ parent: null });
          }
        });
        cy.remove("node[?isCluster]");
        cy.add(semanticEdgeElements);
      });

      // 3. Tell Cytoscape to cluster related nodes based on semantic embeddings
      if (semanticPositionsRef.current.size > 0) {
        // Animate smoothly to cached semantic cluster positions
        const layout = cy.layout({
          name: "preset",
          positions: (n: cytoscape.NodeSingular) => semanticPositionsRef.current.get(n.id()),
          animate: true,
          animationDuration: 600,
          animationEasing: "ease-in-out-cubic",
          fit: true,
          padding: 80,
        } as unknown as cytoscape.LayoutOptions);
        layout.run();
      } else {
        // Run fcose layout with spacious parameters so semantic clusters spread out cleanly without crowding
        const layout = cy.layout({
          name: "fcose",
          animate: false,
          fit: true,
          padding: 60,
          quality: "proof",
          randomize: true,
          nodeSeparation: 240,
          idealEdgeLength: (edge: cytoscape.EdgeSingular) => {
            const sc = edgeScore(edge);
            return 220 + (1 - sc) * 160;
          },
          edgeElasticity: (edge: cytoscape.EdgeSingular) => {
            const sc = edgeScore(edge);
            return 0.05 + sc * 0.1;
          },
          nodeRepulsion: 120000,
          gravity: 0.015,
          packComponents: true,
          stop: () => {
            cy.nodes("[!isCluster]").forEach((n) => {
              semanticPositionsRef.current.set(n.id(), { ...n.position() });
            });
            cy.fit(undefined, 60);
          },
        } as unknown as cytoscape.LayoutOptions);
        layout.run();
      }
    } else {
      // Switch back to curated mode:
      // 1. Restore domain cluster boxes and re-parent child nodes to their domains
      // 2. Restore curated edges
      cy.batch(() => {
        cy.remove("edge");
        cy.add(clusterElements);
        cy.nodes().forEach((n) => {
          const d = n.data("domain");
          if (d && !n.data("isCluster")) {
            n.move({ parent: `cluster-${d}` });
          }
        });
        cy.add(curatedEdgeElements);
      });

      // 3. Animate back to curated positions
      const layout = cy.layout({
        name: "preset",
        positions: (n: cytoscape.NodeSingular) => curatedPositionsRef.current.get(n.id()),
        animate: true,
        animationDuration: 600,
        animationEasing: "ease-in-out-cubic",
        fit: true,
        padding: 60,
      } as unknown as cytoscape.LayoutOptions);
      layout.run();
    }
  }, [edgeMode, clusterElements, curatedEdgeElements, semanticEdgeElements]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.elements().removeClass("hover-fade hover-active");
      if (!selectedId) {
        cy.elements().forEach((ele) => {
          ele.removeData("hlDist");
        });
        return;
      }
      const n = cy.getElementById(selectedId);
      if (n.length === 0) {
        cy.elements().forEach((ele) => {
          ele.removeData("hlDist");
        });
        return;
      }
      const distances = bfsDistances(cy, selectedId, SELECTION_HIGHLIGHT_DEPTH);
      const FAR = SELECTION_HIGHLIGHT_DEPTH + 1;
      cy.nodes("node[!isCluster]").forEach((node) => {
        node.data("hlDist", distances.get(node.id()) ?? FAR);
      });
      cy.edges().forEach((edge) => {
        const s = distances.get(edge.source().id());
        const t = distances.get(edge.target().id());
        edge.data("hlDist", s !== undefined && t !== undefined ? Math.min(s, t) + 1 : FAR);
      });
    });
    if (selectedId) {
      const n = cy.getElementById(selectedId);
      if (n.length > 0) {
        cy.animate({ center: { eles: n }, zoom: Math.max(cy.zoom(), 1.8), duration: 400 });
      }
    }
  }, [selectedId, activeEdges]);

  const matches = useMemo<SearchResult[]>(() => {
    if (!query.trim()) return [];
    return searchProjects(query, 12);
  }, [query, ternReady]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const q = query.trim();
    cy.batch(() => {
      cy.nodes("node[!isCluster]").removeClass("dim");
      if (q) {
        const matchIds = new Set(matches.map((m) => m.node.id));
        cy.nodes("node[!isCluster]").forEach((n) => {
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

  return {
    containerRef,
    searchWrapRef,
    query,
    setQuery,
    matches,
    isFocused,
    setIsFocused,
    edgeMode,
    toggleEdgeMode: () => setEdgeMode((m) => (m === "curated" ? "semantic" : "curated")),
    activeEdges,
    selectedNode: selectedNode as NodeData | null,
    clearSelection: () => setSelectedId(null),
    jumpTo,
    handlePillClick,
    zoomIn: () => zoomBy(1.5),
    zoomOut: () => zoomBy(1 / 1.5),
    resetView,
    downloadContext: () => downloadContextFile(data),
  };
}
