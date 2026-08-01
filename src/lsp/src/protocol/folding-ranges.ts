import { type FoldingRange, FoldingRangeKind } from "vscode-languageserver/node.js";

/**
 * Create LSP folding ranges for lightweight GML block and region structure.
 */
export function createGmlFoldingRanges(sourceText: string): FoldingRange[] {
    const lines = sourceText.split(/\r?\n/u);
    const foldingRanges: FoldingRange[] = [];
    const regionStack: number[] = [];
    const braceStack: number[] = [];

    for (const [i, lineText] of lines.entries()) {
        const line = lineText.trim();

        if (line.startsWith("#region")) {
            regionStack.push(i);
        } else if (line.startsWith("#endregion")) {
            const startLine = regionStack.pop();
            if (startLine !== undefined && startLine < i) {
                foldingRanges.push({
                    startLine,
                    endLine: i,
                    kind: FoldingRangeKind.Region
                });
            }
        }

        if (line.includes("{")) {
            braceStack.push(i);
        }
        if (line.includes("}")) {
            const startLine = braceStack.pop();
            if (startLine !== undefined && startLine < i - 1) {
                foldingRanges.push({
                    startLine,
                    endLine: i
                });
            }
        }
    }

    return foldingRanges;
}
