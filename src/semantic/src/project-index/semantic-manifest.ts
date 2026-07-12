import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import path from "node:path";

import { Core } from "@gmloop/core";

import { isProjectManifestPath } from "./constants.js";
import { type ProjectIndexFsFacade } from "./fs-facade.js";
import { scanProjectTree } from "./project-tree.js";

/** Semantic snapshot tier. */
export type SemanticTier = "definitions" | "full";

/** SHA-256 digest that identifies one complete semantic source inventory. */
export type SemanticSourceRevision = string & { readonly __semanticSourceRevision: unique symbol };

/** Semantic manifest file classification. */
export type SemanticFileKind = "gml" | "projectManifest" | "resourceMetadata";

/** Origin of a manifest entry's contents. */
export type SemanticSourceOrigin = "disk" | "openBuffer";

/** Immutable source text that takes precedence over its physical file. */
export type SemanticOpenBufferOverlay = Readonly<{
    absolutePath: string;
    contentHash: string;
    documentVersion: number;
    sourceText: string;
}>;

/** Hash-addressed source metadata persisted with a semantic snapshot. */
export type SemanticFileManifestEntry = Readonly<{
    contentHash: string;
    fileKind: SemanticFileKind;
    mtimeMs: number | null;
    relativePath: string;
    sizeBytes: number;
    sourceOrigin: SemanticSourceOrigin;
    sourceVersion: number | null;
}>;

/** Complete deterministic source manifest for one project revision. */
export type SemanticFileManifest = Readonly<{
    entries: ReadonlyMap<string, SemanticFileManifestEntry>;
    sourceRevision: SemanticSourceRevision;
}>;

type ProjectTreeFile = Readonly<{
    absolutePath: string;
    mtimeMs: number | null;
    relativePath: string;
}>;

function createContentHash(sourceText: string): string {
    return createHash("sha256").update(sourceText).digest("hex");
}

function classifyManifestFile(relativePath: string): SemanticFileKind {
    if (isProjectManifestPath(relativePath)) {
        return "projectManifest";
    }
    return relativePath.toLowerCase().endsWith(".gml") ? "gml" : "resourceMetadata";
}

function createSourceRevision(entries: ReadonlyMap<string, SemanticFileManifestEntry>): SemanticSourceRevision {
    const digest = createHash("sha256");
    for (const entry of [...entries.values()].toSorted((left, right) =>
        left.relativePath.localeCompare(right.relativePath)
    )) {
        digest.update(entry.relativePath);
        digest.update("\u0000");
        digest.update(entry.fileKind);
        digest.update("\u0000");
        digest.update(entry.contentHash);
        digest.update("\n");
    }
    return digest.digest("hex") as SemanticSourceRevision;
}

function createOverlayMap(
    overlays: ReadonlyArray<SemanticOpenBufferOverlay>
): ReadonlyMap<string, SemanticOpenBufferOverlay> {
    return new Map(overlays.map((overlay) => [path.resolve(overlay.absolutePath), overlay]));
}

function readProjectTreeFiles(value: unknown): ReadonlyArray<ProjectTreeFile> {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.flatMap((candidate) => {
        if (!Core.isObjectLike(candidate)) {
            return [];
        }
        const absolutePath = candidate.absolutePath;
        const relativePath = candidate.relativePath;
        const mtimeMs = candidate.mtimeMs;
        if (typeof absolutePath !== "string" || typeof relativePath !== "string") {
            return [];
        }
        return [
            Object.freeze({
                absolutePath,
                mtimeMs: typeof mtimeMs === "number" ? mtimeMs : null,
                relativePath
            })
        ];
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Core.isObjectLike(value);
}

/**
 * Enumerate and hash every semantic input file without parsing GML.
 *
 * Open buffers replace disk contents for matching paths, making the returned
 * source revision authoritative for restored VS Code sessions.
 */
export async function buildSemanticFileManifest(
    projectRoot: string,
    fsFacade: ProjectIndexFsFacade,
    overlays: ReadonlyArray<SemanticOpenBufferOverlay> = []
): Promise<SemanticFileManifest> {
    const resolvedRoot = path.resolve(projectRoot);
    const overlayByAbsolutePath = createOverlayMap(overlays);
    const tree: unknown = await scanProjectTree(resolvedRoot, fsFacade);
    const treeRecord: Record<string, unknown> = isRecord(tree) ? tree : {};
    const entries = new Map<string, SemanticFileManifestEntry>();
    const files = [...readProjectTreeFiles(treeRecord.gmlFiles), ...readProjectTreeFiles(treeRecord.yyFiles)].toSorted(
        (left, right) => left.relativePath.localeCompare(right.relativePath)
    );

    const manifestEntries = await Core.runInParallelWithLimit(
        files,
        async (file) => {
            const absolutePath = path.resolve(file.absolutePath);
            const overlay = overlayByAbsolutePath.get(absolutePath);
            const sourceText = overlay ? overlay.sourceText : await fsFacade.readFile(absolutePath, "utf8");
            const relativePath = Core.toPosixPath(file.relativePath);
            return Object.freeze({
                contentHash: overlay?.contentHash ?? createContentHash(sourceText),
                fileKind: classifyManifestFile(relativePath),
                mtimeMs: file.mtimeMs,
                relativePath,
                sizeBytes: Buffer.byteLength(sourceText, "utf8"),
                sourceOrigin: overlay ? "openBuffer" : "disk",
                sourceVersion: overlay?.documentVersion ?? null
            });
        },
        16
    );
    for (const entry of manifestEntries) {
        entries.set(entry.relativePath, entry);
    }

    return Object.freeze({ entries, sourceRevision: createSourceRevision(entries) });
}

/** Create a SHA-256 content hash for an open-buffer overlay. */
export function createSemanticContentHash(sourceText: string): string {
    return createContentHash(sourceText);
}
