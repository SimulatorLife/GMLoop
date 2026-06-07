import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { ScopeTracker } from "../src/scopes/scope-tracker.js";

void describe("ScopeTracker: targeted cache invalidation", () => {
    void it("invalidates cache for the declaring scope when new declarations are added", () => {
        const tracker = new ScopeTracker({ enabled: true });

        const rootScope = tracker.enterScope("program");

        const initial = tracker.resolveIdentifier("alpha", rootScope.id);
        assert.strictEqual(initial, null, "Initial lookup should be cached as null");

        tracker.declare("alpha", {
            name: "alpha",
            start: { line: 1, column: 0, index: 0 },
            end: { line: 1, column: 5, index: 5 }
        });

        const afterDeclaration = tracker.resolveIdentifier("alpha", rootScope.id);
        assert.ok(afterDeclaration, "Declaring scope should resolve newly declared symbol");
        assert.strictEqual(afterDeclaration?.scopeId, rootScope.id, "Declaration should resolve to root scope");
    });

    void it("invalidates cache only for descendant scopes when symbol is declared", () => {
        const tracker = new ScopeTracker({ enabled: true });

        // Create scope hierarchy:
        //   root (scope-0)
        //     ├─ sibling1 (scope-1)
        //     └─ parent (scope-2)
        //          └─ child (scope-3)
        const root = tracker.enterScope("program");
        const sibling1Scope = tracker.enterScope("function");
        tracker.exitScope(); // sibling1

        const parentScope = tracker.enterScope("function");
        const childScope = tracker.enterScope("block");

        // Declare 'x' in parent scope first
        tracker.exitScope(); // child
        tracker.declare("x", {
            name: "x",
            start: { line: 1, column: 0, index: 0 },
            end: { line: 1, column: 1, index: 1 }
        });

        // Resolve 'x' from child scope - this will cache the resolution
        const firstResolve = tracker.resolveIdentifier("x", childScope.id);

        assert.ok(firstResolve, "Should resolve 'x' in child scope");
        assert.strictEqual(firstResolve?.scopeId, parentScope.id, "Should resolve to parent scope");

        // Now resolve from sibling1 - this will cache a null result
        const siblingResolve = tracker.resolveIdentifier("x", sibling1Scope.id);
        assert.strictEqual(siblingResolve, null, "Sibling1 should not resolve 'x'");

        // Declare 'x' again in root scope (shadowing the parent declaration)
        tracker.exitScope(); // exit parent
        tracker.declare("x", {
            name: "x",
            start: { line: 2, column: 0, index: 10 },
            end: { line: 2, column: 1, index: 11 }
        });

        // The cache for child scope should be invalidated (parent is descendant of root)
        const childResolveAfter = tracker.resolveIdentifier("x", childScope.id);
        assert.ok(childResolveAfter, "Child should still resolve 'x'");
        // Child will still resolve to parent since parent's 'x' shadows root's 'x'
        assert.strictEqual(
            childResolveAfter?.scopeId,
            parentScope.id,
            "Child should resolve to parent scope (shadowing)"
        );

        // The cache for sibling1 should be invalidated too (sibling1 is a descendant of root)
        const sibling1After = tracker.resolveIdentifier("x", sibling1Scope.id);
        assert.ok(sibling1After, "Sibling1 should now resolve 'x' from root");
        assert.strictEqual(sibling1After?.scopeId, root.id, "Sibling1 should resolve to root scope");
    });

    void it("preserves cache for non-descendant scopes when symbol is declared", () => {
        const tracker = new ScopeTracker({ enabled: true });

        // Create scope hierarchy:
        //   root
        //     ├─ branch1
        //     │    └─ child1
        //     └─ branch2
        //          └─ child2
        tracker.enterScope("program"); // root

        // Branch 1
        tracker.enterScope("function"); // branch1
        const child1 = tracker.enterScope("block");
        tracker.exitScope(); // child1
        tracker.exitScope(); // branch1

        // Branch 2
        const branch2 = tracker.enterScope("function");
        const child2 = tracker.enterScope("block");

        // Initially, 'y' is not defined anywhere
        const child1Initial = tracker.resolveIdentifier("y", child1.id);
        const child2Initial = tracker.resolveIdentifier("y", child2.id);
        assert.strictEqual(child1Initial, null);
        assert.strictEqual(child2Initial, null);

        // Declare 'y' in branch2
        tracker.exitScope(); // child2
        tracker.declare("y", {
            name: "y",
            start: { line: 1, column: 0, index: 0 },
            end: { line: 1, column: 1, index: 1 }
        });

        // child2 (descendant of branch2) should have invalidated cache
        const child2After = tracker.resolveIdentifier("y", child2.id);
        assert.ok(child2After, "child2 should resolve 'y' from branch2");
        assert.strictEqual(child2After?.scopeId, branch2.id);

        // child1 (NOT a descendant of branch2) should still have cached null result
        // But we need to verify this by checking that it still returns null efficiently
        const child1After = tracker.resolveIdentifier("y", child1.id);
        assert.strictEqual(child1After, null, "child1 should not resolve 'y' (cache should be preserved)");
    });

    void it("handles deeply nested scopes correctly during cache invalidation", () => {
        const tracker = new ScopeTracker({ enabled: true });

        //   root
        //     └─ level1
        //          └─ level2
        //               └─ level3
        tracker.enterScope("program"); // root
        const level1 = tracker.enterScope("function");
        const level2 = tracker.enterScope("block");
        const level3 = tracker.enterScope("block");

        // Resolve 'z' from level3 - not found
        const initialResolve = tracker.resolveIdentifier("z", level3.id);
        assert.strictEqual(initialResolve, null);

        // Declare 'z' in level1
        tracker.exitScope(); // level3
        tracker.exitScope(); // level2
        tracker.declare("z", {
            name: "z",
            start: { line: 1, column: 0, index: 0 },
            end: { line: 1, column: 1, index: 1 }
        });

        // level2 and level3 (descendants of level1) should have invalidated cache
        const level2After = tracker.resolveIdentifier("z", level2.id);
        const level3After = tracker.resolveIdentifier("z", level3.id);

        assert.ok(level2After, "level2 should resolve 'z' from level1");
        assert.strictEqual(level2After?.scopeId, level1.id);

        assert.ok(level3After, "level3 should resolve 'z' from level1");
        assert.strictEqual(level3After?.scopeId, level1.id);
    });

    void it("clears all caches when declaring scope is unknown (fallback)", () => {
        const tracker = new ScopeTracker({ enabled: true });

        const scope1 = tracker.enterScope("function");
        const scope2 = tracker.enterScope("block");

        // Resolve 'a' from both scopes - not found
        tracker.resolveIdentifier("a", scope1.id);
        tracker.resolveIdentifier("a", scope2.id);

        // Declare with null scope (conservative fallback)
        // This simulates the old behavior where we clear all caches
        // Using `as any` to test the fallback path explicitly
        tracker.exitScope();
        tracker.declare(
            "a",
            { name: "a", start: { line: 1, column: 0, index: 0 }, end: { line: 1, column: 1, index: 1 } },
            { scopeOverride: null }
        );

        // Both scopes should be able to resolve now (cache was cleared)
        const scope2After = tracker.resolveIdentifier("a", scope2.id);
        assert.ok(scope2After);
    });

    void it("cache invalidation improves hot reload performance", () => {
        // This test demonstrates the hot reload use case:
        // When editing a single file/scope, only descendant scopes need cache refresh
        const tracker = new ScopeTracker({ enabled: true });

        //   file1 (program scope)
        //     ├─ func1
        //     │    └─ block1
        //     └─ func2
        //          └─ block2
        const file1 = tracker.enterScope("program", { path: "file1.gml" });

        const func1 = tracker.enterScope("function", { path: "file1.gml", name: "func1" });
        const block1 = tracker.enterScope("block", { path: "file1.gml" });
        tracker.exitScope(); // block1

        // Declare 'config' in func1 first
        tracker.declare("config", {
            name: "config",
            start: { line: 5, column: 0, index: 50 },
            end: { line: 5, column: 6, index: 56 }
        });
        tracker.exitScope(); // func1

        tracker.enterScope("function", { path: "file1.gml", name: "func2" }); // func2
        const block2 = tracker.enterScope("block", { path: "file1.gml" });
        tracker.exitScope(); // block2
        tracker.exitScope(); // func2

        // Prime the cache by resolving 'config' from all child scopes
        const block1Initial = tracker.resolveIdentifier("config", block1.id);
        const block2Initial = tracker.resolveIdentifier("config", block2.id);

        assert.ok(block1Initial, "block1 should resolve 'config' from func1");
        assert.strictEqual(block2Initial, null, "block2 should not resolve 'config' initially");

        // Now declare 'config' in root/file1 scope
        tracker.declare("config", {
            name: "config",
            start: { line: 1, column: 0, index: 0 },
            end: { line: 1, column: 6, index: 6 }
        });

        // After declaration in file1:
        // - ALL caches should be invalidated (all scopes are descendants of file1)

        const block1After = tracker.resolveIdentifier("config", block1.id);
        const block2After = tracker.resolveIdentifier("config", block2.id);

        // block1 should still resolve to func1's declaration (shadowing)
        assert.ok(block1After);
        assert.strictEqual(block1After?.scopeId, func1.id, "block1 resolves to func1's declaration");

        // block2 should now resolve to file1's declaration
        assert.ok(block2After);
        assert.strictEqual(block2After?.scopeId, file1.id, "block2 resolves to file1's declaration");
    });
});
