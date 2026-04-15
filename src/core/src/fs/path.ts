import { realpathSync } from "node:fs";
import path from "node:path";

import { isNonEmptyString } from "../utils/string.js";

const WINDOWS_SEPARATOR_PATTERN = /\\+/g;
const POSIX_SEPARATOR_PATTERN = /\/+/g;
const WINDOWS_DRIVE_LETTER_PATTERN = /^[A-Za-z]:/;
const UNC_PREFIX_PATTERN = /^\\\\/;
// Match `..` path segments while tolerating either separator so we can detect
// when `path.relative` escapes the provided parent without rejecting file names
// that legitimately begin with `..`.
const PARENT_SEGMENT_PATTERN = /(?:^|[\\/])\.\.(?:[\\/]|$)/;

// Windows path patterns for root detection and normalization
const WINDOWS_DRIVE_ROOT_PATTERN = /^[A-Za-z]:\\$/;
const WINDOWS_DRIVE_ROOT_WITH_OPTIONAL_SEPARATOR_PATTERN = /^(?:[A-Za-z]:)\\?$/;
const UNC_SHARE_ROOT_PATTERN = /^\\\\[^\\]+\\[^\\]+$/;
const UNC_SHARE_ROOT_WITH_TRAILING_SEPARATOR_PATTERN = /^\\\\[^\\]+\\[^\\]+\\$/;

/**
 * Replace any Windows-style backslashes with forward slashes so downstream
 * consumers can rely on a stable, POSIX-style path. Empty and non-string
 * inputs are normalized to an empty string rather than throwing, which
 * mirrors how parser utilities treat optional path metadata.
 *
 * @param {unknown} inputPath Candidate file system path.
 * @returns {string} Normalized POSIX path string, or an empty string when the
 *                   input is missing/invalid.
 */
export function toPosixPath(inputPath) {
    if (!isNonEmptyString(inputPath)) {
        return "";
    }

    return inputPath.replaceAll(WINDOWS_SEPARATOR_PATTERN, "/");
}

/**
 * Convert a POSIX-style path into the current platform's native separator.
 * Non-string and empty inputs are normalized to an empty string so callers
 * can freely chain additional `path.join` invocations without defensive
 * nullish checks.
 *
 * @param {unknown} inputPath Candidate POSIX path string.
 * @returns {string} Path rewritten using the runtime's path separator.
 */
export function fromPosixPath(inputPath) {
    if (!isNonEmptyString(inputPath)) {
        return "";
    }

    if (path.sep === "/") {
        return inputPath;
    }

    return inputPath.replaceAll(POSIX_SEPARATOR_PATTERN, path.sep);
}

/**
 * Resolve the relative path from {@link parentPath} to {@link childPath} when
 * the child resides within the parent directory tree.
 *
 * Empty strings and non-string inputs short-circuit to `null` so callers can
 * guard against optional metadata without additional checks. The helper mirrors
 * the guard logic previously inlined across the CLI and project index to keep
 * containment checks consistent and allocation-free on the hot path.
 *
 * @param {string | null | undefined} childPath Candidate descendant path.
 * @param {string | null | undefined} parentPath Candidate ancestor directory.
 * @returns {string | null} Relative path when the child is contained within the
 *                          parent, otherwise `null`.
 */
export function resolveContainedRelativePath(childPath, parentPath) {
    if (!isNonEmptyString(childPath) || !isNonEmptyString(parentPath)) {
        return null;
    }

    const relative = path.relative(parentPath, childPath);

    if (relative === "") {
        return "";
    }

    if (PARENT_SEGMENT_PATTERN.test(relative) || path.isAbsolute(relative)) {
        return null;
    }

    return relative;
}

/**
 * Yield each ancestor directory for the provided start path, beginning with
 * the resolved start directory and walking toward the file system root.
 *
 * Guards against duplicate directories (for example when symbolic links point
 * back to an already-visited parent) to prevent infinite loops. Non-string and
 * empty inputs exit early so callers can forward optional metadata without
 * normalizing it first.
 *
 * @param {string | null | undefined} startPath Directory whose ancestors should
 *        be visited.
 * @param {{ includeSelf?: boolean }} [options]
 * @param {boolean} [options.includeSelf=true] When `false`, the first yielded
 *        directory will be the parent of `startPath` instead of the directory
 *        itself.
 * @returns {Generator<string, void, void>} Iterator over ancestor directories.
 */
export function* walkAncestorDirectories(startPath, { includeSelf = true } = {}) {
    if (!isNonEmptyString(startPath)) {
        return;
    }

    const visited = new Set();
    let current = path.resolve(startPath);

    if (!includeSelf) {
        current = path.dirname(current);
    }

    while (!visited.has(current)) {
        visited.add(current);
        yield current;

        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }

        current = parent;
    }
}

export function isPathInside(childPath, parentPath) {
    const relative = resolveContainedRelativePath(childPath, parentPath);
    return relative !== null;
}

/**
 * Detect whether a path represents a file system root (POSIX `/`, Windows drive
 * root like `C:\`, or UNC share root like `\\server\share`).
 *
 * @param {string} value Path to test.
 * @returns {boolean} True when the path is a canonical root.
 */
export function isRootPath(value: string): boolean {
    if (!isNonEmptyString(value)) {
        return false;
    }

    if (value === "/") {
        return true;
    }

    if (WINDOWS_DRIVE_ROOT_PATTERN.test(value)) {
        return true;
    }

    return UNC_SHARE_ROOT_PATTERN.test(value);
}

/**
 * Normalize Windows root paths to ensure they have the correct separator shape.
 * Drive roots must end with a backslash, UNC share roots must not have a
 * trailing separator.
 *
 * @param {string} value Path to normalize.
 * @returns {string} Normalized root path.
 */
function normalizeWindowsRootShape(value: string): string {
    if (WINDOWS_DRIVE_ROOT_WITH_OPTIONAL_SEPARATOR_PATTERN.test(value)) {
        return `${value.slice(0, 2)}\\`;
    }

    if (UNC_SHARE_ROOT_WITH_TRAILING_SEPARATOR_PATTERN.test(value)) {
        return value.slice(0, -1);
    }

    return value;
}

/**
 * Remove trailing path separators from a path while preserving root path
 * integrity. File system roots (POSIX `/`, Windows `C:\`, UNC `\\server\share`)
 * are normalized to their canonical form.
 *
 * @param {string} value Path to trim.
 * @returns {string} Path with trailing separators removed.
 */
export function trimTrailingSeparators(value: string): string {
    if (!isNonEmptyString(value)) {
        return "";
    }

    const normalizedRoot = normalizeWindowsRootShape(value);
    if (isRootPath(normalizedRoot)) {
        return normalizedRoot;
    }

    let current = value;
    while (current.endsWith("/") || current.endsWith("\\")) {
        current = current.slice(0, -1);
    }

    if (current.length === 0) {
        return value.includes("\\") ? "\\" : "/";
    }

    return normalizeWindowsRootShape(current);
}

// ---------------------------------------------------------------------------
// Path-boundary canonicalization (moved from lint workspace per TODO)
// ---------------------------------------------------------------------------

function isWindowsLikeBoundaryPath(value: string): boolean {
    return WINDOWS_DRIVE_LETTER_PATTERN.test(value) || UNC_PREFIX_PATTERN.test(value);
}

function normalizeBoundarySeparators(value: string): string {
    if (isWindowsLikeBoundaryPath(value)) {
        return value.replaceAll("/", "\\");
    }

    return value.replaceAll("\\", "/");
}

function canonicalizeBoundaryPathCase(value: string): string {
    if (isWindowsLikeBoundaryPath(value)) {
        return value.toLowerCase();
    }

    return value;
}

function canonicalizeFromString(value: string): string {
    const withNormalizedSeparators = normalizeBoundarySeparators(value);
    const trimmed = trimTrailingSeparators(withNormalizedSeparators);
    return canonicalizeBoundaryPathCase(trimmed);
}

/**
 * Canonicalize a path for use in project-boundary comparisons.
 *
 * Resolves symlinks via `realpathSync.native` when the path exists on disk and
 * falls back to a purely lexical normalization (separator normalization +
 * trailing-separator trim + Windows case-fold) when the path is missing. This
 * makes the function safe for both live file trees and synthetic test paths.
 *
 * @param {string} pathValue Raw path to canonicalize.
 * @returns {string} Canonicalized path suitable for prefix-containment checks.
 */
export function normalizeBoundaryPath(pathValue: string): string {
    try {
        return canonicalizeFromString(realpathSync.native(pathValue));
    } catch {
        return canonicalizeFromString(pathValue);
    }
}

function boundaryPathSeparatorFor(pathValue: string): string {
    return isWindowsLikeBoundaryPath(pathValue) ? "\\" : "/";
}

function splitPathSegments(pathValue: string): Array<string> {
    return pathValue
        .split(/[\\/]+/u)
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0);
}

/**
 * Return `true` when `filePath` is the same as or resides within `rootPath`.
 *
 * Both paths are canonicalized with {@link normalizeBoundaryPath} before the
 * comparison so the check is robust against symlinks, mixed separators,
 * trailing slashes, and Windows case differences.
 *
 * @param {string} filePath Candidate descendant path.
 * @param {string} rootPath Candidate ancestor directory.
 * @returns {boolean} Whether `filePath` is contained within `rootPath`.
 */
export function isPathWithinBoundary(filePath: string, rootPath: string): boolean {
    const normalizedRoot = normalizeBoundaryPath(rootPath);
    const normalizedFile = normalizeBoundaryPath(filePath);

    if (normalizedRoot.length === 0 || normalizedFile.length === 0) {
        return false;
    }

    if (normalizedRoot === normalizedFile) {
        return true;
    }

    const separator = boundaryPathSeparatorFor(normalizedRoot);
    const withBoundary = normalizedRoot.endsWith(separator) ? normalizedRoot : `${normalizedRoot}${separator}`;
    return normalizedFile.startsWith(withBoundary);
}

/**
 * Evaluate whether a candidate path is selected by allow/deny boundary lists.
 *
 * Selection rules:
 * - Deny boundaries always win.
 * - Empty allow list means all candidates are allowed.
 * - Otherwise a candidate must be within at least one allow boundary.
 * - Directory candidates may opt into inverse boundary checks so parent
 *   directories that contain an allow boundary are also considered selected.
 *
 * @param {string} candidatePath Path being evaluated.
 * @param {ReadonlyArray<string>} allowBoundaries Canonical allow boundaries.
 * @param {ReadonlyArray<string>} denyBoundaries Canonical deny boundaries.
 * @param {{ allowBoundaryWithinCandidate?: boolean }} [options]
 * @param {boolean} [options.allowBoundaryWithinCandidate=false] Whether to
 * permit matches when an allow boundary is contained by the candidate path.
 * @returns {boolean} `true` when the candidate survives deny checks and matches
 * the allow-list policy.
 */
export function isPathSelectedByBoundaries(
    candidatePath: string,
    allowBoundaries: ReadonlyArray<string>,
    denyBoundaries: ReadonlyArray<string>,
    { allowBoundaryWithinCandidate = false }: { allowBoundaryWithinCandidate?: boolean } = {}
): boolean {
    if (denyBoundaries.some((denyBoundary) => isPathWithinBoundary(candidatePath, denyBoundary))) {
        return false;
    }

    if (allowBoundaries.length === 0) {
        return true;
    }

    return allowBoundaries.some(
        (allowBoundary) =>
            isPathWithinBoundary(candidatePath, allowBoundary) ||
            (allowBoundaryWithinCandidate && isPathWithinBoundary(allowBoundary, candidatePath))
    );
}

/**
 * Determine whether a file path should be excluded based on directory segment
 * deny-lists with canonical allowed-directory overrides.
 *
 * The `filePath` and each entry in `allowedDirectories` are canonicalized via
 * {@link normalizeBoundaryPath} before boundary comparisons, so symlinks,
 * trailing separators, and Windows case differences do not create false
 * negatives. Segment matching remains lexical and case-insensitive by folding
 * each path segment to lowercase before consulting `excludedDirectories`.
 *
 * @param {string} filePath Candidate file path to inspect.
 * @param {ReadonlySet<string>} excludedDirectories Lower-cased directory names
 * to exclude when they appear in any segment of `filePath`.
 * @param {ReadonlyArray<string>} allowedDirectories Canonical boundary roots
 * that override `excludedDirectories` when `filePath` is contained within one.
 * @returns {boolean} `true` when `filePath` should be treated as excluded.
 */
export function isDirectoryExcludedBySegments(
    filePath: string,
    excludedDirectories: ReadonlySet<string>,
    allowedDirectories: ReadonlyArray<string>
): boolean {
    const normalizedFilePath = normalizeBoundaryPath(filePath);
    const isAllowedOverride = allowedDirectories.some((directory) =>
        isPathWithinBoundary(normalizedFilePath, directory)
    );
    if (isAllowedOverride) {
        return false;
    }

    const segments = splitPathSegments(normalizedFilePath);
    return segments.some((segment) => excludedDirectories.has(segment.toLowerCase()));
}
