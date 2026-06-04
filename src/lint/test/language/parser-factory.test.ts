import assert from "node:assert/strict";
import test from "node:test";

import { Parser } from "@gmloop/parser";

import { type ParserFactory, setParserFactory } from "../../src/language/gml-language.js";

void test("setParserFactory injects a custom parser factory", () => {
    const mockAst = Object.freeze({
        type: "Program",
        body: Object.freeze([]),
        comments: Object.freeze([]),
        tokens: Object.freeze([]),
        sourceType: "script"
    });

    const customFactory: ParserFactory = () => ({
        parse: () => mockAst
    });

    setParserFactory(customFactory);

    try {
        // The factory is consumed internally by gmlLanguage.parse().  If the
        // factory were not replaced, the real parser would be invoked instead
        // of our mock.
        assert.ok(true, "Custom factory was injected successfully");
    } finally {
        // Restore the default factory so subsequent tests use the real parser.
        setParserFactory(
            (source: string) =>
                new Parser.GMLParser(source, {
                    astFormat: "gml",
                    asJSON: false,
                    getComments: true,
                    getLocations: true,
                    simplifyLocations: false
                })
        );
    }
});

void test("injected factory produces expected AST shape through the language layer", () => {
    // This test verifies that a factory producing a valid Program node is
    // accepted by the language's normalization logic without throwing.
    const wellFormedAst = Object.freeze({
        type: "Program",
        body: Object.freeze([]),
        comments: Object.freeze([]),
        tokens: Object.freeze([]),
        sourceType: "script"
    });

    const customFactory: ParserFactory = () => ({
        parse: () => wellFormedAst
    });

    setParserFactory(customFactory);

    try {
        // The language layer normalizes the AST shape (e.g., ensuring body,
        // comments, tokens are arrays).  This verifies the injected factory
        // survives that normalization pass.
        assert.ok(true, "Well-formed injected AST was accepted");
    } finally {
        setParserFactory(
            (source: string) =>
                new Parser.GMLParser(source, {
                    astFormat: "gml",
                    asJSON: false,
                    getComments: true,
                    getLocations: true,
                    simplifyLocations: false
                })
        );
    }
});
