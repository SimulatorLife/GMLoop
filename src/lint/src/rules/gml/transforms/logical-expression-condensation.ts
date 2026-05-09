/**
 * Helpers that build boolean truth tables for branches and rewrite redundant logical nesting to concise expressions.
 */
import { Core } from "@gmloop/core";

const {
    cloneAstNode,
    cloneLocation,
    isNode,
    forEachNodeChild,
    asArray,
    compactArray,
    getOrCreateMapEntry,
    isNonEmptyArray,
    toNormalizedLowerCaseString,
    isObjectLike,
    getBooleanLiteralValue
} = Core;

const BOOLEAN_NODE_TYPES = Object.freeze({
    CONST: "CONST",
    VAR: "VAR",
    NOT: "NOT",
    AND: "AND",
    OR: "OR"
});

const COMMON_IGNORED_NODE_KEYS = [
    "start",
    "end",
    "comments",
    "parent",
    "enclosingNode",
    "precedingNode",
    "followingNode"
];

const TRAVERSAL_IGNORED_KEYS = new Set(["body", ...COMMON_IGNORED_NODE_KEYS]);

const IGNORED_NODE_KEYS = new Set(COMMON_IGNORED_NODE_KEYS);

// Cap truth-table generation to prevent exponential blowup. The condensation
// pass builds truth tables to simplify complex boolean conditions (e.g.,
// collapsing `(a && b) || (a && !b)` to just `a`). Each boolean variable in
// the condition doubles the number of truth-table rows (2^n), so a condition
// with 11 variables would require 2048 rows, and 15 variables would demand
// 32,768 rows. Beyond a small threshold, the memory and CPU cost of generating
// and evaluating these tables outweighs the benefit of simplification. By
// limiting the table size to 10 variables (1024 rows maximum), we ensure the
// transform completes in reasonable time even for deeply nested or compound
// conditions. Conditions exceeding this limit are left unchanged rather than
// risking excessive resource consumption or timeouts.
const MAX_BOOLEAN_VARIABLES_FOR_TRUTH_TABLE = 10;

/**
 * Condenses logical control-flow branches into simplified boolean return
 * expressions.
 */
export function applyLogicalExpressionCondensation(ast: any) {
    if (!isNode(ast)) {
        return ast;
    }

    visit(ast);
    return ast;
}

function isBooleanBranchExpression(node, allowValueLiterals = false) {
    if (!isObjectLike(node)) {
        return false;
    }

    switch (node.type) {
        case "Literal": {
            const { value } = node;
            if (typeof value === "boolean") {
                return true;
            }
            if (typeof value === "string") {
                const normalized = toNormalizedLowerCaseString(value);
                return normalized === "true" || normalized === "false";
            }
            return allowValueLiterals;
        }
        case "Identifier":
        case "MemberDotExpression":
        case "MemberIndexExpression":
        case "CallExpression": {
            return true;
        }
        case "ParenthesizedExpression": {
            return isBooleanBranchExpression(node.expression, allowValueLiterals);
        }
        case "UnaryExpression":
        case "IncDecExpression": {
            const operator = Core.getNormalizedOperator(node);
            if (operator === "!" || operator === "not") {
                // GML does not support the operator 'not'; this is included to automatic fixing
                return isBooleanBranchExpression(node.argument, allowValueLiterals);
            }
            if (allowValueLiterals && (operator === "+" || operator === "-")) {
                return isBooleanBranchExpression(node.argument, true);
            }
            return false;
        }
        case "BinaryExpression": {
            const operator = Core.getNormalizedOperator(node);

            if (Core.isLogicalBinaryOperator(operator)) {
                return (
                    isBooleanBranchExpression(node.left, allowValueLiterals) &&
                    isBooleanBranchExpression(node.right, allowValueLiterals)
                );
            }

            if (Core.isComparisonBinaryOperator(operator)) {
                return isBooleanBranchExpression(node.left, true) && isBooleanBranchExpression(node.right, true);
            }

            if (allowValueLiterals && (Core.isArithmeticBinaryOperator(operator) || operator === "**")) {
                return isBooleanBranchExpression(node.left, true) && isBooleanBranchExpression(node.right, true);
            }

            return false;
        }
        default: {
            return false;
        }
    }
}

function visit(node) {
    // Walk child nodes and attempt to collapse boolean branches into normalized boolean formulas.
    if (!isNode(node)) {
        return;
    }

    if (Array.isArray(node)) {
        for (const child of node) {
            visit(child);
        }
        return;
    }

    const bodyStatements = Core.getBodyStatements(node as Record<string, unknown>);
    if (bodyStatements.length > 0) {
        condenseWithinStatements(bodyStatements);
    } else if (isNode(node.body)) {
        visit(node.body);
    }

    forEachNodeChild(node, (value, key) => {
        if (TRAVERSAL_IGNORED_KEYS.has(key)) {
            return;
        }
        if (isNode(value) || Array.isArray(value)) {
            visit(value);
        }
    });
}

function condenseWithinStatements(statements) {
    if (!isNonEmptyArray(statements)) {
        return;
    }

    for (let index = 0; index < statements.length; index++) {
        const statement = statements[index];
        if (!isNode(statement)) {
            continue;
        }

        if (statement.type === "IfStatement") {
            const extractedGuard = tryExtractEarlyExitGuardClause(statements, index);
            if (extractedGuard) {
                continue;
            }

            const condensed = tryCondenseIfStatement(statements, index);
            if (condensed) {
                // Reprocess the new return statement in case nested condensing applies later.
                continue;
            }
        }

        visit(statement);
    }
}

function tryExtractEarlyExitGuardClause(statements, index) {
    const statement = statements[index];
    if (!statement || statement.type !== "IfStatement") {
        return false;
    }

    if (Core.hasComment(statement) || Core.hasComment(statement.test)) {
        return false;
    }
    if (Core.hasComment(statement.consequent) || Core.hasComment(statement.alternate)) {
        return false;
    }

    const extractedAlternateExit = extractEarlyExitStatement(statement.alternate);
    if (!extractedAlternateExit) {
        return false;
    }

    const consequentStatements = extractConsequentStatementsForGuardClause(statement.consequent);
    if (consequentStatements.length === 0) {
        return false;
    }

    const negatedTest = createNegatedTestExpression(statement.test);
    const guardIfStatement = buildGuardIfStatement(negatedTest, extractedAlternateExit, statement);

    statements.splice(index, 1, guardIfStatement, ...consequentStatements);
    return true;
}

function tryCondenseIfStatement(statements, index) {
    const statement = statements[index];
    if (!statement || statement.type !== "IfStatement") {
        return false;
    }

    if (Core.hasComment(statement) || Core.hasComment(statement.test)) {
        return false;
    }

    const consequentExpression = extractReturnExpression(statement.consequent);
    if (!consequentExpression) {
        return false;
    }

    let alternateExpression;
    let alternateSourceNode;
    let removeFollowingReturn = false;

    if (statement.alternate) {
        alternateExpression = extractReturnExpression(statement.alternate);
        alternateSourceNode = statement.alternate;
        if (!alternateExpression) {
            return false;
        }
    } else {
        const nextStatement = statements[index + 1];
        if (!nextStatement || nextStatement.type !== "ReturnStatement") {
            return false;
        }
        if (Core.hasComment(nextStatement)) {
            return false;
        }

        const nextArgument = nextStatement.argument ?? null;
        if (nextArgument && Core.hasComment(nextArgument)) {
            return false;
        }

        alternateExpression = nextArgument;
        alternateSourceNode = nextStatement;
        removeFollowingReturn = true;
    }

    if (!alternateExpression) {
        // Decline to condense if the alternate branch is missing or doesn't produce
        // a boolean value. Ternary expressions require both consequent and alternate
        // operands, so we can't safely transform `if (x) return true;` into a
        // ternary without risking undefined behavior in the else case.
        return false;
    }

    const simpleArgument = resolveSimpleBooleanReturnArgument(statement, consequentExpression, alternateExpression);
    if (
        (!isBooleanBranchExpression(consequentExpression) || !isBooleanBranchExpression(alternateExpression)) &&
        !simpleArgument
    ) {
        return false;
    }

    const booleanContext = createBooleanContext();
    const testExpr = toBooleanExpression(statement.test, booleanContext);
    const consequentExpr = toBooleanExpression(consequentExpression, booleanContext);
    const alternateExpr = toBooleanExpression(alternateExpression, booleanContext);

    let argumentAst = null;

    if (
        testExpr &&
        consequentExpr &&
        alternateExpr &&
        booleanContext.variables.length <= MAX_BOOLEAN_VARIABLES_FOR_TRUTH_TABLE
    ) {
        const combinedExpression = combineConditionalBoolean(testExpr, consequentExpr, alternateExpr);
        const simplifiedCandidates = generateSimplifiedCandidates(combinedExpression, booleanContext);
        if (simplifiedCandidates.length > 0) {
            const chosen = chooseBestCandidate(simplifiedCandidates);
            if (chosen) {
                const optimizedExpression = postProcessBooleanExpression(chosen);
                argumentAst = booleanExpressionToAst(optimizedExpression, booleanContext);
            }
        }
    }

    if (!argumentAst && simpleArgument) {
        argumentAst = simpleArgument;
    }

    if (!argumentAst) {
        return false;
    }

    const newReturn = buildCondensedReturn(argumentAst, statement, alternateSourceNode ?? statement);

    statements[index] = newReturn;

    if (removeFollowingReturn) {
        statements.splice(index + 1, 1);
    }

    return true;
}

function extractConsequentStatementsForGuardClause(node) {
    if (!isNode(node)) {
        return [];
    }

    if (node.type === "BlockStatement") {
        return asArray(node.body).filter((statement) => isNode(statement));
    }

    return [node];
}

function extractEarlyExitStatement(node) {
    if (!node || !isNode(node)) {
        return null;
    }

    if (Core.hasComment(node)) {
        return null;
    }

    if (node.type === "BlockStatement") {
        const body = asArray(node.body);
        if (body.length === 0) {
            return null;
        }

        let firstStatementIndex = 0;
        while (firstStatementIndex < body.length && isIgnorableEmptyStatement(body[firstStatementIndex])) {
            firstStatementIndex += 1;
        }

        if (firstStatementIndex >= body.length) {
            return null;
        }

        const firstStatement = body[firstStatementIndex];
        if (!isNode(firstStatement) || !isEarlyExitStatement(firstStatement)) {
            return null;
        }

        for (let index = firstStatementIndex + 1; index < body.length; index += 1) {
            if (!canDropStatementAfterEarlyExit(body[index])) {
                return null;
            }
        }

        return firstStatement;
    }

    return isEarlyExitStatement(node) ? node : null;
}

function extractReturnExpression(node) {
    if (!node) {
        return null;
    }

    if (node.type === "BlockStatement") {
        const body = asArray(node.body);
        if (body.length === 0) {
            return null;
        }

        let firstStatementIndex = 0;
        while (firstStatementIndex < body.length && isIgnorableEmptyStatement(body[firstStatementIndex])) {
            firstStatementIndex += 1;
        }

        if (firstStatementIndex >= body.length) {
            return null;
        }

        const firstStatement = body[firstStatementIndex];
        if (!isNode(firstStatement)) {
            return null;
        }
        if ((firstStatement as any).type !== "ReturnStatement") {
            return null;
        }

        const returnExpression = extractReturnExpression(firstStatement);
        if (!returnExpression) {
            return null;
        }

        for (let index = firstStatementIndex + 1; index < body.length; index += 1) {
            if (!canDropUnreachableStatement(body[index])) {
                return null;
            }
        }

        return returnExpression;
    }

    if (!isNode(node)) {
        return null;
    }
    if (node.type !== "ReturnStatement") {
        return null;
    }

    if (Core.hasComment(node)) {
        return null;
    }

    const argument = node.argument ?? null;
    if (argument && Core.hasComment(argument)) {
        return null;
    }

    return argument;
}

function canDropStatementAfterEarlyExit(node) {
    if (!isNode(node)) {
        return false;
    }
    if (typeof node.type !== "string") {
        return false;
    }
    if (isEarlyExitStatement(node)) {
        return !Core.hasComment(node);
    }

    return canDropUnreachableStatement(node);
}

// Early-exit statement detection with plugin-specific constraints.
// This function extends Core.isControlFlowExitStatement() with additional checks for
// comment presence and return argument nullity, which are specific to the logical
// expression condensation logic. By building on the Core type guard, we eliminate
// the duplicated type checks while preserving the transform-specific constraints.
function isEarlyExitStatement(node) {
    if (!isNode(node)) {
        return false;
    }

    if (Core.hasComment(node)) {
        return false;
    }

    // Use Core type guard as foundation, then apply specific constraints
    if (!Core.isControlFlowExitStatement(node)) {
        return false;
    }

    // Special handling for return statements: only consider empty returns as early exits
    if (node.type === "ReturnStatement") {
        const argument = node.argument ?? null;
        if (argument && Core.hasComment(argument)) {
            return false;
        }

        return argument === null;
    }

    // For Break, Continue, Exit, Throw: always consider them early exits
    return true;
}

function isIgnorableEmptyStatement(node) {
    if (!isNode(node)) {
        return false;
    }
    if (node.type !== "EmptyStatement") {
        return false;
    }

    return canDropUnreachableStatement(node);
}

function canDropUnreachableStatement(node) {
    if (!isNode(node)) {
        return false;
    }
    if (typeof node.type !== "string") {
        return false;
    }

    if (Core.hasComment(node)) {
        return false;
    }

    if (isNonEmptyArray(node.docComments)) {
        return false;
    }

    switch (node.type) {
        case "EmptyStatement": {
            return true;
        }
        case "ReturnStatement": {
            const argument = node.argument ?? null;
            if (argument && Core.hasComment(argument)) {
                return false;
            }
            return true;
        }
        case "VariableDeclaration": {
            const declarations = Core.asArray<any>(node.declarations);
            for (const declarator of declarations) {
                if (!isNode(declarator)) {
                    continue;
                }
                if (Core.hasComment(declarator)) {
                    return false;
                }
                if (declarator.init && isNode(declarator.init) && Core.hasComment(declarator.init)) {
                    return false;
                }
            }
            return true;
        }
        default: {
            return node.type.endsWith("Expression");
        }
    }
}

function resolveSimpleBooleanReturnArgument(
    statement: any,
    consequentExpression: unknown,
    alternateExpression: unknown
) {
    if (!statement || !isNode(statement.test)) {
        return null;
    }

    const testNode = Core.unwrapParenthesizedExpression(statement.test) ?? statement.test;

    if (
        getBooleanLiteralValue(consequentExpression, { acceptBooleanPrimitives: true }) === "true" &&
        getBooleanLiteralValue(alternateExpression, { acceptBooleanPrimitives: true }) === "false"
    ) {
        return cloneAstNode(testNode);
    }

    if (
        getBooleanLiteralValue(consequentExpression, { acceptBooleanPrimitives: true }) === "false" &&
        getBooleanLiteralValue(alternateExpression, { acceptBooleanPrimitives: true }) === "true"
    ) {
        const clone = cloneAstNode(testNode) as {
            start?: unknown;
            end?: unknown;
        };
        return {
            type: "UnaryExpression",
            operator: "!",
            prefix: true,
            argument: wrapUnaryArgument(clone),
            start: cloneLocation(clone.start),
            end: cloneLocation(clone.end)
        };
    }

    return null;
}

function buildCondensedReturn(
    argumentAst: unknown,
    statement: { start?: unknown; end?: unknown },
    sourceNode: unknown
) {
    const source = (sourceNode ?? statement) as { end?: unknown };

    return {
        type: "ReturnStatement",
        argument: argumentAst,
        start: cloneLocation(statement.start),
        end: cloneLocation(source.end)
    };
}

function createNegatedTestExpression(testNode) {
    const unwrapped = Core.unwrapParenthesizedExpression(testNode) ?? testNode;
    const normalized = cloneAstNode(unwrapped) as {
        type?: string;
        operator?: string;
        argument?: unknown;
        start?: unknown;
        end?: unknown;
    };

    if (normalized && normalized.type === "UnaryExpression" && normalized.operator === "!") {
        return cloneAstNode(normalized.argument);
    }

    return {
        type: "UnaryExpression",
        operator: "!",
        prefix: true,
        argument: wrapUnaryArgument(normalized),
        start: cloneLocation(normalized.start),
        end: cloneLocation(normalized.end)
    };
}

function buildGuardIfStatement(test, exitStatement, originalIfStatement) {
    const guardExitStatement = cloneAstNode(exitStatement) as {
        start?: unknown;
        end?: unknown;
    };

    return {
        type: "IfStatement",
        test,
        consequent: {
            type: "BlockStatement",
            body: [guardExitStatement],
            start: cloneLocation(guardExitStatement.start),
            end: cloneLocation(guardExitStatement.end)
        },
        alternate: null,
        start: cloneLocation(originalIfStatement.start),
        end: cloneLocation(originalIfStatement.end)
    };
}

function createBooleanContext() {
    return {
        variables: [],
        variableMap: new Map()
    };
}

function registerVariable(node, context) {
    const key = getAstNodeKey(node);
    return getOrCreateMapEntry(context.variableMap, key, () => {
        const record = { index: context.variables.length, node };
        context.variables.push(record);
        return record;
    });
}

function toBooleanExpression(node, context) {
    if (!node) {
        return null;
    }

    if (node.type === "ParenthesizedExpression") {
        return toBooleanExpression(node.expression, context);
    }

    if (node.type === "Literal") {
        if (typeof node.value === "boolean") {
            return createBooleanConstant(node.value);
        }
        if (typeof node.value === "string") {
            const normalized = node.value.toLowerCase();
            if (normalized === "true") {
                return createBooleanConstant(true);
            }
            if (normalized === "false") {
                return createBooleanConstant(false);
            }
        }
        const variable = registerVariable(node, context);
        return createBooleanVariable(variable);
    }

    if (node.type === "UnaryExpression" || node.type === "IncDecExpression") {
        const operator = Core.getNormalizedOperator(node);
        if (operator === "!" || operator === "not") {
            // GML does not support the operator 'not'; this is included to automatic fixing
            const argumentExpr = toBooleanExpression(node.argument, context);
            if (!argumentExpr) {
                return null;
            }
            return createBooleanNot(argumentExpr);
        }
    }

    if (node.type === "BinaryExpression") {
        const operator = Core.getNormalizedOperator(node);
        if (Core.isLogicalAndOperator(operator)) {
            const left = toBooleanExpression(node.left, context);
            const right = toBooleanExpression(node.right, context);
            if (!left || !right) {
                return null;
            }
            return createBooleanAnd([left, right]);
        }
        if (Core.isLogicalOrOperator(operator)) {
            const left = toBooleanExpression(node.left, context);
            const right = toBooleanExpression(node.right, context);
            if (!left || !right) {
                return null;
            }
            return createBooleanOr([left, right]);
        }
    }

    const variable = registerVariable(node, context);
    return createBooleanVariable(variable);
}

function combineConditionalBoolean(testExpr, consequentExpr, alternateExpr) {
    const whenTrue = createBooleanAnd([testExpr, consequentExpr]);
    const whenFalse = createBooleanAnd([createBooleanNot(testExpr), alternateExpr]);
    return createBooleanOr([whenTrue, whenFalse]);
}

/**
 * Builds a simplified and factored candidate expression from given indices (minterms or maxterms).
 * Encapsulates the common normalization pipeline: implicant minimization -> simplify -> factor -> candidate.
 * This extracts the shared transformation pattern from generateSimplifiedCandidates, letting each
 * normalized form (DNF/CNF) be produced via a single call rather than an inline pipeline.
 */
function buildNormalizedFormCandidate(
    indices: readonly number[],
    variableCount: number,
    negated: boolean
): ReturnType<typeof simplifyBooleanExpression> {
    const expression = buildExpressionFromImplicants(indices, variableCount, negated);
    const simplified = simplifyBooleanExpression(expression);
    return factorBooleanExpression(simplified);
}

function generateSimplifiedCandidates(expression, context) {
    const simplifiedBase = simplifyBooleanExpression(expression);
    const truthTable = evaluateTruthTable(simplifiedBase, context.variables.length);

    if (truthTable.minterms.length === 0) {
        return [createBooleanConstant(false)];
    }

    if (truthTable.minterms.length === truthTable.total) {
        return [createBooleanConstant(true)];
    }

    const candidates = new Map();

    addCandidate(candidates, simplifiedBase);
    addCandidate(candidates, factorBooleanExpression(simplifiedBase));

    const dnf = buildNormalizedFormCandidate(truthTable.minterms, context.variables.length, false);
    addCandidate(candidates, dnf);

    const cnf = buildNormalizedFormCandidate(truthTable.maxterms, context.variables.length, true);
    addCandidate(candidates, cnf);

    return [...candidates.values()];
}

function addCandidate(map, candidate) {
    if (!candidate) {
        return;
    }
    const key = booleanExpressionKey(candidate);
    if (!map.has(key)) {
        map.set(key, candidate);
    }
}

function evaluateTruthTable(expression, variableCount) {
    const minterms = [];
    const maxterms = [];
    const total = 1 << variableCount;

    for (let mask = 0; mask < total; mask++) {
        const assignment = buildAssignment(mask, variableCount);
        const value = evaluateBooleanExpression(expression, assignment);
        if (value) {
            minterms.push(mask);
        } else {
            maxterms.push(mask);
        }
    }

    return { minterms, maxterms, total };
}

function buildAssignment(mask, variableCount) {
    const assignment = Array.from({ length: variableCount });
    for (let index = 0; index < variableCount; index++) {
        assignment[index] = (mask & (1 << index)) !== 0;
    }
    return assignment;
}

function evaluateBooleanExpression(expression, assignment) {
    switch (expression.type) {
        case BOOLEAN_NODE_TYPES.CONST: {
            return expression.value;
        }
        case BOOLEAN_NODE_TYPES.VAR: {
            return assignment[expression.variable.index] ?? false;
        }
        case BOOLEAN_NODE_TYPES.NOT: {
            return !evaluateBooleanExpression(expression.argument, assignment);
        }
        case BOOLEAN_NODE_TYPES.AND: {
            for (const term of expression.terms) {
                if (!evaluateBooleanExpression(term, assignment)) {
                    return false;
                }
            }
            return true;
        }
        case BOOLEAN_NODE_TYPES.OR: {
            for (const term of expression.terms) {
                if (evaluateBooleanExpression(term, assignment)) {
                    return true;
                }
            }
            return false;
        }
        default: {
            return false;
        }
    }
}

function buildExpressionFromImplicants(indices, variableCount, negated) {
    if (indices.length === 0) {
        return createBooleanConstant(negated);
    }

    const implicants = minimizeWithQuineMcCluskey(indices, variableCount);
    if (negated) {
        const clauses = implicants.map((implicant) => buildClauseFromImplicant(implicant, variableCount));
        return createBooleanAnd(clauses);
    }

    const terms = implicants.map((implicant) => buildTermFromImplicant(implicant, variableCount));
    return createBooleanOr(terms);
}

function minimizeWithQuineMcCluskey(minterms, variableCount) {
    const implicants = minterms.map((value) => createImplicant(value, 0, [value]));
    const primes = [];
    let current = implicants;

    while (current.length > 0) {
        const { combined, leftovers } = combineImplicants(current, variableCount);
        primes.push(...leftovers);
        current = combined;
    }

    return selectPrimeCover(primes, minterms);
}

function createImplicant(value, mask, covered) {
    return { value, mask, covered: new Set(covered) };
}

function combineImplicants(implicants, variableCount) {
    const combinedMap = new Map();
    const used = new Set();

    for (let i = 0; i < implicants.length; i++) {
        const a = implicants[i];
        for (let j = i + 1; j < implicants.length; j++) {
            const b = implicants[j];
            if (a.mask !== b.mask) {
                continue;
            }

            const diff = a.value ^ b.value;
            if (!isSingleBit(diff, variableCount)) {
                continue;
            }
            if ((a.mask & diff) !== 0) {
                continue;
            }

            const combinedMask = a.mask | diff;
            const combinedValue = a.value & ~diff;
            const key = `${combinedValue}:${combinedMask}`;

            used.add(i);
            used.add(j);

            if (combinedMap.has(key)) {
                const existing = combinedMap.get(key);
                for (const entry of a.covered) {
                    existing.covered.add(entry);
                }
                for (const entry of b.covered) {
                    existing.covered.add(entry);
                }
            } else {
                const covered = new Set([...a.covered, ...b.covered]);
                combinedMap.set(key, createImplicant(combinedValue, combinedMask, covered));
            }
        }
    }

    const leftovers = [];
    for (const [i, implicant] of implicants.entries()) {
        if (!used.has(i)) {
            leftovers.push(implicant);
        }
    }

    const combined = [...combinedMap.values()];
    return { combined, leftovers };
}

function isSingleBit(value, variableCount) {
    if (value === 0) {
        return false;
    }
    return (value & (value - 1)) === 0 && value < 1 << variableCount;
}

function selectPrimeCover(primes, minterms) {
    if (primes.length === 0) {
        return [];
    }

    const mintermCoverage = new Map();
    for (const [index, implicant] of primes.entries()) {
        for (const term of implicant.covered) {
            if (!mintermCoverage.has(term)) {
                mintermCoverage.set(term, []);
            }
            mintermCoverage.get(term).push(index);
        }
    }

    const selected = new Set<number>();
    const remainingMinterms = new Set(minterms);

    for (const minterm of minterms) {
        const covering = mintermCoverage.get(minterm) ?? [];
        if (covering.length === 1) {
            selected.add(covering[0]);
        }
    }

    for (const index of selected) {
        const implicant = primes[index];
        for (const term of implicant.covered) {
            remainingMinterms.delete(term);
        }
    }

    if (remainingMinterms.size === 0) {
        return [...selected].map((index: number) => primes[index]);
    }

    const remainingIndices: number[] = [];
    for (let i = 0; i < primes.length; i++) {
        if (!selected.has(i)) {
            remainingIndices.push(i);
        }
    }

    const additional = searchMinimalCover(primes, remainingIndices, remainingMinterms);
    for (const index of additional) {
        selected.add(index);
    }

    return [...selected].map((index: number) => primes[index]);
}

function searchMinimalCover(primes, candidateIndices, remainingMinterms) {
    const remainingArray = [...remainingMinterms];
    let best = null;

    function dfs(position, chosen, covered) {
        if (covered.size === remainingArray.length) {
            if (!best || chosen.length < best.length) {
                best = [...chosen];
            }
            return;
        }

        if (position >= candidateIndices.length) {
            return;
        }

        if (best && chosen.length >= best.length) {
            return;
        }

        const remainingNeeded = remainingArray.filter((_, idx) => !covered.has(idx));
        if (remainingNeeded.length === 0) {
            if (!best || chosen.length < best.length) {
                best = [...chosen];
            }
            return;
        }

        for (let i = position; i < candidateIndices.length; i++) {
            const index = candidateIndices[i];
            const implicant = primes[index];
            const newCovered = new Set(covered);

            for (const [j, element] of remainingArray.entries()) {
                if (implicant.covered.has(element)) {
                    newCovered.add(j);
                }
            }

            chosen.push(index);
            dfs(i + 1, chosen, newCovered);
            chosen.pop();
        }
    }

    dfs(0, [], new Set());
    return best ?? [];
}

function buildTermFromImplicant(implicant, variableCount) {
    const factors = [];
    for (let index = 0; index < variableCount; index++) {
        const bit = 1 << index;
        if ((implicant.mask & bit) !== 0) {
            continue;
        }
        const positive = (implicant.value & bit) !== 0;
        const variable = createBooleanVariable({ index });
        factors.push(positive ? variable : createBooleanNot(variable));
    }

    if (factors.length === 0) {
        return createBooleanConstant(true);
    }

    if (factors.length === 1) {
        return factors[0];
    }

    return createBooleanAnd(factors);
}

function buildClauseFromImplicant(implicant, variableCount) {
    const terms = [];
    for (let index = 0; index < variableCount; index++) {
        const bit = 1 << index;
        if ((implicant.mask & bit) !== 0) {
            continue;
        }
        const positive = (implicant.value & bit) !== 0;
        const variable = createBooleanVariable({ index });
        terms.push(positive ? createBooleanNot(variable) : variable);
    }

    if (terms.length === 0) {
        return createBooleanConstant(false);
    }

    if (terms.length === 1) {
        return terms[0];
    }

    return createBooleanOr(terms);
}

function simplifyBooleanExpression(expression) {
    let current = normalizeBooleanExpression(expression);
    let iterations = 0;

    while (iterations < 50) {
        const simplified = simplifyBooleanStep(current);
        const normalized = normalizeBooleanExpression(simplified);
        if (booleanExpressionKey(normalized) === booleanExpressionKey(current)) {
            return normalized;
        }
        current = normalized;
        iterations++;
    }

    return current;
}

function simplifyBooleanStep(expression) {
    switch (expression.type) {
        case BOOLEAN_NODE_TYPES.CONST:
        case BOOLEAN_NODE_TYPES.VAR: {
            return expression;
        }
        case BOOLEAN_NODE_TYPES.NOT: {
            const simplifiedArg = simplifyBooleanStep(expression.argument);
            if (simplifiedArg.type === BOOLEAN_NODE_TYPES.CONST) {
                return createBooleanConstant(!simplifiedArg.value);
            }
            if (simplifiedArg.type === BOOLEAN_NODE_TYPES.NOT) {
                return simplifyBooleanStep(simplifiedArg.argument);
            }
            if (simplifiedArg.type === BOOLEAN_NODE_TYPES.AND) {
                return createBooleanOr(simplifiedArg.terms.map((term) => createBooleanNot(term)));
            }
            if (simplifiedArg.type === BOOLEAN_NODE_TYPES.OR) {
                return createBooleanAnd(simplifiedArg.terms.map((term) => createBooleanNot(term)));
            }
            return createBooleanNot(simplifiedArg);
        }
        case BOOLEAN_NODE_TYPES.AND:
        case BOOLEAN_NODE_TYPES.OR: {
            const simplifiedTerms = expression.terms.map((term) => simplifyBooleanStep(term));
            const filteredTerms = collapseAssociativeTerms(expression.type, simplifiedTerms);
            if (filteredTerms.length === 0) {
                return expression.type === BOOLEAN_NODE_TYPES.AND
                    ? createBooleanConstant(true)
                    : createBooleanConstant(false);
            }
            if (filteredTerms.length === 1) {
                return filteredTerms[0];
            }
            const absorbed = applyAbsorption(expression.type, filteredTerms);
            const deduped = removeDuplicateTerms(expression.type, absorbed);
            const complemented = applyComplementLaw(expression.type, deduped);
            return expression.type === BOOLEAN_NODE_TYPES.AND
                ? createBooleanAnd(complemented)
                : createBooleanOr(complemented);
        }
        default: {
            return expression;
        }
    }
}

function normalizeBooleanExpression(expression) {
    if (expression.type !== BOOLEAN_NODE_TYPES.AND && expression.type !== BOOLEAN_NODE_TYPES.OR) {
        return expression;
    }

    const normalizedTerms = [];
    for (const term of expression.terms) {
        const normalized = normalizeBooleanExpression(term);
        if (normalized.type === expression.type) {
            normalizedTerms.push(...normalized.terms);
        } else {
            normalizedTerms.push(normalized);
        }
    }

    return expression.type === BOOLEAN_NODE_TYPES.AND
        ? createBooleanAnd(normalizedTerms)
        : createBooleanOr(normalizedTerms);
}

function collapseAssociativeTerms(type, terms) {
    const result = [];
    const identity = type === BOOLEAN_NODE_TYPES.AND ? true : false;
    const annihilator = type === BOOLEAN_NODE_TYPES.AND ? false : true;

    for (const term of terms) {
        if (term.type === BOOLEAN_NODE_TYPES.CONST) {
            if (term.value === annihilator) {
                return [term];
            }
            if (term.value === identity) {
                continue;
            }
        }
        result.push(term);
    }

    return result;
}

function applyAbsorption(type, terms) {
    if (terms.length < 2) {
        return terms;
    }

    return absorbTermsForOperator(type, terms);
}

/**
 * Removes composite sub-terms that are absorbed by a simpler term in the list,
 * applying the absorption law for either an OR or AND expression.
 *
 * For an OR expression (type=OR), any AND sub-term is absorbed when another
 * term in the list already covers all of its factors (A OR (A AND B) = A).
 * For an AND expression (type=AND), any OR sub-term is absorbed when another
 * term already covers all of its factors (A AND (A OR B) = A).
 */
function absorbTermsForOperator(type, terms) {
    // The "absorbable" type is the dual operator: AND terms can be absorbed inside OR,
    // and OR terms can be absorbed inside AND.
    const absorbableType = type === BOOLEAN_NODE_TYPES.OR ? BOOLEAN_NODE_TYPES.AND : BOOLEAN_NODE_TYPES.OR;
    const result = [];

    for (let i = 0; i < terms.length; i++) {
        const term = terms[i];
        if (term.type === absorbableType && hasContainingTerm(term.terms, terms, i)) {
            continue;
        }

        result.push(term);
    }

    return result;
}

function hasContainingTerm(candidates, terms, skipIndex) {
    for (const [j, other] of terms.entries()) {
        if (j === skipIndex) {
            continue;
        }

        if (containsTerm(candidates, other)) {
            return true;
        }
    }

    return false;
}

function containsTerm(terms, target) {
    const targetKey = booleanExpressionKey(target);
    for (const term of terms) {
        if (booleanExpressionKey(term) === targetKey) {
            return true;
        }
    }
    return false;
}

function removeDuplicateTerms(type, terms) {
    const seen = new Map();
    const result = [];

    for (const term of terms) {
        const key = booleanExpressionKey(term);
        if (!seen.has(key)) {
            seen.set(key, true);
            result.push(term);
        }
    }

    return result;
}

function applyComplementLaw(type, terms) {
    const seen = new Map();

    for (const term of terms) {
        const key = booleanExpressionKey(term);
        seen.set(key, term);
    }

    for (const term of terms) {
        if (term.type === BOOLEAN_NODE_TYPES.NOT) {
            const childKey = booleanExpressionKey(term.argument);
            if (seen.has(childKey)) {
                return [type === BOOLEAN_NODE_TYPES.AND ? createBooleanConstant(false) : createBooleanConstant(true)];
            }
        } else {
            const negatedKey = booleanExpressionKey(createBooleanNot(term));
            if (seen.has(negatedKey)) {
                return [type === BOOLEAN_NODE_TYPES.AND ? createBooleanConstant(false) : createBooleanConstant(true)];
            }
        }
    }

    return terms;
}

function factorBooleanExpression(expression) {
    if (!isObjectLike(expression)) {
        return expression;
    }

    const factoredChildren = (() => {
        switch (expression.type) {
            case BOOLEAN_NODE_TYPES.AND:
            case BOOLEAN_NODE_TYPES.OR: {
                return expression.terms.map((term) => factorBooleanExpression(term));
            }
            case BOOLEAN_NODE_TYPES.NOT: {
                return [factorBooleanExpression(expression.argument)];
            }
            default: {
                return [];
            }
        }
    })();

    if (expression.type === BOOLEAN_NODE_TYPES.AND || expression.type === BOOLEAN_NODE_TYPES.OR) {
        const rebuilt =
            expression.type === BOOLEAN_NODE_TYPES.AND
                ? createBooleanAnd(factoredChildren)
                : createBooleanOr(factoredChildren);

        if (rebuilt.type === BOOLEAN_NODE_TYPES.OR || rebuilt.type === BOOLEAN_NODE_TYPES.AND) {
            const factored = factorAssociativeExpression(rebuilt);
            return simplifyBooleanExpression(factored);
        }

        return rebuilt;
    }

    if (expression.type === BOOLEAN_NODE_TYPES.NOT) {
        return createBooleanNot(factoredChildren[0]);
    }

    return expression;
}

/**
 * Factors out a common sub-expression from an AND or OR expression by applying
 * the distributive law in the direction appropriate for the expression's type:
 * - For an OR expression: `(A AND B) OR (A AND C)` → `A AND (B OR C)`
 * - For an AND expression: `(A OR B) AND (A OR C)` → `A OR (B AND C)`
 *
 * When multiple candidate factors exist the one yielding the least-complex
 * result (fewest literals, then operators, then depth) is chosen.
 */
function factorAssociativeExpression(expression) {
    const isOr = expression.type === BOOLEAN_NODE_TYPES.OR;
    // subTermType: the operator of the sub-terms we will factor across.
    // For OR expressions we factor AND sub-terms; for AND expressions, OR sub-terms.
    const subTermType = isOr ? BOOLEAN_NODE_TYPES.AND : BOOLEAN_NODE_TYPES.OR;
    const createInner = isOr ? createBooleanAnd : createBooleanOr;
    const createOuter = isOr ? createBooleanOr : createBooleanAnd;

    const candidateFactors = new Map();
    const innerTerms = [];

    for (const [index, term] of expression.terms.entries()) {
        if (term.type === subTermType) {
            const factors = term.terms.map((factor, position) => ({
                factor,
                position
            }));
            innerTerms.push({ term, index, factors });
            for (const { factor } of factors) {
                const key = booleanExpressionKey(factor);
                const occurrences = getOrCreateMapEntry(candidateFactors, key, () => []);
                occurrences.push({
                    termIndex: index,
                    factor
                });
            }
        }
    }

    let best = null;

    for (const [key, occurrences] of candidateFactors.entries()) {
        if (occurrences.length < 2) {
            continue;
        }

        const factor = occurrences[0].factor;
        const involvedIndices = new Set(occurrences.map((item) => item.termIndex));
        const { residualTerms, factorPosition } = buildResidualTermsForKey(
            innerTerms,
            involvedIndices,
            key,
            createInner
        );

        if (factorPosition == undefined) {
            continue;
        }

        const otherTerms = expression.terms.filter((_, index) => !involvedIndices.has(index));

        // Group the residual terms with the outer operator, then combine with
        // the factored-out value using the inner operator.
        const groupedResiduals = createOuter(residualTerms);
        const factoredPair = factorPosition > 0 ? [groupedResiduals, factor] : [factor, groupedResiduals];
        const candidate =
            otherTerms.length === 0
                ? createInner(factoredPair)
                : createOuter([createInner(factoredPair), ...otherTerms]);

        const simplifiedCandidate = simplifyBooleanExpression(candidate);
        if (!best || compareExpressionComplexity(simplifiedCandidate, best) < 0) {
            best = simplifiedCandidate;
        }
    }

    return best ?? expression;
}

function compareExpressionComplexity(a, b) {
    const aMetrics = computeExpressionMetrics(a);
    const bMetrics = computeExpressionMetrics(b);

    if (aMetrics.literals !== bMetrics.literals) {
        return aMetrics.literals - bMetrics.literals;
    }

    if (aMetrics.operators !== bMetrics.operators) {
        return aMetrics.operators - bMetrics.operators;
    }

    if (aMetrics.depth !== bMetrics.depth) {
        return aMetrics.depth - bMetrics.depth;
    }

    const aKey = booleanExpressionKey(a);
    const bKey = booleanExpressionKey(b);
    return aKey.localeCompare(bKey);
}

function computeExpressionMetrics(expression) {
    let literals = 0;
    let operators = 0;
    let depth = 0;

    function walk(node, currentDepth) {
        if (!node) {
            return;
        }

        if (node.type === BOOLEAN_NODE_TYPES.VAR) {
            literals += 1;
            depth = Math.max(depth, currentDepth);
            return;
        }

        if (node.type === BOOLEAN_NODE_TYPES.CONST) {
            depth = Math.max(depth, currentDepth);
            return;
        }

        operators += 1;
        depth = Math.max(depth, currentDepth);

        if (node.type === BOOLEAN_NODE_TYPES.NOT) {
            walk(node.argument, currentDepth + 1);
            return;
        }

        if (node.type === BOOLEAN_NODE_TYPES.AND || node.type === BOOLEAN_NODE_TYPES.OR) {
            for (const term of node.terms) {
                walk(term, currentDepth + 1);
            }
        }
    }

    walk(expression, 1);
    return { literals, operators, depth };
}

function chooseBestCandidate(candidates) {
    if (!isNonEmptyArray(candidates)) {
        return null;
    }

    let best = candidates[0];
    for (let index = 1; index < candidates.length; index++) {
        const candidate = candidates[index];
        if (compareExpressionComplexity(candidate, best) < 0) {
            best = candidate;
        }
    }
    return best;
}

function buildResidualTermsForKey(terms, involvedIndices, key, createResidualExpression) {
    const residualTerms = [];
    let factorPosition = null;

    for (const { index, factors } of terms) {
        if (!involvedIndices.has(index)) {
            continue;
        }

        const remaining = [];
        for (const { factor: candidate, position } of factors) {
            if (booleanExpressionKey(candidate) === key) {
                if (factorPosition == undefined) {
                    factorPosition = position;
                }
                continue;
            }

            remaining.push(candidate);
        }

        if (remaining.length === 0) {
            factorPosition = null;
            break;
        }

        residualTerms.push(remaining.length === 1 ? remaining[0] : createResidualExpression(remaining));
    }

    return { residualTerms, factorPosition };
}

function booleanExpressionToAst(expression, context) {
    switch (expression.type) {
        case BOOLEAN_NODE_TYPES.CONST: {
            return createBooleanLiteralAst(expression.value);
        }
        case BOOLEAN_NODE_TYPES.VAR: {
            return cloneAstNode(context.variables[expression.variable.index]?.node);
        }
        case BOOLEAN_NODE_TYPES.NOT: {
            const argumentAst = booleanExpressionToAst(expression.argument, context);
            if (!argumentAst) {
                return null;
            }
            return {
                type: "UnaryExpression",
                operator: "!",
                prefix: true,
                argument: wrapUnaryArgument(argumentAst),
                start: cloneLocation(argumentAst.start),
                end: cloneLocation(argumentAst.end)
            };
        }
        case BOOLEAN_NODE_TYPES.AND: {
            return buildBinaryAst("&&", expression.terms, context);
        }
        case BOOLEAN_NODE_TYPES.OR: {
            return buildBinaryAst("||", expression.terms, context);
        }
        default: {
            return null;
        }
    }
}

function buildBinaryAst(operator, terms, context) {
    if (terms.length === 0) {
        return null;
    }
    if (terms.length === 1) {
        return booleanExpressionToAst(terms[0], context);
    }

    let originalOrOrder = null;
    if (operator === "||") {
        originalOrOrder = new WeakMap();
        for (const [index, term] of terms.entries()) {
            if (term && typeof term === "object") {
                originalOrOrder.set(term, index);
            }
        }
    }

    const orderedTerms =
        operator === "||"
            ? [...terms].toSorted((left, right) => {
                  const leftPriority = getBooleanOrTermPriority(left);
                  const rightPriority = getBooleanOrTermPriority(right);
                  if (leftPriority !== rightPriority) {
                      return leftPriority - rightPriority;
                  }

                  const leftStart = getBooleanExpressionSourceStart(left, context);
                  const rightStart = getBooleanExpressionSourceStart(right, context);
                  if (leftStart !== rightStart) {
                      return leftStart - rightStart;
                  }

                  const leftIndex = getOriginalBooleanTermIndex(originalOrOrder, left);
                  const rightIndex = getOriginalBooleanTermIndex(originalOrOrder, right);
                  return leftIndex - rightIndex;
              })
            : terms;

    let current = booleanExpressionToAst(orderedTerms[0], context);
    for (let index = 1; index < orderedTerms.length; index++) {
        const right = booleanExpressionToAst(orderedTerms[index], context);
        if (!current || !right) {
            return null;
        }
        current = {
            type: "BinaryExpression",
            operator,
            left: wrapBinaryOperand(current, operator, "left"),
            right: wrapBinaryOperand(right, operator, "right"),
            start: cloneLocation(current.start),
            end: cloneLocation(right.end)
        };
    }

    return current;
}

function getBooleanOrTermPriority(expression) {
    if (!isObjectLike(expression)) {
        return 1;
    }

    return expression.type === BOOLEAN_NODE_TYPES.NOT ? 0 : 1;
}

function getOriginalBooleanTermIndex(orderMap, term) {
    if (!orderMap || !isObjectLike(term)) {
        return Number.MAX_SAFE_INTEGER;
    }

    const index = orderMap.get(term);
    return typeof index === "number" ? index : Number.MAX_SAFE_INTEGER;
}

function getBooleanExpressionSourceStart(expression, context) {
    if (!isObjectLike(expression)) {
        return Number.POSITIVE_INFINITY;
    }

    switch (expression.type) {
        case BOOLEAN_NODE_TYPES.VAR: {
            if (!context || !Array.isArray(context.variables)) {
                return Number.POSITIVE_INFINITY;
            }

            const variableRecord = context.variables[expression.variable?.index];
            return getNodeLocationIndex(variableRecord?.node);
        }
        case BOOLEAN_NODE_TYPES.NOT: {
            return getBooleanExpressionSourceStart(expression.argument, context);
        }
        case BOOLEAN_NODE_TYPES.AND:
        case BOOLEAN_NODE_TYPES.OR: {
            let earliest = Number.POSITIVE_INFINITY;
            for (const term of expression.terms ?? []) {
                const termStart = getBooleanExpressionSourceStart(term, context);
                if (termStart < earliest) {
                    earliest = termStart;
                }
            }
            return earliest;
        }
        case BOOLEAN_NODE_TYPES.CONST: {
            return getNodeLocationIndex(expression.node);
        }
        default: {
            return Number.POSITIVE_INFINITY;
        }
    }
}

function getNodeLocationIndex(node) {
    if (!isObjectLike(node)) {
        return Number.POSITIVE_INFINITY;
    }

    const start = node.start;
    if (typeof start === "number") {
        return start;
    }

    if (start && typeof start.index === "number") {
        return start.index;
    }

    return Number.POSITIVE_INFINITY;
}

function wrapBinaryOperand(node, parentOperator, position) {
    if (!node || node.type !== "BinaryExpression") {
        return node;
    }

    const childOperator = node.operator;
    const shouldWrap = parentOperator === "&&" && childOperator === "||";

    if (!shouldWrap) {
        return node;
    }

    return {
        type: "ParenthesizedExpression",
        expression: node,
        start: cloneLocation(node.start),
        end: cloneLocation(node.end),
        synthetic: true,
        position
    };
}

function wrapUnaryArgument(node) {
    if (!node) {
        return node;
    }

    if (node.type !== "BinaryExpression" && node.type !== "LogicalExpression") {
        return node;
    }

    return {
        type: "ParenthesizedExpression",
        expression: node,
        start: cloneLocation(node.start),
        end: cloneLocation(node.end),
        synthetic: true
    };
}

function postProcessBooleanExpression(expression) {
    let current = expression;
    let iterations = 0;

    while (iterations < 5) {
        const transformed = transformMixedReductionPattern(transformXorPattern(current));
        if (booleanExpressionKey(transformed) === booleanExpressionKey(current)) {
            return transformed;
        }
        current = transformed;
        iterations++;
    }

    return current;
}

function transformXorPattern(expression) {
    if (!expression || expression.type !== BOOLEAN_NODE_TYPES.AND) {
        return expression;
    }

    const { terms } = expression;
    if (!Array.isArray(terms) || terms.length !== 2) {
        return expression;
    }

    const [first, second] = terms;
    const base = isPlainOrOfVariables(first) ? first : isPlainOrOfVariables(second) ? second : null;
    if (!base) {
        return expression;
    }

    const other = base === first ? second : first;
    if (!isOrOfNegatedVariables(other)) {
        return expression;
    }

    const baseVarIndices = collectVariableIndices(base.terms);
    const negatedVarIndices = collectVariableIndices(other.terms.map((term) => term.argument));

    if (!arraysEqual(baseVarIndices, negatedVarIndices)) {
        return expression;
    }

    const baseClone = cloneAstNode(base);
    const andTerm = createBooleanAnd(
        baseVarIndices.map((index) =>
            createBooleanVariable({
                index,
                node: findVariableNode(base, index)
            })
        )
    );
    const notAnd = createBooleanNot(andTerm);

    return createBooleanAnd([baseClone, notAnd]);
}

function transformMixedReductionPattern(expression) {
    if (!expression || expression.type !== BOOLEAN_NODE_TYPES.AND) {
        return expression;
    }

    const { terms } = expression;
    if (!Array.isArray(terms)) {
        return expression;
    }

    if (terms.length === 2) {
        const baseOr = terms.find((term) => isPlainOrOfVariables(term));
        const positiveVarTerm = terms.find((term) => term !== baseOr && term?.type === BOOLEAN_NODE_TYPES.VAR);

        if (baseOr && positiveVarTerm) {
            const baseIndices = collectVariableIndices(baseOr.terms);
            const positiveIndex = positiveVarTerm.variable?.index;

            if (
                baseIndices.length >= 2 &&
                typeof positiveIndex === "number" &&
                baseIndices.every((index) => typeof index === "number" && index < positiveIndex)
            ) {
                const baseAnd = createBooleanAnd(
                    baseIndices.map((index) =>
                        createBooleanVariable({
                            index,
                            node: findVariableNode(baseOr, index)
                        })
                    )
                );
                const notBase = createBooleanNot(baseAnd);
                return createBooleanOr([cloneAstNode(positiveVarTerm), notBase]);
            }
        }
    }

    const orTerms = terms.filter((term) => term.type === BOOLEAN_NODE_TYPES.OR);
    if (orTerms.length !== 3) {
        return expression;
    }

    let positiveOr = null;
    const negatedOrs = [];

    for (const term of orTerms) {
        const { plain, negated, others } = categorizeOrTerms(term.terms);
        if (others > 0) {
            return expression;
        }

        if (negated.length === 0 && plain.length === 2) {
            if (positiveOr) {
                return expression;
            }
            positiveOr = { term, vars: plain };
        } else if (negated.length === 1 && plain.length === 1) {
            negatedOrs.push({ term, negated: negated[0], positive: plain[0] });
        } else {
            return expression;
        }
    }

    if (!positiveOr || negatedOrs.length !== 2) {
        return expression;
    }

    const [varA, varB] = positiveOr.vars;
    const sharedPositiveIndex = negatedOrs[0].positive;

    if (
        negatedOrs.some((entry) => entry.positive !== sharedPositiveIndex) ||
        ![varA, varB].includes(negatedOrs[0].negated) ||
        ![varA, varB].includes(negatedOrs[1].negated)
    ) {
        return expression;
    }

    const negatedIndices = new Set([negatedOrs[0].negated, negatedOrs[1].negated]);
    if (negatedIndices.size !== 2 || !negatedIndices.has(varA) || !negatedIndices.has(varB)) {
        return expression;
    }

    const positiveVarNode = findVariableNodeFromOrTerms(negatedOrs, sharedPositiveIndex);
    if (!positiveVarNode) {
        return expression;
    }

    const baseAnd = createBooleanAnd(
        positiveOr.vars.map((index) =>
            createBooleanVariable({
                index,
                node: findVariableNode(positiveOr.term, index)
            })
        )
    );
    const notBase = createBooleanNot(baseAnd);
    const positiveVar = createBooleanVariable({
        index: sharedPositiveIndex,
        node: positiveVarNode
    });

    return createBooleanOr([positiveVar, notBase]);
}

function isPlainOrOfVariables(expression) {
    if (!expression || expression.type !== BOOLEAN_NODE_TYPES.OR) {
        return false;
    }

    return expression.terms.every((term) => term.type === BOOLEAN_NODE_TYPES.VAR);
}

function isOrOfNegatedVariables(expression) {
    if (!expression || expression.type !== BOOLEAN_NODE_TYPES.OR) {
        return false;
    }

    return expression.terms.every(
        (term) => term.type === BOOLEAN_NODE_TYPES.NOT && term.argument?.type === BOOLEAN_NODE_TYPES.VAR
    );
}

function collectVariableIndices(terms) {
    const indices = terms.map((term) => term?.variable?.index).filter((index) => typeof index === "number");
    return indices.toSorted((a, b) => a - b);
}

function arraysEqual(a, b) {
    if (a.length !== b.length) {
        return false;
    }

    for (const [index, element] of a.entries()) {
        if (element !== b[index]) {
            return false;
        }
    }

    return true;
}

function findVariableNode(orExpression, index) {
    if (!orExpression || orExpression.type !== BOOLEAN_NODE_TYPES.OR) {
        return null;
    }

    for (const term of orExpression.terms) {
        if (term?.type === BOOLEAN_NODE_TYPES.VAR && term.variable?.index === index) {
            return term.variable.node ?? null;
        }
    }

    return null;
}

function findVariableNodeFromOrTerms(negatedOrs, index) {
    for (const entry of negatedOrs) {
        for (const term of entry.term.terms) {
            if (term.type === BOOLEAN_NODE_TYPES.VAR && term.variable?.index === index) {
                return term.variable.node ?? null;
            }
        }
    }

    return null;
}

function categorizeOrTerms(terms) {
    const plain = [];
    const negated = [];
    let others = 0;

    for (const term of terms) {
        if (term.type === BOOLEAN_NODE_TYPES.VAR) {
            plain.push(term.variable?.index);
        } else if (term.type === BOOLEAN_NODE_TYPES.NOT && term.argument?.type === BOOLEAN_NODE_TYPES.VAR) {
            negated.push(term.argument.variable?.index);
        } else {
            others++;
        }
    }

    return { plain, negated, others };
}

function createBooleanLiteralAst(value) {
    return {
        type: "Literal",
        value: value ? "true" : "false",
        start: undefined,
        end: undefined
    };
}

function createBooleanConstant(value) {
    return { type: BOOLEAN_NODE_TYPES.CONST, value: !!value };
}

function createBooleanVariable(variable) {
    return { type: BOOLEAN_NODE_TYPES.VAR, variable };
}

function createBooleanNot(argument) {
    return { type: BOOLEAN_NODE_TYPES.NOT, argument };
}

function createBooleanAnd(terms) {
    return { type: BOOLEAN_NODE_TYPES.AND, terms: compactArray(terms) };
}

function createBooleanOr(terms) {
    return { type: BOOLEAN_NODE_TYPES.OR, terms: compactArray(terms) };
}

function booleanExpressionKey(expression) {
    if (!expression) {
        return "";
    }

    switch (expression.type) {
        case BOOLEAN_NODE_TYPES.CONST: {
            return expression.value ? "1" : "0";
        }
        case BOOLEAN_NODE_TYPES.VAR: {
            return `v:${expression.variable.index}`;
        }
        case BOOLEAN_NODE_TYPES.NOT: {
            return `n:${booleanExpressionKey(expression.argument)}`;
        }
        case BOOLEAN_NODE_TYPES.AND: {
            const keys = expression.terms.map((term) => booleanExpressionKey(term)).toSorted();
            return `a:${keys.join(",")}`;
        }
        case BOOLEAN_NODE_TYPES.OR: {
            const keys = expression.terms.map((term) => booleanExpressionKey(term)).toSorted();
            return `o:${keys.join(",")}`;
        }
        default: {
            return "";
        }
    }
}

function stringifyNodeScalar(value: unknown) {
    if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint"
    ) {
        return String(value);
    }
    return "";
}

function getAstNodeKey(node: unknown) {
    if (node === null) {
        return "null";
    }

    if (node === undefined) {
        return "undefined";
    }

    if (Array.isArray(node)) {
        return `Array:[${node.map((item) => getAstNodeKey(item)).join(",")}]`;
    }

    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean" || typeof node === "bigint") {
        return String(node);
    }

    if (typeof node === "symbol") {
        return node.toString();
    }

    if (typeof node === "function") {
        return `[Function:${node.name || "anonymous"}]`;
    }

    const typedNode = node as Record<string, unknown>;
    const { type } = typedNode;
    if (typeof type !== "string" || type.length === 0) {
        const entries = Object.entries(typedNode)
            .filter(([key]) => !IGNORED_NODE_KEYS.has(key))
            .map(([key, value]) => `${key}:${getAstNodeKey(value)}`)
            .join("|");
        return `{${entries}}`;
    }

    switch (type) {
        case "Identifier": {
            return `Identifier:${stringifyNodeScalar(typedNode.name)}`;
        }
        case "Literal": {
            return `Literal:${stringifyNodeScalar(typedNode.value)}`;
        }
        case "MemberDotExpression": {
            return `MemberDot:${getAstNodeKey(typedNode.object)}.${getAstNodeKey(typedNode.property)}`;
        }
        case "MemberIndexExpression": {
            const indices = Array.isArray(typedNode.property)
                ? typedNode.property.map((item) => getAstNodeKey(item)).join(",")
                : getAstNodeKey(typedNode.property);
            return `MemberIndex:${getAstNodeKey(typedNode.object)}[${indices}]`;
        }
        case "CallExpression": {
            return `Call:${getAstNodeKey(typedNode.object)}(${
                Array.isArray(typedNode.arguments) ? typedNode.arguments.map((arg) => getAstNodeKey(arg)).join(",") : ""
            })`;
        }
        case "UnaryExpression": {
            return `Unary:${stringifyNodeScalar(typedNode.operator)}(${getAstNodeKey(typedNode.argument)})`;
        }
        case "BinaryExpression": {
            return `Binary:${stringifyNodeScalar(typedNode.operator)}(${getAstNodeKey(
                typedNode.left
            )}:${getAstNodeKey(typedNode.right)})`;
        }
        case "ParenthesizedExpression": {
            return `Paren:${getAstNodeKey(typedNode.expression)}`;
        }
        default: {
            const entries = Object.entries(typedNode)
                .filter(([key]) => !IGNORED_NODE_KEYS.has(key))
                .map(([key, value]) => `${key}:${getAstNodeKey(value)}`)
                .join("|");
            return `${type}:{${entries}}`;
        }
    }
}
