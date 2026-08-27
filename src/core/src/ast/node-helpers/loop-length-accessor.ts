import { getNodeEndIndex, getNodeStartIndex } from "../locations.js";
import { traverseAst } from "../object-graph.js";
import type { GameMakerAstNode } from "../types.js";

/**
 * A single occurrence of a loop-length accessor call (e.g. `array_length(arr)`)
 * found inside a subtree of the AST.
 */
export type LoopLengthAccessorCall = Readonly<{
    functionName: string;
    callStart: number;
    callEnd: number;
    callText: string;
}>;

/**
 * Walks `rootNode` and returns every `CallExpression` whose callee name is
 * contained in `enabledFunctionNames`.
 *
 * Used by both the `prefer-hoistable-loop-accessors` lint rule and the
 * `loop-length-hoisting` codemod to locate hoistable accessor calls.
 */
export function collectLoopLengthAccessorCallsFromAstNode(parameters: {
    sourceText: string;
    rootNode: unknown;
    enabledFunctionNames: ReadonlySet<string>;
}): ReadonlyArray<LoopLengthAccessorCall> {
    const collectedCalls: Array<LoopLengthAccessorCall> = [];

    traverseAst(parameters.rootNode, {
        enter(node) {
            if (node.type !== "CallExpression") {
                return;
            }

            const callTarget = node.object;
            if (
                !callTarget ||
                typeof callTarget !== "object" ||
                (callTarget as { type?: unknown }).type !== "Identifier" ||
                typeof (callTarget as { name?: unknown }).name !== "string"
            ) {
                return;
            }
            const functionName = (callTarget as { name: string }).name;
            if (!parameters.enabledFunctionNames.has(functionName)) {
                return;
            }

            const start = getNodeStartIndex(node);
            const end = getNodeEndIndex(node);
            if (typeof start !== "number" || typeof end !== "number") {
                return;
            }

            collectedCalls.push(
                Object.freeze({
                    functionName,
                    callStart: start,
                    callEnd: end,
                    callText: parameters.sourceText.slice(start, end)
                })
            );
        }
    });

    return collectedCalls;
}

/**
 * A `ForStatement` found while scanning for hoistable loop-length accessors,
 * together with whether a hoisted declaration can be safely inserted
 * immediately before it (its parent must be a `Program` or `BlockStatement`
 * body, so inserting a preceding sibling statement cannot land inside an
 * unrelated single-statement clause, e.g. an `if` branch without braces).
 *
 * Used by both the `prefer-hoistable-loop-accessors` lint rule and the
 * `loop-length-hoisting` codemod so the insertion-safety check stays in one
 * place instead of being reimplemented per workspace.
 */
export type ForStatementHoistContext = Readonly<{
    forNode: GameMakerAstNode;
    canInsertHoistBeforeLoop: boolean;
}>;

/**
 * Walks `rootNode` and returns every `ForStatement` along with whether a
 * hoisted accessor declaration can be safely inserted directly before it.
 */
export function collectForStatementHoistContexts(rootNode: unknown): ReadonlyArray<ForStatementHoistContext> {
    const contexts: Array<ForStatementHoistContext> = [];

    traverseAst(rootNode, {
        enter(node, context) {
            if (node.type !== "ForStatement") {
                return;
            }

            const canInsertHoistBeforeLoop =
                context.parent !== null &&
                context.key === "body" &&
                (context.parent.type === "Program" || context.parent.type === "BlockStatement");

            contexts.push(
                Object.freeze({
                    forNode: node,
                    canInsertHoistBeforeLoop
                })
            );
        }
    });

    return contexts;
}
