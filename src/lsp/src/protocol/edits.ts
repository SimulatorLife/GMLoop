import type { TextEdit, WorkspaceEdit } from "vscode-languageserver/node.js";

import { type GmlTextDocument, offsetsToRange } from "../documents/index.js";

/**
 * Convert UTF-16 offset edits into LSP text edits.
 */
export function sourceOffsetEditsToTextEdits(
    document: GmlTextDocument,
    edits: ReadonlyArray<{ end: number; start: number; text: string }>
): TextEdit[] {
    return edits.map((edit) => ({
        range: offsetsToRange(document, edit.start, edit.end),
        newText: edit.text
    }));
}

/**
 * Create a whole-document LSP text edit.
 */
export function createWholeDocumentTextEdit(document: GmlTextDocument, newText: string): TextEdit {
    return {
        range: offsetsToRange(document, 0, document.sourceText.length),
        newText
    };
}

/**
 * Create an LSP workspace edit for one GML document.
 */
export function createSingleDocumentWorkspaceEdit(
    document: GmlTextDocument,
    edits: ReadonlyArray<TextEdit>
): WorkspaceEdit {
    return {
        changes: {
            [document.uri]: [...edits]
        }
    };
}
