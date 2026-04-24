import { Core } from "@gmloop/core";

const MEMBER_INDEX_ACCESSORS = new Set(["[", "[|", "[?", "[#", "[@", "[$"]);

function getLogicalPrecedence(operator: string): number {
    switch (operator) {
        case "||": {
            return 1;
        }
        case "&&": {
            return 2;
        }
        default: {
            return Number.POSITIVE_INFINITY;
        }
    }
}

function shouldParenthesizeLogicalChild(parent: any, child: any): boolean {
    if (!child || typeof child !== "object") {
        return false;
    }

    if (
        (child.type !== "BinaryExpression" && child.type !== "LogicalExpression") ||
        typeof child.operator !== "string"
    ) {
        return false;
    }

    const parentOperator = typeof parent.operator === "string" ? parent.operator : "";
    const parentPrecedence = getLogicalPrecedence(parentOperator);
    const childPrecedence = getLogicalPrecedence(child.operator);
    return childPrecedence < parentPrecedence;
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

function shouldParenthesizeTernaryConsequent(consequentNode: unknown): boolean {
    const unwrappedConsequent = Core.unwrapParenthesizedExpression(consequentNode);
    if (!Core.isNode(unwrappedConsequent)) {
        return false;
    }

    return Core.isConditionalExpressionNode(unwrappedConsequent) || Core.isTernaryExpressionNode(unwrappedConsequent);
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
            const leftPrinted = printExpression(node.left, sourceText);
            const rightPrinted = printExpression(node.right, sourceText);
            const left = shouldParenthesizeLogicalChild(node, node.left) ? `(${leftPrinted})` : leftPrinted;
            const right = shouldParenthesizeLogicalChild(node, node.right) ? `(${rightPrinted})` : rightPrinted;
            return `${left} ${node.operator} ${right}`;
        }
        case "LogicalExpression": {
            const leftPrinted = printExpression(node.left, sourceText);
            const rightPrinted = printExpression(node.right, sourceText);
            const left = shouldParenthesizeLogicalChild(node, node.left) ? `(${leftPrinted})` : leftPrinted;
            const right = shouldParenthesizeLogicalChild(node, node.right) ? `(${rightPrinted})` : rightPrinted;
            return `${left} ${node.operator} ${right}`;
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
            const accessor =
                typeof node.accessor === "string" && MEMBER_INDEX_ACCESSORS.has(node.accessor) ? node.accessor : "[";
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
            const alternate = printExpression(node.alternate, sourceText);
            const consequent = shouldParenthesizeTernaryConsequent(node.consequent)
                ? `(${consequentPrinted})`
                : consequentPrinted;
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
