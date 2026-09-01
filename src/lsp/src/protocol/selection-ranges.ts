import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";
import { type Position, type SelectionRange } from "vscode-languageserver/node.js";

import { type GmlTextDocument, offsetToPosition, positionToOffset } from "../documents/index.js";

type AstOffsetContainer = Readonly<{
    index?: unknown;
}>;

function readAstOffset(value: unknown): number | null {
    if (typeof value === "number") {
        return value;
    }
    if (!Core.isObjectLike(value)) {
        return null;
    }

    const container = value as AstOffsetContainer;
    return typeof container.index === "number" ? container.index : null;
}

function readAstNodeRange(node: unknown): { end: number; start: number } | null {
    if (!Core.isObjectLike(node)) {
        return null;
    }

    const record = node as Readonly<Record<string, unknown>>;
    const start = readAstOffset(record.start);
    const end = readAstOffset(record.end);

    return start !== null && end !== null ? { start, end } : null;
}

function createSelectionRangeChain(document: GmlTextDocument, nodes: ReadonlyArray<unknown>): SelectionRange | null {
    let currentRange: SelectionRange | undefined;
    for (const node of nodes) {
        const range = readAstNodeRange(node);
        if (range) {
            currentRange = {
                range: {
                    start: offsetToPosition(document, range.start),
                    end: offsetToPosition(document, range.end)
                },
                parent: currentRange
            };
        }
    }

    return currentRange ?? null;
}

function findAstNodePathAtOffset(rootNode: unknown, offset: number): unknown[] {
    const nodePath: unknown[] = [];

    Core.traverseAst(rootNode, {
        enter(node) {
            const range = readAstNodeRange(node);
            if (!range || offset < range.start || offset > range.end) {
                return false;
            }

            nodePath.push(node);
            return true;
        }
    });

    return nodePath;
}

/**
 * Create semantic LSP selection ranges from the parsed GML AST.
 */
export function createGmlSelectionRanges(
    document: GmlTextDocument,
    positions: ReadonlyArray<Position>
): SelectionRange[] {
    let ast: unknown;
    try {
        ast = Parser.GMLParser.parse(document.sourceText);
    } catch {
        return [];
    }

    return positions.map((position) => {
        const offset = positionToOffset(document, position);
        const nodePath = findAstNodePathAtOffset(ast, offset);
        return createSelectionRangeChain(document, nodePath) ?? { range: { start: position, end: position } };
    });
}
