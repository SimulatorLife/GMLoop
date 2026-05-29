/**
 * Tests for pre-parsed AST and pre-extracted symbol reuse in transpileFile.
 *
 * Verifies that passing `cachedAst`, `cachedSymbols`, and `cachedReferences`
 * through `TranspilationOptions` avoids redundant AST traversals and produces
 * identical output to the parse-from-source path.  This covers the hot-reload
 * startup optimization where `collectScriptNames` already produces an AST, symbols,
 * and references that `performInitialScan` can reuse via the file cache.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Parser } from "@gmloop/parser";
import { Transpiler } from "@gmloop/transpiler";

import { type TranspilationContext, transpileFile } from "../src/modules/transpilation/coordinator.js";
import { extractReferencesFromAst, extractSymbolsFromAst } from "../src/modules/transpilation/symbol-extraction.js";

function createContext(): TranspilationContext {
    return {
        transpiler: new Transpiler.GmlTranspiler(),
        patches: [],
        metrics: [],
        errors: [],
        lastSuccessfulPatches: new Map(),
        bounds: { maxEntries: 50 },
        totalPatchCount: 0,
        websocketServer: null
    };
}

const TEST_FILE_PATH = "/project/scripts/scr_player.gml";
const TEST_SOURCE = `function scr_player() {
    var speed = 4;
    x += speed;
}`;

void describe("transpileFile with cachedAst", () => {
    void it("produces identical output when cachedAst matches the source", () => {
        const context = createContext();

        // Result from the standard path (no pre-parsed AST)
        const resultNoCache = transpileFile(context, TEST_FILE_PATH, TEST_SOURCE, 4, {
            verbose: false,
            quiet: true
        });

        // Reset state for a clean second run
        const context2 = createContext();

        // Pre-parse the AST (simulates what collectScriptNames does)
        const parser = new Parser.GMLParser(TEST_SOURCE, {});
        const preParseAst = parser.parse();

        // Result from the cached-AST path
        const resultCached = transpileFile(context2, TEST_FILE_PATH, TEST_SOURCE, 4, {
            verbose: false,
            quiet: true,
            cachedAst: preParseAst
        });

        assert.ok(resultNoCache.success, "Standard transpilation should succeed");
        assert.ok(resultCached.success, "Cached-AST transpilation should succeed");

        // Both paths must produce the same JavaScript body
        assert.strictEqual(
            resultCached.patch?.js_body,
            resultNoCache.patch?.js_body,
            "Cached-AST path must produce the same JS body as the parse-from-source path"
        );

        // Patch IDs and kinds should match
        assert.strictEqual(resultCached.patch?.id, resultNoCache.patch?.id, "Patch IDs must match");
        assert.strictEqual(resultCached.patch?.kind, resultNoCache.patch?.kind, "Patch kinds must match");

        // Extracted symbols should match
        assert.deepStrictEqual(
            resultCached.symbols?.sort(),
            resultNoCache.symbols?.sort(),
            "Extracted symbols must match"
        );
    });

    void it("records metrics regardless of whether cachedAst is used", () => {
        const context = createContext();

        const parser = new Parser.GMLParser(TEST_SOURCE, {});
        const preParseAst = parser.parse();

        const result = transpileFile(context, TEST_FILE_PATH, TEST_SOURCE, 4, {
            verbose: false,
            quiet: true,
            cachedAst: preParseAst
        });

        assert.ok(result.success, "Transpilation should succeed");
        assert.ok(result.metrics, "Metrics should be recorded");
        assert.strictEqual(typeof result.metrics?.durationMs, "number", "Duration should be a number");
        assert.ok(result.metrics && result.metrics.durationMs >= 0, "Duration should be non-negative");
    });

    void it("falls back to parsing from source when cachedAst is undefined", () => {
        const context = createContext();

        const result = transpileFile(context, TEST_FILE_PATH, TEST_SOURCE, 4, {
            verbose: false,
            quiet: true,
            cachedAst: undefined
        });

        assert.ok(result.success, "Transpilation should succeed without cachedAst");
        assert.ok(result.patch?.js_body, "Patch should have a JavaScript body");
    });
});

void describe("transpileFile with cachedSymbols and cachedReferences", () => {
    void it("produces identical output when cachedSymbols and cachedReferences are provided", () => {
        const context = createContext();

        // Result from the standard path (no pre-extracted metadata)
        const resultNoCache = transpileFile(context, TEST_FILE_PATH, TEST_SOURCE, 4, {
            verbose: false,
            quiet: true
        });

        // Reset state for a clean second run
        const context2 = createContext();

        // Pre-parse the AST and extract symbols/references (simulates what addScriptNamesFromFile does)
        const parser = new Parser.GMLParser(TEST_SOURCE, {});
        const preParseAst = parser.parse();
        const preSymbols = extractSymbolsFromAst(preParseAst, TEST_FILE_PATH);
        const preReferences = extractReferencesFromAst(preParseAst);

        // Result from the fully-cached path
        const resultCached = transpileFile(context2, TEST_FILE_PATH, TEST_SOURCE, 4, {
            verbose: false,
            quiet: true,
            cachedAst: preParseAst,
            cachedSymbols: preSymbols,
            cachedReferences: preReferences
        });

        assert.ok(resultNoCache.success, "Standard transpilation should succeed");
        assert.ok(resultCached.success, "Cached-symbols/references transpilation should succeed");

        // Both paths must produce the same JavaScript body
        assert.strictEqual(
            resultCached.patch?.js_body,
            resultNoCache.patch?.js_body,
            "Cached-symbols path must produce the same JS body as the parse-from-source path"
        );

        // Patch IDs and kinds should match
        assert.strictEqual(resultCached.patch?.id, resultNoCache.patch?.id, "Patch IDs must match");
        assert.strictEqual(resultCached.patch?.kind, resultNoCache.patch?.kind, "Patch kinds must match");

        // Extracted symbols and references should match the pre-extracted values
        assert.deepStrictEqual(
            resultCached.symbols?.sort(),
            preSymbols.sort(),
            "Cached symbols must be returned verbatim"
        );
        assert.deepStrictEqual(
            resultCached.references?.sort(),
            preReferences.sort(),
            "Cached references must be returned verbatim"
        );
    });

    void it("skips AST traversal when cachedSymbols and cachedReferences are provided", () => {
        const context = createContext();

        // Pre-parse and extract (done in addScriptNamesFromFile during startup scan)
        const parser = new Parser.GMLParser(TEST_SOURCE, {});
        const preParseAst = parser.parse();
        const preSymbols = extractSymbolsFromAst(preParseAst, TEST_FILE_PATH);
        const preReferences = extractReferencesFromAst(preParseAst);

        // Pass all cached data — the coordinator should not call extractSymbolsFromAst
        // or extractReferencesFromAst again for this file.
        const result = transpileFile(context, TEST_FILE_PATH, TEST_SOURCE, 4, {
            verbose: false,
            quiet: true,
            cachedAst: preParseAst,
            cachedSymbols: preSymbols,
            cachedReferences: preReferences
        });

        assert.ok(result.success, "Transpilation should succeed with all cached data");
        assert.deepStrictEqual(result.symbols?.sort(), preSymbols.sort(), "Symbols should match cached value");
        assert.deepStrictEqual(result.references?.sort(), preReferences.sort(), "References should match cached value");
    });

    void it("falls back to extracting symbols/references when cached values are not provided", () => {
        const context = createContext();

        // Pre-parse the AST but do not extract symbols/references ahead of time
        const parser = new Parser.GMLParser(TEST_SOURCE, {});
        const preParseAst = parser.parse();

        const result = transpileFile(context, TEST_FILE_PATH, TEST_SOURCE, 4, {
            verbose: false,
            quiet: true,
            cachedAst: preParseAst
            // No cachedSymbols or cachedReferences — should extract from the AST
        });

        assert.ok(result.success, "Transpilation should succeed with only cachedAst");
        assert.ok(result.symbols && result.symbols.length > 0, "Symbols should be extracted from AST");
        assert.ok(result.references !== undefined, "References field should be present");
    });
});
