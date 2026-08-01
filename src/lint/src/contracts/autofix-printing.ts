/**
 * JavaScript string rendering for lint autofix output.
 *
 * PURPOSE: Renders AST nodes back to GML source text for rule-level autofixes.
 * This is an output-only concern — it performs only the minimal precedence
 * preservation needed to keep synthesized autofixes semantically faithful.
 * Full layout formatting belongs in `@gmloop/format`.
 *
 * ARCHITECTURAL BOUNDARY: This module is intentionally isolated in `src/contracts/`
 * (a directory that holds cross-cutting public APIs for the lint workspace) so
 * that:
 *   1. The printing contract is discoverable as a first-class artifact.
 *   2. Consumers can depend on this stable re-export surface without reaching
 *      into the `language/` subdirectory.
 *   3. Any future refactoring of the underlying printing logic only requires
 *      updating the re-export here, not every call site.
 *
 * The original location was `src/lint/src/language/autofix-printing.ts`. Moving
 * it here better reflects its role as a **published contract** rather than an
 * internal language-layer helper. (target-state.md §2.4, "Lint owns rules.")
 *
 * USAGE:
 *   import { printExpression, printNodeForAutofix, readNodeText } from "@gmloop/lint";
 *   // or for granular control:
 *   import { gmlRuleAutofixServices } from "@gmloop/lint/src/rules/gml/gml-rule-services.js";
 */

import { Core, isMemberAccessor } from "@gmloop/core";

function shouldParenthesizeBinaryChild(parent: any, child: any, side: "left" | "right"): boolean {
    if (!child || typeof child !== "object") {
        return false;
    }

    const unwrappedChild = Core.unwrapParenthesizedExpression(child);
    if (
        !unwrappedChild ||
        (unwrappedChild.type !== "BinaryExpression" && unwrappedChild.type !== "LogicalExpression") ||
        typeof unwrappedChild.operator !== "string"
    ) {
        return false;
    }

    const parentOperator = typeof parent.operator === "string" ? parent.operator : "";
    const childOperator = unwrappedChild.operator;
    const parentInfo = Core.getOperatorInfo(parentOperator);
    const childInfo = Core.getOperatorInfo(childOperator);
    if (!parentInfo || !childInfo) {
        return false;
    }

    if (childInfo.prec < parentInfo.prec) {
        return true;
    }

    if (childInfo.prec > parentInfo.prec) {
        return false;
    }

    if (side === "left") {
        return parentInfo.assoc === "right";
    }

    return parentInfo.assoc === "left";
}

function shouldParenthesizeUnaryArgument(argument: any): boolean {
    if (!argument || typeof argument !== "object") {
        return false;
    }

    switch (argument.type) {
        case "BinaryExpression":
        case "LogicalExpression":
        case "ConditionalExpression":
        case "AssignmentExpression": {
            return true;
        }
        default: {
            return false;
        }
    }
}

function shouldParenthesizeNestedTernaryBranch(branchNode: unknown): boolean {
    const unwrappedBranch = Core.unwrapParenthesizedExpression(branchNode);
    if (!Core.isNode(unwrappedBranch)) {
        return false;
    }

    return Core.isConditionalExpressionNode(unwrappedBranch) || Core.isTernaryExpressionNode(unwrappedBranch);
}

/**
 * Renders a binary or logical expression by recursively printing its left and
 * right children and joining them with the operator. Children whose operator
 * has weaker precedence than the parent are wrapped in parentheses to keep the
 * textual representation faithful to the AST structure.
 *
 * Extracted so the `BinaryExpression` and `LogicalExpression` cases share an
 * identical rendering path — the parser produces both node kinds for operators
 * that share the same precedence/lattice rules, and the printed output is
 * determined entirely by the operator string and child expressions, not by
 * the AST node kind.
 */
function printBinaryLikeExpression(node: any, sourceText: string): string {
    const leftPrinted = printExpression(node.left, sourceText);
    const rightPrinted = printExpression(node.right, sourceText);
    const left = shouldParenthesizeBinaryChild(node, node.left, "left") ? `(${leftPrinted})` : leftPrinted;
    const right = shouldParenthesizeBinaryChild(node, node.right, "right") ? `(${rightPrinted})` : rightPrinted;
    return `${left} ${node.operator} ${right}`;
}

/**
 * Reads the original source text associated with an AST node range.
 */
export function readNodeText(sourceText: string, node: any): string | null {
    if (!node || typeof node !== "object") {
        return null;
    }

    const start = Core.getNodeStartIndex(node);
    const end = Core.getNodeEndIndex(node);
    if (typeof start === "number" && typeof end === "number") {
        return sourceText.slice(start, end);
    }
    return null;
}

/**
 * Produces a minimal expression string for lint autofixes.
 */
export function printExpression(node: any, sourceText: string): string {
    if (!node || typeof node !== "object") {
        return "";
    }

    switch (node.type) {
        case "Literal": {
            return String(node.value);
        }
        case "Identifier": {
            return node.name;
        }
        case "ParenthesizedExpression": {
            return node.expression ? printExpression(node.expression, sourceText) : "";
        }
        case "BinaryExpression": {
            return printBinaryLikeExpression(node, sourceText);
        }
        case "LogicalExpression": {
            return printBinaryLikeExpression(node, sourceText);
        }
        case "UnaryExpression": {
            const argumentPrinted = printExpression(node.argument, sourceText);
            const arg = shouldParenthesizeUnaryArgument(node.argument) ? `(${argumentPrinted})` : argumentPrinted;
            if (node.prefix) {
                return `${node.operator}${arg}`;
            }
            return `${arg}${node.operator}`;
        }
        case "CallExpression": {
            const callee = printExpression(node.object || node.callee, sourceText);
            const args = Array.isArray(node.arguments)
                ? node.arguments.map((argument: any) => printExpression(argument, sourceText)).join(", ")
                : "";
            return `${callee}(${args})`;
        }
        case "MemberDotExpression": {
            const object = printExpression(node.object, sourceText);
            const property = printExpression(node.property, sourceText);
            return `${object}.${property}`;
        }
        case "MemberIndexExpression": {
            const object = printExpression(node.object, sourceText);
            const accessor = isMemberAccessor(node.accessor) ? node.accessor : "[";
            let index: string;
            if (Array.isArray(node.property)) {
                index = node.property.map((entry: any) => printExpression(entry, sourceText)).join(", ");
            } else if (node.index) {
                index = printExpression(node.index, sourceText);
            } else {
                index = printExpression(node.property, sourceText);
            }
            return `${object}${accessor}${index}]`;
        }
        case "ConditionalExpression": {
            const test = printExpression(node.test, sourceText);
            const consequentPrinted = printExpression(node.consequent, sourceText);
            const alternatePrinted = printExpression(node.alternate, sourceText);
            const consequent = shouldParenthesizeNestedTernaryBranch(node.consequent)
                ? `(${consequentPrinted})`
                : consequentPrinted;
            const alternate = shouldParenthesizeNestedTernaryBranch(node.alternate)
                ? `(${alternatePrinted})`
                : alternatePrinted;
            return `${test} ? ${consequent} : ${alternate}`;
        }
        case "AssignmentExpression": {
            const left = printExpression(node.left, sourceText);
            const right = printExpression(node.right, sourceText);
            return `${left} ${node.operator} ${right}`;
        }
        default: {
            const text = readNodeText(sourceText, node);
            return text || "";
        }
    }
}

function printStatementBranch(node: any, sourceText: string): string {
    if (!node || typeof node !== "object") {
        return "{}";
    }

    if (node.type === "BlockStatement") {
        return printNodeForAutofix(node, sourceText);
    }

    return `{ ${printNodeForAutofix(node, sourceText)} }`;
}

/**
 * Produces minimal statement or expression text for lint autofixes.
 */
export function printNodeForAutofix(node: any, sourceText: string): string {
    if (!node || typeof node !== "object") {
        return "";
    }

    switch (node.type) {
        case "Program": {
            const body = Array.isArray(node.body) ? node.body : [];
            return body.map((statement: any) => printNodeForAutofix(statement, sourceText)).join("\n");
        }
        case "BlockStatement": {
            const body = Array.isArray(node.body) ? node.body : [];
            if (body.length === 0) {
                return "{}";
            }

            const bodyText = body.map((statement: any) => printNodeForAutofix(statement, sourceText)).join("\n");
            return `{\n${bodyText}\n}`;
        }
        case "IfStatement": {
            const test = printExpression(node.test, sourceText);
            const consequent = printStatementBranch(node.consequent, sourceText);
            const alternate = node.alternate ? ` else ${printStatementBranch(node.alternate, sourceText)}` : "";
            return `if (${test}) ${consequent}${alternate}`;
        }
        case "ReturnStatement": {
            if (!node.argument) {
                return "return;";
            }

            return `return ${printExpression(node.argument, sourceText)};`;
        }
        case "ExpressionStatement": {
            return `${printExpression(node.expression, sourceText)};`;
        }
        case "EmptyStatement": {
            return ";";
        }
        default: {
            return printExpression(node, sourceText);
        }
    }
}
