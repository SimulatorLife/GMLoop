import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { Core } from "@gmloop/core";

import { safeStatOrNull } from "../../shared/index.js";
import { DEFAULT_GM_TEMP_ROOT } from "./config.js";

/**
 * Supported external GameMaker build backends for generating HTML5 exports.
 */
export type GameMakerBuildBackend = "auto" | "gm-cli" | "igor";

/**
 * Normalized GameMaker HTML5 build configuration resolved from `gmloop.json`.
 */
export interface GameMakerHtml5BuildConfig {
    backend: GameMakerBuildBackend;
    projectPath: string;
    outputRoot: string;
    configuration: string;
    toolPath: string | null;
    runtimeRoot: string | null;
    userFolder: string | null;
    licenseFile: string | null;
    cacheDir: string | null;
    tempDir: string | null;
    extraArgs: ReadonlyArray<string>;
}

/**
 * Effective live-reload project settings resolved from project config.
 */
export interface LiveReloadProjectBuildSettings {
    buildConfig: GameMakerHtml5BuildConfig | null;
    gmTempRoot: string;
    html5OutputRoot: string | null;
}

/**
 * Result of a successful external GameMaker HTML5 build.
 */
export interface GameMakerHtml5BuildResult {
    backend: Exclude<GameMakerBuildBackend, "auto">;
    outputRoot: string;
    command: string;
    stdout: string;
    stderr: string;
}

type ProcessExecutionResult = Readonly<{
    exitCode: number;
    stderr: string;
    stdout: string;
}>;

type ProcessExecutor = (command: string, args: ReadonlyArray<string>, cwd: string) => Promise<ProcessExecutionResult>;

type IgorResolution = Readonly<{
    command: string;
    runtimeRoot: string;
    useMono: boolean;
}>;

type GameMakerCliAvailability = Readonly<{
    available: boolean;
    reason: string | null;
}>;

type BuildGameMakerHtml5OutputOptions = Readonly<{
    buildConfig: GameMakerHtml5BuildConfig;
    cwd?: string;
    executeProcess?: ProcessExecutor;
}>;

/**
 * Nominal shape contract for errors raised by the GameMaker HTML5 build pipeline.
 *
 * The concrete {@link GameMakerBuildExecutionError} class sets
 * `name = "GameMakerBuildExecutionError"` and exposes typed fields (`backend`,
 * `retryable`, etc.). Defining the shape here decouples call sites — especially
 * the fallback logic in `buildGameMakerHtml5Output` — from the concrete class so
 * that cross-realm error-like objects can participate in dispatch without
 * requiring `instanceof`. Any object that carries the expected `name` discriminant
 * and required fields satisfies this contract.
 */
export interface BuildExecutionError extends Error {
    readonly name: "GameMakerBuildExecutionError";
    readonly backend?: Exclude<GameMakerBuildBackend, "auto">;
    readonly retryable?: boolean;
    readonly command?: string;
    readonly stderr?: string;
    readonly stdout?: string;
}

/**
 * Determine whether an arbitrary thrown value satisfies the
 * {@link BuildExecutionError} contract by checking the stable `name` discriminant.
 *
 * This capability probe lets the fallback logic in `buildGameMakerHtml5Output`
 * handle cross-realm error-like objects (e.g. from sandboxed workers) that are
 * structurally equivalent to a `GameMakerBuildExecutionError` but fail an
 * `instanceof` check across execution contexts. Callers use the returned
 * reference to access the optional typed fields (`backend`, `retryable`, etc.)
 * without a separate type cast.
 *
 * @param error - Candidate value to inspect.
 * @returns `error is BuildExecutionError` when the name discriminant matches.
 */
export function isBuildExecutionError(error: unknown): error is BuildExecutionError {
    if (error == null || typeof error !== "object") {
        return false;
    }

    const candidate = error as { name?: unknown };
    return candidate.name === "GameMakerBuildExecutionError";
}

/**
 * Well-known error name emitted by the GameMaker HTML5 build pipeline.
 */
const BUILD_EXECUTION_ERROR_NAME = "GameMakerBuildExecutionError" as const;

class GameMakerBuildExecutionError extends Error {
    backend: Exclude<GameMakerBuildBackend, "auto">;
    command: string;
    retryable: boolean;
    stderr: string;
    stdout: string;

    constructor(parameters: {
        backend: Exclude<GameMakerBuildBackend, "auto">;
        command: string;
        message: string;
        retryable: boolean;
        stderr: string;
        stdout: string;
    }) {
        super(parameters.message);
        this.name = BUILD_EXECUTION_ERROR_NAME;
        this.backend = parameters.backend;
        this.command = parameters.command;
        this.retryable = parameters.retryable;
        this.stderr = parameters.stderr;
        this.stdout = parameters.stdout;
    }
}

/**
 * Resolve effective live-reload settings from a project's `gmloop.json` payload.
 *
 * This normalizes relative paths against the project root and validates the
 * GameMaker-specific `runtime.liveReload.build` block when present.
 */
export async function resolveLiveReloadProjectBuildSettings(
    projectRoot: string,
    projectConfig: Record<string, unknown>
): Promise<LiveReloadProjectBuildSettings> {
    const runtimeConfig = asRecord(projectConfig.runtime);
    const liveReloadConfig = asRecord(runtimeConfig?.liveReload);
    const html5OutputRoot = resolveOptionalConfiguredPath(projectRoot, liveReloadConfig?.html5Output, "html5Output");
    const configuredGmTempRoot = resolveOptionalConfiguredPath(projectRoot, liveReloadConfig?.gmTempRoot, "gmTempRoot");
    const buildConfig = await resolveConfiguredGameMakerHtml5BuildConfig(
        projectRoot,
        liveReloadConfig,
        html5OutputRoot
    );

    return Object.freeze({
        buildConfig,
        gmTempRoot: configuredGmTempRoot ?? DEFAULT_GM_TEMP_ROOT,
        html5OutputRoot
    });
}

/**
 * Build the configured GameMaker project into an HTML5 export directory.
 *
 * In `auto` mode this prefers `gm-cli` only when the configured request can be
 * satisfied by that surface, and otherwise falls back to Igor.
 */
export async function buildGameMakerHtml5Output({
    buildConfig,
    cwd = path.dirname(buildConfig.projectPath),
    executeProcess = executeChildProcess
}: BuildGameMakerHtml5OutputOptions): Promise<GameMakerHtml5BuildResult> {
    const backendPreference = buildConfig.backend;

    if (backendPreference === "gm-cli") {
        return await executeGameMakerCliHtml5Build(buildConfig, cwd, executeProcess);
    }

    if (backendPreference === "igor") {
        return await executeIgorHtml5Build(buildConfig, cwd, executeProcess);
    }

    const gmCliAvailability = evaluateGameMakerCliAvailability(buildConfig);
    if (gmCliAvailability.available) {
        try {
            return await executeGameMakerCliHtml5Build(buildConfig, cwd, executeProcess);
        } catch (error: unknown) {
            if (isBuildExecutionError(error) && error.backend === "gm-cli" && error.retryable === true) {
                return await executeIgorHtml5Build(buildConfig, cwd, executeProcess);
            }

            throw error;
        }
    }

    return await executeIgorHtml5Build(buildConfig, cwd, executeProcess);
}

async function resolveConfiguredGameMakerHtml5BuildConfig(
    projectRoot: string,
    liveReloadConfig: Record<string, unknown> | null,
    html5OutputRoot: string | null
): Promise<GameMakerHtml5BuildConfig | null> {
    if (!liveReloadConfig || liveReloadConfig.build === undefined) {
        return null;
    }

    const rawBuildConfig = asRecord(liveReloadConfig.build);
    if (!rawBuildConfig) {
        throw new TypeError("gmloop runtime.liveReload.build must be an object.");
    }

    if (html5OutputRoot === null) {
        throw new TypeError(
            "gmloop runtime.liveReload.html5Output must be configured when runtime.liveReload.build is enabled."
        );
    }

    return Object.freeze({
        backend: normalizeGameMakerBuildBackend(rawBuildConfig.backend),
        cacheDir: resolveOptionalConfiguredPath(projectRoot, rawBuildConfig.cacheDir, "build.cacheDir"),
        configuration: resolveConfiguredStringValue(rawBuildConfig.configuration, "build.configuration") ?? "Default",
        extraArgs: resolveConfiguredStringArray(rawBuildConfig.extraArgs, "build.extraArgs"),
        licenseFile: resolveOptionalConfiguredPath(projectRoot, rawBuildConfig.licenseFile, "build.licenseFile"),
        outputRoot: html5OutputRoot,
        projectPath:
            resolveOptionalConfiguredPath(projectRoot, rawBuildConfig.project, "build.project") ??
            (await resolveProjectManifestPath(projectRoot)),
        runtimeRoot: resolveOptionalConfiguredPath(projectRoot, rawBuildConfig.runtimeRoot, "build.runtimeRoot"),
        tempDir: resolveOptionalConfiguredPath(projectRoot, rawBuildConfig.tempDir, "build.tempDir"),
        toolPath: resolveOptionalConfiguredPath(projectRoot, rawBuildConfig.toolPath, "build.toolPath"),
        userFolder: resolveOptionalConfiguredPath(projectRoot, rawBuildConfig.userFolder, "build.userFolder")
    });
}

function normalizeGameMakerBuildBackend(value: unknown): GameMakerBuildBackend {
    if (value === undefined) {
        return "auto";
    }

    if (typeof value !== "string") {
        throw new TypeError("gmloop runtime.liveReload.build.backend must be 'auto', 'gm-cli', or 'igor'.");
    }

    const normalizedValue = value.trim();
    if (normalizedValue === "auto" || normalizedValue === "gm-cli" || normalizedValue === "igor") {
        return normalizedValue;
    }

    throw new TypeError("gmloop runtime.liveReload.build.backend must be 'auto', 'gm-cli', or 'igor'.");
}

function resolveOptionalConfiguredPath(projectRoot: string, value: unknown, key: string): string | null {
    const resolvedStringValue = resolveConfiguredStringValue(value, key);
    return resolvedStringValue ? path.resolve(projectRoot, resolvedStringValue) : null;
}

function resolveConfiguredStringValue(value: unknown, key: string): string | null {
    if (value === undefined) {
        return null;
    }

    if (typeof value !== "string") {
        throw new TypeError(`gmloop runtime.liveReload.${key} must be a string.`);
    }

    const trimmedValue = value.trim();
    return trimmedValue.length > 0 ? trimmedValue : null;
}

function resolveConfiguredStringArray(value: unknown, key: string): ReadonlyArray<string> {
    if (value === undefined) {
        return Object.freeze([]);
    }

    if (!Array.isArray(value)) {
        throw new TypeError(`gmloop runtime.liveReload.${key} must be an array of strings.`);
    }

    const normalizedValues = value.map((entry) => {
        if (typeof entry !== "string") {
            throw new TypeError(`gmloop runtime.liveReload.${key} must be an array of strings.`);
        }

        return entry.trim();
    });

    return Object.freeze(normalizedValues.filter((entry) => entry.length > 0));
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return Core.isObjectLike(value) ? (value as Record<string, unknown>) : null;
}

async function resolveProjectManifestCandidates(projectRoot: string): Promise<ReadonlyArray<string>> {
    const entries = await readdir(projectRoot, { withFileTypes: true });
    return Object.freeze(
        entries
            .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".yyp"))
            .map((entry) => path.join(projectRoot, entry.name))
            .sort((left, right) => left.localeCompare(right))
    );
}

async function resolveProjectManifestPath(projectRoot: string): Promise<string> {
    const manifestCandidates = await resolveProjectManifestCandidates(projectRoot);
    if (manifestCandidates.length === 1) {
        return manifestCandidates[0];
    }

    if (manifestCandidates.length === 0) {
        throw new Error(
            `Could not find a .yyp project file in '${projectRoot}'. Set runtime.liveReload.build.project explicitly.`
        );
    }

    throw new Error(
        `Found multiple .yyp project files in '${projectRoot}'. Set runtime.liveReload.build.project explicitly.`
    );
}

function evaluateGameMakerCliAvailability(buildConfig: GameMakerHtml5BuildConfig): GameMakerCliAvailability {
    const unsupportedOptionNames: Array<string> = [];
    if (buildConfig.configuration !== "Default") {
        unsupportedOptionNames.push("configuration");
    }

    if (unsupportedOptionNames.length > 0) {
        return Object.freeze({
            available: false,
            reason: `gm-cli does not support the configured option(s): ${unsupportedOptionNames.join(", ")}`
        });
    }

    return Object.freeze({
        available: true,
        reason: null
    });
}

async function executeGameMakerCliHtml5Build(
    buildConfig: GameMakerHtml5BuildConfig,
    cwd: string,
    executeProcess: ProcessExecutor
): Promise<GameMakerHtml5BuildResult> {
    const availability = evaluateGameMakerCliAvailability(buildConfig);
    if (!availability.available) {
        throw new GameMakerBuildExecutionError({
            backend: "gm-cli",
            command: buildConfig.toolPath ?? "gm-cli",
            message: availability.reason ?? "gm-cli could not satisfy the configured build request.",
            retryable: true,
            stderr: "",
            stdout: ""
        });
    }

    await mkdir(buildConfig.outputRoot, { recursive: true });

    const command = buildConfig.toolPath ?? "gm-cli";
    const args = [
        "package",
        buildConfig.projectPath,
        "--target=html5",
        "--runtime=vm",
        `--output=${buildConfig.outputRoot}`,
        ...(buildConfig.licenseFile === null ? [] : [`--license=${buildConfig.licenseFile}`]),
        ...(buildConfig.cacheDir === null ? [] : [`--cacheDir=${buildConfig.cacheDir}`]),
        ...buildConfig.extraArgs
    ];
    const formattedCommand = formatCommandForDisplay(command, args);

    try {
        const result = await executeProcess(command, args, cwd);
        if (result.exitCode !== 0) {
            throw createGameMakerCliFailure(buildConfig, formattedCommand, result.stdout, result.stderr);
        }

        await assertHtml5OutputExists(
            buildConfig.outputRoot,
            "gm-cli",
            formattedCommand,
            result.stdout,
            result.stderr,
            true
        );

        return Object.freeze({
            backend: "gm-cli",
            command: formattedCommand,
            outputRoot: buildConfig.outputRoot,
            stderr: result.stderr,
            stdout: result.stdout
        });
    } catch (error) {
        if (Core.isErrorWithCode(error, "ENOENT")) {
            throw new GameMakerBuildExecutionError({
                backend: "gm-cli",
                command: formattedCommand,
                message: `Could not find gm-cli executable '${command}'. Install gm-cli or configure runtime.liveReload.build.toolPath.`,
                retryable: true,
                stderr: "",
                stdout: ""
            });
        }

        throw error;
    }
}

function createGameMakerCliFailure(
    buildConfig: GameMakerHtml5BuildConfig,
    formattedCommand: string,
    stdout: string,
    stderr: string
): GameMakerBuildExecutionError {
    const combinedOutput = `${stdout}\n${stderr}`;
    const retryable =
        /Support for target 'html5'.*coming soon/iu.test(combinedOutput) ||
        /Valid targets:/iu.test(combinedOutput) ||
        /Unknown command/iu.test(combinedOutput);

    return new GameMakerBuildExecutionError({
        backend: "gm-cli",
        command: formattedCommand,
        message: formatGameMakerBuildFailureMessage(
            retryable
                ? "gm-cli could not satisfy the requested HTML5 build. Falling back to Igor."
                : `gm-cli failed to build '${buildConfig.projectPath}'.`,
            stdout,
            stderr
        ),
        retryable,
        stderr,
        stdout
    });
}

async function executeIgorHtml5Build(
    buildConfig: GameMakerHtml5BuildConfig,
    cwd: string,
    executeProcess: ProcessExecutor
): Promise<GameMakerHtml5BuildResult> {
    const igorResolution = await resolveIgorBuildCommand(buildConfig);
    const identityPaths = await resolveIgorIdentityPaths(buildConfig);
    if (identityPaths.licenseFile === null && identityPaths.userFolder === null) {
        throw new Error(
            "Could not resolve a GameMaker license or user folder for Igor. Configure runtime.liveReload.build.licenseFile or runtime.liveReload.build.userFolder."
        );
    }

    await mkdir(buildConfig.outputRoot, { recursive: true });

    const outputFileBasePath = path.join(buildConfig.outputRoot, "gmloop-html5-build");
    const igorArgs = [
        `/rp=${igorResolution.runtimeRoot}`,
        `/project=${buildConfig.projectPath}`,
        `/config=${buildConfig.configuration}`,
        "/runtime=VM",
        `/of=${outputFileBasePath}`,
        `/tf=${buildConfig.outputRoot}`,
        ...(buildConfig.cacheDir === null ? [] : [`/cache=${buildConfig.cacheDir}`]),
        ...(buildConfig.tempDir === null ? [] : [`/temp=${buildConfig.tempDir}`]),
        ...(identityPaths.licenseFile === null ? [] : [`/lf=${identityPaths.licenseFile}`]),
        ...(identityPaths.licenseFile === null && identityPaths.userFolder !== null
            ? [`/uf=${identityPaths.userFolder}`]
            : []),
        ...buildConfig.extraArgs,
        "--",
        "HTML5",
        "folder"
    ];
    const command = igorResolution.useMono ? "mono" : igorResolution.command;
    const args = igorResolution.useMono ? [igorResolution.command, ...igorArgs] : igorArgs;
    const formattedCommand = formatCommandForDisplay(command, args);

    try {
        const result = await executeProcess(command, args, cwd);
        if (result.exitCode !== 0) {
            throw new GameMakerBuildExecutionError({
                backend: "igor",
                command: formattedCommand,
                message: formatGameMakerBuildFailureMessage(
                    `Igor failed to build '${buildConfig.projectPath}'.`,
                    result.stdout,
                    result.stderr
                ),
                retryable: false,
                stderr: result.stderr,
                stdout: result.stdout
            });
        }

        await assertHtml5OutputExists(
            buildConfig.outputRoot,
            "igor",
            formattedCommand,
            result.stdout,
            result.stderr,
            false
        );

        return Object.freeze({
            backend: "igor",
            command: formattedCommand,
            outputRoot: buildConfig.outputRoot,
            stderr: result.stderr,
            stdout: result.stdout
        });
    } catch (error) {
        if (Core.isErrorWithCode(error, "ENOENT")) {
            throw new Error(
                `Could not find Igor executable '${command}'. Configure runtime.liveReload.build.toolPath or runtime.liveReload.build.runtimeRoot.`,
                { cause: error }
            );
        }

        throw error;
    }
}

async function assertHtml5OutputExists(
    outputRoot: string,
    backend: Exclude<GameMakerBuildBackend, "auto">,
    formattedCommand: string,
    stdout: string,
    stderr: string,
    retryable: boolean
): Promise<void> {
    const indexHtmlPath = path.join(outputRoot, "index.html");
    const stats = await safeStatOrNull(indexHtmlPath);
    if (stats?.isFile()) {
        return;
    }

    throw new GameMakerBuildExecutionError({
        backend,
        command: formattedCommand,
        message: formatGameMakerBuildFailureMessage(
            `${backend} completed without producing '${indexHtmlPath}'.`,
            stdout,
            stderr
        ),
        retryable,
        stderr,
        stdout
    });
}

async function resolveIgorBuildCommand(buildConfig: GameMakerHtml5BuildConfig): Promise<IgorResolution> {
    const explicitToolPath = buildConfig.toolPath;
    const explicitRuntimeRoot = buildConfig.runtimeRoot;

    if (explicitToolPath !== null) {
        const derivedRuntimeRoot = explicitRuntimeRoot ?? deriveRuntimeRootFromIgorToolPath(explicitToolPath);
        if (derivedRuntimeRoot === null) {
            throw new Error(
                `Could not infer the GameMaker runtime root from Igor tool path '${explicitToolPath}'. Set runtime.liveReload.build.runtimeRoot explicitly.`
            );
        }

        return Object.freeze({
            command: explicitToolPath,
            runtimeRoot: derivedRuntimeRoot,
            useMono: shouldUseMonoForIgor(explicitToolPath)
        });
    }

    const runtimeRoot = explicitRuntimeRoot ?? (await resolveDefaultGameMakerRuntimeRoot());
    if (runtimeRoot === null) {
        throw new Error(
            "Could not locate a GameMaker runtime installation. Configure runtime.liveReload.build.runtimeRoot or runtime.liveReload.build.toolPath."
        );
    }

    const igorPath = await resolveIgorExecutablePathFromRuntimeRoot(runtimeRoot);
    if (igorPath === null) {
        throw new Error(
            `Could not locate Igor under runtime root '${runtimeRoot}'. Configure runtime.liveReload.build.toolPath explicitly.`
        );
    }

    return Object.freeze({
        command: igorPath,
        runtimeRoot,
        useMono: shouldUseMonoForIgor(igorPath)
    });
}

function shouldUseMonoForIgor(igorPath: string): boolean {
    return process.platform !== "win32" && igorPath.toLowerCase().endsWith(".exe");
}

function deriveRuntimeRootFromIgorToolPath(igorToolPath: string): string | null {
    let currentPath = path.resolve(igorToolPath);
    while (currentPath !== path.dirname(currentPath)) {
        currentPath = path.dirname(currentPath);
        if (path.basename(currentPath).startsWith("runtime-")) {
            return currentPath;
        }
    }

    return null;
}

async function resolveDefaultGameMakerRuntimeRoot(): Promise<string | null> {
    const runtimeCacheRoots = resolveGameMakerRuntimeCacheRoots();
    const runtimeCandidateGroups = await Promise.all(
        runtimeCacheRoots.map(async (cacheRoot) => await collectRuntimeRootsFromCacheRoot(cacheRoot))
    );
    const runtimeCandidates = runtimeCandidateGroups.flat();

    runtimeCandidates.sort(
        (left, right) => right.mtimeMs - left.mtimeMs || left.runtimeRoot.localeCompare(right.runtimeRoot)
    );
    return runtimeCandidates[0]?.runtimeRoot ?? null;
}

async function collectRuntimeRootsFromCacheRoot(
    cacheRoot: string
): Promise<ReadonlyArray<Readonly<{ mtimeMs: number; runtimeRoot: string }>>> {
    const cacheRootStats = await safeStatOrNull(cacheRoot);
    if (!cacheRootStats?.isDirectory()) {
        return Object.freeze([]);
    }

    const entries = await readdir(cacheRoot, { withFileTypes: true });
    const runtimeCandidates = await Promise.all(
        entries
            .filter((entry) => entry.isDirectory() && entry.name.startsWith("runtime-"))
            .map(async (entry) => {
                const runtimeRoot = path.join(cacheRoot, entry.name);
                const runtimeStats = await safeStatOrNull(runtimeRoot);
                if (!runtimeStats?.isDirectory()) {
                    return null;
                }

                return Object.freeze({
                    mtimeMs: runtimeStats.mtimeMs,
                    runtimeRoot
                });
            })
    );

    return Object.freeze(
        runtimeCandidates.filter(
            (
                runtimeCandidate
            ): runtimeCandidate is Readonly<{
                mtimeMs: number;
                runtimeRoot: string;
            }> => runtimeCandidate !== null
        )
    );
}

function resolveGameMakerRuntimeCacheRoots(): ReadonlyArray<string> {
    if (process.platform === "darwin") {
        return Object.freeze([
            "/Users/Shared/GameMakerStudio2/Cache/runtimes",
            "/Users/Shared/GameMaker/Cache/runtimes"
        ]);
    }

    if (process.platform === "win32") {
        const programData = process.env.PROGRAMDATA ?? String.raw`C:\ProgramData`;
        return Object.freeze([
            path.join(programData, "GameMakerStudio2", "Cache", "runtimes"),
            path.join(programData, "GameMaker", "Cache", "runtimes")
        ]);
    }

    return Object.freeze([]);
}

async function resolveIgorExecutablePathFromRuntimeRoot(runtimeRoot: string): Promise<string | null> {
    const igorRoot = path.join(runtimeRoot, "bin", "igor");
    const igorRootStats = await safeStatOrNull(igorRoot);
    if (!igorRootStats?.isDirectory()) {
        return null;
    }

    const platformDirectories = await readdir(igorRoot, { withFileTypes: true });
    const candidatePathGroups = await Promise.all(
        platformDirectories
            .filter((platformDirectory) => platformDirectory.isDirectory())
            .map(async (platformDirectory) => {
                const platformDirectoryPath = path.join(igorRoot, platformDirectory.name);
                const nestedEntries = await readdir(platformDirectoryPath, { withFileTypes: true });
                const nestedCandidatePaths = nestedEntries
                    .filter((nestedEntry) => nestedEntry.isDirectory())
                    .flatMap((nestedEntry) => [
                        path.join(platformDirectoryPath, nestedEntry.name, "Igor.exe"),
                        path.join(platformDirectoryPath, nestedEntry.name, "igor.exe")
                    ]);

                return [
                    ...nestedCandidatePaths,
                    path.join(platformDirectoryPath, "Igor.exe"),
                    path.join(platformDirectoryPath, "igor.exe")
                ];
            })
    );
    const candidatePaths = candidatePathGroups.flat();
    const candidateMatches = await Promise.all(
        candidatePaths.map(async (candidatePath) => {
            const candidateStats = await safeStatOrNull(candidatePath);
            return candidateStats?.isFile() ? candidatePath : null;
        })
    );

    return candidateMatches.find((candidatePath) => candidatePath !== null) ?? null;
}

async function resolveIgorIdentityPaths(
    buildConfig: GameMakerHtml5BuildConfig
): Promise<Readonly<{ licenseFile: string | null; userFolder: string | null }>> {
    if (buildConfig.licenseFile !== null) {
        return Object.freeze({
            licenseFile: buildConfig.licenseFile,
            userFolder: buildConfig.userFolder
        });
    }

    if (buildConfig.userFolder !== null) {
        const inferredLicensePath = path.join(buildConfig.userFolder, "licence.plist");
        const inferredLicenseStats = await safeStatOrNull(inferredLicensePath);
        return Object.freeze({
            licenseFile: inferredLicenseStats?.isFile() ? inferredLicensePath : null,
            userFolder: buildConfig.userFolder
        });
    }

    const autoDetectedUserFolder = await resolveDefaultGameMakerUserFolder();
    if (autoDetectedUserFolder === null) {
        return Object.freeze({
            licenseFile: null,
            userFolder: null
        });
    }

    const autoDetectedLicensePath = path.join(autoDetectedUserFolder, "licence.plist");
    const autoDetectedLicenseStats = await safeStatOrNull(autoDetectedLicensePath);
    return Object.freeze({
        licenseFile: autoDetectedLicenseStats?.isFile() ? autoDetectedLicensePath : null,
        userFolder: autoDetectedUserFolder
    });
}

async function resolveDefaultGameMakerUserFolder(): Promise<string | null> {
    const userSupportRoots = resolveGameMakerUserSupportRoots();
    const userFolderCandidateGroups = await Promise.all(
        userSupportRoots.map(async (supportRoot) => await collectGameMakerUserFoldersFromSupportRoot(supportRoot))
    );
    const userFolderCandidates = userFolderCandidateGroups.flat();

    userFolderCandidates.sort(
        (left, right) => right.mtimeMs - left.mtimeMs || left.userFolder.localeCompare(right.userFolder)
    );
    return userFolderCandidates[0]?.userFolder ?? null;
}

async function collectGameMakerUserFoldersFromSupportRoot(
    supportRoot: string
): Promise<ReadonlyArray<Readonly<{ mtimeMs: number; userFolder: string }>>> {
    const supportRootStats = await safeStatOrNull(supportRoot);
    if (!supportRootStats?.isDirectory()) {
        return Object.freeze([]);
    }

    const entries = await readdir(supportRoot, { withFileTypes: true });
    const userFolderCandidates = await Promise.all(
        entries
            .filter((entry) => entry.isDirectory())
            .map(async (entry) => {
                const userFolderPath = path.join(supportRoot, entry.name);
                const licensePath = path.join(userFolderPath, "licence.plist");
                const licenseStats = await safeStatOrNull(licensePath);
                if (!licenseStats?.isFile()) {
                    return null;
                }

                return Object.freeze({
                    mtimeMs: licenseStats.mtimeMs,
                    userFolder: userFolderPath
                });
            })
    );

    return Object.freeze(
        userFolderCandidates.filter(
            (
                userFolderCandidate
            ): userFolderCandidate is Readonly<{
                mtimeMs: number;
                userFolder: string;
            }> => userFolderCandidate !== null
        )
    );
}

function resolveGameMakerUserSupportRoots(): ReadonlyArray<string> {
    const homeDirectory = process.env.HOME ?? process.env.USERPROFILE ?? "";
    const appDataDirectory = process.env.APPDATA ?? "";

    if (process.platform === "darwin") {
        return Object.freeze([
            path.join(homeDirectory, "Library", "Application Support", "GameMakerStudio2"),
            path.join(homeDirectory, "Library", "Application Support", "GameMaker")
        ]);
    }

    if (process.platform === "win32") {
        return Object.freeze([
            path.join(appDataDirectory, "GameMakerStudio2"),
            path.join(appDataDirectory, "GameMaker")
        ]);
    }

    return Object.freeze([]);
}

async function executeChildProcess(
    command: string,
    args: ReadonlyArray<string>,
    cwd: string
): Promise<ProcessExecutionResult> {
    return await new Promise<ProcessExecutionResult>((resolve, reject) => {
        const childProcess = spawn(command, [...args], {
            cwd,
            stdio: ["ignore", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";

        childProcess.stdout.on("data", (chunk: Buffer | string) => {
            stdout += String(chunk);
        });
        childProcess.stderr.on("data", (chunk: Buffer | string) => {
            stderr += String(chunk);
        });
        childProcess.once("error", reject);
        childProcess.once("close", (exitCode) => {
            resolve(
                Object.freeze({
                    exitCode: typeof exitCode === "number" ? exitCode : 1,
                    stderr,
                    stdout
                })
            );
        });
    });
}

function formatGameMakerBuildFailureMessage(summary: string, stdout: string, stderr: string): string {
    const outputDetails = [stderr.trim(), stdout.trim()].filter((entry) => entry.length > 0).join("\n\n");
    return outputDetails.length > 0 ? `${summary}\n\n${outputDetails}` : summary;
}

function formatCommandForDisplay(command: string, args: ReadonlyArray<string>): string {
    return [command, ...args].map(quoteShellToken).join(" ");
}

function quoteShellToken(token: string): string {
    return /\s/u.test(token) ? JSON.stringify(token) : token;
}

export const __test__ = Object.freeze({
    evaluateGameMakerCliAvailability,
    formatCommandForDisplay,
    resolveConfiguredGameMakerHtml5BuildConfig,
    resolveDefaultGameMakerRuntimeRoot,
    resolveDefaultGameMakerUserFolder,
    resolveIgorExecutablePathFromRuntimeRoot,
    resolveProjectManifestCandidates
});
