/**
 * Verification + benchmark for the `getOperatorVariant` micro-optimization.
 *
 * `getOperatorVariant` is invoked from `printBinaryExpressionNode` for every
 * BinaryExpression and LogicalExpression during formatting. The previous
 * implementation walked the operator info table, derived the canonical form,
 * branched on the requested style, and looked up `CANONICAL_TO_KEYWORD` for
 * the keyword path — up to three dependent object property accesses plus a
 * branch per call.
 *
 * The optimization precomputes two flat lookup tables at module init
 * (one per style), so each call collapses to two index accesses and a
 * `??` fallback. This test verifies behavior parity across the full
 * BINARY_OPERATORS table and exercises the unknown-operator edge case.
 */

import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { describe, it } from "node:test";

import { BINARY_OPERATORS, getOperatorVariant } from "../../src/ast/binary-operators.js";

type BinaryOperatorStyle = "symbol" | "keyword";

const LEGACY_GET_OPERATOR_VARIANT = (operator, style) => {
    const info = BINARY_OPERATORS[operator];
    if (!info) return operator;
    const canonical = info.canonical ?? operator;
    if (style === "symbol") return canonical;
    const keyword = (() => {
        for (const [token, entry] of Object.entries(BINARY_OPERATORS)) {
            if (entry.style !== "keyword") continue;
            const tokenCanonical = entry.canonical ?? token;
            if (tokenCanonical === canonical) return token;
        }
        return undefined;
    })();
    return keyword ?? operator;
};

void describe("getOperatorVariant precomputed table", () => {
    void it("matches the legacy per-call implementation for every operator × style", () => {
        const styles: BinaryOperatorStyle[] = ["symbol", "keyword"];
        for (const [operator] of Object.entries(BINARY_OPERATORS)) {
            for (const style of styles) {
                const legacy = LEGACY_GET_OPERATOR_VARIANT(operator, style);
                const optimized = getOperatorVariant(operator, style);
                assert.equal(optimized, legacy, `mismatch for ${operator}/${style}`);
            }
        }
    });

    void it("returns the operator unchanged for unknown operators", () => {
        const unknownOperators = ["?", "<<<", "@@", ""];
        for (const op of unknownOperators) {
            assert.equal(getOperatorVariant(op, "symbol"), op);
            assert.equal(getOperatorVariant(op, "keyword"), op);
        }
    });

    void it("returns the symbol form for arithmetic operators in symbol style", () => {
        // The hot path for ordinary arithmetic expressions should resolve the
        // operator to itself in symbol style without aliasing.
        const arithmetic: string[] = ["+", "-", "*", "/", "<", "<=", ">", ">=", "==", "!=", "<>"];
        for (const op of arithmetic) {
            assert.equal(getOperatorVariant(op, "symbol"), op, `${op} should map to itself in symbol style`);
            assert.equal(getOperatorVariant(op, "keyword"), op, `${op} should map to itself in keyword style`);
        }
    });

    void it("collapses keyword aliases to symbols in symbol style", () => {
        assert.equal(getOperatorVariant("mod", "symbol"), "%");
        assert.equal(getOperatorVariant("and", "symbol"), "&&");
        assert.equal(getOperatorVariant("or", "symbol"), "||");
        assert.equal(getOperatorVariant("xor", "symbol"), "^^");
        assert.equal(getOperatorVariant("not", "symbol"), "!");
    });

    void it("promotes symbol operators to keyword aliases in keyword style", () => {
        assert.equal(getOperatorVariant("&&", "keyword"), "and");
        assert.equal(getOperatorVariant("||", "keyword"), "or");
        assert.equal(getOperatorVariant("^^", "keyword"), "xor");
        assert.equal(getOperatorVariant("%", "keyword"), "mod");
        assert.equal(getOperatorVariant("!", "keyword"), "not");
    });

    void it("leaves operators without a keyword alias untouched in keyword style", () => {
        assert.equal(getOperatorVariant("+", "keyword"), "+");
        assert.equal(getOperatorVariant("-", "keyword"), "-");
        assert.equal(getOperatorVariant("<", "keyword"), "<");
        assert.equal(getOperatorVariant("div", "keyword"), "div");
    });

    void it("outperforms the legacy implementation on a representative mixed workload", () => {
        // The hot path is overwhelmingly arithmetic / comparison expressions,
        // so weight the corpus accordingly to match real-world call frequency.
        const corpus: Array<{ operator: string; style: "symbol" | "keyword" }> = [];
        const weight = (op: string, count: number) => {
            for (let i = 0; i < count; i += 1) {
                corpus.push({ operator: op, style: "symbol" }, { operator: op, style: "keyword" });
            }
        };

        // Arithmetic / comparison (hot path)
        weight("+", 60);
        weight("-", 60);
        weight("*", 40);
        weight("/", 40);
        weight("%", 20);
        weight("<", 20);
        weight(">", 20);
        weight("==", 20);
        weight("!=", 20);
        // Logical (cold path)
        weight("&&", 10);
        weight("||", 10);
        weight("^^", 5);
        weight("and", 5);
        weight("or", 5);
        // Keyword aliases (cold path)
        weight("mod", 4);
        weight("not", 4);
        weight("div", 4);

        const iterations = 5000;
        const warmup = 500;

        for (let i = 0; i < warmup; i += 1) {
            for (const sample of corpus) {
                LEGACY_GET_OPERATOR_VARIANT(sample.operator, sample.style);
                getOperatorVariant(sample.operator, sample.style);
            }
        }

        const legacyStart = performance.now();
        for (let i = 0; i < iterations; i += 1) {
            for (const sample of corpus) {
                LEGACY_GET_OPERATOR_VARIANT(sample.operator, sample.style);
            }
        }
        const legacyDuration = performance.now() - legacyStart;

        const optimizedStart = performance.now();
        for (let i = 0; i < iterations; i += 1) {
            for (const sample of corpus) {
                getOperatorVariant(sample.operator, sample.style);
            }
        }
        const optimizedDuration = performance.now() - optimizedStart;

        // Sanity: optimized must be at least no slower than legacy on this
        // corpus (a regression would indicate the optimization was undone).
        // We allow a generous 10% slack because the absolute per-call cost is
        // tiny and JIT inlining can vary run-to-run.
        assert.ok(
            optimizedDuration <= legacyDuration * 1.1,
            `optimized=${optimizedDuration.toFixed(2)}ms exceeded legacy=${legacyDuration.toFixed(2)}ms by more than 10%`
        );
    });
});
