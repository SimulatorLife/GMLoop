import assert from "node:assert/strict";
import test from "node:test";

import ScopeTracker from "../src/scopes/scope-tracker.js";
import { createRange, withDeterministicDateNow } from "./scope-tracker-helpers.js";

void test("getScopeModificationMetadata returns modification info for a scope", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const scope = tracker.enterScope("program");

    const beforeModification = Date.now();

    tracker.declare("foo", { start: { line: 1, index: 0 }, end: { line: 1, index: 3 } }, { kind: "variable" });

    const metadata = tracker.getScopeModificationMetadata(scope.id);

    assert.ok(metadata);
    assert.strictEqual(metadata.scopeId, scope.id);
    assert.strictEqual(metadata.scopeKind, "program");
    assert.ok(metadata.lastModified >= beforeModification);
    assert.strictEqual(metadata.modificationCount, 1);
});

void test("getScopeModificationMetadata tracks multiple modifications", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const scope = tracker.enterScope("program");

    tracker.declare("foo", createRange(1, 0, 3), { kind: "variable" });
    tracker.reference("foo", createRange(2, 0, 3), { kind: "variable" });
    tracker.declare("bar", createRange(3, 0, 3), { kind: "variable" });

    const metadata = tracker.getScopeModificationMetadata(scope.id);

    assert.ok(metadata);
    assert.strictEqual(metadata.modificationCount, 3);
});

void test("getScopeModificationMetadata returns null for non-existent scope", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("program");

    const metadata = tracker.getScopeModificationMetadata("non-existent");

    assert.strictEqual(metadata, null);
});

void test("getModifiedScopes returns all scopes modified after timestamp", () =>
    withDeterministicDateNow((advanceTimestamp) => {
        const tracker = new ScopeTracker({ enabled: true });

        const scope1 = tracker.enterScope("program");
        const scope2 = tracker.enterScope("function");

        const beforeModifications = Date.now();
        advanceTimestamp();

        tracker.declare("foo", { start: { line: 1, index: 0 }, end: { line: 1, index: 3 } }, { kind: "variable" });

        tracker.exitScope();
        advanceTimestamp();

        tracker.declare("bar", { start: { line: 2, index: 0 }, end: { line: 2, index: 3 } }, { kind: "variable" });

        tracker.exitScope();

        const modifiedScopes = tracker.getModifiedScopes(beforeModifications);

        assert.strictEqual(modifiedScopes.length, 2);

        const scope1Metadata = modifiedScopes.find((s) => s.scopeId === scope1.id);
        const scope2Metadata = modifiedScopes.find((s) => s.scopeId === scope2.id);

        assert.ok(scope1Metadata);
        assert.strictEqual(scope1Metadata.scopeKind, "program");
        assert.strictEqual(scope1Metadata.modificationCount, 1);

        assert.ok(scope2Metadata);
        assert.strictEqual(scope2Metadata.scopeKind, "function");
        assert.strictEqual(scope2Metadata.modificationCount, 1);
    }));

void test("getModifiedScopes filters scopes by timestamp", () =>
    withDeterministicDateNow((advanceTimestamp) => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program");
        const scope2 = tracker.enterScope("function");

        tracker.declare("foo", { start: { line: 1, index: 0 }, end: { line: 1, index: 3 } }, { kind: "variable" });

        advanceTimestamp();
        const cutoffTimestamp = Date.now();
        advanceTimestamp();

        tracker.declare("bar", { start: { line: 2, index: 0 }, end: { line: 2, index: 3 } }, { kind: "variable" });

        tracker.exitScope();
        tracker.exitScope();

        const modifiedScopes = tracker.getModifiedScopes(cutoffTimestamp);

        assert.strictEqual(modifiedScopes.length, 1);
        assert.strictEqual(modifiedScopes[0].scopeId, scope2.id);
    }));

void test("updateScopeMetadata marks scope as modified when metadata changes", () =>
    withDeterministicDateNow((advanceTimestamp) => {
        const tracker = new ScopeTracker({ enabled: true });
        const scope = tracker.enterScope("program", {
            name: "oldName",
            path: "scripts/old_path.gml",
            start: { line: 1, column: 0, index: 0 }
        });

        tracker.exitScope();

        const baseline = tracker.getScopeModificationMetadata(scope.id);
        assert.ok(baseline);
        const baselineCount = baseline.modificationCount;

        advanceTimestamp();
        const cutoffTimestamp = Date.now();
        advanceTimestamp();

        tracker.updateScopeMetadata(scope.id, {
            name: "newName",
            path: "scripts/new_path.gml",
            start: { line: 5, column: 2, index: 42 }
        });

        const afterUpdate = tracker.getScopeModificationMetadata(scope.id);
        assert.ok(afterUpdate);
        assert.strictEqual(afterUpdate.modificationCount, baselineCount + 1);
        assert.ok(afterUpdate.lastModified > cutoffTimestamp);

        const modifiedScopes = tracker.getModifiedScopes(cutoffTimestamp);
        assert.strictEqual(modifiedScopes.length, 1);
        assert.strictEqual(modifiedScopes[0].scopeId, scope.id);
    }));

void test("updateScopeMetadata does not mark scope as modified when metadata is unchanged", () =>
    withDeterministicDateNow((advanceTimestamp) => {
        const tracker = new ScopeTracker({ enabled: true });
        const scope = tracker.enterScope("program", {
            name: "stableName",
            path: "scripts/stable_path.gml",
            start: { line: 2, column: 0, index: 10 },
            end: { line: 3, column: 1, index: 25 }
        });

        tracker.exitScope();

        const baseline = tracker.getScopeModificationMetadata(scope.id);
        assert.ok(baseline);

        advanceTimestamp();
        const cutoffTimestamp = Date.now();
        advanceTimestamp();

        tracker.updateScopeMetadata(scope.id, {
            name: "stableName",
            path: "scripts/stable_path.gml",
            start: { line: 2, column: 0, index: 10 },
            end: { line: 3, column: 1, index: 25 }
        });

        const afterNoopUpdate = tracker.getScopeModificationMetadata(scope.id);
        assert.ok(afterNoopUpdate);
        assert.strictEqual(afterNoopUpdate.modificationCount, baseline.modificationCount);
        assert.strictEqual(afterNoopUpdate.lastModified, baseline.lastModified);

        const modifiedScopes = tracker.getModifiedScopes(cutoffTimestamp);
        assert.deepStrictEqual(modifiedScopes, []);
    }));

void test("getMostRecentlyModifiedScope returns the latest modified scope", () => {
    const tracker = new ScopeTracker({ enabled: true });

    const scope1 = tracker.enterScope("program");
    tracker.declare("foo", { start: { line: 1, index: 0 }, end: { line: 1, index: 3 } }, { kind: "variable" });

    tracker.enterScope("function");

    tracker.exitScope();
    tracker.exitScope();

    tracker.declare("bar", { start: { line: 2, index: 0 }, end: { line: 2, index: 3 } }, { kind: "variable" });

    const mostRecent = tracker.getMostRecentlyModifiedScope();

    assert.ok(mostRecent);
    assert.strictEqual(mostRecent.scopeId, scope1.id);
    assert.strictEqual(mostRecent.scopeKind, "program");
});

void test("getMostRecentlyModifiedScope returns null when no scopes exist", () => {
    const tracker = new ScopeTracker({ enabled: true });

    const mostRecent = tracker.getMostRecentlyModifiedScope();

    assert.strictEqual(mostRecent, null);
});

void test("getSymbolWrites returns only write operations", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const scope = tracker.enterScope("program");

    tracker.declare("counter", { start: { line: 1, index: 0 }, end: { line: 1, index: 7 } }, { kind: "variable" });

    tracker.reference(
        "counter",
        {
            start: { line: 2, index: 0 },
            end: { line: 2, index: 7 },
            isAssignmentTarget: true
        },
        { kind: "variable" }
    );

    tracker.reference("counter", { start: { line: 3, index: 0 }, end: { line: 3, index: 7 } }, { kind: "variable" });

    tracker.exitScope();

    const writes = tracker.getSymbolWrites("counter");

    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].scopeId, scope.id);
    assert.ok(writes[0].occurrence.usageContext?.isWrite);
    assert.strictEqual(writes[0].occurrence.start.line, 2, "Write occurrence should be from line 2");
});

void test("getSymbolReads returns only read operations", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("program");

    tracker.declare("value", { start: { line: 1, index: 0 }, end: { line: 1, index: 5 } }, { kind: "variable" });

    tracker.reference(
        "value",
        {
            start: { line: 2, index: 0 },
            end: { line: 2, index: 5 },
            isAssignmentTarget: true
        },
        { kind: "variable" }
    );

    tracker.reference("value", { start: { line: 3, index: 0 }, end: { line: 3, index: 5 } }, { kind: "variable" });

    tracker.reference("value", { start: { line: 4, index: 0 }, end: { line: 4, index: 5 } }, { kind: "variable" });

    tracker.exitScope();

    const reads = tracker.getSymbolReads("value");

    assert.strictEqual(reads.length, 2, "Should return only the two read operations");
    assert.ok(reads[0].occurrence.usageContext?.isRead);
    assert.ok(reads[1].occurrence.usageContext?.isRead);
});

void test("getSymbolWrites returns empty array for non-existent symbol", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("program");

    const writes = tracker.getSymbolWrites("nonexistent");

    assert.deepStrictEqual(writes, []);
});

void test("getSymbolReads returns empty array for non-existent symbol", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("program");

    const reads = tracker.getSymbolReads("nonexistent");

    assert.deepStrictEqual(reads, []);
});

void test("usageContext distinguishes call targets from regular reads", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("program");

    tracker.declare("myFunc", { start: { line: 1, index: 0 }, end: { line: 1, index: 6 } }, { kind: "function" });

    tracker.reference(
        "myFunc",
        {
            start: { line: 2, index: 0 },
            end: { line: 2, index: 6 },
            isCallTarget: true
        },
        { kind: "function" }
    );

    tracker.reference("myFunc", { start: { line: 3, index: 0 }, end: { line: 3, index: 6 } }, { kind: "function" });

    tracker.exitScope();

    const occurrences = tracker.exportOccurrences();
    const funcOccurrences = occurrences[0].identifiers.find((id) => id.name === "myFunc");

    assert.ok(funcOccurrences);
    assert.strictEqual(funcOccurrences.references.length, 2);

    const callTarget = funcOccurrences.references[0];
    const regularRead = funcOccurrences.references[1];

    assert.ok(callTarget.usageContext?.isCallTarget);
    assert.ok(callTarget.usageContext?.isRead);
    assert.strictEqual(callTarget.usageContext?.isWrite, undefined);

    assert.ok(regularRead.usageContext?.isRead);
    assert.strictEqual(regularRead.usageContext?.isCallTarget, undefined);
});

void test("modification tracking is scope-specific", () => {
    const tracker = new ScopeTracker({ enabled: true });

    const scope1 = tracker.enterScope("program");
    tracker.declare("global", { start: { line: 1, index: 0 }, end: { line: 1, index: 6 } }, { kind: "variable" });

    const scope2 = tracker.enterScope("function");
    tracker.declare("local", { start: { line: 2, index: 0 }, end: { line: 2, index: 5 } }, { kind: "variable" });

    const scope1Metadata = tracker.getScopeModificationMetadata(scope1.id);
    const scope2Metadata = tracker.getScopeModificationMetadata(scope2.id);

    assert.strictEqual(scope1Metadata?.modificationCount, 1);
    assert.strictEqual(scope2Metadata?.modificationCount, 1);

    tracker.reference("global", { start: { line: 3, index: 0 }, end: { line: 3, index: 6 } }, { kind: "variable" });

    const scope2MetadataAfter = tracker.getScopeModificationMetadata(scope2.id);
    assert.strictEqual(scope2MetadataAfter?.modificationCount, 2, "Reference in scope2 should increment its counter");

    const scope1MetadataAfter = tracker.getScopeModificationMetadata(scope1.id);
    assert.strictEqual(
        scope1MetadataAfter?.modificationCount,
        1,
        "Reference in scope2 should not affect scope1's counter"
    );
});

void test("getScopeModificationDetails returns detailed modification info", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const scope = tracker.enterScope("program");

    tracker.declare("foo", createRange(1, 0, 3), { kind: "variable" });
    tracker.reference("foo", createRange(2, 0, 3), { kind: "variable" });
    tracker.reference("foo", createRange(3, 0, 3), { kind: "variable" });
    tracker.declare("bar", createRange(4, 0, 3), { kind: "variable" });

    const details = tracker.getScopeModificationDetails(scope.id);

    assert.ok(details);
    assert.strictEqual(details.scopeId, scope.id);
    assert.strictEqual(details.scopeKind, "program");
    assert.strictEqual(details.modificationCount, 4);
    assert.strictEqual(details.declarationCount, 2);
    assert.strictEqual(details.referenceCount, 2);
    assert.strictEqual(details.symbolCount, 2);
    assert.strictEqual(details.symbols.length, 2);

    const barSymbol = details.symbols.find((s) => s.name === "bar");
    const fooSymbol = details.symbols.find((s) => s.name === "foo");

    assert.ok(barSymbol);
    assert.strictEqual(barSymbol.declarationCount, 1);
    assert.strictEqual(barSymbol.referenceCount, 0);

    assert.ok(fooSymbol);
    assert.strictEqual(fooSymbol.declarationCount, 1);
    assert.strictEqual(fooSymbol.referenceCount, 2);
});

void test("getScopeModificationDetails symbols are sorted alphabetically", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const scope = tracker.enterScope("program");

    tracker.declare("zulu", { start: { line: 1, index: 0 }, end: { line: 1, index: 4 } }, { kind: "variable" });

    tracker.declare("alpha", { start: { line: 2, index: 0 }, end: { line: 2, index: 5 } }, { kind: "variable" });

    tracker.declare("charlie", { start: { line: 3, index: 0 }, end: { line: 3, index: 7 } }, { kind: "variable" });

    const details = tracker.getScopeModificationDetails(scope.id);

    assert.ok(details);
    assert.strictEqual(details.symbols.length, 3);
    assert.strictEqual(details.symbols[0].name, "alpha");
    assert.strictEqual(details.symbols[1].name, "charlie");
    assert.strictEqual(details.symbols[2].name, "zulu");
});

void test("getScopeModificationDetails returns null for non-existent scope", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("program");

    const details = tracker.getScopeModificationDetails("non-existent");

    assert.strictEqual(details, null);
});

void test("getScopeModificationDetails returns null for null scope", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("program");

    const details = tracker.getScopeModificationDetails(null);

    assert.strictEqual(details, null);
});

void test("getScopeModificationDetails returns zero counts for empty scope", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const scope = tracker.enterScope("program");

    const details = tracker.getScopeModificationDetails(scope.id);

    assert.ok(details);
    assert.strictEqual(details.scopeId, scope.id);
    assert.strictEqual(details.scopeKind, "program");
    assert.strictEqual(details.modificationCount, 0);
    assert.strictEqual(details.declarationCount, 0);
    assert.strictEqual(details.referenceCount, 0);
    assert.strictEqual(details.symbolCount, 0);
    assert.deepStrictEqual(details.symbols, []);
});

void test("getScopeModificationDetails supports hot reload invalidation decisions", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const programScope = tracker.enterScope("program");

    tracker.declare("gameState", { start: { line: 1, index: 0 }, end: { line: 1, index: 9 } }, { kind: "variable" });

    const functionScope = tracker.enterScope("function");

    tracker.reference("gameState", { start: { line: 3, index: 0 }, end: { line: 3, index: 9 } }, { kind: "variable" });

    tracker.declare("localVar", { start: { line: 4, index: 0 }, end: { line: 4, index: 8 } }, { kind: "variable" });

    tracker.exitScope();
    tracker.exitScope();

    const programDetails = tracker.getScopeModificationDetails(programScope.id);
    const functionDetails = tracker.getScopeModificationDetails(functionScope.id);

    assert.ok(programDetails);
    assert.strictEqual(programDetails.declarationCount, 1, "Program scope declares gameState");
    assert.strictEqual(programDetails.referenceCount, 0, "Program scope has no references");

    assert.ok(functionDetails);
    assert.strictEqual(functionDetails.declarationCount, 1, "Function scope declares localVar");
    assert.strictEqual(functionDetails.referenceCount, 1, "Function scope references gameState");

    const gameStateInFunction = functionDetails.symbols.find((s) => s.name === "gameState");
    assert.ok(gameStateInFunction);
    assert.strictEqual(gameStateInFunction.declarationCount, 0, "gameState not declared in function scope");
    assert.strictEqual(gameStateInFunction.referenceCount, 1, "gameState referenced once in function scope");
});
