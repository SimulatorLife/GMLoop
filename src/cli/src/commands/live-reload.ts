import process from "node:process";

import { Core } from "@gmloop/core";
import { Command, Option } from "commander";

import {
    createMinimumValueValidator,
    portValidator,
    wrapInvalidArgumentResolver
} from "../cli-core/command-parsing.js";
import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { handleCliError } from "../cli-core/errors.js";
import {
    coerceLiveReloadSessionOutputFormat,
    createStatusUrl,
    createWebSocketUrl,
    DEFAULT_GM_TEMP_ROOT,
    DEFAULT_LIVE_RELOAD_SESSION_OUTPUT_FORMAT,
    DEFAULT_LIVE_RELOAD_SESSION_STOP_TIMEOUT_MS,
    DEFAULT_LIVE_RELOAD_STATUS_HOST,
    DEFAULT_LIVE_RELOAD_STATUS_PORT,
    DEFAULT_LIVE_RELOAD_WAIT_FOR_PATCH_POLL_INTERVAL_MS,
    DEFAULT_LIVE_RELOAD_WAIT_FOR_PATCH_TIMEOUT_MS,
    DEFAULT_LIVE_RELOAD_WEBSOCKET_HOST,
    DEFAULT_LIVE_RELOAD_WEBSOCKET_PORT,
    LIVE_RELOAD_SESSION_OUTPUT_FORMATS,
    type LiveReloadBootstrapConfig,
    type LiveReloadSessionOutputFormat
} from "../modules/live-reload/config.js";
import {
    buildLiveReloadHtml5Output,
    prepareLiveReload,
    startLiveReloadDevSession
} from "../modules/live-reload/session.js";
import { manageLiveReloadSession } from "../modules/live-reload/session-controller.js";
import {
    discoverLiveReloadSessionByPath,
    type LiveReloadRegisteredSession,
    resolveLiveReloadProjectIdentity
} from "../modules/live-reload/session-registry.js";
import { runProjectOperation } from "../modules/runtime/project-operation-state.js";
import { startRuntimeStaticServer } from "../modules/runtime/server.js";
import {
    DEFAULT_RUNTIME_PACKAGE,
    describeRuntimeSource,
    resolveRuntimeSource,
    type RuntimeSourceDescriptor,
    type RuntimeSourceResolver
} from "../modules/runtime/source.js";
import { resolveWorkflowTargetPath } from "../workflow/project-root.js";
import {
    DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_COUNT,
    DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_DELAY_MS,
    DEFAULT_WATCH_DEBOUNCE_DELAY_MS,
    DEFAULT_WATCH_MAX_CONCURRENT_DIRS,
    DEFAULT_WATCH_MAX_PATCH_HISTORY,
    DEFAULT_WATCH_POLLING_INTERVAL_MS
} from "./watch/constants.js";

const PROJECT_PATH_OPTION_DESCRIPTION = "Project directory or .yyp path.";
const PROJECT_PATH_OPTION_FLAG = "--path <project>";
const LIVE_RELOAD_WAIT_FOR_PATCH_COMMAND = "live-reload wait-for-patch";

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
    sessionId?: string;
    startSource?: "cli" | "mcp" | "ui";
}

interface LiveReloadSessionCommandOptions extends Omit<LiveReloadDevCommandOptions, "sessionId"> {
    forceStart?: boolean;
    format?: LiveReloadSessionOutputFormat;
    path?: string;
    stop?: boolean;
    stopTimeoutMs?: number;
}

interface LiveReloadPathCommandOptions {
    path?: string;
}

interface LiveReloadWaitForPatchCommandOptions extends LiveReloadPathCommandOptions {
    abortSignal?: AbortSignal;
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
    const identity = await resolveLiveReloadProjectIdentity(targetPath);
    await runProjectOperation(
        {
            command: "live-reload",
            kind: "live-reload",
            projectRoot: identity.projectRoot
        },
        (operation) => {
            operation.update("starting", "Live Reload is starting.");
            return startLiveReloadDevSession({
                targetPath,
                html5OutputRoot: options.html5Output,
                gmTempRoot: options.gmTempRoot,
                bootstrapConfig: createLiveReloadBootstrapConfig(options),
                sessionId: options.sessionId,
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
        }
    );
}

export async function runLiveReloadSessionCommand(options: LiveReloadSessionCommandOptions = {}): Promise<void> {
    try {
        const targetPath = await resolveWorkflowTargetPath({
            explicitPath: options.path,
            fallbackPath: process.cwd(),
            scope: "project"
        });
        const result = await manageLiveReloadSession({
            forceStart: options.forceStart === true,
            startArguments: createLiveReloadWorkerArguments(options),
            stop: options.stop === true,
            stopTimeoutMs: options.stopTimeoutMs,
            targetPath
        });
        const payload = { command: "live-reload session", ok: true, payload: result };
        if (options.format === LIVE_RELOAD_SESSION_OUTPUT_FORMATS.pretty) {
            console.log(`${result.mode}: ${result.session?.runtimeUrl ?? "no active runtime"}`);
            return;
        }
        console.log(JSON.stringify(payload, null, 2));
    } catch (error) {
        const payload = {
            command: "live-reload session",
            ok: false,
            code: options.forceStart ? "session_stop_failed" : "session_start_failed",
            error: Core.getErrorMessage(error, { fallback: "Failed to manage live-reload session." })
        };
        console.log(JSON.stringify(payload, null, 2));
        process.exit(1);
    }
}

function createLiveReloadWorkerArguments(options: LiveReloadSessionCommandOptions): Array<string> {
    const argumentsList: Array<string> = [];
    const values: ReadonlyArray<readonly [string, string | number | boolean | undefined]> = [
        ["--html5-output", options.html5Output],
        ["--gm-temp-root", options.gmTempRoot],
        ["--websocket-host", options.websocketHost],
        ["--websocket-port", options.websocketPort],
        ["--status-host", options.statusHost],
        ["--status-port", options.statusPort],
        ["--polling-interval", options.pollingInterval],
        ["--debounce-delay", options.debounceDelay],
        ["--max-concurrent-dirs", options.maxConcurrentDirs],
        ["--max-patch-history", options.maxPatchHistory],
        ["--runtime-root", options.runtimeRoot],
        ["--runtime-package", options.runtimePackage]
    ];
    for (const [flag, value] of values) {
        if (typeof value === "string" || typeof value === "number") argumentsList.push(flag, String(value));
    }
    if (options.polling) argumentsList.push("--polling");
    if (options.verbose) argumentsList.push("--verbose");
    if (options.quiet) argumentsList.push("--quiet");
    if (options.websocketServer === false) argumentsList.push("--no-websocket-server");
    if (options.runtimeServer === false) argumentsList.push("--no-runtime-server");
    argumentsList.push("--start-source", process.env.GMLOOP_LIVE_RELOAD_START_SOURCE === "mcp" ? "mcp" : "cli");
    return argumentsList;
}

async function fetchLiveReloadStatusPayload(session: LiveReloadRegisteredSession): Promise<unknown> {
    const statusEndpointUrl = session.statusUrl.endsWith("/status") ? session.statusUrl : `${session.statusUrl}/status`;
    const response = await fetch(statusEndpointUrl);
    if (!response.ok) {
        throw new Error(`Live-reload status request failed with HTTP ${String(response.status)}.`);
    }

    return response.json();
}

function readLastPatchId(statusPayload: unknown): string | null {
    if (!Core.isObjectLike(statusPayload)) {
        return null;
    }

    const lastPatchId = (statusPayload as Record<string, unknown>).lastPatchId;
    return typeof lastPatchId === "string" && lastPatchId.length > 0 ? lastPatchId : null;
}

async function pollLiveReloadStatusForPatch(
    parameters: Readonly<{
        abortSignal?: AbortSignal;
        deadline: number;
        pollIntervalMs: number;
        session: LiveReloadRegisteredSession;
        sincePatchId: string | undefined;
    }>
): Promise<Record<string, unknown> | null> {
    if (parameters.abortSignal?.aborted === true) {
        return null;
    }

    const remainingMs = parameters.deadline - Date.now();
    if (remainingMs <= 0) {
        return null;
    }

    let statusPayload: Record<string, unknown> | null = null;
    try {
        const rawStatusPayload = await fetchLiveReloadStatusPayload(parameters.session);
        if (Core.isObjectLike(rawStatusPayload)) {
            statusPayload = rawStatusPayload as Record<string, unknown>;
        }
    } catch {
        // Tolerate transient connection blips; the deadline check below
        // resolves the wait deterministically.
    }

    const lastPatchId = statusPayload === null ? null : readLastPatchId(statusPayload);
    if (lastPatchId !== null && lastPatchId !== parameters.sincePatchId) {
        return statusPayload ?? {};
    }

    await delayLiveReloadPatchPoll(Math.min(parameters.pollIntervalMs, remainingMs), parameters.abortSignal);
    return pollLiveReloadStatusForPatch(parameters);
}

function delayLiveReloadPatchPoll(pollIntervalMs: number, abortSignal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
        if (pollIntervalMs <= 0) {
            resolve();
            return;
        }

        const timeout = setTimeout(() => {
            abortSignal?.removeEventListener("abort", onAbort);
            resolve();
        }, pollIntervalMs);

        const onAbort = (): void => {
            clearTimeout(timeout);
            resolve();
        };

        if (abortSignal !== undefined) {
            abortSignal.addEventListener("abort", onAbort, { once: true });
        }
    });
}

export async function runLiveReloadWaitForPatchCommand(
    options: LiveReloadWaitForPatchCommandOptions = {}
): Promise<void> {
    const targetPath = await resolveWorkflowTargetPath({
        explicitPath: options.path,
        fallbackPath: process.cwd(),
        scope: "project"
    });
    const identity = await resolveLiveReloadProjectIdentity(targetPath);
    const sessionFileExisted = await Core.readTextFile(identity.registryPath)
        .then(() => true)
        .catch(() => false);

    const discovery = await discoverLiveReloadSessionByPath(targetPath);
    if (!discovery.alive || discovery.session === null) {
        if (sessionFileExisted) {
            const payload = {
                command: LIVE_RELOAD_WAIT_FOR_PATCH_COMMAND,
                ok: false,
                error: `Failed to connect to the active live-reload status server for ${targetPath}.`,
                code: "connection_failed"
            };
            console.log(JSON.stringify(payload, null, 2));
            console.error(payload.error);
            process.exit(1);
        }

        const payload = {
            command: LIVE_RELOAD_WAIT_FOR_PATCH_COMMAND,
            ok: false,
            error: `No active live-reload session is registered for ${targetPath}.`,
            code: "no_session"
        };
        console.log(JSON.stringify(payload, null, 2));
        console.error(payload.error);
        process.exit(1);
    }

    let sincePatchId = options.sincePatchId;
    if (!sincePatchId) {
        try {
            const initialPayload = await fetchLiveReloadStatusPayload(discovery.session);
            sincePatchId = readLastPatchId(initialPayload) ?? undefined;
        } catch {
            // Ignore baseline fetch error; will wait for any patch
        }
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_LIVE_RELOAD_WAIT_FOR_PATCH_TIMEOUT_MS;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_LIVE_RELOAD_WAIT_FOR_PATCH_POLL_INTERVAL_MS;
    const deadline = Date.now() + timeoutMs;

    let latestPayload: Record<string, unknown> | null = null;
    try {
        latestPayload = await pollLiveReloadStatusForPatch({
            abortSignal: options.abortSignal,
            deadline,
            pollIntervalMs,
            session: discovery.session,
            sincePatchId
        });
    } catch (error) {
        const errorMessage = Core.getErrorMessage(error, {
            fallback: "Failed to wait for live-reload patch."
        });
        const payload = {
            command: LIVE_RELOAD_WAIT_FOR_PATCH_COMMAND,
            ok: false,
            error: errorMessage,
            code: "error"
        };
        console.log(JSON.stringify(payload, null, 2));
        console.error(payload.error);
        process.exit(1);
    }

    if (latestPayload !== null) {
        console.log(
            JSON.stringify(
                {
                    command: LIVE_RELOAD_WAIT_FOR_PATCH_COMMAND,
                    ok: true,
                    payload: latestPayload
                },
                null,
                2
            )
        );
        return;
    }

    const payload = {
        command: LIVE_RELOAD_WAIT_FOR_PATCH_COMMAND,
        ok: false,
        error: `Timed out waiting for a live-reload patch after ${String(timeoutMs)}ms.`,
        code: "timeout"
    };
    console.log(JSON.stringify(payload, null, 2));
    console.error(payload.error);
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
        .argument("[targetPath]", "Project directory or .yyp path to build")
        .addOption(new Option("--verbose", "Enable verbose logging").default(false))
        .addOption(new Option("--quiet", "Suppress non-essential output").default(false))
        .action(async (targetPath: string | undefined, options: LiveReloadBuildCommandOptions) =>
            runLiveReloadBuildCommand(
                targetPath ??
                    (await resolveWorkflowTargetPath({
                        fallbackPath: process.cwd(),
                        scope: "project"
                    })),
                options
            )
        );
}

function createLiveReloadWorkerSubcommand(): Command {
    const command = new Command("worker");
    applyStandardCommandOptions(command);

    return applySharedLiveReloadPrepareOptions(command)
        .description("Internal foreground live-reload worker.")
        .addOption(new Option(PROJECT_PATH_OPTION_FLAG, PROJECT_PATH_OPTION_DESCRIPTION).default(process.cwd()))
        .addOption(new Option("--session-id <id>", "Internal session identity.").makeOptionMandatory())
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
            new Option("--start-source <source>", "Live-reload session owner.")
                .choices(["cli", "mcp", "ui"])
                .default("cli")
        )
        .action((options: LiveReloadDevCommandOptions & { path: string }) =>
            runLiveReloadDevCommand(options.path, options)
        );
}

function createLiveReloadSessionSubcommand(): Command {
    const command = new Command("session");
    applyStandardCommandOptions(command);

    return applySharedLiveReloadPrepareOptions(command)
        .description("Attach to, start, replace, or stop the project live-reload session.")
        .addOption(new Option(PROJECT_PATH_OPTION_FLAG, PROJECT_PATH_OPTION_DESCRIPTION))
        .addOption(new Option("--gm-temp-root <path>", "Root directory for GameMaker HTML5 temporary outputs."))
        .addOption(new Option("--force-start", "Stop the active session before starting a replacement.").default(false))
        .addOption(new Option("--stop", "Stop the active session without starting another.").default(false))
        .addOption(
            new Option(
                "--stop-timeout-ms <ms>",
                "Maximum time to wait for the active session to shut down gracefully before reporting a stop failure."
            )
                .argParser(createMinimumValueValidator(1, "Stop timeout must be a positive integer."))
                .default(DEFAULT_LIVE_RELOAD_SESSION_STOP_TIMEOUT_MS)
        )
        .addOption(
            new Option("--format <format>", "Output format")
                .argParser(wrapInvalidArgumentResolver(coerceLiveReloadSessionOutputFormat))
                .default(DEFAULT_LIVE_RELOAD_SESSION_OUTPUT_FORMAT)
        )
        .action((options: LiveReloadSessionCommandOptions) => runLiveReloadSessionCommand(options));
}

function createLiveReloadWaitForPatchSubcommand(): Command {
    const command = new Command("wait-for-patch");
    applyStandardCommandOptions(command);

    return command
        .description("Wait until the registered live-reload session reports a new patch.")
        .addOption(new Option(PROJECT_PATH_OPTION_FLAG, PROJECT_PATH_OPTION_DESCRIPTION))
        .addOption(new Option("--since-patch-id <id>", "Existing patch id to wait past."))
        .addOption(
            new Option("--timeout-ms <ms>", "Maximum wait time in milliseconds.")
                .argParser(createMinimumValueValidator(1, "Timeout must be a positive integer."))
                .default(DEFAULT_LIVE_RELOAD_WAIT_FOR_PATCH_TIMEOUT_MS)
        )
        .addOption(
            new Option("--poll-interval-ms <ms>", "Polling interval in milliseconds.")
                .argParser(createMinimumValueValidator(1, "Poll interval must be a positive integer."))
                .default(DEFAULT_LIVE_RELOAD_WAIT_FOR_PATCH_POLL_INTERVAL_MS)
        )
        .action((options: LiveReloadWaitForPatchCommandOptions) => runLiveReloadWaitForPatchCommand(options));
}

export function createLiveReloadCommand(): Command {
    const command = new Command("live-reload");
    applyStandardCommandOptions(command);

    return command
        .description("Prepare, run, and inspect the HTML5 live-reload workflow.")
        .addCommand(createLiveReloadBuildSubcommand())
        .addCommand(createLiveReloadPrepareSubcommand())
        .addCommand(createLiveReloadSessionSubcommand())
        .addCommand(createLiveReloadWorkerSubcommand(), { hidden: true })
        .addCommand(createLiveReloadWaitForPatchSubcommand(), { hidden: true });
}
