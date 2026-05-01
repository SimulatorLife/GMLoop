/**
 * Watch command for monitoring GML source files and coordinating hot-reload pipeline.
 *
 * This command provides the foundation for the live development workflow described in
 * docs/hot-reload.md. It watches specified directories for .gml file changes
 * and triggers appropriate actions (parsing, semantic analysis, transpilation, and patch
 * streaming) as the hot-reload pipeline matures.
 *
 * Current implementation focuses on file system watching and change detection.
 * Future iterations will integrate with the transpiler, semantic analyzer, and runtime
 * wrapper to enable true hot-reloading without game restarts.
 */

import {
    type Dirent,
    existsSync,
    type FSWatcher,
    type Stats,
    watch,
    type WatchListener,
    type WatchOptions
} from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { Core, type DebouncedFunction } from "@gmloop/core";
import { Parser } from "@gmloop/parser";
import { Transpiler } from "@gmloop/transpiler";
import { Command, Option } from "commander";

import { createMinimumValueValidator, portValidator } from "../cli-core/command-parsing.js";
import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { formatCliError } from "../cli-core/errors.js";
import { DEFAULT_GM_TEMP_ROOT, prepareHotReloadInjection } from "../modules/hot-reload/inject-runtime.js";
import {
    type RuntimeStaticServerHandle,
    type RuntimeStaticServerInstance,
    startRuntimeStaticServer
} from "../modules/runtime/server.js";
import {
    DEFAULT_RUNTIME_PACKAGE,
    describeRuntimeSource,
    resolveRuntimeSource,
    type RuntimeSourceDescriptor,
    type RuntimeSourceResolver
} from "../modules/runtime/source.js";
import { startStatusServer, type StatusServerHandle, type StatusServerLifecycle } from "../modules/status/server.js";
import { DependencyTracker } from "../modules/transpilation/dependency-tracker.js";
import {
    displayTranspilationStatistics,
    type ErrorCollector,
    type MetricsCollector,
    orderPatchesForReplay,
    type PatchBroadcastService,
    type PatchHistoryStore,
    registerScriptNamesFromSymbols,
    type RuntimeTranspilerPatch,
    type TranspilationContext,
    type TranspilationResult,
    transpileFile,
    type TranspilerProvider
} from "../modules/transpilation/index.js";
import {
    getRuntimePathSegments,
    resolveScriptFileNameFromSegments
} from "../modules/transpilation/runtime-identifiers.js";
import { extractSymbolsFromAst } from "../modules/transpilation/symbol-extraction.js";
import { type PatchWebSocketServer, startPatchWebSocketServer } from "../modules/websocket/server.js";
import {
    DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_COUNT,
    DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_DELAY_MS,
    DEFAULT_WATCH_DEBOUNCE_DELAY_MS,
    DEFAULT_WATCH_MAX_CONCURRENT_DIRS,
    DEFAULT_WATCH_MAX_PATCH_HISTORY,
    DEFAULT_WATCH_POLLING_INTERVAL_MS
} from "./watch/constants.js";
import {
    clearInitialFileDataCache,
    computeHotReloadLatencyStats,
    countSourceLines,
    createExtensionMatcher,
    type ExtensionMatcher,
    hashSourceContent,
    type InitialFileData,
    readSourceFileWithTransientEmptyRetry,
    resolveUnknownScanConcurrency,
    takeInitialFileData
} from "./watch/source-analysis.js";

const { debounce, getErrorMessage, isErrorWithCode } = Core;

type RuntimeDescriptorFormatter = (source: RuntimeSourceDescriptor) => string;

type WatchFactory = (
    path: string,
    options?: WatchOptions | BufferEncoding | "buffer",
    listener?: WatchListener<string>
) => FSWatcher;

const noopAbortListener = () => {};

/**
 * Configuration for file watching behavior.
 * Controls which files to monitor and how to detect changes.
 */
interface FileWatchingConfig {
    extensions?: Array<string>;
    polling?: boolean;
    pollingInterval?: number;
    debounceDelay?: number;
    maxConcurrentDirs?: number;
    transientEmptyFileReadRetryCount?: number;
    transientEmptyFileReadRetryDelayMs?: number;
    watchFactory?: WatchFactory;
}

/**
 * Configuration for logging and console output.
 * Controls verbosity and output suppression.
 */
interface LoggingConfig {
    verbose?: boolean;
    quiet?: boolean;
}

/**
 * Configuration for the WebSocket server used to stream patches.
 * Enables real-time hot-reload patch delivery to connected clients.
 */
interface WebSocketServerConfig {
    websocketPort?: number;
    websocketHost?: string;
    websocketServer?: boolean;
}

/**
 * Configuration for the HTTP status server.
 * Provides queryable endpoints for watch command status.
 */
interface StatusServerConfig {
    statusPort?: number;
    statusHost?: string;
    statusServer?: boolean;
}

/**
 * Configuration for the HTML5 runtime static server.
 * Controls runtime asset serving and resolution.
 */
interface RuntimeServerConfig {
    runtimeRoot?: string;
    runtimePackage?: string;
    runtimeServer?: boolean;
    hydrateRuntime?: boolean;
    runtimeResolver?: RuntimeSourceResolver;
    runtimeDescriptor?: RuntimeDescriptorFormatter;
    runtimeServerStarter?: typeof startRuntimeStaticServer;
}

/**
 * Configuration for hot-reload injection and patch management.
 * Controls automatic runtime wrapper injection and patch history.
 */
interface HotReloadConfig {
    autoInject?: boolean;
    html5Output?: string;
    gmTempRoot?: string;
    maxPatchHistory?: number;
}

/**
 * Infrastructure configuration for testing and lifecycle management.
 * Provides abort signals and other cross-cutting concerns.
 */
interface InfrastructureConfig {
    abortSignal?: AbortSignal;
    onWebSocketServerReady?: (server: PatchWebSocketServer) => void;
    onStatusServerReady?: (server: StatusServerHandle) => void;
}

/**
 * Complete configuration for the watch command.
 * Composes all specialized configuration interfaces into a single contract.
 */
interface WatchCommandOptions
    extends FileWatchingConfig,
        LoggingConfig,
        WebSocketServerConfig,
        StatusServerConfig,
        RuntimeServerConfig,
        HotReloadConfig,
        InfrastructureConfig {}

/**
 * Core transpilation capabilities required for processing file changes.
 * Focuses on the essential dependencies needed to transpile GML files.
 *
 * Extends TranspilerProvider to demonstrate proper ISP usage with
 * segregated interfaces.
 */
interface TranspilationDependencies extends TranspilerProvider {
    dependencyTracker: DependencyTracker;
}

/**
 * Runtime package metadata and server handles.
 * Separates server management concerns from core transpilation.
 */
interface RuntimePackageInfo {
    root: string | null;
    packageName: string | null;
    packageJson: Record<string, unknown> | null;
    server: RuntimeStaticServerHandle | null;
    noticeLogged: boolean;
}

/**
 * Patch history and metrics tracking.
 * Groups patch management and monitoring concerns together.
 *
 * Composes segregated interfaces to demonstrate proper ISP usage.
 * Prefer depending on individual interfaces (PatchHistoryStore, MetricsCollector, ErrorCollector)
 * when only specific capabilities are needed.
 */
interface PatchHistory extends PatchHistoryStore, MetricsCollector, ErrorCollector {}

/**
 * Server controllers for patch streaming and status endpoints.
 * Isolates server infrastructure from core transpilation logic.
 *
 * Extends PatchBroadcastService to demonstrate proper ISP usage.
 */
interface ServerControllers extends PatchBroadcastService {
    statusServer: StatusServerLifecycle | null;
}

/**
 * Watch command lifecycle management.
 * Tracks command start time and debounced file change handlers.
 */
interface WatchLifecycle {
    startTime: number;
    debouncedHandlers: Map<string, DebouncedFunction<[string, string, FileChangeOptions]>>;
    scanComplete: boolean;
    unknownScanPromise: Promise<void> | null;
    unknownScanQueued: boolean;
    unknownScanConcurrency: number;
    dependentRetranspileConcurrency: number;
}

/**
 * Complete runtime context for the watch command.
 * Composes all role-focused interfaces. Prefer depending on specific
 * role interfaces (TranspilationDependencies, PatchHistory, etc.) rather
 * than this composite when possible.
 */
interface RuntimeContext
    extends Omit<
            TranspilationContext,
            | "transpiler"
            | "patches"
            | "metrics"
            | "errors"
            | "lastSuccessfulPatches"
            | "maxPatchHistory"
            | "websocketServer"
        >,
        TranspilationDependencies,
        RuntimePackageInfo,
        PatchHistory,
        ServerControllers,
        WatchLifecycle {
    watchRoot: string;
    extensionMatcher: ExtensionMatcher;
    maxConcurrentDirs: number;
    scriptNames: Set<string>;
    fileSnapshots: Map<string, number>;
    /** SHA-256 prefix of each file's last-transpiled source text.
     * Used to skip transpilation when a file's mtime changes but content is
     * identical (e.g., redundant editor saves or `touch` operations). */
    fileContentHashes: Map<string, string>;
    /** UTF-16 code-unit length of each file's last-transpiled source text.
     * Used as a low-cost pre-check to avoid hashing when content length changed. */
    fileContentLengths: Map<string, number>;
    transientEmptyFileReadRetryCount: number;
    transientEmptyFileReadRetryDelayMs: number;
}

/**
 * Runtime state required to derive script names from changed files.
 */
interface ScriptNameRegistrationContext {
    scriptNames: Set<string>;
}

/**
 * Runtime state required when removing cached data for deleted files.
 */
interface FileRemovalCleanupContext {
    scriptNames: Set<string>;
    dependencyTracker: DependencyTracker;
    fileSnapshots: Map<string, number>;
    fileContentHashes: Map<string, string>;
    fileContentLengths: Map<string, number>;
    lastSuccessfulPatches: Map<string, RuntimeTranspilerPatch>;
    debouncedHandlers: Map<string, DebouncedFunction<[string, string, FileChangeOptions]>>;
}

/**
 * Runtime state required when recording file modification snapshots.
 */
interface FileSnapshotWriter {
    fileSnapshots: Map<string, number>;
}

interface FileChangeOptions extends LoggingConfig {
    runtimeContext?: RuntimeContext;
    fileStats?: Stats | null;
    abortSignal?: AbortSignal;
    /** Wall-clock timestamp (Date.now()) when the filesystem change event was first detected. */
    fileChangeDetectedAt?: number;
}

async function runAutoInjectHotReload(
    quiet: boolean,
    verbose: boolean,
    websocketHost: string,
    websocketPort: number,
    html5Output: string | undefined,
    gmTempRoot: string
): Promise<void> {
    if (!quiet) {
        console.log("Preparing hot-reload injection...");
    }

    try {
        const websocketUrl = `ws://${websocketHost}:${websocketPort}`;
        const injectionResult = await prepareHotReloadInjection({
            html5OutputRoot: html5Output,
            gmTempRoot,
            websocketUrl,
            force: false
        });

        if (!quiet) {
            const injectedMessage = injectionResult.injected
                ? "Injected hot-reload snippet into HTML5 output."
                : "Hot-reload snippet already present in HTML5 output.";
            console.log(injectedMessage);
            if (verbose) {
                console.log(`  HTML5 output: ${injectionResult.outputRoot}`);
                console.log(`  Index file: ${injectionResult.indexPath}`);
                console.log(`  Runtime wrapper: ${injectionResult.runtimeWrapperTargetRoot}`);
                console.log(`  WebSocket URL: ${injectionResult.websocketUrl}`);
            }
        }
    } catch (error) {
        const message = getErrorMessage(error, {
            fallback: "Unknown hot-reload injection error"
        });
        const formattedError = formatCliError(new Error(`Failed to prepare hot-reload injection: ${message}`));
        console.error(formattedError);
        process.exit(1);
    }
}

/**
 * Creates the watch command for monitoring GML source files.
 *
 * @returns {Command} Commander command instance
 */
export function createWatchCommand(): Command {
    const command = new Command("watch");

    applyStandardCommandOptions(command);

    command
        .description("Watch GML source files and coordinate hot-reload pipeline actions")
        .argument("[targetPath]", "Directory to watch for changes", process.cwd())
        .addOption(
            new Option("--extensions <extensions...>", "File extensions to watch").default(
                [".gml"],
                "Defaults to .gml; custom extensions are allowed"
            )
        )
        .addOption(new Option("--polling", "Use polling instead of native file watching").default(false))
        .addOption(
            new Option("--polling-interval <ms>", "Polling interval in milliseconds")
                .argParser(createMinimumValueValidator(100, "Polling interval must be at least 100ms"))
                .default(DEFAULT_WATCH_POLLING_INTERVAL_MS)
        )
        .addOption(new Option("--verbose", "Enable verbose logging").default(false))
        .addOption(
            new Option("--quiet", "Suppress non-essential output (only show errors and server URLs)").default(false)
        )
        .addOption(
            new Option(
                "--debounce-delay <ms>",
                "Delay in milliseconds before transpiling after file changes (0 for immediate processing)"
            )
                .argParser(createMinimumValueValidator(0, "Debounce delay must be non-negative"))
                .default(DEFAULT_WATCH_DEBOUNCE_DELAY_MS)
        )
        .addOption(
            new Option(
                "--max-concurrent-dirs <count>",
                "Maximum number of directories to scan concurrently during initial file discovery"
            )
                .argParser(createMinimumValueValidator(1, "Max concurrent directories must be at least 1"))
                .default(DEFAULT_WATCH_MAX_CONCURRENT_DIRS)
        )
        .addOption(
            new Option("--max-patch-history <count>", "Maximum number of patches to retain in memory")
                .argParser(createMinimumValueValidator(1, "Max patch history must be a positive integer"))
                .default(DEFAULT_WATCH_MAX_PATCH_HISTORY)
        )
        .addOption(
            new Option(
                "--transient-empty-file-read-retry-count <count>",
                "Number of retry attempts when a changed file is temporarily observed as empty"
            )
                .argParser(
                    createMinimumValueValidator(1, "Transient empty-file read retry count must be a positive integer")
                )
                .default(DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_COUNT)
        )
        .addOption(
            new Option(
                "--transient-empty-file-read-retry-delay-ms <ms>",
                "Delay in milliseconds between transient empty-file read retry attempts"
            )
                .argParser(createMinimumValueValidator(0, "Transient empty-file read retry delay must be non-negative"))
                .default(DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_DELAY_MS)
        )
        .addOption(
            new Option("--websocket-port <port>", "WebSocket server port for streaming patches")
                .argParser(portValidator)
                .default(17_890)
        )
        .addOption(
            new Option("--websocket-host <host>", "WebSocket server host for streaming patches").default("127.0.0.1")
        )
        .option("--no-websocket-server", "Disable starting the WebSocket server for patch streaming.")
        .addOption(
            new Option("--status-port <port>", "HTTP status server port for querying watch command status")
                .argParser(portValidator)
                .default(17_891)
        )
        .addOption(
            new Option("--status-host <host>", "HTTP status server host for querying watch command status").default(
                "127.0.0.1"
            )
        )
        .option("--no-status-server", "Disable starting the HTTP status server.")
        .addOption(
            new Option(
                "--runtime-root <path>",
                "Path to the HTML5 runtime assets (defaults to the vendor/GameMaker-HTML5 submodule when present, otherwise the installed runtime package)."
            )
        )
        .addOption(
            new Option("--runtime-package <name>", "Package name used to resolve the HTML5 runtime.").default(
                DEFAULT_RUNTIME_PACKAGE
            )
        )
        .option("--no-runtime-server", "Disable starting the HTML5 runtime static server.")
        .addOption(
            new Option(
                "--auto-inject",
                "Automatically inject the hot-reload runtime wrapper into the HTML5 output directory before starting the watcher"
            ).default(false)
        )
        .addOption(
            new Option(
                "--html5-output <path>",
                "Path to the HTML5 output directory for auto-injection (overrides auto-detection)"
            )
        )
        .addOption(
            new Option(
                "--gm-temp-root <path>",
                "Root directory for GameMaker HTML5 temporary outputs (used with --auto-inject)"
            ).default(DEFAULT_GM_TEMP_ROOT)
        )
        .action(runWatchCommand);

    return command;
}

/**
 * Recursively scans a directory for GML files and processes them to build the initial dependency graph.
 *
 * @param {string} dirPath - Directory to scan
 * @param {ExtensionMatcher} extensionMatcher - File extension matcher
 * @param {RuntimeContext} runtimeContext - Runtime context with transpiler and dependency tracker
 * @param {boolean} verbose - Whether verbose logging is enabled
 * @param {boolean} quiet - Whether quiet mode is enabled
 * @param {number} maxConcurrentDirs - Maximum number of directories to scan concurrently
 */
async function performInitialScan(
    dirPath: string,
    extensionMatcher: ExtensionMatcher,
    runtimeContext: RuntimeContext,
    verbose: boolean,
    quiet: boolean,
    maxConcurrentDirs: number,
    fileDataCache?: Map<string, InitialFileData>
): Promise<void> {
    const { getErrorMessage: getCoreErrorMessage } = Core;

    async function processFile(fullPath: string): Promise<void> {
        try {
            // Reuse the cached content and AST from the script-name collection pass when
            // available. This avoids a second disk read and a second ANTLR parse for every
            // file that was already processed during startup, cutting initial scan overhead
            // roughly in half for typical GML projects.
            const cached = takeInitialFileData(fileDataCache, fullPath);
            const content = cached?.content ?? (await readFile(fullPath, "utf8"));
            const cachedAst = cached?.ast;
            const lines = countSourceLines(content);
            await updateFileSnapshot(runtimeContext, fullPath);

            // Store the initial content hash so that change events immediately after
            // startup are skipped if the file content has not actually changed.
            runtimeContext.fileContentHashes.set(fullPath, hashSourceContent(content));
            runtimeContext.fileContentLengths.set(fullPath, content.length);

            ensureScriptNameRegistered(fullPath, runtimeContext.scriptNames);

            // Transpile the file (quietly unless verbose mode is on)
            const result = transpileFile(runtimeContext, fullPath, content, lines, {
                verbose: false,
                quiet: true,
                cachedAst
            });

            // Track symbols and references
            if (result.success) {
                runtimeContext.dependencyTracker.replaceFileDefines(fullPath, result.symbols ?? []);
                runtimeContext.dependencyTracker.replaceFileReferences(fullPath, result.references ?? []);
            }
        } catch (error) {
            if (verbose && !quiet) {
                const message = getCoreErrorMessage(error, {
                    fallback: "Unknown file read error"
                });
                console.error(`  Warning: Could not process ${path.basename(fullPath)}: ${message}`);
            }
        }
    }

    async function scanDirectory(currentPath: string): Promise<void> {
        try {
            const entries = await readdir(currentPath, { withFileTypes: true });

            // Delegate low-level entry partitioning so this orchestration flow
            // stays focused on high-level scan steps.
            const { files, directories } = partitionScannedDirectoryEntries(currentPath, entries, extensionMatcher);

            // Process all files in this directory concurrently for maximum throughput
            await Core.runInParallel(files, async (filePath) => {
                await processFile(filePath);
            });

            // Traverse subdirectories with bounded parallelism to balance throughput
            // and resource usage. Limit concurrent directory operations to avoid
            // exhausting file handles while maintaining faster scan than sequential.
            await Core.runInParallelWithLimit(
                directories,
                async (subDirPath) => {
                    await scanDirectory(subDirPath);
                },
                maxConcurrentDirs
            );
        } catch (error) {
            if (verbose && !quiet) {
                const message = getCoreErrorMessage(error, {
                    fallback: "Unknown directory read error"
                });
                console.error(`  Warning: Could not scan directory ${currentPath}: ${message}`);
            }
        }
    }

    // When the startup file cache is populated, every tracked file was already
    // discovered and read during collectScriptNames. Process them directly from the
    // cache keys, eliminating a second round of readdir calls across the project tree.
    // Files that failed to read or parse in collectScriptNames are not in the cache;
    // they will be processed on their first watch event instead.
    await (fileDataCache !== undefined && fileDataCache.size > 0
        ? Core.runInParallel(Array.from(fileDataCache.keys()), processFile)
        : scanDirectory(dirPath));

    const stats = runtimeContext.dependencyTracker.getStatistics();
    if (!quiet) {
        if (verbose) {
            console.log(
                `Initial scan complete: ${stats.totalSymbols} symbols tracked across ${stats.totalFiles} files`
            );
            console.log(`  Files with definitions: ${stats.filesWithDefs}`);
            console.log(`  Files with references: ${stats.filesWithRefs}`);
            console.log(`  Average definitions per file: ${stats.averageDefsPerFile.toFixed(1)}`);
            console.log(`  Average references per file: ${stats.averageRefsPerFile.toFixed(1)}`);
        } else {
            console.log(`Scanned ${stats.totalFiles} files, tracking ${stats.totalSymbols} symbols`);
        }
    }
}

/**
 * Validates and resolves the target directory path.
 *
 * @param {string} targetPath - Directory to validate
 * @returns {Promise<string>} Resolved absolute path
 */
async function validateTargetPath(targetPath: string): Promise<string> {
    const normalizedPath = path.resolve(targetPath);

    try {
        const stats = await stat(normalizedPath);
        if (!stats.isDirectory()) {
            console.error(`${normalizedPath} is not a directory`);
            process.exit(1);
        }
    } catch (error) {
        const message = getErrorMessage(error, {
            fallback: "Cannot access path"
        });
        const formattedError = formatCliError(new Error(`Cannot access ${normalizedPath}: ${message}`));
        console.error(formattedError);
        process.exit(1);
    }

    return normalizedPath;
}

/**
 * Logs watch startup information.
 *
 * @param {string} targetPath - Directory being watched
 * @param {Set<string>} extensions - File extensions being watched
 * @param {boolean} polling - Whether polling mode is enabled
 * @param {number} pollingInterval - Polling interval in ms
 * @param {boolean} verbose - Whether verbose logging is enabled
 * @param {boolean} quiet - Whether quiet mode is enabled
 */
function logWatchStartup(
    targetPath: string,
    extensions: ReadonlySet<string>,
    polling: boolean,
    pollingInterval: number,
    verbose: boolean,
    quiet: boolean
) {
    if (quiet) {
        // In quiet mode, don't log startup information
        return;
    }

    if (verbose) {
        console.log(`Watching: ${targetPath}`);
        console.log(`Extensions: ${[...extensions].join(", ")}`);
        console.log(`Mode: ${polling ? "polling" : "native"}`);
        if (polling) {
            console.log(`Polling interval: ${pollingInterval}ms`);
        }
        console.log("\nWaiting for file changes... (Press Ctrl+C to stop)\n");
    } else {
        console.log(`Watching ${targetPath} for changes...`);
    }
}

/**
 * Executes the watch command.
 *
 * @param {string} targetPath - Directory to watch
 * @param {object} options - Command options
 * @param {string[]} options.extensions - File extensions to watch
 * @param {boolean} options.polling - Use polling instead of native watching
 * @param {number} options.pollingInterval - Polling interval in milliseconds
 * @param {boolean} options.verbose - Enable verbose logging
 * @param {number} options.websocketPort - WebSocket server port
 * @param {string} options.websocketHost - WebSocket server host
 * @param {boolean} options.websocketServer - Enable WebSocket server
 */
export async function runWatchCommand(targetPath: string, options: WatchCommandOptions = {}): Promise<void> {
    const {
        extensions = [".gml"],
        polling = false,
        pollingInterval = DEFAULT_WATCH_POLLING_INTERVAL_MS,
        verbose = false,
        quiet = false,
        // Optimized for minimal hot-reload latency while still batching rapid successive edits.
        // 100ms provides immediate feedback for single-file changes while preventing redundant
        // transpilations during rapid editing (e.g., auto-save + manual save).
        debounceDelay = DEFAULT_WATCH_DEBOUNCE_DELAY_MS,
        maxConcurrentDirs = DEFAULT_WATCH_MAX_CONCURRENT_DIRS,
        maxPatchHistory = DEFAULT_WATCH_MAX_PATCH_HISTORY,
        transientEmptyFileReadRetryCount = DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_COUNT,
        transientEmptyFileReadRetryDelayMs = DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_DELAY_MS,
        websocketPort = 17_890,
        websocketHost = "127.0.0.1",
        websocketServer: enableWebSocket = true,
        statusPort = 17_891,
        statusHost = "127.0.0.1",
        statusServer: enableStatus = true,
        abortSignal,
        onWebSocketServerReady,
        onStatusServerReady,
        runtimeRoot,
        runtimePackage = DEFAULT_RUNTIME_PACKAGE,
        runtimeServer,
        hydrateRuntime,
        autoInject = false,
        html5Output,
        gmTempRoot = DEFAULT_GM_TEMP_ROOT,
        runtimeResolver = resolveRuntimeSource,
        runtimeDescriptor = describeRuntimeSource,
        runtimeServerStarter = startRuntimeStaticServer,
        watchFactory = watch
    } = options;
    const unknownServerStopErrorMessage = "Unknown server stop error";

    // Validate that verbose and quiet are not both enabled
    if (verbose && quiet) {
        console.error("Error: --verbose and --quiet cannot be used together");
        process.exit(1);
    }

    const normalizedPath = await validateTargetPath(targetPath);

    const extensionMatcher = createExtensionMatcher(extensions);
    const extensionSet = extensionMatcher.extensions;

    const { scriptNames, fileDataCache } = await collectScriptNames(
        normalizedPath,
        extensionMatcher,
        maxConcurrentDirs
    );

    // Auto-inject hot-reload runtime wrapper if requested
    if (autoInject) {
        await runAutoInjectHotReload(quiet, verbose, websocketHost, websocketPort, html5Output, gmTempRoot);
    }

    const shouldServeRuntime = hydrateRuntime === undefined ? runtimeServer !== false : Boolean(hydrateRuntime);

    const semanticOracle = Transpiler.createSemanticOracle({ scriptNames });
    const transpiler = new Transpiler.GmlTranspiler({
        semantic: semanticOracle
    });
    const dependencyTracker = new DependencyTracker();
    const runtimeContext: RuntimeContext = {
        watchRoot: normalizedPath,
        extensionMatcher,
        maxConcurrentDirs,
        root: null,
        packageName: null,
        packageJson: null,
        server: null,
        noticeLogged: Boolean(verbose),
        transpiler,
        scriptNames,
        patches: [],
        metrics: [],
        errors: [],
        lastSuccessfulPatches: new Map(),
        maxPatchHistory,
        totalPatchCount: 0,
        websocketServer: null,
        statusServer: null,
        startTime: Date.now(),
        debouncedHandlers: new Map(),
        scanComplete: false,
        unknownScanPromise: null,
        unknownScanQueued: false,
        unknownScanConcurrency: resolveUnknownScanConcurrency(maxConcurrentDirs),
        dependentRetranspileConcurrency: resolveUnknownScanConcurrency(maxConcurrentDirs),
        fileSnapshots: new Map(),
        fileContentHashes: new Map(),
        fileContentLengths: new Map(),
        dependencyTracker,
        transientEmptyFileReadRetryCount,
        transientEmptyFileReadRetryDelayMs
    };

    let runtimeServerController: RuntimeStaticServerInstance | null = null;
    let websocketServerController: PatchWebSocketServer | null = null;
    let statusServerController: StatusServerHandle | null = null;

    if (shouldServeRuntime) {
        const runtimeSource = await runtimeResolver({
            runtimeRoot,
            runtimePackage
        });

        runtimeContext.root = runtimeSource.root;
        runtimeContext.packageName = runtimeSource.packageName;
        runtimeContext.packageJson = runtimeSource.packageJson;

        if (verbose && !quiet) {
            console.log(`Using HTML5 runtime from ${runtimeDescriptor(runtimeSource)}`);
        }

        runtimeServerController = await runtimeServerStarter({
            runtimeRoot: runtimeSource.root,
            verbose
        });

        runtimeContext.server = runtimeServerController;

        console.log(`Runtime static server ready at ${runtimeServerController.url}`);
    } else if (verbose && !quiet) {
        console.log("Runtime static server disabled.");
    }

    if (enableWebSocket) {
        try {
            websocketServerController = await startPatchWebSocketServer({
                host: websocketHost,
                port: websocketPort,
                verbose,
                onClientConnect: (clientId, _socket) => {
                    void _socket;
                    if (verbose) {
                        console.log(`Patch streaming client connected: ${clientId}`);
                    }
                },
                prepareInitialMessages: () => {
                    removeDeletedCachedPatchSources(runtimeContext, verbose, quiet);
                    return orderPatchesForReplay(Array.from(runtimeContext.lastSuccessfulPatches.values()));
                },
                onClientDisconnect: (clientId) => {
                    if (verbose) {
                        console.log(`Patch streaming client disconnected: ${clientId}`);
                    }
                }
            });

            runtimeContext.websocketServer = websocketServerController;
            onWebSocketServerReady?.(websocketServerController);

            console.log(`WebSocket patch server ready at ${websocketServerController.url}`);
        } catch (error) {
            const message = getErrorMessage(error, {
                fallback: "Unknown WebSocket server error"
            });
            const formattedError = formatCliError(new Error(`Failed to start WebSocket server: ${message}`));
            console.error(formattedError);

            if (runtimeServerController) {
                try {
                    await runtimeServerController.stop();
                } catch (stopError) {
                    const stopMessage = getErrorMessage(stopError, {
                        fallback: unknownServerStopErrorMessage
                    });
                    console.error(`Failed to stop runtime server during cleanup: ${stopMessage}`);
                }
            }

            process.exit(1);
        }
    } else if (verbose && !quiet) {
        console.log("WebSocket patch server disabled.");
    }

    if (enableStatus) {
        try {
            statusServerController = await startStatusServer({
                host: statusHost,
                port: statusPort,
                getSnapshot: () => {
                    const latencyStats = computeHotReloadLatencyStats(runtimeContext.metrics);
                    return {
                        uptime: Date.now() - runtimeContext.startTime,
                        patchCount: runtimeContext.metrics.length,
                        totalPatchCount: runtimeContext.totalPatchCount,
                        patchHistorySize: runtimeContext.patches.length,
                        maxPatchHistory: runtimeContext.maxPatchHistory,
                        errorCount: runtimeContext.errors.length,
                        recentPatches: runtimeContext.metrics.slice(-10).map((m) => ({
                            id: m.patchId,
                            timestamp: m.timestamp,
                            durationMs: m.durationMs,
                            filePath: path.relative(normalizedPath, m.filePath),
                            hotReloadLatencyMs: m.hotReloadLatencyMs
                        })),
                        recentErrors: runtimeContext.errors.slice(-10).map((e) => ({
                            timestamp: e.timestamp,
                            filePath: path.relative(normalizedPath, e.filePath),
                            error: e.error
                        })),
                        websocketClients: runtimeContext.websocketServer?.getClientCount() ?? 0,
                        scanComplete: runtimeContext.scanComplete,
                        avgHotReloadLatencyMs: latencyStats?.avg,
                        p95HotReloadLatencyMs: latencyStats?.p95
                    };
                }
            });

            runtimeContext.statusServer = statusServerController;
            onStatusServerReady?.(statusServerController);

            console.log(`Status server ready at ${statusServerController.url}`);
        } catch (error) {
            const message = getErrorMessage(error, {
                fallback: "Unknown status server error"
            });
            const formattedError = formatCliError(new Error(`Failed to start status server: ${message}`));
            console.error(formattedError);

            if (runtimeServerController) {
                try {
                    await runtimeServerController.stop();
                } catch (stopError) {
                    const stopMessage = getErrorMessage(stopError, {
                        fallback: unknownServerStopErrorMessage
                    });
                    console.error(`Failed to stop runtime server during cleanup: ${stopMessage}`);
                }
            }

            if (websocketServerController) {
                try {
                    await websocketServerController.stop();
                } catch (stopError) {
                    const stopMessage = getErrorMessage(stopError, {
                        fallback: unknownServerStopErrorMessage
                    });
                    console.error(`Failed to stop WebSocket server during cleanup: ${stopMessage}`);
                }
            }

            process.exit(1);
        }
    } else if (verbose && !quiet) {
        console.log("Status server disabled.");
    }

    logWatchStartup(normalizedPath, extensionSet, polling, pollingInterval, verbose, quiet);

    const watchOptions: WatchOptions = {
        recursive: true,
        ...(polling && { persistent: true })
    };
    let watcher: FSWatcher | null = null;
    let resolved = false;

    // Internal abort controller used to cancel in-flight file reads (including
    // transient-empty retry timers) when the watcher shuts down. This is separate
    // from the caller-supplied abortSignal, which may not be set in the SIGINT/SIGTERM
    // path. Both signals are threaded to scheduleUnknownFileChanges so that retry
    // timers created by delayFileReadRetry are cancelled promptly on shutdown.
    const internalAbortController = new AbortController();

    return new Promise((resolve) => {
        let removeAbortListener = noopAbortListener;

        const cleanup = async (exitCode = 0) => {
            if (resolved) {
                return;
            }
            resolved = true;

            // Abort any in-flight file reads before closing the watcher. This ensures
            // that transient-empty retry timers created by delayFileReadRetry (in the
            // unknown-scan path) are cancelled even when no external AbortSignal was
            // provided (e.g., SIGINT/SIGTERM without an AbortController from the caller).
            internalAbortController.abort();

            if (verbose && !quiet) {
                console.log("\nStopping watcher...");
            }

            if (watcher) {
                watcher.close();
            }

            process.off("SIGINT", handleErrorSignal);
            process.off("SIGTERM", handleErrorSignal);
            removeAbortListener();

            // Cancel (not flush) all pending debounced handlers. Flushing would invoke each
            // callback immediately after the watcher has already been closed, spawning new
            // async file reads and — for transiently-empty files — new setTimeout timers via
            // delayFileReadRetry() that would outlive the cleanup phase (resource leak).
            // Cancelling discards the pending work cleanly. The internalAbortController
            // above provides a second layer of defense for any handler that did start.
            for (const debouncedHandler of runtimeContext.debouncedHandlers.values()) {
                debouncedHandler.cancel();
            }
            runtimeContext.debouncedHandlers.clear();

            displayTranspilationStatistics(runtimeContext, verbose, quiet);

            if (runtimeServerController) {
                try {
                    await runtimeServerController.stop();
                } catch (error) {
                    const message = getErrorMessage(error, {
                        fallback: unknownServerStopErrorMessage
                    });
                    console.error(`Failed to stop runtime static server: ${message}`);
                }
            }

            if (websocketServerController) {
                try {
                    await websocketServerController.stop();
                } catch (error) {
                    const message = getErrorMessage(error, {
                        fallback: unknownServerStopErrorMessage
                    });
                    console.error(`Failed to stop WebSocket server: ${message}`);
                }
            }

            if (statusServerController) {
                try {
                    await statusServerController.stop();
                } catch (error) {
                    const message = getErrorMessage(error, {
                        fallback: unknownServerStopErrorMessage
                    });
                    console.error(`Failed to stop status server: ${message}`);
                }
            }

            if (abortSignal) {
                resolve();
                return;
            }

            resolve();
            process.exit(exitCode);
        };

        const handleWatcherError = (error: unknown) => {
            const message = getErrorMessage(error, {
                fallback: "Unknown watch error"
            });
            const formattedError = formatCliError(new Error(`Watch error: ${message}`));
            console.error(formattedError);
            void cleanup(1);
        };

        const handleErrorSignal = () => {
            cleanup(0).catch((error) => {
                const message = getErrorMessage(error, {
                    fallback: "Unknown cleanup error"
                });
                console.error(`Error during watch cleanup: ${message}`);
                process.exit(1);
            });
        };

        process.on("SIGINT", handleErrorSignal);
        process.on("SIGTERM", handleErrorSignal);

        if (abortSignal) {
            if (abortSignal.aborted) {
                void cleanup(0);
                return;
            }

            const abortHandler = () => {
                cleanup(0).catch((error) => {
                    const message = getErrorMessage(error, {
                        fallback: "Unknown cleanup error"
                    });
                    console.error(`Error during watch cleanup: ${message}`);
                });
            };

            abortSignal.addEventListener("abort", abortHandler, {
                once: true
            });

            removeAbortListener = () => {
                abortSignal.removeEventListener("abort", abortHandler);
            };
        }

        try {
            watcher = watchFactory(
                normalizedPath,
                {
                    ...watchOptions,
                    ...(abortSignal && { signal: abortSignal })
                },
                (eventType, filename) => {
                    if (!filename) {
                        const unknownKey = `${normalizedPath}::unknown`;
                        const triggerUnknown = () =>
                            scheduleUnknownFileChanges(
                                runtimeContext,
                                verbose,
                                quiet,
                                internalAbortController.signal
                            ).catch((error) => {
                                const message = getErrorMessage(error, {
                                    fallback: "Unknown file processing error"
                                });
                                console.error(`Error processing watcher event: ${message}`);
                            });

                        if (debounceDelay === 0) {
                            void triggerUnknown();
                        } else {
                            let debouncedHandler = runtimeContext.debouncedHandlers.get(unknownKey);
                            if (!debouncedHandler) {
                                debouncedHandler = debounce(() => {
                                    runtimeContext.debouncedHandlers.delete(unknownKey);
                                    void triggerUnknown();
                                }, debounceDelay);
                                runtimeContext.debouncedHandlers.set(unknownKey, debouncedHandler);
                            }
                            debouncedHandler(unknownKey, eventType, {
                                verbose,
                                quiet,
                                runtimeContext
                            });
                        }
                        return;
                    }

                    if (!extensionMatcher.matches(filename)) {
                        return;
                    }

                    const fullPath = path.join(normalizedPath, filename);

                    if (!quiet) {
                        if (verbose) {
                            console.log(`[${new Date().toISOString()}] ${eventType}: ${filename}`);
                        } else {
                            console.log(`Changed: ${filename}`);
                        }
                    }

                    if (debounceDelay === 0) {
                        handleFileChange(fullPath, eventType, {
                            verbose,
                            quiet,
                            runtimeContext,
                            abortSignal,
                            fileChangeDetectedAt: Date.now()
                        }).catch((error) => {
                            const message = getErrorMessage(error, {
                                fallback: "Unknown file processing error"
                            });
                            console.error(`Error processing ${filename}: ${message}`);
                        });
                    } else {
                        let debouncedHandler = runtimeContext.debouncedHandlers.get(fullPath);

                        if (!debouncedHandler) {
                            debouncedHandler = debounce((filePath: string, evt: string, opts: FileChangeOptions) => {
                                runtimeContext.debouncedHandlers.delete(filePath);
                                handleFileChange(filePath, evt, opts).catch((error) => {
                                    const message = getErrorMessage(error, {
                                        fallback: "Unknown file processing error"
                                    });
                                    console.error(`Error processing ${filename}: ${message}`);
                                });
                            }, debounceDelay);
                            runtimeContext.debouncedHandlers.set(fullPath, debouncedHandler);
                        }

                        debouncedHandler(fullPath, eventType, {
                            verbose,
                            quiet,
                            runtimeContext,
                            abortSignal,
                            fileChangeDetectedAt: Date.now()
                        });
                    }
                }
            );

            watcher.on("error", handleWatcherError);

            // Perform initial scan after the watcher is established so test harnesses
            // and callers can trigger events immediately without waiting for the scan.
            if (!quiet && verbose) {
                console.log("Scanning existing GML files to build dependency graph...");
            }

            void performInitialScan(
                normalizedPath,
                extensionMatcher,
                runtimeContext,
                verbose,
                quiet,
                maxConcurrentDirs,
                fileDataCache
            )
                .then(() => {
                    runtimeContext.scanComplete = true;
                    return null;
                })
                .finally(() => {
                    // The startup cache is only needed during the initial scan. Clear any
                    // unconsumed entries (for example from transient read errors) so large
                    // file contents and AST objects are released promptly.
                    clearInitialFileDataCache(fileDataCache);
                })
                .catch(handleWatcherError);
        } catch (error) {
            handleWatcherError(error);
        }
    });
}

/**
 * Handles individual file change events.
 *
 * Coordinates with the transpiler to generate JavaScript patches when GML files change.
 * Future iterations will add semantic analysis and streaming to the runtime wrapper.
 *
 * @param {string} filePath - Full path to the changed file
 * @param {string} eventType - Type of file system event ('change' or 'rename')
 * @param {object} options - Processing options
 * @param {boolean} options.verbose - Enable verbose logging
 * @param {object} options.runtimeContext - Runtime context with transpiler and patch storage
 */
async function handleFileChange(
    filePath: string,
    eventType: string,
    {
        verbose = false,
        quiet = false,
        runtimeContext,
        fileStats,
        abortSignal,
        fileChangeDetectedAt
    }: FileChangeOptions = {}
): Promise<void> {
    if (verbose && runtimeContext?.root && !runtimeContext.noticeLogged) {
        console.log(`Runtime target: ${runtimeContext.root}`);
        runtimeContext.noticeLogged = true;
    }

    // File was created, deleted, or renamed. On some platforms (notably macOS)
    // a write can surface as a 'rename' event. If the file exists after the
    // rename, treat it as a change and continue to transpile. If the file was
    // removed, bail out early.
    let shouldTranspile = false;
    let resolvedFileStats: Stats | null = fileStats ?? null;

    if (eventType === "rename") {
        if (resolvedFileStats) {
            shouldTranspile = true;
            if (verbose && !quiet) {
                console.log(`  ↳ File exists (created or renamed)`);
            }
        } else {
            try {
                resolvedFileStats = await stat(filePath);
                shouldTranspile = true;
                if (verbose && !quiet) {
                    console.log(`  ↳ File exists (created or renamed)`);
                }
            } catch {
                if (verbose && !quiet) {
                    console.log(`  ↳ File removed (deleted or renamed away)`);
                }
                if (runtimeContext) {
                    cleanupRemovedFile(runtimeContext, filePath, verbose, quiet);
                }
                return;
            }
        }
    }

    // For 'change' events, read the file and transpile it. Also transpile when
    // a 'rename' event left the file in place (see comment above).
    if (eventType === "change" || shouldTranspile) {
        if (runtimeContext) {
            if (!resolvedFileStats) {
                resolvedFileStats = await readFileStats(filePath);
            }

            if (resolvedFileStats) {
                const lastModified = runtimeContext.fileSnapshots.get(filePath);
                if (lastModified !== undefined && resolvedFileStats.mtimeMs <= lastModified) {
                    if (verbose && !quiet) {
                        console.log("  ↳ Skipping unchanged file");
                    }
                    return;
                }
            }
        }

        try {
            const content = await readSourceFileWithTransientEmptyRetry(
                filePath,
                runtimeContext?.transientEmptyFileReadRetryCount ?? DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_COUNT,
                runtimeContext?.transientEmptyFileReadRetryDelayMs ?? DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_DELAY_MS,
                abortSignal
            );
            if (content === null) {
                return;
            }
            const lines = countSourceLines(content);
            if (runtimeContext) {
                if (resolvedFileStats) {
                    runtimeContext.fileSnapshots.set(filePath, resolvedFileStats.mtimeMs);
                } else {
                    await updateFileSnapshot(runtimeContext, filePath);
                }
            }

            if (verbose && !quiet) {
                console.log(`  ↳ Read ${lines} lines`);
            }

            if (!runtimeContext?.transpiler) {
                return;
            }

            // Skip transpilation when content is byte-for-byte identical to what was
            // last transpiled.  Mtime-based deduplication already handles the common
            // case where the file is not written at all; this second guard covers
            // the remaining scenario where an editor or tool updates the mtime without
            // changing the actual bytes (e.g. redundant saves, `touch`, auto-formatters
            // that produce no change).
            const contentLength = content.length;
            const previousContentLength = runtimeContext.fileContentLengths.get(filePath);
            const lastContentHash = runtimeContext.fileContentHashes.get(filePath);
            const shouldCheckHash =
                previousContentLength !== undefined &&
                lastContentHash !== undefined &&
                previousContentLength === contentLength;
            const contentHash = shouldCheckHash ? hashSourceContent(content) : undefined;
            if (contentHash !== undefined && lastContentHash === contentHash) {
                if (verbose && !quiet) {
                    console.log("  ↳ Skipping transpilation: content unchanged");
                }
                return;
            }

            runtimeContext.fileContentHashes.set(filePath, contentHash ?? hashSourceContent(content));
            runtimeContext.fileContentLengths.set(filePath, contentLength);

            ensureScriptNameRegistered(filePath, runtimeContext.scriptNames);

            // Transpile the changed file
            const result = transpileFile(runtimeContext, filePath, content, lines, {
                verbose,
                quiet,
                fileChangeDetectedAt
            });

            await processTranspileResult(runtimeContext, filePath, result, fileChangeDetectedAt, verbose, quiet);
        } catch (error) {
            if (runtimeContext && isErrorWithCode(error, "ENOENT")) {
                cleanupRemovedFile(runtimeContext, filePath, verbose, quiet);
                if (verbose && !quiet) {
                    console.log("  ↳ File missing during read (deleted before processing)");
                }
                return;
            }

            const message = getErrorMessage(error, {
                fallback: "Unknown file read error"
            });

            const formattedMessage =
                verbose && !quiet
                    ? `  ↳ Error reading file: ${message}`
                    : `Error reading ${path.basename(filePath)}: ${message}`;

            console.error(formattedMessage);
        }
    }
}

async function handleUnknownFileChanges(
    runtimeContext: RuntimeContext,
    verbose: boolean,
    quiet: boolean,
    abortSignal?: AbortSignal
): Promise<void> {
    const discoveredFilePaths = await collectWatchedFilePaths(
        runtimeContext.watchRoot,
        runtimeContext.extensionMatcher,
        runtimeContext.maxConcurrentDirs
    );
    const discoveredFiles = new Set(discoveredFilePaths);

    for (const filePath of runtimeContext.fileSnapshots.keys()) {
        if (!discoveredFiles.has(filePath)) {
            cleanupRemovedFile(runtimeContext, filePath, verbose, quiet);
        }
    }

    const changedEntries = await Core.runInParallelWithLimit(
        discoveredFilePaths,
        async (filePath) => {
            const lastModified = runtimeContext.fileSnapshots.get(filePath);
            try {
                const stats = await stat(filePath);
                if (lastModified !== undefined && stats.mtimeMs <= lastModified) {
                    return null;
                }

                return {
                    filePath,
                    stats,
                    eventType: lastModified === undefined ? "rename" : "change"
                };
            } catch {
                cleanupRemovedFile(runtimeContext, filePath, verbose, quiet);
                return null;
            }
        },
        runtimeContext.unknownScanConcurrency
    );

    // Filter null entries (unchanged/removed files) before processing so the
    // parallel callback receives only actionable work items.
    const pendingChanges = changedEntries.filter(
        (entry): entry is { filePath: string; stats: Stats; eventType: string } => entry !== null
    );

    // Process changed files with bounded concurrency. The stat scan above already
    // limits I/O during discovery; processing concurrently overlaps file reads with
    // CPU-bound transpilation of other files, reducing total wall-clock time versus
    // sequential processing while staying within the configured concurrency ceiling.
    await Core.runInParallelWithLimit(
        pendingChanges,
        async (entry) => {
            await handleFileChange(entry.filePath, entry.eventType, {
                verbose,
                quiet,
                runtimeContext,
                fileStats: entry.stats,
                abortSignal
            });
        },
        runtimeContext.unknownScanConcurrency
    );
}

function processQueuedUnknownFileChanges(
    runtimeContext: RuntimeContext,
    verbose: boolean,
    quiet: boolean,
    abortSignal?: AbortSignal
): Promise<void> {
    runtimeContext.unknownScanQueued = false;

    return handleUnknownFileChanges(runtimeContext, verbose, quiet, abortSignal).then(() =>
        runtimeContext.unknownScanQueued
            ? processQueuedUnknownFileChanges(runtimeContext, verbose, quiet, abortSignal)
            : Promise.resolve()
    );
}

function scheduleUnknownFileChanges(
    runtimeContext: RuntimeContext,
    verbose: boolean,
    quiet: boolean,
    abortSignal?: AbortSignal
): Promise<void> {
    // Unknown filename events can burst during watcher start-up on some platforms.
    // Ignore them until the initial scan has completed so we avoid expensive
    // duplicate stats against the same tree while the scanner is already walking it.
    if (!runtimeContext.scanComplete) {
        return Promise.resolve();
    }

    if (runtimeContext.unknownScanPromise !== null) {
        runtimeContext.unknownScanQueued = true;
        return runtimeContext.unknownScanPromise;
    }

    const unknownScanPromise = processQueuedUnknownFileChanges(runtimeContext, verbose, quiet, abortSignal).finally(
        () => {
            runtimeContext.unknownScanPromise = null;
        }
    );

    runtimeContext.unknownScanPromise = unknownScanPromise;
    return unknownScanPromise;
}

async function readFileStats(filePath: string): Promise<Stats | null> {
    try {
        return await stat(filePath);
    } catch {
        return null;
    }
}

async function retranspileDependentFiles(
    runtimeContext: RuntimeContext,
    filePath: string,
    dependentFiles: ReadonlyArray<string>,
    fileChangeDetectedAt: number | undefined,
    verbose: boolean,
    quiet: boolean
): Promise<void> {
    // Process dependent files concurrently to minimise hot-reload latency while
    // keeping fan-out bounded to avoid unbounded event-loop pressure on large
    // dependency graphs.
    await Core.runInParallelWithLimit(
        dependentFiles,
        async (dependentFile) => {
            try {
                await retranspileDependentFile(
                    runtimeContext,
                    filePath,
                    dependentFile,
                    fileChangeDetectedAt,
                    verbose,
                    quiet
                );
            } catch (error) {
                const message = getErrorMessage(error, {
                    fallback: "Unknown file read error"
                });
                console.error(`  ↳ Error retranspiling dependent file ${dependentFile}: ${message}`);
            }
        },
        runtimeContext.dependentRetranspileConcurrency
    );
}

function areSymbolSetsEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
    if (left.length === 0 || right.length === 0) {
        return left.length === right.length;
    }

    const leftSet = new Set(left);
    const rightSet = new Set(right);

    if (leftSet.size !== rightSet.size) {
        return false;
    }

    for (const symbol of leftSet) {
        if (!rightSet.has(symbol)) {
            return false;
        }
    }

    return true;
}

async function processTranspileResult(
    runtimeContext: RuntimeContext,
    filePath: string,
    result: TranspilationResult,
    fileChangeDetectedAt: number | undefined,
    verbose: boolean,
    quiet: boolean
): Promise<void> {
    if (!result.success || !result.patch) {
        return;
    }

    const dependencyUpdate = updateDependencyTrackerForTranspileResult(runtimeContext, filePath, result);

    if (verbose && !quiet) {
        const stats = runtimeContext.dependencyTracker.getStatistics();
        console.log(`  ↳ Dependency tracker: ${stats.totalSymbols} symbols tracked across ${stats.totalFiles} files`);
    }

    if (!dependencyUpdate.definitionsChanged) {
        if (verbose && !quiet && dependencyUpdate.affectedDependents.length > 0) {
            console.log("  ↳ Symbol definitions unchanged; skipping dependent retranspilation");
        }
        return;
    }

    const dependentFiles = dependencyUpdate.affectedDependents;
    if (dependentFiles.length === 0) {
        return;
    }

    if (!quiet) {
        console.log(`  ↳ Retranspiling ${dependentFiles.length} dependent file(s)...`);
    }

    await retranspileDependentFiles(runtimeContext, filePath, dependentFiles, fileChangeDetectedAt, verbose, quiet);
}

interface DependencyUpdateSummary {
    definitionsChanged: boolean;
    affectedDependents: ReadonlyArray<string>;
}

/**
 * Apply dependency tracker updates and report which dependents should be considered.
 */
function updateDependencyTrackerForTranspileResult(
    runtimeContext: RuntimeContext,
    filePath: string,
    result: TranspilationResult
): DependencyUpdateSummary {
    const previousDefinitions = runtimeContext.dependencyTracker.getFileDefinitions(filePath);
    const nextDefinitions = result.symbols ?? [];
    const definitionsChanged = !areSymbolSetsEqual(previousDefinitions, nextDefinitions);

    runtimeContext.dependencyTracker.replaceFileDefines(filePath, nextDefinitions);
    runtimeContext.dependencyTracker.replaceFileReferences(filePath, result.references ?? []);

    if (!definitionsChanged) {
        return {
            definitionsChanged,
            affectedDependents: []
        };
    }

    const changedDefinitions = resolveChangedDefinitions(previousDefinitions, nextDefinitions);
    const affectedDependents = runtimeContext.dependencyTracker.getFilesReferencingSymbols(
        changedDefinitions,
        filePath
    );

    return {
        definitionsChanged,
        affectedDependents
    };
}

/**
 * Returns the symbol names whose availability changed between two definition sets.
 * Only files that reference these specific symbols need dependent retranspilation.
 */
function resolveChangedDefinitions(
    previousDefinitions: ReadonlyArray<string>,
    nextDefinitions: ReadonlyArray<string>
): Array<string> {
    return mergeDependentFiles(
        subtractSymbolSets(previousDefinitions, nextDefinitions),
        subtractSymbolSets(nextDefinitions, previousDefinitions)
    );
}

/**
 * Returns symbols present in `left` that are absent from `right`.
 */
function subtractSymbolSets(left: ReadonlyArray<string>, right: ReadonlyArray<string>): Array<string> {
    if (left.length === 0) {
        return [];
    }

    const rightSet = new Set(right);
    const difference: Array<string> = [];

    for (const symbol of left) {
        if (!rightSet.has(symbol)) {
            difference.push(symbol);
        }
    }

    return difference;
}

/**
 * Combine dependent file lists while removing duplicates.
 */
function mergeDependentFiles(
    previousDependents: ReadonlyArray<string>,
    updatedDependents: ReadonlyArray<string>
): Array<string> {
    return Array.from(new Set([...previousDependents, ...updatedDependents]));
}

async function retranspileDependentFile(
    runtimeContext: RuntimeContext & ScriptNameRegistrationContext,
    filePath: string,
    dependentFile: string,
    fileChangeDetectedAt: number | undefined,
    verbose: boolean,
    quiet: boolean
): Promise<void> {
    ensureScriptNameRegistered(dependentFile, runtimeContext.scriptNames);

    const dependentContent = await readFile(dependentFile, "utf8");
    const dependentLines = countSourceLines(dependentContent);

    if (verbose && !quiet) {
        console.log(`  ↳ Retranspiling ${path.relative(path.dirname(filePath), dependentFile)}`);
    }

    const dependentResult = transpileFile(runtimeContext, dependentFile, dependentContent, dependentLines, {
        verbose: false,
        quiet,
        fileChangeDetectedAt
    });

    registerDependencyTrackerUpdates(runtimeContext, dependentFile, dependentResult);
}

function registerDependencyTrackerUpdates(
    runtimeContext: RuntimeContext,
    dependentFile: string,
    dependentResult: TranspilationResult
): void {
    if (!dependentResult.success) {
        return;
    }

    runtimeContext.dependencyTracker.replaceFileDefines(dependentFile, dependentResult.symbols ?? []);
    runtimeContext.dependencyTracker.replaceFileReferences(dependentFile, dependentResult.references ?? []);
}

function getScriptNameFromPath(filePath: string): string | null {
    const segments = getRuntimePathSegments(filePath);
    return resolveScriptFileNameFromSegments(segments);
}

function ensureScriptNameRegistered(filePath: string, scriptNames: Set<string>): void {
    const scriptName = getScriptNameFromPath(filePath);
    if (scriptName) {
        scriptNames.add(scriptName);
    }
}

function unregisterScriptName(filePath: string, scriptNames: Set<string>): void {
    const scriptName = getScriptNameFromPath(filePath);
    if (scriptName) {
        scriptNames.delete(scriptName);
    }
}

function getSymbolIdFromFilePath(filePath: string): string {
    const fileName = path.basename(filePath, path.extname(filePath));
    return `gml/script/${fileName}`;
}

function removeCachedPatchesForFile(
    runtimeContext: Pick<FileRemovalCleanupContext, "lastSuccessfulPatches">,
    filePath: string
): number {
    const symbolId = getSymbolIdFromFilePath(filePath);
    let removedCount = runtimeContext.lastSuccessfulPatches.delete(symbolId) ? 1 : 0;

    for (const [patchId, cachedPatch] of runtimeContext.lastSuccessfulPatches.entries()) {
        const metadata = Core.isObjectLike(cachedPatch.metadata) ? cachedPatch.metadata : null;
        const sourcePath = Core.isNonEmptyString(metadata?.sourcePath) ? metadata.sourcePath : null;

        if (sourcePath !== filePath) {
            continue;
        }

        runtimeContext.lastSuccessfulPatches.delete(patchId);
        removedCount += 1;
    }

    return removedCount;
}

function cleanupRemovedFile(
    runtimeContext: FileRemovalCleanupContext,
    filePath: string,
    verbose: boolean,
    quiet: boolean
): void {
    unregisterScriptName(filePath, runtimeContext.scriptNames);
    runtimeContext.dependencyTracker.removeFile(filePath);
    runtimeContext.fileSnapshots.delete(filePath);
    runtimeContext.fileContentHashes.delete(filePath);
    runtimeContext.fileContentLengths.delete(filePath);
    const removedPatchCount = removeCachedPatchesForFile(runtimeContext, filePath);

    const debouncedHandler = runtimeContext.debouncedHandlers.get(filePath);
    if (debouncedHandler) {
        debouncedHandler.cancel();
        runtimeContext.debouncedHandlers.delete(filePath);
    }

    if (verbose && !quiet) {
        const patchMessage =
            removedPatchCount > 0 ? `cleared ${removedPatchCount} cached patch(es)` : "no cached patch found";
        console.log(`  ↳ Removed dependency tracking (${patchMessage})`);
    }
}

function removeDeletedCachedPatchSources(
    runtimeContext: FileRemovalCleanupContext,
    verbose: boolean,
    quiet: boolean
): void {
    const deletedSourcePaths = new Set<string>();

    for (const cachedPatch of runtimeContext.lastSuccessfulPatches.values()) {
        const metadata = Core.isObjectLike(cachedPatch.metadata) ? cachedPatch.metadata : null;
        const sourcePath = Core.isNonEmptyString(metadata?.sourcePath) ? metadata.sourcePath : null;

        if (sourcePath !== null && !existsSync(sourcePath)) {
            deletedSourcePaths.add(sourcePath);
        }
    }

    for (const sourcePath of deletedSourcePaths) {
        cleanupRemovedFile(runtimeContext, sourcePath, verbose, quiet);
    }
}

async function updateFileSnapshot(runtimeContext: FileSnapshotWriter, filePath: string): Promise<void> {
    try {
        const stats = await stat(filePath);
        runtimeContext.fileSnapshots.set(filePath, stats.mtimeMs);
    } catch {
        runtimeContext.fileSnapshots.delete(filePath);
    }
}

/**
 * Return value from the initial file cache build step.
 * Provides both the complete set of known script names (for seeding the semantic oracle)
 * and the per-file content + AST cache (for avoiding re-parsing during initial transpilation).
 */
interface InitialFileScanResult {
    scriptNames: Set<string>;
    fileDataCache: Map<string, InitialFileData>;
}

interface ScannedDirectoryEntries {
    files: Array<string>;
    directories: Array<string>;
}

function partitionScannedDirectoryEntries(
    currentPath: string,
    entries: Array<Dirent>,
    extensionMatcher: ExtensionMatcher
): ScannedDirectoryEntries {
    const files: Array<string> = [];
    const directories: Array<string> = [];

    for (const entry of entries) {
        const candidatePath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
            directories.push(candidatePath);
        } else if (entry.isFile() && extensionMatcher.matches(entry.name)) {
            files.push(candidatePath);
        }
    }

    return { files, directories };
}

async function collectScriptNames(
    rootPath: string,
    extensionMatcher: ExtensionMatcher,
    maxConcurrentDirs: number
): Promise<InitialFileScanResult> {
    const scriptNames = new Set<string>();
    const fileDataCache = new Map<string, InitialFileData>();

    async function scan(currentPath: string): Promise<void> {
        const entries = await readdir(currentPath, { withFileTypes: true });
        const { files, directories } = partitionScannedDirectoryEntries(currentPath, entries, extensionMatcher);

        // Process all files in this directory concurrently for maximum throughput
        await Core.runInParallel(files, async (filePath) => {
            await addScriptNamesFromFile(filePath, scriptNames, fileDataCache);
        });

        // Traverse subdirectories with bounded parallelism to reduce startup latency
        // while still respecting file descriptor limits on constrained systems.
        await Core.runInParallelWithLimit(
            directories,
            async (subDirPath) => {
                await scan(subDirPath);
            },
            maxConcurrentDirs
        );
    }

    try {
        await scan(rootPath);
    } catch {
        // Fail silently; fallback to empty set
    }

    return { scriptNames, fileDataCache };
}

async function collectWatchedFilePaths(
    rootPath: string,
    extensionMatcher: ExtensionMatcher,
    maxConcurrentDirs: number
): Promise<Array<string>> {
    const discoveredFiles: Array<string> = [];

    async function scan(currentPath: string): Promise<void> {
        const entries = await readdir(currentPath, { withFileTypes: true });
        const { files, directories } = partitionScannedDirectoryEntries(currentPath, entries, extensionMatcher);

        discoveredFiles.push(...files);

        await Core.runInParallelWithLimit(
            directories,
            async (subDirPath) => {
                await scan(subDirPath);
            },
            maxConcurrentDirs
        );
    }

    try {
        await scan(rootPath);
    } catch {
        // Fail silently; unknown filename scans should never crash the watcher.
    }

    return discoveredFiles;
}

async function addScriptNamesFromFile(
    filePath: string,
    scriptNames: Set<string>,
    fileDataCache: Map<string, InitialFileData>
): Promise<void> {
    const beforeSize = scriptNames.size;

    try {
        const content = await readFile(filePath, "utf8");
        const parser = new Parser.GMLParser(content, {});
        const ast = parser.parse();
        registerScriptNamesFromSymbols(extractSymbolsFromAst(ast, filePath), scriptNames);
        // Cache the content and AST so performInitialScan can reuse them without
        // re-reading from disk or re-parsing the GML source.
        fileDataCache.set(filePath, { content, ast });
    } catch {
        // Ignore parse errors; fallback to file-name based script
    }

    if (scriptNames.size === beforeSize) {
        const scriptName = getScriptNameFromPath(filePath);
        if (scriptName) {
            scriptNames.add(scriptName);
        }
    }
}
