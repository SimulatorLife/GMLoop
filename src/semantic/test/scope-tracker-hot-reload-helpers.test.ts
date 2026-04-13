import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ScopeTracker } from "../src/scopes/scope-tracker.js";

// Helper function for tests that need timestamp separation
const delay = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

void describe("ScopeTracker hot-reload helper methods", () => {
    void describe("getModifiedSymbolScopes", () => {
        void it("returns empty map when no symbols are modified", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("foo", { name: "foo" });
            tracker.declare("bar", { name: "bar" });

            const timestamp = Date.now() + 1000;

            const results = tracker.getModifiedSymbolScopes(new Set(["foo", "bar"]), timestamp);

            assert.equal(results.size, 0, "Should return empty map when timestamp is in the future");
        });

        void it("detects modified symbols in scopes changed after timestamp", async () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            tracker.declare("foo", { name: "foo" });

            const timestamp = Date.now();

            // Wait a bit to ensure timestamp difference
            await delay();

            tracker.declare("bar", { name: "bar" });
            tracker.reference("foo", { name: "foo" });

            const results = tracker.getModifiedSymbolScopes(new Set(["foo", "bar", "baz"]), timestamp);

            assert.ok(results.has("foo"), "Should detect modified 'foo'");
            assert.ok(results.has("bar"), "Should detect modified 'bar'");
            assert.ok(!results.has("baz"), "Should not include non-existent 'baz'");

            const fooScopes = results.get("foo");
            assert.ok(fooScopes && fooScopes.length > 0, "Should have scope IDs for 'foo'");
        });

        void it("works with array input in addition to Set", async () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");
            const timestamp = Date.now();

            await delay();

            tracker.declare("alpha", { name: "alpha" });
            tracker.declare("beta", { name: "beta" });

            const results = tracker.getModifiedSymbolScopes(["alpha", "beta"], timestamp);

            assert.equal(results.size, 2, "Should work with array input");
            assert.ok(results.has("alpha"));
            assert.ok(results.has("beta"));
        });

        void it("accepts Set-like substitutes without instanceof dependency", async () => {
            const tracker = new ScopeTracker({ enabled: true });
            const timestamp = Date.now();

            await delay();

            tracker.enterScope("program");
            tracker.declare("gamma", { name: "gamma" });
            tracker.exitScope();

            // Construct a plain Set-like object that is NOT an `instanceof Set`
            // but satisfies the duck-typed ReadonlySet<string> contract.
            // This validates that getModifiedSymbolScopes uses a capability probe
            // (Core.isSetLike) rather than `instanceof Set` for type dispatch.
            const backingSet = new Set(["gamma", "delta"]);
            const setLikeProxy: ReadonlySet<string> = {
                has: (v) => backingSet.has(v),
                get size() {
                    return backingSet.size;
                },
                forEach: (...args) => backingSet.forEach(...args),
                values: () => backingSet.values(),
                keys: () => backingSet.keys(),
                entries: () => backingSet.entries(),
                [Symbol.iterator]: () => backingSet[Symbol.iterator]()
            };

            assert.equal(setLikeProxy instanceof Set, false, "Proxy must NOT be instanceof Set");

            const results = tracker.getModifiedSymbolScopes(setLikeProxy, timestamp);

            assert.ok(results.has("gamma"), "Should detect modification for 'gamma'");
            assert.equal(results.has("delta"), false, "Should not have 'delta' (not declared)");
        });

        void it("returns empty map when tracker is disabled", () => {
            const tracker = new ScopeTracker({ enabled: false });

            const results = tracker.getModifiedSymbolScopes(new Set(["foo"]), 0);

            assert.equal(results.size, 0, "Should return empty map when disabled");
        });

        void it("sorts scope IDs for deterministic output", async () => {
            const tracker = new ScopeTracker({ enabled: true });

            const timestamp = Date.now();

            tracker.enterScope("program");
            tracker.exitScope();

            await delay();

            tracker.enterScope("function-a");
            tracker.declare("shared", { name: "shared" });
            tracker.exitScope();

            tracker.enterScope("function-b");
            tracker.declare("shared", { name: "shared" });
            tracker.exitScope();

            tracker.enterScope("function-c");
            tracker.declare("shared", { name: "shared" });
            tracker.exitScope();

            const results = tracker.getModifiedSymbolScopes(new Set(["shared"]), timestamp);
            const sharedScopes = results.get("shared");

            assert.ok(sharedScopes, "Should find 'shared' symbol");
            assert.ok(sharedScopes && sharedScopes.length >= 3, "Should have multiple scopes");

            // Verify sorted order
            for (let i = 1; i < sharedScopes.length; i++) {
                const prev = sharedScopes[i - 1];
                const curr = sharedScopes[i];
                // Compare using localeCompare to avoid sonarjs string comparison warning
                assert.ok(prev.localeCompare(curr) < 0, `Scope IDs should be sorted: ${prev} < ${curr}`);
            }
        });

        void it("handles multiple scopes efficiently", async () => {
            const tracker = new ScopeTracker({ enabled: true });

            const timestamp = Date.now();

            await delay();

            // Create many scopes with shared symbols
            for (let i = 0; i < 20; i++) {
                tracker.enterScope(`function-${i}`);
                tracker.declare(`symbol-${i % 5}`, { name: `symbol-${i % 5}` });
                tracker.exitScope();
            }

            const symbols = new Set(["symbol-0", "symbol-1", "symbol-2", "symbol-3", "symbol-4"]);
            const start = performance.now();
            const results = tracker.getModifiedSymbolScopes(symbols, timestamp);
            const elapsed = performance.now() - start;

            assert.ok(elapsed < 50, `Should complete quickly: ${elapsed}ms < 50ms`);
            assert.equal(results.size, 5, "Should find all symbols");

            for (const symbol of symbols) {
                const scopes = results.get(symbol);
                assert.ok(scopes && scopes.length >= 4, `Each symbol should appear in at least 4 scopes`);
            }
        });

        void it("skips scopes without occurrences of the symbol", async () => {
            const tracker = new ScopeTracker({ enabled: true });

            const timestamp = Date.now();

            await delay();

            tracker.enterScope("function-a");
            tracker.declare("foo", { name: "foo" });
            tracker.exitScope();

            tracker.enterScope("function-b");
            // This scope has no occurrences of 'foo'
            tracker.declare("bar", { name: "bar" });
            tracker.exitScope();

            const results = tracker.getModifiedSymbolScopes(new Set(["foo"]), timestamp);
            const fooScopes = results.get("foo");

            assert.ok(fooScopes, "Should find 'foo'");
            assert.equal(fooScopes.length, 1, "Should only include scope with actual occurrences");
        });
    });

    void describe("scopeHasSymbol", () => {
        void it("returns true when scope contains symbol declaration", () => {
            const tracker = new ScopeTracker({ enabled: true });

            const scope = tracker.enterScope("function");
            tracker.declare("myVar", { name: "myVar" });

            const result = tracker.scopeHasSymbol(scope.id, "myVar");

            assert.equal(result, true, "Should return true for declared symbol");
        });

        void it("returns true when scope contains symbol reference", () => {
            const tracker = new ScopeTracker({ enabled: true });

            const scope = tracker.enterScope("function");
            tracker.reference("external", { name: "external" });

            const result = tracker.scopeHasSymbol(scope.id, "external");

            assert.equal(result, true, "Should return true for referenced symbol");
        });

        void it("returns false when scope does not contain symbol", () => {
            const tracker = new ScopeTracker({ enabled: true });

            const scope = tracker.enterScope("function");
            tracker.declare("other", { name: "other" });

            const result = tracker.scopeHasSymbol(scope.id, "missing");

            assert.equal(result, false, "Should return false for non-existent symbol");
        });

        void it("returns false for null or undefined scope ID", () => {
            const tracker = new ScopeTracker({ enabled: true });

            assert.equal(tracker.scopeHasSymbol(null, "foo"), false);
            assert.equal(tracker.scopeHasSymbol(undefined, "foo"), false);
        });

        void it("returns false for null or undefined symbol", () => {
            const tracker = new ScopeTracker({ enabled: true });

            const scope = tracker.enterScope("function");

            assert.equal(tracker.scopeHasSymbol(scope.id, null), false);
            assert.equal(tracker.scopeHasSymbol(scope.id, undefined), false);
        });

        void it("returns false when tracker is disabled", () => {
            const tracker = new ScopeTracker({ enabled: false });

            const result = tracker.scopeHasSymbol("any-scope", "any-symbol");

            assert.equal(result, false, "Should return false when disabled");
        });

        void it("returns false for non-existent scope ID", () => {
            const tracker = new ScopeTracker({ enabled: true });

            const result = tracker.scopeHasSymbol("non-existent-scope", "foo");

            assert.equal(result, false, "Should return false for invalid scope ID");
        });

        void it("completes quickly for large scopes", () => {
            const tracker = new ScopeTracker({ enabled: true });

            const scope = tracker.enterScope("large-function");

            // Add many symbols
            for (let i = 0; i < 1000; i++) {
                tracker.declare(`var-${i}`, { name: `var-${i}` });
            }

            const start = performance.now();
            const result = tracker.scopeHasSymbol(scope.id, "var-500");
            const elapsed = performance.now() - start;

            assert.equal(result, true, "Should find symbol in large scope");
            assert.ok(elapsed < 5, `Should complete quickly: ${elapsed}ms < 5ms`);
        });

        void it("distinguishes between empty occurrence entry and no entry", () => {
            const tracker = new ScopeTracker({ enabled: true });

            const scope = tracker.enterScope("function");

            // Manually create an occurrence entry with no declarations or references
            // This simulates a rare edge case
            scope.occurrences.set("empty", { declarations: [], references: [] });

            const result = tracker.scopeHasSymbol(scope.id, "empty");

            assert.equal(result, false, "Should return false for empty occurrence entry");
        });
    });

    void describe("integration: hot-reload invalidation workflow", () => {
        void it("enables efficient symbol change detection for hot reload", async () => {
            const tracker = new ScopeTracker({ enabled: true });

            // Initial state: create some functions with shared dependencies
            tracker.enterScope("module");
            tracker.declare("sharedUtil", { name: "sharedUtil" });
            tracker.exitScope();

            tracker.enterScope("function-a");
            tracker.reference("sharedUtil", { name: "sharedUtil" });
            const funcAScope = tracker.currentScope();
            tracker.exitScope();

            tracker.enterScope("function-b");
            tracker.reference("sharedUtil", { name: "sharedUtil" });
            const funcBScope = tracker.currentScope();
            tracker.exitScope();

            // Record timestamp before modification
            const timestamp = Date.now();

            await delay();

            // Simulate editing by creating a new scope with a new symbol
            tracker.enterScope("function-c");
            tracker.declare("newHelper", { name: "newHelper" });
            const funcCScope = tracker.currentScope();
            tracker.exitScope();

            // Check which symbols changed
            const modifiedSymbols = tracker.getModifiedSymbolScopes(
                new Set(["sharedUtil", "newHelper", "otherSymbol"]),
                timestamp
            );

            assert.ok(modifiedSymbols.has("newHelper"), "Should detect newHelper was added");
            assert.ok(!modifiedSymbols.has("otherSymbol"), "Should not include unchanged symbols");

            // Verify we can quickly check if specific scopes need invalidation
            if (funcAScope && funcBScope && funcCScope) {
                assert.equal(tracker.scopeHasSymbol(funcAScope.id, "sharedUtil"), true, "function-a uses sharedUtil");
                assert.equal(tracker.scopeHasSymbol(funcBScope.id, "sharedUtil"), true, "function-b uses sharedUtil");
                assert.equal(
                    tracker.scopeHasSymbol(funcAScope.id, "unrelated"),
                    false,
                    "function-a does not use unrelated"
                );
                assert.equal(tracker.scopeHasSymbol(funcCScope.id, "newHelper"), true, "function-c has newHelper");
            }
        });
    });
});
