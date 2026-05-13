import process from "node:process";

import { Core } from "@gmloop/core";
import { Command, Option } from "commander";

import { createMinimumValueValidator, portValidator } from "../cli-core/command-parsing.js";
import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { formatCliError } from "../cli-core/errors.js";
import {
    createStatusUrl,
    createWebSocketUrl,
    DEFAULT_GM_TEMP_ROOT,
    DEFAULT_LIVE_RELOAD_STATUS_HOST,
    DEFAULT_LIVE_RELOAD_STATUS_PORT,
    DEFAULT_LIVE_RELOAD_WEBSOCKET_HOST,
    DEFAULT_LIVE_RELOAD_WEBSOCKET_PORT,
    type LiveReloadBootstrapConfig
} from "../modules/live-reload/config.js";
import { prepareLiveReload, startLiveReloadDevSession } from "../modules/live-reload/session.js";
import { startRuntimeStaticServer } from "../modules/runtime/server.js";
import {
    DEFAULT_RUNTIME_PACKAGE,
    describeRuntimeSource,
    resolveRuntimeSource,
    type RuntimeSourceDescriptor,
    type RuntimeSourceResolver
} from "../modules/runtime/source.js";
import {
    DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_COUNT,
    DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_DELAY_MS,
    DEFAULT_WATCH_DEBOUNCE_DELAY_MS,
    DEFAULT_WATCH_MAX_CONCURRENT_DIRS,
    DEFAULT_WATCH_MAX_PATCH_HISTORY,
    DEFAULT_WATCH_POLLING_INTERVAL_MS
} from "./watch/constants.js";
import { runWatchStatusCommand } from "./watch/status.js";

type RuntimeDescriptorFormatter = (source: RuntimeSourceDescriptor) => string;

interface LiveReloadPrepareCommandOptions {
    html5Output?: string;
    gmTempRoot?: string;
    websocketHost?: string;
    websocketPort?: number;
    statusHost?: string;
    statusPort?: number;
    force?: boolean;
    quiet?: boolean;
    verbose?: boolean;
}

interface LiveReloadDevCommandOptions extends LiveReloadPrepareCommandOptions {
    extensions?: Array<string>;
    polling?: boolean;
    pollingInterval?: number;
    debounceDelay?: number;
    maxConcurrentDirs?: number;
    maxPatchHistory?: number;
    transientEmptyFileReadRetryCount?: number;
    transientEmptyFileReadRetryDelayMs?: number;
    websocketServer?: boolean;
    statusServer?: boolean;
    runtimeRoot?: string;
    runtimePackage?: string;
    runtimeServer?: boolean;
    hydrateRuntime?: boolean;
    runtimeResolver?: RuntimeSourceResolver;
    runtimeDescriptor?: RuntimeDescriptorFormatter;
    runtimeServerStarter?: typeof startRuntimeStaticServer;
    abortSignal?: AbortSignal;
}

function createLiveReloadBootstrapConfig(
    options: Pick<
        LiveReloadPrepareCommandOptions,
        "quiet" | "statusHost" | "statusPort" | "verbose" | "websocketHost" | "websocketPort"
    >
): LiveReloadBootstrapConfig {
    const websocketHost = options.websocketHost ?? DEFAULT_LIVE_RELOAD_WEBSOCKET_HOST;
    const websocketPort = options.websocketPort ?? DEFAULT_LIVE_RELOAD_WEBSOCKET_PORT;
    const statusHost = options.statusHost ?? DEFAULT_LIVE_RELOAD_STATUS_HOST;
    const statusPort = options.statusPort ?? DEFAULT_LIVE_RELOAD_STATUS_PORT;

    return Object.freeze({
        websocketUrl: createWebSocketUrl(websocketHost, websocketPort),
        statusUrl: createStatusUrl(statusHost, statusPort),
        logLevel: options.quiet ? "quiet" : options.verbose ? "debug" : "normal"
    });
}

function reportLiveReloadPreparation(
    quiet: boolean,
    verbose: boolean,
    result: Awaited<ReturnType<typeof prepareLiveReload>>
): void {
    if (quiet) {
        return;
    }

    console.log(result.injected ? "Injected live-reload bootstrap." : "Live-reload bootstrap already present.");
    console.log(`HTML5 output: ${result.target.outputRoot}`);
    console.log(`Index file: ${result.target.indexHtmlPath}`);
    if (verbose) {
        console.log(`Bootstrap entry: ${result.assets.bootstrapEntryPath}`);
        console.log(`Asset root: ${result.assets.targetRoot}`);
        console.log(`Assets copied: ${result.assets.copiedAssets ? "yes" : "no"}`);
    }
}

export async function runLiveReloadPrepareCommand(options: LiveReloadPrepareCommandOptions = {}): Promise<void> {
    const quiet = Boolean(options.quiet);
    const verbose = Boolean(options.verbose);

    try {
        const result = await prepareLiveReload({
            html5OutputRoot: options.html5Output,
            gmTempRoot: options.gmTempRoot ?? DEFAULT_GM_TEMP_ROOT,
            bootstrapConfig: createLiveReloadBootstrapConfig(options),
            force: Boolean(options.force)
        });
        reportLiveReloadPreparation(quiet, verbose, result);
    } catch (error) {
        const message = Core.getErrorMessage(error, {
            fallback: "Failed to prepare live-reload bootstrap."
        });
        console.error(formatCliError(new Error(message)));
        process.exit(1);
    }
}

export async function runLiveReloadDevCommand(
    targetPath: string,
    options: LiveReloadDevCommandOptions = {}
): Promise<void> {
    await startLiveReloadDevSession({
        targetPath,
        html5OutputRoot: options.html5Output,
        gmTempRoot: options.gmTempRoot ?? DEFAULT_GM_TEMP_ROOT,
        bootstrapConfig: createLiveReloadBootstrapConfig(options),
        watchOptions: {
            extensions: options.extensions,
            polling: options.polling,
            pollingInterval: options.pollingInterval,
            verbose: options.verbose,
            quiet: options.quiet,
            debounceDelay: options.debounceDelay,
            maxConcurrentDirs: options.maxConcurrentDirs,
            maxPatchHistory: options.maxPatchHistory,
            transientEmptyFileReadRetryCount: options.transientEmptyFileReadRetryCount,
            transientEmptyFileReadRetryDelayMs: options.transientEmptyFileReadRetryDelayMs,
            websocketPort: options.websocketPort,
            websocketHost: options.websocketHost,
            websocketServer: options.websocketServer,
            statusPort: options.statusPort,
            statusHost: options.statusHost,
            statusServer: options.statusServer,
            abortSignal: options.abortSignal,
            runtimeRoot: options.runtimeRoot,
            runtimePackage: options.runtimePackage,
            runtimeServer: options.runtimeServer,
            hydrateRuntime: options.hydrateRuntime,
            runtimeResolver: options.runtimeResolver ?? resolveRuntimeSource,
            runtimeDescriptor: options.runtimeDescriptor ?? describeRuntimeSource,
            runtimeServerStarter: options.runtimeServerStarter ?? startRuntimeStaticServer
        }
    });
}

function applySharedLiveReloadPrepareOptions(command: Command): Command {
    return command
        .addOption(new Option("--html5-output <path>", "Path to the HTML5 output directory."))
        .addOption(
            new Option("--gm-temp-root <path>", "Root directory for GameMaker HTML5 temporary outputs.").default(
                DEFAULT_GM_TEMP_ROOT
            )
        )
        .addOption(
            new Option("--websocket-port <port>", "WebSocket server port for streaming patches")
                .argParser(portValidator)
                .default(DEFAULT_LIVE_RELOAD_WEBSOCKET_PORT)
        )
        .addOption(
            new Option("--websocket-host <host>", "WebSocket server host for streaming patches").default(
                DEFAULT_LIVE_RELOAD_WEBSOCKET_HOST
            )
        )
        .addOption(
            new Option("--status-port <port>", "HTTP status server port")
                .argParser(portValidator)
                .default(DEFAULT_LIVE_RELOAD_STATUS_PORT)
        )
        .addOption(
            new Option("--status-host <host>", "HTTP status server host").default(DEFAULT_LIVE_RELOAD_STATUS_HOST)
        )
        .addOption(new Option("--verbose", "Enable verbose logging").default(false))
        .addOption(new Option("--quiet", "Suppress non-essential output").default(false));
}

function createLiveReloadPrepareSubcommand(): Command {
    const command = new Command("prepare");
    applyStandardCommandOptions(command);

    return applySharedLiveReloadPrepareOptions(command)
        .description("Sync browser bootstrap assets and inject the live-reload module into an HTML5 output.")
        .addOption(new Option("--force", "Rewrite the injected bootstrap snippet if it already exists.").default(false))
        .action((options: LiveReloadPrepareCommandOptions) => runLiveReloadPrepareCommand(options));
}

function createLiveReloadDevSubcommand(): Command {
    const command = new Command("dev");
    applyStandardCommandOptions(command);

    return applySharedLiveReloadPrepareOptions(command)
        .description("Prepare HTML5 live reload, start servers, then watch GML files and stream patches.")
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
        .option("--no-websocket-server", "Disable starting the WebSocket patch server.")
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
        .action((targetPath: string, options: LiveReloadDevCommandOptions) =>
            runLiveReloadDevCommand(targetPath, options)
        );
}

function createLiveReloadStatusSubcommand(): Command {
    const command = new Command("status");
    applyStandardCommandOptions(command);

    return command
        .description("Query the running live-reload status server for metrics and diagnostics.")
        .addOption(
            new Option("--status-host <host>", "Status server host")
                .default(DEFAULT_LIVE_RELOAD_STATUS_HOST)
                .env("WATCH_STATUS_HOST")
        )
        .addOption(
            new Option("--status-port <port>", "Status server port")
                .argParser(portValidator)
                .default(DEFAULT_LIVE_RELOAD_STATUS_PORT)
                .env("WATCH_STATUS_PORT")
        )
        .addOption(
            new Option("--format <format>", "Output format").choices(["pretty", "json"] as const).default("pretty")
        )
        .addOption(
            new Option("--endpoint <endpoint>", "Endpoint to query")
                .choices(["status", "health", "ping", "ready"] as const)
                .default("status")
        )
        .action((options) => runWatchStatusCommand(options));
}

export function createLiveReloadCommand(): Command {
    const command = new Command("live-reload");
    applyStandardCommandOptions(command);

    return command
        .description("Prepare, run, and inspect the HTML5 live-reload workflow.")
        .addCommand(createLiveReloadPrepareSubcommand())
        .addCommand(createLiveReloadDevSubcommand())
        .addCommand(createLiveReloadStatusSubcommand());
}
