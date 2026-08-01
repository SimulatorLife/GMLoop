import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ScopeTracker } from "../src/scopes/scope-tracker.js";

function toOccurrenceQueryShape({
    scopeId,
    scopeKind,
    kind,
    occurrence
}: {
    scopeId: string;
    scopeKind: string;
    kind: string;
    occurrence: {
        kind: string;
        name: string;
        scopeId: string | null | undefined;
        usageContext?: object;
    };
}) {
    return {
        scopeId,
        scopeKind,
        kind,
        occurrence: {
            kind: occurrence.kind,
            name: occurrence.name,
            scopeId: occurrence.scopeId,
            usageContext: occurrence.usageContext
        }
    };
}

void describe("ScopeTracker unsafe accessors", () => {
    void describe("getSymbolOccurrencesUnsafe", () => {
        void it("returns occurrences without cloning", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("myVar", { name: "myVar" });
            tracker.reference("myVar", { name: "myVar" });

            const unsafeOccurrences = tracker.getSymbolOccurrencesUnsafe("myVar");

            assert.equal(unsafeOccurrences.length, 2, "Should have 2 occurrences");
            assert.equal(unsafeOccurrences[0].kind, "declaration");
            assert.equal(unsafeOccurrences[1].kind, "reference");
        });

        void it("returns same data as safe variant", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("foo", { name: "foo" });
            tracker.declare("bar", { name: "bar" });
            tracker.reference("foo", { name: "foo" });
            tracker.reference("bar", { name: "bar" });

            const safeOccurrences = tracker.getSymbolOccurrences("foo");
            const unsafeOccurrences = tracker.getSymbolOccurrencesUnsafe("foo");

            assert.equal(unsafeOccurrences.length, safeOccurrences.length);
            assert.equal(unsafeOccurrences[0].scopeId, safeOccurrences[0].scopeId);
            assert.equal(unsafeOccurrences[0].scopeKind, safeOccurrences[0].scopeKind);
            assert.equal(unsafeOccurrences[0].kind, safeOccurrences[0].kind);
            assert.equal(unsafeOccurrences[0].occurrence.name, safeOccurrences[0].occurrence.name);
        });

        void it("returns internal references not clones", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("myVar", { name: "myVar" });

            // Unsafe should return reference to same object
            const unsafe1 = tracker.getSymbolOccurrencesUnsafe("myVar");
            const unsafe2 = tracker.getSymbolOccurrencesUnsafe("myVar");

            // The occurrence objects should be the same reference
            assert.strictEqual(
                unsafe1[0].occurrence,
                unsafe2[0].occurrence,
                "Unsafe variant should return same object reference"
            );

            // Safe variant should return different objects
            const safe1 = tracker.getSymbolOccurrences("myVar");
            const safe2 = tracker.getSymbolOccurrences("myVar");

            assert.notStrictEqual(
                safe1[0].occurrence,
                safe2[0].occurrence,
                "Safe variant should return different object references"
            );
        });

        void it("returns empty array for unknown symbol", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("known", { name: "known" });

            const occurrences = tracker.getSymbolOccurrencesUnsafe("unknown");

            assert.deepStrictEqual(occurrences, []);
        });

        void it("returns empty array for null or undefined", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");

            assert.deepStrictEqual(tracker.getSymbolOccurrencesUnsafe(null), []);
            assert.deepStrictEqual(tracker.getSymbolOccurrencesUnsafe(undefined), []);
        });

        void it("handles symbols across multiple scopes", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("shared", { name: "shared" });

            tracker.enterScope("function");
            tracker.declare("shared", { name: "shared" });
            tracker.exitScope();

            tracker.enterScope("function");
            tracker.reference("shared", { name: "shared" });
            tracker.exitScope();

            const occurrences = tracker.getSymbolOccurrencesUnsafe("shared");

            assert.equal(occurrences.length, 3, "Should have occurrences from all scopes");
        });
    });

    void describe("getBatchSymbolOccurrencesUnsafe", () => {
        void it("returns occurrences for multiple symbols without cloning", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("foo", { name: "foo" });
            tracker.declare("bar", { name: "bar" });
            tracker.reference("foo", { name: "foo" });

            const unsafeResults = tracker.getBatchSymbolOccurrencesUnsafe(["foo", "bar"]);

            assert.equal(unsafeResults.size, 2);
            assert.equal(unsafeResults.get("foo")?.length, 2); // 1 declaration + 1 reference
            assert.equal(unsafeResults.get("bar")?.length, 1); // 1 declaration
        });

        void it("returns same data as safe batch variant", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("a", { name: "a" });
            tracker.declare("b", { name: "b" });
            tracker.declare("c", { name: "c" });
            tracker.reference("a", { name: "a" });
            tracker.reference("b", { name: "b" });

            const safeResults = tracker.getBatchSymbolOccurrences(["a", "b", "c"]);
            const unsafeResults = tracker.getBatchSymbolOccurrencesUnsafe(["a", "b", "c"]);

            assert.equal(unsafeResults.size, safeResults.size);

            for (const [name, unsafeOccurrences] of unsafeResults) {
                const safeOccurrences = safeResults.get(name);
                assert.ok(safeOccurrences, `Safe results should contain ${name}`);
                assert.equal(unsafeOccurrences.length, safeOccurrences.length);

                for (const [i, unsafeOccurrence] of unsafeOccurrences.entries()) {
                    assert.equal(unsafeOccurrence.scopeId, safeOccurrences[i].scopeId);
                    assert.equal(unsafeOccurrence.scopeKind, safeOccurrences[i].scopeKind);
                    assert.equal(unsafeOccurrence.kind, safeOccurrences[i].kind);
                    assert.equal(unsafeOccurrence.occurrence.name, safeOccurrences[i].occurrence.name);
                }
            }
        });

        void it("returns internal references not clones for batch queries", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("myVar", { name: "myVar" });
            tracker.declare("otherVar", { name: "otherVar" });

            const unsafe1 = tracker.getBatchSymbolOccurrencesUnsafe(["myVar", "otherVar"]);
            const unsafe2 = tracker.getBatchSymbolOccurrencesUnsafe(["myVar", "otherVar"]);

            // The occurrence objects should be the same reference
            const myVar1 = unsafe1.get("myVar")?.[0]?.occurrence;
            const myVar2 = unsafe2.get("myVar")?.[0]?.occurrence;

            assert.strictEqual(myVar1, myVar2, "Unsafe batch variant should return same object reference");

            // Safe variant should return different objects
            const safe1 = tracker.getBatchSymbolOccurrences(["myVar", "otherVar"]);
            const safe2 = tracker.getBatchSymbolOccurrences(["myVar", "otherVar"]);

            const myVarSafe1 = safe1.get("myVar")?.[0]?.occurrence;
            const myVarSafe2 = safe2.get("myVar")?.[0]?.occurrence;

            assert.notStrictEqual(
                myVarSafe1,
                myVarSafe2,
                "Safe batch variant should return different object references"
            );
        });

        void it("handles empty input", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("foo", { name: "foo" });

            const results = tracker.getBatchSymbolOccurrencesUnsafe([]);

            assert.equal(results.size, 0);
        });

        void it("skips null and undefined names", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("valid", { name: "valid" });

            const results = tracker.getBatchSymbolOccurrencesUnsafe([null, undefined, "valid"]);

            assert.equal(results.size, 1);
            assert.ok(results.has("valid"));
        });

        void it("excludes symbols with no occurrences from results", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("exists", { name: "exists" });

            const results = tracker.getBatchSymbolOccurrencesUnsafe(["exists", "missing", "alsoMissing"]);

            assert.equal(results.size, 1);
            assert.ok(results.has("exists"));
            assert.ok(!results.has("missing"));
            assert.ok(!results.has("alsoMissing"));
        });

        void it("deduplicates duplicate symbol names from iterable input", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("dup", { name: "dup" });
            tracker.reference("dup", { name: "dup" });

            const duplicateIterable = ["dup", "dup", "dup"];
            const results = tracker.getBatchSymbolOccurrencesUnsafe(duplicateIterable);

            assert.equal(results.size, 1);
            assert.ok(results.has("dup"));
            assert.equal(results.get("dup")?.length, 2);
        });

        void it("processes large batches efficiently", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");

            const symbolCount = 500;
            const symbols: string[] = [];

            for (let i = 0; i < symbolCount; i++) {
                const name = `symbol_${i}`;
                symbols.push(name);
                tracker.declare(name, { name });
                tracker.reference(name, { name });
            }

            const start = performance.now();
            const results = tracker.getBatchSymbolOccurrencesUnsafe(symbols);
            const elapsed = performance.now() - start;

            assert.equal(results.size, symbolCount);
            assert.ok(elapsed < 200, `Batch unsafe query took ${elapsed}ms, expected < 200ms`);
        });
    });

    void describe("performance comparison: safe vs unsafe", () => {
        void it("unsafe variant is faster than safe variant for single queries", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");

            const symbolCount = 1000;
            const testSymbol = "testSymbol";

            tracker.declare(testSymbol, { name: testSymbol });
            for (let i = 0; i < symbolCount; i++) {
                tracker.reference(testSymbol, { name: testSymbol });
            }

            // Warm up
            tracker.getSymbolOccurrences(testSymbol);
            tracker.getSymbolOccurrencesUnsafe(testSymbol);

            const safeStart = performance.now();
            for (let i = 0; i < 100; i++) {
                tracker.getSymbolOccurrences(testSymbol);
            }
            const safeElapsed = performance.now() - safeStart;

            const unsafeStart = performance.now();
            for (let i = 0; i < 100; i++) {
                tracker.getSymbolOccurrencesUnsafe(testSymbol);
            }
            const unsafeElapsed = performance.now() - unsafeStart;

            // Unsafe should be faster (at least 20% improvement)
            const improvement = ((safeElapsed - unsafeElapsed) / safeElapsed) * 100;

            assert.ok(
                unsafeElapsed < safeElapsed,
                `Unsafe (${unsafeElapsed}ms) should be faster than safe (${safeElapsed}ms), improvement: ${improvement.toFixed(1)}%`
            );
        });

        void it("unsafe batch variant is faster than safe batch variant", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");

            const symbolCount = 200;
            const symbols: string[] = [];

            for (let i = 0; i < symbolCount; i++) {
                const name = `symbol_${i}`;
                symbols.push(name);
                tracker.declare(name, { name });
                tracker.reference(name, { name });
                tracker.reference(name, { name });
            }

            // Warm up
            tracker.getBatchSymbolOccurrences(symbols);
            tracker.getBatchSymbolOccurrencesUnsafe(symbols);

            const safeStart = performance.now();
            for (let i = 0; i < 50; i++) {
                tracker.getBatchSymbolOccurrences(symbols);
            }
            const safeElapsed = performance.now() - safeStart;

            const unsafeStart = performance.now();
            for (let i = 0; i < 50; i++) {
                tracker.getBatchSymbolOccurrencesUnsafe(symbols);
            }
            const unsafeElapsed = performance.now() - unsafeStart;

            const improvement = ((safeElapsed - unsafeElapsed) / safeElapsed) * 100;

            assert.ok(
                unsafeElapsed < safeElapsed,
                `Unsafe batch (${unsafeElapsed}ms) should be faster than safe batch (${safeElapsed}ms), improvement: ${improvement.toFixed(1)}%`
            );
        });
    });

    void describe("correctness guarantees", () => {
        void it("unsafe variant returns correct occurrence data", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("myVar", {
                name: "myVar",
                start: { line: 1, column: 0, index: 0 },
                end: { line: 1, column: 5, index: 5 }
            });

            const occurrences = tracker.getSymbolOccurrencesUnsafe("myVar");

            assert.equal(occurrences.length, 1);
            assert.equal(occurrences[0].occurrence.name, "myVar");
            assert.equal(occurrences[0].occurrence.start?.line, 1);
            assert.equal(occurrences[0].occurrence.start?.column, 0);
            assert.equal(occurrences[0].occurrence.end?.line, 1);
            assert.equal(occurrences[0].occurrence.end?.column, 5);
        });

        void it("unsafe batch variant returns correct data for all symbols", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("a", { name: "a" });
            tracker.declare("b", { name: "b" });
            tracker.reference("a", { name: "a" });

            const results = tracker.getBatchSymbolOccurrencesUnsafe(["a", "b"]);

            assert.ok(results.has("a"));
            assert.ok(results.has("b"));

            const aOccurrences = results.get("a");
            const bOccurrences = results.get("b");

            assert.ok(aOccurrences, "aOccurrences should be defined");
            assert.ok(bOccurrences, "bOccurrences should be defined");

            assert.equal(aOccurrences.length, 2);
            assert.equal(bOccurrences.length, 1);

            assert.equal(aOccurrences[0].kind, "declaration");
            assert.equal(aOccurrences[1].kind, "reference");
            assert.equal(bOccurrences[0].kind, "declaration");
        });
    });

    void describe("getSymbolWritesUnsafe", () => {
        void it("returns only write occurrences without cloning", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("myVar", { name: "myVar" });
            tracker.reference("myVar", { name: "myVar", isAssignmentTarget: true });
            tracker.reference("myVar", { name: "myVar" }); // read

            const writes = tracker.getSymbolWritesUnsafe("myVar");

            assert.equal(writes.length, 1);
            assert.equal(writes[0].kind, "reference");
            assert.ok(writes[0].occurrence.usageContext?.isWrite);
        });

        void it("returns internal references not clones", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("myVar", { name: "myVar" });
            tracker.reference("myVar", { name: "myVar", isAssignmentTarget: true });

            const unsafe1 = tracker.getSymbolWritesUnsafe("myVar");
            const unsafe2 = tracker.getSymbolWritesUnsafe("myVar");

            assert.strictEqual(
                unsafe1[0].occurrence,
                unsafe2[0].occurrence,
                "Unsafe variant should return same object reference"
            );
        });

        void it("returns empty array for symbols with no writes", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("myVar", { name: "myVar" });
            tracker.reference("myVar", { name: "myVar" }); // read only

            const writes = tracker.getSymbolWritesUnsafe("myVar");

            assert.deepStrictEqual(writes, []);
        });

        void it("matches the safe write query results while preserving internal references", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("myVar", { name: "myVar" });
            tracker.reference("myVar", { name: "myVar", isAssignmentTarget: true });
            tracker.reference("myVar", { name: "myVar" });

            const safeWrites = tracker.getSymbolWrites("myVar");
            const unsafeWrites = tracker.getSymbolWritesUnsafe("myVar");

            assert.deepStrictEqual(
                safeWrites.map((write) => toOccurrenceQueryShape(write)),
                unsafeWrites.map((write) => toOccurrenceQueryShape(write))
            );
            assert.notStrictEqual(safeWrites[0].occurrence, unsafeWrites[0].occurrence);
        });
    });

    void describe("getSymbolReadsUnsafe", () => {
        void it("returns only read occurrences without cloning", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("myVar", { name: "myVar" });
            tracker.reference("myVar", { name: "myVar" }); // read
            tracker.reference("myVar", { name: "myVar", isAssignmentTarget: true }); // write

            const reads = tracker.getSymbolReadsUnsafe("myVar");

            assert.equal(reads.length, 1);
            assert.equal(reads[0].kind, "reference");
            assert.ok(reads[0].occurrence.usageContext?.isRead);
        });

        void it("returns internal references not clones", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("myVar", { name: "myVar" });
            tracker.reference("myVar", { name: "myVar" });

            const unsafe1 = tracker.getSymbolReadsUnsafe("myVar");
            const unsafe2 = tracker.getSymbolReadsUnsafe("myVar");

            assert.strictEqual(
                unsafe1[0].occurrence,
                unsafe2[0].occurrence,
                "Unsafe variant should return same object reference"
            );
        });

        void it("returns empty array for symbols with no reads", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("myVar", { name: "myVar" });

            const reads = tracker.getSymbolReadsUnsafe("myVar");

            assert.deepStrictEqual(reads, []);
        });

        void it("handles symbols across multiple scopes", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("shared", { name: "shared" });
            tracker.reference("shared", { name: "shared" });

            tracker.enterScope("function");
            tracker.reference("shared", { name: "shared" });
            tracker.exitScope();

            const reads = tracker.getSymbolReadsUnsafe("shared");

            assert.equal(reads.length, 2);
            assert.ok(reads.every((r) => r.occurrence.usageContext?.isRead));
        });

        void it("matches the safe read query results while preserving internal references", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("shared", { name: "shared" });
            tracker.reference("shared", { name: "shared" });
            tracker.reference("shared", { name: "shared", isAssignmentTarget: true });

            const safeReads = tracker.getSymbolReads("shared");
            const unsafeReads = tracker.getSymbolReadsUnsafe("shared");

            assert.deepStrictEqual(
                safeReads.map((read) => toOccurrenceQueryShape(read)),
                unsafeReads.map((read) => toOccurrenceQueryShape(read))
            );
            assert.notStrictEqual(safeReads[0].occurrence, unsafeReads[0].occurrence);
        });
    });
});
