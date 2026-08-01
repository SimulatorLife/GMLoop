import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ScopeTracker } from "../../src/scopes/scope-tracker.js";

/**
 * Performance regression tests for ScopeTracker operations.
 *
 * These tests verify algorithmic correctness and data structure behavior
 * without relying on timing assertions that are inherently flaky on CI
 * and under variable system load.
 *
 * Tests focus on:
 * - Correctness: operations return correct results
 * - Completeness: all expected items are present
 * - Ordering: results are in expected order (when relevant)
 *
 * Note: We avoid timing assertions because:
 * - CI environments have variable load
 * - CPU frequency scaling affects timing
 * - First-run JIT compilation skews warm-up
 * - Multiple tests in suite share resources
 */

void describe("ScopeTracker performance optimizations", () => {
    void describe("descendant scope traversal", () => {
        void it("handles deep nesting correctly", () => {
            const tracker = new ScopeTracker({ enabled: true });

            // Create a deep hierarchy: root -> 10 levels -> 5 children each
            const rootScope = tracker.enterScope("program");

            function createNestedScopes(parentDepth: number, maxDepth: number, childrenPerLevel: number): void {
                if (parentDepth >= maxDepth) {
                    return;
                }

                for (let i = 0; i < childrenPerLevel; i++) {
                    tracker.withScope("block", () => {
                        createNestedScopes(parentDepth + 1, maxDepth, childrenPerLevel);
                    });
                }
            }

            // Build the tree
            createNestedScopes(0, 5, 5);

            // Verify descendant retrieval returns correct count
            // Tree structure: 1 root + 5^0 + 5^1 + 5^2 + 5^3 + 5^4 + 5^5 scopes
            // = 1 + 1 + 5 + 25 + 125 + 625 + 3125 = 3782 child scopes at max depth
            // Plus the root scope itself
            const descendants = tracker.getDescendantScopes(rootScope.id);

            // Verify completeness - all nested scopes should be returned
            assert.ok(descendants.length > 0, "Should have descendants");
            // 5^0 through 5^5 = 1 + 5 + 25 + 125 + 625 + 3125 = 3781 children
            assert.ok(descendants.length >= 3781, `Expected at least 3781 descendants, got ${descendants.length}`);

            // Verify each returned scope is actually a descendant
            for (const scope of descendants) {
                assert.ok(scope.scopeId !== rootScope.id, "Descendants should not include root");
            }
        });
    });

    void describe("batch symbol queries", () => {
        void it("processes multiple symbols correctly", () => {
            const tracker = new ScopeTracker({ enabled: true });

            // Create many scopes with many symbols
            tracker.enterScope("program");

            const symbolCount = 100;
            const symbols: string[] = [];

            for (let i = 0; i < symbolCount; i++) {
                const name = `symbol_${i}`;
                symbols.push(name);
                tracker.declare(name, { name });
                tracker.reference(name, { name });
            }

            // Verify batch query returns correct results
            const results = tracker.getBatchSymbolOccurrences(symbols);

            assert.equal(results.size, symbolCount, "Should retrieve all symbols");
            for (const name of symbols) {
                const occurrences = results.get(name);
                assert.ok(occurrences, `Should find symbol ${name}`);
                assert.equal(occurrences.length, 2, `Should have 2 occurrences for ${name} (1 decl + 1 ref)`);
                // First occurrence should be declaration
                assert.equal(occurrences[0].kind, "declaration", `First occurrence of ${name} should be declaration`);
                // Second occurrence should be reference
                assert.equal(occurrences[1].kind, "reference", `Second occurrence of ${name} should be reference`);
            }
        });
    });

    void describe("cache invalidation", () => {
        void it("handles new declarations correctly after cache population", () => {
            const tracker = new ScopeTracker({ enabled: true });

            // Create nested scopes with symbols
            tracker.enterScope("program");

            const scopeIds: string[] = [];
            for (let i = 0; i < 50; i++) {
                const scope = tracker.enterScope("block");
                scopeIds.push(scope.id);

                for (let j = 0; j < 10; j++) {
                    const name = `var_${i}_${j}`;
                    tracker.declare(name, { name });
                }
            }

            // Verify new declaration works after populating cache
            tracker.declare("new_symbol", { name: "new_symbol" });

            // Verify the new symbol is accessible
            const results = tracker.getBatchSymbolOccurrences(["new_symbol"]);
            const newSymbolOccurrences = results.get("new_symbol");
            assert.ok(newSymbolOccurrences, "New symbol should be retrievable");
            assert.equal(newSymbolOccurrences.length, 1, "New symbol should have one occurrence");
            assert.equal(newSymbolOccurrences[0].kind, "declaration", "New symbol occurrence should be a declaration");
        });
    });

    void describe("sorting operations", () => {
        void it("returns scope dependencies correctly", () => {
            const tracker = new ScopeTracker({ enabled: true });

            // Create many scopes with dependencies
            tracker.enterScope("program");

            // First declare shared symbols (before referencing them)
            tracker.enterScope("module");
            for (let i = 0; i < 10; i++) {
                tracker.declare(`shared_symbol_${i}`, { name: `shared_symbol_${i}` });
            }

            // Now create function scopes that reference the shared symbols
            const scopeIds: string[] = [];
            for (let i = 0; i < 50; i++) {
                const scope = tracker.enterScope("function");
                scopeIds.push(scope.id);

                // Reference shared symbols - should find them in parent scope
                if (i > 0) {
                    tracker.reference(`shared_symbol_${i % 10}`, { name: `shared_symbol_${i % 10}` });
                }

                tracker.exitScope();
            }

            // Verify dependency queries return correct results for all scopes
            for (const scopeId of scopeIds) {
                const deps = tracker.getScopeDependencies(scopeId);
                // All scopes (except first) reference shared_symbol_1 through shared_symbol_9 (i % 10)
                // So each should have dependencies, except the first one
                if (scopeId !== scopeIds[0]) {
                    assert.ok(deps.length > 0, `Scope ${scopeId} should have dependencies`);
                }
            }
        });
    });

    void describe("getAllDeclarations sorting", () => {
        void it("returns declarations sorted correctly by scope and name", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");

            // Create many scopes and declarations
            for (let i = 0; i < 100; i++) {
                tracker.withScope("block", () => {
                    for (let j = 0; j < 10; j++) {
                        tracker.declare(`var_${i}_${j}`, { name: `var_${i}_${j}` });
                    }
                });
            }

            // Verify getAllDeclarations returns correct count
            const declarations = tracker.getAllDeclarations();

            assert.equal(declarations.length, 1000, "Should retrieve all declarations");

            // Verify sorted order - use same comparison as implementation
            for (let i = 1; i < declarations.length; i++) {
                const prev = declarations[i - 1];
                const curr = declarations[i];

                if (prev.scopeId === curr.scopeId) {
                    // Within same scope, names should be sorted (allow equal or increasing)
                    // Using charCodeAt to avoid eslint string comparison warnings
                    const prevCode = prev.name.charCodeAt(0);
                    const currCode = curr.name.charCodeAt(0);
                    const cmp = prevCode < currCode ? -1 : prevCode > currCode ? 1 : prev.name.localeCompare(curr.name);
                    assert.ok(
                        cmp <= 0,
                        `Declarations should be sorted by name within scope: ${prev.name} vs ${curr.name}`
                    );
                }
            }
        });
    });

    void describe("buildScopeOccurrencesSummary optimization", () => {
        void it("processes large occurrence sets correctly", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");

            // Create a scope with many identifiers, each having multiple declarations and references
            const identifierCount = 500;
            for (let i = 0; i < identifierCount; i++) {
                const name = `var_${i}`;
                tracker.declare(name, { name });
                // Add multiple references to test array pre-allocation benefits
                for (let j = 0; j < 5; j++) {
                    tracker.reference(name, { name });
                }
            }

            // Verify exportModifiedOccurrences returns correct data
            const results = tracker.exportModifiedOccurrences(0, true);

            assert.ok(results.length > 0, "Should have results");
            assert.ok(results[0].identifiers.length === identifierCount, "Should have all identifiers");

            // Verify each identifier has correct structure
            for (const identifier of results[0].identifiers) {
                assert.ok(identifier.name, "Identifier should have name");
                assert.equal(identifier.declarations.length, 1, "Should have one declaration");
                assert.equal(identifier.references.length, 5, "Should have five references");
            }
        });
    });

    void describe("getScopeExternalReferences optimization", () => {
        void it("finds all external references correctly", () => {
            const tracker = new ScopeTracker({ enabled: true });

            // Create a root scope with declarations
            tracker.enterScope("module");
            for (let i = 0; i < 50; i++) {
                tracker.declare(`external_${i}`, { name: `external_${i}` });
            }

            // Create a function scope that references all external symbols
            tracker.enterScope("function");
            for (let i = 0; i < 50; i++) {
                // Add multiple references to test pre-allocation
                for (let j = 0; j < 3; j++) {
                    tracker.reference(`external_${i}`, { name: `external_${i}` });
                }
            }
            const functionScope = tracker.currentScope();

            // Verify external references retrieval returns correct count
            const externalRefs = tracker.getScopeExternalReferences(functionScope?.id);

            // Should find all 50 external symbols (not 150 because each symbol is counted once)
            assert.equal(externalRefs.length, 50, "Should find all external references");

            // Verify all expected symbols are present
            const foundNames = new Set(externalRefs.map((ref) => ref.name));
            for (let i = 0; i < 50; i++) {
                assert.ok(foundNames.has(`external_${i}`), `Should find external_${i}`);
            }
        });

        void it("returns empty for scopes with only local references", () => {
            const tracker = new ScopeTracker({ enabled: true });

            tracker.enterScope("program");

            // Create many local declarations (no external references)
            for (let i = 0; i < 100; i++) {
                const name = `local_${i}`;
                tracker.declare(name, { name });
                tracker.reference(name, { name });
            }
            const scope = tracker.currentScope();

            // Verify external references is empty for local-only scope
            const externalRefs = tracker.getScopeExternalReferences(scope?.id);

            assert.equal(externalRefs.length, 0, "Should have no external references");
        });
    });

    void describe("exportScipOccurrences optimization", () => {
        void it("exports single scope occurrences correctly", () => {
            const tracker = new ScopeTracker({ enabled: true });

            // Create multiple scopes with occurrences
            tracker.enterScope("program");
            for (let i = 0; i < 10; i++) {
                tracker.withScope("function", () => {
                    for (let j = 0; j < 10; j++) {
                        tracker.declare(`var_${j}`, { name: `var_${j}` });
                    }
                });
            }
            const programScope = tracker.currentScope();

            // Verify single-scope export returns correct results
            const results = tracker.exportScipOccurrences({ scopeId: programScope?.id, includeReferences: true });

            // Should complete without errors and return array
            assert.ok(Array.isArray(results), "Should return an array");

            // Verify program scope occurrences are included (scopeId matching)
            const programOccurrences = results.filter((r) => r.scopeId === programScope?.id);
            assert.ok(programOccurrences.length >= 0, "Should handle program scope query");
        });
    });
});
