import path from "node:path";

import { Core } from "@gmloop/core";

import { REPO_ROOT } from "../shared/workspace-paths.js";

const { compactArray, getNonEmptyTrimmedString, isNonEmptyString, isPathSelectedByBoundaries, toArray, uniqueArray } =
    Core;
const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[A-Za-z]:[\\/]/u;
const WINDOWS_UNC_PATH_PATTERN = /^\\\\[^\\]+\\[^\\]+/u;
const WORKFLOW_PATH_DELIMITER_PATTERN = /[\n\r,;]+/u;

/**
 * Resolve workflow paths while preserving Windows absolute/UNC semantics even
 * when the CLI runs on a non-Windows host.
 *
 * Node's POSIX `path.resolve()` treats `C:\project` and `\\server\share` as
 * relative filenames on Linux/macOS, which corrupts allow/deny lists before
 * the boundary helpers can compare them. Choosing the Win32 resolver only for
 * true Windows absolute inputs keeps existing relative-path behavior intact.
 *
 * @param {string} candidate Raw workflow path candidate.
 * @returns {string} Resolved absolute path using the correct path flavor.
 */
function resolveWorkflowPathCandidate(candidate: string): string {
    if (WINDOWS_ABSOLUTE_PATH_PATTERN.test(candidate) || WINDOWS_UNC_PATH_PATTERN.test(candidate)) {
        return path.win32.resolve(candidate);
    }

    return path.resolve(candidate);
}

export interface WorkflowPathFilterOptions {
    allowPaths?: Iterable<unknown>;
    denyPaths?: Iterable<unknown>;
    allowsPath?: (candidate: string) => boolean;
    allowsDirectory?: (candidate: string) => boolean;
}

export interface WorkflowPathFilter {
    allowList: Array<string>;
    denyList: Array<string>;
    allowsPath: (candidate: string) => boolean;
    allowsDirectory: (candidate: string) => boolean;
}

/**
 * Canonical fixture directories used by workflow-based fixture discovery.
 */
export const DEFAULT_FIXTURE_DIRECTORIES = Object.freeze([
    path.resolve(REPO_ROOT, "src", "parser", "test", "input"),
    path.resolve(REPO_ROOT, "src", "format", "test")
]);

/**
 * Normalize workflow path lists into absolute, deduplicated entries.
 *
 * @param {Iterable<unknown> | null | undefined} paths
 * @returns {Array<string>}
 */
export function normalizeWorkflowPathList(paths: Iterable<unknown> | null | undefined): Array<string> {
    const entries = toArray(paths).flatMap((entry) => splitWorkflowPathEntry(entry));
    const resolved = entries.map((candidate) => resolveWorkflowPathCandidate(candidate));
    return [...(uniqueArray(resolved, { freeze: false }) as Array<string>)];
}

function splitWorkflowPathEntry(entry: unknown): Array<string> {
    const normalizedEntry = getNonEmptyTrimmedString(entry);
    if (typeof normalizedEntry !== "string") {
        return [];
    }

    return compactArray(
        normalizedEntry.split(WORKFLOW_PATH_DELIMITER_PATTERN).map((segment) => getNonEmptyTrimmedString(segment))
    ).filter((segment): segment is string => typeof segment === "string");
}

/**
 * Normalize fixture roots by combining default fixture directories with
 * caller-provided entries, then applying the workflow path filter.
 */
export function normalizeFixtureRoots(
    additionalRoots: Iterable<unknown> | Array<unknown> = [],
    filterOptions: WorkflowPathFilterOptions = {}
): Array<string> {
    const pathFilter = createWorkflowPathFilter(filterOptions);
    const additionalRootEntries = Array.isArray(additionalRoots) ? additionalRoots : toArray(additionalRoots);
    const normalizedCandidates = normalizeWorkflowPathList([...DEFAULT_FIXTURE_DIRECTORIES, ...additionalRootEntries]);

    return normalizedCandidates.filter((candidate) => pathFilter.allowsDirectory(candidate));
}

/**
 * Create a workflow path filter from allow/deny lists. Existing filters are
 * returned as-is so callers can forward custom implementations unchanged.
 *
 * @param {{
 *   allowPaths?: Iterable<unknown>,
 *   denyPaths?: Iterable<unknown>,
 *   allowsPath?: (candidate: string) => boolean,
 *   allowsDirectory?: (candidate: string) => boolean
 * } | null | undefined} filters
 * @returns {{
 *   allowList: Array<string>,
 *   denyList: Array<string>,
 *   allowsPath: (candidate: string) => boolean,
 *   allowsDirectory: (candidate: string) => boolean
 * }}
 */
export function createWorkflowPathFilter(
    filters: WorkflowPathFilterOptions | null | undefined = {}
): WorkflowPathFilter {
    if (
        filters &&
        typeof filters === "object" &&
        typeof filters.allowsDirectory === "function" &&
        typeof filters.allowsPath === "function"
    ) {
        return {
            allowList: normalizeWorkflowPathList(filters.allowPaths),
            denyList: normalizeWorkflowPathList(filters.denyPaths),
            allowsPath: filters.allowsPath,
            allowsDirectory: filters.allowsDirectory
        };
    }

    const allowList = normalizeWorkflowPathList(filters?.allowPaths);
    const denyList = normalizeWorkflowPathList(filters?.denyPaths);
    const allows = (candidate, { treatAsDirectory = false } = {}) => {
        if (typeof candidate !== "string") {
            return false;
        }

        const normalized = resolveWorkflowPathCandidate(candidate);

        return isPathSelectedByBoundaries(normalized, allowList, denyList, {
            allowBoundaryWithinCandidate: treatAsDirectory
        });
    };

    const allowsPath = (candidate) => allows(candidate);
    const allowsDirectory = (candidate) => allows(candidate, { treatAsDirectory: true });

    return {
        allowList,
        denyList,
        allowsPath,
        allowsDirectory
    };
}

/**
 * Ensure the provided directories and paths are permitted by the given
 * workflow path filter. Entries without a recognized type or missing target
 * values are ignored so callers can dynamically build the list without
 * pre-validating every field.
 *
 * @param {ReturnType<typeof createWorkflowPathFilter> | undefined | null} pathFilter
 * @param {Array<{
 *   target?: string,
 *   label?: string,
 *   type?: "directory" | "path"
 * }>} [entries]
 * @returns {void}
 */
export function ensureWorkflowPathsAllowed(pathFilter, entries = []) {
    if (!pathFilter || typeof pathFilter !== "object") {
        return;
    }

    const { allowsPath, allowsDirectory } = pathFilter;

    for (const entry of entries) {
        if (!entry || typeof entry !== "object") {
            continue;
        }

        const { target, label } = entry;
        const type = entry.type === "directory" ? "directory" : "path";

        if (!isNonEmptyString(target)) {
            continue;
        }

        const description = label ?? (type === "directory" ? "Directory" : "Path");

        if (type === "directory" && typeof allowsDirectory === "function" && !allowsDirectory(target)) {
            throw new Error(`${description} '${target}' is not permitted by workflow path filters.`);
        }

        if (type === "path" && typeof allowsPath === "function" && !allowsPath(target)) {
            throw new Error(`${description} '${target}' is not permitted by workflow path filters.`);
        }
    }
}

/**
 * Ensure the canonical manual cache and output paths are permitted by the
 * provided workflow filter. Callers can omit either path to reuse the shared
 * label/validation logic while guarding only the entries they care about.
 *
 * @param {ReturnType<typeof createWorkflowPathFilter> | undefined | null} pathFilter
 * @param {{
 *   cacheRoot?: string | null,
 *   outputPath?: string | null,
 *   cacheLabel?: string,
 *   outputLabel?: string
 * }} [options]
 * @returns {void}
 */
export function ensureManualWorkflowArtifactsAllowed(
    pathFilter: WorkflowPathFilter | null | undefined,
    {
        cacheRoot,
        outputPath,
        cacheLabel = "Manual cache root",
        outputLabel = "Manual output path"
    }: {
        cacheRoot?: string | null;
        outputPath?: string | null;
        cacheLabel?: string;
        outputLabel?: string;
    } = {}
) {
    const entries = collectManualWorkflowArtifactEntries({
        cacheRoot,
        outputPath,
        cacheLabel,
        outputLabel
    });

    if (entries.length === 0) {
        return;
    }

    ensureWorkflowPathsAllowed(pathFilter, entries);
}

interface ManualWorkflowArtifactEntry {
    type: "directory" | "path";
    target: string;
    label: string;
}

/**
 * Normalize manual workflow cache/output entries into a consistent shape so
 * validation logic can focus solely on allow/deny checks.
 */
function collectManualWorkflowArtifactEntries({
    cacheRoot,
    outputPath,
    cacheLabel,
    outputLabel
}: {
    cacheRoot?: string | null;
    outputPath?: string | null;
    cacheLabel: string;
    outputLabel: string;
}): Array<ManualWorkflowArtifactEntry> {
    const entries: Array<ManualWorkflowArtifactEntry> = [];

    if (isNonEmptyString(cacheRoot)) {
        entries.push({
            type: "directory",
            target: cacheRoot,
            label: cacheLabel
        });
    }

    if (isNonEmptyString(outputPath)) {
        entries.push({
            type: "path",
            target: outputPath,
            label: outputLabel
        });
    }

    return entries;
}
