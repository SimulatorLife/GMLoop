import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";

import {
    readPackageJson,
    resolveCandidateRoot,
    resolveFromRepoRoot,
    resolvePackageJsonPath
} from "../../shared/index.js";

const {
    assertNonEmptyString,
    getErrorMessageOrFallback,
    isErrorWithCode,
    parseJsonWithContext,
    resolveContainedRelativePath,
    toPosixPath
} = Core;

export interface ManualSourceDescriptor {
    root: string;
    packageName: string | null;
    packageJson: Record<string, unknown> | null;
}

export interface ManualSourceResolverOptions {
    manualRoot?: string | null | undefined;
    manualPackage?: string | null | undefined;
}

export type ManualSourceResolver = (options?: ManualSourceResolverOptions) => Promise<ManualSourceDescriptor>;

const DEFAULT_MANUAL_ROOT = resolveFromRepoRoot("vendor", "GameMaker-Manual");

async function ensureDirectoryExists(root, { required, label }) {
    try {
        const stats = await fs.stat(root);
        if (!stats.isDirectory()) {
            throw new Error(`${label} '${root}' must point to a directory.`);
        }
        return true;
    } catch (error) {
        if (!required && isErrorWithCode(error, "ENOENT")) {
            return false;
        }

        const message = getErrorMessageOrFallback(error);
        throw new Error(`${label} '${root}' is unavailable. (${message})`);
    }
}

export async function resolveManualSource({ manualRoot, manualPackage }: ManualSourceResolverOptions = {}) {
    const candidate = resolveCandidateRoot(manualRoot);
    if (candidate) {
        await ensureDirectoryExists(candidate.root, {
            required: true,
            label: "Manual root"
        });

        return candidate;
    }

    const defaultRootCandidate = resolveCandidateRoot(DEFAULT_MANUAL_ROOT);
    if (
        defaultRootCandidate &&
        (await ensureDirectoryExists(defaultRootCandidate.root, {
            required: false,
            label: "Manual submodule"
        }))
    ) {
        return defaultRootCandidate;
    }

    if (!manualPackage) {
        throw new Error("Manual assets were not found. Provide --manual-root or initialize vendor/GameMaker-Manual.");
    }

    const normalizedPackageName = assertNonEmptyString(manualPackage, {
        name: "manualPackage",
        errorMessage: "Manual package name must be provided."
    });

    const packageJsonPath = resolvePackageJsonPath(normalizedPackageName, "manual");
    const packageJson = await readPackageJson(packageJsonPath);
    const root = path.dirname(packageJsonPath);

    return {
        root,
        packageName: normalizedPackageName,
        packageJson
    };
}

export async function readManualText(root, relativePath) {
    const absolutePath = path.resolve(root, relativePath);

    try {
        return await fs.readFile(absolutePath, "utf8");
    } catch (error) {
        const message = getErrorMessageOrFallback(error);
        throw new Error(`Failed to read manual asset '${relativePath}' from '${root}'. (${message})`);
    }
}

export async function readManualJson(root, relativePath) {
    const contents = await readManualText(root, relativePath);

    try {
        return parseJsonWithContext(contents, {
            source: relativePath,
            description: "manual asset"
        });
    } catch (error) {
        const message = getErrorMessageOrFallback(error);
        throw new Error(`Manual asset '${relativePath}' did not contain valid JSON. (${message})`);
    }
}

export function describeManualSource(source: ManualSourceDescriptor) {
    const { root, packageName, packageJson } = source;

    if (packageName) {
        const version = typeof packageJson?.version === "string" ? packageJson.version : undefined;
        return version ? `${packageName}@${version}` : packageName;
    }

    return root;
}

function normalizeGitCommitHash(value: unknown) {
    if (typeof value !== "string") {
        return null;
    }

    const candidate = value.trim().toLowerCase();
    return /^[0-9a-f]{40}$/.test(candidate) ? candidate : null;
}

function resolveManualRootGitCommitHash(root: string) {
    try {
        const resolvedRoot = realpathSync(root);
        const gitTopLevel = execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"]
        });
        const resolvedTopLevel = realpathSync(gitTopLevel.trim());
        if (resolvedTopLevel !== resolvedRoot) {
            return null;
        }

        const output = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"]
        });

        return normalizeGitCommitHash(output);
    } catch {
        return null;
    }
}

function resolveManualPackageGitCommitHash(packageJson: Record<string, unknown> | null) {
    return normalizeGitCommitHash(packageJson?.gitHead);
}

/**
 * Resolve the GameMaker manual commit hash used for metadata generation.
 *
 * When the manual source is a git checkout (for example the
 * `vendor/GameMaker-Manual` submodule), this reads `HEAD` from that checkout.
 * If the manual source is package-based, this falls back to the package.json
 * `gitHead` field when available.
 *
 * @param source Descriptor for the resolved manual source.
 * @returns Lowercase 40-character commit hash, or null when unavailable.
 */
export function resolveManualSourceCommitHash(source: ManualSourceDescriptor) {
    return resolveManualRootGitCommitHash(source.root) ?? resolveManualPackageGitCommitHash(source.packageJson);
}

/**
 * Normalize the manual root path used within generated metadata payloads.
 *
 * When the manual root lives inside the repository tree, this emits a
 * repository-relative POSIX string so the generated artefacts avoid
 * environment-specific absolute paths. If the manual root sits outside the
 * repo, we fall back to the provided root with POSIX separators intact.
 *
 * @param source Descriptor for the resolved manual source.
 * @returns Normalized manual root representation for metadata.
 */
export function getManualRootMetadataPath(source: ManualSourceDescriptor) {
    const repoRoot = resolveFromRepoRoot();
    const relativeRoot = resolveContainedRelativePath(source.root, repoRoot);
    const candidate = relativeRoot === null ? source.root : relativeRoot === "" ? "." : relativeRoot;

    return toPosixPath(candidate);
}
