import path from "node:path";

const LOCAL_EXTENSION_RUNTIME_FILES = [
    "dist/src/extension.js",
    "dist/src/extension.js.map",
    "dist/src/server-command.js",
    "dist/src/server-command.js.map",
    "dist/src/sync.js",
    "dist/src/sync.js.map"
] as const;

const LOCAL_EXTENSION_ASSET_FILES = [
    "language-configuration.json",
    "syntaxes/gml.tmLanguage.json",
    "syntaxes/markdown-gml.tmLanguage.json"
] as const;

const SYNCHRONIZED_MANIFEST_FIELDS = [
    "activationEvents",
    "categories",
    "contributes",
    "description",
    "displayName",
    "engines",
    "main",
    "version"
] as const;

type JsonRecord = Record<string, unknown>;

/** Inputs used to locate a local GMLoop source tree for development synchronization. */
export interface ResolveLocalGmlLoopRootsParameters {
    readonly configuredServerPath: unknown;
    readonly workspaceFolderPaths: readonly string[];
    readonly existsSync: (path: string) => boolean;
}

/** Inputs used to synchronize built local extension artifacts into an installed extension. */
export interface SyncLocalExtensionFilesParameters {
    readonly monorepoRoots: readonly string[];
    readonly extensionPath: string;
    readonly existsSync: (path: string) => boolean;
    readonly readFileSync: (path: string, encoding: "utf8") => string;
    readonly writeFileSync: (path: string, data: string) => void;
    readonly copyFileSync: (src: string, dest: string) => void;
    readonly onChanged: () => void;
    readonly logError?: (message: string, error: unknown) => void;
}

function isJsonRecord(value: unknown): value is JsonRecord {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJsonRecord(content: string, filePath: string): JsonRecord {
    const parsed: unknown = JSON.parse(content);
    if (!isJsonRecord(parsed)) {
        throw new TypeError(`Expected ${filePath} to contain a JSON object.`);
    }
    return parsed;
}

function isLocalGmlLoopRoot(rootPath: string, existsSync: (path: string) => boolean): boolean {
    return existsSync(path.join(rootPath, "src/vscode/package.json"));
}

function addRootIfLocalGmlLoop(roots: string[], candidateRoot: string, existsSync: (path: string) => boolean): void {
    const normalizedRoot = path.resolve(candidateRoot);
    if (roots.includes(normalizedRoot) || !isLocalGmlLoopRoot(normalizedRoot, existsSync)) {
        return;
    }
    roots.push(normalizedRoot);
}

/**
 * Resolve local GMLoop source roots from the configured server path and open workspace folders.
 *
 * An absolute `gmloop.serverPath` such as `.../src/cli/dist/index.js` is the existing
 * development configuration, so no additional user-facing setting is required.
 */
export function resolveLocalGmlLoopRoots(parameters: ResolveLocalGmlLoopRootsParameters): readonly string[] {
    const roots: string[] = [];

    if (typeof parameters.configuredServerPath === "string" && path.isAbsolute(parameters.configuredServerPath)) {
        let candidate = path.dirname(parameters.configuredServerPath);
        for (let depth = 0; depth < 8; depth += 1) {
            addRootIfLocalGmlLoop(roots, candidate, parameters.existsSync);
            const parent = path.dirname(candidate);
            if (parent === candidate) {
                break;
            }
            candidate = parent;
        }
    }

    for (const workspaceFolderPath of parameters.workspaceFolderPaths) {
        addRootIfLocalGmlLoop(roots, workspaceFolderPath, parameters.existsSync);
    }

    return Object.freeze(roots);
}

function copyChangedFile(
    parameters: SyncLocalExtensionFilesParameters,
    sourcePath: string,
    destinationPath: string
): boolean {
    if (path.resolve(sourcePath) === path.resolve(destinationPath) || !parameters.existsSync(sourcePath)) {
        return false;
    }

    if (parameters.existsSync(destinationPath)) {
        const sourceContent = parameters.readFileSync(sourcePath, "utf8");
        const destinationContent = parameters.readFileSync(destinationPath, "utf8");
        if (sourceContent === destinationContent) {
            return false;
        }
    }

    try {
        parameters.copyFileSync(sourcePath, destinationPath);
        return true;
    } catch (error) {
        parameters.logError?.(`Failed to sync ${sourcePath} to ${destinationPath}:`, error);
        return false;
    }
}

function synchronizeExtensionManifest(parameters: SyncLocalExtensionFilesParameters, monorepoRoot: string): boolean {
    const sourcePath = path.join(monorepoRoot, "src/vscode/package.json");
    const destinationPath = path.join(parameters.extensionPath, "package.json");
    if (
        path.resolve(sourcePath) === path.resolve(destinationPath) ||
        !parameters.existsSync(sourcePath) ||
        !parameters.existsSync(destinationPath)
    ) {
        return false;
    }

    try {
        const sourceManifest = readJsonRecord(parameters.readFileSync(sourcePath, "utf8"), sourcePath);
        const destinationManifest = readJsonRecord(parameters.readFileSync(destinationPath, "utf8"), destinationPath);
        const mergedManifest: JsonRecord = { ...destinationManifest };
        for (const field of SYNCHRONIZED_MANIFEST_FIELDS) {
            if (Object.hasOwn(sourceManifest, field)) {
                mergedManifest[field] = sourceManifest[field];
            }
        }
        const serializedManifest = `${JSON.stringify(mergedManifest, null, 2)}\n`;
        if (parameters.readFileSync(destinationPath, "utf8") === serializedManifest) {
            return false;
        }
        parameters.writeFileSync(destinationPath, serializedManifest);
        return true;
    } catch (error) {
        parameters.logError?.(`Failed to sync ${sourcePath} to ${destinationPath}:`, error);
        return false;
    }
}

/**
 * Synchronize the latest built local extension runtime and manifest into the installed extension.
 *
 * The installed extension identity and dependency tree remain intact; only source-owned runtime,
 * contribution, and editor asset fields are updated. A single reload notification is emitted when
 * at least one artifact changed.
 */
export function syncLocalExtensionFilesPure(parameters: SyncLocalExtensionFilesParameters): void {
    for (const monorepoRoot of parameters.monorepoRoots) {
        if (
            !isLocalGmlLoopRoot(monorepoRoot, parameters.existsSync) ||
            !LOCAL_EXTENSION_RUNTIME_FILES.every((relativePath) =>
                parameters.existsSync(path.join(monorepoRoot, "src/vscode", relativePath))
            )
        ) {
            continue;
        }

        let changed = false;
        for (const relativePath of [...LOCAL_EXTENSION_RUNTIME_FILES, ...LOCAL_EXTENSION_ASSET_FILES]) {
            changed =
                copyChangedFile(
                    parameters,
                    path.join(monorepoRoot, "src/vscode", relativePath),
                    path.join(parameters.extensionPath, relativePath)
                ) || changed;
        }
        changed = synchronizeExtensionManifest(parameters, monorepoRoot) || changed;

        if (changed) {
            parameters.onChanged();
        }
        return;
    }
}
