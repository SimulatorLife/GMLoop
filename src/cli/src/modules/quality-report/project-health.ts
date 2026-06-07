import fs from "node:fs";
import path from "node:path";

import { Core } from "@gmloop/core";

import { formatByteSizeDisplay } from "../../shared/byte-format.js";
import { traverseDirectoryEntries } from "../../shared/directory-traversal.js";

const { readTextFileSync } = Core;

const IGNORED_SOURCE_DIRECTORIES = new Set(["node_modules", "dist", "generated", "vendor", "tmp"]);
const SOURCE_FILE_EXTENSION = ".ts";
const DECLARATION_FILE_SUFFIX = ".d.ts";
const BUILD_FILE_EXTENSION = ".js";
const SOURCE_DIRECTORY_NAME = "src";
const DISTRIBUTION_DIRECTORY_NAME = "dist";
const LARGE_FILE_LINE_THRESHOLD = 1000;
const TODO_PATTERN = /\b(?:TODO|FIXME|HACK)\b/g;

/**
 * Summary of coarse health signals collected across workspace source trees.
 */
export type ProjectHealthStats = {
    largeFiles: number;
    todos: number;
    buildSize: string;
};

function collectSourceFiles(sourceRootPath: string): string[] {
    const filePaths: Array<string> = [];
    traverseDirectoryEntries(sourceRootPath, {
        shouldDescend: (fullPath) => !IGNORED_SOURCE_DIRECTORIES.has(path.basename(fullPath)),
        onFile: (filePath) => {
            if (filePath.endsWith(SOURCE_FILE_EXTENSION) && !filePath.endsWith(DECLARATION_FILE_SUFFIX)) {
                filePaths.push(filePath);
            }
        },
        continueOnReadError: false,
        ignoreDotEntries: false
    });
    return filePaths;
}

function calculateBuildDirectorySize(distributionRootPath: string): number {
    if (!fs.existsSync(distributionRootPath)) {
        return 0;
    }

    let totalSize = 0;
    traverseDirectoryEntries(distributionRootPath, {
        onFile: (filePath) => {
            if (filePath.endsWith(BUILD_FILE_EXTENSION)) {
                totalSize += fs.statSync(filePath).size;
            }
        },
        shouldDescend: () => true,
        continueOnReadError: false,
        ignoreDotEntries: false
    });
    return totalSize;
}

function calculateWorkspaceBuildSize(sourceRootPath: string): number {
    if (!fs.existsSync(sourceRootPath)) {
        return 0;
    }

    let totalBuildSize = 0;
    const workspaceEntries = fs.readdirSync(sourceRootPath, { withFileTypes: true });
    for (const workspaceEntry of workspaceEntries) {
        if (!workspaceEntry.isDirectory()) {
            continue;
        }

        const distributionRootPath = path.join(sourceRootPath, workspaceEntry.name, DISTRIBUTION_DIRECTORY_NAME);
        totalBuildSize += calculateBuildDirectorySize(distributionRootPath);
    }

    return totalBuildSize;
}

/**
 * Scan source workspaces for coarse project-health signals used by CLI reports.
 */
export function scanProjectHealth(rootDir: string): ProjectHealthStats {
    const sourceRootPath = path.join(rootDir, SOURCE_DIRECTORY_NAME);
    const sourceFiles = collectSourceFiles(sourceRootPath);

    let largeFiles = 0;
    let todos = 0;

    for (const filePath of sourceFiles) {
        const content = readTextFileSync(filePath);
        const lineCount = content.split("\n").length;

        if (lineCount > LARGE_FILE_LINE_THRESHOLD) {
            largeFiles += 1;
        }

        todos += content.match(TODO_PATTERN)?.length ?? 0;
    }

    return {
        largeFiles,
        todos,
        buildSize: formatByteSizeDisplay(calculateWorkspaceBuildSize(sourceRootPath), {
            decimals: 2,
            separator: " ",
            invalidValue: "Invalid"
        })
    };
}
