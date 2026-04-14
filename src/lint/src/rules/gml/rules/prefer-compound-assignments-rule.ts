import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import {
    type AstNodeRecord,
    containsCommentToken,
    createMeta,
    type IdentifierNode,
    isAssignmentExpressionNodeWithOperator,
    isAstNodeRecord,
    isIdentifierNode,
    walkAstNodes
} from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";

type SupportedArithmeticOperator = "+" | "-" | "*" | "/" | "%";
type SupportedBitwiseOperator = "|" | "&" | "^";
type SupportedShiftOperator = "<<" | ">>";
type SupportedNullishOperator = "??";
type SupportedBinaryOperator =
    | SupportedArithmeticOperator
    | SupportedBitwiseOperator
    | SupportedShiftOperator
    | SupportedNullishOperator;
type CompoundAssignmentOperator = "+=" | "-=" | "*=" | "/=" | "%=" | "|=" | "&=" | "^=" | "<<=" | ">>=" | "??=";

type BinaryExpressionNode = AstNodeRecord &
    Readonly<{
        type: "BinaryExpression";
        operator: SupportedBinaryOperator;
        left: unknown;
        right: unknown;
    }>;

type AssignmentExpressionNode = AstNodeRecord &
    Readonly<{
        type: "AssignmentExpression";
        operator: "=";
        left: unknown;
        right: unknown;
    }>;

type CompoundAssignmentCandidate = Readonly<{
    assignmentExpression: AssignmentExpressionNode;
    leftIdentifier: IdentifierNode;
    rightBinaryExpression: BinaryExpressionNode;
    rightOperand: AstNodeRecord;
    compoundOperator: CompoundAssignmentOperator;
}>;

type UnwrapParenthesizedExpressionInput = Parameters<typeof Core.unwrapParenthesizedExpression>[0];

const COMPOUND_OPERATOR_BY_BINARY_OPERATOR = Object.freeze({
    "+": "+=",
    "-": "-=",
    "*": "*=",
    "/": "/=",
    "%": "%=",
    "|": "|=",
    "&": "&=",
    "^": "^=",
    "<<": "<<=",
    ">>": ">>=",
    "??": "??="
} as const satisfies Readonly<Record<SupportedBinaryOperator, CompoundAssignmentOperator>>);

function isSupportedBinaryOperator(operator: unknown): operator is SupportedBinaryOperator {
    return (
        operator === "+" ||
        operator === "-" ||
        operator === "*" ||
        operator === "/" ||
        operator === "%" ||
        operator === "|" ||
        operator === "&" ||
        operator === "^" ||
        operator === "<<" ||
        operator === ">>" ||
        operator === "??"
    );
}

function isBinaryExpressionNode(node: unknown): node is BinaryExpressionNode {
    return (
        isAstNodeRecord(node) &&
        node.type === "BinaryExpression" &&
        isSupportedBinaryOperator(node.operator) &&
        Object.hasOwn(node, "left") &&
        Object.hasOwn(node, "right")
    );
}

function isAssignmentExpressionNode(node: unknown): node is AssignmentExpressionNode {
    return isAssignmentExpressionNodeWithOperator(node, (operator): operator is "=" => operator === "=");
}

function tryGetCompoundAssignmentCandidate(node: unknown): CompoundAssignmentCandidate | null {
    if (!isAssignmentExpressionNode(node)) {
        return null;
    }

    if (!isIdentifierNode(node.left)) {
        return null;
    }

    const rightExpressionNode = Core.unwrapParenthesizedExpression(node.right as UnwrapParenthesizedExpressionInput);
    if (!isBinaryExpressionNode(rightExpressionNode)) {
        return null;
    }

    const rightLeftNode = Core.unwrapParenthesizedExpression(
        rightExpressionNode.left as UnwrapParenthesizedExpressionInput
    );

    // Left-first pattern: x = x OP y → x OP= y
    if (isIdentifierNode(rightLeftNode) && rightLeftNode.name === node.left.name) {
        if (!isAstNodeRecord(rightExpressionNode.right)) {
            return null;
        }
        return Object.freeze({
            assignmentExpression: node,
            leftIdentifier: node.left,
            rightBinaryExpression: rightExpressionNode,
            rightOperand: rightExpressionNode.right,
            compoundOperator: COMPOUND_OPERATOR_BY_BINARY_OPERATOR[rightExpressionNode.operator]
        });
    }

    // Right-first pattern for commutative operators: x = y + x → x += y, x = y * x → x *= y.
    // Commutative: `+`, `*`, `|`, `&`, `^`. Non-commutative: `-`, `/`, `%`, `<<`, `>>`, `??`.
    const isCommutativeOperator =
        rightExpressionNode.operator === "+" ||
        rightExpressionNode.operator === "*" ||
        rightExpressionNode.operator === "|" ||
        rightExpressionNode.operator === "&" ||
        rightExpressionNode.operator === "^";
    if (!isCommutativeOperator) {
        return null;
    }

    const rightRightNode = Core.unwrapParenthesizedExpression(
        rightExpressionNode.right as UnwrapParenthesizedExpressionInput
    );
    if (!isIdentifierNode(rightRightNode) || rightRightNode.name !== node.left.name) {
        return null;
    }

    if (!isAstNodeRecord(rightExpressionNode.left)) {
        return null;
    }

    return Object.freeze({
        assignmentExpression: node,
        leftIdentifier: node.left,
        rightBinaryExpression: rightExpressionNode,
        // The variable appears on the right; use the left operand as the compound right-hand side.
        rightOperand: rightExpressionNode.left,
        compoundOperator: COMPOUND_OPERATOR_BY_BINARY_OPERATOR[rightExpressionNode.operator]
    });
}

/**
 * Creates the `gml/prefer-compound-assignments` rule.
 *
 * Reports and auto-fixes safe self-assignment patterns:
 * `x = x + y`, `x = x - y`, `x = x * y`, `x = x / y`, `x = x % y`,
 * `x = x | y`, `x = x & y`, `x = x ^ y`, `x = x << y`, `x = x >> y`,
 * and `x = x ?? y`.
 */
export function createPreferCompoundAssignmentsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program(programNode) {
                    const sourceText = context.sourceCode.text;

                    walkAstNodes(programNode, (candidateNode) => {
                        const candidate = tryGetCompoundAssignmentCandidate(candidateNode);
                        if (!candidate) {
                            return;
                        }

                        const assignmentStart = Core.getNodeStartIndex(candidate.assignmentExpression);
                        const assignmentEnd = Core.getNodeEndIndex(candidate.assignmentExpression);
                        const leftStart = Core.getNodeStartIndex(candidate.leftIdentifier);
                        const leftEnd = Core.getNodeEndIndex(candidate.leftIdentifier);
                        const rightExpressionStart = Core.getNodeStartIndex(candidate.rightBinaryExpression);
                        const rightExpressionEnd = Core.getNodeEndIndex(candidate.rightBinaryExpression);
                        const rightOperandStart = Core.getNodeStartIndex(candidate.rightOperand);
                        const rightOperandEnd = Core.getNodeEndIndex(candidate.rightOperand);

                        if (
                            typeof assignmentStart !== "number" ||
                            typeof assignmentEnd !== "number" ||
                            typeof leftStart !== "number" ||
                            typeof leftEnd !== "number" ||
                            typeof rightExpressionStart !== "number" ||
                            typeof rightExpressionEnd !== "number" ||
                            typeof rightOperandStart !== "number" ||
                            typeof rightOperandEnd !== "number"
                        ) {
                            return;
                        }

                        const rightExpressionText = sourceText.slice(rightExpressionStart, rightExpressionEnd);
                        if (containsCommentToken(rightExpressionText)) {
                            return;
                        }

                        const leftText = sourceText.slice(leftStart, leftEnd);
                        const rightOperandText = sourceText.slice(rightOperandStart, rightOperandEnd);
                        const rewrittenAssignment = `${leftText} ${candidate.compoundOperator} ${rightOperandText}`;

                        context.report({
                            node: candidate.assignmentExpression,
                            messageId: definition.messageId,
                            fix: (fixer) =>
                                fixer.replaceTextRange([assignmentStart, assignmentEnd], rewrittenAssignment)
                        });
                    });
                }
            });
        }
    });
}
