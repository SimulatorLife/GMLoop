import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const REPOSITORY_ROOT = path.resolve(new URL("../../../../", import.meta.url).pathname);

void test("LSP semantic orchestration never runs project indexing on the server event loop", async () => {
    const identifierIndexSource = await readFile(
        path.join(REPOSITORY_ROOT, "src/lsp/src/intelligence/identifier-index.ts"),
        "utf8"
    );

    assert.doesNotMatch(identifierIndexSource, /Semantic\.buildProjectNavigationIndex\(/u);
    assert.doesNotMatch(identifierIndexSource, /createProjectNavigationIndexFromSemanticSnapshot/u);
    assert.doesNotMatch(identifierIndexSource, /readSemanticSnapshot\(/u);
    assert.match(identifierIndexSource, /buildSemanticIndexInWorker/u);
    assert.match(identifierIndexSource, /withPinnedSemanticQueries/u);
});

void test("identifier-index acquires semantic leases only via lease helpers, never by hand", async () => {
    const identifierIndexSource = await readFile(
        path.join(REPOSITORY_ROOT, "src/lsp/src/intelligence/identifier-index.ts"),
        "utf8"
    );

    // The acquire-check-release ceremony lives in two helpers; every call
    // site that previously walked the `acquisition.lease.queries` /
    // `acquisition.lease.release()` chain by hand must now route through
    // one of them so collaborators only talk to a single immediate
    // neighbour. The assertions below pin that contract: the new helper is
    // introduced, the older helper still exists for navigation-state
    // callers, and every surviving `acquireSemanticSnapshot` call is
    // wrapped by one of the helpers.
    assert.match(identifierIndexSource, /function withSemanticLeaseQueries/u);
    assert.match(identifierIndexSource, /function withPinnedSemanticQueries/u);
    assert.match(identifierIndexSource, /withSemanticLeaseQueries\(/u);
    assert.match(identifierIndexSource, /withPinnedSemanticQueries\(/u);

    // The only legitimate `acquisition.lease.release()` left in the
    // source is the single occurrence inside `withSemanticLeaseQueries`
    // itself; the helper's own JSDoc also shows the pattern as part
    // of its anti-pattern example. Both are required (1 helper + 1
    // illustrative JSDoc), so the total must be exactly 2 — any
    // additional occurrence means a call site slipped back to the
    // raw boilerplate.
    const releaseMatches = identifierIndexSource.match(/acquisition\.lease\.release\(\)/gu) ?? [];
    assert.equal(
        releaseMatches.length,
        2,
        "Expected exactly two acquisition.lease.release() — one inside withSemanticLeaseQueries and one in its JSDoc anti-pattern example"
    );

    // No raw `acquisition.lease.queries.*` access must remain in the
    // file — the new helper exposes the lease (not the queries
    // directly) so that the only place that talks to `lease.queries`
    // is the projection `(lease) => read(lease.queries)` inside
    // `withPinnedSemanticQueries` (and the JSDoc anti-pattern). Any
    // other call site would be a regression.
    const queriesMatches = identifierIndexSource.match(/acquisition\.lease\.queries\./gu) ?? [];
    assert.equal(
        queriesMatches.length,
        0,
        "Expected no acquisition.lease.queries access — callers must project lease.queries inside the helpers, not reach through acquisition"
    );

    // Every `acquireSemanticSnapshot(` invocation must be wrapped by one
    // of the lease helpers. Count both — the helper count must be at
    // least equal to the raw acquisition count (the helper itself
    // performs the call, so each helper site corresponds to one
    // acquisition underneath).
    const acquireMatches = identifierIndexSource.match(/acquireSemanticSnapshot\(/gu) ?? [];
    const helperMatches =
        (identifierIndexSource.match(/withSemanticLeaseQueries\(/gu)?.length ?? 0) +
        (identifierIndexSource.match(/withPinnedSemanticQueries\(/gu)?.length ?? 0);
    assert.ok(
        helperMatches >= acquireMatches.length,
        `Expected every acquireSemanticSnapshot call to be wrapped by a lease helper (acquisitions=${acquireMatches.length}, helpers=${helperMatches})`
    );
});

void test("semantic index failures normalize unknown thrown values before logging", async () => {
    const identifierIndexSource = await readFile(
        path.join(REPOSITORY_ROOT, "src/lsp/src/intelligence/identifier-index.ts"),
        "utf8"
    );

    assert.match(
        identifierIndexSource,
        /Failed to reconcile semantic manifest for \$\{resolvedRoot\}: \$\{Core\.getErrorMessageOrFallback\(error\)\}/u
    );
    assert.match(
        identifierIndexSource,
        /Failed to persist semantic index for \$\{resolvedRoot\}: \$\{Core\.getErrorMessageOrFallback\(error\)\}/u
    );
    assert.doesNotMatch(
        identifierIndexSource,
        /Failed to (?:reconcile semantic manifest|persist semantic index)[^\n]*`, error\)/u
    );
});

void test("semantic worker requests and results carry generation and source boundaries", async () => {
    const workerSource = await readFile(
        path.join(REPOSITORY_ROOT, "src/lsp/src/intelligence/project-index-worker.ts"),
        "utf8"
    );

    for (const boundaryField of [
        "baseGeneration",
        "definitionsGeneration",
        "definitionsSourceRevision",
        "projectHeadGeneration",
        "projectVersion"
    ]) {
        assert.match(workerSource, new RegExp(String.raw`\b${boundaryField}\b`, "u"));
    }
    assert.match(workerSource, /buildBoundary: request\.buildBoundary/u);
});
