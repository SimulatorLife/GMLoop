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

    void it("identifies control flow exit statements", () => {
        assert.equal(Core.isControlFlowExitStatement({ type: "ReturnStatement" }), true);
        assert.equal(Core.isControlFlowExitStatement({ type: "BreakStatement" }), true);
        assert.equal(Core.isControlFlowExitStatement({ type: "ContinueStatement" }), true);
        assert.equal(Core.isControlFlowExitStatement({ type: "ExitStatement" }), true);
        assert.equal(Core.isControlFlowExitStatement({ type: "ThrowStatement" }), true);
    });

    void it("rejects non-exit statement types", () => {
        assert.equal(Core.isControlFlowExitStatement({ type: "IfStatement" }), false);
        assert.equal(Core.isControlFlowExitStatement({ type: "ExpressionStatement" }), false);
        assert.equal(Core.isControlFlowExitStatement({ type: "BlockStatement" }), false);
        assert.equal(Core.isControlFlowExitStatement({ type: "FunctionDeclaration" }), false);
    });

    void it("safely handles null and non-object inputs for control flow exit check", () => {
        assert.equal(Core.isControlFlowExitStatement(null), false);
        assert.equal(Core.isControlFlowExitStatement(undefined), false);
        assert.equal(Core.isControlFlowExitStatement("ReturnStatement"), false);
        assert.equal(Core.isControlFlowExitStatement(42), false);
        assert.equal(Core.isControlFlowExitStatement({}), false);
    });
});
