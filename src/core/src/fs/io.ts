import { type Dirent, readFileSync as fsReadFileSync, writeFileSync as fsWriteFileSync } from "node:fs";
import * as fsPromises from "node:fs/promises";

import { createAbortGuard } from "../utils/abort.js";
import { toArrayFromIterable } from "../utils/array.js";
import { isErrorWithCode } from "../utils/error.js";

/**
 * Async filesystem facade interface for GMLoop packages.
 *
 * Provides a swappable async filesystem layer so packages can operate against
 * in-memory or test doubles without coupling to Node's `fs/promises` directly.
 * All members are optional to allow partial implementations in tests; callers
 * that need the full surface should pass `defaultFsFacade`.
 */
export interface FsFacade {
    readonly readFile?: (path: string, encoding: BufferEncoding) => Promise<string>;
    readonly writeFile?: (path: string, contents: string, encoding: BufferEncoding) => Promise<void>;
    readonly rename?: (fromPath: string, toPath: string) => Promise<void>;
    readonly unlink?: (path: string) => Promise<void>;
    readonly mkdir?: (path: string, options: { recursive: boolean }) => Promise<void>;
    readonly stat?: (path: string) => Promise<{ mtimeMs?: number } | null>;
    readonly readDir?: (path: string) => Promise<Iterable<string>>;
}

/**
 * Default async filesystem facade backed by Node's `fs/promises`.
 *
 * Used as the baseline when no custom facade is provided. Exposed publicly so
 * consumers can spread it as a base and override specific methods.
 */
export const defaultFsFacade: FsFacade = Object.freeze({
    readFile: fsPromises.readFile,
    writeFile: fsPromises.writeFile,
    rename: fsPromises.rename,
    unlink: fsPromises.unlink,
    mkdir: async (path: string, options: { recursive: boolean }) => {
        await fsPromises.mkdir(path, options);
    },
    stat: fsPromises.stat,
    readDir: fsPromises.readdir
});

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
    return fsPromises.readFile(filePath, "utf8");
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
 * Read directory entries safely, returning an empty array when the directory
 * does not exist or is inaccessible. Errors other than "not a directory" are
 * re-thrown so callers can distinguish benign ENOENT/ENOTDIR cases from
 * permission or I/O failures.
 *
 * Mirrors the semantics of {@link listDirectory} for cases where the filesystem
 * facade is exposed directly rather than abstracted behind the `FileSystem-
 * DirectoryReader` interface. Callers that already use a `FileSystemDirectory-
 * Reader` should prefer {@link listDirectory} for consistent abort-signal
 * handling.
 *
 * @param {{ readDir(path: string): Promise<Iterable<string>> }} fsFacade
 *        Filesystem facade whose `readDir` method mirrors
 *        `fs.promises.readdir`.
 * @param {string} directoryPath Absolute or relative directory to read.
 * @returns {Promise<Array<string>>} Stable array of directory entries,
 *          ordered according to the underlying iterator.
 */
export async function safeReaddir(fsFacade: FileSystemDirectoryReader, directoryPath: string): Promise<Array<string>> {
    try {
        return toArrayFromIterable(await fsFacade.readDir(directoryPath));
    } catch (error) {
        if (isErrorWithCode(error, "ENOENT", "ENOTDIR")) {
            return [];
        }
        throw error;
    }
}

/**
 * Minimal directory entry shape required by {@link safeReaddirDirent}. Omits
 * internal `parent` / buffer fields from Node's `Dirent` to keep the interface
 * lean and portable.
 */
type FileDirent = Pick<
    Dirent,
    "name" | "isBlockDevice" | "isCharacterDevice" | "isDirectory" | "isFIFO" | "isFile" | "isSocket" | "isSymbolicLink"
>;

export interface FileSystemDirentReader {
    readonly readDir: (path: string, options: { withFileTypes: true }) => Promise<FileDirent[]>;
}

/**
 * Read directory entries with `withFileTypes: true`, returning an empty array
 * when the directory does not exist or is inaccessible. Errors other than
 * "not a directory" are re-thrown so callers can distinguish benign
 * ENOENT/ENOTDIR cases from permission or I/O failures.
 *
 * Provides a canonical, reusable alternative to bare `.catch(() => [])`
 * handlers that:
 *   - Documents the intent in the function name rather than relying on
 *     inline callbacks.
 *   - Propagates unexpected errors (permission denied, I/O faults) rather
 *     than silently absorbing them.
 *   - Keeps error-handling logic centralized in the core fs module so it can
 *     be audited and updated in one place.
 *
 * @param {{ readDir(path: string): Promise<Iterable<string>> }} fsFacade
 *        Filesystem facade whose `readDir` method mirrors
 *        `fs.promises.readdir`.
 * @param {string} directoryPath Absolute or relative directory to read.
 * @returns {Promise<Array<FileDirent>>} Stable array of directory entries,
 *          ordered according to the underlying iterator.
 */
export async function safeReaddirDirent(
    fsFacade: FileSystemDirentReader,
    directoryPath: string
): Promise<FileDirent[]> {
    try {
        return await fsFacade.readDir(directoryPath, { withFileTypes: true });
    } catch (error) {
        if (isErrorWithCode(error, "ENOENT", "ENOTDIR")) {
            return [];
        }
        throw error;
    }
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
    return fsPromises.writeFile(filePath, content, "utf8");
}
