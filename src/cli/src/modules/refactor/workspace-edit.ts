import { WORKSPACE_EDIT_REVISION_TOKEN } from "@gmloop/refactor";

type BridgeTextEdit = {
    end: number;
    newText: string;
    start: number;
};

type BridgeGroupedTextEdits = Map<string, Array<BridgeTextEdit>>;

/** Accumulates text, metadata, and file rename operations for one refactor plan. */
export type WorkspaceEdit = {
    addEdit: (path: string, start: number, end: number, newText: string) => void;
    addFileRename: (oldPath: string, newPath: string) => void;
    addMetadataEdit: (path: string, content: string) => void;
    addMetadataObjectEdit?: (path: string, document: Record<string, unknown>) => void;
    edits: Array<{ end: number; newText: string; path: string; start: number }>;
    fileRenames: Array<{ newPath: string; oldPath: string }>;
    metadataEdits: Array<{ content: string; path: string }>;
    metadataObjects?: Array<{ document: Record<string, unknown>; path: string }>;
    groupByFile: () => BridgeGroupedTextEdits;
    hasChanges: () => boolean;
    collectChangedFilePaths: () => ReadonlySet<string>;
    [WORKSPACE_EDIT_REVISION_TOKEN]: () => number;
};

/** Creates an empty workspace edit with revision and changed-path tracking. */
export function createWorkspaceEdit(): WorkspaceEdit {
    let revision = 0;

    const workspace = {
        edits: [] as Array<{ end: number; newText: string; path: string; start: number }>,
        fileRenames: [] as Array<{ newPath: string; oldPath: string }>,
        metadataEdits: [] as Array<{ content: string; path: string }>,
        metadataObjects: [] as Array<{ document: Record<string, unknown>; path: string }>,
        addEdit(filePath: string, start: number, end: number, newText: string) {
            workspace.edits.push({ path: filePath, start, end, newText });
            revision += 1;
        },
        addFileRename(oldPath: string, newPath: string) {
            workspace.fileRenames.push({ oldPath, newPath });
            revision += 1;
        },
        addMetadataEdit(filePath: string, content: string) {
            workspace.metadataEdits.push({ path: filePath, content });
            revision += 1;
        },
        addMetadataObjectEdit(filePath: string, document: Record<string, unknown>) {
            workspace.metadataObjects.push({ path: filePath, document });
            revision += 1;
        },
        groupByFile() {
            const grouped: BridgeGroupedTextEdits = new Map();
            for (const edit of workspace.edits) {
                const fileEdits = grouped.get(edit.path) ?? [];
                fileEdits.push({
                    start: edit.start,
                    end: edit.end,
                    newText: edit.newText
                });
                grouped.set(edit.path, fileEdits);
            }

            for (const [groupPath, fileEdits] of grouped.entries()) {
                grouped.set(
                    groupPath,
                    fileEdits.toSorted((left, right) => right.start - left.start)
                );
            }

            return grouped;
        },
        hasChanges() {
            return workspace.edits.length > 0 || workspace.metadataEdits.length > 0 || workspace.fileRenames.length > 0;
        },
        collectChangedFilePaths() {
            const paths = new Set<string>();
            for (const edit of workspace.edits) {
                paths.add(edit.path);
            }
            for (const metadataEdit of workspace.metadataEdits) {
                paths.add(metadataEdit.path);
            }
            for (const fileRename of workspace.fileRenames) {
                paths.add(fileRename.oldPath);
                paths.add(fileRename.newPath);
            }
            return paths;
        },
        [WORKSPACE_EDIT_REVISION_TOKEN]() {
            return revision;
        }
    };

    return workspace satisfies WorkspaceEdit;
}
