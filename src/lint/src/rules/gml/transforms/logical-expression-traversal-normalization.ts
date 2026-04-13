import { Core, type MutableGameMakerAstNode } from "@gmloop/core";

const { isObjectLike } = Core;

/**
 * Apply logical expression simplifications using AST traversal.
 * Handles De Morgan's laws, double negation, and boolean constant simplification.
 */
export function applyLogicalNormalization(ast: MutableGameMakerAstNode): MutableGameMakerAstNode {
    return applyLogicalNormalizationWithChangeMetadata(ast).ast;
}

/**
 * Apply logical-expression normalization and surface whether any node changed.
 */
export function applyLogicalNormalizationWithChangeMetadata(
    ast: MutableGameMakerAstNode
): Readonly<{ ast: MutableGameMakerAstNode; changed: boolean }> {
    if (!isObjectLike(ast)) {
        return Object.freeze({ ast, changed: false });
    }

    // Repeatedly apply passes until no changes occur, or max limit reached
    let changedAtLeastOnce = false;
    for (let iterations = 0; iterations < 10; iterations++) {
        if (!traverseAndSimplify(ast)) break;
        changedAtLeastOnce = true;
    }

    return Object.freeze({ ast, changed: changedAtLeastOnce });
}

function traverseAndSimplify(node: any): boolean {
    if (!isObjectLike(node)) {
        return false;
    }

    let changed = false;

    // Post-order traversal: simplify children first
    const keys = Object.keys(node);
    for (const key of keys) {
        if (key === "parent") continue;

        const child = node[key];
        if (Array.isArray(child)) {
            const childSnapshot = [...child];
            for (const element of childSnapshot) {
                if (isObjectLike(element)) {
                    (element as { parent?: unknown }).parent = node;
                    changed ||= traverseAndSimplify(element);
                }
            }
        } else if (isObjectLike(child)) {
            (child as { parent?: unknown }).parent = node;
            changed ||= traverseAndSimplify(child);
        }
    }

    // Now try to simplify the current node
    changed ||= simplifyNode(node);

    return changed;
}

function simplifyNode(node: any): boolean {
    if (node.type === "UnaryExpression" && node.operator === "!") {
        return simplifyNot(node);
    }
    if (node.type === "LogicalExpression" || node.type === "BinaryExpression") {
        const simplifiedComparison = simplifyBooleanLiteralComparison(node);
        if (simplifiedComparison) {
            return true;
        }
    }
    if (isLogicalBinaryNode(node)) {
        return simplifyLogical(node);
    }

    if (node.type === "IfStatement") {
        return simplifyIfStatement(node);
    }
    if (node.type === "Program" || node.type === "BlockStatement") {
        return simplifyStatementList(node.body);
    }
    return false;
}

function simplifyBooleanLiteralComparison(node: any): boolean {
    if (!node || typeof node !== "object" || node.type !== "BinaryExpression") {
        return false;
    }

    const operator = Core.getNormalizedOperator(node);
    if (operator !== "==" && operator !== "!=") {
        return false;
    }

    const leftBoolean = getBooleanValue(node.left);
    const rightBoolean = getBooleanValue(node.right);
    const hasLeftBoolean = leftBoolean !== undefined;
    const hasRightBoolean = rightBoolean !== undefined;

    if (hasLeftBoolean === hasRightBoolean) {
        return false;
    }

    const comparedBoolean = hasLeftBoolean ? leftBoolean : rightBoolean;
    const comparedExpression = hasLeftBoolean ? node.right : node.left;
    if (comparedBoolean === undefined || !comparedExpression) {
        return false;
    }

    const shouldNegate = operator === "==" ? comparedBoolean === false : comparedBoolean === true;
    const replacement = shouldNegate ? negateNode(comparedExpression) : comparedExpression;
    replaceNode(node, replacement);
    return true;
}

function isLogicalOperator(operator: unknown): boolean {
    return operator === "&&" || operator === "||";
}

function isLogicalBinaryNode(node: any): boolean {
    if (!node || typeof node !== "object") {
        return false;
    }

    if (node.type !== "LogicalExpression" && node.type !== "BinaryExpression") {
        return false;
    }

    return isLogicalOperator(node.operator);
}

function unwrapParenthesizedExpressionNode(node: any): any {
    let currentNode = node;
    while (currentNode && currentNode.type === "ParenthesizedExpression") {
        currentNode = currentNode.expression;
    }

    return currentNode;
}

function isNegatedExpression(node: any): boolean {
    return Boolean(node && node.type === "UnaryExpression" && node.operator === "!");
}

function readExclusiveOrOperands(
    leftTerm: any,
    rightTerm: any
): Readonly<{ leftOperand: any; rightOperand: any }> | null {
    const leftOperands = [leftTerm.left, leftTerm.right];
    const rightOperands = [rightTerm.left, rightTerm.right];

    for (const leftNegatedCandidate of leftOperands) {
        if (!isNegatedExpression(leftNegatedCandidate)) {
            continue;
        }

        const leftPositiveCandidate = leftTerm.left === leftNegatedCandidate ? leftTerm.right : leftTerm.left;
        for (const rightNegatedCandidate of rightOperands) {
            if (!isNegatedExpression(rightNegatedCandidate)) {
                continue;
            }

            const rightPositiveCandidate = rightTerm.left === rightNegatedCandidate ? rightTerm.right : rightTerm.left;
            if (
                nodesAreEqual(leftPositiveCandidate, rightNegatedCandidate.argument) &&
                nodesAreEqual(rightPositiveCandidate, leftNegatedCandidate.argument)
            ) {
                return Object.freeze({
                    leftOperand: leftPositiveCandidate,
                    rightOperand: rightPositiveCandidate
                });
            }
        }
    }

    return null;
}

function simplifyStatementList(body: any[]): boolean {
    if (!Array.isArray(body)) return false;
    let changed = false;
    for (let i = 0; i < body.length - 1; i++) {
        const current = body[i];
        const next = body[i + 1];

        if (current && next && current.type === "IfStatement" && !current.alternate) {
            // if (cond) { return true; } return false;
            const consequent = unwrapBlock(current.consequent);

            if (consequent.type === "ReturnStatement" && next.type === "ReturnStatement") {
                const consBool = getBooleanValue(consequent.argument);
                const nextBool = getBooleanValue(next.argument);

                const shouldNegate = resolveBooleanReturnNegation(consBool, nextBool);
                if (shouldNegate !== null) {
                    body[i] = createBooleanReturnStatement(current.test, current.start, next.end, shouldNegate);
                    body.splice(i + 1, 1);
                    changed = true;
                }
            }
        }
    }
    return changed;
}

function simplifyIfStatement(node: any): boolean {
    if (!node.consequent) {
        return false;
    }

    // Normalize blocks to single statements if they contain only one statement.
    const consequent = unwrapBlock(node.consequent);
    const alternate = node.alternate ? unwrapBlock(node.alternate) : null;

    if (alternate !== null) {
        // Rules 1 & 2: if (cond) return true/false; else return false/true; -> return cond/!cond;
        // These apply even inside else-if chains (a return collapses the entire branch).
        if (consequent.type === "ReturnStatement" && alternate.type === "ReturnStatement") {
            const consBool = getBooleanValue(consequent.argument);
            const altBool = getBooleanValue(alternate.argument);
            const shouldNegate = resolveBooleanReturnNegation(consBool, altBool);
            if (shouldNegate !== null) {
                const newReturn = createBooleanReturnStatement(node.test, node.start, node.end, shouldNegate);
                replaceNode(node, newReturn);
                return true;
            }
        }

        // Rule 3: if (cond) x = A; else x = B; -> x = cond ? A : B;
        // Skip else-if chains: folding them into a ternary harms readability more than it helps.
        if (isElseIfAlternateChainNode(node)) {
            return false;
        }

        const consExp = getAssignmentExpressionFromStatementLikeNode(consequent);
        const altExp = getAssignmentExpressionFromStatementLikeNode(alternate);

        if (consExp && altExp && nodesRecursiveEqual(consExp.left, altExp.left)) {
            // x = cond ? A : B;
            const conditional = {
                type: "ConditionalExpression",
                test: node.test,
                consequent: consExp.right,
                alternate: altExp.right
            };
            const assignment = {
                type: "AssignmentExpression",
                operator: consExp.operator, // Assume same operator (=)
                left: consExp.left,
                right: conditional
            };
            const statement = {
                type: "ExpressionStatement",
                expression: assignment,
                start: node.start,
                end: node.end
            };
            replaceNode(node, statement);
            return true;
        }

        return false;
    }

    // Rules 4 & 5 (no else branch):
    // 4. if (is_undefined(x)) x = y; -> x ??= y;
    // 5. if (x == undefined) x = y; -> x ??= y;
    const assignment = getAssignmentExpressionFromStatementLikeNode(consequent);
    if (!assignment || assignment.operator !== "=") {
        return false;
    }

    const target = assignment.left;
    const value = assignment.right;

    if (isUndefinedCheck(node.test, target)) {
        // x ??= value;
        const coalesceAssign = {
            type: "AssignmentExpression",
            operator: "??=",
            left: target,
            right: value
        };
        const statement = {
            type: "ExpressionStatement",
            expression: coalesceAssign,
            start: node.start,
            end: node.end
        };
        replaceNode(node, statement);
        return true;
    }

    return false;
}

function isElseIfAlternateChainNode(node: any): boolean {
    let current = node;
    let parent = node?.parent;

    while (parent && typeof parent === "object") {
        if (parent.type === "IfStatement" && parent.alternate) {
            const currentStart = Core.getNodeStartIndex(current);
            const currentEnd = Core.getNodeEndIndex(current);
            const alternateStart = Core.getNodeStartIndex(parent.alternate);
            const alternateEnd = Core.getNodeEndIndex(parent.alternate);

            if (
                typeof currentStart === "number" &&
                typeof currentEnd === "number" &&
                typeof alternateStart === "number" &&
                typeof alternateEnd === "number" &&
                currentStart >= alternateStart &&
                currentEnd <= alternateEnd
            ) {
                return true;
            }
        }

        current = parent;
        parent = parent.parent;
    }

    return false;
}

function getAssignmentExpressionFromStatementLikeNode(node: any): any {
    if (!node || typeof node !== "object") {
        return null;
    }

    if (node.type === "AssignmentExpression") {
        return node;
    }

    if (node.type !== "ExpressionStatement") {
        return null;
    }

    if (!node.expression || typeof node.expression !== "object") {
        return null;
    }

    if (node.expression.type !== "AssignmentExpression") {
        return null;
    }

    return node.expression;
}

function resolveBooleanReturnNegation(firstValue: boolean | null, secondValue: boolean | null): boolean | null {
    if (firstValue === true && secondValue === false) {
        return false;
    }

    if (firstValue === false && secondValue === true) {
        return true;
    }

    return null;
}

function createBooleanReturnStatement(
    test: any,
    start: number | undefined,
    end: number | undefined,
    negate: boolean
): any {
    const argument = negate ? negateNode(test) : test;
    return { type: "ReturnStatement", argument, start, end };
}

function unwrapBlock(node: any): any {
    if (node.type === "BlockStatement" && node.body.length === 1) {
        return node.body[0];
    }
    return node;
}

function isUndefinedCheck(condition: any, target: any): boolean {
    while (condition && condition.type === "ParenthesizedExpression") {
        condition = condition.expression;
    }

    if (!condition || typeof condition !== "object") {
        return false;
    }

    const callee = condition?.callee ?? condition?.object;

    // is_undefined(target)
    if (
        condition.type === "CallExpression" &&
        callee &&
        callee.type === "Identifier" &&
        callee.name === "is_undefined" &&
        condition.arguments.length === 1
    ) {
        return nodesRecursiveEqual(condition.arguments[0], target);
    }

    // target == undefined
    if (condition.type === "BinaryExpression" && condition.operator === "==") {
        const leftUndefined =
            condition.left &&
            ((condition.left.type === "Identifier" && condition.left.name === "undefined") ||
                (condition.left.type === "Literal" &&
                    (condition.left.value === undefined || condition.left.value === "undefined")));
        const rightUndefined =
            condition.right &&
            ((condition.right.type === "Identifier" && condition.right.name === "undefined") ||
                (condition.right.type === "Literal" &&
                    (condition.right.value === undefined || condition.right.value === "undefined")));

        if (nodesRecursiveEqual(condition.left, target) && rightUndefined) {
            return true;
        }
        if (nodesRecursiveEqual(condition.right, target) && leftUndefined) {
            return true;
        }
    }
    return false;
}

function nodesRecursiveEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.type !== b.type) return false;

    if (a.type === "Identifier") return a.name === b.name;
    if (a.type === "Literal") return a.value === b.value;

    if (a.type === "MemberDotExpression") {
        return nodesRecursiveEqual(a.object, b.object) && nodesRecursiveEqual(a.property, b.property);
    }
    if (a.type === "MemberIndexExpression") {
        return nodesRecursiveEqual(a.object, b.object) && nodesRecursiveEqual(a.index, b.index);
    }

    // Incomplete, but sufficient for variable/member matching
    return false;
}

/**
 * Wraps `inner` in a `!` unary expression, preserving source location.
 * Used when constructing negations during De Morgan's law application.
 */
function negateNode(inner: any): any {
    return {
        type: "UnaryExpression",
        operator: "!",
        prefix: true,
        argument: inner,
        start: inner.start,
        end: inner.end
    };
}

function simplifyNot(node: any): boolean {
    const argument = node.argument;

    // Double negation: !!A -> A (only if A is boolean-safe or we are in a boolean context?
    // For now, let's limit to !(!A) -> A.
    // In GML, (!(!exp)) is equivalent to bool(exp). If exp is strictly boolean, it is A.
    // But safely, !(!A) where argument is a UnaryExpression(!)
    if (argument.type === "UnaryExpression" && argument.operator === "!") {
        // Replace current node with argument.argument
        // We can't replace the node reference, so we have to copy properties.
        const inner = argument.argument;
        replaceNode(node, inner);
        return true;
    }

    // De Morgan's laws: !(A || B) -> !A && !B  /  !(A && B) -> !A || !B
    // Both transforms follow the same structure; only the resulting operator differs.
    if (isLogicalBinaryNode(argument)) {
        const { left, right } = argument;
        const negatedOperator = argument.operator === "||" ? "&&" : "||";
        replaceNode(node, {
            type: argument.type,
            operator: negatedOperator,
            left: negateNode(left),
            right: negateNode(right),
            start: node.start,
            end: node.end,
            parent: node.parent
        });
        return true;
    }

    // Parentheses handling: !( (A) ) -> !A
    if (argument.type === "ParenthesizedExpression") {
        node.argument = argument.expression;
        // Don't mark as changed yet, wait for next pass to catch !A
        // Actually, changing the child is a change.
        return true;
    }

    return false;
}

function simplifyLogical(node: any): boolean {
    // Simplify: true && A -> A
    // Simplify: false || A -> A

    // We assume short-circuiting behavior.
    const leftNode = unwrapParenthesizedExpressionNode(node.left);
    const rightNode = unwrapParenthesizedExpressionNode(node.right);
    if (!leftNode || !rightNode) {
        return false;
    }

    // Check for boolean literals
    const leftBool = getBooleanValue(leftNode);
    const rightBool = getBooleanValue(rightNode);

    if (node.operator === "&&") {
        // true && A -> A
        if (leftBool === true) {
            replaceNode(node, node.right);
            return true;
        }
        // A && true -> A
        if (rightBool === true) {
            replaceNode(node, node.left);
            return true;
        }
        // false && A -> false (short circuit)
        if (leftBool === false) {
            replaceNode(node, node.left); // Replace with the 'false' literal
            return true;
        }
        // A && false -> false (if A has no side effects?)
        // Safer to not remove A if it might be a function call.
        // For now, let's stick to the ones that preserve side effects or known constants.
    }

    if (node.operator === "||") {
        // false || A -> A
        if (leftBool === false) {
            replaceNode(node, node.right);
            return true;
        }
        // A || false -> A
        if (rightBool === false) {
            replaceNode(node, node.left);
            return true;
        }
        // true || A -> true
        if (leftBool === true) {
            replaceNode(node, node.left);
            return true;
        }
    }

    // Absorption: A || (A && B) -> A
    // Absorption: A && (A || B) -> A

    // Check if right is parenthesized, unwrap for inspection
    if (
        node.operator === "||" &&
        isLogicalBinaryNode(rightNode) &&
        rightNode.operator === "&&" &&
        nodesAreEqual(leftNode, rightNode.left)
    ) {
        // A || (A && B) -> A
        replaceNode(node, leftNode);
        return true;
    }

    if (
        node.operator === "&&" &&
        isLogicalBinaryNode(rightNode) &&
        rightNode.operator === "||" &&
        nodesAreEqual(leftNode, rightNode.left)
    ) {
        // A && (A || B) -> A
        replaceNode(node, leftNode);
        return true;
    }

    // Distributive / Shared Term: (A && B) || (A && C) -> A && (B || C)
    if (
        node.operator === "||" &&
        isLogicalBinaryNode(leftNode) &&
        leftNode.operator === "&&" &&
        isLogicalBinaryNode(rightNode) &&
        rightNode.operator === "&&"
    ) {
        // (A && B) || (A && C) -> A && (B || C)
        if (nodesAreEqual(leftNode.left, rightNode.left)) {
            const newRight = {
                type: node.type,
                operator: "||",
                left: leftNode.right,
                right: rightNode.right,
                start: rightNode.start, // Approx
                end: rightNode.end
            };
            const newRoot = {
                type: node.type,
                operator: "&&",
                left: leftNode.left,
                right: newRight,
                start: node.start,
                end: node.end
            };
            replaceNode(node, newRoot);
            return true;
        }

        // (B && A) || (C && A) -> (B || C) && A
        if (nodesAreEqual(leftNode.right, rightNode.right)) {
            const newLeft = {
                type: node.type,
                operator: "||",
                left: leftNode.left,
                right: rightNode.left,
                start: leftNode.start,
                end: leftNode.end
            };
            const newRoot = {
                type: node.type,
                operator: "&&",
                left: newLeft,
                right: leftNode.right,
                start: node.start,
                end: node.end
            };
            replaceNode(node, newRoot);
            return true;
        }

        // (A && B) || (A && !B) -> A (Complement/Redundancy)
        if (nodesAreEqual(leftNode.left, rightNode.left) && areNegations(leftNode.right, rightNode.right)) {
            replaceNode(node, leftNode.left);
            return true;
        }

        // (B && A) || (!B && A) -> A
        if (nodesAreEqual(leftNode.right, rightNode.right) && areNegations(leftNode.left, rightNode.left)) {
            replaceNode(node, leftNode.right);
            return true;
        }

        // XOR Pattern: (A && !B) || (!A && B) -> (A || B) && !(A && B)
        const exclusiveOrOperands = readExclusiveOrOperands(leftNode, rightNode);
        if (exclusiveOrOperands) {
            const { leftOperand, rightOperand } = exclusiveOrOperands;
            // Construct (A || B) && !(A && B)
            const orPart = {
                type: node.type,
                operator: "||",
                left: leftOperand,
                right: rightOperand
            };

            const andPart = {
                type: node.type,
                operator: "&&",
                left: leftOperand,
                right: rightOperand
            };

            const notAndPart = {
                type: "UnaryExpression",
                operator: "!",
                prefix: true,
                argument: andPart
            };

            const finalExpr = {
                type: node.type,
                operator: "&&",
                left: orPart,
                right: notAndPart,
                start: node.start,
                end: node.end
            };

            replaceNode(node, finalExpr);
            return true;
        }
    }

    return false;
}

function areNegations(node1: any, node2: any): boolean {
    if (!node1 || !node2) return false;
    // Check if node1 is !node2
    if (node1.type === "UnaryExpression" && node1.operator === "!" && nodesAreEqual(node1.argument, node2)) {
        return true;
    }
    // Check if node2 is !node1
    if (node2.type === "UnaryExpression" && node2.operator === "!" && nodesAreEqual(node2.argument, node1)) {
        return true;
    }
    return false;
}

function getBooleanValue(node: any): boolean | undefined {
    const currentNode = unwrapParenthesizedExpressionNode(node);
    if (!currentNode || currentNode.type !== "Literal") {
        return undefined;
    }

    if (typeof currentNode.value === "boolean") {
        return currentNode.value;
    }

    if (typeof currentNode.value === "string") {
        if (currentNode.value === "true") {
            return true;
        }

        if (currentNode.value === "false") {
            return false;
        }
    }

    return undefined;
}

function nodesAreEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    if (a.type !== b.type) return false;

    if (a.type === "Identifier") {
        return a.name === b.name;
    }
    if (a.type === "Literal") {
        return a.value === b.value;
    }
    // Deep comparison for simple structural equality, avoiding cyclic issues
    // Just handling simple Identifiers and Literals for now for Absorption laws.
    return false;
}

/**
 * Replace properties of 'target' with properties of 'source'.
 * This mutates 'target' in place, effectively replacing it in the AST.
 */
function replaceNode(target: any, source: any) {
    // Clear existing keys
    for (const key of Object.keys(target)) {
        delete target[key];
    }
    // Copy new keys
    for (const key of Object.keys(source)) {
        target[key] = source[key];
    }
}
