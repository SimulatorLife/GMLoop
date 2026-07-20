import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { removeCachedPatchesForFile } from "../src/commands/watch/dependency-updates.js";

type PatchMetadata = { sourcePath: string; sourceHash: string; timestamp: number };
type CachedPatchShape = { js_body?: string; metadata: PatchMetadata | null };

// The helper only reads `metadata.sourcePath`, so the cache entries are built
// with a structural alias for the patch shape that does not pull in the full
// `RuntimeTranspilerPatch` discriminated union. The Map is then widened to the
// helper's expected parameter type via a structural cast, which is safe here
// because the helper never inspects fields outside `metadata.sourcePath`.
type CleanupContext = Parameters<typeof removeCachedPatchesForFile>[0];

function createContext(): CleanupContext {
    const lastSuccessfulPatches = new Map<string, CachedPatchShape>();
    const sourcePathToPatchIds = new Map<string, Set<string>>();

    return {
        lastSuccessfulPatches: lastSuccessfulPatches as unknown as CleanupContext["lastSuccessfulPatches"],
        sourcePathToPatchIds
    };
}

function createPatch(sourcePath: string | null, body: string = "function foo() {}"): CachedPatchShape {
    return sourcePath === null
        ? { js_body: body, metadata: null }
        : {
              js_body: body,
              metadata: { sourcePath, sourceHash: "hash", timestamp: 0 }
          };
}

function setPatch(context: CleanupContext, key: string, patch: CachedPatchShape): void {
    const cache = context.lastSuccessfulPatches as unknown as Map<string, CachedPatchShape>;
    cache.set(key, patch);
}

void describe("removeCachedPatchesForFile", () => {
    void it("removes the entry whose key matches the file symbol id", () => {
        const context = createContext();
        const filePath = "/project/scripts/player.gml";
        const symbolKey = "gml/script/player";
        setPatch(context, symbolKey, createPatch(filePath, "player body"));
        setPatch(context, "other-id", createPatch("/project/scripts/other.gml"));

        const removed = removeCachedPatchesForFile(context, filePath);

        assert.equal(removed, 1, "expected one patch to be removed");
        assert.equal(context.lastSuccessfulPatches.has(symbolKey), false, "symbol-keyed patch should be gone");
        assert.equal(context.lastSuccessfulPatches.has("other-id"), true, "unrelated patch should still be present");
        assert.equal(context.sourcePathToPatchIds.has(filePath), false, "source path entry should be cleared");
    });

    void it("removes every entry whose metadata.sourcePath matches the file", () => {
        const context = createContext();
        const filePath = "/project/scripts/player.gml";
        const otherPath = "/project/scripts/enemy.gml";

        setPatch(context, "multi-1", createPatch(filePath));
        setPatch(context, "multi-2", createPatch(filePath, "second chunk"));
        setPatch(context, "other", createPatch(otherPath));

        const removed = removeCachedPatchesForFile(context, filePath);

        assert.equal(removed, 2, "expected both matching patches to be removed");
        assert.equal(context.lastSuccessfulPatches.size, 1, "only the unrelated entry should remain");
        assert.equal(context.lastSuccessfulPatches.has("other"), true);
        assert.equal(context.sourcePathToPatchIds.has(filePath), false);
    });

    void it("removes the symbol-keyed entry even when no source-path match exists", () => {
        // The symbol id is derived from the file name, so a cache entry keyed by
        // that id should always describe the file. The helper must still evict
        // it even when no entry lists the file in `metadata.sourcePath`, which
        // is the case when the patch was produced by an older transpiler that
        // did not populate that metadata field.
        const context = createContext();
        const filePath = "/project/scripts/player.gml";
        const symbolKey = "gml/script/player";
        setPatch(context, symbolKey, createPatch(null));
        setPatch(context, "unrelated", createPatch("/project/scripts/other.gml"));

        const removed = removeCachedPatchesForFile(context, filePath);

        assert.equal(removed, 1, "expected the symbol-keyed patch to be removed exactly once");
        assert.equal(context.lastSuccessfulPatches.has(symbolKey), false);
        assert.equal(context.lastSuccessfulPatches.has("unrelated"), true);
    });

    void it("returns zero and leaves the map intact when nothing matches", () => {
        const context = createContext();
        const filePath = "/project/scripts/player.gml";
        const otherPath = "/project/scripts/enemy.gml";
        setPatch(context, "gml/script/enemy", createPatch(otherPath));
        setPatch(context, "id-2", createPatch(otherPath, "second"));

        const removed = removeCachedPatchesForFile(context, filePath);

        assert.equal(removed, 0, "no patches should be removed when none match the file");
        assert.equal(context.lastSuccessfulPatches.size, 2, "the cache should be untouched");
    });

    void it("counts the symbol-keyed entry once even when its source path also matches", () => {
        // Regression guard: the previous implementation deleted the symbol id
        // up-front and then iterated the remaining entries, so a patch that was
        // both symbol-keyed and source-path-matched was counted exactly once.
        // The collect-then-delete rewrite must produce the same count.
        const context = createContext();
        const filePath = "/project/scripts/player.gml";
        const symbolKey = "gml/script/player";
        setPatch(context, symbolKey, createPatch(filePath));
        setPatch(context, "extra", createPatch(filePath));

        const removed = removeCachedPatchesForFile(context, filePath);

        assert.equal(removed, 2, "both the symbol-keyed and source-path-matching patches should be counted once each");
        assert.equal(context.lastSuccessfulPatches.size, 0);
    });

    void it("never calls Map.delete while iterating Map.entries()", () => {
        // The previous implementation mutated `lastSuccessfulPatches` from
        // inside the `for (const [patchId, cachedPatch] of …entries())` loop
        // and relied on the spec-defined "delete a not-yet-yielded entry and
        // the iterator skips it" behaviour. That contract is easy to break
        // accidentally (e.g. by snapshotting the keys, but then someone "fixes"
        // the snapshot back to a live iterator), so this test wraps the cache
        // in a Proxy that throws when `delete()` is called while an iteration
        // of the default `for…of` iterator is in flight. The rewritten helper
        // must collect keys first and only mutate after the iteration completes.
        const cache = new Map<string, CachedPatchShape>();
        let iterationDepth = 0;
        let mutationsDuringIteration = 0;

        const proxiedCache = new Proxy(cache, {
            get(target, prop, receiver) {
                if (prop === "delete") {
                    return function proxiedDelete(key: string): boolean {
                        if (iterationDepth > 0) {
                            mutationsDuringIteration += 1;
                            throw new Error(`delete(${JSON.stringify(key)}) invoked while iteration is in progress`);
                        }
                        return target.delete(key);
                    };
                }

                if (prop === Symbol.iterator) {
                    return function proxiedIterator() {
                        const innerIterator = target[Symbol.iterator]();
                        return {
                            next() {
                                iterationDepth += 1;
                                try {
                                    return innerIterator.next();
                                } finally {
                                    iterationDepth -= 1;
                                }
                            },
                            return(value: IteratorResult<[string, CachedPatchShape]>) {
                                iterationDepth -= 1;
                                return typeof innerIterator.return === "function"
                                    ? innerIterator.return(value)
                                    : { value: undefined as unknown as [string, CachedPatchShape], done: true };
                            },
                            throw(error: unknown) {
                                iterationDepth -= 1;
                                return typeof innerIterator.throw === "function"
                                    ? innerIterator.throw(error)
                                    : { value: undefined as unknown as [string, CachedPatchShape], done: true };
                            }
                        };
                    };
                }

                return Reflect.get(target, prop, receiver);
            }
        });

        const filePath = "/project/scripts/player.gml";
        cache.set("gml/script/player", createPatch(filePath));
        cache.set("multi-1", createPatch(filePath));
        cache.set("multi-2", createPatch(filePath, "second"));
        cache.set("unrelated", createPatch("/project/scripts/other.gml"));

        const context = {
            lastSuccessfulPatches: proxiedCache as unknown as CleanupContext["lastSuccessfulPatches"],
            sourcePathToPatchIds: new Map<string, Set<string>>()
        };

        const removed = removeCachedPatchesForFile(context, filePath);

        assert.equal(removed, 3, "expected three matching patches to be removed");
        assert.equal(mutationsDuringIteration, 0, "delete() must not run during iteration");
        assert.equal(cache.size, 1, "only the unrelated entry should remain");
        assert.equal(cache.has("unrelated"), true);
    });
});
