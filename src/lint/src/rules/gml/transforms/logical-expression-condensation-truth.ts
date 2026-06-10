/**
 * Truth-table evaluation and Quine-McCluskey minimisation.
 *
 * Once a conditional expression has been lowered into the boolean ADT, the
 * condensation pipeline enumerates every input combination, records which
 * rows evaluate to `true` (minterms) and which to `false` (maxterms), and
 * then runs the Quine-McCluskey algorithm to find a minimum cover. The
 * minimum cover is rendered back into the ADT as either a sum-of-products
 * (DNF) or product-of-sums (CNF) so the simplifier has a starting point
 * that's already canonical at the literal level.
 *
 * Extracted from `logical-expression-condensation.ts` to keep the long-file
 * boundary under the 1000-line target. Behavior is preserved exactly; only
 * the source layout has changed.
 */
import {
    BOOLEAN_NODE_TYPES,
    createBooleanAnd,
    createBooleanConstant,
    createBooleanNot,
    createBooleanOr,
    createBooleanVariable
} from "./logical-expression-condensation-boolean.js";

/**
 * Builds the assignment vector for the truth table at row `mask`. Each bit
 * of the mask becomes the boolean value of the corresponding variable.
 */
function buildAssignment(mask, variableCount) {
    const assignment = Array.from({ length: variableCount });
    for (let index = 0; index < variableCount; index++) {
        assignment[index] = (mask & (1 << index)) !== 0;
    }
    return assignment;
}

/**
 * Evaluates a boolean expression against a concrete variable assignment.
 * Returns `false` for any unknown node type so unknown shapes never
 * accidentally contribute a `true` row to the truth table.
 */
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

/**
 * Walks the truth table for `expression` over `variableCount` variables and
 * returns the minterm and maxterm lists. The total is included so callers
 * can detect a tautology (minterms == total) or contradiction (minterms
 * empty) without having to re-derive the value.
 */
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

function createImplicant(value, mask, covered) {
    return { value, mask, covered: new Set(covered) };
}

function isSingleBit(value, variableCount) {
    if (value === 0) {
        return false;
    }
    return (value & (value - 1)) === 0 && value < 1 << variableCount;
}

/**
 * Tries to combine adjacent implicants whose values differ in exactly one
 * position. Returns the newly combined implicants (which will be processed
 * in the next round) and the implicants that could not be combined this
 * round (which are promoted to prime implicants).
 */
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

/**
 * Classic Quine-McCluskey minimisation. The iterative combination step
 * runs until no more implicants can be merged; everything that survives is
 * a prime implicant. The final cover is chosen by `selectPrimeCover` so
 * essential-prime selection happens in a separate, testable function.
 */
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

/**
 * Picks the essential prime implicants first, then runs a depth-first
 * search to fill in the remaining coverage with the smallest set of
 * non-essential primes. The DFS is bounded by the running best so it
 * degrades gracefully on larger inputs.
 */
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

/**
 * Renders the minimum implicant cover as either a sum-of-products (DNF) or
 * a product-of-sums (CNF). When `negated` is set the caller actually wants
 * the cover of the false rows, so the call sites pass `maxterms` and the
 * resulting expression represents `!f`.
 */
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

export {
    buildAssignment,
    buildClauseFromImplicant,
    buildExpressionFromImplicants,
    buildTermFromImplicant,
    combineImplicants,
    createImplicant,
    evaluateBooleanExpression,
    evaluateTruthTable,
    isSingleBit,
    minimizeWithQuineMcCluskey,
    searchMinimalCover,
    selectPrimeCover
};
