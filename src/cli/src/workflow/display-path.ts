import path from "node:path";
import process from "node:process";

/**
 * Convert an absolute or relative path into a stable, user-facing display path.
 *
 * Paths under the provided current working directory are shown relative to
 * keep CLI output concise. Paths outside that directory remain absolute so
 * users can still identify their location unambiguously.
 */
export function formatPathForDisplay(targetPath: string, options: { cwd?: string } = {}): string {
    const resolvedTargetPath = path.resolve(targetPath);
    const resolvedCwd = path.resolve(options.cwd ?? process.cwd());
    const relativePath = path.relative(resolvedCwd, resolvedTargetPath);

    if (resolvedTargetPath === resolvedCwd) {
        return ".";
    }

    if (relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
        return relativePath;
    }

    return resolvedTargetPath;
}
