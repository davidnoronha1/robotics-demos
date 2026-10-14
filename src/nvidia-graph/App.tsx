import { useGraphView } from "./useGraphView";
import { GraphCanvas } from "./components/GraphCanvas";
import { GraphToolbar } from "./components/GraphToolbar";
import { GraphLegend } from "./components/GraphLegend";
import { Panel } from "./Panel";

export function App() {
  const graph = useGraphView();

  return (
    <div class="graph-app">
      <GraphCanvas containerRef={graph.containerRef} />

      <GraphToolbar
        query={graph.query}
        setQuery={graph.setQuery}
        matches={graph.matches}
        isFocused={graph.isFocused}
        setIsFocused={graph.setIsFocused}
        searchWrapRef={graph.searchWrapRef}
        edgeMode={graph.edgeMode}
        onToggleEdgeMode={graph.toggleEdgeMode}
        onZoomIn={graph.zoomIn}
        onZoomOut={graph.zoomOut}
        onResetView={graph.resetView}
        onDownloadContext={graph.downloadContext}
        onJumpTo={graph.jumpTo}
        onPillClick={graph.handlePillClick}
        hasPanel={Boolean(graph.selectedNode)}
      />

      <GraphLegend edgeMode={graph.edgeMode} />

      {graph.selectedNode && (
        <Panel
          node={graph.selectedNode}
          edges={graph.activeEdges}
          onClose={graph.clearSelection}
          onNavigate={graph.jumpTo}
        />
      )}
    </div>
  );
}