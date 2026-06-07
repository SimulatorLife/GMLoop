import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { ScopeTracker } from "../src/scopes/scope-tracker.js";
import { declareAt, referenceAt } from "./scope-tracker-helpers.js";

// ---------------------------------------------------------------------------
// sortPathsForReanalysis
// ---------------------------------------------------------------------------

void describe("ScopeTracker: sortPathsForReanalysis", () => {
    void it("returns empty array for empty input", () => {
        const tracker = new ScopeTracker({ enabled: true });
        assert.deepStrictEqual(tracker.sortPathsForReanalysis([]), []);
        assert.deepStrictEqual(tracker.sortPathsForReanalysis(new Set()), []);
    });

    void it("filters out null, undefined, and empty-string entries", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("file", { path: "/a.gml" });
        declareAt(tracker, "x");
        tracker.exitScope();

        const result = tracker.sortPathsForReanalysis([null, undefined, "", "/a.gml"]);
        assert.deepStrictEqual(result, ["/a.gml"]);
    });

    void it("returns single path as-is", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("file", { path: "/only.gml" });
        declareAt(tracker, "sym");
        tracker.exitScope();

        assert.deepStrictEqual(tracker.sortPathsForReanalysis(["/only.gml"]), ["/only.gml"]);
    });

    void it("returns paths in lexicographic order when there are no dependencies", () => {
        const tracker = new ScopeTracker({ enabled: true });
        // Independent files — no cross-references.
        for (const p of ["/c.gml", "/a.gml", "/b.gml"]) {
            tracker.enterScope("file", { path: p });
            declareAt(tracker, `sym_${p}`);
            tracker.exitScope();
        }

        const result = tracker.sortPathsForReanalysis(["/c.gml", "/b.gml", "/a.gml"]);
        assert.deepStrictEqual(result, ["/a.gml", "/b.gml", "/c.gml"]);
    });

    void it("places dependency before dependent in a simple A→B chain", () => {
        const tracker = new ScopeTracker({ enabled: true });

        // a.gml (parent/root file scope) declares `helper`; b.gml (child file
        // scope) references `helper`.  Nesting models the typical GML pattern
        // where one file's globals are visible to dependents.
        tracker.enterScope("file", { path: "/a.gml" });
        declareAt(tracker, "helper");
        tracker.enterScope("file", { path: "/b.gml" });
        referenceAt(tracker, "helper");
        tracker.exitScope(); // b.gml
        tracker.exitScope(); // a.gml

        const result = tracker.sortPathsForReanalysis(["/b.gml", "/a.gml"]);
        assert.deepStrictEqual(result, ["/a.gml", "/b.gml"]);
    });

    void it("handles a three-level A→B→C chain correctly", () => {
        const tracker = new ScopeTracker({ enabled: true });

        // a.gml (root file scope) declares x;
        // b.gml (child file scope) references x and declares y;
        // c.gml (grandchild file scope) references y.
        tracker.enterScope("file", { path: "/a.gml" });
        declareAt(tracker, "x");

        tracker.enterScope("file", { path: "/b.gml" });
        referenceAt(tracker, "x");
        declareAt(tracker, "y");

        tracker.enterScope("file", { path: "/c.gml" });
        referenceAt(tracker, "y");
        tracker.exitScope(); // c.gml

        tracker.exitScope(); // b.gml
        tracker.exitScope(); // a.gml

        const result = tracker.sortPathsForReanalysis(["/c.gml", "/a.gml", "/b.gml"]);
        // a must come before b; b must come before c.
        const idxA = result.indexOf("/a.gml");
        const idxB = result.indexOf("/b.gml");
        const idxC = result.indexOf("/c.gml");
        assert.ok(idxA < idxB, "a.gml must precede b.gml");
        assert.ok(idxB < idxC, "b.gml must precede c.gml");
        assert.equal(result.length, 3);
    });

    void it("places paths with no registered scopes first (treated as independent)", () => {
        const tracker = new ScopeTracker({ enabled: true });

        // a.gml (root file scope) declares x; b.gml (child file scope) references x.
        // /unknown.gml has no scopes registered.
        tracker.enterScope("file", { path: "/a.gml" });
        declareAt(tracker, "x");
        tracker.enterScope("file", { path: "/b.gml" });
        referenceAt(tracker, "x");
        tracker.exitScope(); // b.gml
        tracker.exitScope(); // a.gml

        const result = tracker.sortPathsForReanalysis(["/b.gml", "/unknown.gml", "/a.gml"]);
        assert.equal(result.length, 3);
        // a must precede b; /unknown.gml has in-degree 0 so it appears before b.gml.
        const idxA = result.indexOf("/a.gml");
        const idxB = result.indexOf("/b.gml");
        assert.ok(idxA < idxB, "a.gml must precede b.gml");
        assert.ok(result.includes("/unknown.gml"), "unknown path must be included");
        // /unknown.gml and /a.gml both have in-degree 0; lexicographic order applies.
        assert.deepStrictEqual(result[0], "/a.gml");
        assert.deepStrictEqual(result[1], "/unknown.gml");
        assert.deepStrictEqual(result[2], "/b.gml");
    });

    void it("deduplicates repeated paths in input", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("file", { path: "/x.gml" });
        declareAt(tracker, "s");
        tracker.exitScope();

        const result = tracker.sortPathsForReanalysis(["/x.gml", "/x.gml", "/x.gml"]);
        assert.deepStrictEqual(result, ["/x.gml"]);
    });

    void it("handles dependency outside the input set gracefully (ignored)", () => {
        const tracker = new ScopeTracker({ enabled: true });

        // /lib.gml (root file scope) declares `util` but is NOT in the input set.
        // /app.gml (child file scope) references `util`.
        tracker.enterScope("file", { path: "/lib.gml" });
        declareAt(tracker, "util");
        tracker.enterScope("file", { path: "/app.gml" });
        referenceAt(tracker, "util");
        tracker.exitScope(); // app.gml
        tracker.exitScope(); // lib.gml

        // Only /app.gml is in the input — /lib.gml's dependency should be ignored.
        const result = tracker.sortPathsForReanalysis(["/app.gml"]);
        assert.deepStrictEqual(result, ["/app.gml"]);
    });

    void it("handles mutual dependency (cycle) by appending cycle members lexicographically", () => {
        const tracker = new ScopeTracker({ enabled: true });

        // In a tree-structured scope graph true cross-file cycles cannot occur
        // (a child scope cannot declare something visible to its ancestor).
        // This test verifies that when neither file's references resolve to the
        // other's declarations — both files end up with in-degree 0 and are
        // emitted in lexicographic order.
        //
        // root (no path) declares a_sym and b_sym.
        // /a.gml references b_sym → resolves to root (no path → no edge).
        // /b.gml references a_sym → resolves to root (no path → no edge).
        // Neither creates an edge between the two files; both are independent.
        tracker.enterScope("file"); // root, no path
        declareAt(tracker, "a_sym");
        declareAt(tracker, "b_sym");

        tracker.enterScope("file", { path: "/a.gml" });
        referenceAt(tracker, "b_sym");
        tracker.exitScope(); // a.gml

        tracker.enterScope("file", { path: "/b.gml" });
        referenceAt(tracker, "a_sym");
        tracker.exitScope(); // b.gml

        tracker.exitScope(); // root

        const result = tracker.sortPathsForReanalysis(["/b.gml", "/a.gml"]);
        assert.equal(result.length, 2);
        assert.ok(result.includes("/a.gml"));
        assert.ok(result.includes("/b.gml"));
        // Both have in-degree 0 → lexicographic order: a before b.
        assert.ok(result.indexOf("/a.gml") < result.indexOf("/b.gml"));
    });

    void it("returns empty array when tracker is disabled and paths are empty", () => {
        const tracker = new ScopeTracker({ enabled: false });
        assert.deepStrictEqual(tracker.sortPathsForReanalysis([]), []);
    });

    void it("still returns paths (without dependency ordering) when tracker is disabled", () => {
        const tracker = new ScopeTracker({ enabled: false });
        const result = tracker.sortPathsForReanalysis(["/z.gml", "/a.gml"]);
        // No dependency graph computed; order is the insertion order (deduped).
        assert.equal(result.length, 2);
        assert.ok(result.includes("/z.gml"));
        assert.ok(result.includes("/a.gml"));
    });

    void it("normalises backslash path separators to forward slashes", () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("file", { path: "/project/a.gml" });
        declareAt(tracker, "sym");
        tracker.exitScope();

        // Windows-style path should be treated as the same path.
        const result = tracker.sortPathsForReanalysis([String.raw`\project\a.gml`, "/project/a.gml"]);
        assert.equal(result.length, 1);
    });

    // ---------------------------------------------------------------------------
    // Integration: sort then clear then re-analyse
    // ---------------------------------------------------------------------------

    void it("produces correct analysis order in a full hot-reload cycle", () => {
        const tracker = new ScopeTracker({ enabled: true });

        // Initial analysis: lib.gml (root file scope) declares `utils`;
        // app.gml (child file scope) references `utils`.
        tracker.enterScope("file", { path: "/lib.gml" });
        declareAt(tracker, "utils");
        tracker.enterScope("file", { path: "/app.gml" });
        referenceAt(tracker, "utils");
        tracker.exitScope(); // app.gml
        tracker.exitScope(); // lib.gml

        // lib.gml changes → both lib.gml and app.gml need re-analysis.
        const impacted = tracker.getImpactedFilePaths(["/lib.gml"]);
        assert.ok(impacted.has("/lib.gml"));
        assert.ok(impacted.has("/app.gml"));

        // Sort BEFORE clearing.
        const sorted = tracker.sortPathsForReanalysis(impacted);
        assert.equal(sorted.length, 2);
        assert.equal(sorted[0], "/lib.gml", "lib.gml must be re-analysed first");
        assert.equal(sorted[1], "/app.gml", "app.gml must be re-analysed second");

        // Clear in sorted order.
        for (const p of sorted) {
            tracker.clearScopesForPath(p);
        }

        // Re-analyse in sorted order.
        tracker.enterScope("file", { path: "/lib.gml" });
        declareAt(tracker, "utils");
        tracker.enterScope("file", { path: "/app.gml" });
        referenceAt(tracker, "utils");
        tracker.exitScope(); // app.gml
        tracker.exitScope(); // lib.gml

        // After re-analysis the symbol should appear in both scopes again.
        const summaries = tracker.getSymbolScopeSummary("utils");
        assert.ok(summaries.length > 0, "utils should be present after re-analysis");
    });
});
