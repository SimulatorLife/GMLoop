import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ScopeTracker } from "../src/scopes/scope-tracker.js";

void describe("ScopeTracker batch query operations", () => {
    void describe("getBatchSymbolOccurrences", () => {
        void it("returns empty map for empty input", () => {
            const tracker = new ScopeTracker({ enabled: true });
            const results = tracker.getBatchSymbolOccurrences([]);
            assert.equal(results.size, 0);
        });

        void it("returns empty map when no symbols are found", () => {
            const tracker = new ScopeTracker({ enabled: true });
            tracker.enterScope("program");
            tracker.declare("knownSymbol", { name: "knownSymbol" });

            const results = tracker.getBatchSymbolOccurrences(["unknownA", "unknownB"]);
            assert.equal(results.size, 0);
        });

        void it("returns occurrences for a single symbol", () => {
            const tracker = new ScopeTracker({ enabled: true });
            const programScope = tracker.enterScope("program");
            tracker.declare("myVar", {
                name: "myVar",
                start: { line: 1, column: 0, index: 0 },
                end: { line: 1, column: 5, index: 5 }
            });
            tracker.reference("myVar", {
                name: "myVar",
                start: { line: 2, column: 0, index: 10 },
                end: { line: 2, column: 5, index: 15 }
            });

            const results = tracker.getBatchSymbolOccurrences(["myVar"]);

            assert.equal(results.size, 1);
            assert.ok(results.has("myVar"));

            const occurrences = results.get("myVar");
            assert.ok(occurrences);
            assert.equal(occurrences.length, 2);

            const declaration = occurrences.find((occ) => occ.kind === "declaration");
            assert.ok(declaration);
            assert.equal(declaration.scopeId, programScope.id);
            assert.equal(declaration.scopeKind, "program");
            assert.equal(declaration.occurrence.name, "myVar");

            const reference = occurrences.find((occ) => occ.kind === "reference");
            assert.ok(reference);
            assert.equal(reference.scopeId, programScope.id);
            assert.equal(reference.scopeKind, "program");
            assert.equal(reference.occurrence.name, "myVar");
        });

        void it("returns occurrences for multiple symbols efficiently", () => {
            const tracker = new ScopeTracker({ enabled: true });
            tracker.enterScope("program");

            // Declare and reference multiple symbols
            tracker.declare("alpha", { name: "alpha" });
            tracker.reference("alpha", { name: "alpha" });

            tracker.declare("beta", { name: "beta" });
            tracker.reference("beta", { name: "beta" });

            tracker.declare("gamma", { name: "gamma" });
            tracker.reference("gamma", { name: "gamma" });

            const results = tracker.getBatchSymbolOccurrences(["alpha", "beta", "gamma"]);

            assert.equal(results.size, 3);
            assert.ok(results.has("alpha"));
            assert.ok(results.has("beta"));
            assert.ok(results.has("gamma"));

            for (const [name, occurrences] of results) {
                assert.equal(occurrences.length, 2);
                const declaration = occurrences.find((occ) => occ.kind === "declaration");
                const reference = occurrences.find((occ) => occ.kind === "reference");

                assert.ok(declaration, `Expected declaration for ${name}`);
                assert.ok(reference, `Expected reference for ${name}`);
                assert.equal(declaration.occurrence.name, name);
                assert.equal(reference.occurrence.name, name);
            }
        });

        void it("handles mixed found and not-found symbols", () => {
            const tracker = new ScopeTracker({ enabled: true });
            tracker.enterScope("program");

            tracker.declare("exists", { name: "exists" });
            tracker.reference("exists", { name: "exists" });

            const results = tracker.getBatchSymbolOccurrences(["exists", "doesNotExist", "alsoMissing"]);

            assert.equal(results.size, 1);
            assert.ok(results.has("exists"));
            assert.ok(!results.has("doesNotExist"));
            assert.ok(!results.has("alsoMissing"));
        });

        void it("deduplicates duplicate symbol names from iterable input", () => {
            const tracker = new ScopeTracker({ enabled: true });
            tracker.enterScope("program");

            tracker.declare("dup", { name: "dup" });
            tracker.reference("dup", { name: "dup" });

            const duplicateIterable = ["dup", "dup", "dup"];
            const results = tracker.getBatchSymbolOccurrences(duplicateIterable);

            assert.equal(results.size, 1);
            assert.ok(results.has("dup"));
            assert.equal(results.get("dup")?.length, 2);
        });

        void it("collects occurrences from multiple scopes", () => {
            const tracker = new ScopeTracker({ enabled: true });

            // Program scope
            const programScope = tracker.enterScope("program");
            tracker.declare("globalVar", { name: "globalVar" });

            // Function scope
            const fnScope = tracker.enterScope("function");
            tracker.reference("globalVar", { name: "globalVar" });
            tracker.declare("localVar", { name: "localVar" });

            // Block scope
            const blockScope = tracker.enterScope("block");
            tracker.reference("globalVar", { name: "globalVar" });
            tracker.reference("localVar", { name: "localVar" });

            tracker.exitScope(); // block
            tracker.exitScope(); // function
            tracker.exitScope(); // program

            const results = tracker.getBatchSymbolOccurrences(["globalVar", "localVar"]);

            assert.equal(results.size, 2);

            // globalVar appears in 3 scopes (1 declaration + 2 references)
            const globalOccurrences = results.get("globalVar");
            assert.ok(globalOccurrences);
            assert.equal(globalOccurrences.length, 3);

            const globalDecls = globalOccurrences.filter((occ) => occ.kind === "declaration");
            assert.equal(globalDecls.length, 1);
            assert.equal(globalDecls[0].scopeId, programScope.id);

            const globalRefs = globalOccurrences.filter((occ) => occ.kind === "reference");
            assert.equal(globalRefs.length, 2);

            // localVar appears in 2 scopes (1 declaration + 1 reference)
            const localOccurrences = results.get("localVar");
            assert.ok(localOccurrences);
            assert.equal(localOccurrences.length, 2);

            const localDecls = localOccurrences.filter((occ) => occ.kind === "declaration");
            assert.equal(localDecls.length, 1);
            assert.equal(localDecls[0].scopeId, fnScope.id);

            const localRefs = localOccurrences.filter((occ) => occ.kind === "reference");
            assert.equal(localRefs.length, 1);
            assert.equal(localRefs[0].scopeId, blockScope.id);
        });

        void it("accepts Set as input", () => {
            const tracker = new ScopeTracker({ enabled: true });
            tracker.enterScope("program");

            tracker.declare("x", { name: "x" });
            tracker.declare("y", { name: "y" });
            tracker.declare("z", { name: "z" });

            const symbolSet = new Set(["x", "y", "z"]);
            const results = tracker.getBatchSymbolOccurrences(symbolSet);

            assert.equal(results.size, 3);
            assert.ok(results.has("x"));
            assert.ok(results.has("y"));
            assert.ok(results.has("z"));
        });

        void it("skips null and empty string symbols", () => {
            const tracker = new ScopeTracker({ enabled: true });
            tracker.enterScope("program");

            tracker.declare("valid", { name: "valid" });

            // Testing runtime behavior with potentially invalid input
            const results = tracker.getBatchSymbolOccurrences(["valid", null, "", undefined]);

            assert.equal(results.size, 1);
            assert.ok(results.has("valid"));
        });

        void it("returns cloned occurrence data to prevent mutation", () => {
            const tracker = new ScopeTracker({ enabled: true });
            tracker.enterScope("program");

            tracker.declare("test", {
                name: "test",
                start: { line: 1, column: 0, index: 0 },
                end: { line: 1, column: 4, index: 4 }
            });

            const results1 = tracker.getBatchSymbolOccurrences(["test"]);
            const results2 = tracker.getBatchSymbolOccurrences(["test"]);

            const occ1 = results1.get("test")?.[0].occurrence;
            const occ2 = results2.get("test")?.[0].occurrence;

            assert.ok(occ1);
            assert.ok(occ2);
            assert.notEqual(occ1, occ2, "Should return different object instances");
            assert.deepEqual(occ1, occ2, "But with equivalent data");
        });

        void it("supports hot reload use case: analyzing multiple changed symbols at once", () => {
            // Simulates a file change where multiple symbols are modified
            const tracker = new ScopeTracker({ enabled: true });

            // Scope 1: File A
            const fileAScope = tracker.enterScope("program", { path: "file-a.gml" });
            tracker.declare("CONFIG_MAX_HP", { name: "CONFIG_MAX_HP" });
            tracker.declare("CONFIG_MAX_MP", { name: "CONFIG_MAX_MP" });
            tracker.declare("initPlayer", { name: "initPlayer" });
            tracker.exitScope();

            // Scope 2: File B
            const fileBScope = tracker.enterScope("program", { path: "file-b.gml" });
            tracker.reference("CONFIG_MAX_HP", { name: "CONFIG_MAX_HP" });
            tracker.reference("CONFIG_MAX_MP", { name: "CONFIG_MAX_MP" });
            tracker.reference("initPlayer", { name: "initPlayer" });
            tracker.exitScope();

            // Scope 3: File C
            const fileCScope = tracker.enterScope("program", { path: "file-c.gml" });
            tracker.reference("CONFIG_MAX_HP", { name: "CONFIG_MAX_HP" });
            tracker.exitScope();

            // When file A changes, query all its symbols in one batch
            const changedSymbols = ["CONFIG_MAX_HP", "CONFIG_MAX_MP", "initPlayer"];
            const results = tracker.getBatchSymbolOccurrences(changedSymbols);

            assert.equal(results.size, 3);

            // Verify we can determine which files need invalidation
            const affectedScopes = new Set<string>();
            for (const occurrences of results.values()) {
                for (const occ of occurrences) {
                    affectedScopes.add(occ.scopeId);
                }
            }

            assert.ok(affectedScopes.has(fileAScope.id));
            assert.ok(affectedScopes.has(fileBScope.id));
            assert.ok(affectedScopes.has(fileCScope.id));
        });

        void it("handles large batch efficiently", () => {
            const tracker = new ScopeTracker({ enabled: true });
            tracker.enterScope("program");

            // Create 100 symbols
            const symbolNames: string[] = [];
            for (let i = 0; i < 100; i++) {
                const name = `symbol_${i}`;
                symbolNames.push(name);
                tracker.declare(name, { name });
                tracker.reference(name, { name });
            }

            const startTime = Date.now();
            const results = tracker.getBatchSymbolOccurrences(symbolNames);
            const elapsedMs = Date.now() - startTime;

            assert.equal(results.size, 100);

            // Batch query should complete quickly even with many symbols
            assert.ok(elapsedMs < 100, `Batch query took ${elapsedMs}ms, expected < 100ms`);
        });

        void it("returns correct scope metadata for each occurrence", () => {
            const tracker = new ScopeTracker({ enabled: true });

            const programScope = tracker.enterScope("program");
            tracker.declare("x", { name: "x" });

            const fnScope = tracker.enterScope("function");
            tracker.reference("x", { name: "x" });
            tracker.exitScope();

            tracker.exitScope();

            const results = tracker.getBatchSymbolOccurrences(["x"]);
            const occurrences = results.get("x");

            assert.ok(occurrences);
            assert.equal(occurrences.length, 2);

            const declaration = occurrences.find((occ) => occ.kind === "declaration");
            assert.ok(declaration);
            assert.equal(declaration.scopeId, programScope.id);
            assert.equal(declaration.scopeKind, "program");

            const reference = occurrences.find((occ) => occ.kind === "reference");
            assert.ok(reference);
            assert.equal(reference.scopeId, fnScope.id);
            assert.equal(reference.scopeKind, "function");
        });
    });
});
