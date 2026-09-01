import fs from "node:fs";
import path from "node:path";

import { Core } from "@gmloop/core";

import { formatByteSizeDisplay } from "../../shared/byte-format.js";
import { traverseDirectoryEntries } from "../../shared/directory-traversal.js";
import { pathExistsSync } from "../../shared/path-exists.js";
import {
    countTodoMarkers,
    isBuildOutputFile,
    isLargeSourceFile,
    isScannableSourceFile,
    shouldDescendIntoSourceDirectory
} from "./project-health-policy.js";

const { readTextFileSync } = Core;

const SOURCE_DIRECTORY_NAME = "src";
const DISTRIBUTION_DIRECTORY_NAME = "dist";

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
        shouldDescend: (fullPath) => shouldDescendIntoSourceDirectory(path.basename(fullPath)),
        onFile: (filePath) => {
            if (isScannableSourceFile(filePath)) {
                filePaths.push(filePath);
            }
        },
        continueOnReadError: false,
        ignoreDotEntries: false
    });
    return filePaths;
}

function calculateBuildDirectorySize(distributionRootPath: string): number {
    if (!pathExistsSync(distributionRootPath)) {
        return 0;
    }

    let totalSize = 0;
    traverseDirectoryEntries(distributionRootPath, {
        onFile: (filePath) => {
            if (isBuildOutputFile(filePath)) {
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
    if (!pathExistsSync(sourceRootPath)) {
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

        if (isLargeSourceFile(lineCount)) {
            largeFiles += 1;
        }

        todos += countTodoMarkers(content);
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
