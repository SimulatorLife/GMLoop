import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "@gmloop/core";

import * as Printer from "../src/printer/index.js";

void describe("statement spacing policy", () => {
    void it("detects macro-like statements", () => {
        const macroDeclaration = { type: "MacroDeclaration" };
        const defineMacro = {
            type: "DefineStatement",
            replacementDirective: "#macro"
        };
        const unrelated = { type: "ReturnStatement" };

        assert.equal(Core.isMacroLikeStatement(macroDeclaration), true);
        assert.equal(Core.isMacroLikeStatement(defineMacro), true);
        assert.equal(Core.isMacroLikeStatement(unrelated), false);
        assert.equal(Printer.StatementSpacingPolicy.shouldSuppressEmptyLineBetween(macroDeclaration, null), false);
        assert.equal(
            Printer.StatementSpacingPolicy.shouldSuppressEmptyLineBetween(macroDeclaration, defineMacro),
            true
        );
        assert.equal(Printer.StatementSpacingPolicy.shouldSuppressEmptyLineBetween(macroDeclaration, unrelated), false);
    });

    void it("does not force trailing padding after nested functions", () => {
        const nestedFunction = { type: "FunctionDeclaration" };
        const block = { type: "BlockStatement" };
        const container = { type: "FunctionExpression" };
        const unrelatedContainer = { type: "StructDeclaration" };

        assert.equal(
            Printer.StatementSpacingPolicy.shouldForceTrailingBlankLineForNestedFunction(
                nestedFunction,
                block,
                container
            ),
            false
        );
        assert.equal(
            Printer.StatementSpacingPolicy.shouldForceTrailingBlankLineForNestedFunction(
                nestedFunction,
                block,
                unrelatedContainer
            ),
            false
        );
    });

    void it("keeps default newline padding behavior", () => {
        assert.equal(
            Printer.StatementSpacingPolicy.shouldAddNewlinesAroundStatement({
                type: "FunctionDeclaration"
            }),
            true
        );
        assert.equal(
            Printer.StatementSpacingPolicy.shouldAddNewlinesAroundStatement({
                type: "RegionStatement"
            }),
            true
        );
        assert.equal(
            Printer.StatementSpacingPolicy.shouldAddNewlinesAroundStatement({
                type: "ReturnStatement"
            }),
            false
        );
    });

    void it("keeps unknown statement types on the unpadded default path", () => {
        const experimentalNode = { type: "ExperimentalStatement" };

        assert.equal(Printer.StatementSpacingPolicy.shouldAddNewlinesAroundStatement(experimentalNode), false);
        assert.equal(Object.hasOwn(Printer.StatementSpacingPolicy, "registerSurroundingNewlineNodeTypes"), false);
        assert.equal(Object.hasOwn(Printer.StatementSpacingPolicy, "resetSurroundingNewlineNodeTypes"), false);
    });
});
