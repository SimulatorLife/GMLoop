import type { Patch, RegistryChangeEvent } from "./types.js";

const LOG_LEVELS = {
    silent: "silent",
    error: "error",
    warn: "warn",
    info: "info",
    debug: "debug"
} as const;

/**
 * Log levels for runtime wrapper diagnostic output.
 * Ordered from least to most verbose.
 */
export type LogLevel = (typeof LOG_LEVELS)[keyof typeof LOG_LEVELS];

/**
 * Canonical set of supported log levels.
 */
export const LogLevels = Object.freeze(LOG_LEVELS);

const LOG_LEVEL_VALUES = new Set<string>(Object.values(LogLevels));

/**
 * Parse a log level string, validating it against the supported set.
 */
export function parseLogLevel(level: string): LogLevel {
    if (!LOG_LEVEL_VALUES.has(level)) {
        const validLevels = Object.values(LogLevels).join(", ");
        throw new Error(`Invalid log level: "${level}". Expected one of: ${validLevels}.`);
    }
    return level as LogLevel;
}

/**
 * Minimal console-like output interface required by the logger.
 *
 * Using a narrow interface here (rather than the full `Console` type) keeps
 * the logger decoupled from the global console API surface and makes it easy
 * to inject lightweight objects — especially in tests — without implementing
 * the full `Console` contract.
 */
export interface ConsoleOutput {
    log(...data: Array<unknown>): void;
    error(...data: Array<unknown>): void;
    warn(...data: Array<unknown>): void;
    debug(...data: Array<unknown>): void;
}

/**
 * Options for configuring the diagnostic logger.
 */
export interface LoggerOptions {
    /**
     * Minimum log level to output.
     * @default "error"
     */
    level?: LogLevel;

    /**
     * Prefix to prepend to all log messages.
     * @default "[hot-reload]"
     */
    prefix?: string;

    /**
     * Whether to include timestamps in log output.
     * @default false
     */
    timestamps?: boolean;

    /**
     * Whether to use colors and emoji in console output.
     * Automatically disabled when not in a browser console.
     * @default true
     */
    styled?: boolean;

    /**
     * Custom console-like object for output.
     * Useful for testing or custom log routing.
     * @default globalThis.console
     */
    console?: ConsoleOutput;
}

/**
 * Patch lifecycle logging.
 *
 * Provides logging operations for patch application, rollback, validation,
 * and queuing events without coupling to WebSocket, registry, or general
 * logging concerns.
 */
export interface PatchLifecycleLogger {
    /**
     * Log a patch applied successfully.
     */
    patchApplied(patch: Patch, version: number, durationMs?: number): void;

    /**
     * Log a patch that was undone.
     */
    patchUndone(patchId: string, version: number): void;

    /**
     * Log a patch that was rolled back due to an error.
     */
    patchRolledBack(patch: Patch, version: number, error: string): void;

    /**
     * Log a patch validation error.
     */
    validationError(patchId: string, error: string): void;

    /**
     * Log a shadow validation failure.
     */
    shadowValidationFailed(patchId: string, error: string): void;

    /**
     * Log patch queue flush operation.
     */
    patchQueueFlushed(count: number, durationMs: number): void;

    /**
     * Log when a patch is queued.
     */
    patchQueued(patchId: string, queueDepth: number): void;
}

/**
 * Registry lifecycle logging.
 *
 * Provides logging operations for registry management events
 * without coupling to patch or WebSocket logging.
 */
export interface RegistryLifecycleLogger {
    /**
     * Log when the registry is cleared.
     */
    registryCleared(version: number): void;
}

/**
 * WebSocket connection logging.
 *
 * Provides logging operations for WebSocket events (connection,
 * disconnection, reconnection, errors) without coupling to patch
 * or registry logging.
 */
export interface WebSocketLogger {
    /**
     * Log WebSocket connection event.
     */
    websocketConnected(url: string): void;

    /**
     * Log WebSocket disconnection.
     */
    websocketDisconnected(reason?: string): void;

    /**
     * Log a WebSocket reconnection attempt.
     */
    websocketReconnecting(attempt: number, delayMs: number): void;

    /**
     * Log a WebSocket error.
     */
    websocketError(error: string): void;
}

/**
 * General-purpose logging.
 *
 * Provides generic logging methods (warn, error, info, debug)
 * for unstructured messages without coupling to domain-specific
 * patch, registry, or WebSocket logging.
 */
export interface GeneralLogger {
    /**
     * Log a warning message.
     */
    warn(message: string, ...args: Array<unknown>): void;

    /**
     * Log an error message.
     */
    error(message: string, ...args: Array<unknown>): void;

    /**
     * Log an info message.
     */
    info(message: string, ...args: Array<unknown>): void;

    /**
     * Log a debug message.
     */
    debug(message: string, ...args: Array<unknown>): void;
}

/**
 * Logger configuration.
 *
 * Provides runtime control over logging verbosity without
 * coupling to specific logging operations.
 */
export interface LoggerConfiguration {
    /**
     * Update the current log level.
     */
    setLevel(level: LogLevel): void;

    /**
     * Get the current log level.
     */
    getLevel(): LogLevel;
}

/**
 * Complete diagnostic logger for runtime wrapper hot-reload operations.
 *
 * Combines all role-focused logging interfaces for consumers that need
 * full logging capabilities. Consumers should prefer depending on the
 * minimal interface they need (PatchLifecycleLogger, WebSocketLogger, etc.)
 * rather than this composite interface when possible.
 */
export interface Logger
    extends PatchLifecycleLogger,
        RegistryLifecycleLogger,
        WebSocketLogger,
        GeneralLogger,
        LoggerConfiguration {}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
    [LogLevels.silent]: 0,
    [LogLevels.error]: 1,
    [LogLevels.warn]: 2,
    [LogLevels.info]: 3,
    [LogLevels.debug]: 4
};

const EMOJI = {
    success: "✅",
    undo: "↶",
    rollback: "✗",
    clear: "⌧",
    warning: "⚠️",
    error: "❌",
    info: "ℹ️",
    debug: "🔍",
    websocket: "🔌",
    disconnect: "🔴",
    reconnect: "🔄",
    queue: "📦"
};

function shouldLog(configuredLevel: LogLevel, messageLevel: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[messageLevel] <= LOG_LEVEL_PRIORITY[configuredLevel];
}

function formatTimestamp(): string {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    const seconds = String(now.getSeconds()).padStart(2, "0");
    const millis = String(now.getMilliseconds()).padStart(3, "0");
    return `${hours}:${minutes}:${seconds}.${millis}`;
}

function formatDuration(durationMs: number): string {
    if (durationMs < 1) {
        return "<1ms";
    }
    if (durationMs < 1000) {
        return `${Math.round(durationMs)}ms`;
    }
    return `${(durationMs / 1000).toFixed(2)}s`;
}

/**
 * Creates a diagnostic logger for runtime wrapper operations.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
    const level = options.level === undefined ? LogLevels.error : parseLogLevel(options.level);
    const prefix = options.prefix ?? "[hot-reload]";
    const timestamps = options.timestamps ?? false;
    const styled = options.styled ?? true;
    const consoleOutput = options.console ?? console;

    let currentLevel: LogLevel = level;

    function buildPrefix(emoji?: string): string {
        const parts: Array<string> = [];

        if (timestamps) {
            parts.push(formatTimestamp());
        }

        parts.push(prefix);

        if (styled && emoji) {
            parts.push(emoji);
        }

        return parts.join(" ");
    }

    function log(messageLevel: LogLevel, emoji: string | undefined, message: string, ...args: Array<unknown>): void {
        if (!shouldLog(currentLevel, messageLevel)) {
            return;
        }

        const fullPrefix = buildPrefix(emoji);
        const fullMessage = `${fullPrefix} ${message}`;

        switch (messageLevel) {
            case "error": {
                consoleOutput.error(fullMessage, ...args);
                break;
            }
            case "warn": {
                consoleOutput.warn(fullMessage, ...args);
                break;
            }
            case "info": {
                consoleOutput.log(fullMessage, ...args);
                break;
            }
            case "debug": {
                consoleOutput.debug(fullMessage, ...args);
                break;
            }
            case "silent": {
                break;
            }
            default: {
                consoleOutput.log(fullMessage, ...args);
            }
        }
    }

    return {
        patchApplied(patch: Patch, version: number, durationMs?: number): void {
            const timing = durationMs === undefined ? "" : ` in ${formatDuration(durationMs)}`;
            log("info", EMOJI.success, `Patch ${patch.id} applied${timing} (v${version})`);
        },

        patchUndone(patchId: string, version: number): void {
            log("info", EMOJI.undo, `Undone ${patchId} (v${version})`);
        },

        patchRolledBack(patch: Patch, version: number, error: string): void {
            log("error", EMOJI.rollback, `Rollback ${patch.id} (v${version}): ${error}`);
        },

        registryCleared(version: number): void {
            log("info", EMOJI.clear, `Registry cleared (v${version})`);
        },

        validationError(patchId: string, error: string): void {
            log("error", EMOJI.error, `Validation failed for ${patchId}: ${error}`);
        },

        shadowValidationFailed(patchId: string, error: string): void {
            log("warn", EMOJI.warning, `Shadow validation failed for ${patchId}: ${error}`);
        },

        websocketConnected(url: string): void {
            log("info", EMOJI.websocket, `Connected to ${url}`);
        },

        websocketDisconnected(reason?: string): void {
            const message = reason ? `Disconnected: ${reason}` : "Disconnected";
            log("info", EMOJI.disconnect, message);
        },

        websocketReconnecting(attempt: number, delayMs: number): void {
            log("info", EMOJI.reconnect, `Reconnecting (attempt ${attempt}) in ${formatDuration(delayMs)}...`);
        },

        websocketError(error: string): void {
            log("error", EMOJI.error, `WebSocket error: ${error}`);
        },

        patchQueueFlushed(count: number, durationMs: number): void {
            log("debug", EMOJI.queue, `Flushed ${count} patches in ${formatDuration(durationMs)}`);
        },

        patchQueued(patchId: string, queueDepth: number): void {
            log("debug", EMOJI.queue, `Queued ${patchId} (depth: ${queueDepth})`);
        },

        warn(message: string, ...args: Array<unknown>): void {
            log("warn", EMOJI.warning, message, ...args);
        },

        error(message: string, ...args: Array<unknown>): void {
            log("error", EMOJI.error, message, ...args);
        },

        info(message: string, ...args: Array<unknown>): void {
            log("info", EMOJI.info, message, ...args);
        },

        debug(message: string, ...args: Array<unknown>): void {
            log("debug", EMOJI.debug, message, ...args);
        },

        setLevel(newLevel: LogLevel): void {
            currentLevel = parseLogLevel(newLevel);
        },

        getLevel(): LogLevel {
            return currentLevel;
        }
    };
}

/**
 * Creates a logger that listens to registry change events and automatically logs them.
 *
 * Depends only on patch and registry lifecycle logging, demonstrating
 * Interface Segregation: this function doesn't need WebSocket, general
 * logging, or configuration capabilities.
 */
export function createChangeEventLogger(
    logger: PatchLifecycleLogger & RegistryLifecycleLogger
): (event: RegistryChangeEvent) => void {
    return (event: RegistryChangeEvent): void => {
        switch (event.type) {
            case "patch-applied": {
                logger.patchApplied(event.patch, event.version);
                break;
            }
            case "patch-undone": {
                logger.patchUndone(event.patch.id, event.version);
                break;
            }
            case "patch-rolled-back": {
                logger.patchRolledBack(event.patch, event.version, event.error);
                break;
            }
            case "registry-cleared": {
                logger.registryCleared(event.version);
                break;
            }
        }
    };
}
