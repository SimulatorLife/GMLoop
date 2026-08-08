import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { __projectIndexBuilderTest__ } from "../src/project-index/builder.js";

type ScopeRecord = {
    filePaths: Array<string>;
    declarations: Array<{ filePath: string }>;
    references: Array<{ filePath: string }>;
    ignoredIdentifiers: Array<{ filePath: string }>;
    scriptCalls: Array<{ from?: { filePath: string } }>;
};

type IdentifierEntry = {
    declarations: Array<{ filePath: string }>;
    references: Array<{ filePath: string }>;
};

function createScopeRecord(filePaths: Array<string>): ScopeRecord {
    return {
        filePaths,
        declarations: filePaths.map((filePath) => ({ filePath })),
        references: filePaths.map((filePath) => ({ filePath })),
        ignoredIdentifiers: filePaths.map((filePath) => ({ filePath })),
        scriptCalls: filePaths.map((filePath) => ({ from: { filePath } }))
    };
}

function createIdentifierCollections() {
    return {
        declarations: new Map<string, IdentifierEntry>(),
        references: new Map<string, IdentifierEntry>()
    };
}

void describe("removeFileFromAggregationState", () => {
    void it("removes file-scoped entries that match the changed path", () => {
        const scopeMap = new Map<string, ScopeRecord>([
            ["file:a.gml", createScopeRecord(["a.gml"])],
            ["file:b.gml", createScopeRecord(["b.gml"])],
            ["file:c.gml", createScopeRecord(["c.gml"])]
        ]);
        const filesMap = new Map<string, unknown>([["a.gml", { path: "a.gml" }]]);
        const identifierCollections = createIdentifierCollections();
        const relationships = { scriptCalls: [] };

        __projectIndexBuilderTest__.removeFileFromAggregationState(
            "a.gml",
            scopeMap,
            filesMap,
            identifierCollections,
            relationships
        );

        assert.equal(scopeMap.has("file:a.gml"), false, "scopeMap entry for file:a.gml should be removed");
        assert.equal(scopeMap.has("file:b.gml"), true, "unrelated scopeMap entry should remain");
        assert.equal(scopeMap.has("file:c.gml"), true, "unrelated scopeMap entry should remain");
        assert.equal(filesMap.has("a.gml"), false, "filesMap entry should be removed");
    });

    void it("copy-on-writes the global and project scopes so other files keep their entries", () => {
        const globalRecord = createScopeRecord(["a.gml", "b.gml", "c.gml"]);
        const projectRecord = createScopeRecord(["a.gml", "d.gml"]);
        const scopeMap = new Map<string, ScopeRecord>([
            ["global", globalRecord],
            ["project", projectRecord],
            ["file:a.gml", createScopeRecord(["a.gml"])]
        ]);
        const filesMap = new Map<string, unknown>();
        const identifierCollections = createIdentifierCollections();
        const relationships = { scriptCalls: [] };

        __projectIndexBuilderTest__.removeFileFromAggregationState(
            "a.gml",
            scopeMap,
            filesMap,
            identifierCollections,
            relationships
        );

        assert.equal(scopeMap.has("file:a.gml"), false, "per-file scope for a.gml should be evicted");
        assert.equal(scopeMap.has("global"), true, "global scope should remain (copy-on-write)");
        assert.equal(scopeMap.has("project"), true, "project scope should remain (copy-on-write)");

        const nextGlobal = scopeMap.get("global");
        const nextProject = scopeMap.get("project");
        assert.ok(nextGlobal, "global scope must still exist after removal");
        assert.ok(nextProject, "project scope must still exist after removal");
        assert.deepEqual(nextGlobal.filePaths, ["b.gml", "c.gml"], "global scope should drop a.gml");
        assert.deepEqual(nextProject.filePaths, ["d.gml"], "project scope should drop a.gml");
        assert.equal(
            nextGlobal.declarations.length,
            2,
            "global scope declarations should drop a.gml but keep the others"
        );
        assert.equal(nextProject.references.length, 1, "project scope references should drop a.gml but keep d.gml");

        // The new record must not share identity with the original — callers
        // rely on the copy-on-write replacement to keep stale references
        // intact elsewhere.
        assert.notStrictEqual(nextGlobal, globalRecord, "global scope should be replaced, not mutated in place");
        assert.notStrictEqual(nextProject, projectRecord, "project scope should be replaced, not mutated in place");
    });

    void it("filters identifier collection entries that reference the changed path", () => {
        const declarations = new Map<string, IdentifierEntry>([
            [
                "kept",
                {
                    declarations: [{ filePath: "other.gml" }],
                    references: []
                }
            ],
            [
                "filtered-no-decls-no-refs",
                {
                    declarations: [{ filePath: "a.gml" }],
                    references: [{ filePath: "a.gml" }]
                }
            ],
            [
                "filtered-keep-some-refs",
                {
                    declarations: [],
                    references: [{ filePath: "a.gml" }, { filePath: "b.gml" }]
                }
            ]
        ]);
        const references = new Map<string, IdentifierEntry>([
            [
                "all-removed",
                {
                    declarations: [],
                    references: [{ filePath: "a.gml" }]
                }
            ]
        ]);
        const identifierCollections = { declarations, references };
        const scopeMap = new Map<string, ScopeRecord>();
        const filesMap = new Map<string, unknown>();
        const relationships = { scriptCalls: [] };

        __projectIndexBuilderTest__.removeFileFromAggregationState(
            "a.gml",
            scopeMap,
            filesMap,
            identifierCollections,
            relationships
        );

        assert.equal(declarations.has("kept"), true, "unrelated declaration should survive");
        assert.equal(
            declarations.has("filtered-no-decls-no-refs"),
            false,
            "declaration entry with no surviving references should be removed"
        );
        assert.equal(
            declarations.has("filtered-keep-some-refs"),
            true,
            "declaration entry with surviving references should be updated in place"
        );

        const filtered = declarations.get("filtered-keep-some-refs");
        assert.ok(filtered, "filtered declaration entry should remain in the map");
        assert.equal(filtered.references.length, 1, "references for a.gml should be filtered out");
        assert.equal(filtered.references[0]?.filePath, "b.gml", "the surviving reference should be for b.gml");

        assert.equal(references.has("all-removed"), false, "references entry with no surviving refs should be removed");
    });

    void it("filters relationship script calls that originate from the changed path", () => {
        const scopeMap = new Map<string, ScopeRecord>();
        const filesMap = new Map<string, unknown>();
        const identifierCollections = createIdentifierCollections();
        const relationships = {
            scriptCalls: [
                { id: "kept-a", from: { filePath: "other.gml" } },
                { id: "dropped-a", from: { filePath: "a.gml" } },
                { id: "dropped-b", from: { filePath: "a.gml" } },
                { id: "dropped-no-from", from: undefined }
            ]
        };

        __projectIndexBuilderTest__.removeFileFromAggregationState(
            "a.gml",
            scopeMap,
            filesMap,
            identifierCollections,
            relationships
        );

        assert.equal(relationships.scriptCalls.length, 2);
        assert.deepEqual(
            relationships.scriptCalls.map((call) => call.id),
            ["kept-a", "dropped-no-from"],
            "calls originating from a.gml should be filtered out; unrelated calls survive"
        );
    });

    void it("walks a long scope-map tail without skipping entries that should be evicted", () => {
        // The previous implementation called `scopeMap.delete(scopeId)` from
        // inside `scopeMap.entries()`, which is fragile because spec-defined
        // iterator semantics only guarantee that deletion of already-yielded
        // entries is well-defined; deletion of not-yet-yielded entries is
        // implementation defined. Construct a map where the doomed entries are
        // clustered after several survivors so any iterator that walks the
        // backing table in storage order (rather than strict insertion order)
        // could miss them. The snapshot-based replacement must still evict
        // every entry whose scope id starts with `file:a.gml` regardless of
        // where it sits in the map.
        const scopeMap = new Map<string, ScopeRecord>();
        for (let index = 0; index < 16; index += 1) {
            scopeMap.set(`file:survivor-${index}.gml`, createScopeRecord([`survivor-${index}.gml`]));
        }
        for (let index = 0; index < 16; index += 1) {
            scopeMap.set(`file:a-${index}.gml`, createScopeRecord([`a-${index}.gml`]));
        }
        const filesMap = new Map<string, unknown>();
        const identifierCollections = createIdentifierCollections();
        const relationships = { scriptCalls: [] };

        __projectIndexBuilderTest__.removeFileFromAggregationState(
            "a-7.gml",
            scopeMap,
            filesMap,
            identifierCollections,
            relationships
        );

        // Only the entry whose scope id starts with `file:a-7.gml` should be
        // removed; the others all live under different paths and must survive.
        for (let index = 0; index < 16; index += 1) {
            assert.equal(
                scopeMap.has(`file:survivor-${index}.gml`),
                true,
                `survivor-${index} should remain in the scope map`
            );
            assert.equal(
                scopeMap.has(`file:a-${index}.gml`),
                index === 7 ? false : true,
                `a-${index} should ${index === 7 ? "be evicted" : "remain"} in the scope map`
            );
        }
    });
});
