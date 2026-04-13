import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";

import type {
    LoopLengthHoistingCodemodOptions,
    LoopLengthHoistingCodemodResult,
    LoopLengthHoistingEdit
} from "./types.js";

const DEFAULT_HOIST_ACCESSORS = Object.freeze({
    array_length: "len"
});

type ForStatementContainerContext = Readonly<{
    forNode: Record<string, unknown>;
    canInsertHoistBeforeLoop: boolean;
}>;

/**
 * Result of the combined single-pass AST data collection.
 * Both identifier names and for-statement contexts are gathered
 * in one traversal instead of two separate walks.
 */
type AstDataCollection = {
    /** All identifier names found anywhere in the AST (mutable, callers may add hoisted names). */
    identifierNames: Set<string>;
    /** For-statement container contexts with hoistability flags. */
    forStatementContexts: ReadonlyArray<ForStatementContainerContext>;
};

type LoopLengthHoistRewrite = Readonly<{
    insertionOffset: number;
    insertionText: string;
    callRewrites: ReadonlyArray<LoopLengthHoistingEdit>;
    reportOffset: number;
}>;

function getLineStartOffset(sourceText: string, offset: number): number {
    return sourceText.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

function getLineIndentationAtOffset(sourceText: string, offset: number): string {
    const lineStart = getLineStartOffset(sourceText, offset);
    let cursor = lineStart;
    while (cursor < sourceText.length && (sourceText[cursor] === " " || sourceText[cursor] === "\t")) {
        cursor += 1;
    }

    return sourceText.slice(lineStart, cursor);
}

/**
 * Collect both identifier names and for-statement container contexts from the
 * AST in a **single recursive pass**, replacing the previous two-pass approach
 * (`collectIdentifierNamesInSubtree` via `Core.walkAst` + a separate
 * `collectForStatementContainerContexts` traversal).
 *
 * For files with many identifiers this halves the number of AST node visits,
 * which is measurable when processing hundreds of GML files in one codemod run.
 */
function collectAstData(programNode: unknown): AstDataCollection {
    const identifierNames = new Set<string>();
    const contexts: Array<ForStatementContainerContext> = [];

    const visitValue = (value: unknown, canInsertHoistBeforeLoop: boolean): void => {
        if (!value || typeof value !== "object") {
            return;
        }

        if (Array.isArray(value)) {
            for (const entry of value) {
                visitValue(entry, false);
            }

            return;
        }

        const node = value as Record<string, unknown>;

        // Collect identifier names in the same traversal pass.
        if (node.type === "Identifier" && typeof node.name === "string") {
            identifierNames.add(node.name);
        }

        if (node.type === "ForStatement") {
            contexts.push(
                Object.freeze({
                    forNode: node,
                    canInsertHoistBeforeLoop
                })
            );
        }

        for (const [propertyName, propertyValue] of Object.entries(node)) {
            if (
                propertyName === "body" &&
                Array.isArray(propertyValue) &&
                (node.type === "Program" || node.type === "BlockStatement")
            ) {
                for (const statement of propertyValue) {
                    visitValue(statement, true);
                }

                continue;
            }

            visitValue(propertyValue, false);
        }
    };

    visitValue(programNode, false);
    return { identifierNames, forStatementContexts: contexts };
}

function resolveLoopLengthHoistIdentifierName(
    preferredName: string,
    inScopeIdentifierNames: ReadonlySet<string>
): string | null {
    if (!Core.GML_IDENTIFIER_NAME_PATTERN.test(preferredName)) {
        return null;
    }

    if (!inScopeIdentifierNames.has(preferredName)) {
        return preferredName;
    }

    let suffix = 2;
    while (suffix < Number.MAX_SAFE_INTEGER) {
        const candidateName = `${preferredName}${String(suffix)}`;
        if (!inScopeIdentifierNames.has(candidateName)) {
            return candidateName;
        }

        suffix += 1;
    }

    return null;
}

function createLoopLengthHoistRewrite(parameters: {
    sourceText: string;
    loopContext: ForStatementContainerContext;
    suffixMap: ReadonlyMap<string, string>;
    localIdentifierNames: ReadonlySet<string>;
    lineEnding: string;
}): LoopLengthHoistRewrite | null {
    const { forNode, canInsertHoistBeforeLoop } = parameters.loopContext;
    if (!canInsertHoistBeforeLoop) {
        return null;
    }

    const accessorCalls = Core.collectLoopLengthAccessorCallsFromAstNode({
        sourceText: parameters.sourceText,
        rootNode: forNode.test,
        enabledFunctionNames: new Set(parameters.suffixMap.keys())
    });

    if (accessorCalls.length === 0) {
        return null;
    }

    const firstCall = accessorCalls[0];
    const preferredSuffix = parameters.suffixMap.get(firstCall.functionName) ?? "len";
    const hoistedName = resolveLoopLengthHoistIdentifierName(preferredSuffix, parameters.localIdentifierNames);
    if (!hoistedName) {
        return null;
    }

    const forNodeStart = Core.getNodeStartIndex(forNode);
    const insertionOffset = typeof forNodeStart === "number" ? forNodeStart : 0;
    const indentation = getLineIndentationAtOffset(parameters.sourceText, insertionOffset);
    const insertionText = `var ${hoistedName} = ${firstCall.callText};${parameters.lineEnding}${indentation}`;

    const callRewrites = accessorCalls
        .filter((call) => call.functionName === firstCall.functionName && call.callText === firstCall.callText)
        .map((call) =>
            Object.freeze({
                start: call.callStart,
                end: call.callEnd,
                text: hoistedName
            })
        );

    return Object.freeze({
        insertionOffset,
        insertionText,
        callRewrites,
        reportOffset: firstCall.callStart
    });
}

/**
 * Apply a list of non-overlapping edits to `sourceText` using a left-to-right
 * string builder.  Edits are sorted in **ascending** order so the result is
 * assembled in a single forward pass without intermediate string copies,
 * matching the same pattern used by `applyGroupedTextEditsToContent` in the
 * refactor engine.
 */
function applySourceTextEdits(sourceText: string, edits: ReadonlyArray<LoopLengthHoistingEdit>): string {
    if (edits.length === 0) {
        return sourceText;
    }

    const sorted = [...edits].toSorted((left, right) => left.start - right.start || left.end - right.end);
    let result = "";
    let cursor = 0;

    for (const edit of sorted) {
        result += sourceText.slice(cursor, edit.start);
        result += edit.text;
        cursor = edit.end;
    }

    result += sourceText.slice(cursor);
    return result;
}

/**
 * Applies the loop-length hoisting codemod to a single GML source file.
 *
 * The codemod rewrites `for` loop tests that repeatedly call configured
 * length accessors (for example `array_length(items)`) by inserting a cached
 * local variable before the loop and replacing test-call sites with that
 * cached identifier.
 */
export function applyLoopLengthHoistingCodemod(
    sourceText: string,
    options: LoopLengthHoistingCodemodOptions = {}
): LoopLengthHoistingCodemodResult {
    if (!Core.isNonEmptyString(sourceText)) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([]),
            diagnosticOffsets: Object.freeze([])
        });
    }

    const suffixMap = Core.resolveIdentifierKeyedSuffixMap(DEFAULT_HOIST_ACCESSORS, options.functionSuffixes);
    if (suffixMap.size === 0) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([]),
            diagnosticOffsets: Object.freeze([])
        });
    }

    let ast: unknown;
    try {
        ast = Parser.GMLParser.parse(sourceText);
    } catch {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([]),
            diagnosticOffsets: Object.freeze([])
        });
    }

    // Collect identifier names and for-statement contexts in a single AST pass
    // instead of two separate traversals, cutting per-file node visits in half.
    // The returned `identifierNames` set is mutable and accumulates hoisted
    // variable names as loops are processed, preventing naming conflicts.
    const { identifierNames, forStatementContexts: loopContexts } = collectAstData(ast);
    const lineEnding = Core.dominantLineEnding(sourceText);

    const edits: Array<LoopLengthHoistingEdit> = [];
    const diagnosticOffsets: Array<number> = [];

    for (const loopContext of loopContexts) {
        const rewrite = createLoopLengthHoistRewrite({
            sourceText,
            loopContext,
            suffixMap,
            localIdentifierNames: identifierNames,
            lineEnding
        });

        if (!rewrite) {
            continue;
        }

        edits.push(
            Object.freeze({
                start: rewrite.insertionOffset,
                end: rewrite.insertionOffset,
                text: rewrite.insertionText
            }),
            ...rewrite.callRewrites
        );

        const hoistedIdentifierName = rewrite.callRewrites[0]?.text;
        if (Core.isNonEmptyString(hoistedIdentifierName)) {
            identifierNames.add(hoistedIdentifierName);
        }
        diagnosticOffsets.push(rewrite.reportOffset);
    }

    const outputText = applySourceTextEdits(sourceText, edits);
    return Object.freeze({
        changed: outputText !== sourceText,
        outputText,
        appliedEdits: Object.freeze(edits),
        diagnosticOffsets: Object.freeze(diagnosticOffsets)
    });
}
