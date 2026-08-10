import path from "node:path";
import process from "node:process";

const BACKSLASH_PATTERN = /\\/gu;
const REPO_MARKER = "/GMLoop/";
const LEADING_RELATIVE_SEGMENT = /^\.\//u;

/**
 * Path normalization helpers shared by the auto-merge evidence and gate
 * commands.
 *
 * Both `ci-automerge-evidence.ts` and `ci-automerge-gate.ts` previously kept
 * local copies of {@link normalizePath} and {@link normalizeRepositoryPath}
 * to translate between Windows-style absolute paths produced by external
 * tooling and the POSIX-style relative paths the gate evidence compares
 * against. The two implementations were byte-for-byte identical for the
 * repository-root stripping step but used slightly different separator
 * strategies (`split(path.sep).join("/")` vs `replaceAll("\\", "/")`) which
 * drift as the toolchain is exercised on additional platforms. Collapsing
 * the helpers into this module keeps the canonical POSIX conversion in one
 * place and stops the `"/GMLoop/"` marker literal from being duplicated
 * across the command files.
 */

/**
 * Convert any platform-specific path separator to POSIX forward slashes.
 *
 * The evidence and gate commands both consume file paths from sources that
 * may emit Windows-style backslashes (CI runners, JUnit XML attributes,
 * Node test reporter file URLs) while the canonical path keys used for
 * comparison and fingerprinting are forward-slash relative paths. Splitting
 * on `path.sep` keeps the conversion correct on POSIX hosts (no-op) and on
 * Windows (rewrites `\` to `/`), and the follow-up `replaceAll("\\", "/")`
 * handles Windows paths that appear in inputs running under a POSIX host
 * (for example a JUnit XML recorded on Windows but consumed by a Linux
 * CI runner). Together the two passes produce a stable POSIX-style path on
 * every host.
 *
 * @param value Raw path candidate.
 * @returns The same path rewritten with POSIX separators.
 */
export function normalizePath(value: string): string {
    return value.split(path.sep).join("/").replaceAll(BACKSLASH_PATTERN, "/");
}

/**
 * Strip the repository-root prefix and any leading `./` so the input is
 * anchored at the GMLoop workspace root.
 *
 * The evidence and gate commands both compare file paths recorded by
 * upstream tools against the canonical workspace-relative paths used in the
 * evidence corpus. Absolute paths emitted by JUnit XML or the Node test
 * runner usually include the runner's working directory; this helper trims
 * that prefix when it matches the current `process.cwd()`. As a safety net
 * for CI runners whose `cwd` lies outside the workspace (e.g. a checkout
 * under `/home/runner/work/GMLoop/GMLoop`), the helper also looks for the
 * last `/GMLoop/` segment and uses the suffix after it. Inputs that are
 * already relative get the leading `./` removed so they join cleanly with
 * the canonical corpus.
 *
 * @param value Path candidate to normalize.
 * @returns Path anchored at the workspace root using POSIX separators.
 */
export function normalizeRepositoryPath(value: string): string {
    const normalized = normalizePath(value);
    const root = normalizePath(process.cwd()).replace(/\/$/u, "");
    if (normalized.startsWith(`${root}/`)) {
        return normalized.slice(root.length + 1);
    }
    const markerIndex = normalized.lastIndexOf(REPO_MARKER);
    return markerIndex === -1
        ? normalized.replace(LEADING_RELATIVE_SEGMENT, "")
        : normalized.slice(markerIndex + REPO_MARKER.length);
}
