import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ScopeTracker } from "../src/scopes/scope-tracker.js";
import { declareAt, referenceAt } from "./scope-tracker-helpers.js";

// ---------------------------------------------------------------------------
// clearScopesForPath
// ---------------------------------------------------------------------------

void describe("ScopeTracker: clearScopesForPath", () => {
    void it("returns 0 for null or empty paths", () => {
        const tracker = new ScopeTracker({ enabled: true });
        assert.equal(tracker.clearScopesForPath(null), 0);
        assert.equal(tracker.clearScopesForPath(undefined), 0);
        assert.equal(tracker.clearScopesForPath(""), 0);
    });

    void it("returns 0 when the path has no registered scopes", () => {
        const tracker = new ScopeTracker({ enabled: true });
        assert.equal(tracker.clearScopesForPath("/unknown/file.gml"), 0);
    });

    void it("removes a single path scope and returns count 1", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("file", { path: "/project/foo.gml" });
        declareAt(tracker, "x");
        tracker.exitScope();

        const removed = tracker.clearScopesForPath("/project/foo.gml");
        assert.equal(removed, 1, "Should remove exactly 1 scope");

        // The scope should be gone from the path index.
        const scopes = tracker.getScopesByPath("/project/foo.gml");
        assert.equal(scopes.length, 0, "Path index should be empty after removal");
    });

    void it("removes descendant scopes in addition to the path scope", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("file", { path: "/project/foo.gml" });
        tracker.enterScope("function");
        tracker.enterScope("block");
        tracker.exitScope(); // block
        tracker.exitScope(); // function
        tracker.exitScope(); // file

        const removed = tracker.clearScopesForPath("/project/foo.gml");
        assert.equal(removed, 3, "Should remove file scope + 2 descendants");
    });

    void it("clears declared symbols from the symbol index", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("file", { path: "/project/foo.gml" });
        declareAt(tracker, "alpha");
        declareAt(tracker, "beta");
        tracker.exitScope();

        tracker.clearScopesForPath("/project/foo.gml");

        // Symbols should no longer appear in any scope summary.
        assert.equal(tracker.getSymbolScopeSummary("alpha").length, 0);
        assert.equal(tracker.getSymbolScopeSummary("beta").length, 0);
    });

    void it("clears referenced symbols from the symbol index", () => {
        const tracker = new ScopeTracker({ enabled: true });

        // Declare in a scope that will survive.
        tracker.enterScope("global");
        declareAt(tracker, "sharedFn");

        // Reference from a scope tied to a path that will be cleared.
        tracker.enterScope("file", { path: "/project/caller.gml" });
        referenceAt(tracker, "sharedFn");
        tracker.exitScope();

        tracker.exitScope(); // global

        const summaryBefore = tracker.getSymbolScopeSummary("sharedFn");
        assert.ok(
            summaryBefore.some((s) => s.hasReference),
            "Should have a reference before removal"
        );

        tracker.clearScopesForPath("/project/caller.gml");

        const summaryAfter = tracker.getSymbolScopeSummary("sharedFn");
        assert.ok(!summaryAfter.some((s) => s.hasReference), "Reference scope should be gone after removal");
        assert.ok(
            summaryAfter.some((s) => s.hasDeclaration),
            "Declaration in surviving scope should remain"
        );
    });

    void it("invalidates identifier resolution cache after removal", () => {
        const tracker = new ScopeTracker({ enabled: true });

        const globalScope = tracker.enterScope("global", { path: "/project/globals.gml" });
        declareAt(tracker, "util");

        // A separate scope that references util—resolveIdentifier caches the result.
        const clientScope = tracker.enterScope("file");
        referenceAt(tracker, "util");
        const resolvedBefore = tracker.resolveIdentifier("util", clientScope.id);
        assert.ok(resolvedBefore, "Should resolve before clearing globals path");
        tracker.exitScope(); // client

        tracker.exitScope(); // global

        tracker.clearScopesForPath("/project/globals.gml");

        // The declaring scope is gone; resolution should now return null.
        const resolvedAfter = tracker.resolveIdentifier("util", clientScope.id);
        assert.equal(resolvedAfter, null, "Resolution cache should be invalidated after declaring scope is removed");

        // Unused variable suppression — we used globalScope to enter the scope
        void globalScope;
    });

    void it("releases cached identifier resolutions that start from removed scopes", () => {
        const tracker = new ScopeTracker({ enabled: true });
        const removedScopeCount = 25;

        tracker.enterScope("program", { path: "/project/main.gml" });
        tracker.enterScope("file", { path: "/project/transient.gml" });

        for (let index = 0; index < removedScopeCount; index += 1) {
            const functionScope = tracker.enterScope("function");
            assert.equal(tracker.resolveIdentifier(`missing_${index}`, functionScope.id), null);
            tracker.exitScope();
        }

        tracker.exitScope();
        tracker.exitScope();

        assert.equal(
            tracker.countRetainedIdentifierResolutionCacheEntries(),
            removedScopeCount,
            "The allocation counter should capture cached entries before clearing the path"
        );

        tracker.clearScopesForPath("/project/transient.gml");

        assert.equal(
            tracker.countRetainedIdentifierResolutionCacheEntries(),
            0,
            "Clearing a path should release cached entries rooted at removed scopes"
        );
    });

    void it("invalidates each declared symbol cache key only once when removing multiple scopes", () => {
        const tracker = new ScopeTracker({ enabled: true });

        const invalidateCalls: string[] = [];
        const identifierCache = (
            tracker as unknown as {
                identifierCache: {
                    invalidate: (name: string, scopeIds?: Iterable<string> | null) => void;
                };
            }
        ).identifierCache;
        const originalInvalidate = identifierCache.invalidate.bind(identifierCache);
        identifierCache.invalidate = (name: string, scopeIds?: Iterable<string> | null): void => {
            invalidateCalls.push(name);
            originalInvalidate(name, scopeIds);
        };

        tracker.enterScope("file", { path: "/project/repeated.gml" });
        declareAt(tracker, "shared");

        tracker.enterScope("function");
        declareAt(tracker, "shared");
        tracker.exitScope();

        tracker.enterScope("function");
        declareAt(tracker, "shared");
        tracker.exitScope();

        tracker.enterScope("function");
        declareAt(tracker, "unique");
        tracker.exitScope();

        tracker.exitScope();
        invalidateCalls.length = 0;

        tracker.clearScopesForPath("/project/repeated.gml");

        assert.equal(
            invalidateCalls.filter((name) => name === "shared").length,
            1,
            "shared should be invalidated once even when declared by multiple removed scopes"
        );
        assert.equal(
            invalidateCalls.filter((name) => name === "unique").length,
            1,
            "unique should still be invalidated once"
        );
    });

    void it("does not disturb sibling scopes registered under a different path", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("file", { path: "/project/a.gml" });
        declareAt(tracker, "aSymbol");
        tracker.exitScope();

        tracker.enterScope("file", { path: "/project/b.gml" });
        declareAt(tracker, "bSymbol");
        tracker.exitScope();

        tracker.clearScopesForPath("/project/a.gml");

        // b.gml scopes and its symbols should be intact.
        const bScopes = tracker.getScopesByPath("/project/b.gml");
        assert.equal(bScopes.length, 1, "Sibling path scope should survive");

        const bSummary = tracker.getSymbolScopeSummary("bSymbol");
        assert.equal(bSummary.length, 1, "Sibling symbol should still be in the index");
        assert.equal(tracker.getSymbolScopeSummary("aSymbol").length, 0, "Removed symbol should be gone");
    });

    void it("handles backslash-separated paths the same as forward-slash paths", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("file", { path: String.raw`C:\project\foo.gml` });
        declareAt(tracker, "win");
        tracker.exitScope();

        // Look up with the normalized form.
        const before = tracker.getScopesByPath(String.raw`C:\project\foo.gml`);
        assert.equal(before.length, 1);

        const removed = tracker.clearScopesForPath("C:/project/foo.gml");
        assert.equal(removed, 1, "Should match regardless of slash direction");

        const after = tracker.getScopesByPath(String.raw`C:\project\foo.gml`);
        assert.equal(after.length, 0);
    });

    void it("supports re-registering scopes for the same path after clearing", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("file", { path: "/project/foo.gml" });
        declareAt(tracker, "old");
        tracker.exitScope();

        tracker.clearScopesForPath("/project/foo.gml");

        // Re-register fresh scopes for the same path.
        tracker.enterScope("file", { path: "/project/foo.gml" });
        declareAt(tracker, "fresh");
        tracker.exitScope();

        const scopes = tracker.getScopesByPath("/project/foo.gml");
        assert.equal(scopes.length, 1, "Fresh scope should be registered");

        assert.equal(tracker.getSymbolScopeSummary("old").length, 0, "Old symbol should be gone");
        assert.equal(tracker.getSymbolScopeSummary("fresh").length, 1, "Fresh symbol should be present");
    });
});

// ---------------------------------------------------------------------------
// getImpactedFilePaths
// ---------------------------------------------------------------------------

void describe("ScopeTracker: getImpactedFilePaths", () => {
    void it("returns an empty set for empty input", () => {
        const tracker = new ScopeTracker({ enabled: true });
        const result = tracker.getImpactedFilePaths([]);
        assert.equal(result.size, 0);
    });

    void it("returns an empty set when changed paths have no registered scopes", () => {
        const tracker = new ScopeTracker({ enabled: true });
        const result = tracker.getImpactedFilePaths(["/unknown.gml"]);
        assert.equal(result.size, 0);
    });

    void it("returns only the changed path itself when there are no dependents", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("file", { path: "/project/standalone.gml" });
        declareAt(tracker, "localOnly");
        tracker.exitScope();

        const result = tracker.getImpactedFilePaths(["/project/standalone.gml"]);
        assert.equal(result.size, 1);
        assert.ok(result.has("/project/standalone.gml"));
    });

    void it("includes files with scopes that reference symbols declared in the changed file", () => {
        const tracker = new ScopeTracker({ enabled: true });

        // helpers.gml is the declaring scope (root). player.gml and enemy.gml
        // are child scopes that can see helpers.gml's symbols via the scope chain,
        // which is how getScopeDependents detects them as dependents.
        tracker.enterScope("program", { path: "/project/helpers.gml" });
        declareAt(tracker, "drawCircle");

        tracker.enterScope("file", { path: "/project/player.gml" });
        referenceAt(tracker, "drawCircle");
        tracker.exitScope();

        tracker.enterScope("file", { path: "/project/enemy.gml" });
        referenceAt(tracker, "drawCircle");
        tracker.exitScope();

        tracker.exitScope(); // helpers.gml

        const result = tracker.getImpactedFilePaths(["/project/helpers.gml"]);

        assert.ok(result.has("/project/helpers.gml"), "Should include the changed file");
        assert.ok(result.has("/project/player.gml"), "Should include direct dependent");
        assert.ok(result.has("/project/enemy.gml"), "Should include direct dependent");
    });

    void it("propagates impact transitively through the dependency graph", () => {
        const tracker = new ScopeTracker({ enabled: true });

        // a.gml (root) declares `util`.
        // b.gml is a child of a.gml: references `util` and declares `service`.
        // c.gml is a child of b.gml: references `service`.
        // Changing a.gml should pull in b.gml (direct dependent, via `util`) and
        // c.gml (transitive dependent, via `service` declared in b.gml).
        tracker.enterScope("program", { path: "/project/a.gml" });
        declareAt(tracker, "util");

        tracker.enterScope("file", { path: "/project/b.gml" });
        referenceAt(tracker, "util");
        declareAt(tracker, "service");

        tracker.enterScope("file", { path: "/project/c.gml" });
        referenceAt(tracker, "service");
        tracker.exitScope(); // c.gml

        tracker.exitScope(); // b.gml
        tracker.exitScope(); // a.gml

        const result = tracker.getImpactedFilePaths(["/project/a.gml"]);

        assert.ok(result.has("/project/a.gml"));
        assert.ok(result.has("/project/b.gml"));
        assert.ok(result.has("/project/c.gml"));
    });

    void it("handles multiple changed paths and deduplicates the result", () => {
        const tracker = new ScopeTracker({ enabled: true });

        // a.gml (root) declares `util`.
        // b.gml (child of a.gml) references `util` and declares `service`.
        // c.gml (child of b.gml) references `service`.
        // Both a.gml and b.gml are in the changed set; c.gml should appear
        // only once in the result even though it is a transitive dependent of
        // a.gml AND a direct dependent of b.gml.
        tracker.enterScope("program", { path: "/project/a.gml" });
        declareAt(tracker, "util");

        tracker.enterScope("file", { path: "/project/b.gml" });
        referenceAt(tracker, "util");
        declareAt(tracker, "service");

        tracker.enterScope("file", { path: "/project/c.gml" });
        referenceAt(tracker, "service");
        tracker.exitScope(); // c.gml

        tracker.exitScope(); // b.gml
        tracker.exitScope(); // a.gml

        const result = tracker.getImpactedFilePaths(["/project/a.gml", "/project/b.gml"]);

        assert.ok(result.has("/project/a.gml"));
        assert.ok(result.has("/project/b.gml"));
        assert.ok(result.has("/project/c.gml"));
        assert.equal(result.size, 3, "c.gml should not appear twice");
    });

    void it("deduplicates repeated changed paths before traversing dependents", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: "/project/a.gml" });
        declareAt(tracker, "util");

        tracker.enterScope("file", { path: "/project/b.gml" });
        referenceAt(tracker, "util");
        tracker.exitScope();

        tracker.exitScope();

        const getTransitiveDependentsMethod = tracker.getTransitiveDependents.bind(tracker);
        let traversalCount = 0;
        tracker.getTransitiveDependents = (scopeId, visited) => {
            traversalCount += 1;
            return getTransitiveDependentsMethod(scopeId, visited);
        };

        const result = tracker.getImpactedFilePaths([
            "/project/a.gml",
            "/project/a.gml",
            "/project/a.gml",
            "/project/b.gml"
        ]);

        assert.ok(result.has("/project/a.gml"));
        assert.ok(result.has("/project/b.gml"));
        assert.equal(result.size, 2);
        assert.equal(traversalCount, 2, "Each unique scope should traverse dependents only once");
    });

    void it("normalizes impacted paths to avoid duplicate slash variants", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("program", { path: String.raw`C:\project\helpers.gml` });
        declareAt(tracker, "sharedUtil");

        tracker.enterScope("file", { path: String.raw`C:\project\player.gml` });
        referenceAt(tracker, "sharedUtil");
        tracker.exitScope();

        tracker.exitScope();

        const result = tracker.getImpactedFilePaths(["C:/project/helpers.gml", String.raw`C:\project\helpers.gml`]);

        assert.ok(result.has("C:/project/helpers.gml"));
        assert.ok(result.has("C:/project/player.gml"));
        assert.equal(result.size, 2, "Impacted set should not include backslash duplicates");
    });

    void it("ignores null and empty strings in the input iterable", () => {
        const tracker = new ScopeTracker({ enabled: true });

        tracker.enterScope("file", { path: "/project/valid.gml" });
        declareAt(tracker, "v");
        tracker.exitScope();

        // Mix of valid and invalid entries.
        const result = tracker.getImpactedFilePaths([
            null as unknown as string,
            "",
            undefined as unknown as string,
            "/project/valid.gml"
        ]);

        assert.ok(result.has("/project/valid.gml"));
        assert.equal(result.size, 1);
    });
});

// ---------------------------------------------------------------------------
// Integration: full hot-reload cycle
// ---------------------------------------------------------------------------

void describe("ScopeTracker hot-reload cycle: clear then re-analyse", () => {
    void it("correctly reflects fresh declarations after clear + re-analyse", () => {
        const tracker = new ScopeTracker({ enabled: true });

        // Initial parse: helpers.gml (root) declares oldHelper; main.gml (child)
        // references it.  helpers.gml must be an ancestor of main.gml so that
        // getScopeDependents detects main.gml as a dependent.
        tracker.enterScope("program", { path: "/project/helpers.gml" });
        declareAt(tracker, "oldHelper");
        tracker.enterScope("file", { path: "/project/main.gml" });
        referenceAt(tracker, "oldHelper");
        tracker.exitScope(); // main.gml
        tracker.exitScope(); // helpers.gml

        // Discover which files need re-analysis when helpers.gml changes.
        const impacted = tracker.getImpactedFilePaths(["/project/helpers.gml"]);
        assert.ok(impacted.has("/project/main.gml"), "Dependent should be impacted");

        // Clear stale scopes for each impacted path.
        for (const p of impacted) {
            tracker.clearScopesForPath(p);
        }

        // Re-analyse helpers.gml with renamed symbol and main.gml referencing it.
        tracker.enterScope("program", { path: "/project/helpers.gml" });
        declareAt(tracker, "newHelper");
        tracker.enterScope("file", { path: "/project/main.gml" });
        referenceAt(tracker, "newHelper");
        tracker.exitScope(); // main.gml
        tracker.exitScope(); // helpers.gml

        // Old symbol should no longer exist; new symbol should be present.
        assert.equal(tracker.getSymbolScopeSummary("oldHelper").length, 0, "Old symbol must be gone");
        assert.equal(tracker.getSymbolScopeSummary("newHelper").length, 2, "New symbol in both scopes");
    });
});
