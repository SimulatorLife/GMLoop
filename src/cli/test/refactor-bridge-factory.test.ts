/**
 * Tests for the bridge factory module.
 *
 * Verifies that createRefactorBridges produces the correct bridge instances
 * and respects optional overrides for testing or custom adapter scenarios.
 */

import assert from "node:assert";
import { describe, it } from "node:test";

import type * as Refactor from "@gmloop/refactor";
import type { AstNode } from "@gmloop/refactor";

import { createRefactorBridges } from "../src/modules/refactor/bridge-factory.js";
import { GmlParserBridge } from "../src/modules/refactor/parser-bridge.js";
import { GmlSemanticBridge } from "../src/modules/refactor/semantic-bridge.js";
import { GmlTranspilerBridge } from "../src/modules/refactor/transpiler-bridge.js";

void describe("createRefactorBridges", () => {
    void it("returns frozen RefactorBridges object", () => {
        const bridges = createRefactorBridges();
        assert.ok(Object.isFrozen(bridges), "Returned bridges should be frozen");
    });

    void it("creates canonical bridges when no options provided", () => {
        const bridges = createRefactorBridges();

        assert.ok(bridges.parser instanceof GmlParserBridge, "parser should be GmlParserBridge instance");
        assert.ok(bridges.formatter instanceof GmlTranspilerBridge, "formatter should be GmlTranspilerBridge instance");
        assert.ok(bridges.semantic instanceof GmlSemanticBridge, "semantic should be GmlSemanticBridge instance");
    });

    void it("accepts optional parser override", () => {
        const emptyAstNode: AstNode = { start: 0, end: 0 };
        const customParser: Refactor.ParserBridge = {
            parse: () => emptyAstNode
        };
        const bridges = createRefactorBridges({ parser: customParser });

        assert.strictEqual(bridges.parser, customParser, "parser should be the injected custom parser");
        assert.ok(bridges.formatter instanceof GmlTranspilerBridge, "formatter should still be default");
        assert.ok(bridges.semantic instanceof GmlSemanticBridge, "semantic should still be default");
    });

    void it("accepts optional formatter override", () => {
        const customFormatter: Refactor.TranspilerBridge = {
            transpileScript: () => ({})
        };
        const bridges = createRefactorBridges({ formatter: customFormatter });

        assert.ok(bridges.parser instanceof GmlParserBridge, "parser should still be default");
        assert.strictEqual(bridges.formatter, customFormatter, "formatter should be the injected custom formatter");
        assert.ok(bridges.semantic instanceof GmlSemanticBridge, "semantic should still be default");
    });

    void it("accepts optional semantic override", () => {
        const customSemantic: Refactor.PartialSemanticAnalyzer = {
            resolveSymbolId: () => undefined,
            listNamingConventionTargets: () => []
        };
        const bridges = createRefactorBridges({ semantic: customSemantic });

        assert.ok(bridges.parser instanceof GmlParserBridge, "parser should still be default");
        assert.ok(bridges.formatter instanceof GmlTranspilerBridge, "formatter should still be default");
        assert.strictEqual(bridges.semantic, customSemantic, "semantic should be the injected custom semantic");
    });

    void it("accepts multiple bridge overrides simultaneously", () => {
        const emptyAstNode: AstNode = { start: 0, end: 0 };
        const customParser: Refactor.ParserBridge = {
            parse: () => emptyAstNode
        };
        const customFormatter: Refactor.TranspilerBridge = {
            transpileScript: () => ({})
        };
        const customSemantic: Refactor.PartialSemanticAnalyzer = {
            resolveSymbolId: () => undefined,
            listNamingConventionTargets: () => []
        };
        const bridges = createRefactorBridges({
            parser: customParser,
            formatter: customFormatter,
            semantic: customSemantic
        });

        assert.strictEqual(bridges.parser, customParser);
        assert.strictEqual(bridges.formatter, customFormatter);
        assert.strictEqual(bridges.semantic, customSemantic);
    });

    void it("passes projectRoot to GmlSemanticBridge when provided", () => {
        const customProjectRoot = "/test/project/root";
        const bridges = createRefactorBridges({}, customProjectRoot);

        assert.ok(bridges.semantic instanceof GmlSemanticBridge, "semantic should be GmlSemanticBridge instance");
        const semantic = bridges.semantic;
        const semanticRoot = (semantic as unknown as { projectRoot: string }).projectRoot;
        assert.strictEqual(semanticRoot, customProjectRoot, "GmlSemanticBridge should receive the projectRoot");
    });
});
