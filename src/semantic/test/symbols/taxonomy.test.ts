import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    getGmlSymbolKindForBuiltInType,
    getGmlSymbolKindForIdentifierCollection,
    getGmlSymbolKindSpecificity,
    normalizeGmlSemanticSymbolKind
} from "../../src/symbols/index.js";

void test("identifier collections have one canonical semantic taxonomy", () => {
    assert.deepEqual(
        [
            "constructorStaticMembers", "enumMembers", "enums", "functions", "globalVariables",
            "instanceVariables", "localVariables", "macros", "scripts", "structVariables", "structs"
        ].map(getGmlSymbolKindForIdentifierCollection),
        [
            "constructorStaticMember", "enumMember", "enum", "function", "globalVariable",
            "instanceVariable", "localVariable", "macro", "script", "structVariable", "struct"
        ]
    );
    assert.equal(getGmlSymbolKindForIdentifierCollection("futureCollection"), "unresolved");
});

void test("semantic specificity and external normalization are deterministic", () => {
    assert.ok(getGmlSymbolKindSpecificity("constructorStaticMember") > getGmlSymbolKindSpecificity("structVariable"));
    assert.ok(getGmlSymbolKindSpecificity("structVariable") > getGmlSymbolKindSpecificity("unresolved"));
    assert.equal(normalizeGmlSemanticSymbolKind("futureKind"), "unresolved");
});

void test("built-in metadata types use the canonical taxonomy", () => {
    assert.equal(getGmlSymbolKindForBuiltInType("function"), "function");
    assert.equal(getGmlSymbolKindForBuiltInType("literal"), "constant");
    assert.equal(getGmlSymbolKindForBuiltInType("property"), "member");
    assert.equal(getGmlSymbolKindForBuiltInType("keyword"), null);
    assert.equal(getGmlSymbolKindForBuiltInType("unknown"), "variable");
});

void test("semantic consumers do not reintroduce removed collection, built-in, or specificity maps", async () => {
    const [navigation, highlighting, graph] = await Promise.all([
        readFile(new URL("../../../src/navigation/project-navigation.ts", import.meta.url), "utf8"),
        readFile(new URL("../../../src/highlighting/semantic-highlighting.ts", import.meta.url), "utf8"),
        readFile(new URL("../../../src/graph-index/builder.ts", import.meta.url), "utf8")
    ]);
    assert.doesNotMatch(navigation, /IDENTIFIER_COLLECTION_KINDS/u);
    assert.doesNotMatch(highlighting, /function mapBuiltInKind/u);
    assert.doesNotMatch(highlighting, /function getNavigationKindPriority/u);
    assert.doesNotMatch(graph, /case "instanceVariables"/u);
});
