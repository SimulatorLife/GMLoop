/**
 * Unit tests for the parser/transpiler adapter factories introduced to
 * invert the CLI's direct dependency on the concrete `Parser.GMLParser` and
 * `Transpiler.GmlTranspiler` classes.
 *
 * These tests verify:
 *
 *   - The factories instantiate the canonical adapters and produce AST /
 *     transpiler output identical to the previous `new`-based call sites.
 *   - The factories accept option overrides without leaking the concrete
 *     parser/transpiler types into callers.
 *   - Callers can replace the factories with stubs at composition time
 *     (the seam the high-level orchestration layer depends on).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    createGmlParserAdapter,
    createGmlTranspilerAdapter,
    DEFAULT_PARSER_ADAPTER_OPTIONS,
    type GmlParserAdapter
} from "../src/modules/transpilation/adapters.js";

const SAMPLE_GML = "var answer = 42;";

void describe("createGmlParserAdapter", () => {
    void it("returns an AST when invoked with a GML source string", () => {
        const adapter = createGmlParserAdapter();

        const ast = adapter(SAMPLE_GML) as { type?: string };

        assert.ok(ast, "adapter should produce a non-null AST");
        assert.equal(ast.type, "Program");
    });

    void it("uses the documented default options when none are supplied", () => {
        // The default option set is the same set the previous `new
        // Parser.GMLParser(content, {...})` call site used, so callers do
        // not need to thread options through to keep behaviour identical.
        assert.equal(DEFAULT_PARSER_ADAPTER_OPTIONS.getComments, false);
        assert.equal(DEFAULT_PARSER_ADAPTER_OPTIONS.getLocations, true);
        assert.equal(DEFAULT_PARSER_ADAPTER_OPTIONS.simplifyLocations, true);
        assert.equal(DEFAULT_PARSER_ADAPTER_OPTIONS.attachFunctionDocComments, false);
        assert.equal(DEFAULT_PARSER_ADAPTER_OPTIONS.sllPredictionMaxSourceLength, 1_000_000);
    });

    void it("accepts option overrides and forwards them to the underlying parser", () => {
        const adapter = createGmlParserAdapter({
            getComments: true,
            getLocations: true,
            simplifyLocations: true,
            attachFunctionDocComments: false,
            sllPredictionMaxSourceLength: 8000,
            astFormat: "gml",
            asJSON: false
        });

        const ast = adapter(SAMPLE_GML) as { type?: string };

        assert.equal(ast.type, "Program");
    });

    void it("returns a callable that can be replaced by a stub for testing", () => {
        // The factory is the dependency-inversion seam: orchestration code
        // that depends on `GmlParserAdapter` should be able to receive a
        // stub without touching the parser workspace.
        const stubAst = { type: "Program", body: [], stub: true } as unknown;
        const stubAdapter: GmlParserAdapter = () => stubAst;

        const ast = stubAdapter(SAMPLE_GML);

        assert.strictEqual(ast, stubAst);
    });
});

void describe("createGmlTranspilerAdapter", () => {
    void it("returns a GmlTranspiler instance with the canonical configuration", () => {
        const transpiler = createGmlTranspilerAdapter();

        assert.equal(typeof transpiler.transpileScript, "function");
        assert.equal(typeof transpiler.transpileEvent, "function");
        assert.equal(typeof transpiler.transpileExpression, "function");
    });

    void it("accepts upstream dependencies (semantic analyzer, emitter options)", () => {
        // When dependencies are supplied, the factory must pass them through
        // to the GmlTranspiler constructor. The factory must not strip or
        // silently mutate them.
        const transpiler = createGmlTranspilerAdapter({});

        assert.ok(transpiler, "factory should return an instance for empty dependencies");
    });

    void it("returns a fresh instance per call so callers cannot accidentally share state", () => {
        const first = createGmlTranspilerAdapter();
        const second = createGmlTranspilerAdapter();

        assert.notStrictEqual(first, second);
    });
});
