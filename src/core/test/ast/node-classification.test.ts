import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "../../index.js";

void describe("AST node classification helpers", () => {
    void it("normalizes define directives case-insensitively", () => {
        const regionNode = {
            type: "DefineStatement",
            replacementDirective: "#REGION"
        };
        const macroNode = {
            type: "DefineStatement",
            replacementDirective: "  #MACRO  "
        };

        assert.equal(Core.getNormalizedDefineReplacementDirective(regionNode), Core.DefineReplacementDirective.REGION);
        assert.equal(Core.getNormalizedDefineReplacementDirective(macroNode), Core.DefineReplacementDirective.MACRO);
    });

    void it("returns null when define statements lack directives", () => {
        assert.equal(Core.getNormalizedDefineReplacementDirective(null), null);
        assert.equal(
            Core.getNormalizedDefineReplacementDirective({
                type: "DefineStatement"
            }),
            null
        );
        assert.equal(
            Core.getNormalizedDefineReplacementDirective({
                type: "DefineStatement",
                replacementDirective: "   "
            }),
            null
        );
    });

    void it("throws when encountering an unsupported directive", () => {
        assert.throws(
            () =>
                Core.getNormalizedDefineReplacementDirective({
                    type: "DefineStatement",
                    replacementDirective: "#unknown"
                }),
            (error) => error instanceof RangeError && /#unknown/.test(error.message)
        );
    });

    void it("classifies macro-like statements", () => {
        const macroDeclaration = { type: "MacroDeclaration" };
        const defineMacro = {
            type: "DefineStatement",
            replacementDirective: "#macro"
        };
        const unrelated = { type: "ReturnStatement" };

        assert.equal(Core.isMacroLikeStatement(macroDeclaration), true);
        assert.equal(Core.isMacroLikeStatement(defineMacro), true);
        assert.equal(Core.isMacroLikeStatement(unrelated), false);
    });

    void it("recognizes function-like declarations", () => {
        assert.equal(Core.isFunctionLikeDeclaration({ type: "FunctionDeclaration" }), true);
        assert.equal(Core.isFunctionLikeDeclaration({ type: "ConstructorDeclaration" }), true);
        assert.equal(Core.isFunctionLikeDeclaration({ type: "FunctionExpression" }), true);
        assert.equal(Core.isFunctionLikeDeclaration({ type: "StructFunctionDeclaration" }), true);
        assert.equal(Core.isFunctionLikeDeclaration({ type: "StructDeclaration" }), false);
    });

    void it("is defined on Core", () => {
        assert.equal(typeof Core.isControlFlowExitStatement, "function");
    });
});
