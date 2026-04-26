import { renderGraphVisualizationClientScript } from "./graph-visualization-client-script.js";
import {
    renderGraphVisualizationDocumentTitle,
    serializeGraphVisualizationDataForInlineScript,
    serializeGraphVisualizationLoadedTargetForInlineScript
} from "./graph-visualization-inline-data.js";
import {
    getEdgeLineColor,
    renderEdgeLineCssRules,
    renderNodeFillCssRules
} from "./graph-visualization-style-metadata.js";
import type { GraphVisualizationData, GraphVisualizationRenderOptions } from "./types.js";

/**
 * Render the self-contained graph visualization HTML document for a graph-index payload.
 */
export function renderGraphVisualizationHtml(
    data: GraphVisualizationData,
    options: GraphVisualizationRenderOptions
): string {
    const serializedData = serializeGraphVisualizationDataForInlineScript(data);
    const serializedLoadedTarget = serializeGraphVisualizationLoadedTargetForInlineScript(options.loadedTarget ?? null);
    const documentTitle = renderGraphVisualizationDocumentTitle(options.title);
    const isServerMode = options.isServerMode === true;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GMLoop Graph Index - ${documentTitle}</title>
  <style>
    body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; font-family: system-ui, sans-serif; background: #1e1e1e; color: #e0e0e0; }
    header { position: absolute; top: 0; left: 0; right: 0; padding: 10px 20px; background: #252526; box-shadow: 0 1px 3px rgba(0,0,0,0.5); z-index: 10; display: flex; gap: 12px; align-items: flex-start; flex-wrap: wrap; }
    h1 { margin: 0; font-size: 16px; font-weight: 600; color: #e0e0e0; }
    #search { padding: 4px 8px; border: 1px solid #555; border-radius: 4px; font-size: 14px; width: 200px; background: #333; color: #eee; }
    button { padding: 4px 10px; border: 1px solid #555; border-radius: 4px; background: #333; color: #eee; cursor: pointer; font-size: 14px; }
    button:hover { background: #444; }
    button:disabled { cursor: wait; opacity: 0.8; }
    .toolbar-group { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .toolbar-stack { display: flex; flex-direction: column; gap: 4px; min-width: 280px; max-width: 100%; }
    .loaded-path { font-size: 12px; line-height: 1.35; color: #c6d4e5; overflow-wrap: anywhere; word-break: break-word; }
    .loaded-path strong { color: #e8f2ff; }
    .button-content { display: inline-flex; align-items: center; gap: 8px; }
    .button-spinner { width: 12px; height: 12px; border: 2px solid rgba(255, 255, 255, 0.32); border-top-color: #fff; border-radius: 50%; animation: graph-button-spin 0.8s linear infinite; display: inline-block; }
    @keyframes graph-button-spin { to { transform: rotate(360deg); } }
    main { width: 100%; height: 100%; }
    svg { width: 100%; height: 100%; cursor: grab; }
    svg:active { cursor: grabbing; }
    
    .node { stroke: #1e1e1e; stroke-width: 1.5px; cursor: pointer; }
    .node.toolset { stroke-dasharray: 2,2; stroke: #aaa; stroke-width: 2px; }
    .node.dimmed { opacity: 0.1 !important; }
    .node.highlighted { stroke: #fff; stroke-width: 3px; }
    
    .link { stroke-opacity: 0.72; fill: none; stroke-linecap: round; vector-effect: non-scaling-stroke; }
    .link.dimmed { stroke-opacity: 0.2 !important; }
    
    ${renderEdgeLineCssRules()}
    ${renderNodeFillCssRules()}
    
    text { font-size: 10px; pointer-events: none; fill: #e0e0e0; text-shadow: 0 1px 2px #1e1e1e, 0 -1px 2px #1e1e1e, 1px 0 2px #1e1e1e, -1px 0 2px #1e1e1e; }
    
    #tooltip { position: absolute; background: #252526; padding: 10px; border: 1px solid #444; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.5); pointer-events: auto; font-size: 12px; line-height: 1.35; z-index: 20; width: max-content; max-width: min(520px, calc(100vw - 24px)); box-sizing: border-box; overflow-wrap: anywhere; word-break: normal; white-space: normal; display: none; color: #eee; user-select: text; }
    #tooltip.visible { display: block; }
    #tooltip h3 { margin: 0 0 5px 0; font-size: 14px; overflow-wrap: anywhere; word-break: normal; color: #fff; }
    #tooltip div, #tooltip p { overflow-wrap: anywhere; }
    #tooltip p { margin: 8px 0 0 0; }
    #json-view { position: absolute; inset: 102px 0 0 0; overflow: auto; margin: 0; padding: 10px 20px 20px; font-size: 12px; background: #181818; color: #eaeaea; display: none; }
    .hidden { display: none !important; }
    
    #legend { position: absolute; bottom: 20px; right: 20px; background: rgba(37, 37, 38, 0.9); padding: 10px; border: 1px solid #444; border-radius: 4px; font-size: 12px; z-index: 10; color: #eee; max-height: 80%; overflow-y: auto; }
    
    .filter-item { display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; margin-top: 2px; }
    .filter-section { margin-bottom: 10px; }
    .filter-section strong { display: block; margin-bottom: 5px; cursor: pointer; }
    .sub-filter { margin-left: 15px; }
    @media (max-width: 920px) {
      #json-view { inset: 168px 0 0 0; }
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
</head>
<body>
  <header>
    <div class="toolbar-group">
      <h1>Graph Index</h1>
      <input type="search" id="search" placeholder="Search nodes…" />
      <button id="toggle-view">JSON</button>
      <button id="toggle-labels">Labels: Auto</button>
      <button id="reset-default">Reset</button>
      ${isServerMode ? `<button id="regenerate" style="background: #007acc; border-color: #007acc; font-weight: bold; color: white;"><span class="button-content"><span class="button-label">Regenerate</span></span></button>` : ""}
      ${isServerMode ? `<button id="load-directory"><span class="button-content"><span class="button-label">Load Folder</span></span></button>` : ""}
      ${isServerMode ? `<button id="load-files"><span class="button-content"><span class="button-label">Load Files</span></span></button>` : ""}
    </div>
    <div class="toolbar-stack">
      <div id="loaded-target" class="loaded-path"><strong>Active:</strong> ${documentTitle}</div>
      <div id="loaded-source" class="loaded-path"></div>
      <div id="loaded-selected" class="loaded-path"></div>
    </div>
  </header>
  <main>
    <svg id="graph">
      <defs>
        <marker id="arrow-calls" viewBox="0 -5 10 10" refX="18" refY="0" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,-5L10,0L0,5" fill="${getEdgeLineColor("calls")}"></path></marker>
        <marker id="arrow-inherits" viewBox="0 -5 10 10" refX="20" refY="0" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,-5L10,0L0,5" fill="${getEdgeLineColor("inherits")}"></path></marker>
        <marker id="arrow-depends_on" viewBox="0 -5 10 10" refX="18" refY="0" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,-5L10,0L0,5" fill="${getEdgeLineColor("depends_on")}"></path></marker>
      </defs>
      <g id="container"></g>
    </svg>
    <div id="tooltip"></div>
    <pre id="json-view"></pre>
    <aside id="legend"></aside>
  </main>
  <script>
window.__GMLOOP_LOADED_TARGET__ = ${serializedLoadedTarget};
${renderGraphVisualizationClientScript(serializedData, isServerMode)}
  </script>
</body>
</html>`;
}
