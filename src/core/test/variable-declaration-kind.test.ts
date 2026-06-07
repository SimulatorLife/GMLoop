import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    getVariableDeclarationKind,
    isVariableDeclarationOfKind,
    isVarVariableDeclaration
} from "../src/ast/node-helpers/index.js";
import type { VariableDeclarationNode } from "../src/ast/types.js";

void describe("variable declaration helpers", () => {
    void describe("getVariableDeclarationKind", () => {
        void it("returns null for non-variable declaration nodes", () => {
            assert.equal(getVariableDeclarationKind(null), null);
            assert.equal(getVariableDeclarationKind({ type: "FunctionDeclaration" }), null);
        });

        void it("normalizes variable declaration kinds to lowercase", () => {
            assert.equal(
                getVariableDeclarationKind({
                    type: "VariableDeclaration",
                    kind: "VaR",
                    declarations: []
                } as VariableDeclarationNode),
                "var"
            );
        });

        void it("returns null for missing or empty kinds", () => {
            assert.equal(
                getVariableDeclarationKind({
                    type: "VariableDeclaration",
                    declarations: []
                }),
                null
            );

            assert.equal(
                getVariableDeclarationKind({
                    type: "VariableDeclaration",
                    kind: "",
                    declarations: []
                } as VariableDeclarationNode),
                null
            );
        });
    });

    void describe("isVariableDeclarationOfKind", () => {
        void it("guards against invalid inputs", () => {
            assert.equal(isVariableDeclarationOfKind(null, "var"), false);
            assert.equal(
                isVariableDeclarationOfKind(
                    {
                        type: "VariableDeclaration",
                        kind: "let",
                        declarations: []
                    } as VariableDeclarationNode,
                    "var"
                ),
                false
            );
            assert.equal(
                isVariableDeclarationOfKind(
                    {
                        type: "VariableDeclaration",
                        declarations: []
                    },
                    ""
                ),
                false
            );
        });

        void it("compares declaration kinds case-insensitively", () => {
            assert.equal(
                isVariableDeclarationOfKind(
                    {
                        type: "VariableDeclaration",
                        kind: "Var",
                        declarations: []
                    } as VariableDeclarationNode,
                    "VAR"
                ),
                true
            );
        });
    });

    void describe("isVarVariableDeclaration", () => {
        void it("returns true only for 'var' declarations", () => {
            assert.equal(
                isVarVariableDeclaration({
                    type: "VariableDeclaration",
                    kind: "var",
                    declarations: []
                } as VariableDeclarationNode),
                true
            );

            assert.equal(
                isVarVariableDeclaration({
                    type: "VariableDeclaration",
                    kind: "let",
                    declarations: []
                } as VariableDeclarationNode),
                false
            );
        });
    });
});
