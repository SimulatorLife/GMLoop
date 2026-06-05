import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    renderGraphVisualizationDocumentTitle,
    serializeGraphVisualizationJsonForInlineScript
} from "./graph-visualization-inline-data.js";
import type {
    GraphVisualizationBundleArtifact,
    GraphVisualizationBundleFile,
    GraphVisualizationData,
    GraphVisualizationRenderOptions
} from "./types.js";

const GRAPH_VISUALIZATION_ENTRY_HTML_PATH = "index.html";
const GRAPH_VISUALIZATION_WEB_ENTRY_RELATIVE_PATH = path.join("src", "web", "index.html");
let staticWebBundleFilesPromise: Promise<ReadonlyArray<GraphVisualizationBundleFile>> | null = null;

function resolveUiWorkspaceRoot(): string {
    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
    let candidateDirectory = moduleDirectory;

    while (candidateDirectory !== path.dirname(candidateDirectory)) {
        if (existsSync(path.join(candidateDirectory, GRAPH_VISUALIZATION_WEB_ENTRY_RELATIVE_PATH))) {
            return candidateDirectory;
        }

        candidateDirectory = path.dirname(candidateDirectory);
    }

    throw new Error("Could not locate the @gmloop/ui workspace source root for graph visualization bundling.");
}

function resolveViteExecutablePath(workspaceRoot: string): string {
    return path.join(workspaceRoot, "node_modules", ".bin", process.platform === "win32" ? "vite.cmd" : "vite");
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
    const serializedOptions = serializeGraphVisualizationJsonForInlineScript({
        ...options,
        documentationCatalogs: options.documentationCatalogs ?? null,
        isServerMode: options.isServerMode === true,
        lastFixRun: options.lastFixRun ?? null,
        liveReload: options.liveReload ?? null,
        loadedTarget: options.loadedTarget ?? null,
        projectConfigurationCatalog: options.projectConfigurationCatalog ?? null,
        startupState: options.startupState ?? null,
        title: options.title
    });

    return [
        "<script>",
        `window.__GMLOOP_GRAPH_VISUALIZATION_DATA__ = ${serializeGraphVisualizationJsonForInlineScript(data)};`,
        `window.__GMLOOP_GRAPH_VISUALIZATION_OPTIONS__ = ${serializedOptions};`,
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
    const workspaceRoot = resolveUiWorkspaceRoot();
    const viteExecutablePath = resolveViteExecutablePath(workspaceRoot);

    await new Promise<void>((resolve, reject) => {
        execFile(
            viteExecutablePath,
            ["build", "--config", path.join(workspaceRoot, "vite.config.ts"), "--outDir", outDirectory],
            {
                cwd: workspaceRoot,
                env: {
                    ...process.env,
                    GMLOOP_UI_BUILD_MANIFEST: "0"
                }
            },
            (error, stdout, stderr) => {
                if (error) {
                    const output = [stdout, stderr]
                        .filter((text) => text.trim().length > 0)
                        .join("\n")
                        .trim();
                    reject(new Error(output.length > 0 ? output : "Failed to build graph visualization bundle."));
                    return;
                }
                resolve();
            }
        );
    });
}

async function createGraphVisualizationWebBundleFiles(): Promise<ReadonlyArray<GraphVisualizationBundleFile>> {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-ui-bundle-"));

    try {
        await createViteWebBundle(outputDirectory);
        const relativePaths = await listBundleFiles(outputDirectory);
        const files = await Promise.all(
            relativePaths.map(async (relativePath) =>
                createGraphVisualizationBundleFile(
                    relativePath,
                    resolveContentType(relativePath),
                    await readFile(path.join(outputDirectory, relativePath))
                )
            )
        );

        return Object.freeze(files);
    } finally {
        await rm(outputDirectory, { force: true, recursive: true });
    }
}

async function getGraphVisualizationWebBundleFiles(
    options: GraphVisualizationRenderOptions
): Promise<ReadonlyArray<GraphVisualizationBundleFile>> {
    if (options.isServerMode === true) {
        return await createGraphVisualizationWebBundleFiles();
    }

    staticWebBundleFilesPromise ??= createGraphVisualizationWebBundleFiles();
    return await staticWebBundleFilesPromise;
}

/**
 * Render the graph visualization as a Lit web-app bundle artifact.
 */
export async function renderGraphVisualizationBundle(
    data: GraphVisualizationData,
    options: GraphVisualizationRenderOptions
): Promise<GraphVisualizationBundleArtifact> {
    const webBundleFiles = await getGraphVisualizationWebBundleFiles(options);
    const files = webBundleFiles.map((file) => {
        const content =
            file.relativePath === GRAPH_VISUALIZATION_ENTRY_HTML_PATH
                ? new TextEncoder().encode(injectBootstrapPayload(new TextDecoder().decode(file.bytes), data, options))
                : file.bytes;

        return createGraphVisualizationBundleFile(file.relativePath, file.contentType, content);
    });

    return Object.freeze({
        entryHtmlPath: GRAPH_VISUALIZATION_ENTRY_HTML_PATH,
        files: Object.freeze(files)
    });
}
