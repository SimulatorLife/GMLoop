import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { GraphVisualizationBundleArtifact, GraphVisualizationExportResult } from "./types.js";

/**
 * Write a graph visualization bundle to disk under `outputDirectory`.
 *
 * Every file is verified to resolve inside `outputDirectory` so the writer
 * cannot escape the chosen output even if the upstream bundle produced an
 * entry with absolute or parent-relative paths.
 */
async function writeGraphVisualizationBundleArtifact(
    bundleArtifact: GraphVisualizationBundleArtifact,
    outputDirectory: string
): Promise<GraphVisualizationExportResult> {
    await mkdir(outputDirectory, { recursive: true });

    await Promise.all(
        bundleArtifact.files.map(async (bundleFile) => {
            const absoluteBundlePath = path.resolve(outputDirectory, bundleFile.relativePath);
            const absoluteOutputRoot = path.resolve(outputDirectory) + path.sep;
            if (
                !absoluteBundlePath.startsWith(absoluteOutputRoot) &&
                absoluteBundlePath !== path.resolve(outputDirectory)
            ) {
                throw new Error(
                    `Refusing to write graph visualization bundle file outside the output directory: ${bundleFile.relativePath}`
                );
            }
            await mkdir(path.dirname(absoluteBundlePath), { recursive: true });
            await writeFile(absoluteBundlePath, bundleFile.bytes);
        })
    );

    return Object.freeze({
        entryHtmlPath: bundleArtifact.entryHtmlPath,
        outputDirectory
    });
}

export { writeGraphVisualizationBundleArtifact };
