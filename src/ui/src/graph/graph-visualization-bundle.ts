import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
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
        entries.map((entry): Promise<ReadonlyArray<string>> => {
            const absolutePath = path.join(currentDirectory, entry.name);
            if (entry.isDirectory()) {
                return listBundleFiles(rootDirectory, absolutePath);
            }

            return Promise.resolve([path.relative(rootDirectory, absolutePath).split(path.sep).join("/")]);
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
        .replace(
            "<title>GMLoop Graph Visualization</title>",
            () => `<title>GMLoop Graph Index - ${documentTitle}</title>`
        )
        .replace("</head>", () => `${renderBootstrapScript(data, options)}\n</head>`);
}

async function createViteWebBundle(outDirectory: string): Promise<void> {
    const workspaceRoot = resolveUiWorkspaceRoot();

    await new Promise<void>((resolve, reject) => {
        execFile(
            process.platform === "win32" ? "pnpm.cmd" : "pnpm",
            [
                "--filter",
                "@gmloop/ui",
                "exec",
                "vite",
                "build",
                "--config",
                path.join(workspaceRoot, "vite.config.ts"),
                "--outDir",
                outDirectory
            ],
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

type PrebuiltWebDirectory = Readonly<{
    path: string;
    workspaceRoot: string | null;
}>;

function resolvePrebuiltWebDirectory(): PrebuiltWebDirectory | null {
    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
    let workspaceRoot: string | null = null;
    try {
        workspaceRoot = resolveUiWorkspaceRoot();
    } catch {
        // Published packages only include dist output, so no source workspace
        // exists for freshness checks.
    }
    const workspaceWebDirectory = workspaceRoot === null ? null : path.join(workspaceRoot, "dist/web");

    const pathA = path.resolve(moduleDirectory, "../../web");
    if (existsSync(path.join(pathA, GRAPH_VISUALIZATION_ENTRY_HTML_PATH))) {
        return Object.freeze({
            path: pathA,
            workspaceRoot: workspaceWebDirectory === pathA ? workspaceRoot : null
        });
    }

    const pathB = path.resolve(moduleDirectory, "../web");
    if (existsSync(path.join(pathB, GRAPH_VISUALIZATION_ENTRY_HTML_PATH))) {
        return Object.freeze({
            path: pathB,
            workspaceRoot: workspaceWebDirectory === pathB ? workspaceRoot : null
        });
    }

    if (
        workspaceWebDirectory !== null &&
        existsSync(path.join(workspaceWebDirectory, GRAPH_VISUALIZATION_ENTRY_HTML_PATH))
    ) {
        return Object.freeze({ path: workspaceWebDirectory, workspaceRoot });
    }

    if (workspaceWebDirectory !== null) {
        return Object.freeze({ path: workspaceWebDirectory, workspaceRoot });
    }

    return null;
}

async function readNewestModificationTime(directoryPath: string): Promise<number> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const modificationTimes = await Promise.all(
        entries.map(async (entry) => {
            const entryPath = path.join(directoryPath, entry.name);
            if (entry.isDirectory()) {
                return readNewestModificationTime(entryPath);
            }
            const entryStats = await stat(entryPath);
            return entryStats.mtimeMs;
        })
    );
    return Math.max(0, ...modificationTimes);
}

async function isWorkspaceWebBundleFresh(workspaceRoot: string, webDirectory: string): Promise<boolean> {
    const buildStats = await stat(path.join(webDirectory, GRAPH_VISUALIZATION_ENTRY_HTML_PATH)).catch(() => null);
    if (buildStats === null) {
        return false;
    }

    const viteConfigStats = await stat(path.join(workspaceRoot, "vite.config.ts"));
    const buildTime = buildStats.mtimeMs;
    const sourceTime = Math.max(
        await readNewestModificationTime(path.join(workspaceRoot, "src")),
        viteConfigStats.mtimeMs
    );
    return buildTime >= sourceTime;
}

/**
 * Test-only access to graph visualization bundle freshness checks.
 */
export const __graphVisualizationBundleTest__ = Object.freeze({
    isWorkspaceWebBundleFresh,
    resolvePrebuiltWebDirectory
});

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

function isGraphVisualizationBundleTestEnvironment(): boolean {
    return Boolean(
        process.env.CI ||
        process.env.NODE_ENV === "test" ||
        process.env.GMLOOP_TEST === "1" ||
        process.execArgv.some((argument) => argument.includes("test")) ||
        process.argv.some((argument) => argument.includes("test"))
    );
}

async function createGraphVisualizationWebBundleFiles(
    options: {
        allowStalePrebuilt?: boolean;
    } = {}
): Promise<ReadonlyArray<GraphVisualizationBundleFile>> {
    const prebuiltWebDirectory = resolvePrebuiltWebDirectory();
    const hasPrebuiltEntry =
        prebuiltWebDirectory !== null &&
        existsSync(path.join(prebuiltWebDirectory.path, GRAPH_VISUALIZATION_ENTRY_HTML_PATH));
    if (
        hasPrebuiltEntry &&
        prebuiltWebDirectory !== null &&
        (options.allowStalePrebuilt === true ||
            prebuiltWebDirectory.workspaceRoot === null ||
            (await isWorkspaceWebBundleFresh(prebuiltWebDirectory.workspaceRoot, prebuiltWebDirectory.path)))
    ) {
        return loadPrebuiltWebBundleFiles(prebuiltWebDirectory.path);
    }

    if (isGraphVisualizationBundleTestEnvironment()) {
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
            "font-size: var(--gm-text-lg);",
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

function getGraphVisualizationWebBundleFiles(
    options?: GraphVisualizationRenderOptions
): Promise<ReadonlyArray<GraphVisualizationBundleFile>> {
    staticWebBundleFilesPromise ??= createGraphVisualizationWebBundleFiles({
        allowStalePrebuilt: options?.isServerMode === true
    });
    return staticWebBundleFilesPromise;
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
