import assert from "node:assert/strict";
import test from "node:test";

import { Semantic } from "@gmloop/semantic";

void test("semantic highlighting classifies declarations, built-ins, and ignores comments and strings", () => {
    const sourceText = `#macro SPEED 4\nfunction Player(_x) constructor {\n var café = abs(_x);\n // abs café\n return "abs";\n}`;
    const tokens = Semantic.collectGmlSemanticHighlights({
        sourceText,
        occurrences: [],
        projectIdentifiers: [],
        builtIns: [{ name: "abs", type: "function", deprecated: false }]
    });
    const byStart = new Map(tokens.map((token) => [token.start, token]));

    assert.equal(byStart.get(sourceText.indexOf("SPEED"))?.kind, "macro");
    assert.equal(byStart.get(sourceText.indexOf("Player"))?.kind, "class");
    assert.equal(byStart.get(sourceText.indexOf("_x"))?.kind, "parameter");
    assert.equal(byStart.get(sourceText.indexOf("café"))?.kind, "variable");
    assert.deepEqual(byStart.get(sourceText.indexOf("abs"))?.modifiers, ["defaultLibrary"]);
    assert.equal(tokens.filter((token) => sourceText.slice(token.start, token.end) === "abs").length, 1);
});

void test("project occurrences override built-ins and retain definition/reference categories", () => {
    const sourceText = "function abs(value) { return abs(value); }";
    const declarationStart = sourceText.indexOf("abs");
    const referenceStart = sourceText.lastIndexOf("abs");
    const tokens = Semantic.collectGmlSemanticHighlights({
        sourceText,
        builtIns: [{ name: "abs", type: "function", deprecated: false }],
        projectIdentifiers: [],
        occurrences: [
            { start: declarationStart, end: declarationStart + 3, kind: "function", role: "definition" },
            { start: referenceStart, end: referenceStart + 3, kind: "function", role: "reference" }
        ]
    });
    const byStart = new Map(tokens.map((token) => [token.start, token]));
    assert.deepEqual(byStart.get(declarationStart)?.modifiers, ["declaration", "definition"]);
    assert.deepEqual(byStart.get(referenceStart)?.modifiers, []);
});

void test("semantic highlighting orders tokens and carries built-in deprecation", () => {
    const sourceText = "old_api room_name";
    const tokens = Semantic.collectGmlSemanticHighlights({
        sourceText,
        builtIns: [{ name: "old_api", type: "function", deprecated: true }],
        projectIdentifiers: [],
        occurrences: [{ start: 8, end: 17, kind: "room", role: "reference" }]
    });
    assert.deepEqual(
        tokens.map((token) => token.start),
        [0, 8]
    );
    assert.deepEqual(tokens[0]?.modifiers, ["defaultLibrary", "deprecated"]);
    assert.equal(tokens[1]?.kind, "namespace");
});

void test("syntax-only catalog entries do not override TextMate keyword scopes", () => {
    const tokens = Semantic.collectGmlSemanticHighlights({
        sourceText: "if true",
        builtIns: [
            { name: "if", type: "keyword", deprecated: false },
            { name: "true", type: "literal", deprecated: false }
        ],
        projectIdentifiers: [],
        occurrences: []
    });
    assert.deepEqual(
        tokens.map((token) => token.start),
        [3]
    );
});

void test("project resources receive object, room, and generic resource categories", () => {
    const sourceText = "obj_player rm_main spr_player";
    const tokens = Semantic.collectGmlSemanticHighlights({
        sourceText,
        builtIns: [],
        occurrences: [],
        projectIdentifiers: [
            { name: "obj_player", kind: "object" },
            { name: "rm_main", kind: "room" },
            { name: "spr_player", kind: "resource" }
        ]
    });
    assert.deepEqual(
        tokens.map((token) => token.kind),
        ["class", "namespace", "namespace"]
    );
});
