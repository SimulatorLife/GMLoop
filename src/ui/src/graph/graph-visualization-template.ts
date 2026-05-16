import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

import {
    renderGraphVisualizationDocumentTitle,
    serializeGraphVisualizationDataForInlineScript,
    serializeGraphVisualizationDocumentationCatalogsForInlineScript,
    serializeGraphVisualizationLiveReloadForInlineScript,
    serializeGraphVisualizationLoadedTargetForInlineScript,
    serializeGraphVisualizationProjectConfigurationCatalogForInlineScript,
    serializeGraphVisualizationStartupStateForInlineScript
} from "./graph-visualization-inline-data.js";
import type {
    GraphVisualizationBundleArtifact,
    GraphVisualizationBundleFile,
    GraphVisualizationData,
    GraphVisualizationRenderOptions
} from "./types.js";

const GRAPH_VISUALIZATION_ENTRY_HTML_PATH = "index.html";

function resolveUiSourcePath(relativePath: string): string {
    return fileURLToPath(new URL(`../web/${relativePath}`, import.meta.url));
}

function createGraphVisualizationBundleFile(
    relativePath: string,
    contentType: string,
    bytes: Uint8Array
): GraphVisualizationBundleFile {
    return Object.freeze({
        bytes,
        contentType,
        relativePath
    });
}

function resolveContentType(relativePath: string): string {
    if (relativePath.endsWith(".html")) {
        return "text/html; charset=utf-8";
    }
    if (relativePath.endsWith(".css")) {
        return "text/css; charset=utf-8";
    }
    if (relativePath.endsWith(".js")) {
        return "text/javascript; charset=utf-8";
    }
    if (relativePath.endsWith(".map")) {
        return "application/json; charset=utf-8";
    }

    return "application/octet-stream";
}

async function listBundleFiles(
    rootDirectory: string,
    currentDirectory = rootDirectory
): Promise<ReadonlyArray<string>> {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    const paths = await Promise.all(
        entries.map(async (entry): Promise<ReadonlyArray<string>> => {
            const absolutePath = path.join(currentDirectory, entry.name);
            if (entry.isDirectory()) {
                return await listBundleFiles(rootDirectory, absolutePath);
            }

            return [path.relative(rootDirectory, absolutePath).split(path.sep).join("/")];
        })
    );

    return paths.flat().toSorted();
}

function renderBootstrapScript(data: GraphVisualizationData, options: GraphVisualizationRenderOptions): string {
    const serializedOptions = JSON.stringify({
        ...options,
        documentationCatalogs: options.documentationCatalogs ?? null,
        isServerMode: options.isServerMode === true,
        liveReload: options.liveReload ?? null,
        loadedTarget: options.loadedTarget ?? null,
        projectConfigurationCatalog: options.projectConfigurationCatalog ?? null,
        startupState: options.startupState ?? null,
        title: options.title
    })
        .replaceAll("<", String.raw`\u003c`)
        .replaceAll(">", String.raw`\u003e`)
        .replaceAll("&", String.raw`\u0026`)
        .replaceAll("\u2028", String.raw`\u2028`)
        .replaceAll("\u2029", String.raw`\u2029`);

    return [
        "<script>",
        `window.__GMLOOP_GRAPH_VISUALIZATION_DATA__ = ${serializeGraphVisualizationDataForInlineScript(data)};`,
        `window.__GMLOOP_GRAPH_VISUALIZATION_OPTIONS__ = ${serializedOptions};`,
        `window.__GMLOOP_DOCUMENTATION_CATALOGS__ = ${serializeGraphVisualizationDocumentationCatalogsForInlineScript(options.documentationCatalogs ?? null)};`,
        `window.__GMLOOP_LIVE_RELOAD__ = ${serializeGraphVisualizationLiveReloadForInlineScript(options.liveReload ?? null)};`,
        `window.__GMLOOP_LOADED_TARGET__ = ${serializeGraphVisualizationLoadedTargetForInlineScript(options.loadedTarget ?? null)};`,
        `window.__GMLOOP_PROJECT_CONFIGURATION__ = ${serializeGraphVisualizationProjectConfigurationCatalogForInlineScript(options.projectConfigurationCatalog ?? null)};`,
        `window.__GMLOOP_STARTUP_STATE__ = ${serializeGraphVisualizationStartupStateForInlineScript(options.startupState ?? null)};`,
        "</script>"
    ].join("\n");
}

function injectBootstrapPayload(
    html: string,
    data: GraphVisualizationData,
    options: GraphVisualizationRenderOptions
): string {
    const documentTitle = renderGraphVisualizationDocumentTitle(options.title);
    return html
        .replace("<title>GMLoop Graph Visualization</title>", `<title>GMLoop Graph Index - ${documentTitle}</title>`)
        .replace("</head>", `${renderBootstrapScript(data, options)}\n</head>`);
}

async function createViteWebBundle(outDirectory: string): Promise<void> {
    await build({
        base: "./",
        build: {
            emptyOutDir: true,
            manifest: false,
            outDir: outDirectory,
            rollupOptions: {
                input: resolveUiSourcePath("index.html")
            },
            sourcemap: true,
            target: "es2022"
        },
        configFile: false,
        root: path.dirname(resolveUiSourcePath("index.html")),
        logLevel: "silent"
    });
}

/**
 * Render the graph visualization as a Lit web-app bundle artifact.
 */
export async function renderGraphVisualizationBundle(
    data: GraphVisualizationData,
    options: GraphVisualizationRenderOptions
): Promise<GraphVisualizationBundleArtifact> {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-ui-bundle-"));

    try {
        await createViteWebBundle(outputDirectory);
        const relativePaths = await listBundleFiles(outputDirectory);
        const files = await Promise.all(
            relativePaths.map(async (relativePath) => {
                const bytes = await readFile(path.join(outputDirectory, relativePath));
                const content =
                    relativePath === GRAPH_VISUALIZATION_ENTRY_HTML_PATH
                        ? new TextEncoder().encode(
                              injectBootstrapPayload(new TextDecoder().decode(bytes), data, options)
                          )
                        : bytes;

                return createGraphVisualizationBundleFile(relativePath, resolveContentType(relativePath), content);
            })
        );

        return Object.freeze({
            entryHtmlPath: GRAPH_VISUALIZATION_ENTRY_HTML_PATH,
            files: Object.freeze(files)
        });
    } finally {
        await rm(outputDirectory, { force: true, recursive: true });
    }
}

/**
 * Render the graph visualization HTML document for a graph-index payload.
 */
export async function renderGraphVisualizationHtml(
    data: GraphVisualizationData,
    options: GraphVisualizationRenderOptions
): Promise<string> {
    const bundleArtifact = await renderGraphVisualizationBundle(data, options);
    const htmlFile = bundleArtifact.files.find((file) => file.relativePath === bundleArtifact.entryHtmlPath);
    if (!htmlFile) {
        throw new Error("Graph visualization bundle is missing the entry HTML file.");
    }
    return new TextDecoder().decode(htmlFile.bytes);
}
