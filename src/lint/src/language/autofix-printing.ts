import { Core, isMemberAccessor } from "@gmloop/core";

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
    // Guard: reject non-object nodes immediately.
    if (!node || typeof node !== "object") {
        return "";
    }

    const type = node.type;

    // Literal: emit raw value directly (numbers, booleans, unquoted strings).
    if (type === "Literal") {
        return String(node.value);
    }

    // Identifier: emit name.
    if (type === "Identifier") {
        return node.name;
    }

    // ParenthesizedExpression: recurse into the wrapped expression.
    if (type === "ParenthesizedExpression") {
        return node.expression ? printExpression(node.expression, sourceText) : "";
    }

    // BinaryExpression and LogicalExpression share identical parenthesization logic.
    // Extract the printed operands once and apply the same wrap logic to both.
    if (type === "BinaryExpression" || type === "LogicalExpression") {
        const left = printExpression(node.left, sourceText);
        const right = printExpression(node.right, sourceText);
        const leftWrapped = shouldParenthesizeLogicalChild(node, node.left) ? `(${left})` : left;
        const rightWrapped = shouldParenthesizeLogicalChild(node, node.right) ? `(${right})` : right;
        return `${leftWrapped} ${node.operator} ${rightWrapped}`;
    }

    // UnaryExpression: print operator and operand, handling both prefix and postfix forms.
    if (type === "UnaryExpression") {
        const argumentPrinted = printExpression(node.argument, sourceText);
        const arg = shouldParenthesizeUnaryArgument(node.argument) ? `(${argumentPrinted})` : argumentPrinted;
        return node.prefix ? `${node.operator}${arg}` : `${arg}${node.operator}`;
    }

    // CallExpression: emit callee followed by comma-separated arguments.
    if (type === "CallExpression") {
        const callee = printExpression(node.object || node.callee, sourceText);
        const args = Array.isArray(node.arguments)
            ? node.arguments.map((argument: any) => printExpression(argument, sourceText)).join(", ")
            : "";
        return `${callee}(${args})`;
    }

    // MemberDotExpression: object.property access.
    if (type === "MemberDotExpression") {
        const object = printExpression(node.object, sourceText);
        const property = printExpression(node.property, sourceText);
        return `${object}.${property}`;
    }

    // MemberIndexExpression: bracket-access with three possible property shapes.
    if (type === "MemberIndexExpression") {
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

    // ConditionalExpression: ternary with parenthesization guard on the consequent branch.
    if (type === "ConditionalExpression") {
        const test = printExpression(node.test, sourceText);
        const consequentPrinted = printExpression(node.consequent, sourceText);
        const alternate = printExpression(node.alternate, sourceText);
        const consequent = shouldParenthesizeTernaryConsequent(node.consequent)
            ? `(${consequentPrinted})`
            : consequentPrinted;
        return `${test} ? ${consequent} : ${alternate}`;
    }

    // AssignmentExpression: left operator right.
    if (type === "AssignmentExpression") {
        const left = printExpression(node.left, sourceText);
        const right = printExpression(node.right, sourceText);
        return `${left} ${node.operator} ${right}`;
    }

    // Fallback: extract original source text for all other node types.
    const text = readNodeText(sourceText, node);
    return text ?? "";
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
    // Guard: reject non-object nodes immediately.
    if (!node || typeof node !== "object") {
        return "";
    }

    const type = node.type;

    // Program: join all top-level statements with newlines.
    if (type === "Program") {
        const body = node.body ?? [];
        return body.map((statement: any) => printNodeForAutofix(statement, sourceText)).join("\n");
    }

    // BlockStatement: wrap body in braces; empty blocks render as "{}".
    if (type === "BlockStatement") {
        const body = node.body ?? [];
        if (body.length === 0) {
            return "{}";
        }
        const bodyText = body.map((statement: any) => printNodeForAutofix(statement, sourceText)).join("\n");
        return `{\n${bodyText}\n}`;
    }

    // IfStatement: print test, consequent branch, and optional else branch.
    if (type === "IfStatement") {
        const test = printExpression(node.test, sourceText);
        const consequent = printStatementBranch(node.consequent, sourceText);
        const alternate = node.alternate ? ` else ${printStatementBranch(node.alternate, sourceText)}` : "";
        return `if (${test}) ${consequent}${alternate}`;
    }

    // ReturnStatement: guard against missing argument.
    if (type === "ReturnStatement") {
        if (!node.argument) {
            return "return;";
        }
        return `return ${printExpression(node.argument, sourceText)};`;
    }

    // ExpressionStatement: print the expression followed by a semicolon.
    if (type === "ExpressionStatement") {
        return `${printExpression(node.expression, sourceText)};`;
    }

    // EmptyStatement: bare semicolon.
    if (type === "EmptyStatement") {
        return ";";
    }

    // All other node types delegate to the expression printer.
    return printExpression(node, sourceText);
}
