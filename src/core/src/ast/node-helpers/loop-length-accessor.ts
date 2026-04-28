import { getNodeEndIndex, getNodeStartIndex } from "../locations.js";
import { walkAst } from "../object-graph.js";

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

    walkAst(parameters.rootNode, (node) => {
        if (node?.type !== "CallExpression") {
            return;
        }

        const callTarget = node.object;
        if (
            !callTarget ||
            callTarget.type !== "Identifier" ||
            typeof callTarget.name !== "string" ||
            !parameters.enabledFunctionNames.has(callTarget.name)
        ) {
            return;
        }

        const start = getNodeStartIndex(node);
        const end = getNodeEndIndex(node);
        if (typeof start !== "number" || typeof end !== "number") {
            return;
        }

        collectedCalls.push(
            Object.freeze({
                functionName: callTarget.name,
                callStart: start,
                callEnd: end,
                callText: parameters.sourceText.slice(start, end)
            })
        );
    });

    return collectedCalls;
}
