/**
 * Transpilation coordinator for the CLI watch command.
 *
 * This module manages transpilation lifecycle, metrics tracking, and patch
 * orchestration for the hot-reload pipeline. It serves as the bridge between
 * file change detection and WebSocket patch streaming.
 */

import path from "node:path";

import { Core } from "@gmloop/core";
import type * as TranspilerTypes from "@gmloop/transpiler";
import { Transpiler } from "@gmloop/transpiler";

import { formatCliError } from "../../cli-core/index.js";
import type { PatchBroadcaster } from "../websocket/server.js";
import { createGmlParserAdapter, type createGmlTranspilerAdapter, type GmlParserAdapter } from "./adapters.js";
import {
    getRuntimePathSegments,
    resolveObjectEventPartsFromSegments,
    resolveObjectRuntimeIdFromSegments
} from "./runtime-identifiers.js";
import { extractReferencesFromAst, extractSymbolsFromAst } from "./symbol-extraction.js";

/**
 * Default parser adapter used by the coordinator when no override is supplied.
 *
 * The adapter is built once at module load time and re-used for every
 * `parseAstAndExtractMetadata` call. Centralising the construction here keeps
 * the rest of the coordinator from importing the concrete `Parser.GMLParser`
 * class, which is the dependency-inversion boundary this module is
 * responsible for.
 */
const defaultParserAdapter: GmlParserAdapter = createGmlParserAdapter();

type RuntimeTranspiler = GmlTranspilerInstance;
type GmlTranspilerInstance = ReturnType<typeof createGmlTranspilerAdapter>;
export type RuntimeTranspilerPatch =
    ReturnType<GmlTranspilerInstance["transpileScript"]> | ReturnType<GmlTranspilerInstance["transpileEvent"]>;

export interface ResourceLayerUpdate {
    layerName: string;
    layerType: "GMRBackgroundLayer" | "GMRInstanceLayer";
    properties: Record<string, unknown>;
}

export interface ResourcePatch {
    kind: "resource";
    id: string;
    resourceType: "GMRoom";
    resourceName: string;
    layerUpdates: Array<ResourceLayerUpdate>;
    metadata: { sourcePath: string; sourceHash: string; timestamp: number };
}

/** Creates a deterministic room resource patch for the live-reload protocol. */
export function createResourcePatch(
    filePath: string,
    resourceName: string,
    layerUpdates: Array<ResourceLayerUpdate>,
    sourceHash: string
): ResourcePatch {
    return {
        kind: "resource",
        id: `resource/room/${resourceName}`,
        resourceType: "GMRoom",
        resourceName,
        layerUpdates,
        metadata: { sourcePath: filePath, sourceHash, timestamp: Date.now() }
    };
}

export interface TranspilationMetrics {
    timestamp: number;
    filePath: string;
    patchId: string;
    durationMs: number;
    sourceSize: number;
    outputSize: number;
    linesProcessed: number;
    /**
     * End-to-end hot-reload latency in milliseconds: from when the filesystem
     * change event was first detected to when the patch was broadcast to clients.
     *
     * Only present when the file change was triggered by the watcher (not during
     * the initial scan, where no change event fires).
     */
    hotReloadLatencyMs?: number;
    patchResult?: {
        delivered: boolean;
        failureCount: number;
        successCount: number;
        totalClients: number;
    };
}

export type ErrorCategory = "syntax" | "validation" | "internal" | "unknown";

export interface TranspilationError {
    timestamp: number;
    filePath: string;
    error: string;
    sourceSize?: number;
    category: ErrorCategory;
    line?: number;
    column?: number;
    recoveryHint?: string;
}

/**
 * Resolves the transpilation kind and identifiers for a GML file.
 *
 * Returns `kind: "event"` with canonical symbol ID and runtime ID when the
 * file is inside an `objects/<objectName>/` directory. Returns `kind: "script"`
 * for all other files.
 */
function resolveFileTranspilationKind(
    filePath: string
): { kind: "event"; symbolId: string; runtimeId: string } | { kind: "script"; runtimeId: string | null } {
    const segments = getRuntimePathSegments(filePath);
    const eventParts = resolveObjectEventPartsFromSegments(segments);
    if (eventParts) {
        const { objectName, eventName } = eventParts;
        return {
            kind: "event",
            symbolId: `gml/event/${objectName}/${eventName}`,
            runtimeId: `gml_Object_${objectName}_${eventName}`
        };
    }

    return { kind: "script", runtimeId: resolveObjectRuntimeIdFromSegments(segments) };
}

/**
 * Classifies a transpilation error and extracts metadata for better error reporting.
 */
function resolveSyntaxRecoveryHint(message: string): string | undefined {
    if (message.includes("missing associated closing brace")) {
        return "Add a closing brace '}' to match the opening brace.";
    }
    if (message.includes("unexpected end of file")) {
        return "Check for unclosed blocks, parentheses, or brackets.";
    }
    if (message.includes("unexpected symbol")) {
        return "Review the syntax at the indicated position. Check for typos or missing operators.";
    }
    if (message.includes("function parameters")) {
        return "Function parameters must be valid identifiers separated by commas.";
    }
    return undefined;
}

/**
 * Classifies a transpilation error using structured error codes.
 *
 * This function checks for a TranspilerError with a known error code
 * (PARSE_ERROR, VALIDATION_ERROR, REQUEST_ERROR, INTERNAL_ERROR).
 * Unstructured errors are treated as unknown to keep classification
 * contract explicit and avoid brittle legacy string matching paths.
 */
function classifyTranspilationError(error: unknown): {
    category: ErrorCategory;
    message: string;
    line?: number;
    column?: number;
    recoveryHint?: string;
} {
    let targetError: unknown = error;

    if (Core.isErrorLike(error) && error.cause) {
        targetError = error.cause;
    }

    // Classify using structured error codes when available.
    // This avoids fragile string matching and provides reliable categorization
    // for errors thrown by the transpiler workspace.
    if (Core.isErrorWithCode(error, Transpiler.TranspilerErrorCode.PARSE_ERROR)) {
        // Extract line/column from the cause if it's a GML parse error.
        if (Core.isGmlParseError(targetError)) {
            return {
                category: "syntax",
                message: targetError.message,
                line: targetError.line,
                column: targetError.column,
                recoveryHint: resolveSyntaxRecoveryHint(targetError.message)
            };
        }
        // Fallback: parse error without location info.
        return {
            category: "syntax",
            message: Core.getErrorMessage(error),
            recoveryHint: "Check for syntax errors in the GML source."
        };
    }

    if (Core.isErrorWithCode(error, Transpiler.TranspilerErrorCode.VALIDATION_ERROR)) {
        return {
            category: "validation",
            message: Core.getErrorMessage(error),
            recoveryHint:
                "The transpiler produced invalid output. This may indicate an internal issue. Try simplifying the code."
        };
    }

    if (Core.isErrorWithCode(error, Transpiler.TranspilerErrorCode.REQUEST_ERROR)) {
        return {
            category: "validation",
            message: Core.getErrorMessage(error),
            recoveryHint: "Ensure the file is a valid GML source file."
        };
    }

    if (Core.isErrorWithCode(error, Transpiler.TranspilerErrorCode.INTERNAL_ERROR)) {
        // If the cause is a GML parse error, classify as syntax error.
        // This handles the common case where the transpiler wraps a parse error.
        if (Core.isGmlParseError(targetError)) {
            return {
                category: "syntax",
                message: targetError.message,
                line: targetError.line,
                column: targetError.column,
                recoveryHint: resolveSyntaxRecoveryHint(targetError.message)
            };
        }
        // Extract inner message if this is a transpiler-wrapped error.
        const message = Core.getErrorMessage(error);
        const causeMatch = /Failed to transpile (?:script|event|closure|expression) [^:]+: (?<inner>.+)$/u.exec(
            message
        );
        const innerMessage = causeMatch?.groups?.inner ?? message;
        return {
            category: "internal",
            message: innerMessage,
            recoveryHint:
                "An internal transpilation error occurred. This may be a bug. Check for unsupported GML features."
        };
    }

    // At this point error is not error-like (all isErrorLike branches returned).
    // Use Core.getErrorMessage for consistent fallback: it attempts
    // to produce a meaningful string from strings, objects, and primitives.
    const errorString = Core.getErrorMessage(error, { fallback: "Unknown error" });

    return {
        category: "unknown",
        message: errorString
    };
}

/**
 * Lightweight patch summary for history tracking.
 *
 * Avoids retaining full JavaScript payloads in memory by storing only
 * the byte size. This allows memory usage tracking without keeping
 * the entire transpiled code in the history buffer.
 */
export interface PatchSummary {
    id: string;
    kind: string;
    runtimeId?: string;
    sourcePath?: string;
    timestamp?: number;
    jsBodyBytes: number;
}

/**
 * Transpiler execution service.
 *
 * Provides access to the transpiler instance without coupling to
 * metrics, error tracking, or broadcasting concerns.
 */
export interface TranspilerProvider {
    transpiler: RuntimeTranspiler;
}

/**
 * Bounded collection size configuration.
 *
 * Captures the maximum number of entries that a bounded collection can hold.
 * This contract is extracted from the three state interfaces (PatchHistoryStore,
 * MetricsCollector, ErrorCollector) that all shared `maxPatchHistory: number`.
 *
 * Separating the bounds configuration from the collection state implements ISP:
 * callers that only need to configure bounds can depend on this interface alone
 * without being coupled to the full state of patches, metrics, or errors.
 */
export interface BoundedCollectionBounds {
    maxEntries: number;
}

/**
 * Patch history management.
 *
 * Provides patch summary storage and successful patch caching without
 * coupling to metrics, error tracking, or broadcasting operations.
 */
export interface PatchHistoryStore {
    /**
     * Lightweight summaries of recent patches, trimmed to avoid retaining full
     * JavaScript payloads in memory. `jsBodyBytes` records the payload size so
     * memory usage can be tracked without storing the full string.
     */
    patches: Array<PatchSummary>;
    lastSuccessfulPatches: Map<string, RuntimeTranspilerPatch>;
    /**
     * Secondary index mapping source file paths to their associated patch IDs.
     * Enables O(k) stale-patch cleanup instead of O(n) iteration over all patches.
     */
    sourcePathToPatchIds: Map<string, Set<string>>;
    bounds: BoundedCollectionBounds;
}

/**
 * Metrics collection service.
 *
 * Provides transpilation metrics tracking without coupling to patch
 * history, error tracking, or broadcasting operations.
 */
export interface MetricsCollector {
    metrics: Array<TranspilationMetrics>;
    bounds: BoundedCollectionBounds;
}

/**
 * Successful-patch counter.
 *
 * Provides an increment-only counter of all successfully emitted patches.
 * Does not track patch contents; callers that need per-patch details
 * should consult PatchHistoryStore instead.
 */
export interface TranspilationCounter {
    totalPatchCount: number;
}

/**
 * Read-only snapshot of the patch counter for display/monitoring purposes.
 *
 * Provides a stable view of the counter without coupling to transpilation
 * state, metrics tracking, or broadcasting.
 */
export interface PatchCounter {
    readonly totalPatchCount: number;
}

/**
 * Error collection service.
 *
 * Provides transpilation error tracking without coupling to metrics,
 * patch history, or broadcasting operations.
 */
export interface ErrorCollector {
    errors: Array<TranspilationError>;
    bounds: BoundedCollectionBounds;
}

/**
 * Patch broadcasting service.
 *
 * Provides WebSocket patch distribution without coupling to metrics,
 * error tracking, or history management.
 */
export interface PatchBroadcastService {
    websocketServer: PatchBroadcaster | null;
}

/**
 * Script name registry.
 *
 * Provides script name tracking without coupling to transpilation,
 * metrics, or broadcasting operations.
 */
export interface ScriptRegistry {
    scriptNames?: Set<string>;
}

/**
 * Optional project-wide macro state used by watch-mode transpilation.
 *
 * Standalone callers may omit this registry when they transpile an isolated
 * source file. The watch command supplies it after its project-wide parse so
 * split function patches see macros declared by other resources as well.
 */
export interface ProjectMacroRegistry {
    macroDefinitionsBySourcePath?: TranspilerTypes.MacroDefinitionsBySourcePath;
    macroDefinitions?: Map<string, TranspilerTypes.MacroDefinition>;
}

/**
 * Metrics snapshot for display purposes.
 *
 * Provides a read-only view of transpilation metrics without coupling to
 * patch history, error tracking, or broadcasting.
 */
export interface MetricsSnapshot {
    readonly metrics: ReadonlyArray<TranspilationMetrics>;
}

/**
 * Errors snapshot for display purposes.
 *
 * Provides a read-only view of transpilation errors without coupling to
 * metrics, patch history, or broadcasting.
 */
export interface ErrorsSnapshot {
    readonly errors: ReadonlyArray<TranspilationError>;
}

/**
 * Complete transpilation context interface.
 *
 * Combines all role-focused interfaces for consumers that need full
 * transpilation capabilities. Consumers should prefer depending on
 * the minimal interface they need (TranspilerProvider, MetricsCollector, etc.)
 * rather than this composite interface when possible.
 */
export interface TranspilationContext
    extends
        TranspilerProvider,
        PatchHistoryStore,
        TranspilationCounter,
        MetricsCollector,
        ErrorCollector,
        PatchBroadcastService,
        ScriptRegistry,
        ProjectMacroRegistry {}

export interface TranspilationOptions {
    verbose: boolean;
    quiet: boolean;
    /**
     * Pre-parsed AST to reuse instead of parsing the source again.
     * When provided, the file is not re-parsed, eliminating redundant work during
     * the initial scan where the AST was already produced while collecting script names.
     */
    cachedAst?: unknown;
    /**
     * Pre-extracted symbol definitions to reuse instead of re-traversing the AST.
     * When provided alongside `cachedAst`, the symbol walker is skipped entirely,
     * saving a second full AST traversal during the initial scan.
     */
    cachedSymbols?: ReadonlyArray<string>;
    /**
     * Pre-extracted symbol references to reuse instead of re-traversing the AST.
     * When provided alongside `cachedAst`, the reference walker is skipped entirely,
     * saving a second full AST traversal during the initial scan.
     */
    cachedReferences?: ReadonlyArray<string>;
    /**
     * Wall-clock timestamp (Date.now()) recorded when the filesystem change event
     * was first detected. When provided, the transpiler records the end-to-end
     * hot-reload latency (detection → broadcast) in {@link TranspilationMetrics.hotReloadLatencyMs}.
     *
     * Omit for the initial scan pass, where there is no preceding watch event.
     */
    fileChangeDetectedAt?: number;
    /**
     * Controls whether the generated patch should be added to runtime history and
     * broadcast to connected clients. Initial dependency scans generate patches
     * only to validate transpilation and collect metadata; those patches mirror
     * code already present in a freshly built runtime and must not be replayed as
     * live edits.
     */
    deliverRuntimePatch?: boolean;
}

export interface TranspilationResult {
    success: boolean;
    patch?: RuntimeTranspilerPatch;
    /**
     * Every runtime patch produced for the source file, in source order.
     *
     * A GameMaker script can contain more than one top-level function. The
     * browser runtime binds one patch to one generated function, so those
     * functions must be delivered as a batch instead of being left as local
     * declarations inside the primary patch body.
     */
    patches?: Array<RuntimeTranspilerPatch>;
    metrics?: TranspilationMetrics;
    error?: TranspilationError;
    symbols?: Array<string>;
    references?: Array<string>;
    /** Effective macro symbols whose definitions changed during this transpilation. */
    macroDefinitionChanges?: Array<string>;
}

/** Result of building dependency metadata without emitting runtime JavaScript. */
export interface FileMetadataAnalysisResult {
    readonly success: boolean;
    readonly symbols: Array<string>;
    readonly references: Array<string>;
    readonly error?: TranspilationError;
}

interface ParsedAstExtractionResult {
    ast: unknown;
    parseError: unknown;
    parsedSymbols: Array<string>;
    parsedReferences: Array<string>;
}

/**
 * Adds an item to a bounded collection, removing the oldest item if the
 * collection exceeds its maximum size. A non-positive `maxSize` is treated as
 * "unbounded" — items are appended without trimming — matching the
 * documented contract for CLI options such as `--max-patch-history`.
 */
function addToBoundedCollection<T>(collection: Array<T>, item: T, maxSize: number): void {
    collection.push(item);
    if (maxSize > 0 && collection.length > maxSize) {
        collection.shift();
    }
}

/**
 * Extracts symbol declarations and reference identifiers from a parsed GML AST.
 *
 * This function performs a single AST traversal to collect both symbols and
 * references, which is more efficient than calling extraction separately.
 *
 * When pre-extracted values are provided, they are reused to skip redundant
 * work during incremental updates (e.g., when only part of the AST changed).
 */
function extractMetadataFromAst(
    ast: unknown,
    filePath: string,
    preExtractedSymbols?: ReadonlyArray<string>,
    preExtractedReferences?: ReadonlyArray<string>
): { parsedSymbols: Array<string>; parsedReferences: Array<string> } {
    if (preExtractedSymbols !== undefined && preExtractedReferences !== undefined) {
        return {
            parsedSymbols: Array.from(preExtractedSymbols),
            parsedReferences: Array.from(preExtractedReferences)
        };
    }

    const parsedSymbols =
        preExtractedSymbols === undefined ? extractSymbolsFromAst(ast, filePath) : Array.from(preExtractedSymbols);
    const parsedReferences =
        preExtractedReferences === undefined ? extractReferencesFromAst(ast) : Array.from(preExtractedReferences);

    return { parsedSymbols, parsedReferences };
}

/**
 * Parses one source file and extracts dependency metadata without running the
 * emitter. Watch startup uses this path because the native HTML5 build already
 * contains the initial JavaScript; startup only needs the dependency graph.
 */
export function analyzeFileMetadata(
    context: ProjectMacroRegistry,
    filePath: string,
    content: string,
    parseAdapter: GmlParserAdapter = defaultParserAdapter
): FileMetadataAnalysisResult {
    try {
        const { ast, parseError, parsedSymbols, parsedReferences } = parseAstAndExtractMetadata(
            content,
            filePath,
            undefined,
            undefined,
            undefined,
            parseAdapter
        );
        if (parseError !== null) {
            throw parseError;
        }

        const { effectiveSymbols, effectiveReferences } = prepareMacroTranspilation(
            context,
            ast,
            filePath,
            content,
            parsedSymbols,
            parsedReferences
        );
        return { success: true, symbols: effectiveSymbols, references: effectiveReferences };
    } catch (error) {
        const classified = classifyTranspilationError(error);
        return {
            success: false,
            symbols: [],
            references: [],
            error: {
                timestamp: Date.now(),
                filePath,
                error: classified.message,
                sourceSize: content.length,
                category: classified.category,
                line: classified.line,
                column: classified.column,
                recoveryHint: classified.recoveryHint
            }
        };
    }
}

/**
 * Parses GML content into an AST, then extracts symbol declarations and
 * reference identifiers from it.
 *
 * This function orchestrates two distinct responsibilities:
 * 1. Parse: Convert GML source text into an Abstract Syntax Tree
 * 2. Extract: Walk the AST to collect symbols and references
 *
 * Accepts pre-parsed AST and pre-extracted values to skip redundant work
 * when the caller has already produced them (e.g., during the initial
 * startup scan). The `parseAdapter` parameter is the dependency-inversion
 * seam — by default it delegates to `createGmlParserAdapter` from
 * `./adapters.js`, but tests can pass a stub that returns a pre-baked AST
 * without instantiating the concrete `Parser.GMLParser`.
 */
function parseAstAndExtractMetadata(
    content: string,
    filePath: string,
    preParseAst?: unknown,
    preExtractedSymbols?: ReadonlyArray<string>,
    preExtractedReferences?: ReadonlyArray<string>,
    parseAdapter: GmlParserAdapter = defaultParserAdapter
): ParsedAstExtractionResult {
    try {
        const ast = preParseAst ?? parseAdapter(content);
        const { parsedSymbols, parsedReferences } = extractMetadataFromAst(
            ast,
            filePath,
            preExtractedSymbols,
            preExtractedReferences
        );

        return {
            ast,
            parseError: null,
            parsedSymbols,
            parsedReferences
        };
    } catch (error) {
        return {
            ast: undefined,
            parseError: error,
            parsedSymbols: [],
            parsedReferences: []
        };
    }
}

/**
 * Validates a transpiled patch before broadcasting.
 */
function validatePatch(patch: RuntimeTranspilerPatch): boolean {
    if (!patch || typeof patch !== "object") {
        return false;
    }

    if (!patch.id || typeof patch.id !== "string") {
        return false;
    }

    if (!patch.kind || typeof patch.kind !== "string") {
        return false;
    }

    if (patch.js_body === undefined || patch.js_body === null || typeof patch.js_body !== "string") {
        return false;
    }

    return true;
}

/**
 * Creates an error notification message for WebSocket clients.
 */
function createErrorNotification(
    filePath: string,
    error: string
): {
    kind: "error";
    filePath: string;
    error: string;
    timestamp: number;
} {
    return {
        kind: "error",
        filePath: path.basename(filePath),
        error,
        timestamp: Date.now()
    };
}

function createPatchSummary(patchPayload: RuntimeTranspilerPatch): PatchSummary {
    const metadata = Core.isObjectLike(patchPayload.metadata) ? patchPayload.metadata : null;
    const sourcePath = Core.isNonEmptyString(metadata?.sourcePath) ? metadata.sourcePath : undefined;
    const timestamp = Core.isFiniteNumber(metadata?.timestamp) ? metadata.timestamp : undefined;
    const runtimeIdValue = (patchPayload as { runtimeId?: unknown }).runtimeId;
    const runtimeId = Core.isNonEmptyString(runtimeIdValue) ? runtimeIdValue : undefined;

    return {
        id: patchPayload.id,
        kind: patchPayload.kind,
        runtimeId,
        sourcePath,
        timestamp,
        jsBodyBytes: Buffer.byteLength(patchPayload.js_body, "utf8")
    };
}

function hasRuntimePatchChanged(
    previousPatch: RuntimeTranspilerPatch | undefined,
    nextPatch: RuntimeTranspilerPatch
): boolean {
    if (!previousPatch) {
        return true;
    }

    const previousRuntimeId = (previousPatch as { runtimeId?: unknown }).runtimeId;
    const nextRuntimeId = (nextPatch as { runtimeId?: unknown }).runtimeId;

    return (
        previousPatch.id !== nextPatch.id ||
        previousPatch.kind !== nextPatch.kind ||
        previousRuntimeId !== nextRuntimeId ||
        previousPatch.js_body !== nextPatch.js_body
    );
}

/**
 * Drops stale patch entries that were emitted from the same source file but now
 * use a different patch identifier.
 *
 * Watch mode can produce a new patch ID for the same file when the primary
 * symbol changes (for example, after a script rename during iterative edits).
 * Keeping older IDs alive in `lastSuccessfulPatches` causes avoidable steady
 * memory growth and redundant replay payloads for late subscribers.
 */
function clearStalePatchesForSourcePath(
    lastSuccessfulPatches: Map<string, RuntimeTranspilerPatch>,
    sourcePathToPatchIds: Map<string, Set<string>>,
    sourcePath: string,
    nextPatchIds: ReadonlySet<string>
): void {
    const stalePatchIds = sourcePathToPatchIds.get(sourcePath);
    if (!stalePatchIds) {
        return;
    }

    for (const patchId of stalePatchIds) {
        if (!nextPatchIds.has(patchId)) {
            lastSuccessfulPatches.delete(patchId);
        }
    }
    stalePatchIds.clear();
}

interface ScriptAstNode {
    readonly type?: string;
    readonly id?: string | ScriptAstNode | null;
    readonly name?: string;
}

interface ScriptProgramAst {
    readonly type?: string;
    readonly body?: ReadonlyArray<ScriptAstNode>;
}

interface TranspilationPatchPlan {
    readonly patch: RuntimeTranspilerPatch;
    readonly ast: unknown;
}

interface MacroTranspilationResult {
    readonly effectiveAst: unknown;
    readonly effectiveSymbols: Array<string>;
    readonly effectiveReferences: Array<string>;
    readonly macroDefinitionChanges: Array<string>;
    readonly candidateDefinitionsBySourcePath: TranspilerTypes.MacroDefinitionsBySourcePath | null;
    readonly macroDefinitions: Map<string, TranspilerTypes.MacroDefinition>;
}

function prepareMacroTranspilation(
    context: ProjectMacroRegistry,
    ast: unknown,
    filePath: string,
    content: string,
    parsedSymbols: ReadonlyArray<string>,
    parsedReferences: ReadonlyArray<string>
): MacroTranspilationResult {
    const localMacroDefinitions = Core.isObjectLike(ast)
        ? Transpiler.extractMacroDefinitionsFromAst(ast, filePath, content)
        : new Map<string, TranspilerTypes.MacroDefinition>();
    const previousMacroDefinitions = context.macroDefinitions ?? new Map<string, TranspilerTypes.MacroDefinition>();
    let candidateDefinitionsBySourcePath: TranspilerTypes.MacroDefinitionsBySourcePath | null = null;
    let macroDefinitions: Map<string, TranspilerTypes.MacroDefinition>;

    // Watch mode populates `macroDefinitionsBySourcePath` after the project-wide
    // startup walk and transpiles each file through that index on every change.
    // In that path the simpler copy + merge below would be thrown away: the
    // `createProjectMacroDefinitions` call rebuilds the merged macro map from the
    // candidate source-path index, so we skip the redundant allocation entirely.
    // Standalone callers (e.g. the `transpile` command) without a source-path
    // index fall back to merging the local definitions into a copy of the
    // previous project map, preserving the original behavior.
    if (context.macroDefinitionsBySourcePath && Core.isObjectLike(ast)) {
        candidateDefinitionsBySourcePath = new Map(context.macroDefinitionsBySourcePath);
        candidateDefinitionsBySourcePath.set(filePath, localMacroDefinitions);
        macroDefinitions = Transpiler.createProjectMacroDefinitions(candidateDefinitionsBySourcePath);
    } else {
        macroDefinitions = new Map(previousMacroDefinitions);
        for (const [name, definition] of localMacroDefinitions) {
            macroDefinitions.set(name, definition);
        }
    }

    const effectiveAst = Transpiler.expandProjectMacros(ast, macroDefinitions, filePath);
    const macroReferences = Transpiler.extractMacroReferencesFromAst(ast, macroDefinitions).map(
        (name) => `gml/macro/${name}`
    );
    const effectiveReferences = Array.from(
        new Set(
            effectiveAst === ast
                ? [...parsedReferences, ...macroReferences]
                : [...extractReferencesFromAst(effectiveAst), ...macroReferences]
        )
    );
    const effectiveSymbols = Array.from(
        new Set([...parsedSymbols, ...[...localMacroDefinitions.keys()].map((name) => `gml/macro/${name}`)])
    );
    const macroDefinitionChanges = Transpiler.findChangedMacroDefinitionNames(
        previousMacroDefinitions,
        macroDefinitions
    ).map((name) => `gml/macro/${name}`);

    return {
        effectiveAst,
        effectiveSymbols,
        effectiveReferences,
        macroDefinitionChanges,
        candidateDefinitionsBySourcePath,
        macroDefinitions
    };
}

function commitMacroTranspilation(
    context: ProjectMacroRegistry,
    candidateDefinitionsBySourcePath: TranspilerTypes.MacroDefinitionsBySourcePath | null,
    macroDefinitions: Map<string, TranspilerTypes.MacroDefinition>
): void {
    if (candidateDefinitionsBySourcePath && context.macroDefinitionsBySourcePath) {
        context.macroDefinitionsBySourcePath.clear();
        for (const [source, definitions] of candidateDefinitionsBySourcePath) {
            context.macroDefinitionsBySourcePath.set(source, definitions);
        }
    }

    if (context.macroDefinitions === undefined && candidateDefinitionsBySourcePath === null) {
        return;
    }

    context.macroDefinitions = macroDefinitions;
}

function asScriptProgramAst(ast: unknown): ScriptProgramAst | null {
    if (!Core.isObjectLike(ast)) {
        return null;
    }

    const record = ast as Record<string, unknown>;
    if (record.type !== "Program" || !Array.isArray(record.body)) {
        return null;
    }

    return {
        type: "Program",
        body: record.body.filter((node): node is ScriptAstNode => Core.isObjectLike(node))
    };
}

function getScriptFunctionName(node: ScriptAstNode): string | null {
    if (typeof node.id === "string") {
        return node.id;
    }
    if (!Core.isObjectLike(node.id)) {
        return null;
    }

    const idRecord = node.id as Record<string, unknown>;
    return typeof idRecord.name === "string" ? idRecord.name : null;
}

function isScriptCompileTimeNode(node: ScriptAstNode): boolean {
    return (
        node.type === "MacroDeclaration" ||
        node.type === "DefineStatement" ||
        node.type === "RegionStatement" ||
        node.type === "EndRegionStatement" ||
        node.type === "EnumDeclaration"
    );
}

function createExecutableProgramAst(ast: unknown): unknown {
    const program = asScriptProgramAst(ast);
    if (program === null) {
        return ast;
    }

    return {
        type: "Program",
        body: program.body?.filter((node) => !isScriptCompileTimeNode(node)) ?? []
    };
}

/**
 * Emits one script patch for each top-level function in a multi-function GML
 * script. The transpiler unwraps a program containing exactly one function,
 * which gives the runtime a body it can bind directly to that function's
 * generated GameMaker symbol. Executable top-level statements are kept in a
 * separate file-level patch so they remain bound to the generated global
 * script function instead of being accidentally attached to a helper.
 */
function transpileScriptPatches(
    context: TranspilationContext,
    sourceText: string,
    sourcePath: string,
    ast: unknown,
    parsedSymbols: ReadonlyArray<string>
): Array<TranspilationPatchPlan> {
    const program = asScriptProgramAst(ast);
    const body = program?.body ?? [];
    const executableNodes = body.filter((node) => !isScriptCompileTimeNode(node));
    const executableAst = program === null ? ast : { type: "Program", body: executableNodes };
    const functionNodes = executableNodes.filter((node) => node.type === "FunctionDeclaration");
    const topLevelNodes = executableNodes.filter((node) => node.type !== "FunctionDeclaration");

    if (functionNodes.length === 0 || (functionNodes.length === 1 && topLevelNodes.length === 0)) {
        const fileName = path.basename(sourcePath, path.extname(sourcePath));
        const defaultSymbolId = `gml/script/${fileName}`;
        const scriptSymbolId = getPrimaryScriptPatchId(parsedSymbols);
        const symbolId = scriptSymbolId ?? defaultSymbolId;

        return [
            {
                patch: context.transpiler.transpileScript({
                    sourceText,
                    symbolId,
                    ast: executableAst
                }),
                ast: executableAst
            }
        ];
    }

    const patchIds = new Set<string>();
    const functionPatches = functionNodes.map((functionNode) => {
        const functionName = getScriptFunctionName(functionNode);
        if (!functionName) {
            throw new TypeError("A top-level script function is missing its identifier");
        }

        const symbolId = `gml/script/${functionName}`;
        if (patchIds.has(symbolId)) {
            throw new TypeError(`A source file defines the script function ${functionName} more than once`);
        }
        patchIds.add(symbolId);

        const functionAst = { type: "Program", body: [functionNode] };
        return {
            patch: context.transpiler.transpileScript({
                sourceText,
                symbolId,
                ast: functionAst
            }),
            ast: functionAst
        };
    });

    if (topLevelNodes.length === 0) {
        return functionPatches;
    }

    const fileName = path.basename(sourcePath, path.extname(sourcePath));
    const topLevelAst = { type: "Program", body: topLevelNodes };
    const defaultTopLevelPatchId = `gml/script/${fileName}`;
    if (patchIds.has(defaultTopLevelPatchId)) {
        throw new TypeError(
            `Script ${sourcePath} contains top-level executable statements and a function named ${fileName}; split the initialization code into a differently named script`
        );
    }
    const topLevelPatchId = defaultTopLevelPatchId;
    const topLevelPatch = {
        patch: context.transpiler.transpileScript({
            sourceText,
            symbolId: topLevelPatchId,
            ast: topLevelAst
        }),
        ast: topLevelAst
    };

    return [topLevelPatch, ...functionPatches];
}

/**
 * Transpiles a GML file and manages the complete lifecycle including metrics
 * tracking, patch validation, symbol extraction, and WebSocket broadcasting.
 *
 * Files inside `objects/<objectName>/` directories are transpiled as object
 * events using `transpileEvent()`, which emits `self.<field>` for instance
 * variable accesses. All other `.gml` files are transpiled as scripts.
 */
export function transpileFile(
    context: TranspilationContext,
    filePath: string,
    content: string,
    lines: number,
    options: TranspilationOptions
): TranspilationResult {
    const {
        verbose,
        quiet,
        cachedAst,
        cachedSymbols,
        cachedReferences,
        fileChangeDetectedAt,
        deliverRuntimePatch = true
    } = options;
    const startTime = performance.now();

    try {
        const fileKind = resolveFileTranspilationKind(filePath);
        const { ast, parseError, parsedSymbols, parsedReferences } = parseAstAndExtractMetadata(
            content,
            filePath,
            cachedAst,
            cachedSymbols,
            cachedReferences
        );

        const {
            effectiveAst,
            effectiveSymbols,
            effectiveReferences,
            macroDefinitionChanges,
            candidateDefinitionsBySourcePath,
            macroDefinitions
        } = prepareMacroTranspilation(context, ast, filePath, content, parsedSymbols, parsedReferences);

        const transpilationAst = fileKind.kind === "event" ? createExecutableProgramAst(effectiveAst) : effectiveAst;
        const patchPlans: Array<TranspilationPatchPlan> =
            fileKind.kind === "event"
                ? [
                      {
                          patch: context.transpiler.transpileEvent({
                              sourceText: content,
                              symbolId: fileKind.symbolId,
                              ast: transpilationAst
                          }),
                          ast: transpilationAst
                      }
                  ]
                : transpileScriptPatches(context, content, filePath, transpilationAst, parsedSymbols);

        // A single-patch file's one patch covers the entire transpiled AST, so its
        // reference set is identical to `effectiveReferences` (already walked once
        // above in `prepareMacroTranspilation`) — re-walking here would just repeat
        // that traversal on every hot-reload cycle. Multi-function scripts still need
        // a per-patch walk because each function patch must depend only on the
        // symbols *it* calls, not every symbol referenced anywhere in the file.
        const patchPayloads = patchPlans.map(({ patch, ast: patchAst }) => {
            const patchReferences = patchPlans.length === 1 ? effectiveReferences : extractReferencesFromAst(patchAst);
            const patchWithMetadata = {
                ...patch,
                metadata: {
                    ...patch.metadata,
                    sourcePath: filePath,
                    dependencies: resolvePatchDependencies(
                        patchReferences,
                        patch.id,
                        parsedSymbols,
                        context.scriptNames
                    )
                }
            };
            const patchPayload =
                fileKind.runtimeId === null
                    ? patchWithMetadata
                    : { ...patchWithMetadata, runtimeId: fileKind.runtimeId };

            if (!validatePatch(patchPayload)) {
                throw new Error(`Generated patch failed validation: ${patch.id}`);
            }

            return patchPayload;
        });
        const [patchPayload] = patchPayloads;
        if (!patchPayload) {
            throw new Error("Transpilation produced no runtime patches");
        }

        commitMacroTranspilation(context, candidateDefinitionsBySourcePath, macroDefinitions);

        const durationMs = performance.now() - startTime;

        const metrics: TranspilationMetrics = {
            timestamp: Date.now(),
            filePath,
            patchId: patchPayload.id,
            durationMs,
            sourceSize: content.length,
            outputSize: patchPayloads.reduce((total, nextPatch) => total + nextPatch.js_body.length, 0),
            linesProcessed: lines
        };

        addToBoundedCollection(context.metrics, metrics, context.bounds.maxEntries);

        if (context.scriptNames && fileKind.kind === "script") {
            registerScriptNamesFromSymbols(effectiveSymbols, context.scriptNames);
        }

        if (!deliverRuntimePatch) {
            return {
                success: true,
                patch: patchPayload,
                patches: patchPayloads,
                metrics,
                symbols: effectiveSymbols,
                references: effectiveReferences,
                macroDefinitionChanges
            };
        }

        clearStalePatchesForSourcePath(
            context.lastSuccessfulPatches,
            context.sourcePathToPatchIds,
            filePath,
            new Set(patchPayloads.map((nextPatch) => nextPatch.id))
        );
        const changedPatches: Array<RuntimeTranspilerPatch> = [];
        for (const nextPatch of patchPayloads) {
            const previousPatch = context.lastSuccessfulPatches.get(nextPatch.id);
            if (hasRuntimePatchChanged(previousPatch, nextPatch)) {
                changedPatches.push(nextPatch);
            }
            context.lastSuccessfulPatches.set(nextPatch.id, nextPatch);
        }

        let patchIdsForSource = context.sourcePathToPatchIds.get(filePath);
        if (!patchIdsForSource) {
            patchIdsForSource = new Set();
            context.sourcePathToPatchIds.set(filePath, patchIdsForSource);
        }
        for (const nextPatch of patchPayloads) {
            patchIdsForSource.add(nextPatch.id);
        }
        if (changedPatches.length > 0) {
            for (const changedPatch of changedPatches) {
                addToBoundedCollection(context.patches, createPatchSummary(changedPatch), context.bounds.maxEntries);
            }
            context.totalPatchCount += changedPatches.length;

            const broadcastPayload = changedPatches.length === 1 ? changedPatches[0] : changedPatches;
            const broadcastResult = context.websocketServer?.broadcast(broadcastPayload);

            // Record end-to-end hot-reload latency after the patch has been broadcast.
            // This captures the full pipeline delay (file-change detection → broadcast)
            // so callers can verify the system meets the 120–180 ms latency target.
            if (fileChangeDetectedAt !== undefined) {
                metrics.hotReloadLatencyMs = Date.now() - fileChangeDetectedAt;
            }

            if (broadcastResult && !quiet) {
                if (verbose) {
                    console.log(`  ↳ Broadcasted to ${broadcastResult.successCount} clients`);
                    if (broadcastResult.failureCount > 0) {
                        console.log(`  ↳ Failed to send to ${broadcastResult.failureCount} clients`);
                    }
                } else if (broadcastResult.successCount > 0) {
                    console.log(`  ↳ Streamed to ${broadcastResult.successCount} client(s)`);
                }
            }

            metrics.patchResult = {
                delivered: (broadcastResult?.successCount ?? 0) > 0,
                failureCount: broadcastResult?.failureCount ?? 0,
                successCount: broadcastResult?.successCount ?? 0,
                totalClients: broadcastResult?.totalClients ?? 0
            };
        } else if (verbose && !quiet) {
            console.log("  ↳ Runtime patch unchanged; skipping patch broadcast");
        }

        if (!quiet) {
            if (verbose) {
                console.log(
                    `  ↳ Transpiled to JavaScript (${metrics.outputSize} chars across ${patchPayloads.length} patch(es) in ${durationMs.toFixed(2)}ms)`
                );
                console.log(`  ↳ Patch ID: ${patchPayload.id}`);
                if (patchPayloads.length > 1) {
                    console.log(`  ↳ Patch IDs: ${patchPayloads.map((nextPatch) => nextPatch.id).join(", ")}`);
                }
                if (patchPayload.metadata?.timestamp) {
                    console.log(`  ↳ Generated at: ${new Date(patchPayload.metadata.timestamp).toISOString()}`);
                }
                if (effectiveSymbols.length > 0) {
                    console.log(`  ↳ Extracted symbols: ${effectiveSymbols.join(", ")}`);
                }
                if (effectiveReferences.length > 0) {
                    console.log(`  ↳ Extracted references: ${effectiveReferences.join(", ")}`);
                }
                if (parseError) {
                    const message = Core.getErrorMessage(parseError, {
                        fallback: "Unknown parse error"
                    });
                    console.log(`  ↳ Warning: Could not extract symbols/references from AST: ${message}`);
                }
            } else if (changedPatches.length > 0) {
                console.log(`  ↳ Generated patch: ${patchPayload.id}`);
            }
        }

        return {
            success: true,
            patch: patchPayload,
            patches: patchPayloads,
            metrics,
            symbols: effectiveSymbols,
            references: effectiveReferences,
            macroDefinitionChanges
        };
    } catch (error) {
        const classified = classifyTranspilationError(error);

        const transpilationError: TranspilationError = {
            timestamp: Date.now(),
            filePath,
            error: classified.message,
            sourceSize: content.length,
            category: classified.category,
            line: classified.line,
            column: classified.column,
            recoveryHint: classified.recoveryHint
        };

        addToBoundedCollection(context.errors, transpilationError, context.bounds.maxEntries);

        if (context.websocketServer) {
            const errorNotification = createErrorNotification(filePath, classified.message);
            context.websocketServer.broadcast(errorNotification);
        }

        if (verbose) {
            const formattedError = formatCliError(error);
            console.error(`  ↳ Transpilation failed (${classified.category}):\n${formattedError}`);
            if (classified.line !== undefined && classified.column !== undefined) {
                console.error(`  ↳ Location: line ${classified.line}, column ${classified.column}`);
            }
            if (classified.recoveryHint) {
                console.error(`  ↳ Hint: ${classified.recoveryHint}`);
            }
        } else {
            const locationInfo =
                classified.line !== undefined && classified.column !== undefined
                    ? ` (line ${classified.line}, column ${classified.column})`
                    : "";
            console.error(`  ↳ Transpilation failed: ${classified.message}${locationInfo}`);
            if (classified.recoveryHint && !quiet) {
                console.error(`  ↳ Hint: ${classified.recoveryHint}`);
            }
        }

        return {
            success: false,
            error: transpilationError
        };
    }
}

/**
 * Displays transpilation and error statistics.
 */
export function displayTranspilationStatistics(
    context: MetricsSnapshot & ErrorsSnapshot,
    verbose: boolean,
    quiet: boolean
): void {
    if (quiet) {
        return;
    }

    const { metrics, errors } = context;
    const hasMetrics = metrics.length > 0;
    const hasErrors = errors.length > 0;

    if (!hasMetrics && !hasErrors) {
        return;
    }

    console.log("\n--- Transpilation Statistics ---");

    if (hasMetrics) {
        console.log(`Total patches generated: ${metrics.length}`);

        if (verbose) {
            const totalDuration = metrics.reduce((sum, m) => sum + m.durationMs, 0);
            const totalSourceSize = metrics.reduce((sum, m) => sum + m.sourceSize, 0);
            const totalOutputSize = metrics.reduce((sum, m) => sum + m.outputSize, 0);
            const avgDuration = totalDuration / metrics.length;

            console.log(`Total transpilation time: ${totalDuration.toFixed(2)}ms`);
            console.log(`Average transpilation time: ${avgDuration.toFixed(2)}ms`);
            console.log(`Total source processed: ${(totalSourceSize / 1024).toFixed(2)} KB`);
            console.log(`Total output generated: ${(totalOutputSize / 1024).toFixed(2)} KB`);

            const compressionRatio =
                totalSourceSize > 0 ? `${((totalOutputSize / totalSourceSize) * 100).toFixed(1)}%` : "N/A";
            console.log(`Output/source ratio: ${compressionRatio}`);

            if (metrics.length > 0) {
                const fastestPatch = metrics.reduce((min, m) => (m.durationMs < min.durationMs ? m : min));
                const slowestPatch = metrics.reduce((max, m) => (m.durationMs > max.durationMs ? m : max));

                console.log(
                    `Fastest transpilation: ${fastestPatch.durationMs.toFixed(2)}ms (${path.basename(fastestPatch.filePath)})`
                );
                console.log(
                    `Slowest transpilation: ${slowestPatch.durationMs.toFixed(2)}ms (${path.basename(slowestPatch.filePath)})`
                );
            }
        }
    }

    if (hasErrors) {
        console.log(`\nTotal errors: ${errors.length}`);

        if (verbose) {
            const errorsByCategory = new Map<ErrorCategory, number>();
            for (const error of errors) {
                const count = errorsByCategory.get(error.category) ?? 0;
                errorsByCategory.set(error.category, count + 1);
            }

            console.log("\nErrors by category:");
            for (const [category, count] of errorsByCategory.entries()) {
                console.log(`  ${category}: ${count}`);
            }
        }

        if (verbose && errors.length > 0) {
            console.log("\nRecent errors:");
            const recentErrors = errors.slice(-5);
            for (const error of recentErrors) {
                const timestamp = new Date(error.timestamp).toISOString();
                const locationInfo =
                    error.line !== undefined && error.column !== undefined
                        ? ` (line ${error.line}, col ${error.column})`
                        : "";
                console.log(`  [${timestamp}] ${path.basename(error.filePath)}${locationInfo}`);
                console.log(`    Category: ${error.category}`);
                console.log(`    ${error.error}`);
                if (error.recoveryHint) {
                    console.log(`    Hint: ${error.recoveryHint}`);
                }
            }
        }
    }

    console.log("-------------------------------\n");
}

export function registerScriptNamesFromSymbols(symbols: ReadonlyArray<string>, scriptNames: Set<string>): void {
    for (const symbol of symbols) {
        const scriptName = symbolIdToScriptName(symbol);
        if (scriptName) {
            scriptNames.add(scriptName);
        }
    }
}

function symbolIdToScriptName(symbolId: string): string | null {
    if (symbolId.startsWith("gml_Script_")) {
        return symbolId.slice("gml_Script_".length);
    }
    if (symbolId.startsWith("gml_GlobalScript_")) {
        return symbolId.slice("gml_GlobalScript_".length);
    }
    return null;
}

function runtimeSymbolToPatchId(symbolId: string): string | null {
    const scriptName = symbolIdToScriptName(symbolId);
    if (scriptName) {
        return `gml/script/${scriptName}`;
    }
    return null;
}

function getPrimaryScriptPatchId(symbols: ReadonlyArray<string>): string | null {
    for (const symbol of symbols) {
        const patchId = runtimeSymbolToPatchId(symbol);
        if (patchId) {
            return patchId;
        }
    }
    return null;
}

function resolvePatchDependencies(
    references: ReadonlyArray<string>,
    patchId: string,
    definedSymbols: ReadonlyArray<string>,
    registeredScriptNames: ReadonlySet<string> | undefined
): Array<string> {
    const dependencies = new Set<string>();
    const definedPatchIds = new Set(
        definedSymbols
            .map((symbol) => runtimeSymbolToPatchId(symbol))
            .filter((symbolId): symbolId is string => symbolId !== null)
    );

    for (const reference of references) {
        const referencedScriptName = symbolIdToScriptName(reference);
        if (
            referencedScriptName === null ||
            (registeredScriptNames !== undefined && !registeredScriptNames.has(referencedScriptName))
        ) {
            continue;
        }

        const dependencyPatchId = runtimeSymbolToPatchId(reference);
        if (!dependencyPatchId || dependencyPatchId === patchId || definedPatchIds.has(dependencyPatchId)) {
            continue;
        }

        dependencies.add(dependencyPatchId);
    }

    return Array.from(dependencies);
}
