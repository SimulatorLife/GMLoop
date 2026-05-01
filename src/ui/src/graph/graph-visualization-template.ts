import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const GRAPH_VISUALIZATION_TEMPLATE_ASSET_FILE_NAMES = Object.freeze({
    css: "graph-visualization-template.css",
    html: "graph-visualization-template.html"
});

function resolveGraphVisualizationTemplateAssetPath(fileName: string): string {
    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
    const primaryPath = path.resolve(moduleDirectory, "assets", fileName);
    try {
        readFileSync(primaryPath, "utf8");
        return primaryPath;
    } catch {
        return path.resolve(moduleDirectory, "../../../src/graph/assets", fileName);
    }
}

function readGraphVisualizationTemplateAsset(fileName: string): string {
    return readFileSync(resolveGraphVisualizationTemplateAssetPath(fileName), "utf8");
}

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
    const clientScript = renderGraphVisualizationClientScript(
        serializedData,
        serializedDocumentationCatalogs,
        serializedLoadedTarget,
        serializedProjectConfigurationCatalog,
        isServerMode
    );
    const stylesheet = readGraphVisualizationTemplateAsset(GRAPH_VISUALIZATION_TEMPLATE_ASSET_FILE_NAMES.css)
        .replace("{{EDGE_LINE_CSS_RULES}}", renderEdgeLineCssRules())
        .replace("{{NODE_FILL_CSS_RULES}}", renderNodeFillCssRules());
    const documentMarkup = readGraphVisualizationTemplateAsset(GRAPH_VISUALIZATION_TEMPLATE_ASSET_FILE_NAMES.html)
        .replaceAll("{{DOCUMENT_TITLE}}", documentTitle)
        .replace(
            "{{REGENERATE_BUTTON}}",
            isServerMode
                ? '<button id="regenerate" style="background: linear-gradient(135deg, rgba(89,195,195,0.26), rgba(139,92,246,0.28)); border-color: rgba(89,195,195,0.4);"><span class="button-content"><span class="button-label">Regenerate</span></span></button>'
                : ""
        )
        .replace("{{ARROW_CALLS_COLOR}}", getEdgeLineColor("calls"))
        .replace("{{ARROW_INHERITS_COLOR}}", getEdgeLineColor("inherits"))
        .replace("{{ARROW_DEPENDS_ON_COLOR}}", getEdgeLineColor("depends_on"));

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
${stylesheet}
  </style>
  <script src="https://cdn.jsdelivr.net/npm/d3@7"></script>
</head>
<body>
${documentMarkup}
  <script type="module">
import { fileOpen, directoryOpen } from "https://cdn.jsdelivr.net/npm/browser-fs-access@0.38.0/dist/index.modern.js";
${clientScript}
  </script>
</body>
</html>`;
}
