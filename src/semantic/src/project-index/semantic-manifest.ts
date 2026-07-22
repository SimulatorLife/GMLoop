import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import path from "node:path";

import { Core } from "@gmloop/core";

import { isProjectManifestPath } from "./constants.js";
import { type ProjectIndexFsFacade } from "./fs-facade.js";
import { scanProjectTree } from "./project-tree.js";
import type { SemanticSourceRevision } from "./semantic-snapshot.js";

export type { SemanticSourceRevision, SemanticTier } from "./semantic-snapshot.js";

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

/** How many manifest entries a `buildSemanticFileManifest` call reused vs. read fresh. Ephemeral scan statistics, not part of the manifest's persisted content identity. */
export type SemanticFileManifestCacheStats = Readonly<{
    /** Files reused from `previousManifest` via an mtime match, without reading or re-hashing their contents. */
    cacheHitCount: number;
    /** Files whose contents were read and hashed fresh (new, changed, or no previous manifest was available). */
    cacheMissCount: number;
}>;

/** Kind of physical or overlay-backed source change. */
export type SemanticFileChangeKind = "added" | "deleted" | "metadataChanged" | "modified";

/** One manifest-level semantic source change. */
export type SemanticFileChange = Readonly<{
    current: SemanticFileManifestEntry | null;
    kind: SemanticFileChangeKind;
    previous: SemanticFileManifestEntry | null;
    relativePath: string;
}>;

/** Result of comparing an active semantic manifest with current project inputs. */
export type SemanticManifestReconciliation = Readonly<{
    changedFiles: ReadonlyArray<SemanticFileChange>;
    currentRevision: SemanticSourceRevision;
    previousRevision: SemanticSourceRevision | null;
    requiresBuild: boolean;
    unchangedCount: number;
}>;

type ProjectTreeFile = Readonly<{
    absolutePath: string;
    mtimeMs: number | null;
    relativePath: string;
}>;

const SEMANTIC_MANIFEST_IO_CONCURRENCY = 64;

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

function isSupportedSemanticManifestPath(relativePath: string): boolean {
    const normalized = relativePath.toLowerCase();
    return normalized.endsWith(".gml") || normalized.endsWith(".yy") || normalized.endsWith(".yyp");
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
    overlays: ReadonlyArray<SemanticOpenBufferOverlay> = [],
    previousManifest?: SemanticFileManifest | null,
    onCacheStats?: (stats: SemanticFileManifestCacheStats) => void
): Promise<SemanticFileManifest> {
    const resolvedRoot = path.resolve(projectRoot);
    const overlayByAbsolutePath = createOverlayMap(overlays);
    const tree: unknown = await scanProjectTree(resolvedRoot, fsFacade);
    const treeRecord: Record<string, unknown> = isRecord(tree) ? tree : {};
    const entries = new Map<string, SemanticFileManifestEntry>();
    const files = [...readProjectTreeFiles(treeRecord.gmlFiles), ...readProjectTreeFiles(treeRecord.yyFiles)].toSorted(
        (left, right) => left.relativePath.localeCompare(right.relativePath)
    );

    const manifestResults = await Core.runInParallelWithLimit(
        files,
        async (file) => {
            const absolutePath = path.resolve(file.absolutePath);
            const overlay = overlayByAbsolutePath.get(absolutePath);
            const relativePath = Core.toPosixPath(file.relativePath);

            const previousEntry = previousManifest?.entries.get(relativePath);
            if (
                !overlay &&
                previousEntry &&
                previousEntry.sourceOrigin === "disk" &&
                file.mtimeMs !== null &&
                previousEntry.mtimeMs !== null &&
                file.mtimeMs === previousEntry.mtimeMs
            ) {
                return { entry: previousEntry, wasCacheHit: true };
            }

            const sourceText = overlay ? overlay.sourceText : await fsFacade.readFile(absolutePath, "utf8");
            let isOverlayUnsaved = false;
            if (overlay) {
                try {
                    const diskText = await Core.defaultFsFacade.readFile(absolutePath, "utf8");
                    isOverlayUnsaved = diskText !== overlay.sourceText;
                } catch {
                    isOverlayUnsaved = true;
                }
            }
            return {
                entry: Object.freeze({
                    contentHash: overlay?.contentHash ?? createContentHash(sourceText),
                    fileKind: classifyManifestFile(relativePath),
                    mtimeMs: file.mtimeMs,
                    relativePath,
                    sizeBytes: Buffer.byteLength(sourceText, "utf8"),
                    sourceOrigin: isOverlayUnsaved ? "openBuffer" : "disk",
                    sourceVersion: isOverlayUnsaved ? (overlay?.documentVersion ?? null) : null
                }),
                wasCacheHit: false
            };
        },
        SEMANTIC_MANIFEST_IO_CONCURRENCY
    );
    let cacheHitCount = 0;
    let cacheMissCount = 0;
    for (const result of manifestResults) {
        entries.set(result.entry.relativePath, result.entry);
        if (result.wasCacheHit) {
            cacheHitCount += 1;
        } else {
            cacheMissCount += 1;
        }
    }
    onCacheStats?.({ cacheHitCount, cacheMissCount });

    return Object.freeze({ entries, sourceRevision: createSourceRevision(entries) });
}

/** Create a SHA-256 content hash for an open-buffer overlay. */
export function createSemanticContentHash(sourceText: string): string {
    return createContentHash(sourceText);
}

/**
 * Determine whether the manifest carries at least one entry whose source
 * content comes from an open in-memory buffer rather than disk.
 *
 * Session-local overlays require the session snapshot publication path and
 * cannot be served from the persisted tier, so callers use this helper as a
 * boolean gate instead of reaching into the manifest's internal entry map.
 */
export function hasOpenBufferOverlay(manifest: SemanticFileManifest | null): boolean {
    if (manifest === null) {
        return false;
    }
    for (const entry of manifest.entries.values()) {
        if (entry.sourceOrigin === "openBuffer") {
            return true;
        }
    }
    return false;
}

/**
 * Collect the relative path → source version mapping for every manifest entry
 * sourced from an open in-memory buffer.
 *
 * Entries without a recorded document version are skipped; callers that need
 * the stricter "all overlays must be versioned" invariant should keep using
 * their own validation. A `null` manifest yields an empty map so callers can
 * pass either shape through the same call site.
 */
export function collectOpenBufferOverlayVersions(manifest: SemanticFileManifest | null): ReadonlyMap<string, number> {
    const overlayVersions = new Map<string, number>();
    if (manifest === null) {
        return overlayVersions;
    }
    for (const entry of manifest.entries.values()) {
        if (entry.sourceOrigin !== "openBuffer") {
            continue;
        }
        if (entry.sourceVersion === null) {
            continue;
        }
        overlayVersions.set(entry.relativePath, entry.sourceVersion);
    }
    return overlayVersions;
}

/**
 * Apply known filesystem or open-buffer changes to a persisted manifest
 * without rediscovering every project file. Full inventory reconciliation is
 * intentionally kept separate for restart and metadata-inventory paths.
 */
export async function updateSemanticFileManifest(
    projectRoot: string,
    previousManifest: SemanticFileManifest,
    fsFacade: ProjectIndexFsFacade,
    overlays: ReadonlyArray<SemanticOpenBufferOverlay>,
    changedAbsolutePaths: ReadonlyArray<string>
): Promise<SemanticFileManifest> {
    const resolvedRoot = path.resolve(projectRoot);
    const overlayByAbsolutePath = createOverlayMap(overlays);
    const entries = new Map(previousManifest.entries);
    const changedPaths = new Set(changedAbsolutePaths.map((filePath) => path.resolve(filePath)));
    const changes = await Core.runInParallelWithLimit(
        changedPaths,
        async (changedPath) => {
            const relativePath = Core.toPosixPath(path.relative(resolvedRoot, changedPath));
            if (
                relativePath.startsWith("../") ||
                path.isAbsolute(relativePath) ||
                !isSupportedSemanticManifestPath(relativePath)
            ) {
                return null;
            }
            const overlay = overlayByAbsolutePath.get(changedPath);
            const stats = await fsFacade.stat(changedPath).catch(() => null);
            if (overlay === undefined && (stats === null || (typeof stats.isFile === "function" && !stats.isFile()))) {
                return Object.freeze({ entry: null, relativePath });
            }
            const sourceText = overlay?.sourceText ?? (await fsFacade.readFile(changedPath, "utf8"));
            let isOverlayUnsaved = false;
            if (overlay !== undefined) {
                try {
                    const diskText = await Core.defaultFsFacade.readFile(changedPath, "utf8");
                    isOverlayUnsaved = diskText !== overlay.sourceText;
                } catch {
                    isOverlayUnsaved = true;
                }
            }
            return Object.freeze({
                relativePath,
                entry: Object.freeze({
                    contentHash: overlay?.contentHash ?? createContentHash(sourceText),
                    fileKind: classifyManifestFile(relativePath),
                    mtimeMs: typeof stats?.mtimeMs === "number" ? stats.mtimeMs : null,
                    relativePath,
                    sizeBytes: Buffer.byteLength(sourceText, "utf8"),
                    sourceOrigin: isOverlayUnsaved ? "openBuffer" : "disk",
                    sourceVersion: isOverlayUnsaved ? (overlay?.documentVersion ?? null) : null
                })
            });
        },
        SEMANTIC_MANIFEST_IO_CONCURRENCY
    );
    for (const change of changes) {
        if (change === null) {
            continue;
        }
        if (change.entry === null) {
            entries.delete(change.relativePath);
        } else {
            entries.set(change.relativePath, change.entry);
        }
    }
    return Object.freeze({ entries, sourceRevision: createSourceRevision(entries) });
}

/** Compare persisted semantic inputs with a newly scanned canonical manifest. */
export function reconcileSemanticManifests(
    previous: SemanticFileManifest | null,
    current: SemanticFileManifest
): SemanticManifestReconciliation {
    if (previous?.sourceRevision === current.sourceRevision) {
        return Object.freeze({
            changedFiles: [],
            currentRevision: current.sourceRevision,
            previousRevision: previous.sourceRevision,
            requiresBuild: false,
            unchangedCount: current.entries.size
        });
    }

    const paths = new Set([...(previous?.entries.keys() ?? []), ...current.entries.keys()]);
    const changedFiles: SemanticFileChange[] = [];
    let unchangedCount = 0;
    for (const relativePath of [...paths].toSorted((left, right) => left.localeCompare(right))) {
        const previousEntry = previous?.entries.get(relativePath) ?? null;
        const currentEntry = current.entries.get(relativePath) ?? null;
        if (
            previousEntry?.contentHash === currentEntry?.contentHash &&
            previousEntry.fileKind === currentEntry.fileKind
        ) {
            unchangedCount += 1;
            continue;
        }
        const kind: SemanticFileChangeKind =
            previousEntry === null
                ? "added"
                : currentEntry === null
                  ? "deleted"
                  : previousEntry.fileKind !== currentEntry.fileKind || previousEntry.fileKind !== "gml"
                    ? "metadataChanged"
                    : "modified";
        changedFiles.push(Object.freeze({ current: currentEntry, kind, previous: previousEntry, relativePath }));
    }
    return Object.freeze({
        changedFiles,
        currentRevision: current.sourceRevision,
        previousRevision: previous?.sourceRevision ?? null,
        requiresBuild: changedFiles.length > 0,
        unchangedCount
    });
}
