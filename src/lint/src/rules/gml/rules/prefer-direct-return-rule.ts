import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import {
    type AstNodeRecord,
    type AstNodeWithType,
    createMeta,
    findFirstAstNodeBy,
    getLineStartOffset,
    isAstNodeRecord,
    isAstNodeWithType,
    isIdentifierNode,
    walkAstNodesWithParent
} from "../rule-base-helpers.js";

type VariableDeclaratorNode = AstNodeRecord &
    Readonly<{
        type: "VariableDeclarator";
        id: unknown;
        init: unknown;
    }>;

type VariableDeclarationNode = AstNodeRecord &
    Readonly<{
        type: "VariableDeclaration";
        kind: string;
        declarations: ReadonlyArray<unknown>;
    }>;

type ReturnStatementNode = AstNodeRecord &
    Readonly<{
        type: "ReturnStatement";
        argument: unknown;
    }>;

type BodyContainerNode = AstNodeWithType &
    Readonly<{
        body: ReadonlyArray<unknown>;
    }>;

type DirectReturnCandidate = Readonly<{
    reportNode: VariableDeclarationNode;
    replacementStart: number;
    replacementEnd: number;
    replacementText: string;
}>;

function isVariableDeclaratorNode(node: unknown): node is VariableDeclaratorNode {
    return (
        isAstNodeRecord(node) &&
        node.type === "VariableDeclarator" &&
        Object.hasOwn(node, "id") &&
        Object.hasOwn(node, "init")
    );
}

function isVariableDeclarationNode(node: unknown): node is VariableDeclarationNode {
    return (
        isAstNodeRecord(node) &&
        node.type === "VariableDeclaration" &&
        typeof node.kind === "string" &&
        Array.isArray(node.declarations)
    );
}

function isReturnStatementNode(node: unknown): node is ReturnStatementNode {
    return isAstNodeRecord(node) && node.type === "ReturnStatement" && Object.hasOwn(node, "argument");
}

function isBodyContainerNode(node: unknown): node is BodyContainerNode {
    return (
        isAstNodeWithType(node) &&
        Array.isArray(node.body) &&
        (node.type === "Program" || node.type === "BlockStatement")
    );
}

function containsCommentToken(sourceText: string): boolean {
    return sourceText.includes("//") || sourceText.includes("/*") || sourceText.includes("*/");
}

function containsCommentOutsideInitializer(
    sourceText: string,
    replacementStart: number,
    initializerStart: number,
    initializerEnd: number,
    nextStatementStart: number,
    returnEnd: number,
    commentDetectionEnd: number
): boolean {
    const declarationPrefix = sourceText.slice(replacementStart, initializerStart);
    const betweenInitializerAndReturn = sourceText.slice(initializerEnd, nextStatementStart);
    const returnSuffix = sourceText.slice(returnEnd, commentDetectionEnd);

    return (
        containsCommentToken(declarationPrefix) ||
        containsCommentToken(betweenInitializerAndReturn) ||
        containsCommentToken(returnSuffix)
    );
}

function findLineEndOffset(sourceText: string, offset: number): number {
    const start = Math.max(0, offset);
    const relativePos = sourceText.slice(start).search(/[\r\n]/u);
    return relativePos === -1 ? sourceText.length : start + relativePos;
}

function readStatementReplacementEndOffset(sourceText: string, statementEndOffset: number): number {
    const start = Math.max(0, statementEndOffset);
    const match = /^[ \t]*;?[ \t]*/u.exec(sourceText.slice(start));
    return start + (match?.[0].length ?? 0);
}

function declarationInitializerReferencesIdentifier(initializerNode: unknown, identifierName: string): boolean {
    return (
        findFirstAstNodeBy(initializerNode, (node) => isIdentifierNode(node) && node.name === identifierName) !== null
    );
}

function readSingleDeclarator(variableDeclarationNode: VariableDeclarationNode): VariableDeclaratorNode | null {
    if (variableDeclarationNode.declarations.length !== 1) {
        return null;
    }

    const [declarator] = variableDeclarationNode.declarations;
    if (!isVariableDeclaratorNode(declarator)) {
        return null;
    }

    return declarator;
}

function buildDirectReturnCandidate(
    sourceText: string,
    variableDeclarationNode: VariableDeclarationNode,
    bodyContainerNode: BodyContainerNode,
    declarationIndex: number
): DirectReturnCandidate | null {
    if (Core.toNormalizedLowerCaseString(variableDeclarationNode.kind) !== "var") {
        return null;
    }

    const declarator = readSingleDeclarator(variableDeclarationNode);
    if (!declarator || !isIdentifierNode(declarator.id) || !isAstNodeRecord(declarator.init)) {
        return null;
    }

    const nextStatement = bodyContainerNode.body[declarationIndex + 1];
    if (!isReturnStatementNode(nextStatement) || !isIdentifierNode(nextStatement.argument)) {
        return null;
    }

    if (nextStatement.argument.name !== declarator.id.name) {
        return null;
    }

    if (declarationInitializerReferencesIdentifier(declarator.init, declarator.id.name)) {
        return null;
    }

    const declarationStart = Core.getNodeStartIndex(variableDeclarationNode);
    const nextStatementStart = Core.getNodeStartIndex(nextStatement);
    const returnEnd = Core.getNodeEndIndex(nextStatement);
    const initializerStart = Core.getNodeStartIndex(declarator.init);
    const initializerEnd = Core.getNodeEndIndex(declarator.init);
    if (
        typeof declarationStart !== "number" ||
        typeof nextStatementStart !== "number" ||
        typeof returnEnd !== "number" ||
        typeof initializerStart !== "number" ||
        typeof initializerEnd !== "number"
    ) {
        return null;
    }

    const declarationLineStart = getLineStartOffset(sourceText, declarationStart);
    const declarationLinePrefix = sourceText.slice(declarationLineStart, declarationStart);
    const canReplaceFromLineStart = /^[\t ]*$/u.test(declarationLinePrefix);
    const replacementStart = canReplaceFromLineStart ? declarationLineStart : declarationStart;
    const replacementEnd = readStatementReplacementEndOffset(sourceText, returnEnd);

    const commentDetectionEnd = findLineEndOffset(sourceText, replacementEnd);
    if (
        containsCommentOutsideInitializer(
            sourceText,
            replacementStart,
            initializerStart,
            initializerEnd,
            nextStatementStart,
            returnEnd,
            commentDetectionEnd
        )
    ) {
        return null;
    }

    const initializerText = sourceText.slice(initializerStart, initializerEnd);
    return Object.freeze({
        reportNode: variableDeclarationNode,
        replacementStart,
        replacementEnd,
        replacementText: `${canReplaceFromLineStart ? declarationLinePrefix : ""}return ${initializerText};`
    });
}

/**
 * Creates the `gml/prefer-direct-return` rule.
 *
 * Reports and auto-fixes adjacent patterns like:
 * `var value = expression; return value;`
 * into:
 * `return expression;`
 */
export function createPreferDirectReturnRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program(programNode) {
                    const sourceText = context.sourceCode.text;

                    walkAstNodesWithParent(programNode, (visitContext) => {
                        const { node, parent, parentKey, parentIndex } = visitContext;
                        if (!isVariableDeclarationNode(node)) {
                            return;
                        }

                        if (!isBodyContainerNode(parent) || parentKey !== "body" || typeof parentIndex !== "number") {
                            return;
                        }

                        const candidate = buildDirectReturnCandidate(sourceText, node, parent, parentIndex);
                        if (!candidate) {
                            return;
                        }

                        context.report({
                            node: candidate.reportNode,
                            messageId: definition.messageId,
                            fix: (fixer) =>
                                fixer.replaceTextRange(
                                    [candidate.replacementStart, candidate.replacementEnd],
                                    candidate.replacementText
                                )
                        });
                    });
                }
            });
        }
    });
}
