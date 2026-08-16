import assert from "node:assert/strict";
import test from "node:test";

import { Parser } from "@gmloop/parser";

import { gmlLanguage, type ParserFactory, setParserFactory } from "../../src/language/gml-language.js";

/**
 * Production default parser factory, captured here so tests can restore it
 * after injecting a custom factory. Mirrors the module-scope default used by
 * `gml-language.ts`.
 */
const defaultFactory: ParserFactory = (source: string) =>
    new Parser.GMLParser(source, {
        astFormat: "gml",
        asJSON: false,
        getComments: true,
        getLocations: true,
        simplifyLocations: false
    });

void test("setParserFactory installs the injected factory used by gmlLanguage.parse", () => {
    // The two previous tests ("setParserFactory injects a custom parser factory"
    // and "injected factory produces expected AST shape through the language
    // layer") both froze an identical Program AST, defined a factory returning
    // it, called setParserFactory, and ended with `assert.ok(true, ...)`. That
    // tautology could not detect a setter that silently ignored the replacement,
    // nor could it verify the language layer ever consumed the new factory.
    // This single test exercises the full replacement path: the custom factory
    // is invoked exactly once by gmlLanguage.parse and its AST survives the
    // language layer's normalisation pass without distortion.
    const customAst = Object.freeze({
        type: "Program",
        body: Object.freeze([]),
        comments: Object.freeze([]),
        tokens: Object.freeze([]),
        sourceType: "script"
    });

    let parseInvocations = 0;
    const customFactory: ParserFactory = () => ({
        parse: () => {
            parseInvocations += 1;
            return customAst;
        }
    });

    setParserFactory(customFactory);

    try {
        const result = gmlLanguage.parse({ body: "show_debug_message(1);", filePath: "fixture.gml" }, {});

        assert.equal(result.ok, true, "Injected factory must produce a parseable AST");
        assert.equal(parseInvocations, 1, "gmlLanguage.parse must consume the injected factory exactly once");
        if (!result.ok) {
            return;
        }

        assert.equal(result.ast.type, customAst.type);
        assert.equal(result.ast.sourceType, customAst.sourceType);
        assert.deepEqual(Array.from(result.ast.body), []);
        assert.deepEqual(Array.from(result.ast.comments), []);
        assert.deepEqual(Array.from(result.ast.tokens), []);
    } finally {
        // Restore the default factory so subsequent tests use the real parser.
        setParserFactory(defaultFactory);
    }
});
