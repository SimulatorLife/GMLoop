import { readFileSync as fsReadFileSync, writeFileSync as fsWriteFileSync } from "node:fs";
import { readFile as fsReadFileAsync, writeFile as fsWriteFileAsync } from "node:fs/promises";

import { createAbortGuard } from "../utils/abort.js";
import { toArrayFromIterable } from "../utils/array.js";
import { isErrorWithCode } from "../utils/error.js";

export interface FileSystemDirectoryReader {
    readonly readDir: (path: string) => Promise<Iterable<string>>;
}

export interface FileSystemStats {
    readonly mtimeMs?: number;
}

export interface FileSystemStatReader {
    readonly stat: (path: string) => Promise<FileSystemStats | null>;
}

/**
 * Enumerate the entries in {@link directoryPath} while respecting the abort
 * semantics shared by long-running filesystem workflows. Missing directories
 * resolve to an empty array so callers can treat them as already-processed
 * without branching.
 *
 * @param {{ readDir(path: string): Promise<Iterable<string>> }} fsFacade
 *        Filesystem facade whose `readDir` method mirrors
 *        `fs.promises.readdir`.
 * @param {string} directoryPath Absolute or relative directory to read.
 * @param {{ signal?: AbortSignal | null }} [options] Optional abort signal
 *        bag. The same object is forwarded to {@link createAbortGuard} so any
 *        extra metadata (like custom fallback messages) is honored.
 * @returns {Promise<Array<string>>} Stable array of directory entries,
 *          ordered according to the underlying iterator.
 */
export async function listDirectory(
    fsFacade: FileSystemDirectoryReader,
    directoryPath: string,
    options: Parameters<typeof createAbortGuard>[0] = {}
) {
    const abortMessage = "Directory listing was aborted.";
    const guard = createAbortGuard(options, {
        fallbackMessage: abortMessage
    });

    try {
        const entries = await fsFacade.readDir(directoryPath);
        guard.ensureNotAborted();

        return toArrayFromIterable(entries);
    } catch (error) {
        if (isErrorWithCode(error, "ENOENT", "ENOTDIR")) {
            return [];
        }
        throw error;
    }
}

/**
 * Resolve the `mtimeMs` value for {@link filePath}, returning `null` when the
 * file cannot be stat'ed (for example when it was deleted mid-flight). The
 * guard mirrors {@link listDirectory} so long-running scans can honor abort
 * requests between async boundaries.
 *
 * @param {{ stat(path: string): Promise<{ mtimeMs?: number }> }} fsFacade
 *        Filesystem facade exposing a promise-based `stat` method.
 * @param {string} filePath Absolute or relative file path to inspect.
 * @param {{ signal?: AbortSignal | null }} [options] Optional abort signal
 *        bag forwarded to {@link createAbortGuard}.
 * @returns {Promise<number | null>} Millisecond precision modified time, or
 *          `null` when unavailable.
 */
export async function getFileMtime(
    fsFacade: FileSystemStatReader,
    filePath: string,
    options: Parameters<typeof createAbortGuard>[0] = {}
) {
    const abortMessage = "File metadata read was aborted.";
    const guard = createAbortGuard(options, {
        fallbackMessage: abortMessage
    });

    try {
        const stats = await fsFacade.stat(filePath);
        guard.ensureNotAborted();
        return typeof stats.mtimeMs === "number" ? stats.mtimeMs : null;
    } catch (error) {
        if (isErrorWithCode(error, "ENOENT")) {
            return null;
        }
        throw error;
    }
}

/**
 * Read the contents of a file synchronously with UTF-8 encoding.
 *
 * Eliminates the need for repeated `"utf8"` encoding parameters across the
 * codebase. Centralizes file reading so error handling, logging, and future
 * enhancements (such as caching or encoding detection) can be added in a
 * single location.
 *
 * @param {string} filePath Absolute or relative path to the file.
 * @returns {string} File contents as a UTF-8 string.
 * @throws {NodeJS.ErrnoException} When the file cannot be read.
 */
export function readTextFileSync(filePath: string): string {
    return fsReadFileSync(filePath, "utf8");
}

/**
 * Read the contents of a file asynchronously with UTF-8 encoding.
 *
 * Promise-based variant of {@link readTextFileSync} for use in async workflows.
 * Standardizes encoding to UTF-8 and provides a single point for future
 * enhancements like retry logic or streaming support.
 *
 * @param {string} filePath Absolute or relative path to the file.
 * @returns {Promise<string>} File contents as a UTF-8 string.
 * @throws {NodeJS.ErrnoException} When the file cannot be read.
 */
export function readTextFile(filePath: string): Promise<string> {
    return fsReadFileAsync(filePath, "utf8");
}

/**
 * Write text content to a file synchronously with UTF-8 encoding.
 *
 * Synchronous variant of {@link writeTextFile} for use in contexts where
 * blocking I/O is acceptable. Standardizes file writes across the codebase
 * by defaulting to UTF-8 encoding.
 *
 * @param {string} filePath Absolute or relative path to the target file.
 * @param {string} content Text content to write.
 * @throws {NodeJS.ErrnoException} When the file cannot be written.
 */
export function writeTextFileSync(filePath: string, content: string): void {
    fsWriteFileSync(filePath, content, "utf8");
}

/**
 * Write text content to a file asynchronously with UTF-8 encoding.
 *
 * Standardizes file writes across the codebase by defaulting to UTF-8 encoding
 * and providing a single integration point for future features like atomic
 * writes, backup creation, or permission management.
 *
 * @param {string} filePath Absolute or relative path to the target file.
 * @param {string} content Text content to write.
 * @returns {Promise<void>} Resolves when the write completes.
 * @throws {NodeJS.ErrnoException} When the file cannot be written.
 */
export function writeTextFile(filePath: string, content: string): Promise<void> {
    return fsWriteFileAsync(filePath, content, "utf8");
}
