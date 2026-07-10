/**
 * Default executable used to start the GMLoop CLI-backed language server.
 */
export const DEFAULT_GMLOOP_SERVER_PATH = "gmloop";

const GMLOOP_LSP_ARGUMENT = "lsp";
const GMLOOP_LSP_ARGUMENTS = [GMLOOP_LSP_ARGUMENT] as const;

/**
 * Command used by the VSCode language client to start the GMLoop LSP server.
 */
export type GmloopLanguageServerCommand = Readonly<{
    args: readonly [typeof GMLOOP_LSP_ARGUMENT];
    command: string;
}>;

/**
 * Executable server options passed to VSCode's language client.
 */
export type GmloopLanguageServerExecutableOptions = Readonly<{
    args: readonly [typeof GMLOOP_LSP_ARGUMENT];
    command: string;
}>;

/**
 * Resolve the configured GMLoop CLI path into the fixed language-server command.
 */
export function resolveGmloopLanguageServerCommand(configuredServerPath: unknown): GmloopLanguageServerCommand {
    const command =
        typeof configuredServerPath === "string" && configuredServerPath.trim().length > 0
            ? configuredServerPath.trim()
            : DEFAULT_GMLOOP_SERVER_PATH;

    return Object.freeze({
        command,
        args: GMLOOP_LSP_ARGUMENTS
    });
}

/**
 * Resolve executable options for VSCode's language client without adding transport flags.
 */
export function resolveGmloopLanguageServerExecutableOptions(
    configuredServerPath: unknown
): GmloopLanguageServerExecutableOptions {
    const serverCommand = resolveGmloopLanguageServerCommand(configuredServerPath);
    const args: readonly [typeof GMLOOP_LSP_ARGUMENT] = [GMLOOP_LSP_ARGUMENT];

    return Object.freeze({
        command: serverCommand.command,
        args
    });
}
