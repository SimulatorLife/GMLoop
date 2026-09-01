import assert from "node:assert/strict";
import { test } from "node:test";

import { Lsp } from "@gmloop/lsp";
import type { Semantic } from "@gmloop/semantic";

type SemanticIndexStore = ReturnType<typeof Semantic.openSemanticIndexStore>;
type SemanticSnapshotAcquireResult = Awaited<ReturnType<SemanticIndexStore["acquireSemanticSnapshot"]>>;
type SemanticSnapshotLease = Extract<SemanticSnapshotAcquireResult, Readonly<{ kind: "lease" }>>["lease"];
type SemanticSnapshotQueries = SemanticSnapshotLease["queries"];
type SemanticSymbolOccurrenceMatch = ReturnType<SemanticSnapshotQueries["findDefinitions"]>[number];

const {
    hasExactResolution,
    readOccurrenceEndFromMatch,
    readOccurrenceFilePathFromMatch,
    readOccurrenceRoleFromMatch,
    readOccurrenceStartFromMatch,
    readResolutionKindFromMatch,
    readSymbolDisplayNameFromMatch,
    readSymbolIdFromMatch,
    readSymbolKindFromMatch,
    readSymbolNameFromMatch
} = Lsp.Intelligence;

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

void test("readSymbolNameFromMatch returns the canonical symbol name", () => {
    assert.equal(readSymbolNameFromMatch(createExactMatch()), "player_hp");
});

void test("readSymbolIdFromMatch returns the canonical semantic symbol id", () => {
    assert.equal(readSymbolIdFromMatch(createExactMatch()), "symbol-1");
});

void test("readSymbolDisplayNameFromMatch returns the LSP-facing label", () => {
    assert.equal(readSymbolDisplayNameFromMatch(createExactMatch()), "player_hp");
});

void test("readSymbolKindFromMatch returns the symbol kind discriminator", () => {
    assert.equal(readSymbolKindFromMatch(createExactMatch()), "globalVariable");
});

void test("readOccurrenceRoleFromMatch surfaces definition vs reference", () => {
    assert.equal(readOccurrenceRoleFromMatch(createExactMatch()), "definition");
    assert.equal(readOccurrenceRoleFromMatch(createCandidateMatch()), "reference");
});

void test("readOccurrenceStartFromMatch and readOccurrenceEndFromMatch expose offsets", () => {
    const match = createExactMatch();
    assert.equal(readOccurrenceStartFromMatch(match), 30);
    assert.equal(readOccurrenceEndFromMatch(match), 42);
});

void test("readOccurrenceFilePathFromMatch returns the occurrence file path", () => {
    assert.equal(readOccurrenceFilePathFromMatch(createCandidateMatch()), "scripts/enemy/enemy.gml");
});

void test("readResolutionKindFromMatch preserves the discriminated-union narrowing", () => {
    assert.equal(readResolutionKindFromMatch(createExactMatch()), "exact");
    assert.equal(readResolutionKindFromMatch(createCandidateMatch()), "candidate");
});

void test("hasExactResolution returns true only for exact matches", () => {
    assert.equal(hasExactResolution(createExactMatch()), true);
    assert.equal(hasExactResolution(createCandidateMatch()), false);
});
