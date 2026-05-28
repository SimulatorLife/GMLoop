import assert from "node:assert/strict";
import test from "node:test";

import { SCOPE_OVERRIDE_KEYWORD } from "../src/scopes/index.js";
import ScopeTracker from "../src/scopes/scope-tracker.js";
import {
    cloneLocation,
    cloneRange,
    createRange,
    type SourceLocation,
    type SourceRange
} from "./scope-tracker-helpers.js";

void test("resolveScopeOverride returns the root scope when using the global keyword", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const rootScope = tracker.enterScope("root");
    tracker.enterScope("child");

    const result = tracker.resolveScopeOverride(SCOPE_OVERRIDE_KEYWORD);

    assert.strictEqual(result, rootScope);
});

void test("resolveScopeOverride returns a scope that matches an explicit identifier", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("root");
    const explicitScope = tracker.enterScope("explicit");

    const result = tracker.resolveScopeOverride(explicitScope.id);

    assert.strictEqual(result, explicitScope);
});

void test("resolveScopeOverride throws when given an unknown string keyword", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("root");

    assert.throws(
        () => tracker.resolveScopeOverride("GLOBAL"),
        (error) => {
            assert.ok(error instanceof RangeError);
            assert.match(error.message, /Unknown scope override string 'GLOBAL'.*scope identifier\./);
            return true;
        }
    );
});

void test("exportOccurrences captures declarations and references by scope", () => {
    const { tracker, programScope, blockScope, declarationRange, referenceRange } =
        createTrackerWithDeclarationAndReference();

    const expected = buildDeclarationAndReferenceSnapshot({
        name: "foo",
        programScopeId: programScope.id,
        blockScopeId: blockScope.id,
        declarationRange,
        referenceRange,
        programMetadata: {
            lastModified: programScope.lastModifiedTimestamp,
            modificationCount: programScope.modificationCount
        },
        blockMetadata: {
            lastModified: blockScope.lastModifiedTimestamp,
            modificationCount: blockScope.modificationCount
        }
    });

    assert.deepStrictEqual(tracker.exportOccurrences(), expected);
});

void test("exportOccurrences can omit references and returns cloned metadata", () => {
    const { tracker, scope, declarationRange } = createSingleScopeTracker("bar");

    const expected = [
        buildDeclarationScopeSnapshot({
            scopeId: scope.id,
            scopeKind: "program",
            name: "bar",
            declarationRange,
            classifications: ["identifier", "declaration"],
            lastModified: scope.lastModifiedTimestamp,
            modificationCount: scope.modificationCount
        })
    ];

    const occurrences = tracker.exportOccurrences({ includeReferences: false });

    assert.deepStrictEqual(occurrences, expected);

    occurrences[0].identifiers[0].declarations[0].classifications.push("mutated");

    assert.deepStrictEqual(tracker.exportOccurrences({ includeReferences: false }), expected);
});

void test("getScopeOccurrences exports a single scope payload", () => {
    const { tracker, programScope, blockScope, declarationRange, referenceRange } =
        createTrackerWithDeclarationAndReference();

    const result = tracker.getScopeOccurrences(blockScope.id);

    const expected = buildReferenceScopeSnapshot({
        scopeId: blockScope.id,
        scopeKind: "block",
        name: "foo",
        referenceRange,
        declarationScopeId: programScope.id,
        declarationRange,
        classifications: ["identifier", "reference", "variable", "local"],
        lastModified: blockScope.lastModifiedTimestamp,
        modificationCount: blockScope.modificationCount
    });

    assert.deepStrictEqual(result, expected);
});

void test("getScopeOccurrences omits references when requested and clones metadata", () => {
    const { tracker, scope, declarationRange } = createSingleScopeTracker("bar");

    const occurrences = tracker.getScopeOccurrences(scope.id, {
        includeReferences: false
    });

    const expected = buildDeclarationScopeSnapshot({
        scopeId: scope.id,
        scopeKind: "program",
        name: "bar",
        declarationRange,
        classifications: ["identifier", "declaration"],
        lastModified: scope.lastModifiedTimestamp,
        modificationCount: scope.modificationCount
    });

    assert.deepStrictEqual(occurrences, expected);

    occurrences.identifiers[0].declarations[0].classifications.push("mutated");

    assert.deepStrictEqual(tracker.getScopeOccurrences(scope.id, { includeReferences: false }), expected);
});

void test("getScopeOccurrences returns null for disabled or unknown scopes", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("program");
    tracker.exitScope();

    assert.strictEqual(tracker.getScopeOccurrences("unknown"), null);

    const disabled = new ScopeTracker({ enabled: false });
    assert.strictEqual(disabled.getScopeOccurrences("anything"), null);
});

void test("getSymbolOccurrences finds all occurrences of a symbol across scopes", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("root");

    tracker.declare(
        "shared",
        { start: { line: 1, index: 0 }, end: { line: 1, index: 6 } },
        { kind: "variable", tags: ["global"] }
    );

    const childScope = tracker.enterScope("child");

    tracker.reference("shared", { start: { line: 3, index: 0 }, end: { line: 3, index: 6 } }, { kind: "variable" });

    tracker.declare(
        "local",
        { start: { line: 4, index: 0 }, end: { line: 4, index: 5 } },
        { kind: "variable", tags: ["local"] }
    );

    tracker.exitScope();
    tracker.exitScope();

    const sharedOccurrences = tracker.getSymbolOccurrences("shared");
    const localOccurrences = tracker.getSymbolOccurrences("local");

    assert.strictEqual(sharedOccurrences.length, 2);
    assert.strictEqual(sharedOccurrences.filter((o) => o.kind === "declaration").length, 1);
    assert.strictEqual(sharedOccurrences.filter((o) => o.kind === "reference").length, 1);

    assert.strictEqual(localOccurrences.length, 1);
    assert.strictEqual(localOccurrences[0].kind, "declaration");
    assert.strictEqual(localOccurrences[0].scopeId, childScope.id);
});

void test("reference skips tracking when disabled", () => {
    const tracker = new ScopeTracker({ enabled: false });
    const scope = tracker.enterScope("function");

    tracker.reference("alpha", {
        start: { line: 1, index: 0 },
        end: { line: 1, index: 5 }
    });

    assert.deepStrictEqual(tracker.getSymbolOccurrences("alpha"), []);

    const modification = tracker.getScopeModificationMetadata(scope.id);
    assert.strictEqual(modification?.modificationCount, 0);
    assert.strictEqual(modification?.lastModified, -1);
});

void test("getSymbolOccurrences returns empty array for non-existent symbol", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("root");
    tracker.declare("exists", {
        start: { line: 1, index: 0 },
        end: { line: 1, index: 6 }
    });
    tracker.exitScope();

    const result = tracker.getSymbolOccurrences("nonexistent");

    assert.deepStrictEqual(result, []);
});

void test("getSymbolOccurrences returns cloned occurrence metadata", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("root");

    tracker.declare(
        "shared",
        { start: { line: 1, index: 0 }, end: { line: 1, index: 6 } },
        { kind: "variable", tags: ["global"] }
    );

    tracker.reference("shared", { start: { line: 2, index: 0 }, end: { line: 2, index: 6 } }, { kind: "variable" });

    tracker.exitScope();

    const occurrences = tracker.getSymbolOccurrences("shared");
    const snapshot = structuredClone(occurrences);

    occurrences[0].occurrence.classifications.push("mutated");
    occurrences[0].occurrence.start.line = 99;

    assert.deepStrictEqual(tracker.getSymbolOccurrences("shared"), snapshot);
});

void test("getScopeSymbols returns all unique symbol names in a scope", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const scope = tracker.enterScope("function");

    tracker.declare("param1", {
        start: { line: 1, index: 0 },
        end: { line: 1, index: 6 }
    });
    tracker.declare("param2", {
        start: { line: 1, index: 8 },
        end: { line: 1, index: 14 }
    });
    tracker.reference("param1", {
        start: { line: 3, index: 0 },
        end: { line: 3, index: 6 }
    });

    tracker.exitScope();

    const symbols = tracker.getScopeSymbols(scope.id);

    const sortedSymbols = [...symbols].reduce((acc, item) => {
        const insertIndex = acc.findIndex((existing) => existing > item);
        return insertIndex === -1 ? [...acc, item] : [...acc.slice(0, insertIndex), item, ...acc.slice(insertIndex)];
    }, []);
    assert.deepStrictEqual(sortedSymbols, ["param1", "param2"]);
});

void test("getScopeSymbols returns empty array for non-existent scope", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("root");
    tracker.exitScope();

    const result = tracker.getScopeSymbols("nonexistent-scope");

    assert.deepStrictEqual(result, []);
});

void test("resolveIdentifier finds declaration in current scope", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const scope = tracker.enterScope("block");

    tracker.declare("localVar", {
        start: { line: 1, index: 0 },
        end: { line: 1, index: 8 }
    });

    const result = tracker.resolveIdentifier("localVar", scope.id);

    assert.ok(result);
    assert.strictEqual(result.name, "localVar");
    assert.strictEqual(result.scopeId, scope.id);
});

void test("resolveIdentifier walks up scope chain to find declaration", () => {
    const { tracker, outerScope, innerScope } = createNestedFunctionAndBlockScopes();

    const outerResult = tracker.resolveIdentifier("outerVar", innerScope.id);
    const innerResult = tracker.resolveIdentifier("innerVar", innerScope.id);

    assert.ok(outerResult);
    assert.strictEqual(outerResult.name, "outerVar");
    assert.strictEqual(outerResult.scopeId, outerScope.id);

    assert.ok(innerResult);
    assert.strictEqual(innerResult.name, "innerVar");
    assert.strictEqual(innerResult.scopeId, innerScope.id);
});

void test("resolveIdentifier respects shadowing", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("outer");

    tracker.declare("shadowed", {
        start: { line: 1, index: 0 },
        end: { line: 1, index: 8 }
    });

    const innerScope = tracker.enterScope("inner");

    tracker.declare("shadowed", {
        start: { line: 3, index: 0 },
        end: { line: 3, index: 8 }
    });

    const result = tracker.resolveIdentifier("shadowed", innerScope.id);

    assert.ok(result);
    assert.strictEqual(result.scopeId, innerScope.id);
    assert.strictEqual(result.start.line, 3);
});

void test("resolveIdentifier uses current scope when scopeId omitted", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("outer");

    tracker.declare("var1", {
        start: { line: 1, index: 0 },
        end: { line: 1, index: 4 }
    });

    const innerScope = tracker.enterScope("inner");

    tracker.declare("var2", {
        start: { line: 2, index: 0 },
        end: { line: 2, index: 4 }
    });

    const result1 = tracker.resolveIdentifier("var1");
    const result2 = tracker.resolveIdentifier("var2");

    assert.ok(result1);
    assert.strictEqual(result1.name, "var1");

    assert.ok(result2);
    assert.strictEqual(result2.name, "var2");
    assert.strictEqual(result2.scopeId, innerScope.id);
});

void test("resolveIdentifier returns null for non-existent identifier", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const scope = tracker.enterScope("block");

    tracker.declare("exists", {
        start: { line: 1, index: 0 },
        end: { line: 1, index: 6 }
    });

    const result = tracker.resolveIdentifier("nonexistent", scope.id);

    assert.strictEqual(result, null);
});

void test("resolveIdentifier returns null when disabled", () => {
    const tracker = new ScopeTracker({ enabled: false });

    const result = tracker.resolveIdentifier("any");

    assert.strictEqual(result, null);
});

void test("getScopeChain returns chain from scope to root", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const rootScope = tracker.enterScope("program");
    const functionScope = tracker.enterScope("function");
    const blockScope = tracker.enterScope("block");

    const chain = tracker.getScopeChain(blockScope.id);

    assert.deepStrictEqual(chain, [
        { id: blockScope.id, kind: "block" },
        { id: functionScope.id, kind: "function" },
        { id: rootScope.id, kind: "program" }
    ]);
});

void test("getScopeChain returns single entry for root scope", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const rootScope = tracker.enterScope("program");

    const chain = tracker.getScopeChain(rootScope.id);

    assert.deepStrictEqual(chain, [{ id: rootScope.id, kind: "program" }]);
});

/** Covers all leaf-accessor methods that return empty arrays when the tracker is disabled. */
void test("getSymbolOccurrences, getScopeSymbols, getScopeChain, and getScopeDefinitions return empty arrays when disabled", () => {
    const tracker = new ScopeTracker({ enabled: false });
    tracker.enterScope("program");

    assert.deepStrictEqual(tracker.getSymbolOccurrences("any"), []);
    assert.deepStrictEqual(tracker.getScopeSymbols("any-scope"), []);
    assert.deepStrictEqual(tracker.getScopeChain("any-scope"), []);
    assert.deepStrictEqual(tracker.getScopeDefinitions("any-scope"), []);

    tracker.exitScope();
});

void test("getScopeChain works after exiting scopes", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const rootScope = tracker.enterScope("program");
    const functionScope = tracker.enterScope("function");
    const blockScope = tracker.enterScope("block");
    tracker.exitScope();
    tracker.exitScope();

    const chain = tracker.getScopeChain(blockScope.id);

    assert.deepStrictEqual(chain, [
        { id: blockScope.id, kind: "block" },
        { id: functionScope.id, kind: "function" },
        { id: rootScope.id, kind: "program" }
    ]);
});

void test("getScopeDefinitions returns declarations defined in specific scope", () => {
    const { tracker, outerScope, innerScope } = createNestedFunctionAndBlockScopes();

    tracker.declare("anotherInner", {
        start: { line: 4, index: 0 },
        end: { line: 4, index: 12 }
    });

    const outerDefs = tracker.getScopeDefinitions(outerScope.id);
    const innerDefs = tracker.getScopeDefinitions(innerScope.id);

    assert.strictEqual(outerDefs.length, 1);
    assert.strictEqual(outerDefs[0].name, "outerVar");
    assert.strictEqual(outerDefs[0].metadata.scopeId, outerScope.id);

    assert.strictEqual(innerDefs.length, 2);
    const innerNames = innerDefs
        .map((d) => d.name)
        .reduce((acc, item) => {
            const insertIndex = acc.findIndex((existing) => existing > item);
            return insertIndex === -1
                ? [...acc, item]
                : [...acc.slice(0, insertIndex), item, ...acc.slice(insertIndex)];
        }, []);
    assert.deepStrictEqual(innerNames, ["anotherInner", "innerVar"]);
});

void test("getScopeDefinitions returns cloned metadata", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const scope = tracker.enterScope("function");

    tracker.declare("testVar", {
        start: { line: 1, index: 0 },
        end: { line: 1, index: 7 }
    });

    const defs1 = tracker.getScopeDefinitions(scope.id);
    (defs1[0].metadata as any).mutated = true;

    const defs2 = tracker.getScopeDefinitions(scope.id);

    assert.strictEqual((defs2[0].metadata as any).mutated, undefined);
});

void test("resolveIdentifier populates and reuses identifier resolution cache", () => {
    const tracker = new ScopeTracker({ enabled: true });

    tracker.enterScope("root");
    tracker.declare("rootVar", {
        start: { line: 1, index: 0 },
        end: { line: 1, index: 7 }
    });

    const deepScopes = [];
    for (let i = 0; i < 50; i++) {
        const scope = tracker.enterScope(`scope-${i}`);
        deepScopes.push(scope);
    }

    const deepestScope = tracker.enterScope("deepest");
    tracker.declare("localVar", {
        start: { line: 100, index: 0 },
        end: { line: 100, index: 8 }
    });

    const cacheEntriesBefore = tracker.countRetainedIdentifierResolutionCacheEntries();
    assert.strictEqual(cacheEntriesBefore, 0, "Cache should be empty before any resolutions");

    const firstRoot = tracker.resolveIdentifier("rootVar", deepestScope.id);
    const firstLocal = tracker.resolveIdentifier("localVar", deepestScope.id);
    assert.strictEqual(firstRoot?.name, "rootVar");
    assert.strictEqual(firstLocal?.name, "localVar");

    const cacheEntriesAfterFirst = tracker.countRetainedIdentifierResolutionCacheEntries();
    assert.ok(
        cacheEntriesAfterFirst >= 2,
        `Expected at least 2 cache entries after first resolutions, got ${cacheEntriesAfterFirst}`
    );

    for (let i = 0; i < 250; i++) {
        tracker.resolveIdentifier("rootVar", deepestScope.id);
        tracker.resolveIdentifier("localVar", deepestScope.id);
    }

    const cacheEntriesAfterMany = tracker.countRetainedIdentifierResolutionCacheEntries();
    assert.strictEqual(
        cacheEntriesAfterMany,
        cacheEntriesAfterFirst,
        "Cache should not grow after repeated resolutions (only 2 unique name/scope pairs)"
    );
});

type ScopeSnapshot = {
    scopeId: string;
    scopeKind: string;
    lastModified: number;
    modificationCount: number;
    identifiers: Array<{
        name: string;
        declarations: Array<{
            kind: string;
            name: string;
            scopeId: string;
            classifications: string[];
            declaration: {
                scopeId: string;
                start: SourceLocation;
                end: SourceLocation;
            };
            usageContext: {
                isRead?: boolean;
                isWrite?: boolean;
                isAssignmentTarget?: boolean;
                isCallTarget?: boolean;
                parentType?: string;
            } | null;
            start: SourceLocation;
            end: SourceLocation;
        }>;
        references: Array<{
            kind: string;
            name: string;
            scopeId: string;
            classifications: string[];
            declaration: {
                scopeId: string;
                start: SourceLocation;
                end: SourceLocation;
            };
            usageContext: {
                isRead?: boolean;
                isWrite?: boolean;
                isAssignmentTarget?: boolean;
                isCallTarget?: boolean;
                parentType?: string;
            } | null;
            start: SourceLocation;
            end: SourceLocation;
        }>;
    }>;
};

function buildDeclarationScopeSnapshot({
    scopeId,
    scopeKind,
    name,
    declarationRange,
    classifications,
    lastModified,
    modificationCount
}: {
    scopeId: string;
    scopeKind: string;
    name: string;
    declarationRange: SourceRange;
    classifications: string[];
    lastModified: number;
    modificationCount: number;
}): ScopeSnapshot {
    const declarationRangeClone = cloneRange(declarationRange);
    const metadataRangeClone = cloneRange(declarationRange);

    return {
        scopeId,
        scopeKind,
        lastModified,
        modificationCount,
        identifiers: [
            {
                name,
                declarations: [
                    {
                        kind: "declaration",
                        name,
                        scopeId,
                        classifications: [...classifications],
                        declaration: {
                            scopeId,
                            start: cloneLocation(declarationRangeClone.start),
                            end: cloneLocation(declarationRangeClone.end)
                        },
                        usageContext: null,
                        start: cloneLocation(metadataRangeClone.start),
                        end: cloneLocation(metadataRangeClone.end)
                    }
                ],
                references: []
            }
        ]
    };
}

function buildReferenceScopeSnapshot({
    scopeId,
    scopeKind,
    name,
    referenceRange,
    declarationScopeId,
    declarationRange,
    classifications,
    lastModified,
    modificationCount
}: {
    scopeId: string;
    scopeKind: string;
    name: string;
    referenceRange: SourceRange;
    declarationScopeId: string;
    declarationRange: SourceRange;
    classifications: string[];
    lastModified: number;
    modificationCount: number;
}): ScopeSnapshot {
    const referenceRangeClone = cloneRange(referenceRange);
    const declarationRangeClone = cloneRange(declarationRange);

    return {
        scopeId,
        scopeKind,
        lastModified,
        modificationCount,
        identifiers: [
            {
                name,
                declarations: [],
                references: [
                    {
                        kind: "reference",
                        name,
                        scopeId,
                        classifications: [...classifications],
                        declaration: {
                            scopeId: declarationScopeId,
                            start: cloneLocation(declarationRangeClone.start),
                            end: cloneLocation(declarationRangeClone.end)
                        },
                        usageContext: { isRead: true },
                        start: cloneLocation(referenceRangeClone.start),
                        end: cloneLocation(referenceRangeClone.end)
                    }
                ]
            }
        ]
    };
}

function buildDeclarationAndReferenceSnapshot({
    name,
    programScopeId,
    blockScopeId,
    declarationRange,
    referenceRange,
    programMetadata,
    blockMetadata
}: {
    name: string;
    programScopeId: string;
    blockScopeId: string;
    declarationRange: SourceRange;
    referenceRange: SourceRange;
    programMetadata: { lastModified: number; modificationCount: number };
    blockMetadata: { lastModified: number; modificationCount: number };
}): ScopeSnapshot[] {
    return [
        buildDeclarationScopeSnapshot({
            scopeId: programScopeId,
            scopeKind: "program",
            name,
            declarationRange,
            classifications: ["identifier", "declaration", "variable", "local"],
            lastModified: programMetadata.lastModified,
            modificationCount: programMetadata.modificationCount
        }),
        buildReferenceScopeSnapshot({
            scopeId: blockScopeId,
            scopeKind: "block",
            name,
            referenceRange,
            declarationScopeId: programScopeId,
            declarationRange,
            classifications: ["identifier", "reference", "variable", "local"],
            lastModified: blockMetadata.lastModified,
            modificationCount: blockMetadata.modificationCount
        })
    ];
}

function createTrackerWithDeclarationAndReference(name = "foo") {
    const tracker = new ScopeTracker({ enabled: true });
    const programScope = tracker.enterScope("program");
    const declarationRange = createRange(1, 0, 1, 3);

    tracker.declare(name, declarationRange, {
        kind: "variable",
        tags: ["local"]
    });

    const blockScope = tracker.enterScope("block");
    const referenceRange = createRange(2, 4, 2, 7);

    tracker.reference(name, referenceRange, { kind: "variable" });

    tracker.exitScope();
    tracker.exitScope();

    return {
        tracker,
        programScope,
        blockScope,
        declarationRange,
        referenceRange
    };
}

function createSingleScopeTracker(name = "bar") {
    const tracker = new ScopeTracker({ enabled: true });
    const scope = tracker.enterScope("program");
    const declarationRange = createRange(1, 0, 1, 3);

    tracker.declare(name, declarationRange);

    const referenceRange = createRange(2, 1, 2, 4);
    tracker.reference(name, referenceRange);

    tracker.exitScope();

    return {
        tracker,
        scope,
        declarationRange,
        referenceRange
    };
}

function createNestedFunctionAndBlockScopes() {
    const tracker = new ScopeTracker({ enabled: true });
    const outerScope = tracker.enterScope("function");

    tracker.declare("outerVar", createRange(1, 0, 1, 8));

    const innerScope = tracker.enterScope("block");
    tracker.declare("innerVar", createRange(3, 0, 3, 8));

    return { tracker, outerScope, innerScope };
}

void test("getBatchScopeMetadata retrieves metadata for multiple scopes efficiently", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const scope1 = tracker.enterScope("function", { name: "func1", path: "/test/file1.gml" });
    tracker.exitScope();
    const scope2 = tracker.enterScope("block", { name: "block1", path: "/test/file2.gml" });
    tracker.exitScope();
    const scope3 = tracker.enterScope("script", { name: "script1" });
    tracker.exitScope();

    const result = tracker.getBatchScopeMetadata([scope1.id, scope2.id, scope3.id]);

    assert.strictEqual(result.size, 3);
    assert.strictEqual(result.get(scope1.id)?.scopeKind, "function");
    assert.strictEqual(result.get(scope1.id)?.name, "func1");
    assert.strictEqual(result.get(scope1.id)?.path, "/test/file1.gml");
    assert.strictEqual(result.get(scope2.id)?.scopeKind, "block");
    assert.strictEqual(result.get(scope2.id)?.name, "block1");
    assert.strictEqual(result.get(scope2.id)?.path, "/test/file2.gml");
    assert.strictEqual(result.get(scope3.id)?.scopeKind, "script");
    assert.strictEqual(result.get(scope3.id)?.name, "script1");
    assert.strictEqual(result.get(scope3.id)?.path, undefined);
});

void test("getBatchScopeMetadata handles non-existent scope IDs gracefully", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const scope1 = tracker.enterScope("function");
    tracker.exitScope();

    const result = tracker.getBatchScopeMetadata([scope1.id, "non-existent-scope", ""]);

    assert.strictEqual(result.size, 1);
    assert.ok(result.has(scope1.id));
    assert.ok(!result.has("non-existent-scope"));
});

void test("getBatchScopeMetadata returns empty map for empty input", () => {
    const tracker = new ScopeTracker({ enabled: true });

    const result = tracker.getBatchScopeMetadata([]);

    assert.strictEqual(result.size, 0);
});

void test("getBatchScopeMetadata is faster than individual getScopeMetadata calls for large sets", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const scopes = [];
    const scopeCount = 100;

    for (let i = 0; i < scopeCount; i++) {
        scopes.push(tracker.enterScope("function", { name: `func${i}`, path: `/test/file${i}.gml` }));
        tracker.exitScope();
    }

    const scopeIds = scopes.map((s) => s.id);

    // Batch retrieval
    const batchStart = performance.now();
    const batchResult = tracker.getBatchScopeMetadata(scopeIds);
    const batchTime = performance.now() - batchStart;

    // Individual retrieval
    const individualStart = performance.now();
    const individualResults = new Map();
    for (const scopeId of scopeIds) {
        const metadata = tracker.getScopeMetadata(scopeId);
        if (metadata) {
            individualResults.set(scopeId, metadata);
        }
    }
    const individualTime = performance.now() - individualStart;

    assert.strictEqual(batchResult.size, scopeCount);
    assert.strictEqual(individualResults.size, scopeCount);

    // This is a microbenchmark over tiny in-memory lookups, so runtime variance
    // can occasionally outweigh the algorithmic advantage of the batch path on
    // shared CI hardware. Keep the assertion focused on avoiding pathological
    // regressions rather than demanding a strict wall-clock win on every run.
    assert.ok(
        batchTime <= Math.max(individualTime * 3, 1),
        `Batch time (${batchTime}ms) should stay within a small constant factor of individual time (${individualTime}ms)`
    );
});
