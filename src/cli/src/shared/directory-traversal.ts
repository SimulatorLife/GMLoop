import fs from "node:fs";
import path from "node:path";

import { pathExistsSync } from "./path-exists.js";

/**
 * Options used to control recursive directory traversal.
 */
export type DirectoryTraversalOptions = {
    onFile: (filePath: string, entry: fs.Dirent) => void;
    shouldDescend: (fullPath: string, entry: fs.Dirent) => boolean;
    continueOnReadError: boolean;
    ignoreDotEntries: boolean;
};

function shouldSkipEntryByName(entryName: string, ignoreDotEntries: boolean): boolean {
    return ignoreDotEntries && (entryName === "." || entryName === "..");
}

function readDirectoryEntries(currentPath: string, continueOnReadError: boolean): fs.Dirent[] {
    try {
        return fs.readdirSync(currentPath, { withFileTypes: true });
    } catch (error) {
        if (continueOnReadError) {
            return [];
        }
        throw error;
    }
}

/**
 * Traverse a directory tree depth-first and invoke a callback for each file entry.
 */
export function traverseDirectoryEntries(
    rootPath: string,
    { onFile, shouldDescend, continueOnReadError, ignoreDotEntries }: DirectoryTraversalOptions
): void {
    if (!pathExistsSync(rootPath)) {
        return;
    }

    const stack: string[] = [rootPath];
    while (stack.length > 0) {
        const currentPath = stack.pop();
        if (!currentPath) {
            continue;
        }

        const entries = readDirectoryEntries(currentPath, continueOnReadError);
        for (const entry of entries) {
            if (shouldSkipEntryByName(entry.name, ignoreDotEntries)) {
                continue;
            }

            const fullPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
                if (shouldDescend(fullPath, entry)) {
                    stack.push(fullPath);
                }
                continue;
            }

            onFile(fullPath, entry);
        }
    }
}
