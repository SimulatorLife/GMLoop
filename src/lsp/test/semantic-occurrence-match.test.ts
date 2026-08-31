import assert from "node:assert/strict";
import { test } from "node:test";

import type { Semantic } from "@gmloop/semantic";

type SemanticIndexStore = ReturnType<typeof Semantic.openSemanticIndexStore>;
type SemanticSnapshotAcquireResult = Awaited<ReturnType<SemanticIndexStore["acquireSemanticSnapshot"]>>;
type SemanticSnapshotLease = Extract<SemanticSnapshotAcquireResult, Readonly<{ kind: "lease" }>>["lease"];
type SemanticSnapshotQueries = SemanticSnapshotLease["queries"];
type SemanticSymbolOccurrenceMatch = ReturnType<SemanticSnapshotQueries["findDefinitions"]>[number];

function createExactMatch(): SemanticSymbolOccurrenceMatch {
    return {
        occurrence: {
            end: 42,
            filePath: "scripts/player/player.gml",
            resolution: { kind: "exact" },
            role: "definition",
            scopeId: "scope-1",
            start: 30,
            symbolId: "symbol-1"
        },
        symbol: {
            definingFilePath: "scripts/player/player.gml",
            displayName: "player_hp",
            documentation: {
                additionalTags: [],
                description: "",
                normalizedText: "",
                parameters: [],
                returns: null
            },
            kind: "globalVariable",
            name: "player_hp",
            scopeId: "scope-1",
            symbolId: "symbol-1"
        }
    };
}

function createCandidateMatch(): SemanticSymbolOccurrenceMatch {
    return {
        occurrence: {
            end: 80,
            filePath: "scripts/enemy/enemy.gml",
            resolution: {
                kind: "candidate",
                candidateSymbolIds: ["symbol-a", "symbol-b"],
                uncertaintyReason: "Shadowed by a local variable."
            },
            role: "reference",
            scopeId: null,
            start: 70,
            symbolId: "symbol-a"
        },
        symbol: {
            definingFilePath: null,
            displayName: "max_hp",
            documentation: {
                additionalTags: [],
                description: "",
                normalizedText: "",
                parameters: [],
                returns: null
            },
            kind: "localVariable",
            name: "max_hp",
            scopeId: "scope-2",
            symbolId: "symbol-a"
        }
    };
}

void test("match.symbol.name exposes the canonical symbol name", () => {
    assert.equal(createExactMatch().symbol.name, "player_hp");
});

void test("match.symbol.symbolId exposes the canonical semantic symbol id", () => {
    assert.equal(createExactMatch().symbol.symbolId, "symbol-1");
});

void test("match.symbol.displayName surfaces the LSP-facing label", () => {
    assert.equal(createExactMatch().symbol.displayName, "player_hp");
});

void test("match.symbol.kind exposes the symbol kind discriminator", () => {
    assert.equal(createExactMatch().symbol.kind, "globalVariable");
});

void test("match.occurrence.role distinguishes definition vs reference", () => {
    assert.equal(createExactMatch().occurrence.role, "definition");
    assert.equal(createCandidateMatch().occurrence.role, "reference");
});

void test("match.occurrence.start and match.occurrence.end expose the offsets", () => {
    const match = createExactMatch();
    assert.equal(match.occurrence.start, 30);
    assert.equal(match.occurrence.end, 42);
});

void test("match.occurrence.filePath exposes the occurrence file path", () => {
    assert.equal(createCandidateMatch().occurrence.filePath, "scripts/enemy/enemy.gml");
});

void test("match.occurrence.resolution.kind preserves the discriminated-union narrowing", () => {
    assert.equal(createExactMatch().occurrence.resolution.kind, "exact");
    assert.equal(createCandidateMatch().occurrence.resolution.kind, "candidate");
});

void test("match.occurrence.resolution.kind equals 'exact' only for exact matches", () => {
    assert.equal(createExactMatch().occurrence.resolution.kind === "exact", true);
    assert.equal(createCandidateMatch().occurrence.resolution.kind === "exact", false);
});
