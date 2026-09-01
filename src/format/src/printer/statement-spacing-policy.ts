import { Core } from "@gmloop/core";

type StatementTypeCandidate = {
    type?: unknown;
};

// This policy is intentionally closed: the formatter owns a single opinionated
// statement-spacing default instead of exposing a mutable extension registry for
// hypothetical node kinds. Add new entries here only when the AST contract grows
// a concrete statement kind that should always receive surrounding blank lines.
const NODE_TYPES_WITH_SURROUNDING_NEWLINES = new Set<string>([
    "FunctionDeclaration",
    "ConstructorDeclaration",
    "RegionStatement",
    "EndRegionStatement"
]);

/**
 * Detects define statements that emulate region boundaries and therefore need
 * the same spacing treatment as dedicated region statements.
 *
 * @param {unknown} node Candidate AST node.
 * @returns {boolean} `true` when the directive mirrors a region boundary.
 */
function defineReplacementRequiresNewlines(node) {
    const directive = Core.getNormalizedDefineReplacementDirective(node);

    return (
        directive === Core.DefineReplacementDirective.REGION || directive === Core.DefineReplacementDirective.END_REGION
    );
}

/**
 * Determines whether a statement should be surrounded by blank lines in the
 * generated doc tree.
 *
 * Statements listed in {@link NODE_TYPES_WITH_SURROUNDING_NEWLINES} receive
 * padding to keep large constructs readable. The `#region` and
 * `#endregion` define replacements behave like their dedicated statement
 * counterparts, so they are treated the same even though they originate from a
 * `DefineStatement`. All other nodes default to `false` so the printer never
 * invents extra whitespace for unrecognized statement kinds.
 *
 * @param {unknown} node Statement node to inspect.
 * @returns {boolean} `true` when the printer should emit surrounding
 *                    newlines.
 */
function shouldAddNewlinesAroundStatement(node: StatementTypeCandidate | null | undefined): boolean {
    const nodeType = node?.type;
    if (typeof nodeType !== "string") {
        return false;
    }

    if (NODE_TYPES_WITH_SURROUNDING_NEWLINES.has(nodeType)) {
        return true;
    }

    return defineReplacementRequiresNewlines(node);
}

function shouldSuppressEmptyLineBetween(previousNode: unknown, nextNode: unknown): boolean {
    return Core.isMacroLikeStatement(previousNode) && Core.isMacroLikeStatement(nextNode);
}

/**
 * Reports whether the printer should emit an extra trailing blank line after
 * a nested function declaration.
 *
 * The formatter intentionally keeps trailing nested function declarations
 * flush against the enclosing block terminator; inter-statement spacing is
 * already handled by the intermediate spacing path in
 * `statement-traversal-spacing.ts`. The hook is retained so callers and
 * tests can describe the intended condition without papering over the policy
 * with conditional branches that all converge on `false`.
 */
function shouldForceTrailingBlankLineForNestedFunction(): boolean {
    return false;
}

export {
    shouldAddNewlinesAroundStatement,
    shouldForceTrailingBlankLineForNestedFunction,
    shouldSuppressEmptyLineBetween
};
