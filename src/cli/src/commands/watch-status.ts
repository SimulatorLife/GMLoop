/**
 * Watch status command for querying the watch command's status server.
 *
 * Provides a human-friendly interface to the watch command's HTTP status
 * server, displaying metrics, recent patches, and error information without
 * interrupting the running watcher.
 */

import { Core } from "@gmloop/core";
import { Command, Option } from "commander";

import { portValidator } from "../cli-core/command-parsing.js";
import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";

const { getErrorMessage } = Core;

interface WatchStatusCommandOptions {
    statusHost?: string;
    statusPort?: number;
    format?: "pretty" | "json";
    endpoint?: "status" | "health" | "ping" | "ready";
}

/**
 * Formats uptime milliseconds into a human-readable string.
 *
 * @param {number} ms - Uptime in milliseconds
 * @returns {string} Formatted uptime string
 */
function formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
        return `${days}d ${hours % 24}h ${minutes % 60}m`;
    }
    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    }
    if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
}

/**
 * Formats a timestamp into a human-readable relative time string.
 *
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string} Formatted relative time string
 */
function formatRelativeTime(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);

    if (seconds < 60) {
        return `${seconds}s ago`;
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        return `${minutes}m ago`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return `${hours}h ago`;
    }
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

/**
 * Fetches data from the status server endpoint.
 *
 * @param {string} host - Server host
 * @param {number} port - Server port
 * @param {string} endpoint - Endpoint path
 * @returns {Promise<unknown>} Response data
 */
async function fetchStatus(host: string, port: number, endpoint: string): Promise<unknown> {
    const url = `http://${host}:${port}/${endpoint}`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Displays status information in pretty format.
 *
 * @param {unknown} data - Status data
 * @param {string} endpoint - Endpoint name
 */
function displayPretty(data: unknown, endpoint: string): void {
    if (endpoint === "ping") {
        console.log("✓ Watch command is running");
        return;
    }

    if (endpoint === "ready") {
        const readyData = data as { ready: boolean; uptime?: number };
        if (readyData.ready) {
            console.log("✓ Watch command is ready");
            if (readyData.uptime !== undefined) {
                console.log(`  Uptime: ${formatUptime(readyData.uptime)}`);
            }
        } else {
            console.log("✗ Watch command is not ready");
        }
        return;
    }

    if (endpoint === "health") {
        const healthData = data as {
            status: string;
            uptime: number;
            checks: {
                transpilation: { status: string; patchCount: number; errorCount: number };
                websocket: { status: string; clients: number };
            };
        };
        console.log(`Health: ${healthData.status.toUpperCase()}`);
        console.log(`Uptime: ${formatUptime(healthData.uptime)}`);
        console.log("\nChecks:");
        console.log(`  Transpilation: ${healthData.checks.transpilation.status}`);
        console.log(`    - Patches: ${healthData.checks.transpilation.patchCount}`);
        console.log(`    - Errors: ${healthData.checks.transpilation.errorCount}`);
        console.log(`  WebSocket: ${healthData.checks.websocket.status}`);
        console.log(`    - Connected clients: ${healthData.checks.websocket.clients}`);
        return;
    }

    // Default to full status display
    const statusData = data as {
        uptime: number;
        patchCount: number;
        errorCount: number;
        websocketClients: number;
        recentPatches: Array<{
            id: string;
            timestamp: number;
            durationMs: number;
            filePath: string;
        }>;
        recentErrors: Array<{
            timestamp: number;
            filePath: string;
            error: string;
        }>;
    };

    console.log("=== Watch Command Status ===\n");
    console.log(`Uptime: ${formatUptime(statusData.uptime)}`);
    console.log(`Total patches: ${statusData.patchCount}`);
    console.log(`Total errors: ${statusData.errorCount}`);
    console.log(`WebSocket clients: ${statusData.websocketClients}`);

    if (statusData.recentPatches.length > 0) {
        console.log("\nRecent patches:");
        for (const patch of statusData.recentPatches) {
            console.log(`  ${formatRelativeTime(patch.timestamp)} - ${patch.filePath}`);
            console.log(`    ID: ${patch.id}`);
            console.log(`    Duration: ${patch.durationMs.toFixed(2)}ms`);
        }
    }

    if (statusData.recentErrors.length > 0) {
        console.log("\nRecent errors:");
        for (const error of statusData.recentErrors) {
            console.log(`  ${formatRelativeTime(error.timestamp)} - ${error.filePath}`);
            console.log(`    Error: ${error.error}`);
        }
    }
}

/**
 * Executes the watch-status command.
 *
 * @param {object} options - Command options
 * @param {string} [options.statusHost] - Status server host
 * @param {number} [options.statusPort] - Status server port
 * @param {string} [options.format] - Output format (pretty or json)
 * @param {string} [options.endpoint] - Endpoint to query
 */
export async function runWatchStatusCommand(options: WatchStatusCommandOptions = {}): Promise<void> {
    const { statusHost = "127.0.0.1", statusPort = 17_891, format = "pretty", endpoint = "status" } = options;

    try {
        const data = await fetchStatus(statusHost, statusPort, endpoint);

        if (format === "json") {
            console.log(JSON.stringify(data, null, 2));
        } else {
            displayPretty(data, endpoint);
        }
    } catch (error) {
        const message = getErrorMessage(error, {
            fallback: "Unknown error"
        });

        if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
            console.error(
                [
                    `Failed to connect to watch status server at ${statusHost}:${statusPort}.`,
                    "Is the watch command running?",
                    "Start it with: pnpm run cli -- watch",
                    `If watch uses a custom status server address, query with: pnpm run cli -- watch-status --status-host ${statusHost} --status-port ${statusPort}`
                ].join("\n")
            );
        } else {
            console.error(`Error querying watch status: ${message}`);
        }
        process.exit(1);
    }
}

/**
 * Creates the watch-status command.
 *
 * @returns {Command} Commander command instance
 */
export function createWatchStatusCommand(): Command {
    const command = new Command("watch-status");

    applyStandardCommandOptions(command);

    command
        .description("Query the running watch command's status server for metrics and diagnostics")
        .addOption(
            new Option("--status-host <host>", "Status server host").default("127.0.0.1").env("WATCH_STATUS_HOST")
        )
        .addOption(
            new Option("--status-port <port>", "Status server port")
                .argParser(portValidator)
                .default(17_891)
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
        .addHelpText(
            "after",
            `
Examples:
  pnpm run cli watch-status
  pnpm run cli watch-status --status-port 18000
  pnpm run cli watch-status --endpoint health
  pnpm run cli watch-status --format json`
        )
        .action((options: WatchStatusCommandOptions) => runWatchStatusCommand(options));

    return command;
}
