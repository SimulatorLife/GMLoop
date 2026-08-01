import assert from "node:assert/strict";
import { describe, it } from "node:test";

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

/**
 * Regression coverage for the single `export * from "./math-ast-mutation.js"`
 * re-export at the top of `math-traversal-normalization.ts`.
 *
 * A previous revision duplicated that re-export at the bottom of the file as
 * well. ES modules collapse duplicate `export *` statements to a single
 * binding surface, so removing the duplicate is a safe, behavior-preserving
 * simplification. These tests pin the expected public API of the module so
 * future contributors get a clear signal if either (a) the re-export is
 * removed by mistake or (b) new helpers stop being re-exported transparently.
 */
void describe("math-traversal-normalization re-exports", () => {
    void it("exposes applyManualMathNormalization", () => {
        assert.strictEqual(typeof applyManualMathNormalization, "function");
    });

    void it("exposes applyScalarCondensing via the re-export", () => {
        assert.strictEqual(typeof applyScalarCondensing, "function");
    });

    void it("exposes scalar condensing helpers used by other math modules", () => {
        assert.strictEqual(typeof areNodesEquivalent, "function");
        assert.strictEqual(typeof simplifyZeroDivisionNumerators, "function");
        assert.strictEqual(typeof traverseZeroDivisionNumerators, "function");
        assert.strictEqual(typeof hasOriginalComment, "function");
    });

    void it("exposes AST mutation helpers transparently", () => {
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

    void it("applyScalarCondensing rewrites a scalar product when reached through the re-export", () => {
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

    void it("isSafeOperand is reachable through the re-export", () => {
        assert.strictEqual(isSafeOperand({ type: "Identifier", name: "x" }), true);
        assert.strictEqual(
            isSafeOperand({ type: "CallExpression", callee: { type: "Identifier", name: "x" }, arguments: [] }),
            false
        );
    });
});
