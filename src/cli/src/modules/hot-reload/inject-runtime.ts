import { spawnSync } from "node:child_process";
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Core } from "@gmloop/core";

import { findRepoRootSync, safeStatOrNull } from "../../shared/index.js";

const { getErrorMessageOrFallback, parseJsonWithContext, runSequentially } = Core;

const MODULE_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = findRepoRootSync(MODULE_DIRECTORY);
const HOT_RELOAD_ASSET_MANIFEST_VERSION = 1;

function resolveRepositoryPath(...segments: Array<string>) {
    return path.resolve(REPO_ROOT, ...segments);
}

async function ensureDirectoryExists(dirPath: string) {
    await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Default GameMaker HTML5 temporary output root used on macOS.
 */
export const DEFAULT_GM_TEMP_ROOT = "/private/tmp/GameMakerStudio2/GMS2TEMP";
/**
 * Default runtime wrapper distribution root in the repository.
 */
export const DEFAULT_RUNTIME_WRAPPER_ROOT = resolveRepositoryPath("src", "runtime-wrapper", "dist");
/**
 * Default WebSocket URL for the hot-reload patch server.
 */
export const DEFAULT_WEBSOCKET_URL = "ws://127.0.0.1:17890";
const HOT_RELOAD_DIR_NAME = ".gml-hot-reload";
const HOT_RELOAD_MARKER_START = "<!-- gml-hot-reload:start -->";
const HOT_RELOAD_MARKER_END = "<!-- gml-hot-reload:end -->";

interface HotReloadInjectionOptions {
    html5OutputRoot?: string;
    gmTempRoot?: string;
    websocketUrl?: string;
    runtimeWrapperRoot?: string;
    force?: boolean;
}

interface NormalizedHotReloadInjectionOptions {
    html5OutputRoot: string | null;
    gmTempRoot: string;
    gmTempRootProvided: boolean;
    websocketUrl: string;
    runtimeWrapperRoot: string;
    force: boolean;
}

interface Html5OutputResolution {
    outputRoot: string;
    indexPath: string;
}

interface RuntimeWrapperAssetManifestEntry {
    relativePath: string;
    size: number;
    mtimeMs: number;
}

interface RuntimeWrapperAssetManifest {
    version: number;
    entries: Array<RuntimeWrapperAssetManifestEntry>;
}

export interface HotReloadInjectionResult {
    outputRoot: string;
    indexPath: string;
    runtimeWrapperTargetRoot: string;
    websocketUrl: string;
    injected: boolean;
    copiedAssets: boolean;
}

function normalizeHotReloadInjectionOptions(options: HotReloadInjectionOptions): NormalizedHotReloadInjectionOptions {
    const gmTempRootProvided = typeof options.gmTempRoot === "string" && options.gmTempRoot.trim() ? true : false;
    const gmTempRoot = gmTempRootProvided ? String(options.gmTempRoot).trim() : DEFAULT_GM_TEMP_ROOT;
    const html5OutputRoot =
        typeof options.html5OutputRoot === "string" && options.html5OutputRoot.trim() ? options.html5OutputRoot : null;
    const websocketUrl =
        typeof options.websocketUrl === "string" && options.websocketUrl.trim()
            ? options.websocketUrl
            : DEFAULT_WEBSOCKET_URL;
    const runtimeWrapperRoot =
        typeof options.runtimeWrapperRoot === "string" && options.runtimeWrapperRoot.trim()
            ? options.runtimeWrapperRoot
            : DEFAULT_RUNTIME_WRAPPER_ROOT;
    const force = Boolean(options.force);

    return {
        html5OutputRoot,
        gmTempRoot,
        gmTempRootProvided,
        websocketUrl,
        runtimeWrapperRoot,
        force
    };
}

function readProcessCommandLines(): string {
    const result = spawnSync("ps", ["-ax", "-o", "command="], {
        encoding: "utf8"
    });
    if (result.error) {
        return "";
    }
    return typeof result.stdout === "string" ? result.stdout : "";
}

function extractGmWebServerRoot(commandLine: string): string | null {
    if (!commandLine.includes("GMWebServ")) {
        return null;
    }

    const rootIndex = commandLine.indexOf(" -root ");
    if (rootIndex === -1) {
        return null;
    }

    const afterRoot = commandLine.slice(rootIndex + " -root ".length).trim();
    if (!afterRoot) {
        return null;
    }

    const rootToken = afterRoot.split(/\s+/)[0];
    return rootToken.length > 0 ? rootToken : null;
}

function resolveGmWebServerRoot(): string | null {
    const processLines = readProcessCommandLines()
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    for (const line of processLines) {
        const root = extractGmWebServerRoot(line);
        if (root) {
            return root;
        }
    }

    return null;
}

async function resolveHtml5Output({
    html5OutputRoot,
    gmTempRoot,
    gmTempRootProvided
}: NormalizedHotReloadInjectionOptions): Promise<Html5OutputResolution> {
    const gmWebServerRoot = gmTempRootProvided ? null : resolveGmWebServerRoot();
    if (!html5OutputRoot && gmWebServerRoot) {
        const resolvedRoot = path.resolve(gmWebServerRoot);
        const indexPath = path.join(resolvedRoot, "index.html");
        const stats = await safeStatOrNull(indexPath);
        if (stats?.isFile()) {
            return { outputRoot: resolvedRoot, indexPath };
        }
    }

    if (html5OutputRoot) {
        const resolvedRoot = path.resolve(html5OutputRoot);
        const indexPath = path.join(resolvedRoot, "index.html");
        await fs.stat(indexPath);
        return { outputRoot: resolvedRoot, indexPath };
    }

    const tempRoot = path.resolve(gmTempRoot);
    let entries: Array<Dirent>;
    try {
        entries = await fs.readdir(tempRoot, { withFileTypes: true });
    } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err?.code === "ENOENT") {
            throw new Error(
                `GameMaker HTML5 temporary output root '${tempRoot}' was not found. Run the HTML5 runner (Build → Run for HTML5) once so the directory exists before preparing hot reload.`
            );
        }
        throw error;
    }
    let best: Html5OutputResolution | null = null;
    let bestMtime = 0;

    await runSequentially(entries, async (entry) => {
        if (!entry.isDirectory()) {
            return;
        }

        const outputRoot = path.join(tempRoot, entry.name);
        const indexPath = path.join(outputRoot, "index.html");
        const stats = await safeStatOrNull(indexPath);
        if (!stats) {
            return;
        }

        if (!best || stats.mtimeMs > bestMtime) {
            bestMtime = Number(stats.mtimeMs);
            best = { outputRoot, indexPath };
        }
    });

    if (!best) {
        throw new Error(`No HTML5 index.html found under '${tempRoot}'. Run the GameMaker HTML5 build first.`);
    }

    return best;
}

function shouldCopyRuntimeWrapperAsset(assetPath: string): boolean {
    return !assetPath.endsWith(".d.ts") && !assetPath.endsWith(".d.ts.map");
}

async function collectRuntimeWrapperAssetManifestEntries(
    runtimeWrapperRoot: string
): Promise<Array<RuntimeWrapperAssetManifestEntry>> {
    const manifestEntries: Array<RuntimeWrapperAssetManifestEntry> = [];

    async function scanDirectory(currentPath: string): Promise<void> {
        const directoryEntries = await fs.readdir(currentPath, { withFileTypes: true });

        await runSequentially(directoryEntries, async (entry) => {
            const entryPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
                await scanDirectory(entryPath);
                return;
            }

            if (!entry.isFile() || !shouldCopyRuntimeWrapperAsset(entryPath)) {
                return;
            }

            const stats = await fs.stat(entryPath);
            manifestEntries.push({
                relativePath: path.relative(runtimeWrapperRoot, entryPath),
                size: stats.size,
                mtimeMs: stats.mtimeMs
            });
        });
    }

    await scanDirectory(runtimeWrapperRoot);
    manifestEntries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    return manifestEntries;
}

function createRuntimeWrapperAssetManifest(
    entries: Array<RuntimeWrapperAssetManifestEntry>
): RuntimeWrapperAssetManifest {
    return {
        version: HOT_RELOAD_ASSET_MANIFEST_VERSION,
        entries
    };
}

function areRuntimeWrapperAssetManifestsEqual(
    left: RuntimeWrapperAssetManifest,
    right: RuntimeWrapperAssetManifest
): boolean {
    if (left.version !== right.version || left.entries.length !== right.entries.length) {
        return false;
    }

    return left.entries.every((entry, index) => {
        const candidate = right.entries[index];
        return (
            entry.relativePath === candidate.relativePath &&
            entry.size === candidate.size &&
            entry.mtimeMs === candidate.mtimeMs
        );
    });
}

function isRuntimeWrapperAssetManifestEntry(value: unknown): value is RuntimeWrapperAssetManifestEntry {
    if (!Core.isObjectLike(value)) {
        return false;
    }

    const record = value as Record<string, unknown>;
    return (
        typeof record.relativePath === "string" &&
        typeof record.size === "number" &&
        Number.isFinite(record.size) &&
        typeof record.mtimeMs === "number" &&
        Number.isFinite(record.mtimeMs)
    );
}

function parseRuntimeWrapperAssetManifest(manifestContents: string): RuntimeWrapperAssetManifest | null {
    const parsed: unknown = parseJsonWithContext(manifestContents, {
        description: "runtime wrapper asset manifest"
    });
    if (!Core.isObjectLike(parsed)) {
        return null;
    }

    const parsedRecord = parsed as Record<string, unknown>;
    if (parsedRecord.version !== HOT_RELOAD_ASSET_MANIFEST_VERSION) {
        return null;
    }

    const { entries } = parsedRecord;
    if (!Array.isArray(entries) || !entries.every(isRuntimeWrapperAssetManifestEntry)) {
        return null;
    }

    return createRuntimeWrapperAssetManifest(entries.map((entry) => ({ ...entry })));
}

async function readRuntimeWrapperAssetManifest(manifestPath: string): Promise<RuntimeWrapperAssetManifest | null> {
    const manifestContents = await fs.readFile(manifestPath, "utf8").catch((error) => {
        const maybeFsError = error as NodeJS.ErrnoException;
        if (maybeFsError.code === "ENOENT") {
            return null;
        }
        throw error;
    });

    if (!manifestContents) {
        return null;
    }

    return parseRuntimeWrapperAssetManifest(manifestContents);
}

async function copyRuntimeWrapperAssets(
    runtimeWrapperRoot: string,
    outputRoot: string
): Promise<{ copiedAssets: boolean; runtimeWrapperTargetRoot: string }> {
    const resolvedSource = path.resolve(runtimeWrapperRoot);
    const sourceStats = await fs.stat(resolvedSource).catch((error) => {
        throw new Error(`Runtime wrapper assets not found at '${resolvedSource}': ${getErrorMessageOrFallback(error)}`);
    });

    if (!sourceStats.isDirectory()) {
        throw new Error(`Runtime wrapper root '${resolvedSource}' is not a directory.`);
    }

    const hotReloadRoot = path.join(outputRoot, HOT_RELOAD_DIR_NAME);
    const targetRoot = path.join(hotReloadRoot, "runtime-wrapper");
    const manifestPath = path.join(hotReloadRoot, "runtime-wrapper-assets.manifest.json");
    const sourceManifest = createRuntimeWrapperAssetManifest(
        await collectRuntimeWrapperAssetManifestEntries(resolvedSource)
    );
    const existingManifest = await readRuntimeWrapperAssetManifest(manifestPath);
    const targetStats = await safeStatOrNull(targetRoot);

    if (
        targetStats?.isDirectory() &&
        existingManifest &&
        areRuntimeWrapperAssetManifestsEqual(sourceManifest, existingManifest)
    ) {
        return {
            copiedAssets: false,
            runtimeWrapperTargetRoot: targetRoot
        };
    }

    await ensureDirectoryExists(hotReloadRoot);
    await fs.rm(targetRoot, { recursive: true, force: true });
    await fs.cp(resolvedSource, targetRoot, {
        recursive: true,
        force: true,
        filter: shouldCopyRuntimeWrapperAsset
    });
    await fs.writeFile(manifestPath, Core.stringifyJsonForFile(sourceManifest, { space: 2 }), "utf8");

    return {
        copiedAssets: true,
        runtimeWrapperTargetRoot: targetRoot
    };
}

function buildInjectionSnippet(websocketUrl: string): string {
    return [
        HOT_RELOAD_MARKER_START,
        '<script type="module">',
        'import { createRuntimeWrapper, installScriptCallAdapter } from "./.gml-hot-reload/runtime-wrapper/src/runtime/index.js";',
        'import { createWebSocketClient } from "./.gml-hot-reload/runtime-wrapper/src/websocket/index.js";',
        "const initializeHotReload = () => {",
        '    console.log("[hot-reload] bootstrap loaded");',
        "    const wrapper = createRuntimeWrapper({",
        "        onPatchApplied: (patch, version) => {",
        "            console.log(`[hot-reload] applied ${patch.id} @${version}`);",
        "        }",
        "    });",
        "    installScriptCallAdapter(wrapper);",
        "    createWebSocketClient({",
        `        url: "${websocketUrl}",`,
        "        wrapper,",
        '        onConnect: () => console.log("[hot-reload] connected"),',
        '        onDisconnect: () => console.log("[hot-reload] disconnected"),',
        "        onError: (error, context) => console.error(`[hot-reload] ${context}`, error)",
        "    });",
        "    (function ensureGetRealDefaults() {",
        "        const globalScope =",
        '            typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : null;',
        "        if (!globalScope) {",
        "            return;",
        "        }",
        "        const originalGetReal = globalScope.yyGetReal;",
        '        if (typeof originalGetReal !== "function" || originalGetReal.__hotReloadSafe) {',
        "            return;",
        "        }",
        "        const safeGetReal = function yyGetRealSafe(value) {",
        "            if (value === undefined) {",
        "                return 0;",
        "            }",
        "            return originalGetReal(value);",
        "        };",
        "        safeGetReal.__hotReloadSafe = true;",
        "        globalScope.yyGetReal = safeGetReal;",
        "    })();",
        "};",
        "const ensureHotReloadInitialized = (() => {",
        "    let initialized = false;",
        "    return () => {",
        "        if (initialized) {",
        "            return;",
        "        }",
        "        initialized = true;",
        "        initializeHotReload();",
        "    };",
        "})();",
        'if (document.readyState === "complete") {',
        "    ensureHotReloadInitialized();",
        "} else {",
        '    window.addEventListener("load", ensureHotReloadInitialized, { once: true });',
        "}",
        "</script>",
        HOT_RELOAD_MARKER_END
    ].join("\n");
}

async function injectSnippetIntoIndexHtml({
    indexPath,
    websocketUrl,
    force
}: {
    indexPath: string;
    websocketUrl: string;
    force: boolean;
}): Promise<boolean> {
    const contents = await fs.readFile(indexPath, "utf8");
    if (!force && contents.includes(HOT_RELOAD_MARKER_START)) {
        return false;
    }

    const snippet = buildInjectionSnippet(websocketUrl);
    const closingBodyIndex = contents.search(/<\/body\s*>/i);
    let nextContents: string;

    if (closingBodyIndex === -1) {
        nextContents = `${contents}\n${snippet}\n`;
    } else {
        const head = contents.slice(0, closingBodyIndex);
        const tail = contents.slice(closingBodyIndex);
        nextContents = `${head}${snippet}\n${tail}`;
    }

    await fs.writeFile(indexPath, nextContents, "utf8");
    return true;
}

/**
 * Prepare the GameMaker HTML5 output for hot-reload by copying runtime wrapper
 * assets and injecting the WebSocket bootstrap snippet.
 */
export async function prepareHotReloadInjection(
    options: HotReloadInjectionOptions = {}
): Promise<HotReloadInjectionResult> {
    const normalized = normalizeHotReloadInjectionOptions(options);
    const { outputRoot, indexPath } = await resolveHtml5Output(normalized);
    const { copiedAssets, runtimeWrapperTargetRoot } = await copyRuntimeWrapperAssets(
        normalized.runtimeWrapperRoot,
        outputRoot
    );
    const injected = await injectSnippetIntoIndexHtml({
        indexPath,
        websocketUrl: normalized.websocketUrl,
        force: normalized.force
    });

    return {
        outputRoot,
        indexPath,
        runtimeWrapperTargetRoot,
        websocketUrl: normalized.websocketUrl,
        injected,
        copiedAssets
    };
}

export const __test__ = Object.freeze({
    DEFAULT_GM_TEMP_ROOT,
    DEFAULT_RUNTIME_WRAPPER_ROOT,
    DEFAULT_WEBSOCKET_URL,
    HOT_RELOAD_MARKER_START,
    HOT_RELOAD_MARKER_END,
    normalizeHotReloadInjectionOptions,
    resolveHtml5Output,
    buildInjectionSnippet,
    extractGmWebServerRoot,
    areRuntimeWrapperAssetManifestsEqual,
    collectRuntimeWrapperAssetManifestEntries
});
