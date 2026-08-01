import { getNodeEndIndex, getNodeStartIndex } from "../locations.js";
import { traverseAst } from "../object-graph.js";

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
