import process from "node:process";

import { Core } from "@gmloop/core";
import { Command, Option } from "commander";

import { createMinimumValueValidator, portValidator } from "../cli-core/command-parsing.js";
import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { handleCliError } from "../cli-core/errors.js";
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
import {
    buildLiveReloadHtml5Output,
    prepareLiveReload,
    startLiveReloadDevSession
} from "../modules/live-reload/session.js";
import {
    discoverLiveReloadSessionByPath,
    type LiveReloadRegisteredSession
} from "../modules/live-reload/session-registry.js";
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
import {
    runWatchStatusCommand,
    WATCH_STATUS_OUTPUT_FORMAT_VALUES,
    WATCH_STATUS_OUTPUT_FORMATS
} from "./watch/status.js";

const PROJECT_PATH_OPTION_DESCRIPTION = "Project directory or .yyp path.";
const PROJECT_PATH_OPTION_FLAG = "--path <project>";
const PROJECT_SESSION_PATH_OPTION_DESCRIPTION =
    "Project directory or .yyp path used to discover the project-local live-reload session.";

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

interface LiveReloadBuildCommandOptions {
    quiet?: boolean;
    verbose?: boolean;
}

interface LiveReloadDevCommandOptions extends LiveReloadPrepareCommandOptions {
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
    forceNew?: boolean;
    reuseExisting?: boolean;
    startSource?: "cli" | "mcp" | "ui";
}

interface LiveReloadStatusCommandOptions {
    endpoint?: "status" | "health" | "ping" | "ready";
    format?: string;
    path?: string;
    statusHost?: string;
    statusPort?: number;
}

interface LiveReloadPathCommandOptions {
    path?: string;
}

interface LiveReloadWaitForPatchCommandOptions extends LiveReloadPathCommandOptions {
    pollIntervalMs?: number;
    sincePatchId?: string;
    timeoutMs?: number;
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

function reportLiveReloadBuildResult(
    quiet: boolean,
    verbose: boolean,
    result: Awaited<ReturnType<typeof buildLiveReloadHtml5Output>>
): void {
    if (quiet) {
        return;
    }

    console.log(`Built HTML5 output via ${result.backend}.`);
    console.log(`HTML5 output: ${result.outputRoot}`);
    if (verbose) {
        console.log(`Command: ${result.command}`);
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
        handleCliError(new Error(message));
    }
}

export async function runLiveReloadBuildCommand(
    targetPath: string,
    options: LiveReloadBuildCommandOptions = {}
): Promise<void> {
    const quiet = Boolean(options.quiet);
    const verbose = Boolean(options.verbose);

    try {
        const result = await buildLiveReloadHtml5Output({
            targetPath
        });
        reportLiveReloadBuildResult(quiet, verbose, result);
    } catch (error) {
        const message = Core.getErrorMessage(error, {
            fallback: "Failed to build GameMaker HTML5 output."
        });
        handleCliError(new Error(message));
    }
}

export async function runLiveReloadDevCommand(
    targetPath: string,
    options: LiveReloadDevCommandOptions = {}
): Promise<void> {
    const result = await startLiveReloadDevSession({
        targetPath,
        html5OutputRoot: options.html5Output,
        gmTempRoot: options.gmTempRoot,
        bootstrapConfig: createLiveReloadBootstrapConfig(options),
        forceNew: options.forceNew,
        reuseExisting: options.reuseExisting,
        startSource: options.startSource ?? "cli",
        watchOptions: {
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
    if (result.mode === "attached" && result.session !== null && options.quiet !== true) {
        reportLiveReloadAttachedSession(result.session);
    }
}

function reportLiveReloadAttachedSession(session: LiveReloadRegisteredSession): void {
    console.log("Attached to existing live-reload session.");
    console.log(`Project root: ${session.projectRoot}`);
    console.log(`Runtime URL: ${session.runtimeUrl ?? "<not served>"}`);
    console.log(`Status URL: ${session.statusUrl}`);
    console.log(`WebSocket URL: ${session.websocketUrl}`);
}

export async function runLiveReloadStatusCommand(options: LiveReloadStatusCommandOptions = {}): Promise<void> {
    if (options.path) {
        const discovery = await discoverLiveReloadSessionByPath(options.path);
        if (!discovery.alive || discovery.session === null) {
            console.error(`No active live-reload session is registered for ${options.path}.`);
            process.exit(1);
        }

        await runWatchStatusCommand({
            endpoint: options.endpoint,
            format: options.format,
            statusHost: discovery.session.statusHost,
            statusPort: discovery.session.statusPort
        });
        return;
    }

    await runWatchStatusCommand(options);
}

export async function runLiveReloadDiscoverCommand(options: LiveReloadPathCommandOptions = {}): Promise<void> {
    const targetPath = options.path ?? process.cwd();
    const discovery = await discoverLiveReloadSessionByPath(targetPath);
    console.log(
        JSON.stringify(
            {
                command: "live-reload discover",
                ok: true,
                payload: discovery
            },
            null,
            2
        )
    );
}

export async function runLiveReloadAttachCommand(options: LiveReloadPathCommandOptions = {}): Promise<void> {
    const targetPath = options.path ?? process.cwd();
    const discovery = await discoverLiveReloadSessionByPath(targetPath);
    if (!discovery.alive || discovery.session === null) {
        console.error(`No active live-reload session is registered for ${targetPath}.`);
        process.exit(1);
    }

    console.log(
        JSON.stringify(
            {
                command: "live-reload attach",
                ok: true,
                payload: discovery.session
            },
            null,
            2
        )
    );
}

async function fetchLiveReloadStatusPayload(session: LiveReloadRegisteredSession): Promise<unknown> {
    const statusEndpointUrl = session.statusUrl.endsWith("/status") ? session.statusUrl : `${session.statusUrl}/status`;
    const response = await fetch(statusEndpointUrl);
    if (!response.ok) {
        throw new Error(`Live-reload status request failed with HTTP ${String(response.status)}.`);
    }

    return await response.json();
}

function readLastPatchId(statusPayload: unknown): string | null {
    if (!Core.isObjectLike(statusPayload)) {
        return null;
    }

    const lastPatchId = (statusPayload as Record<string, unknown>).lastPatchId;
    return typeof lastPatchId === "string" && lastPatchId.length > 0 ? lastPatchId : null;
}

async function delayLiveReloadPatchPoll(pollIntervalMs: number): Promise<void> {
    await new Promise((resolve) => {
        setTimeout(resolve, pollIntervalMs);
    });
}

async function pollLiveReloadStatusForPatch(
    parameters: Readonly<{
        deadline: number;
        pollIntervalMs: number;
        session: LiveReloadRegisteredSession;
        sincePatchId: string | undefined;
    }>
): Promise<Record<string, unknown> | null> {
    if (Date.now() > parameters.deadline) {
        return null;
    }

    const rawStatusPayload = await fetchLiveReloadStatusPayload(parameters.session);
    const statusPayload = Core.isObjectLike(rawStatusPayload) ? (rawStatusPayload as Record<string, unknown>) : {};
    const lastPatchId = readLastPatchId(statusPayload);
    if (lastPatchId !== null && lastPatchId !== parameters.sincePatchId) {
        return statusPayload;
    }

    await delayLiveReloadPatchPoll(parameters.pollIntervalMs);
    return await pollLiveReloadStatusForPatch(parameters);
}

export async function runLiveReloadWaitForPatchCommand(
    options: LiveReloadWaitForPatchCommandOptions = {}
): Promise<void> {
    const targetPath = options.path ?? process.cwd();
    const discovery = await discoverLiveReloadSessionByPath(targetPath);
    if (!discovery.alive || discovery.session === null) {
        console.error(`No active live-reload session is registered for ${targetPath}.`);
        process.exit(1);
    }

    const timeoutMs = options.timeoutMs ?? 10_000;
    const pollIntervalMs = options.pollIntervalMs ?? 250;
    const deadline = Date.now() + timeoutMs;
    const latestPayload = await pollLiveReloadStatusForPatch({
        deadline,
        pollIntervalMs,
        session: discovery.session,
        sincePatchId: options.sincePatchId
    });

    if (latestPayload !== null) {
        console.log(
            JSON.stringify(
                {
                    command: "live-reload wait-for-patch",
                    ok: true,
                    payload: latestPayload
                },
                null,
                2
            )
        );
        return;
    }

    console.error(`Timed out waiting for a live-reload patch after ${String(timeoutMs)}ms.`);
    process.exit(1);
}

function applySharedLiveReloadPrepareOptions(command: Command): Command {
    return command
        .addOption(new Option("--html5-output <path>", "Path to the HTML5 output directory."))
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
        .addOption(
            new Option("--gm-temp-root <path>", "Root directory for GameMaker HTML5 temporary outputs.").default(
                DEFAULT_GM_TEMP_ROOT
            )
        )
        .description("Sync browser bootstrap assets and inject the live-reload module into an HTML5 output.")
        .addOption(new Option("--force", "Rewrite the injected bootstrap snippet if it already exists.").default(false))
        .action((options: LiveReloadPrepareCommandOptions) => runLiveReloadPrepareCommand(options));
}

function createLiveReloadBuildSubcommand(): Command {
    const command = new Command("build");
    applyStandardCommandOptions(command);

    return command
        .description("Build the configured GameMaker project to the HTML5 output used by live reload.")
        .argument("[targetPath]", "Project directory or .yyp path to build", process.cwd())
        .addOption(new Option("--verbose", "Enable verbose logging").default(false))
        .addOption(new Option("--quiet", "Suppress non-essential output").default(false))
        .action((targetPath: string, options: LiveReloadBuildCommandOptions) =>
            runLiveReloadBuildCommand(targetPath, options)
        );
}

function createLiveReloadDevSubcommand(): Command {
    const command = new Command("dev");
    applyStandardCommandOptions(command);

    return applySharedLiveReloadPrepareOptions(command)
        .description("Build HTML5 when configured, prepare live reload, start servers, then watch GML files.")
        .argument("[targetPath]", "Directory to watch for changes", process.cwd())
        .addOption(new Option("--gm-temp-root <path>", "Root directory for GameMaker HTML5 temporary outputs."))
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
        .addOption(
            new Option(
                "--force-new",
                "Start a new live-reload session even when a healthy project session is registered."
            ).default(false)
        )
        .addOption(
            new Option(
                "--reuse-existing <boolean>",
                "Attach to a healthy project session instead of starting a duplicate."
            )
                .argParser((value) => value !== "false")
                .default(true)
        )
        .addOption(
            new Option("--start-source <source>", "Live-reload session owner.")
                .choices(["cli", "mcp", "ui"])
                .default("cli")
        )
        .action((targetPath: string, options: LiveReloadDevCommandOptions) =>
            runLiveReloadDevCommand(targetPath, options)
        );
}

function createLiveReloadStatusSubcommand(): Command {
    const command = new Command("status");
    applyStandardCommandOptions(command);

    return command
        .description("Query the running live-reload status server for metrics and diagnostics.")
        .addOption(new Option(PROJECT_PATH_OPTION_FLAG, PROJECT_SESSION_PATH_OPTION_DESCRIPTION))
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
            new Option("--format <format>", "Output format")
                .choices([...WATCH_STATUS_OUTPUT_FORMAT_VALUES])
                .default(WATCH_STATUS_OUTPUT_FORMATS.PRETTY)
        )
        .addOption(
            new Option("--endpoint <endpoint>", "Endpoint to query")
                .choices(["status", "health", "ping", "ready"] as const)
                .default("status")
        )
        .action((options: LiveReloadStatusCommandOptions) => runLiveReloadStatusCommand(options));
}

function createLiveReloadDiscoverSubcommand(): Command {
    const command = new Command("discover");
    applyStandardCommandOptions(command);

    return command
        .description("Discover the project-local live-reload session registry.")
        .addOption(new Option(PROJECT_PATH_OPTION_FLAG, PROJECT_PATH_OPTION_DESCRIPTION).default(process.cwd()))
        .action((options: LiveReloadPathCommandOptions) => runLiveReloadDiscoverCommand(options));
}

function createLiveReloadAttachSubcommand(): Command {
    const command = new Command("attach");
    applyStandardCommandOptions(command);

    return command
        .description("Attach to a healthy project-local live-reload session registry.")
        .addOption(new Option(PROJECT_PATH_OPTION_FLAG, PROJECT_PATH_OPTION_DESCRIPTION).default(process.cwd()))
        .action((options: LiveReloadPathCommandOptions) => runLiveReloadAttachCommand(options));
}

function createLiveReloadWaitForPatchSubcommand(): Command {
    const command = new Command("wait-for-patch");
    applyStandardCommandOptions(command);

    return command
        .description("Wait until the registered live-reload session reports a new patch.")
        .addOption(new Option(PROJECT_PATH_OPTION_FLAG, PROJECT_PATH_OPTION_DESCRIPTION).default(process.cwd()))
        .addOption(new Option("--since-patch-id <id>", "Existing patch id to wait past."))
        .addOption(
            new Option("--timeout-ms <ms>", "Maximum wait time in milliseconds.")
                .argParser(createMinimumValueValidator(1, "Timeout must be a positive integer."))
                .default(10_000)
        )
        .addOption(
            new Option("--poll-interval-ms <ms>", "Polling interval in milliseconds.")
                .argParser(createMinimumValueValidator(1, "Poll interval must be a positive integer."))
                .default(250)
        )
        .action((options: LiveReloadWaitForPatchCommandOptions) => runLiveReloadWaitForPatchCommand(options));
}

export function createLiveReloadCommand(): Command {
    const command = new Command("live-reload");
    applyStandardCommandOptions(command);

    return command
        .description("Prepare, run, and inspect the HTML5 live-reload workflow.")
        .addCommand(createLiveReloadAttachSubcommand())
        .addCommand(createLiveReloadBuildSubcommand())
        .addCommand(createLiveReloadDiscoverSubcommand())
        .addCommand(createLiveReloadPrepareSubcommand())
        .addCommand(createLiveReloadDevSubcommand())
        .addCommand(createLiveReloadStatusSubcommand())
        .addCommand(createLiveReloadWaitForPatchSubcommand());
}
