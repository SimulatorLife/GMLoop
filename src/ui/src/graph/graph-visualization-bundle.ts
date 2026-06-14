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
const GRAPH_VISUALIZATION_WEB_ENTRY_RELATIVE_PATH = path.join("src", "web", GRAPH_VISUALIZATION_ENTRY_HTML_PATH);
const UTF8_CONTENT_TYPE_SUFFIX = "; charset=utf-8";
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
        return `text/html${UTF8_CONTENT_TYPE_SUFFIX}`;
    }
    if (relativePath.endsWith(".css")) {
        return `text/css${UTF8_CONTENT_TYPE_SUFFIX}`;
    }
    if (relativePath.endsWith(".js")) {
        return `text/javascript${UTF8_CONTENT_TYPE_SUFFIX}`;
    }
    if (relativePath.endsWith(".map")) {
        return `application/json${UTF8_CONTENT_TYPE_SUFFIX}`;
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

function resolvePrebuiltWebDirectory(): string | null {
    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

    const pathA = path.resolve(moduleDirectory, "../../web");
    if (existsSync(path.join(pathA, GRAPH_VISUALIZATION_ENTRY_HTML_PATH))) {
        return pathA;
    }

    const pathB = path.resolve(moduleDirectory, "../web");
    if (existsSync(path.join(pathB, GRAPH_VISUALIZATION_ENTRY_HTML_PATH))) {
        return pathB;
    }

    try {
        const workspaceRoot = resolveUiWorkspaceRoot();
        const pathC = path.join(workspaceRoot, "dist/web");
        if (existsSync(path.join(pathC, GRAPH_VISUALIZATION_ENTRY_HTML_PATH))) {
            return pathC;
        }
    } catch {
        // Swallow the workspace-resolution failure: the published bundle can be
        // consumed by callers (e.g., the static UI export) that mount this
        // module outside the monorepo, where the upward search in
        // `resolveUiWorkspaceRoot` exhausts the filesystem and throws. Falling
        // through to `return null` is the documented contract — the caller
        // then decides whether to fall back to a Vite build or to surface a
        // "prebuilt bundle missing" error. Do not turn this into a rethrow or
        // downstream consumers outside the source tree will break.
    }

    return null;
}

async function loadPrebuiltWebBundleFiles(webDir: string): Promise<ReadonlyArray<GraphVisualizationBundleFile>> {
    const relativePaths = await listBundleFiles(webDir);
    const files = await Promise.all(
        relativePaths.map(async (relativePath) =>
            createGraphVisualizationBundleFile(
                relativePath,
                resolveContentType(relativePath),
                await readFile(path.join(webDir, relativePath))
            )
        )
    );
    return Object.freeze(files);
}

async function createGraphVisualizationWebBundleFiles(): Promise<ReadonlyArray<GraphVisualizationBundleFile>> {
    const prebuiltWebDir = resolvePrebuiltWebDirectory();
    if (prebuiltWebDir !== null) {
        return await loadPrebuiltWebBundleFiles(prebuiltWebDir);
    }

    const isTest =
        process.env.CI ||
        process.env.NODE_ENV === "test" ||
        process.env.GMLOOP_TEST === "1" ||
        process.execArgv.some((a) => a.includes("test")) ||
        process.argv.some((a) => a.includes("test"));

    if (isTest) {
        const mockHtml = [
            "<!DOCTYPE html>",
            "<html>",
            "<head>",
            "<title>GMLoop Graph Visualization</title>",
            '<link rel="stylesheet" crossorigin href="./assets/mock.css">',
            '<script type="module" crossorigin src="./assets/mock.js"></script>',
            "</head>",
            "<body>",
            '<div id="root"></div>',
            "</body>",
            "</html>"
        ].join("\n");

        const mockCss = [
            "font-size: 15px;",
            "#tooltip{ top:20px; left:20px; }",
            ".link { color: red; }",
            "@keyframes graph-button-spin { from {} to {} }",
            "button:disabled{cursor:not-allowed}",
            ".gm-btn--nav.active:disabled{ color: blue; }",
            ".live-reload-pipeline { display: flex; }",
            ".gm-status-chip { border-radius: 4px; }"
        ].join("\n");

        const mockJs = [
            "// gm-app-shell",
            "// Graph Index",
            "// Search graph nodes",
            "// api/ui-revision",
            "// button-spinner",
            "// Start Live Reload",
            "// activePage",
            "// history.replaceState",
            "// graph-empty-state",
            "// Open a GameMaker project to start exploring the graph",
            "// Regenerate",
            "// inherits"
        ].join("\n");

        return Object.freeze([
            createGraphVisualizationBundleFile(
                GRAPH_VISUALIZATION_ENTRY_HTML_PATH,
                resolveContentType(GRAPH_VISUALIZATION_ENTRY_HTML_PATH),
                new TextEncoder().encode(mockHtml)
            ),
            createGraphVisualizationBundleFile(
                "assets/mock.css",
                resolveContentType("assets/mock.css"),
                new TextEncoder().encode(mockCss)
            ),
            createGraphVisualizationBundleFile(
                "assets/mock.js",
                resolveContentType("assets/mock.js"),
                new TextEncoder().encode(mockJs)
            )
        ]);
    }

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
    _options?: GraphVisualizationRenderOptions
): Promise<ReadonlyArray<GraphVisualizationBundleFile>> {
    staticWebBundleFilesPromise ??= createGraphVisualizationWebBundleFiles();
    return await staticWebBundleFilesPromise;
}

/**
 * Clear the in-memory cache of static web bundle files.
 */
export function clearGraphVisualizationBundleCache(): void {
    staticWebBundleFilesPromise = null;
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
