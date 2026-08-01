import { realpathSync } from "node:fs";
import path from "node:path";

import { Core } from "@gmloop/core";

function isVirtualLintPath(filename: string): boolean {
    return filename.startsWith("<") && filename.endsWith(">") && filename.length > 1;
}

/**
 * Normalize an ESLint/GML language filename into the canonical path form used
 * by parser services.
 *
 * This helper lives alongside the language adapter because it participates in
 * file-level language parsing rather than the stable `Lint.services` surface.
 * Virtual ESLint filenames such as `<text>` are preserved, while real files are
 * resolved, canonicalized with `realpathSync.native` when available, and then
 * trimmed to remove redundant trailing separators.
 *
 * @param {string} filename Filename reported by ESLint or a caller-provided
 *        virtual source label.
 * @returns {string} Canonical filename suitable for parser-service metadata.
 */
export function normalizeLintFilePath(filename: string): string {
    if (isVirtualLintPath(filename)) {
        return filename;
    }

    const resolved = path.resolve(filename);

    let canonical = resolved;
    try {
        canonical = realpathSync.native(resolved);
    } catch {
        // Preserve the original absolute path when realpath fails (e.g. missing file).
    }

    return Core.trimTrailingSeparators(canonical);
}
