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

export function getOperatorInfo(operator: string): BinaryOperatorInfo | undefined {
    return BINARY_OPERATORS[operator];
}

export function getOperatorVariant(operator: string, style: BinaryOperatorStyle): string {
    const info = BINARY_OPERATORS[operator];
    if (!info) return operator;

    const canonical = info.canonical ?? operator;

    if (style === "symbol") {
        return canonical;
    }

    return CANONICAL_TO_KEYWORD[canonical] ?? operator;
}

/**
 * Map of operator aliases (e.g., "mod", "and", "xor") to their canonical symbol forms (e.g., "%", "&&", "^^").
 * Used for normalization by the linter and formatter.
 */
export const OPERATOR_ALIAS_MAP: Map<string, string> = new Map();

for (const [token, info] of Object.entries(BINARY_OPERATORS)) {
    if (info.canonical) {
        OPERATOR_ALIAS_MAP.set(token, info.canonical);
    }
}
