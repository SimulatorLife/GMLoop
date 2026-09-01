import path from "node:path";

import { Core } from "@gmloop/core";

import type { ProjectIndexBuildOptions, ProjectIndexFileChange } from "../build-options.js";
import type { ProjectIndexFsFacade } from "../fs-facade.js";
import {
    buildSemanticFileManifest,
    reconcileSemanticManifests,
    type SemanticFileManifest,
    type SemanticOpenBufferOverlay,
    updateSemanticFileManifest
} from "../semantic-manifest.js";
import { normalizeSemanticFilePath } from "../semantic-path.js";
import { compareSemanticQueryText } from "../semantic-query-order.js";
import type {
    SemanticSnapshotAcquireResult,
    SemanticSnapshotRequirements,
    SemanticTier
} from "../semantic-snapshot.js";
import { createSemanticSnapshotFromProjectIndex } from "../semantic-snapshot-codec.js";
import { openSemanticIndexStore, type SemanticIndexStore } from "../semantic-store.js";
import {
    SEMANTIC_PROJECT_WAIT_CANCELLED,
    waitForSemanticProjectWork,
    wrapSemanticProjectLease
} from "./lease-lifecycle.js";
import { createSemanticOverlayFilesystem } from "./overlay-filesystem.js";
import { applySemanticOverlayChangeBatch, resolveSemanticProjectInputPath } from "./overlay-state.js";
import type {
    SemanticProjectDiskChangeBatch,
    SemanticProjectOverlayChangeBatch,
    SemanticProjectSession
} from "./types.js";

type SemanticRawProjectIndex = Readonly<Record<string, unknown>>;

export type SemanticProjectIndexBuilder = (
    projectRoot: string,
    fsFacade?: ProjectIndexFsFacade,
    options?: ProjectIndexBuildOptions
) => Promise<SemanticRawProjectIndex>;

type SemanticProjectSessionConstruction = Readonly<{
    buildIndex: SemanticProjectIndexBuilder;
    fsFacade: ProjectIndexFsFacade;
    onClose: () => void;
    projectRoot: string;
}>;

type TemporaryRawBuilderBaseline = Readonly<{
    manifest: SemanticFileManifest;
    projectIndex: Awaited<ReturnType<SemanticProjectIndexBuilder>>;
}>;

type ActiveSemanticBuild = Readonly<{
    controller: AbortController;
    inputRevision: number;
    promise: Promise<void>;
    tier: SemanticTier;
}>;

type ManifestPreparation = Readonly<{
    inputRevision: number;
    promise: Promise<SemanticFileManifest>;
}>;

type OverlayPublication = Readonly<{
    overlaySignature: string;
    sourceRevision: string;
}>;

const EMPTY_PROJECT_INDEX_CHANGES: ReadonlyArray<ProjectIndexFileChange> = Object.freeze(
    new Array<ProjectIndexFileChange>()
);

function createAcquireFailure(kind: "cancelled" | "overlayMismatch"): SemanticSnapshotAcquireResult {
    return Object.freeze({ failure: Object.freeze({ kind }), kind: "failure" });
}

function normalizeRequiredFilePaths(projectRoot: string, requiredFiles: ReadonlySet<string>): ReadonlyArray<string> {
    return Object.freeze(
        [...requiredFiles]
            .map((filePath) => resolveSemanticProjectInputPath(projectRoot, filePath))
            .filter((filePath) => filePath.toLowerCase().endsWith(".gml"))
            .toSorted(compareSemanticQueryText)
    );
}

function normalizeOverlayRequirements(
    projectRoot: string,
    overlayVersions: ReadonlyMap<string, number>
): ReadonlyMap<string, number> | null {
    const normalized = new Map<string, number>();
    for (const [filePath, documentVersion] of overlayVersions) {
        const normalizedPath = normalizeSemanticFilePath(projectRoot, filePath);
        if (normalized.has(normalizedPath)) {
            return null;
        }
        normalized.set(normalizedPath, documentVersion);
    }
    return normalized;
}

function createActiveOverlayVersions(
    projectRoot: string,
    overlays: ReadonlyMap<string, SemanticOpenBufferOverlay>
): ReadonlyMap<string, number> {
    return new Map(
        [...overlays.values()].map((overlay) => [
            normalizeSemanticFilePath(projectRoot, overlay.absolutePath),
            overlay.documentVersion
        ])
    );
}

function overlayRequirementsMatch(
    projectRoot: string,
    overlays: ReadonlyMap<string, SemanticOpenBufferOverlay>,
    requirements: ReadonlyMap<string, number>
): boolean {
    const normalizedRequirements = normalizeOverlayRequirements(projectRoot, requirements);
    if (normalizedRequirements === null) {
        return false;
    }
    const activeVersions = createActiveOverlayVersions(projectRoot, overlays);
    return (
        normalizedRequirements.size === activeVersions.size &&
        [...normalizedRequirements].every(
            ([filePath, documentVersion]) => activeVersions.get(filePath) === documentVersion
        )
    );
}

function createOverlaySignature(projectRoot: string, overlays: ReadonlyMap<string, SemanticOpenBufferOverlay>): string {
    return [...createActiveOverlayVersions(projectRoot, overlays)]
        .toSorted(([left], [right]) => compareSemanticQueryText(left, right))
        .map(([filePath, documentVersion]) => `${filePath}\u0000${documentVersion}`)
        .join("\n");
}

function forceManifestOverlayVersions(
    projectRoot: string,
    manifest: SemanticFileManifest,
    overlays: ReadonlyArray<SemanticOpenBufferOverlay>
): SemanticFileManifest {
    if (overlays.length === 0) {
        return manifest;
    }
    const entries = new Map(manifest.entries);
    for (const overlay of overlays) {
        const relativePath = normalizeSemanticFilePath(projectRoot, overlay.absolutePath);
        const entry = entries.get(relativePath);
        if (entry === undefined) {
            throw new Error(`Semantic overlay was not discovered in the project manifest: ${relativePath}`);
        }
        entries.set(
            relativePath,
            Object.freeze({
                ...entry,
                sourceOrigin: "openBuffer",
                sourceVersion: overlay.documentVersion
            })
        );
    }
    return Object.freeze({ entries, sourceRevision: manifest.sourceRevision });
}

function createIncrementalChanges(
    projectRoot: string,
    previousManifest: SemanticFileManifest,
    currentManifest: SemanticFileManifest
): ReadonlyArray<ProjectIndexFileChange> {
    return Object.freeze(
        reconcileSemanticManifests(previousManifest, currentManifest).changedFiles.map((change) =>
            Object.freeze({
                filePath: path.resolve(projectRoot, change.relativePath),
                kind: change.kind
            })
        )
    );
}

function supportsScopedPublication(changes: ReadonlyArray<ProjectIndexFileChange>): boolean {
    return changes.length > 0 && changes.every((change) => change.filePath.toLowerCase().endsWith(".gml"));
}

class SemanticProjectSessionController {
    private readonly store: SemanticIndexStore;
    private readonly overlays = new Map<string, SemanticOpenBufferOverlay>();
    private readonly overlayVersionHistory = new Map<string, number>();
    private readonly changedAbsolutePaths = new Set<string>();
    private readonly rawBaselines = new Map<SemanticTier, TemporaryRawBuilderBaseline>();
    private readonly overlayPublications = new Map<SemanticTier, OverlayPublication>();
    private readonly activeLeaseReleases = new Set<() => void>();
    private readonly leaseDrainWaiters = new Set<() => void>();
    private readonly acquisitionDrainWaiters = new Set<() => void>();
    private inputRevision = 0;
    private activeAcquisitionCount = 0;
    private currentManifest: SemanticFileManifest | null = null;
    private manifestPreparation: ManifestPreparation | null = null;
    private activeBuild: ActiveSemanticBuild | null = null;
    private closePromise: Promise<void> | null = null;
    private closed = false;

    constructor(
        private readonly buildIndex: SemanticProjectIndexBuilder,
        private readonly fsFacade: ProjectIndexFsFacade,
        private readonly onClose: () => void,
        readonly projectRoot: string
    ) {
        this.store = openSemanticIndexStore(projectRoot);
    }

    createSession(): SemanticProjectSession {
        return Object.freeze({
            acquireSnapshot: (requirements, signal) => this.acquireSnapshot(requirements, signal),
            applyDiskChanges: (batch) => this.applyDiskChanges(batch),
            applyOverlayChanges: (batch) => this.applyOverlayChanges(batch),
            close: () => this.close(),
            projectRoot: this.projectRoot
        });
    }

    private assertOpen(): void {
        if (this.closed) {
            throw new Error(`Semantic project session is closed: ${this.projectRoot}`);
        }
    }

    private supersedeProjectInputs(changedPaths: ReadonlySet<string>): void {
        if (changedPaths.size === 0) {
            return;
        }
        this.inputRevision += 1;
        for (const changedPath of changedPaths) {
            this.changedAbsolutePaths.add(changedPath);
        }
        this.activeBuild?.controller.abort();
    }

    private captureOverlays(): ReadonlyArray<SemanticOpenBufferOverlay> {
        return Object.freeze(
            [...this.overlays.values()]
                .toSorted((left, right) => compareSemanticQueryText(left.absolutePath, right.absolutePath))
                .map((overlay) => Object.freeze({ ...overlay }))
        );
    }

    private prepareManifest(revision: number): Promise<SemanticFileManifest> {
        if (this.currentManifest !== null && this.changedAbsolutePaths.size === 0) {
            return Promise.resolve(this.currentManifest);
        }
        if (this.manifestPreparation?.inputRevision === revision) {
            return this.manifestPreparation.promise;
        }
        const overlaysAtStart = this.captureOverlays();
        const changedPathsAtStart = Object.freeze([...this.changedAbsolutePaths]);
        const previousManifest = this.currentManifest;
        const overlayFilesystem = createSemanticOverlayFilesystem(this.fsFacade, overlaysAtStart);
        const promise = this.buildManifest(
            revision,
            previousManifest,
            overlayFilesystem,
            overlaysAtStart,
            changedPathsAtStart
        );
        this.manifestPreparation = Object.freeze({ inputRevision: revision, promise });
        const clearPreparation = (): void => {
            if (this.manifestPreparation?.promise === promise) {
                this.manifestPreparation = null;
            }
        };
        void promise.then(clearPreparation, clearPreparation);
        return promise;
    }

    private async buildManifest(
        revision: number,
        previousManifest: SemanticFileManifest | null,
        overlayFilesystem: ProjectIndexFsFacade,
        overlaysAtStart: ReadonlyArray<SemanticOpenBufferOverlay>,
        changedPathsAtStart: ReadonlyArray<string>
    ): Promise<SemanticFileManifest> {
        const manifest =
            previousManifest === null
                ? await buildSemanticFileManifest(
                      this.projectRoot,
                      overlayFilesystem,
                      overlaysAtStart,
                      this.store.readSemanticManifest("full") ?? this.store.readSemanticManifest("definitions")
                  )
                : await updateSemanticFileManifest(
                      this.projectRoot,
                      previousManifest,
                      overlayFilesystem,
                      overlaysAtStart,
                      changedPathsAtStart
                  );
        const versionedManifest = forceManifestOverlayVersions(this.projectRoot, manifest, overlaysAtStart);
        if (!this.closed && this.inputRevision === revision) {
            this.currentManifest = versionedManifest;
            this.changedAbsolutePaths.clear();
        }
        return versionedManifest;
    }

    private readRawBaseline(tier: SemanticTier): TemporaryRawBuilderBaseline | null {
        const existing = this.rawBaselines.get(tier);
        if (existing !== undefined) {
            return existing;
        }
        const manifest = this.store.readSemanticManifest(tier);
        const projectIndex = this.store.readSemanticNavigationProjection(tier);
        if (manifest === null || projectIndex === null) {
            return null;
        }
        const baseline = Object.freeze({ manifest, projectIndex });
        this.rawBaselines.set(tier, baseline);
        return baseline;
    }

    private isTierPublished(tier: SemanticTier, manifest: SemanticFileManifest): boolean {
        if (this.overlays.size > 0) {
            const publication = this.overlayPublications.get(tier);
            return (
                publication?.sourceRevision === manifest.sourceRevision &&
                publication.overlaySignature === createOverlaySignature(this.projectRoot, this.overlays)
            );
        }
        const slots = this.store.readActiveSemanticSlots();
        return tier === "definitions"
            ? slots.definitions?.sourceSignature === manifest.sourceRevision
            : slots.hasMatchingFull && slots.full?.sourceSignature === manifest.sourceRevision;
    }

    private publishProjectIndex(
        tier: SemanticTier,
        manifest: SemanticFileManifest,
        projectIndex: SemanticRawProjectIndex,
        baseline: TemporaryRawBuilderBaseline | null,
        incrementalChanges: ReadonlyArray<ProjectIndexFileChange>
    ): void {
        const snapshot = createSemanticSnapshotFromProjectIndex(projectIndex, tier, manifest.sourceRevision);
        if (this.overlays.size > 0) {
            const publication = this.store.publishSessionSemanticSnapshot({ manifest, snapshot });
            if (publication.kind !== "published") {
                throw new Error(`Semantic overlay publication failed for ${this.projectRoot}: ${publication.kind}`);
            }
            this.overlayPublications.set(
                tier,
                Object.freeze({
                    overlaySignature: createOverlaySignature(this.projectRoot, this.overlays),
                    sourceRevision: manifest.sourceRevision
                })
            );
            return;
        }
        const activeSlots = this.store.readActiveSemanticSlots();
        const request = Object.freeze({
            authoritative: false,
            baseGeneration: activeSlots[tier]?.generation ?? null,
            expectedHeadGeneration: this.store.readSemanticProjectHead().generation,
            manifest,
            navigationProjection: projectIndex,
            snapshot,
            sourceRevision: manifest.sourceRevision,
            tier
        });
        const canApplyIncrement =
            baseline !== null &&
            activeSlots[tier]?.sourceSignature === baseline.manifest.sourceRevision &&
            supportsScopedPublication(incrementalChanges);
        const publication = canApplyIncrement
            ? this.store.applySemanticIncrement({
                  ...request,
                  affectedFiles: incrementalChanges.map((change) => change.filePath)
              })
            : this.store.publishSemanticSnapshot(request);
        if (publication.status === "superseded") {
            throw new Error(`Semantic publication was superseded for ${this.projectRoot}.`);
        }
    }

    private async runBuild(
        revision: number,
        tier: SemanticTier,
        requirements: SemanticSnapshotRequirements,
        controller: AbortController
    ): Promise<void> {
        const manifest = await this.prepareManifest(revision);
        if (this.closed || this.inputRevision !== revision || this.isTierPublished(tier, manifest)) {
            return;
        }
        const overlaysAtStart = this.captureOverlays();
        const baseline = this.readRawBaseline(tier);
        const incrementalChanges: ReadonlyArray<ProjectIndexFileChange> =
            baseline === null
                ? EMPTY_PROJECT_INDEX_CHANGES
                : createIncrementalChanges(this.projectRoot, baseline.manifest, manifest);
        const projectIndex =
            baseline !== null && incrementalChanges.length === 0
                ? baseline.projectIndex
                : await this.buildIndex(
                      this.projectRoot,
                      createSemanticOverlayFilesystem(this.fsFacade, overlaysAtStart),
                      {
                          definitionsOnly: tier === "definitions",
                          ...(baseline === null || incrementalChanges.length === 0
                              ? {}
                              : { incremental: { changes: incrementalChanges, existingIndex: baseline.projectIndex } }),
                          priorityFiles: normalizeRequiredFilePaths(this.projectRoot, requirements.requiredFiles),
                          signal: controller.signal
                      }
                  );
        Core.throwIfAborted(controller.signal, "Semantic project build was superseded.");
        if (this.closed || this.inputRevision !== revision) {
            return;
        }
        this.publishProjectIndex(tier, manifest, projectIndex, baseline, incrementalChanges);
        const nextBaseline = Object.freeze({ manifest, projectIndex });
        this.rawBaselines.set(tier, nextBaseline);
        if (tier === "full") {
            this.rawBaselines.set("definitions", nextBaseline);
        }
    }

    private async ensureCurrentTierPublication(
        tier: SemanticTier,
        requirements: SemanticSnapshotRequirements
    ): Promise<void> {
        this.assertOpen();
        const revision = this.inputRevision;
        const manifest = await this.prepareManifest(revision);
        this.assertOpen();
        if (revision !== this.inputRevision) {
            await this.ensureCurrentTierPublication(tier, requirements);
            return;
        }
        if (this.isTierPublished(tier, manifest)) {
            return;
        }
        const runningBuild = this.activeBuild;
        if (runningBuild !== null) {
            await this.waitForRunningBuild(runningBuild);
            await this.ensureCurrentTierPublication(tier, requirements);
            return;
        }
        const controller = new AbortController();
        const promise = this.runBuild(revision, tier, requirements, controller);
        const build = Object.freeze({ controller, inputRevision: revision, promise, tier });
        this.activeBuild = build;
        try {
            await promise;
        } catch (error) {
            if (!this.closed && revision === this.inputRevision) {
                throw error;
            }
        } finally {
            if (this.activeBuild === build) {
                this.activeBuild = null;
            }
        }
        await this.ensureCurrentTierPublication(tier, requirements);
    }

    private async waitForRunningBuild(runningBuild: ActiveSemanticBuild): Promise<void> {
        try {
            await runningBuild.promise;
        } catch (error) {
            if (!this.closed && runningBuild.inputRevision === this.inputRevision) {
                throw error;
            }
        }
    }

    private async ensureTierPublished(tier: SemanticTier, requirements: SemanticSnapshotRequirements): Promise<void> {
        if (tier === "full") {
            await this.ensureCurrentTierPublication("definitions", requirements);
        }
        return this.ensureCurrentTierPublication(tier, requirements);
    }

    private async acquireSnapshot(
        requirements: SemanticSnapshotRequirements,
        signal: AbortSignal
    ): Promise<SemanticSnapshotAcquireResult> {
        this.assertOpen();
        this.activeAcquisitionCount += 1;
        try {
            if (signal.aborted) {
                return createAcquireFailure("cancelled");
            }
            if (!overlayRequirementsMatch(this.projectRoot, this.overlays, requirements.overlayVersions)) {
                return createAcquireFailure("overlayMismatch");
            }
            const publicationWait = await waitForSemanticProjectWork(
                this.ensureTierPublished(requirements.tier, requirements),
                signal
            );
            if (publicationWait === SEMANTIC_PROJECT_WAIT_CANCELLED) {
                return createAcquireFailure("cancelled");
            }
            this.assertOpen();
            if (!overlayRequirementsMatch(this.projectRoot, this.overlays, requirements.overlayVersions)) {
                return createAcquireFailure("overlayMismatch");
            }
            const result = await this.store.acquireSemanticSnapshot(requirements, signal);
            return result.kind === "lease"
                ? wrapSemanticProjectLease(result.lease, this.activeLeaseReleases, () => this.notifyLeaseReleased())
                : result;
        } finally {
            this.activeAcquisitionCount -= 1;
            if (this.activeAcquisitionCount === 0) {
                for (const resolve of this.acquisitionDrainWaiters) {
                    resolve();
                }
                this.acquisitionDrainWaiters.clear();
            }
        }
    }

    private notifyLeaseReleased(): void {
        if (this.activeLeaseReleases.size === 0) {
            for (const resolve of this.leaseDrainWaiters) {
                resolve();
            }
            this.leaseDrainWaiters.clear();
        }
    }

    private applyDiskChanges(batch: SemanticProjectDiskChangeBatch): void {
        this.assertOpen();
        const normalizedChanges = new Set(
            batch.changes.map((change) => resolveSemanticProjectInputPath(this.projectRoot, change.filePath))
        );
        this.supersedeProjectInputs(normalizedChanges);
    }

    private applyOverlayChanges(batch: SemanticProjectOverlayChangeBatch): void {
        this.assertOpen();
        const update = applySemanticOverlayChangeBatch(
            this.projectRoot,
            this.overlays,
            this.overlayVersionHistory,
            batch
        );
        this.overlayVersionHistory.clear();
        for (const [filePath, documentVersion] of update.versionHistory) {
            this.overlayVersionHistory.set(filePath, documentVersion);
        }
        this.overlays.clear();
        for (const [filePath, overlay] of update.overlays) {
            this.overlays.set(filePath, overlay);
        }
        this.supersedeProjectInputs(update.changedAbsolutePaths);
    }

    private close(): Promise<void> {
        if (this.closePromise !== null) {
            return this.closePromise;
        }
        this.closed = true;
        this.onClose();
        this.activeBuild?.controller.abort();
        this.closePromise = this.finishClose(this.activeBuild);
        return this.closePromise;
    }

    private async finishClose(buildAtClose: ActiveSemanticBuild | null): Promise<void> {
        if (buildAtClose !== null) {
            try {
                await buildAtClose.promise;
            } catch {
                // Closing deliberately aborts session-owned work.
            }
        }
        if (this.activeAcquisitionCount > 0) {
            await new Promise<void>((resolve) => {
                this.acquisitionDrainWaiters.add(resolve);
            });
        }
        if (this.activeLeaseReleases.size > 0) {
            await new Promise<void>((resolve) => {
                this.leaseDrainWaiters.add(resolve);
            });
        }
        await this.store.close();
    }
}

/** Create one semantic project session with a session-owned build and publication lifecycle. */
export function createSemanticProjectSession({
    buildIndex,
    fsFacade,
    onClose,
    projectRoot
}: SemanticProjectSessionConstruction): SemanticProjectSession {
    return new SemanticProjectSessionController(buildIndex, fsFacade, onClose, projectRoot).createSession();
}
