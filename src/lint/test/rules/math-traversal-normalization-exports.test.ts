/**
 * Regression guard: the `export * from "./math-ast-mutation.js"`
 * re-exports at the top of `math-traversal-normalization.ts` and
 * `math-scalar-condensing.ts` were backward-compatibility shims. They
 * duplicated the public surface of `math-ast-mutation.js` onto two
 * implementation modules that did not own those helpers, widening the
 * lint workspace's public API with no behavioural benefit. The canonical
 * surface is the `math/index.ts` barrel, which enumerates each helper
 * explicitly so its public API is decoupled from the implementation files.
 *
 * Why this guard exists:
 *   - `math-traversal-normalization.ts` and `math-scalar-condensing.ts`
 *     re-exported `math-ast-mutation.js` so callers that reached those
 *     helpers through either implementation module would keep working.
 *   - No production caller imports `applyScalarCondensing` or any other
 *     AST mutation helper through either shim — every in-tree consumer
 *     imports them from the `math/index.ts` barrel, which already lists
 *     each helper as a named re-export from `math-ast-mutation.js`.
 *   - Removing the shims is behaviour-preserving: every helper is still
 *     reachable through its canonical owner and the barrel.
 *
 * If anyone re-introduces either re-export shim, the assertions below
 * fail loudly so the cleanup can be re-applied.
 *
 * (target-state.md §2.3, §3.2 — no backwards-compatibility shims; the lint
 * workspace routes AST-mutation helpers through their canonical owner.)
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
    applyManualMathNormalization,
    applyScalarCondensing,
    areNodesEquivalent,
    attachTrailingCommentToStatement,
    captureTrailingLineCommentValue,
    findAssignmentExpressionForRight,
    findParentEntry,
    findStatementAncestor,
    findTargetArrayEntry,
    findVariableDeclarationByName,
    findVariableDeclaratorForInit,
    hasOriginalComment,
    insertNodeBefore,
    isSafeOperand,
    markPreviousSiblingForBlankLine,
    normalizeTraversalContext,
    recordManualMathOriginalAssignment,
    removeNodeFromAst,
    removeSimplifiedAliasDeclaration,
    simplifyZeroDivisionNumerators,
    traverseZeroDivisionNumerators,
    unwrapEnclosingParentheses
} from "../../src/rules/gml/math/index.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const MATH_TRAVERSAL_NORMALIZATION_PATH = path.resolve(
    REPOSITORY_ROOT,
    "src/lint/src/rules/gml/math/math-traversal-normalization.ts"
);
const MATH_SCALAR_CONDENSING_PATH = path.resolve(
    REPOSITORY_ROOT,
    "src/lint/src/rules/gml/math/math-scalar-condensing.ts"
);

const FORBIDDEN_SHIM_LINE_PATTERN = /export\s*\*\s*from\s*["'](?:\.\/)?math-ast-mutation\.js["']/gu;

void describe("math-traversal-normalization and math-scalar-condensing re-export shim removal", () => {
    void it("does not re-export the AST mutation helpers from math-traversal-normalization.ts", async () => {
        const source = await readFile(MATH_TRAVERSAL_NORMALIZATION_PATH, "utf8");

        assert.equal(
            FORBIDDEN_SHIM_LINE_PATTERN.test(source),
            false,
            "math-traversal-normalization.ts must not re-export from math-ast-mutation.js; the canonical owners are the single source of truth."
        );
    });

    void it("does not re-export the AST mutation helpers from math-scalar-condensing.ts", async () => {
        const source = await readFile(MATH_SCALAR_CONDENSING_PATH, "utf8");

        assert.equal(
            FORBIDDEN_SHIM_LINE_PATTERN.test(source),
            false,
            "math-scalar-condensing.ts must not re-export from math-ast-mutation.js; the canonical owners are the single source of truth."
        );
    });

    void it("still exposes applyManualMathNormalization through the math barrel", () => {
        assert.strictEqual(typeof applyManualMathNormalization, "function");
    });

    void it("still exposes applyScalarCondensing through the math barrel", () => {
        assert.strictEqual(typeof applyScalarCondensing, "function");
    });

    void it("still exposes scalar condensing helpers used by other math modules through the math barrel", () => {
        assert.strictEqual(typeof areNodesEquivalent, "function");
        assert.strictEqual(typeof simplifyZeroDivisionNumerators, "function");
        assert.strictEqual(typeof traverseZeroDivisionNumerators, "function");
        assert.strictEqual(typeof hasOriginalComment, "function");
    });

    void it("still exposes AST mutation helpers through the math barrel", () => {
        const expectedFunctions = [
            attachTrailingCommentToStatement,
            captureTrailingLineCommentValue,
            findAssignmentExpressionForRight,
            findParentEntry,
            findStatementAncestor,
            findTargetArrayEntry,
            findVariableDeclarationByName,
            findVariableDeclaratorForInit,
            insertNodeBefore,
            isSafeOperand,
            markPreviousSiblingForBlankLine,
            normalizeTraversalContext,
            recordManualMathOriginalAssignment,
            removeNodeFromAst,
            removeSimplifiedAliasDeclaration,
            unwrapEnclosingParentheses
        ];

        for (const candidate of expectedFunctions) {
            assert.strictEqual(typeof candidate, "function");
        }
    });

    void it("applyScalarCondensing rewrites a scalar product when reached through the math barrel", () => {
        const ast: any = {
            type: "BinaryExpression",
            operator: "*",
            left: {
                type: "BinaryExpression",
                operator: "*",
                left: { type: "Identifier", name: "foo" },
                right: { type: "Literal", value: "2" }
            },
            right: { type: "Literal", value: "3" }
        };

        applyScalarCondensing(ast, null);

        assert.strictEqual(ast.left.name, "foo");
        assert.strictEqual(ast.right.value, "6");
    });

    void it("isSafeOperand is reachable through the math barrel", () => {
        assert.strictEqual(isSafeOperand({ type: "Identifier", name: "x" }), true);
        assert.strictEqual(
            isSafeOperand({ type: "CallExpression", callee: { type: "Identifier", name: "x" }, arguments: [] }),
            false
        );
    });
});
