import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import {
    type AstNodeWithType,
    createMeta,
    isAstNodeWithType,
    readObjectOption,
    resolveLocFromIndex,
    shouldReportUnsafe,
    walkAstNodes,
    walkAstNodesWithParent
} from "../rule-base-helpers.js";

const DEFAULT_HOIST_ACCESSORS = Object.freeze({
    array_length: "len"
});

type ForStatementContainerContext = Readonly<{
    forNode: AstNodeWithType;
    canInsertHoistBeforeLoop: boolean;
}>;

function collectLoopLengthAccessorCallsFromTestExpression(parameters: {
    sourceText: string;
    testNode: unknown;
    enabledFunctionNames: ReadonlySet<string>;
}) {
    return Core.collectLoopLengthAccessorCallsFromAstNode({
        sourceText: parameters.sourceText,
        rootNode: parameters.testNode,
        enabledFunctionNames: parameters.enabledFunctionNames
    });
}

function collectForStatementContainerContexts(programNode: unknown): ReadonlyArray<ForStatementContainerContext> {
    const contexts: Array<ForStatementContainerContext> = [];

    walkAstNodesWithParent(programNode, (visitContext) => {
        const { node, parent, parentKey } = visitContext;
        if (node.type !== "ForStatement") {
            return;
        }

        const canInsertHoistBeforeLoop =
            parent !== null && parentKey === "body" && (parent.type === "Program" || parent.type === "BlockStatement");

        contexts.push(
            Object.freeze({
                forNode: node,
                canInsertHoistBeforeLoop
            })
        );
    });

    return contexts;
}

export function createPreferHoistableLoopAccessorsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            const options = readObjectOption(context);
            const minOccurrences = typeof options.minOccurrences === "number" ? options.minOccurrences : 2;
            const functionSuffixes = options.functionSuffixes as Record<string, string | null> | undefined;
            const shouldReportUnsafeFixes = shouldReportUnsafe(context);
            const suffixMap = Core.resolveIdentifierKeyedSuffixMap(DEFAULT_HOIST_ACCESSORS, functionSuffixes);

            return Object.freeze({
                Program(programNode) {
                    const sourceText = context.sourceCode.text;
                    const loopNodes: Array<AstNodeWithType> = [];
                    walkAstNodes(programNode, (node) => {
                        if (!isAstNodeWithType(node)) {
                            return;
                        }

                        if (
                            node.type === "ForStatement" ||
                            node.type === "WhileStatement" ||
                            node.type === "RepeatStatement" ||
                            node.type === "DoUntilStatement"
                        ) {
                            loopNodes.push(node);
                        }
                    });
                    const forStatementContexts = collectForStatementContainerContexts(programNode);
                    const forStatementContextByNode = new Map<AstNodeWithType, ForStatementContainerContext>(
                        forStatementContexts.map((loopContext) => [loopContext.forNode, loopContext])
                    );
                    const enabledHoistFunctionNames = new Set(suffixMap.keys());

                    let firstReportOffset: number | null = null;
                    let firstUnsafeOffset: number | null = null;
                    for (const loopNode of loopNodes) {
                        if (loopNode.type === "ForStatement" && enabledHoistFunctionNames.size > 0) {
                            const testCalls = collectLoopLengthAccessorCallsFromTestExpression({
                                sourceText,
                                testNode: (loopNode as any).test,
                                enabledFunctionNames: enabledHoistFunctionNames
                            });

                            if (testCalls.length > 0) {
                                const firstTestCallOffset = testCalls[0]?.callStart;
                                if (
                                    typeof firstTestCallOffset === "number" &&
                                    (firstReportOffset === null || firstTestCallOffset < firstReportOffset)
                                ) {
                                    firstReportOffset = firstTestCallOffset;
                                }

                                const forContext = forStatementContextByNode.get(loopNode);
                                if (forContext && !forContext.canInsertHoistBeforeLoop) {
                                    const forStart = Core.getNodeStartIndex(loopNode);
                                    if (
                                        typeof forStart === "number" &&
                                        (firstUnsafeOffset === null || forStart < firstUnsafeOffset)
                                    ) {
                                        firstUnsafeOffset = forStart;
                                    }
                                }

                                continue;
                            }
                        }

                        const loopCalls = Core.collectLoopLengthAccessorCallsFromAstNode({
                            sourceText,
                            rootNode: loopNode,
                            enabledFunctionNames: new Set(["array_length"])
                        });
                        if (loopCalls.length === 0) {
                            continue;
                        }

                        if (loopNode.type === "ForStatement") {
                            const testCalls = Core.collectLoopLengthAccessorCallsFromAstNode({
                                sourceText,
                                rootNode: (loopNode as any).test,
                                enabledFunctionNames: new Set(["array_length"])
                            });
                            if (testCalls.length > 0) {
                                continue;
                            }
                        }

                        const groupedByAccessor = new Map<string, { count: number; firstOffset: number }>();
                        for (const call of loopCalls) {
                            const existing = groupedByAccessor.get(call.callText);
                            if (existing) {
                                existing.count += 1;
                                continue;
                            }

                            groupedByAccessor.set(call.callText, {
                                count: 1,
                                firstOffset: call.callStart
                            });
                        }

                        for (const group of groupedByAccessor.values()) {
                            if (group.count < minOccurrences) {
                                continue;
                            }

                            if (firstReportOffset === null || group.firstOffset < firstReportOffset) {
                                firstReportOffset = group.firstOffset;
                            }
                        }
                    }

                    if (firstReportOffset !== null) {
                        context.report({
                            loc: resolveLocFromIndex(context, sourceText, firstReportOffset),
                            messageId: definition.messageId
                        });
                    }

                    if (firstUnsafeOffset !== null && shouldReportUnsafeFixes) {
                        context.report({
                            loc: resolveLocFromIndex(context, sourceText, firstUnsafeOffset),
                            messageId: "unsafeFix"
                        });
                    }
                }
            });
        }
    });
}
