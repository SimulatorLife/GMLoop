import { spawn } from "node:child_process";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { excludeCommandFromMcpTools } from "../cli-core/mcp-command-exclusion.js";
import { readPackageJson, resolvePackageJsonPath } from "../shared/package-resolution.js";
import { SKIP_CLI_RUN_ENV_VAR } from "../shared/skip-cli-run.js";

const GMLOOP_LSP_PACKAGE_NAME = "@gmloop/lsp";
const GMLOOP_LSP_BIN_NAME = "gmloop-lsp";

interface LspCommandOptions {
    readonly clientProcessId?: string;
}

function resolveLspBinRelativePath(packageJson: Record<string, unknown>): string {
    const binField = packageJson.bin;
    if (typeof binField === "string" && binField.trim().length > 0) {
        return binField.trim();
    }

    if (!Core.isPlainObject(binField)) {
        throw new TypeError(
            `Unable to resolve '${GMLOOP_LSP_BIN_NAME}' from ${GMLOOP_LSP_PACKAGE_NAME}: ` +
                "package.json 'bin' must be a non-empty string or object."
        );
    }

    const binPath = binField[GMLOOP_LSP_BIN_NAME];
    if (typeof binPath === "string" && binPath.trim().length > 0) {
        return binPath.trim();
    }

    throw new Error(
        `Unable to resolve '${GMLOOP_LSP_BIN_NAME}' from ${GMLOOP_LSP_PACKAGE_NAME}: ` +
            `missing '${GMLOOP_LSP_BIN_NAME}' bin entry.`
    );
}

async function resolveLspServerEntrypoint(): Promise<string> {
    const packageJsonPath = resolvePackageJsonPath(GMLOOP_LSP_PACKAGE_NAME, "LSP server");
    const packageJson = await readPackageJson(packageJsonPath);
    const binRelativePath = resolveLspBinRelativePath(packageJson);
    return path.resolve(path.dirname(packageJsonPath), binRelativePath);
}

function runLspServerSubprocess(entrypoint: string, clientProcessId: string | undefined): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const entrypointArguments =
            clientProcessId === undefined ? [entrypoint] : [entrypoint, "--clientProcessId", clientProcessId];
        const childProcess = spawn(process.execPath, entrypointArguments, {
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
                reject(new Error(`LSP server stopped by signal ${signal}.`));
                return;
            }

            reject(new Error(`LSP server exited with code ${String(code)}.`));
        });
    });
}

/**
 * Create the `gmloop lsp` command for starting the LSP stdio server.
 */
export function createLspCommand(): Command {
    return excludeCommandFromMcpTools(
        applyStandardCommandOptions(new Command("lsp"))
            .description("Start the GMLoop GML language server (LSP).")
            .option("--stdio", "Start the LSP server over stdio (default).")
            .option(
                "--clientProcessId <pid>",
                "Parent process id supplied by the language client for server lifecycle monitoring."
            )
            .addHelpText("after", () =>
                [
                    "",
                    "Examples:",
                    "  # Run the LSP server directly over stdio",
                    "  gmloop lsp",
                    "",
                    "  # Run via pnpm",
                    "  pnpm dlx gmloop lsp"
                ].join("\n")
            )
            .action(async (options: LspCommandOptions) => {
                if (process.env[SKIP_CLI_RUN_ENV_VAR] === "1") {
                    process.stderr.write(
                        "The 'lsp' command cannot run inside captured CLI execution contexts. " +
                            "Run it as a standalone process (for example: `gmloop lsp`).\n"
                    );
                    process.exitCode = 1;
                    return;
                }

                try {
                    const entrypoint = await resolveLspServerEntrypoint();
                    await runLspServerSubprocess(entrypoint, options.clientProcessId);
                } catch (error) {
                    process.stderr.write(`${Core.getErrorMessageOrFallback(error)}\n`);
                    process.exitCode = 1;
                }
            })
    );
}
