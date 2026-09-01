/**
 * Condensation entry point for boolean control-flow patterns.
 *
 * This file owns the public API (`applyLogicalExpressionCondensation`) and
 * the statement-level rewrites that drive the condensation pass. The
 * supporting boolean-algebra machinery has been split into focused sibling
 * modules alongside this file:
 *
 * - `./logical-expression-condensation-key.ts` – AST identity helpers used
 *   to deduplicate variables and to walk source locations.
 * - `./logical-expression-condensation-boolean.ts` – the boolean ADT
 *   (constructors, discriminator, key) plus the AST-to-ADT lowering
 *   (`toBooleanExpression`).
 * - `./logical-expression-condensation-truth.ts` – truth-table evaluation
 *   and Quine-McCluskey minimisation.
 * - `./logical-expression-condensation-simplify.ts` – algebraic
 *   simplification, distributive factoring, candidate generation, and the
 *   post-processing passes that recognise XOR / mixed-reduction shapes.
 * - `./logical-expression-condensation-ast.ts` – ADT-to-AST rendering,
 *   including AND/OR precedence and source-order preservation.
 *
 * The split keeps each module under the 1000-line executable-code target
 * while preserving the original public surface and behaviour.
 */
import { Core } from "@gmloop/core";

import { booleanExpressionToAst, createNegationExpression } from "./logical-expression-condensation-ast.js";
import {
    createBooleanContext,
    isBooleanBranchExpression,
    toBooleanExpression
} from "./logical-expression-condensation-boolean.js";
import { TRAVERSAL_IGNORED_KEYS } from "./logical-expression-condensation-key.js";
import {
    evaluateTruthTablePolicy,
    LOGICAL_NORMALIZATION_POLICY_BASELINE,
    type LogicalNormalizationPolicy,
    type TruthTablePolicy
} from "./logical-expression-condensation-policy.js";
import {
    chooseBestCandidate,
    combineConditionalBoolean,
    generateSimplifiedCandidates,
    postProcessBooleanExpression
} from "./logical-expression-condensation-simplify.js";

const { cloneAstNode, cloneLocation, forEachNodeChild, getBooleanLiteralValue, isNode, isNonEmptyArray } = Core;

/**
 * Condenses logical control-flow branches into simplified boolean return
 * expressions.
 *
 * @param ast The AST to condense in place.
 * @param policy Optional policy overriding the baseline truth-table cap and
 *   simplification iteration limits. Defaults to
 *   `LOGICAL_NORMALIZATION_POLICY_BASELINE` so existing callers that don't
 *   expose the option continue to behave exactly as before.
 */
export function applyLogicalExpressionCondensation(
    ast: any,
    policy: LogicalNormalizationPolicy = LOGICAL_NORMALIZATION_POLICY_BASELINE
) {
    if (!isNode(ast)) {
        return ast;
    }

    visit(ast, policy);
    return ast;
}

function visit(node, policy: LogicalNormalizationPolicy = LOGICAL_NORMALIZATION_POLICY_BASELINE) {
    // Walk child nodes and attempt to collapse boolean branches into normalized boolean formulas.
    if (!isNode(node)) {
        return;
    }

    if (Array.isArray(node)) {
        for (const child of node) {
            visit(child, policy);
        }
        return;
    }

    const bodyStatements = Core.getBodyStatements(node);
    if (bodyStatements.length > 0) {
        condenseWithinStatements(bodyStatements, policy);
    } else if (isNode(node.body)) {
        visit(node.body, policy);
    }

    forEachNodeChild(node, (value, key) => {
        if (TRAVERSAL_IGNORED_KEYS.has(key)) {
            return;
        }
        if (isNode(value) || Array.isArray(value)) {
            visit(value, policy);
        }
    });
}

/**
 * Walk the function/block/program body and attempt to condense each statement
 * into a simplified boolean return expression. The traversal pattern is
 * deliberately index-driven with manual advancement: both
 * `tryExtractEarlyExitGuardClause` and `tryCondenseIfStatement` can rewrite the
 * statement currently at `index` (splice in N+1 items, or replace/remove in
 * place), so the loop must not advance past the rewritten slot. Falling
 * through with an unconditional `index++` would skip the freshly inserted
 * element on the next iteration and risk leaving the new guard clause or
 * condensed return unprocessed.
 */
function condenseWithinStatements(
    statements,
    policy: LogicalNormalizationPolicy = LOGICAL_NORMALIZATION_POLICY_BASELINE
) {
    if (!isNonEmptyArray(statements)) {
        return;
    }

    for (let index = 0; index < statements.length;) {
        const statement = statements[index];
        if (!isNode(statement)) {
            index += 1;
            continue;
        }

        if (statement.type === "IfStatement") {
            const extractedGuard = tryExtractEarlyExitGuardClause(statements, index);
            if (extractedGuard) {
                // The original IfStatement was replaced with a new guardIf at
                // `index` (followed by the inlined consequent statements). Leave
                // `index` pointing at the new guardIf so the next iteration
                // re-processes it before advancing into the inlined block.
                continue;
            }

            const condensed = tryCondenseIfStatement(statements, index, policy);
            if (condensed) {
                // The original IfStatement (and possibly its trailing return)
                // was replaced with a new ReturnStatement at `index`. Re-visit
                // the slot in case nested condensing applies to the new
                // expression before moving on.
                continue;
            }
        }

        visit(statement, policy);
        index += 1;
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

function tryCondenseIfStatement(
    statements,
    index,
    policy: LogicalNormalizationPolicy = LOGICAL_NORMALIZATION_POLICY_BASELINE
) {
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

    if (testExpr && consequentExpr && alternateExpr) {
        // Delegate the "should we build a truth table?" decision to the policy
        // evaluator so the threshold is managed in one place and remains
        // independently testable.
        const truthTablePolicy: TruthTablePolicy = Object.freeze({
            maxVariablesForTruthTable: policy.maxVariablesForTruthTable
        });
        const truthTableDecision = evaluateTruthTablePolicy(
            { variableCount: booleanContext.variables.length },
            truthTablePolicy
        );

        if (truthTableDecision.allowTruthTable) {
            const simplificationPolicy = Object.freeze({
                maxSimplificationIterations: policy.maxSimplificationIterations,
                maxPostProcessingIterations: policy.maxPostProcessingIterations
            });
            const combinedExpression = combineConditionalBoolean(testExpr, consequentExpr, alternateExpr);
            const simplifiedCandidates = generateSimplifiedCandidates(
                combinedExpression,
                booleanContext,
                simplificationPolicy
            );
            if (simplifiedCandidates.length > 0) {
                const chosen = chooseBestCandidate(simplifiedCandidates);
                if (chosen) {
                    const optimizedExpr = postProcessBooleanExpression(chosen, simplificationPolicy);
                    argumentAst = booleanExpressionToAst(optimizedExpr, booleanContext);
                }
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
        return Core.asArray(node.body).filter((statement) => isNode(statement));
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
        const body = Core.asArray(node.body);
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
        const body = Core.asArray(node.body);
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
        return createNegationExpression(clone, { wrapBinaryArguments: true });
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

    return createNegationExpression(normalized, { wrapBinaryArguments: true });
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
