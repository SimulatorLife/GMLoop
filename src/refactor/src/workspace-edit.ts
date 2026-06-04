/**
 * Workspace edit types and utilities for the refactor engine.
 * Defines text edits, file renames, and metadata patches that collectively
 * represent a semantic-safe refactoring operation across multiple files.
 */

import { DUPLICATE_EDIT_CHECK_MAX_SET_SIZE } from "./refactor-constants.js";

/**
 * Well-known symbol that any workspace-edit-like object can implement to expose
 * its current mutation revision without being an instance of {@link WorkspaceEdit}.
 * Substitutable implementations should call this method each time they mutate
 * their edit collection and increment the returned counter so that callers can
 * detect staleness without relying on `instanceof` checks.
 *
 * @example
 * ```ts
 * import { WORKSPACE_EDIT_REVISION_TOKEN } from "./workspace-edit.js";
 *
 * class MyWorkspaceEdit {
 *   #revision = 0;
 *   [WORKSPACE_EDIT_REVISION_TOKEN](): number { return this.#revision; }
 *   addEdit(...) { this.#revision++; ... }
 * }
 * ```
 */
export const WORKSPACE_EDIT_REVISION_TOKEN: unique symbol = Symbol("WorkspaceEdit.revision");

/**
 * Contract that a workspace-edit-like object must implement to participate in
 * revision-based cache invalidation. Any class that exposes this method via the
 * {@link WORKSPACE_EDIT_REVISION_TOKEN} symbol can be used wherever revision
 * tracking is required, without being a concrete {@link WorkspaceEdit} instance.
 */
export interface WorkspaceRevisionProvider {
    readonly [WORKSPACE_EDIT_REVISION_TOKEN]: () => number;
}

/**
 * Duck-type contract for workspace edit containers used throughout the refactor
 * engine. This interface documents the full set of properties and methods that
 * any substitutable implementation must provide so that call sites can rely on
 * the shared contract rather than `instanceof WorkspaceEdit`.
 *
 * Using `WorkspaceLike` (or the capability probe {@link isWorkspaceEditLike})
 * instead of `instanceof` enables polymorphism across module boundaries: a
 * third-party or test-only implementation that satisfies the contract can be
 * substituted for the concrete {@link WorkspaceEdit} class without breaking
 * any caller.
 *
 * @example
 * ```ts
 * // Substitutable implementation — not a WorkspaceEdit subclass
 * class RecordingWorkspaceEdit {
 *   readonly edits: Array<TextEdit> = [];
 *   readonly metadataEdits: Array<MetadataEdit> = [];
 *   readonly fileRenames: Array<FileRename> = [];
 *
 *   addEdit(path: string, start: number, end: number, newText: string): void { ... }
 *   groupByFile(): Map<string, Array<Pick<TextEdit, "start" | "end" | "newText">>> { ... }
 * }
 *
 * // Accepts any WorkspaceLike, not just the concrete WorkspaceEdit class
 * function processWorkspace(workspace: WorkspaceLike): void {
 *   const grouped = workspace.groupByFile();
 *   ...
 * }
 * ```
 */
export interface WorkspaceLike {
    /**
     * Pending text edits to apply. Each edit replaces the range `[start, end)`
     * in the identified file with `newText`.
     */
    readonly edits: Array<TextEdit>;

    /**
     * Pending full-document metadata rewrites for `.yy`/`.yyp` resources.
     */
    readonly metadataEdits: Array<MetadataEdit>;

    /**
     * Pending file renames (directory or file path changes).
     */
    readonly fileRenames: Array<FileRename>;

    /**
     * Append a text edit to the workspace.
     *
     * @param path - Absolute workspace path of the file to edit.
     * @param start - Zero-based start offset of the range to replace.
     * @param end - Zero-based exclusive end offset of the range to replace.
     * @param newText - Replacement text inserted at the edit position.
     */
    addEdit(path: string, start: number, end: number, newText: string): void;

    /**
     * Append a full-document metadata rewrite for a `.yy`/`.yyp` resource.
     *
     * @param path - Absolute workspace path of the metadata file.
     * @param content - Complete new file content as a JSON string.
     */
    addMetadataEdit(path: string, content: string): void;

    /**
     * Queue a file or directory rename.
     *
     * @param oldPath - Current workspace path.
     * @param newPath - Desired workspace path after the rename.
     */
    addFileRename(oldPath: string, newPath: string): void;

    /**
     * Return a map from file path to that file's text edits, sorted in
     * descending order by start position with duplicates removed.
     */
    groupByFile(): GroupedTextEdits;
}

export interface TextEdit {
    path: string;
    start: number;
    end: number;
    newText: string;
}

export interface FileRename {
    oldPath: string;
    newPath: string;
}

/**
 * Full-document metadata rewrite for `.yy/.yyp` resources.
 */
export interface MetadataEdit {
    path: string;
    content: string;
}

export type GroupedTextEdits = Map<string, Array<Pick<TextEdit, "start" | "end" | "newText">>>;

export type WorkspaceEditTelemetry = {
    textEditCount: number;
    fileRenameCount: number;
    metadataEditCount: number;
    touchedFileCount: number;
    totalTextBytes: number;
    highWaterTextBytes: number;
};

type WorkspaceEditMutableState = {
    groupedEditsCache: GroupedTextEdits | null;
    groupedEditsRevision: number;
    revision: number;
    duplicateCheckSetDisabled: boolean;
};

const workspaceEditExactKeyState = new WeakMap<WorkspaceEdit, Set<string>>();
const workspaceEditMutableState = new WeakMap<WorkspaceEdit, WorkspaceEditMutableState>();
const TEXT_EDIT_IDENTITY_DELIMITER = "\u0000";

function createTextEditIdentityKey(path: string, start: number, end: number, newText: string): string {
    return `${path}${TEXT_EDIT_IDENTITY_DELIMITER}${start}${TEXT_EDIT_IDENTITY_DELIMITER}${end}${TEXT_EDIT_IDENTITY_DELIMITER}${newText}`;
}

function getExactEditKeys(workspace: WorkspaceEdit): Set<string> {
    const existing = workspaceEditExactKeyState.get(workspace);
    if (existing) {
        return existing;
    }

    const created = new Set(
        workspace.edits.map((edit) => createTextEditIdentityKey(edit.path, edit.start, edit.end, edit.newText))
    );
    workspaceEditExactKeyState.set(workspace, created);
    return created;
}

function getMutableState(workspace: WorkspaceEdit): WorkspaceEditMutableState {
    const existing = workspaceEditMutableState.get(workspace);
    if (existing) {
        return existing;
    }

    const created: WorkspaceEditMutableState = {
        groupedEditsCache: null,
        groupedEditsRevision: -1,
        revision: 0,
        duplicateCheckSetDisabled: false
    };
    workspaceEditMutableState.set(workspace, created);
    return created;
}

function markWorkspaceEditChanged(workspace: WorkspaceEdit): void {
    const mutableState = getMutableState(workspace);
    mutableState.revision += 1;
    mutableState.groupedEditsCache = null;
    mutableState.groupedEditsRevision = -1;
}

function compareEditText(left: string, right: string): number {
    if (left === right) {
        return 0;
    }

    const sharedLength = Math.min(left.length, right.length);
    for (let index = 0; index < sharedLength; index += 1) {
        const leftCode = left.charCodeAt(index);
        const rightCode = right.charCodeAt(index);
        if (leftCode !== rightCode) {
            return leftCode - rightCode;
        }
    }

    return left.length - right.length;
}

function deduplicateSortedTextEdits(
    sortedEdits: Array<Pick<TextEdit, "start" | "end" | "newText">>
): Array<Pick<TextEdit, "start" | "end" | "newText">> {
    if (sortedEdits.length <= 1) {
        return sortedEdits;
    }

    let writeIndex = 1;
    let previous = sortedEdits[0];

    for (let readIndex = 1; readIndex < sortedEdits.length; readIndex += 1) {
        const current = sortedEdits[readIndex];
        if (previous.start === current.start && previous.end === current.end && previous.newText === current.newText) {
            continue;
        }

        sortedEdits[writeIndex] = current;
        writeIndex += 1;
        previous = current;
    }

    sortedEdits.length = writeIndex;
    return sortedEdits;
}

/**
 * Concrete workspace edit container used throughout the refactor engine.
 *
 * `WorkspaceEdit` is the canonical implementation of {@link WorkspaceLike}.
 * Callers that only need to create or read workspaces should type their
 * parameters as {@link WorkspaceLike} to accept any substitutable
 * implementation. The concrete class is used internally when the caller
 * owns the construction and needs deduplication, caching, or revision tracking.
 */
export class WorkspaceEdit implements WorkspaceLike {
    readonly edits: Array<TextEdit>;
    readonly fileRenames: Array<FileRename> = [];
    readonly metadataEdits: Array<MetadataEdit> = [];

    /**
     * Create a WorkspaceEdit container for managing text edits and file operations across files.
     *
     * @param initialEdits Optional iterable of edits to initialize with
     */
    constructor(initialEdits: Iterable<TextEdit> = []) {
        this.edits = Array.from(initialEdits);
    }

    addEdit(path: string, start: number, end: number, newText: string): void {
        const mutableState = getMutableState(this);
        if (!mutableState.duplicateCheckSetDisabled) {
            const exactEditKeys = getExactEditKeys(this);
            const editKey = createTextEditIdentityKey(path, start, end, newText);
            if (exactEditKeys.has(editKey)) {
                return;
            }

            exactEditKeys.add(editKey);
            if (exactEditKeys.size > DUPLICATE_EDIT_CHECK_MAX_SET_SIZE) {
                workspaceEditExactKeyState.delete(this);
                mutableState.duplicateCheckSetDisabled = true;
            }
        }

        this.edits.push({ path, start, end, newText });
        mutableState.revision += 1;
        mutableState.groupedEditsCache = null;
        mutableState.groupedEditsRevision = -1;
    }

    addFileRename(oldPath: string, newPath: string): void {
        this.fileRenames.push({ oldPath, newPath });
        markWorkspaceEditChanged(this);
    }

    /**
     * Queue a full-document metadata rewrite.
     */
    addMetadataEdit(path: string, content: string): void {
        this.metadataEdits.push({ path, content });
        markWorkspaceEditChanged(this);
    }

    groupByFile(): GroupedTextEdits {
        const mutableState = getMutableState(this);
        if (mutableState.groupedEditsCache !== null && mutableState.groupedEditsRevision === mutableState.revision) {
            return mutableState.groupedEditsCache;
        }

        const grouped: GroupedTextEdits = new Map();

        for (const edit of this.edits) {
            let fileEdits = grouped.get(edit.path);
            if (!fileEdits) {
                fileEdits = [];
                grouped.set(edit.path, fileEdits);
            }

            fileEdits.push({
                start: edit.start,
                end: edit.end,
                newText: edit.newText
            });
        }

        for (const [path, fileEdits] of grouped.entries()) {
            fileEdits.sort((a, b) => b.start - a.start || b.end - a.end || compareEditText(a.newText, b.newText));
            grouped.set(path, deduplicateSortedTextEdits(fileEdits));
        }

        mutableState.groupedEditsCache = grouped;
        mutableState.groupedEditsRevision = mutableState.revision;
        return grouped;
    }

    /**
     * Implement the {@link WorkspaceRevisionProvider} contract so that
     * {@link getWorkspaceEditRevision} can retrieve the revision via a
     * capability probe rather than an `instanceof WorkspaceEdit` check.
     * This allows substitutable workspace implementations to participate in
     * revision-based cache invalidation by implementing the same symbol method.
     */
    [WORKSPACE_EDIT_REVISION_TOKEN](): number {
        return getMutableState(this).revision;
    }
}

/**
 * Return size/counter telemetry collected while building a workspace edit.
 */
export function getWorkspaceEditTelemetry(workspace: WorkspaceEdit): WorkspaceEditTelemetry {
    const touchedFiles = new Set<string>();
    let totalTextBytes = 0;

    for (const edit of workspace.edits) {
        touchedFiles.add(edit.path);
        totalTextBytes += Buffer.byteLength(edit.newText, "utf8");
    }

    for (const metadataEdit of workspace.metadataEdits) {
        touchedFiles.add(metadataEdit.path);
        totalTextBytes += Buffer.byteLength(metadataEdit.content, "utf8");
    }

    for (const fileRename of workspace.fileRenames) {
        touchedFiles.add(fileRename.oldPath);
        touchedFiles.add(fileRename.newPath);
    }

    return {
        textEditCount: workspace.edits.length,
        fileRenameCount: workspace.fileRenames.length,
        metadataEditCount: workspace.metadataEdits.length,
        touchedFileCount: touchedFiles.size,
        totalTextBytes,
        highWaterTextBytes: totalTextBytes
    };
}

/**
 * Return the current mutation revision for any object that implements the
 * {@link WorkspaceRevisionProvider} contract via {@link WORKSPACE_EDIT_REVISION_TOKEN}.
 * The revision increments whenever text edits, metadata edits, or file renames
 * are appended, allowing callers to invalidate caches tied to the workspace's
 * current contents without exposing the mutable bookkeeping itself.
 *
 * Any substitutable workspace implementation that exposes
 * `[WORKSPACE_EDIT_REVISION_TOKEN](): number` participates in revision tracking
 * without needing to be a concrete {@link WorkspaceEdit} instance.
 *
 * @param workspace - Workspace edit instance or compatible provider to inspect.
 * @returns Current mutation revision, or `null` when the object does not implement the contract.
 */
export function getWorkspaceEditRevision(workspace: object): number | null {
    const provider = workspace as Partial<WorkspaceRevisionProvider>;
    if (typeof provider[WORKSPACE_EDIT_REVISION_TOKEN] !== "function") {
        return null;
    }

    return provider[WORKSPACE_EDIT_REVISION_TOKEN]();
}

/**
 * Capability probe that confirms a value satisfies the {@link WorkspaceLike}
 * contract. Use this instead of `instanceof WorkspaceEdit` so that
 * substitutable implementations can be recognized at runtime without
 * sharing a common prototype chain.
 *
 * The probe verifies all three array properties (`edits`, `metadataEdits`,
 * `fileRenames`) so that callers can safely destructure all arrays from an
 * unknown workspace without null-checking each one individually.
 *
 * @param value - Candidate value to inspect.
 * @returns `true` when the value satisfies the WorkspaceLike contract.
 */
export function isWorkspaceEditLike(value?: unknown): boolean {
    if (value == null || typeof value !== "object") {
        return false;
    }

    const candidate = value as Record<string, unknown>;

    return (
        Array.isArray(candidate.edits) &&
        Array.isArray(candidate.metadataEdits) &&
        Array.isArray(candidate.fileRenames) &&
        typeof candidate.addEdit === "function" &&
        typeof candidate.addMetadataEdit === "function" &&
        typeof candidate.addFileRename === "function" &&
        typeof candidate.groupByFile === "function"
    );
}

/**
 * Safely extract metadataEdits and fileRenames arrays from a workspace-like object.
 * Returns empty arrays if the properties are missing or not arrays.
 *
 * @param workspace - An object that may contain metadataEdits and/or fileRenames properties
 * @returns Object containing validated metadataEdits and fileRenames arrays
 */
export function getWorkspaceArrays(workspace: { metadataEdits?: unknown; fileRenames?: unknown }): {
    metadataEdits: Array<MetadataEdit>;
    fileRenames: Array<FileRename>;
} {
    return {
        metadataEdits: Array.isArray(workspace.metadataEdits) ? (workspace.metadataEdits as Array<MetadataEdit>) : [],
        fileRenames: Array.isArray(workspace.fileRenames) ? (workspace.fileRenames as Array<FileRename>) : []
    };
}

/**
 * Merge all edits, file renames, and metadata edits from `source` into `target`.
 *
 * When `source` is `null` or `undefined` the function is a no-op, making it safe
 * to call unconditionally with nullable providers (e.g. the return value of
 * `semantic.getAdditionalSymbolEdits`).
 *
 * Text edits are merged via {@link WorkspaceEdit.addEdit} so the exact-duplicate
 * guard on `target` is honoured. File renames and metadata edits are appended
 * directly; callers that need deduplication (e.g. batch rename accumulation)
 * should use {@link accumulateRenameWorkspace} instead.
 *
 * @param target - Destination workspace that receives the merged content.
 * @param source - Source workspace whose edits are copied into `target`.
 */
export function mergeWorkspaceEditInto(target: WorkspaceEdit, source: WorkspaceEdit | null | undefined): void {
    if (!source) {
        return;
    }

    for (const edit of source.edits) {
        target.addEdit(edit.path, edit.start, edit.end, edit.newText);
    }

    for (const metadataEdit of source.metadataEdits) {
        target.addMetadataEdit(metadataEdit.path, metadataEdit.content);
    }

    for (const fileRename of source.fileRenames) {
        target.addFileRename(fileRename.oldPath, fileRename.newPath);
    }
}

/**
 * Validate file rename operations queued on a workspace edit.
 * Rejects ambiguous rename graphs up front so callers cannot apply a workspace
 * that would depend on execution order or overwrite another pending rename.
 *
 * @param fileRenames - File rename operations to validate.
 * @returns Validation errors describing every invalid rename entry.
 */
export function validateFileRenameOperations(fileRenames: ReadonlyArray<FileRename>): Array<string> {
    const errors: Array<string> = [];
    const seenSourcePaths = new Set<string>();
    const seenDestinationPaths = new Set<string>();
    const sourcePathSet = new Set<string>();

    for (const rename of fileRenames) {
        sourcePathSet.add(rename.oldPath);
    }

    for (const rename of fileRenames) {
        if (typeof rename.oldPath !== "string" || rename.oldPath.length === 0) {
            errors.push("File rename source path must be a non-empty string");
        }

        if (typeof rename.newPath !== "string" || rename.newPath.length === 0) {
            errors.push("File rename destination path must be a non-empty string");
        }

        if (
            typeof rename.oldPath === "string" &&
            typeof rename.newPath === "string" &&
            rename.oldPath.length > 0 &&
            rename.newPath.length > 0 &&
            rename.oldPath === rename.newPath
        ) {
            errors.push(`File rename for ${rename.oldPath} must change the path`);
        }

        if (seenSourcePaths.has(rename.oldPath)) {
            errors.push(`Duplicate file rename source detected for ${rename.oldPath}`);
        }

        if (seenDestinationPaths.has(rename.newPath)) {
            errors.push(`Duplicate file rename destination detected for ${rename.newPath}`);
        }

        if (sourcePathSet.has(rename.newPath)) {
            errors.push(
                `File rename destination ${rename.newPath} is also scheduled as a rename source; rename chains are not supported`
            );
        }

        seenSourcePaths.add(rename.oldPath);
        seenDestinationPaths.add(rename.newPath);
    }

    return errors;
}
