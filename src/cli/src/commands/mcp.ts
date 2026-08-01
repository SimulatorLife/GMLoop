import { spawn } from "node:child_process";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { excludeCommandFromMcpTools } from "../cli-core/mcp-command-exclusion.js";
import { readPackageJson, resolvePackageJsonPath } from "../shared/package-resolution.js";
import { SKIP_CLI_RUN_ENV_VAR } from "../shared/skip-cli-run.js";

const GMLOOP_MCP_PACKAGE_NAME = "@gmloop/mcp";
const GMLOOP_MCP_BIN_NAME = "gmloop-mcp";

function resolveMcpBinRelativePath(packageJson: Record<string, unknown>): string {
    const binField = packageJson.bin;
    if (typeof binField === "string" && binField.trim().length > 0) {
        return binField.trim();
    }

    if (!Core.isPlainObject(binField)) {
        throw new TypeError(
            `Unable to resolve '${GMLOOP_MCP_BIN_NAME}' from ${GMLOOP_MCP_PACKAGE_NAME}: ` +
                "package.json 'bin' must be a non-empty string or object."
        );
    }

    const binPath = binField[GMLOOP_MCP_BIN_NAME];
    if (typeof binPath === "string" && binPath.trim().length > 0) {
        return binPath.trim();
    }

    throw new Error(
        `Unable to resolve '${GMLOOP_MCP_BIN_NAME}' from ${GMLOOP_MCP_PACKAGE_NAME}: ` +
            `missing '${GMLOOP_MCP_BIN_NAME}' bin entry.`
    );
}

async function resolveMcpServerEntrypoint(): Promise<string> {
    const packageJsonPath = resolvePackageJsonPath(GMLOOP_MCP_PACKAGE_NAME, "MCP server");
    const packageJson = await readPackageJson(packageJsonPath);
    const binRelativePath = resolveMcpBinRelativePath(packageJson);
    return path.resolve(path.dirname(packageJsonPath), binRelativePath);
}

function runMcpServerSubprocess(entrypoint: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const childProcess = spawn(process.execPath, [entrypoint], {
            env: {
                ...process.env,
                [SKIP_CLI_RUN_ENV_VAR]: "1"
            },
            stdio: "inherit"
        });

        childProcess.once("error", reject);
        childProcess.once("exit", (code, signal) => {
            if (typeof code === "number" && code === 0) {
                resolve();
                return;
            }

            if (signal) {
                reject(new Error(`MCP server stopped by signal ${signal}.`));
                return;
            }

            reject(new Error(`MCP server exited with code ${String(code)}.`));
        });
    });
}

/**
 * Create the `gmloop mcp` command for starting the MCP stdio server.
 */
export function createMcpCommand(): Command {
    return excludeCommandFromMcpTools(
        applyStandardCommandOptions(new Command("mcp"))
            .description("Start the GMLoop MCP stdio server.")
            .addHelpText("after", () =>
                [
                    "",
                    "Examples:",
                    "  # Run the MCP server directly",
                    "  gmloop mcp",
                    "",
                    "  # Run via pnpm",
                    "  pnpm dlx gmloop mcp",
                    "",
                    "  # MCP client configuration (e.g., Claude Desktop):",
                    '  { "mcpServers": { "gmloop": { "command": "gmloop mcp" } } }'
                ].join("\n")
            )
            .action(async () => {
                if (process.env[SKIP_CLI_RUN_ENV_VAR] === "1") {
                    process.stderr.write(
                        "The 'mcp' command cannot run inside captured CLI execution contexts. " +
                            "Run it as a standalone process (for example: `gmloop mcp`).\n"
                    );
                    process.exitCode = 1;
                    return;
                }

                try {
                    const entrypoint = await resolveMcpServerEntrypoint();
                    await runMcpServerSubprocess(entrypoint);
                } catch (error) {
                    process.stderr.write(`${Core.getErrorMessageOrFallback(error)}\n`);
                    process.exitCode = 1;
                }
            })
    );
}
