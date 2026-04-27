import { renderGraphVisualizationClientScript } from "./graph-visualization-client-script.js";
import {
    renderGraphVisualizationDocumentTitle,
    serializeGraphVisualizationDataForInlineScript,
    serializeGraphVisualizationDocumentationCatalogsForInlineScript,
    serializeGraphVisualizationLoadedTargetForInlineScript,
    serializeGraphVisualizationProjectConfigurationCatalogForInlineScript
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
    const serializedDocumentationCatalogs = serializeGraphVisualizationDocumentationCatalogsForInlineScript(
        options.documentationCatalogs ?? null
    );
    const serializedLoadedTarget = serializeGraphVisualizationLoadedTargetForInlineScript(options.loadedTarget ?? null);
    const serializedProjectConfigurationCatalog = serializeGraphVisualizationProjectConfigurationCatalogForInlineScript(
        options.projectConfigurationCatalog ?? null
    );
    const documentTitle = renderGraphVisualizationDocumentTitle(options.title);
    const isServerMode = options.isServerMode === true;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GMLoop Graph Index - ${documentTitle}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap" rel="stylesheet">
  <link href="https://cdn.jsdelivr.net/npm/@tabler/core@1.4.0/dist/css/tabler.min.css" rel="stylesheet">
  <style>
    :root { color-scheme: dark; --gm-bg: #0b1220; --gm-panel: rgba(10, 18, 31, 0.84); --gm-panel-strong: rgba(14, 25, 42, 0.94); --gm-border: rgba(143, 181, 255, 0.16); --gm-text: #e7eef8; --gm-muted: #9fb3c8; --gm-accent: #59c3c3; --gm-accent-2: #8b5cf6; --gm-warm: #f7b267; --gm-shadow: 0 24px 60px rgba(0,0,0,0.35); }
    body, html { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; font-family: "Manrope", system-ui, sans-serif; font-size: 15px; background: radial-gradient(circle at top left, rgba(89,195,195,0.18), transparent 28%), radial-gradient(circle at top right, rgba(139,92,246,0.18), transparent 24%), linear-gradient(180deg, #08101b 0%, #0b1220 45%, #0e1726 100%); color: var(--gm-text); }
    body::before { content: ""; position: fixed; inset: 0; background-image: linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px); background-size: 22px 22px; opacity: 0.35; pointer-events: none; }
    body { position: relative; }
    #app-shell { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; }
    #app-header { position: relative; z-index: 15; display: flex; flex-direction: column; gap: 12px; padding: 18px 22px 14px; background: linear-gradient(180deg, rgba(8,16,27,0.96), rgba(9,16,29,0.88)); border-bottom: 1px solid var(--gm-border); box-shadow: 0 12px 32px rgba(0,0,0,0.24); backdrop-filter: blur(18px); }
    .topbar-row { display: flex; gap: 16px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
    .brand-block { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
    .brand-mark { display: inline-flex; align-items: center; justify-content: center; width: 42px; height: 42px; border-radius: 14px; background: linear-gradient(135deg, rgba(89,195,195,0.95), rgba(139,92,246,0.95)); color: #04101d; font-weight: 800; font-size: 18px; letter-spacing: 0.08em; box-shadow: 0 12px 28px rgba(89,195,195,0.24); }
    .brand-copy { display: flex; flex-direction: column; gap: 2px; }
    .brand-title { margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.03em; color: #f4f8fc; }
    .brand-subtitle { font-size: 12px; line-height: 1.4; color: var(--gm-muted); }
    .top-nav-cluster { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
    .top-nav { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .top-nav-button { border: 1px solid transparent; background: rgba(255,255,255,0.04); color: #dfe8f3; border-radius: 999px; padding: 8px 14px; font-weight: 700; letter-spacing: 0.01em; transition: background 140ms ease, border-color 140ms ease, color 140ms ease, transform 140ms ease; }
    .top-nav-button:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.08); transform: translateY(-1px); }
    .top-nav-button.active { background: linear-gradient(135deg, rgba(89,195,195,0.18), rgba(139,92,246,0.18)); border-color: rgba(89,195,195,0.38); color: #f6fbff; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.03); }
    .docs-toggle-row { display: flex; gap: 10px; margin-bottom: 18px; flex-wrap: wrap; }
    .github-link { display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 999px; border: 1px solid rgba(143,181,255,0.16); background: rgba(255,255,255,0.04); color: #f4f8fc; font-size: 12px; font-weight: 700; text-decoration: none; }
    .github-link:hover { background: rgba(255,255,255,0.08); color: #fff; }
    .open-button { display: inline-flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: 999px; border: 1px solid rgba(89,195,195,0.35); background: linear-gradient(135deg, rgba(89,195,195,0.22), rgba(139,92,246,0.22)); color: #f8fbff; font-size: 13px; font-weight: 800; text-decoration: none; }
    .open-button:hover { background: linear-gradient(135deg, rgba(89,195,195,0.3), rgba(139,92,246,0.3)); color: #fff; }
    .loaded-target-stack { display: flex; flex-direction: column; gap: 4px; min-width: 320px; max-width: 720px; }
    .loaded-path { font-size: 12px; line-height: 1.35; color: var(--gm-muted); overflow-wrap: anywhere; word-break: break-word; }
    .loaded-path strong { color: #f4f8fc; }
    #page-toolbar { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; padding: 14px 18px; margin: 0 22px; border: 1px solid var(--gm-border); border-radius: 20px; background: linear-gradient(180deg, rgba(16, 28, 46, 0.92), rgba(12, 22, 36, 0.92)); box-shadow: var(--gm-shadow); }
    .toolbar-title { display: flex; flex-direction: column; gap: 2px; }
    .toolbar-title strong { font-size: 14px; color: #f4f8fc; }
    .toolbar-title span { font-size: 12px; color: var(--gm-muted); }
    .toolbar-controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    #search { min-width: 220px; padding: 9px 12px; border: 1px solid rgba(143,181,255,0.14); border-radius: 14px; font-size: 13px; background: rgba(4, 11, 20, 0.62); color: #eef6ff; }
    button { border: 1px solid rgba(143,181,255,0.14); border-radius: 14px; background: rgba(255,255,255,0.05); color: #eef6ff; cursor: pointer; font-size: 13px; font-weight: 700; padding: 9px 12px; transition: background 140ms ease, border-color 140ms ease, transform 140ms ease; }
    button:hover { background: rgba(255,255,255,0.08); border-color: rgba(143,181,255,0.24); transform: translateY(-1px); }
    button:disabled { cursor: wait; opacity: 0.8; transform: none; }
    .button-content { display: inline-flex; align-items: center; gap: 8px; }
    .button-spinner { width: 14px; height: 14px; border: 2px solid rgba(255, 255, 255, 0.28); border-top-color: #fff; border-radius: 50%; animation: graph-button-spin 0.8s linear infinite; display: inline-block; }
    @keyframes graph-button-spin { to { transform: rotate(360deg); } }
    main { position: relative; flex: 1; min-height: 0; padding: 18px 22px 22px; }
    .page { position: relative; width: 100%; height: 100%; display: none; }
    .page.active { display: block; }
    #graph-page { border: 1px solid var(--gm-border); border-radius: 24px; overflow: hidden; background: linear-gradient(180deg, rgba(8,14,24,0.82), rgba(12,20,34,0.92)); box-shadow: var(--gm-shadow); }
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
    
    #tooltip { position: absolute; background: rgba(10, 18, 30, 0.96); padding: 12px; border: 1px solid rgba(143,181,255,0.16); border-radius: 16px; box-shadow: 0 20px 48px rgba(0,0,0,0.32); pointer-events: auto; font-size: 12px; line-height: 1.35; z-index: 20; width: max-content; max-width: min(520px, calc(100vw - 24px)); box-sizing: border-box; overflow-wrap: anywhere; word-break: normal; white-space: normal; display: none; color: #eef6ff; user-select: text; backdrop-filter: blur(14px); }
    #tooltip.visible { display: block; }
    #tooltip h3 { margin: 0 0 5px 0; font-size: 14px; overflow-wrap: anywhere; word-break: normal; color: #fff; }
    #tooltip div, #tooltip p { overflow-wrap: anywhere; }
    #tooltip p { margin: 8px 0 0 0; }
    #json-view { position: absolute; inset: 0; overflow: auto; margin: 0; padding: 18px 20px 20px; font-size: 12px; background: rgba(5, 10, 19, 0.92); color: #eaeaea; display: none; }
    .hidden { display: none !important; }
    
    #legend { position: absolute; bottom: 20px; right: 20px; background: rgba(11, 19, 32, 0.92); padding: 12px; border: 1px solid rgba(143,181,255,0.12); border-radius: 18px; font-size: 12px; z-index: 10; color: #eef6ff; max-height: 72%; overflow-y: auto; box-shadow: 0 18px 40px rgba(0,0,0,0.28); backdrop-filter: blur(14px); }
    .docs-page { height: 100%; overflow: auto; }
    .docs-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; }
    .docs-meta { margin: 0 0 18px 0; font-size: 13px; color: var(--gm-muted); }
    .catalog-card { padding: 16px; background: linear-gradient(180deg, rgba(16, 28, 46, 0.94), rgba(10, 18, 31, 0.94)); border: 1px solid rgba(143,181,255,0.14); border-radius: 22px; box-shadow: var(--gm-shadow); }
    .catalog-card h3 { margin: 0 0 8px 0; font-size: 14px; color: #f3f8ff; }
    .catalog-card p { margin: 0 0 10px 0; font-size: 12px; line-height: 1.5; color: #c8d5e5; }
    .catalog-usage { display: block; margin-bottom: 10px; font-size: 11px; color: #8ed1fc; overflow-wrap: anywhere; }
    .catalog-list { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .catalog-item { font-size: 11px; line-height: 1.4; color: #d9e3ef; }
    .catalog-item code { color: #f7c873; }
    .catalog-empty { font-size: 12px; color: #96a7ba; }
    .config-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 18px; }
    .config-stack { display: flex; flex-direction: column; gap: 18px; }
    .config-card { padding: 18px; background: linear-gradient(180deg, rgba(16, 28, 46, 0.94), rgba(10, 18, 31, 0.94)); border: 1px solid rgba(143,181,255,0.14); border-radius: 22px; box-shadow: var(--gm-shadow); }
    .config-card h3 { margin: 0 0 10px 0; font-size: 15px; color: #f3f8ff; }
    .config-card p { margin: 0 0 10px 0; font-size: 12px; line-height: 1.5; color: #c8d5e5; }
    .config-list { display: flex; flex-direction: column; gap: 10px; margin: 0; padding: 0; list-style: none; }
    .config-item { padding: 12px; border-radius: 16px; background: rgba(255,255,255,0.03); border: 1px solid rgba(143,181,255,0.1); }
    .config-item strong { display: block; margin-bottom: 4px; font-size: 13px; color: #f8fbff; }
    .config-item span { display: block; font-size: 11px; line-height: 1.5; color: #c8d5e5; }
    .config-value { margin-top: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #8ed1fc; white-space: pre-wrap; overflow-wrap: anywhere; }
    .config-badge-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
    .config-badge { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 999px; background: rgba(255,255,255,0.06); border: 1px solid rgba(143,181,255,0.12); font-size: 10px; font-weight: 700; color: #e7eef8; text-transform: uppercase; letter-spacing: 0.04em; }
    .config-raw { margin: 0; padding: 14px; border-radius: 18px; background: rgba(5, 10, 19, 0.9); border: 1px solid rgba(143,181,255,0.1); color: #dce8f5; font-size: 11px; line-height: 1.55; overflow: auto; }
    
    .filter-item { display: flex; align-items: center; gap: 4px; font-size: 12px; cursor: pointer; margin-top: 2px; }
    .filter-section { margin-bottom: 10px; }
    .filter-section strong { display: block; margin-bottom: 5px; cursor: pointer; }
    .sub-filter { margin-left: 15px; }
    @media (max-width: 920px) {
      #app-header { padding: 16px 14px 12px; }
      #page-toolbar { margin: 0 14px; border-radius: 18px; }
      main { padding: 14px; }
      .loaded-target-stack { min-width: 0; }
      #search { min-width: 0; width: 100%; }
      .toolbar-controls { width: 100%; }
    }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
</head>
<body>
  <div id="app-shell">
    <header id="app-header">
      <div class="topbar-row">
        <div class="brand-block">
          <div class="brand-mark">GM</div>
          <div class="brand-copy">
            <h1 class="brand-title">GMLoop</h1>
            <div class="brand-subtitle">Workspace UI driven directly from live CLI and MCP catalogs.</div>
          </div>
          <div class="top-nav-cluster">
            <nav class="top-nav" aria-label="Primary">
              <button id="tab-graph" class="top-nav-button active">Graph Index</button>
              <button id="tab-docs" class="top-nav-button">Docs</button>
              <button id="tab-config" class="top-nav-button">Config</button>
            </nav>
            <a id="github-link" class="github-link" href="https://github.com/SimulatorLife/GMLoop" target="_blank" rel="noreferrer">GitHub Repo</a>
            ${isServerMode ? `<button id="open-project" class="open-button"><span class="button-content"><span class="button-label">Open...</span></span></button>` : ""}
          </div>
        </div>
        <div class="loaded-target-stack">
          <div id="loaded-target" class="loaded-path"><strong>Active:</strong> ${documentTitle}</div>
          <div id="loaded-source" class="loaded-path"></div>
          <div id="loaded-selected" class="loaded-path"></div>
        </div>
      </div>
      <div id="page-toolbar">
        <div class="toolbar-title">
          <strong id="toolbar-heading">Graph Index</strong>
          <span id="toolbar-subheading">Interactive graph exploration controls for the current graph index.</span>
        </div>
        <div id="graph-controls" class="toolbar-controls">
          <input type="search" id="search" placeholder="Search nodes…" />
          <button id="toggle-view">JSON</button>
          <button id="toggle-labels">Labels: Auto</button>
          <button id="reset-default">Reset</button>
          ${isServerMode ? `<button id="regenerate" style="background: linear-gradient(135deg, rgba(89,195,195,0.26), rgba(139,92,246,0.28)); border-color: rgba(89,195,195,0.4);"><span class="button-content"><span class="button-label">Regenerate</span></span></button>` : ""}
        </div>
      </div>
    </header>
    <main>
      <section id="graph-page" class="page active">
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
      </section>
      <section id="docs-page" class="page docs-page">
        <div class="docs-toggle-row">
          <button id="docs-view-cli" class="top-nav-button active">CLI</button>
          <button id="docs-view-mcp" class="top-nav-button">MCP</button>
        </div>
        <p id="docs-meta" class="docs-meta"></p>
        <div id="docs-content">
          <div id="cli-page" class="docs-subpage">
            <div id="cli-content" class="docs-grid"></div>
          </div>
          <div id="mcp-page" class="docs-subpage hidden">
            <div id="mcp-content" class="docs-grid"></div>
          </div>
        </div>
      </section>
      <section id="config-page" class="page docs-page">
        <p id="config-meta" class="docs-meta"></p>
        <div id="config-content" class="config-stack"></div>
      </section>
    </main>
  </div>
  <script type="module">
import { fileOpen, directoryOpen } from "https://cdn.jsdelivr.net/npm/browser-fs-access@0.38.0/dist/index.js";
window.__GMLOOP_DOCUMENTATION_CATALOGS__ = ${serializedDocumentationCatalogs};
window.__GMLOOP_LOADED_TARGET__ = ${serializedLoadedTarget};
window.__GMLOOP_PROJECT_CONFIGURATION__ = ${serializedProjectConfigurationCatalog};
${renderGraphVisualizationClientScript(serializedData, isServerMode)}
  </script>
</body>
</html>`;
}
