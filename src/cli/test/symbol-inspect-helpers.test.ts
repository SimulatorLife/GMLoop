import assert from "node:assert/strict";
import { test } from "node:test";

import { __symbolInspectTest__ } from "../src/commands/symbol.js";

const { narrowSymbolCandidatesByName, parseIncludeFlags } = __symbolInspectTest__;

type FakeGraphNode = { id: string; kind: string; name: string };

void test("parseIncludeFlags normalises comma-separated include options", () => {
    const flags = parseIncludeFlags("node, context , usages , unknown");
    assert.deepEqual([...flags].sort(), ["context", "node", "usages"]);
});

void test("parseIncludeFlags tolerates missing input and trims whitespace", () => {
    assert.equal(parseIncludeFlags(undefined).size, 0);
    assert.deepEqual([...parseIncludeFlags("  dependents  ")], ["dependents"]);
});

void test("parseIncludeFlags returns the full set when every known flag is supplied", () => {
    const flags = parseIncludeFlags("node,context,neighbors,usages,dependents");
    assert.equal(flags.size, 5);
    assert.ok(flags.has("node"));
    assert.ok(flags.has("context"));
    assert.ok(flags.has("neighbors"));
    assert.ok(flags.has("usages"));
    assert.ok(flags.has("dependents"));
});

void test("narrowSymbolCandidatesByName prefers exact case-sensitive matches", () => {
    const candidates: Array<FakeGraphNode> = [
        { id: "1", kind: "script", name: "demo" },
        { id: "2", kind: "script", name: "DEMO" },
        { id: "3", kind: "script", name: "other" }
    ];
    assert.deepEqual(
        narrowSymbolCandidatesByName(candidates, "demo").map((candidate) => candidate.id),
        ["1"]
    );
});

void test("narrowSymbolCandidatesByName falls back to case-insensitive matches", () => {
    const candidates: Array<FakeGraphNode> = [
        { id: "1", kind: "script", name: "Other" },
        { id: "2", kind: "script", name: "Demo" }
    ];
    assert.deepEqual(
        narrowSymbolCandidatesByName(candidates, "demo").map((candidate) => candidate.id),
        ["2"]
    );
});

void test("narrowSymbolCandidatesByName returns an empty list when nothing matches", () => {
    const candidates: Array<FakeGraphNode> = [
        { id: "1", kind: "script", name: "alpha" },
        { id: "2", kind: "script", name: "beta" }
    ];
    assert.equal(narrowSymbolCandidatesByName(candidates, "demo").length, 0);
});

void test("narrowSymbolCandidatesByName returns the case-sensitive match set in full when several exact matches exist", () => {
    const candidates: Array<FakeGraphNode> = [
        { id: "1", kind: "script", name: "demo" },
        { id: "2", kind: "script", name: "demo" },
        { id: "3", kind: "script", name: "other" }
    ];
    assert.deepEqual(
        narrowSymbolCandidatesByName(candidates, "demo").map((candidate) => candidate.id),
        ["1", "2"]
    );
});
