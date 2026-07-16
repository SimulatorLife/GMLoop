import path from "node:path";

import { createSemanticContentHash, type SemanticOpenBufferOverlay } from "../semantic-manifest.js";
import type { SemanticProjectOverlayChangeBatch } from "./types.js";

type SemanticOverlayStateUpdate = Readonly<{
    changedAbsolutePaths: ReadonlySet<string>;
    overlays: ReadonlyMap<string, SemanticOpenBufferOverlay>;
    versionHistory: ReadonlyMap<string, number>;
}>;

/** Resolve and validate one session input path against its normalized project root. */
export function resolveSemanticProjectInputPath(projectRoot: string, filePath: string): string {
    const absolutePath = path.resolve(projectRoot, filePath);
    const relativePath = path.relative(projectRoot, absolutePath);
    if (relativePath.length === 0 || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error(`Semantic project input must be a file inside ${projectRoot}: ${filePath}`);
    }
    return absolutePath;
}

/** Validate an entire overlay batch before returning its immutable next session state. */
export function applySemanticOverlayChangeBatch(
    projectRoot: string,
    currentOverlays: ReadonlyMap<string, SemanticOpenBufferOverlay>,
    currentVersionHistory: ReadonlyMap<string, number>,
    batch: SemanticProjectOverlayChangeBatch
): SemanticOverlayStateUpdate {
    const versionHistory = new Map(currentVersionHistory);
    const overlays = new Map(currentOverlays);
    const changedAbsolutePaths = new Set<string>();
    for (const change of batch.changes) {
        const absolutePath = resolveSemanticProjectInputPath(projectRoot, change.filePath);
        if (!absolutePath.toLowerCase().endsWith(".gml")) {
            throw new Error(`Semantic editor overlays must target .gml files: ${change.filePath}`);
        }
        if (!Number.isInteger(change.documentVersion) || change.documentVersion < 0) {
            throw new Error(`Semantic overlay document versions must be non-negative integers: ${change.filePath}`);
        }
        const previousVersion = versionHistory.get(absolutePath);
        if (previousVersion !== undefined && change.documentVersion <= previousVersion) {
            throw new Error(
                `Semantic overlay version ${change.documentVersion} is stale for ${absolutePath}; expected greater than ${previousVersion}.`
            );
        }
        versionHistory.set(absolutePath, change.documentVersion);
        const previousOverlay = overlays.get(absolutePath);
        if (change.kind === "remove") {
            if (previousOverlay !== undefined) {
                overlays.delete(absolutePath);
                changedAbsolutePaths.add(absolutePath);
            }
            continue;
        }
        const overlay = Object.freeze({
            absolutePath,
            contentHash: createSemanticContentHash(change.sourceText),
            documentVersion: change.documentVersion,
            sourceText: change.sourceText
        });
        overlays.set(absolutePath, overlay);
        if (
            previousOverlay === undefined ||
            previousOverlay.documentVersion !== overlay.documentVersion ||
            previousOverlay.contentHash !== overlay.contentHash
        ) {
            changedAbsolutePaths.add(absolutePath);
        }
    }
    return Object.freeze({ changedAbsolutePaths, overlays, versionHistory });
}
