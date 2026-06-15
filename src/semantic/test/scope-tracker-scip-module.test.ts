import assert from "node:assert/strict";
import test from "node:test";

import { Scope } from "../src/scopes/scope.js";
import {
    exportOccurrencesBySymbolsFromTracker,
    exportScipOccurrencesFromTracker,
    type ScipExportView
} from "../src/scopes/scope-tracker-scip.js";
import type { IdentifierOccurrences, Occurrence, ScopeSummary } from "../src/scopes/types.js";
import { ROLE_DEF, ROLE_REF } from "../src/symbols/scip.js";

const START_LINE = 1;
const COL_0 = 0;
const COL_6 = 6;
const CHAR_INDEX_6 = 6;

function buildOccurrence(name: string, scopeId: string, kind: "declaration" | "reference"): Occurrence {
    return {
        kind,
        name,
        scopeId,
        classifications: ["identifier", kind],
        declaration: null,
        usageContext: null,
        start: { line: START_LINE, column: COL_0, index: COL_0 },
        end: { line: START_LINE, column: COL_6, index: CHAR_INDEX_6 }
    };
}

function makeIdentifierOccurrences(
    name: string,
    scopeId: string,
    declarations: number,
    references: number
): IdentifierOccurrences {
    return {
        declarations: Array.from({ length: declarations }, () => buildOccurrence(name, scopeId, "declaration")),
        references: Array.from({ length: references }, () => buildOccurrence(name, scopeId, "reference"))
    };
}

interface FakeViewInit {
    scopes?: Array<{ id: string; kind: string; symbols: Record<string, IdentifierOccurrences> }>;
    symbolIndex?: Map<string, Map<string, ScopeSummary>>;
}

function buildFakeView({ scopes = [], symbolIndex }: FakeViewInit): ScipExportView {
    const scopesById = new Map<string, Scope>();
    for (const entry of scopes) {
        const scope = new Scope(entry.id, entry.kind);
        for (const [name, occurrences] of Object.entries(entry.symbols)) {
            scope.occurrences.set(name, occurrences);
        }
        scopesById.set(entry.id, scope);
    }

    const inferredIndex = symbolIndex ?? new Map<string, Map<string, ScopeSummary>>();
    for (const entry of scopes) {
        for (const name of Object.keys(entry.symbols)) {
            let inner = inferredIndex.get(name);
            if (!inner) {
                inner = new Map();
                inferredIndex.set(name, inner);
            }
            inner.set(entry.id, { hasDeclaration: true, hasReference: true, lastModified: 0 });
        }
    }

    return { scopesById, symbolToScopesIndex: inferredIndex };
}

void test("exportScipOccurrencesFromTracker serializes every occurrence with the default symbol generator", () => {
    const view = buildFakeView({
        scopes: [
            {
                id: "scope-A",
                kind: "program",
                symbols: { alpha: makeIdentifierOccurrences("alpha", "scope-A", 1, 1) }
            },
            {
                id: "scope-B",
                kind: "function",
                symbols: { beta: makeIdentifierOccurrences("beta", "scope-B", 1, 0) }
            }
        ]
    });

    const result = exportScipOccurrencesFromTracker(view);

    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(
        result.map((entry) => entry.scopeId),
        ["scope-A", "scope-B"]
    );
    assert.strictEqual(result[0].occurrences.length, 2);
    assert.strictEqual(result[1].occurrences.length, 1);

    const alpha = result[0].occurrences.find((occ) => occ.symbol === "scope-A::alpha");
    assert.ok(alpha);
    assert.strictEqual(alpha.symbolRoles, ROLE_DEF);
    const alphaRef = result[0].occurrences.find((occ) => occ.symbolRoles === ROLE_REF);
    assert.ok(alphaRef);
    assert.strictEqual(alphaRef.symbol, "scope-A::alpha");
});

void test("exportScipOccurrencesFromTracker honours includeReferences=false", () => {
    const view = buildFakeView({
        scopes: [
            {
                id: "scope-A",
                kind: "program",
                symbols: { alpha: makeIdentifierOccurrences("alpha", "scope-A", 1, 2) }
            }
        ]
    });

    const declarationsOnly = exportScipOccurrencesFromTracker(view, { includeReferences: false });

    assert.strictEqual(declarationsOnly.length, 1);
    assert.strictEqual(declarationsOnly[0].occurrences.length, 1);
    assert.strictEqual(declarationsOnly[0].occurrences[0].symbolRoles, ROLE_DEF);
});

void test("exportScipOccurrencesFromTracker scopes output to a single scopeId when provided", () => {
    const view = buildFakeView({
        scopes: [
            { id: "scope-A", kind: "program", symbols: { alpha: makeIdentifierOccurrences("alpha", "scope-A", 1, 0) } },
            { id: "scope-B", kind: "function", symbols: { beta: makeIdentifierOccurrences("beta", "scope-B", 1, 0) } }
        ]
    });

    const result = exportScipOccurrencesFromTracker(view, { scopeId: "scope-B" });

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].scopeId, "scope-B");
    assert.strictEqual(result[0].scopeKind, "function");
});

void test("exportScipOccurrencesFromTracker returns an empty list for an unknown scopeId", () => {
    const view = buildFakeView({ scopes: [] });
    const result = exportScipOccurrencesFromTracker(view, { scopeId: "missing" });
    assert.deepStrictEqual(result, []);
});

void test("exportScipOccurrencesFromTracker uses a custom symbol generator when provided", () => {
    const view = buildFakeView({
        scopes: [
            { id: "scope-A", kind: "program", symbols: { alpha: makeIdentifierOccurrences("alpha", "scope-A", 1, 0) } }
        ]
    });

    const generatorCalls: Array<{ name: string; scopeId: string }> = [];
    const result = exportScipOccurrencesFromTracker(view, {
        symbolGenerator(name, scopeId) {
            generatorCalls.push({ name, scopeId });
            return `gml/var/${name}`;
        }
    });

    assert.deepStrictEqual(generatorCalls, [{ name: "alpha", scopeId: "scope-A" }]);
    assert.strictEqual(result[0].occurrences[0].symbol, "gml/var/alpha");
});

void test("exportOccurrencesBySymbolsFromTracker returns [] for empty input", () => {
    const view = buildFakeView({
        scopes: [
            { id: "scope-A", kind: "program", symbols: { alpha: makeIdentifierOccurrences("alpha", "scope-A", 1, 1) } }
        ]
    });
    assert.deepStrictEqual(exportOccurrencesBySymbolsFromTracker(view, []), []);
    assert.deepStrictEqual(exportOccurrencesBySymbolsFromTracker(view, new Set<string>()), []);
});

void test("exportOccurrencesBySymbolsFromTracker limits scopes to the requested symbol set", () => {
    const view = buildFakeView({
        scopes: [
            {
                id: "scope-A",
                kind: "program",
                symbols: {
                    alpha: makeIdentifierOccurrences("alpha", "scope-A", 1, 1),
                    beta: makeIdentifierOccurrences("beta", "scope-A", 1, 1)
                }
            },
            {
                id: "scope-B",
                kind: "function",
                symbols: { gamma: makeIdentifierOccurrences("gamma", "scope-B", 1, 0) }
            }
        ]
    });

    const result = exportOccurrencesBySymbolsFromTracker(view, ["alpha"]);

    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].scopeId, "scope-A");
    assert.strictEqual(result[0].occurrences.length, 2);
    for (const occ of result[0].occurrences) {
        assert.strictEqual(occ.symbol, "scope-A::alpha");
    }
});

void test("exportOccurrencesBySymbolsFromTracker respects includeReferences and scopeId", () => {
    const view = buildFakeView({
        scopes: [
            {
                id: "scope-A",
                kind: "program",
                symbols: { alpha: makeIdentifierOccurrences("alpha", "scope-A", 1, 1) }
            },
            {
                id: "scope-B",
                kind: "function",
                symbols: { alpha: makeIdentifierOccurrences("alpha", "scope-B", 1, 1) }
            }
        ]
    });

    const declarationsOnly = exportOccurrencesBySymbolsFromTracker(view, ["alpha"], { includeReferences: false });
    const declarationsTotal = declarationsOnly.reduce((sum, entry) => sum + entry.occurrences.length, 0);
    assert.strictEqual(declarationsTotal, 2);

    const singleScope = exportOccurrencesBySymbolsFromTracker(view, ["alpha"], { scopeId: "scope-A" });
    assert.strictEqual(singleScope.length, 1);
    assert.strictEqual(singleScope[0].scopeId, "scope-A");
});

void test("exportOccurrencesBySymbolsFromTracker returns an empty list when symbols are unknown", () => {
    const view = buildFakeView({
        scopes: [
            { id: "scope-A", kind: "program", symbols: { alpha: makeIdentifierOccurrences("alpha", "scope-A", 1, 0) } }
        ]
    });
    const result = exportOccurrencesBySymbolsFromTracker(view, ["unknownSymbol"]);
    assert.deepStrictEqual(result, []);
});
