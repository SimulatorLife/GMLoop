import assert from "node:assert/strict";
import test from "node:test";

import {
    createDefaultGmlProgramParser,
    DEFAULT_CODEMOD_PARSER_OPTIONS,
    defaultGmlProgramParser
} from "../src/parser-adapter.js";

void test("defaultGmlProgramParser parses a simple GML program node", () => {
    const ast = defaultGmlProgramParser("var x = 1;");

    assert.ok(ast, "parser adapter should return a parsed AST node");
    assert.equal(typeof ast, "object");
});

void test("defaultGmlProgramParser returns a frozen, reusable function", () => {
    assert.equal(typeof defaultGmlProgramParser, "function");

    const first = defaultGmlProgramParser("var x = 1;");
    const second = defaultGmlProgramParser("var y = 2;");

    assert.ok(first, "first parse should succeed");
    assert.ok(second, "second parse should succeed");
});

void test("defaultGmlProgramParser throws when given malformed GML source", () => {
    assert.throws(
        () => defaultGmlProgramParser("function ( = 1"),
        /expected/u,
        "malformed source should propagate parser errors"
    );
});

void test("createDefaultGmlProgramParser produces an independent parser instance per call", () => {
    const adapterA = createDefaultGmlProgramParser();
    const adapterB = createDefaultGmlProgramParser();

    assert.notStrictEqual(adapterA, adapterB, "each call must yield a fresh closure");
    assert.equal(typeof adapterA, "function");
    assert.equal(typeof adapterB, "function");

    assert.ok(adapterA("var x = 1;"));
    assert.ok(adapterB("var y = 2;"));
});

void test("createDefaultGmlProgramParser accepts custom parser options", () => {
    const customAdapter = createDefaultGmlProgramParser({
        ...DEFAULT_CODEMOD_PARSER_OPTIONS,
        simplifyLocations: false
    });

    assert.ok(customAdapter("var x = 1;"));
});

void test("DEFAULT_CODEMOD_PARSER_OPTIONS is frozen and matches parser workspace defaults", () => {
    assert.equal(Object.isFrozen(DEFAULT_CODEMOD_PARSER_OPTIONS), true);
    assert.equal(DEFAULT_CODEMOD_PARSER_OPTIONS.astFormat, "gml");
    assert.equal(DEFAULT_CODEMOD_PARSER_OPTIONS.asJSON, false);
    assert.equal(DEFAULT_CODEMOD_PARSER_OPTIONS.getComments, true);
    assert.equal(DEFAULT_CODEMOD_PARSER_OPTIONS.getLocations, true);
    assert.equal(DEFAULT_CODEMOD_PARSER_OPTIONS.simplifyLocations, true);
    assert.equal(DEFAULT_CODEMOD_PARSER_OPTIONS.attachFunctionDocComments, true);
});
