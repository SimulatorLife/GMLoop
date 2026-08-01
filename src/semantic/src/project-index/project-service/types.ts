import type { ProjectIndexFsFacade } from "../fs-facade.js";
import type { SemanticSnapshotAcquireResult, SemanticSnapshotRequirements } from "../semantic-snapshot.js";

/** One physical project input changed since the session's last publication. */
export type SemanticProjectDiskChange = Readonly<{
    filePath: string;
    kind: "added" | "deleted" | "metadataChanged" | "modified";
}>;

/** An atomic batch of physical project input changes. */
export type SemanticProjectDiskChangeBatch = Readonly<{
    changes: ReadonlyArray<SemanticProjectDiskChange>;
}>;

/** One versioned editor-overlay mutation. Versions must increase per file. */
export type SemanticProjectOverlayChange =
    | Readonly<{
          documentVersion: number;
          filePath: string;
          kind: "remove";
      }>
    | Readonly<{
          documentVersion: number;
          filePath: string;
          kind: "upsert";
          sourceText: string;
      }>;

/** An atomically validated batch of versioned editor-overlay mutations. */
export type SemanticProjectOverlayChangeBatch = Readonly<{
    changes: ReadonlyArray<SemanticProjectOverlayChange>;
}>;

/** Construction options for the canonical semantic project service. */
export type SemanticProjectServiceOptions = Readonly<{
    /** Filesystem boundary used for project discovery and source reads. */
    fsFacade?: ProjectIndexFsFacade;
}>;

/** One normalized-root semantic session owned by a project service. */
export type SemanticProjectSession = Readonly<{
    /** Canonical absolute project root used as the service deduplication key. */
    projectRoot: string;
    /** Record physical project changes and supersede analysis of older inputs. */
    applyDiskChanges: (batch: SemanticProjectDiskChangeBatch) => void;
    /** Atomically apply versioned session-local editor overlays. */
    applyOverlayChanges: (batch: SemanticProjectOverlayChangeBatch) => void;
    /** Acquire an immutable snapshot, building and publishing missing facts once per shared input revision. */
    acquireSnapshot: (
        requirements: SemanticSnapshotRequirements,
        signal: AbortSignal
    ) => Promise<SemanticSnapshotAcquireResult>;
    /** Abort session-owned work, release session-owned leases, and close persistent resources. */
    close: () => Promise<void>;
}>;

/** Canonical owner of one long-lived semantic session per normalized project root. */
export type SemanticProjectService = Readonly<{
    /** Close every owned session and reject future session opens. */
    close: () => Promise<void>;
    /** Return the existing normalized-root session or create it once. */
    openProject: (projectRoot: string) => SemanticProjectSession;
}>;
