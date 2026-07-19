import type { IdentifierSinkOptions } from "./identifier-sink.js";
import type { MetricsSnapshot } from "./metrics.js";
import type { ProjectIndexLogger } from "./project-index-logger.js";

/** Physical source change consumed by a scoped project-index build. */
export type ProjectIndexFileChange = Readonly<{
    filePath: string;
    kind: "added" | "deleted" | "metadataChanged" | "modified";
}>;

/** Progress emitted while parsing an ordered project file set. */
export type ProjectIndexBuildProgress = Readonly<{
    current: number;
    stage: "gml-parse";
    total: number;
}>;

/** Explicit options accepted by the canonical project-index builder. */
export type ProjectIndexBuildOptions = Readonly<{
    concurrency?: Readonly<{ gml: number; gmlParsing: number; worker?: number }> | null;
    definitionsOnly?: boolean;
    identifierSink?: IdentifierSinkOptions;
    incremental?: Readonly<{
        changes: ReadonlyArray<ProjectIndexFileChange>;
        existingIndex: Record<string, unknown>;
    }>;
    logger?: ProjectIndexLogger;
    logMetrics?: boolean;
    metrics?: unknown;
    onMetrics?: (metrics: MetricsSnapshot, projectIndex: Record<string, unknown>) => void;
    onProgress?: (progress: ProjectIndexBuildProgress) => void;
    parseGml?: (sourceText: string, context?: unknown) => unknown;
    priorityFiles?: ReadonlyArray<string>;
    signal?: AbortSignal;
}>;
