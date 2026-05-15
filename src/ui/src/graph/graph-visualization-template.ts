import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderGraphVisualizationClientScript } from "./graph-visualization-client-script.js";
import {
    renderGraphVisualizationDocumentTitle,
    serializeGraphVisualizationDataForInlineScript,
    serializeGraphVisualizationDocumentationCatalogsForInlineScript,
    serializeGraphVisualizationLiveReloadForInlineScript,
    serializeGraphVisualizationLoadedTargetForInlineScript,
    serializeGraphVisualizationProjectConfigurationCatalogForInlineScript,
    serializeGraphVisualizationStartupStateForInlineScript
} from "./graph-visualization-inline-data.js";
import {
    getEdgeLineColor,
    renderEdgeLineCssRules,
    renderNodeFillCssRules
} from "./graph-visualization-style-metadata.js";
import type {
    GraphVisualizationBundleArtifact,
    GraphVisualizationBundleFile,
    GraphVisualizationData,
    GraphVisualizationRenderOptions
} from "./types.js";

const GRAPH_VISUALIZATION_TEMPLATE_ASSET_FILE_NAMES = Object.freeze({
    css: "graph-visualization-template.css",
    html: "graph-visualization-template.html"
});

const GRAPH_VISUALIZATION_BUNDLE_FILE_PATHS = Object.freeze({
    browserFsAccessScriptPath: "assets/vendor/browser-fs-access.js",
    d3ScriptPath: "assets/vendor/d3.min.js",
    entryHtmlPath: "index.html",
    scriptPath: "assets/graph-visualization.js",
    stylesheetPath: "assets/graph-visualization.css"
});

const GRAPH_VISUALIZATION_VENDOR_ASSET_FILE_PATHS = Object.freeze({
    browserFsAccess: "../../../../node_modules/browser-fs-access/dist/index.modern.js",
    d3: "../../../../node_modules/d3/dist/d3.min.js"
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

function readGraphVisualizationVendorAsset(relativePath: string): string {
    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
    const candidatePaths = [
        path.resolve(moduleDirectory, relativePath),
        path.resolve(
            moduleDirectory,
            "../../../../ui/node_modules",
            relativePath.replace("../../../../node_modules/", "")
        )
    ];

    for (const candidatePath of candidatePaths) {
        try {
            return readFileSync(candidatePath, "utf8");
        } catch {
            continue;
        }
    }

    throw new Error(`Unable to resolve graph visualization vendor asset: ${relativePath}`);
}

function createGraphVisualizationBundleFile(
    relativePath: string,
    contentType: string,
    textContent: string
): GraphVisualizationBundleFile {
    return Object.freeze({
        bytes: new TextEncoder().encode(textContent),
        contentType,
        relativePath
    });
}

/**
 * Render the graph visualization as an HTML + assets bundle artifact.
 */
export function renderGraphVisualizationBundle(
    data: GraphVisualizationData,
    options: GraphVisualizationRenderOptions
): GraphVisualizationBundleArtifact {
    const serializedData = serializeGraphVisualizationDataForInlineScript(data);
    const serializedDocumentationCatalogs = serializeGraphVisualizationDocumentationCatalogsForInlineScript(
        options.documentationCatalogs ?? null
    );
    const serializedLoadedTarget = serializeGraphVisualizationLoadedTargetForInlineScript(options.loadedTarget ?? null);
    const serializedProjectConfigurationCatalog = serializeGraphVisualizationProjectConfigurationCatalogForInlineScript(
        options.projectConfigurationCatalog ?? null
    );
    const serializedLiveReload = serializeGraphVisualizationLiveReloadForInlineScript(options.liveReload ?? null);
    const serializedStartupState = serializeGraphVisualizationStartupStateForInlineScript(options.startupState ?? null);
    const documentTitle = renderGraphVisualizationDocumentTitle(options.title);
    const isServerMode = options.isServerMode === true;
    const clientScriptBody = renderGraphVisualizationClientScript(
        serializedData,
        serializedDocumentationCatalogs,
        serializedLiveReload,
        serializedLoadedTarget,
        serializedProjectConfigurationCatalog,
        serializedStartupState,
        isServerMode
    );
    const moduleScript = [
        `import { fileOpen, directoryOpen } from "./vendor/browser-fs-access.js";`,
        clientScriptBody
    ].join("\n");
    const stylesheet = readGraphVisualizationTemplateAsset(GRAPH_VISUALIZATION_TEMPLATE_ASSET_FILE_NAMES.css)
        .replace("{{EDGE_LINE_CSS_RULES}}", renderEdgeLineCssRules())
        .replace("{{NODE_FILL_CSS_RULES}}", renderNodeFillCssRules());
    const documentMarkup = readGraphVisualizationTemplateAsset(GRAPH_VISUALIZATION_TEMPLATE_ASSET_FILE_NAMES.html)
        .replaceAll("{{DOCUMENT_TITLE}}", documentTitle)
        .replace(
            "{{REGENERATE_BUTTON}}",
            isServerMode
                ? '<button id="regenerate" class="toolbar-chip-button toolbar-accent-button"><span class="button-content"><span class="button-label">Regenerate</span></span></button>'
                : ""
        )
        .replace("{{ARROW_CALLS_COLOR}}", getEdgeLineColor("calls"))
        .replace("{{ARROW_INHERITS_COLOR}}", getEdgeLineColor("inherits"))
        .replace("{{ARROW_DEPENDS_ON_COLOR}}", getEdgeLineColor("depends_on"));
    const htmlDocument = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GMLoop Graph Index - ${documentTitle}</title>
  <link rel="stylesheet" href="./${GRAPH_VISUALIZATION_BUNDLE_FILE_PATHS.stylesheetPath}" />
  <script src="./${GRAPH_VISUALIZATION_BUNDLE_FILE_PATHS.d3ScriptPath}"></script>
</head>
<body>
${documentMarkup}
  <script type="module" src="./${GRAPH_VISUALIZATION_BUNDLE_FILE_PATHS.scriptPath}"></script>
</body>
</html>`;

    const files = Object.freeze([
        createGraphVisualizationBundleFile(
            GRAPH_VISUALIZATION_BUNDLE_FILE_PATHS.entryHtmlPath,
            "text/html; charset=utf-8",
            htmlDocument
        ),
        createGraphVisualizationBundleFile(
            GRAPH_VISUALIZATION_BUNDLE_FILE_PATHS.stylesheetPath,
            "text/css; charset=utf-8",
            stylesheet
        ),
        createGraphVisualizationBundleFile(
            GRAPH_VISUALIZATION_BUNDLE_FILE_PATHS.scriptPath,
            "text/javascript; charset=utf-8",
            moduleScript
        ),
        createGraphVisualizationBundleFile(
            GRAPH_VISUALIZATION_BUNDLE_FILE_PATHS.d3ScriptPath,
            "text/javascript; charset=utf-8",
            readGraphVisualizationVendorAsset(GRAPH_VISUALIZATION_VENDOR_ASSET_FILE_PATHS.d3)
        ),
        createGraphVisualizationBundleFile(
            GRAPH_VISUALIZATION_BUNDLE_FILE_PATHS.browserFsAccessScriptPath,
            "text/javascript; charset=utf-8",
            readGraphVisualizationVendorAsset(GRAPH_VISUALIZATION_VENDOR_ASSET_FILE_PATHS.browserFsAccess)
        )
    ]);

    return Object.freeze({
        entryHtmlPath: GRAPH_VISUALIZATION_BUNDLE_FILE_PATHS.entryHtmlPath,
        files
    });
}

/**
 * Render the self-contained graph visualization HTML document for a graph-index payload.
 */
export function renderGraphVisualizationHtml(
    data: GraphVisualizationData,
    options: GraphVisualizationRenderOptions
): string {
    const bundleArtifact = renderGraphVisualizationBundle(data, options);
    const htmlFile = bundleArtifact.files.find((file) => file.relativePath === bundleArtifact.entryHtmlPath);
    if (!htmlFile) {
        throw new Error("Graph visualization bundle is missing the entry HTML file.");
    }
    return new TextDecoder().decode(htmlFile.bytes);
}
