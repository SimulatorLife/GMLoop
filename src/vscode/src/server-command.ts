import path from "node:path";

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
 * Inputs used to locate a GMLoop language server without relying only on the
 * extension host's inherited PATH.
 */
export type GmloopLanguageServerResolutionOptions = Readonly<{
    environment: Readonly<Record<string, string | undefined>>;
    extensionPath: string | null;
    homeDirectory: string;
    pathExists: (candidatePath: string) => boolean;
    platform: NodeJS.Platform;
    resolveRealPath: (candidatePath: string) => string;
    workspaceFolderPaths: readonly string[];
}>;

/**
 * Concrete launch mode for either a Node module or a native executable.
 */
export type GmloopLanguageServerLaunch =
    | Readonly<{
          args: readonly string[];
          kind: "executable";
          command: string;
      }>
    | Readonly<{
          args: readonly string[];
          kind: "module";
          modulePath: string;
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

function executableName(platform: NodeJS.Platform): string {
    return platform === "win32" ? "gmloop.cmd" : "gmloop";
}

function createPathLaunch(
    candidatePath: string,
    args: readonly string[],
    options: GmloopLanguageServerResolutionOptions
): GmloopLanguageServerLaunch {
    try {
        const realPath = options.resolveRealPath(candidatePath);
        if (path.extname(realPath) === ".js") {
            return Object.freeze({
                args,
                kind: "module",
                modulePath: realPath
            });
        }
    } catch {
        // The executable can still be launched directly if realpath resolution races with a filesystem update.
    }

    return Object.freeze({
        args,
        kind: "executable",
        command: candidatePath
    });
}

function addPnpmHomeCandidates(candidates: string[], pnpmHome: string | undefined, binaryName: string): void {
    if (pnpmHome === undefined || pnpmHome.trim().length === 0) {
        return;
    }

    const normalizedHome = pnpmHome.trim();
    candidates.push(path.join(normalizedHome, "bin", binaryName), path.join(normalizedHome, binaryName));
}

function resolveDefaultServerCandidates(
    options: GmloopLanguageServerResolutionOptions
): readonly Readonly<{ args: readonly string[]; path: string }>[] {
    const binaryName = executableName(options.platform);
    const cliCandidates: string[] = [];

    for (const workspaceFolderPath of options.workspaceFolderPaths) {
        cliCandidates.push(
            path.join(workspaceFolderPath, "src", "cli", "dist", "index.js"),
            path.join(workspaceFolderPath, "node_modules", ".bin", binaryName)
        );
    }

    if (options.extensionPath !== null) {
        cliCandidates.push(path.resolve(options.extensionPath, "..", "cli", "dist", "index.js"));
    }

    addPnpmHomeCandidates(cliCandidates, options.environment.PNPM_HOME, binaryName);
    addPnpmHomeCandidates(cliCandidates, path.join(options.homeDirectory, "Library", "pnpm"), binaryName);
    addPnpmHomeCandidates(cliCandidates, path.join(options.homeDirectory, ".local", "share", "pnpm"), binaryName);
    addPnpmHomeCandidates(cliCandidates, path.join(options.homeDirectory, "AppData", "Local", "pnpm"), binaryName);

    const npmPrefix = options.environment.npm_config_prefix;
    if (npmPrefix !== undefined && npmPrefix.trim().length > 0) {
        cliCandidates.push(path.join(npmPrefix.trim(), "bin", binaryName));
    }

    const candidates: Array<Readonly<{ args: readonly string[]; path: string }>> = [];
    if (options.extensionPath !== null) {
        candidates.push({
            args: [],
            path: path.join(options.extensionPath, "server", "dist", "src", "main.js")
        });
    }
    candidates.push(
        ...[...new Set(cliCandidates)].map((candidatePath) => ({
            args: GMLOOP_LSP_ARGUMENTS,
            path: candidatePath
        }))
    );
    return candidates;
}

/**
 * Resolve the configured server or the nearest installed GMLoop CLI into a
 * launch mode that works even when a GUI extension host has a reduced PATH.
 */
export function resolveGmloopLanguageServerLaunch(
    configuredServerPath: unknown,
    options: GmloopLanguageServerResolutionOptions
): GmloopLanguageServerLaunch {
    const configuredCommand = resolveGmloopLanguageServerCommand(configuredServerPath);
    if (configuredCommand.command !== DEFAULT_GMLOOP_SERVER_PATH) {
        if (options.pathExists(configuredCommand.command)) {
            return createPathLaunch(configuredCommand.command, GMLOOP_LSP_ARGUMENTS, options);
        }

        return Object.freeze({
            args: GMLOOP_LSP_ARGUMENTS,
            kind: "executable",
            command: configuredCommand.command
        });
    }

    for (const candidate of resolveDefaultServerCandidates(options)) {
        if (options.pathExists(candidate.path)) {
            return createPathLaunch(candidate.path, candidate.args, options);
        }
    }

    return Object.freeze({
        args: GMLOOP_LSP_ARGUMENTS,
        kind: "executable",
        command: DEFAULT_GMLOOP_SERVER_PATH
    });
}
