/**
 * Shared change-tracking methods for substitutable workspace-edit test doubles.
 *
 * Both `refactor-engine-batch-impact.test.ts` and `workspace-edit.test.ts`
 * build ad-hoc objects that satisfy the `WorkspaceLike` contract. Each
 * duplicate was repeating the same `hasChanges()` and
 * `collectChangedFilePaths()` bodies inline. This module owns those two
 * methods so the body lives in exactly one place.
 *
 * Spread the exported object into a substitute literal:
 *
 * ```ts
 * const substitute = {
 *     edits: [],
 *     metadataEdits: [],
 *     fileRenames: [],
 *     addEdit(...) { ... },
 *     groupByFile() { return new Map(); },
 *     ...workspaceEditChangeTracking
 * };
 * ```
 *
 * Because the helpers are declared with method-shorthand syntax and are
 * invoked through the composed object (`substitute.hasChanges()`), `this`
 * resolves to the receiving substitute at call time — preserving the
 * behaviour of the previous inline definitions.
 */
export const workspaceEditChangeTracking = {
    hasChanges(this: {
        edits: ReadonlyArray<unknown>;
        metadataEdits: ReadonlyArray<unknown>;
        fileRenames: ReadonlyArray<unknown>;
    }): boolean {
        return this.edits.length > 0 || this.metadataEdits.length > 0 || this.fileRenames.length > 0;
    },
    collectChangedFilePaths(this: {
        edits: ReadonlyArray<{ path: string }>;
        metadataEdits: ReadonlyArray<{ path: string }>;
        fileRenames: ReadonlyArray<{ oldPath: string; newPath: string }>;
    }): ReadonlySet<string> {
        const paths = new Set<string>();
        for (const edit of this.edits) {
            paths.add(edit.path);
        }
        for (const metadataEdit of this.metadataEdits) {
            paths.add(metadataEdit.path);
        }
        for (const fileRename of this.fileRenames) {
            paths.add(fileRename.oldPath);
            paths.add(fileRename.newPath);
        }
        return paths;
    }
};
