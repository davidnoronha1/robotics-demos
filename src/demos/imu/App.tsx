import { useImuDemo } from "./useImuDemo";
import { ImuBanner } from "./components/ImuBanner";
import { ImuStageView } from "./components/ImuStageView";
import { ImuControls } from "./components/ImuControls";
import { ImuPlotsView } from "./components/ImuPlotsView";
import { FusionEditorSection } from "./components/FusionEditorSection";

export function App() {
  const demo = useImuDemo();

  return (
    <div ref={demo.containerRef}>
      <ImuBanner
        bannerText={demo.bannerText}
        isRealSupported={demo.isRealSupported}
        usingReal={demo.usingReal}
        enableDisabled={demo.enableBtnDisabled}
        onEnableSensors={demo.handleEnableSensors}
      />

      <ImuStageView
        qrHostRef={demo.qrHostRef}
        stageHostRef={demo.stageHostRef}
        usingReal={demo.usingReal}
        cubeCanvasRefs={demo.cubeCanvasRefs}
      />

      <ImuControls
        usingReal={demo.usingReal}
        activePanel={demo.activePanel}
        setActivePanel={demo.setActivePanel}
        mode={demo.mode}
        setMode={demo.setMode}
        onShake={demo.handleShake}
        onReset={demo.handleReset}
        timescale={demo.timescale}
        setTimescale={demo.setTimescale}
        noise={demo.noise}
        setNoise={demo.setNoise}
        trust={demo.trust}
        applyTrust={demo.applyTrust}
        linkEnabled={demo.linkEnabled}
        setLinkEnabled={demo.setLinkEnabled}
        driftSpanRef={demo.driftSpanRef}
      />

      <ImuPlotsView
        plotRef={demo.plotRef}
        polarPlotRef={demo.polarPlotRef}
      />

      <FusionEditorSection
        activeFilter={demo.activeFilter}
        onSelectFilter={demo.selectFilter}
        editorHostRef={demo.editorHostRef}
        onApplyCode={demo.applyEditorCode}
        restoreDev={demo.restoreDev}
        setRestoreDev={demo.setRestoreDev}
      />
    </div>
  );
}
