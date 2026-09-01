/**
 * Boolean expression simplification pipeline.
 *
 * Built on top of the boolean ADT (`./logical-expression-condensation-boolean.ts`)
 * and the truth-table minimiser (`./logical-expression-condensation-truth.ts`),
 * this module is the part of the pipeline that actually decides which
 * condensation candidate is cheapest. The flow is:
 *
 *   1. Lower the GML AST into the boolean ADT (`toBooleanExpression`).
 *   2. Algebraic simplification (absorption, complement, normalisation).
 *   3. Algebraic factoring (distributive law, complexity comparison).
 *   4. Truth-table minimisation (Quine-McCluskey) → DNF and CNF.
 *   5. Post-processing (XOR / mixed-reduction pattern rewrites).
 *   6. Choose the candidate with the fewest literals.
 *
 * The post-processing pass is kept inside this module because it is only
 * meaningful once the expression has been simplified and factored — running
 * it earlier would invite churn.
 *
 * Extracted from `logical-expression-condensation.ts` to keep the long-file
 * boundary under the 1000-line target. Behavior is preserved exactly; only
 * the source layout has changed.
 */
import { Core } from "@gmloop/core";

import {
    BOOLEAN_NODE_TYPES,
    booleanExpressionKey,
    createBooleanAnd,
    createBooleanConstant,
    createBooleanNot,
    createBooleanOr,
    createBooleanVariable
} from "./logical-expression-condensation-boolean.js";
import { isObjectLike } from "./logical-expression-condensation-key.js";
import { SIMPLIFICATION_POLICY_BASELINE, type SimplificationPolicy } from "./logical-expression-condensation-policy.js";
import { buildExpressionFromImplicants, evaluateTruthTable } from "./logical-expression-condensation-truth.js";

const { cloneAstNode, getOrCreateMapEntry, isNonEmptyArray } = Core;

/**
 * Combines a ternary-style `test ? a : b` into a single boolean expression
 * by expanding the truth table of each branch.
 */
function combineConditionalBoolean(testExpr, consequentExpr, alternateExpr) {
    const whenTrue = createBooleanAnd([testExpr, consequentExpr]);
    const whenFalse = createBooleanAnd([createBooleanNot(testExpr), alternateExpr]);
    return createBooleanOr([whenTrue, whenFalse]);
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

/**
 * Generates the candidate expressions the condensation pass can choose from.
 * The candidates include: the simplified base, a factored version of it, and
 * the truth-table minimised DNF and CNF (each also factored). A degenerate
 * truth table collapses to a constant so we never end up emitting an empty
 * expression.
 */
function generateSimplifiedCandidates(expression, context, simplificationPolicy = SIMPLIFICATION_POLICY_BASELINE) {
    const simplifiedBase = simplifyBooleanExpression(expression, simplificationPolicy);
    const truthTable = evaluateTruthTable(simplifiedBase, context.variables.length);

    if (truthTable.minterms.length === 0) {
        return [createBooleanConstant(false)];
    }

    if (truthTable.minterms.length === truthTable.total) {
        return [createBooleanConstant(true)];
    }

    const candidates = new Map();

    addCandidate(candidates, simplifiedBase);
    addCandidate(candidates, factorBooleanExpression(simplifiedBase, simplificationPolicy));

    const dnf = buildExpressionFromImplicants(truthTable.minterms, context.variables.length, false);
    const simplifiedDnf = simplifyBooleanExpression(dnf, simplificationPolicy);
    const factoredDnf = factorBooleanExpression(simplifiedDnf, simplificationPolicy);
    addCandidate(candidates, factoredDnf);

    const cnf = buildExpressionFromImplicants(truthTable.maxterms, context.variables.length, true);
    const simplifiedCnf = simplifyBooleanExpression(cnf, simplificationPolicy);
    const factoredCnf = factorBooleanExpression(simplifiedCnf, simplificationPolicy);
    addCandidate(candidates, factoredCnf);

    return [...candidates.values()];
}

function simplifyBooleanExpression(
    expression,
    simplificationPolicy: SimplificationPolicy = SIMPLIFICATION_POLICY_BASELINE
) {
    let current = normalizeBooleanExpression(expression);
    let iterations = 0;

    while (iterations < simplificationPolicy.maxSimplificationIterations) {
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
            const deduped = removeDuplicateTerms(absorbed);
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

function removeDuplicateTerms(terms) {
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

function factorBooleanExpression(
    expression,
    simplificationPolicy: SimplificationPolicy = SIMPLIFICATION_POLICY_BASELINE
) {
    if (!isObjectLike(expression)) {
        return expression;
    }

    const factoredChildren = (() => {
        switch (expression.type) {
            case BOOLEAN_NODE_TYPES.AND:
            case BOOLEAN_NODE_TYPES.OR: {
                return expression.terms.map((term) => factorBooleanExpression(term, simplificationPolicy));
            }
            case BOOLEAN_NODE_TYPES.NOT: {
                return [factorBooleanExpression(expression.argument, simplificationPolicy)];
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
            const factored = factorAssociativeExpression(rebuilt, simplificationPolicy);
            return simplifyBooleanExpression(factored, simplificationPolicy);
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
function factorAssociativeExpression(
    expression,
    simplificationPolicy: SimplificationPolicy = SIMPLIFICATION_POLICY_BASELINE
) {
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

        const simplifiedCandidate = simplifyBooleanExpression(candidate, simplificationPolicy);
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

function postProcessBooleanExpression(
    expression,
    simplificationPolicy: SimplificationPolicy = SIMPLIFICATION_POLICY_BASELINE
) {
    let current = expression;
    let iterations = 0;

    while (iterations < simplificationPolicy.maxPostProcessingIterations) {
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

export {
    addCandidate,
    applyAbsorption,
    applyComplementLaw,
    buildResidualTermsForKey,
    chooseBestCandidate,
    collapseAssociativeTerms,
    combineConditionalBoolean,
    compareExpressionComplexity,
    computeExpressionMetrics,
    factorAssociativeExpression,
    factorBooleanExpression,
    generateSimplifiedCandidates,
    normalizeBooleanExpression,
    postProcessBooleanExpression,
    removeDuplicateTerms,
    simplifyBooleanExpression,
    simplifyBooleanStep,
    transformMixedReductionPattern,
    transformXorPattern
};
