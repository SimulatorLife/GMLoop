type BinaryOperatorAssoc = "left" | "right";
type BinaryOperatorType = "unary" | "arithmetic" | "bitwise" | "comparison" | "logical" | "assign";
type BinaryOperatorStyle = "symbol" | "keyword";

interface BinaryOperatorInfo {
    prec: number;
    assoc: BinaryOperatorAssoc;
    type: BinaryOperatorType;
    style: BinaryOperatorStyle;

    // If present, this operator is an alias of `canonical`
    // Convention: canonical points at the symbol form.
    canonical?: string;
}

export const BINARY_OPERATORS: Record<string, BinaryOperatorInfo> = {
    // Highest Precedence
    // Track whether `++` is parsed as a prefix or suffix operator. The
    // parser currently funnels both variants through the same precedence entry,
    // which keeps the visitor traversals simple but hides whether the operand
    // should be evaluated before or after the increment. Downstream
    // transformations such as the identifier role tracker and the
    // apply-feather-fixes pipeline depend on that nuance to distinguish between
    // pure reads and reads-with-writeback. The GameMaker manual spells out the
    // differing semantics (https://manual.gamemaker.io/monthly/en/#t=GameMaker_Language%2FGML_Reference%2FOperators%2FIncrement_and_Decrement.htm),
    // so once the builder exposes the mode we should emit richer AST nodes
    // instead of treating them as interchangeable unary operators.
    "++": { prec: 15, assoc: "right", type: "unary", style: "symbol" },
    // Track the decrement operator with the same prefix/suffix semantics as
    // the increment operator (see the comment above for `++`). GameMaker's
    // runtime distinguishes between `--value` (prefix) and `value--` (postfix),
    // emitting different bytecode for each form. Prefix decrements modify the
    // variable before its value is read, while postfix decrements return the
    // original value and modify afterward. Treating these as interchangeable
    // unary operators would allow downstream optimizations (such as the Feather
    // fixer or identifier role tracker) to incorrectly assume `value--` has no
    // side effects, leading to mis-scheduled hoists or duplicate writes when
    // the formatter rewrites identifier usages.
    "--": { prec: 15, assoc: "right", type: "unary", style: "symbol" },
    "~": { prec: 14, assoc: "right", type: "unary", style: "symbol" },
    "!": { prec: 14, assoc: "right", type: "unary", style: "symbol" },
    not: { prec: 14, assoc: "right", type: "unary", style: "keyword", canonical: "!" },
    "*": { prec: 13, assoc: "left", type: "arithmetic", style: "symbol" },
    "/": { prec: 13, assoc: "left", type: "arithmetic", style: "symbol" },
    div: { prec: 13, assoc: "left", type: "arithmetic", style: "keyword" }, // Note: `div` is integer division in GML; it is not an alias for `/`
    "%": { prec: 13, assoc: "left", type: "arithmetic", style: "symbol" },
    mod: { prec: 13, assoc: "left", type: "arithmetic", style: "keyword", canonical: "%" }, // `mod` is an alias for `%` in GML
    "+": { prec: 12, assoc: "left", type: "arithmetic", style: "symbol" }, // Addition
    "-": { prec: 12, assoc: "left", type: "arithmetic", style: "symbol" }, // Subtraction
    "<<": { prec: 12, assoc: "left", type: "bitwise", style: "symbol" },
    ">>": { prec: 12, assoc: "left", type: "bitwise", style: "symbol" },
    "&": { prec: 11, assoc: "left", type: "bitwise", style: "symbol" },
    "^": { prec: 10, assoc: "left", type: "bitwise", style: "symbol" },
    "|": { prec: 9, assoc: "left", type: "bitwise", style: "symbol" },
    "<": { prec: 8, assoc: "left", type: "comparison", style: "symbol" },
    "<=": { prec: 8, assoc: "left", type: "comparison", style: "symbol" },
    ">": { prec: 8, assoc: "left", type: "comparison", style: "symbol" },
    ">=": { prec: 8, assoc: "left", type: "comparison", style: "symbol" },
    "==": { prec: 7, assoc: "left", type: "comparison", style: "symbol" },
    "!=": { prec: 7, assoc: "left", type: "comparison", style: "symbol" },
    "<>": { prec: 7, assoc: "left", type: "comparison", style: "symbol" },
    "&&": { prec: 6, assoc: "left", type: "logical", style: "symbol" },
    and: { prec: 6, assoc: "left", type: "logical", style: "keyword", canonical: "&&" },
    "^^": { prec: 5, assoc: "left", type: "logical", style: "symbol" },
    xor: { prec: 5, assoc: "left", type: "logical", style: "keyword", canonical: "^^" },
    "||": { prec: 4, assoc: "left", type: "logical", style: "symbol" },
    or: { prec: 4, assoc: "left", type: "logical", style: "keyword", canonical: "||" },
    "??": { prec: 4, assoc: "right", type: "logical", style: "symbol" }, // Nullish coalescing
    "*=": { prec: 1, assoc: "right", type: "assign", style: "symbol" },
    ":=": { prec: 1, assoc: "right", type: "assign", style: "symbol" }, // Equivalent to "=" in GML
    "=": { prec: 1, assoc: "right", type: "assign", style: "symbol" }, // Also handles single-equals comparisons (normalized to "==")
    "/=": { prec: 1, assoc: "right", type: "assign", style: "symbol" },
    "%=": { prec: 1, assoc: "right", type: "assign", style: "symbol" },
    "+=": { prec: 1, assoc: "right", type: "assign", style: "symbol" },
    "-=": { prec: 1, assoc: "right", type: "assign", style: "symbol" },
    // Intentionally omit `<<=` / `>>=`. GML supports `<<` and `>>`, but not
    // the shift-compound assignment forms. Keeping them out of the canonical
    // operator table prevents formatter/lint/refactor code from advertising
    // those invalid tokens as first-class GML operators.
    "&=": { prec: 1, assoc: "right", type: "assign", style: "symbol" },
    "^=": { prec: 1, assoc: "right", type: "assign", style: "symbol" },
    "|=": { prec: 1, assoc: "right", type: "assign", style: "symbol" },
    "??=": { prec: 1, assoc: "right", type: "assign", style: "symbol" } // Nullish coalescing assignment
};

// Cached reverse index derived once at module init.
// For each canonical symbol, store the preferred keyword alias (if any).
const CANONICAL_TO_KEYWORD: Record<string, string> = Object.create(null);

for (const [token, info] of Object.entries(BINARY_OPERATORS)) {
    if (info.style !== "keyword") {
        continue;
    }

    const canonical = info.canonical ?? token;
    if (typeof canonical === "string" && !(canonical in CANONICAL_TO_KEYWORD)) {
        CANONICAL_TO_KEYWORD[canonical] = token;
    }
}

// Precomputed per-style operator-variant lookup, built once at module init.
//
// `getOperatorVariant` runs on the formatter hot path — every BinaryExpression
// and LogicalExpression in the formatted source triggers a call from
// `printBinaryExpressionNode`. The previous implementation walked the
// BINARY_OPERATORS entry, derived `canonical`, branched on style, and looked
// up `CANONICAL_TO_KEYWORD` for the keyword path: up to three dependent
// object property accesses and one string compare per call. Flattening both
// styles into their own dense maps lets the call site resolve to a single
// two-step index access (`table[operator] ?? operator`), which V8 can inline
// cache far more reliably because each map has a stable shape across calls.
//
// Object.create(null) keeps the keys off the Object.prototype chain so the
// monomorphic `??` fallback below is the only branch the JIT has to consider
// on a miss.
const OPERATOR_VARIANTS_BY_STYLE: Readonly<Record<BinaryOperatorStyle, Readonly<Record<string, string>>>> =
    Object.freeze({
        symbol: Object.freeze(buildOperatorVariantMap("symbol")),
        keyword: Object.freeze(buildOperatorVariantMap("keyword"))
    });

function buildOperatorVariantMap(style: BinaryOperatorStyle): Record<string, string> {
    const table: Record<string, string> = Object.create(null);
    for (const token in BINARY_OPERATORS) {
        const info = BINARY_OPERATORS[token];
        const canonical = info.canonical ?? token;
        if (style === "symbol") {
            table[token] = canonical;
        } else {
            table[token] = CANONICAL_TO_KEYWORD[canonical] ?? token;
        }
    }
    return table;
}

/**
 * Look up the precedence/associativity metadata for a single binary operator.
 *
 * Returns `undefined` for any string that is not present in {@link BINARY_OPERATORS},
 * which lets callers distinguish "unknown operator" from "operator with neutral
 * metadata" without resorting to thrown errors. The formatter and lint
 * pipelines use this to decide whether a child expression needs parentheses
 * (e.g. when its precedence is lower than its parent's).
 *
 * Note: lookup is case-sensitive. GML keyword aliases such as `mod` or `and`
 * are stored under their lowercase spelling; passing `"MOD"` will miss the
 * entry. Callers that accept arbitrary user input should normalise to
 * lowercase first.
 *
 * @param operator Operator token exactly as it appears in the AST (e.g. `"+"`,
 *     `"&&"`, `"mod"`).
 * @returns The matching {@link BinaryOperatorInfo} entry, or `undefined` when
 *     the operator is not a recognised GML binary operator.
 */
export function getOperatorInfo(operator: string): BinaryOperatorInfo | undefined {
    return BINARY_OPERATORS[operator];
}

/**
 * Resolve a GML operator to either its canonical symbol form or its keyword
 * alias, depending on the requested style.
 *
 * - `style: "symbol"` returns the symbol form (e.g. `mod` → `%`,
 *   `and` → `&&`). Operators that are already symbols return themselves.
 * - `style: "keyword"` returns the keyword alias when one exists (e.g.
 *   `&&` → `and`, `||` → `or`). Operators without a keyword alias (such as
 *   `+` or `==`) return themselves.
 *
 * Unknown operators are returned unchanged so callers can safely pipe
 * arbitrary tokens through the helper without first validating them.
 *
 * Why it matters: the formatter's binary-expression printer invokes this
 * helper on every `BinaryExpression` and `LogicalExpression` it emits, so the
 * signature is intentionally tiny and the lookup is O(1) via the
 * precomputed {@link OPERATOR_VARIANTS_BY_STYLE} tables.
 *
 * @param operator Operator token exactly as it appears in the AST.
 * @param style Target style — `"symbol"` for the canonical symbol, `"keyword"`
 *     for the GML keyword alias when available.
 * @returns The operator rendered in the requested style, or `operator`
 *     unchanged when no entry exists for the (operator, style) pair.
 */
export function getOperatorVariant(operator: string, style: BinaryOperatorStyle): string {
    return OPERATOR_VARIANTS_BY_STYLE[style][operator] ?? operator;
}

/**
 * Maps GML keyword-style operators to their canonical symbol form.
 *
 * Populated from the `canonical` field on each entry in
 * {@link BINARY_OPERATORS}; only operators that declare a canonical
 * symbol appear here. Currently the map covers:
 *
 *   - `mod`   → `%`     (remainder)
 *   - `div`   → has no canonical entry — `div` is integer division in GML
 *               and is not an alias for `/`, so it deliberately stays out
 *               of this map
 *   - `and`   → `&&`    (logical AND)
 *   - `or`    → `||`    (logical OR)
 *   - `xor`   → `^^`    (logical XOR)
 *   - `not`   → `!`     (logical NOT — also referenced by some binary paths)
 *
 * Used by `normalize-operator-aliases-rule` (lint) and any caller that
 * needs to fold keyword spellings into their symbol equivalents before
 * further analysis. Iteration order matches {@link BINARY_OPERATORS} order
 * (insertion order of the source object), so consumers that need stable
 * output can rely on `for…of` over `.entries()`.
 */
export const OPERATOR_ALIAS_MAP: Map<string, string> = new Map();

for (const [token, info] of Object.entries(BINARY_OPERATORS)) {
    if (info.canonical) {
        OPERATOR_ALIAS_MAP.set(token, info.canonical);
    }
}
