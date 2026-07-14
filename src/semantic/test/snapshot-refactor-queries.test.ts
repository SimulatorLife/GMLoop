import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectIndex } from "../src/project-index/builder.js";
import type { SemanticSnapshot } from "../src/project-index/semantic-snapshot.js";
import { createSemanticSnapshotFromProjectIndex } from "../src/project-index/semantic-snapshot-codec.js";
import { createSemanticSnapshotRefactorQueries } from "../src/project-index/snapshot-refactor-queries.js";
import { createTempProjectWorkspace } from "./test-project-helpers.js";

function createSnapshot(): SemanticSnapshot {
    return Object.freeze({
        dependencies: [],
        occurrences: [
            {
                end: 16,
                filePath: "scripts/target/target.gml",
                resolution: { kind: "exact" as const },
                role: "definition" as const,
                scopeId: "scope:target",
                start: 10,
                symbolId: "gml/script/target"
            },
            {
                end: 18,
                filePath: "scripts/source/source.gml",
                resolution: { kind: "exact" as const },
                role: "reference" as const,
                scopeId: "scope:source",
                start: 12,
                symbolId: "gml/script/target"
            }
        ],
        relationships: [],
        resources: [],
        scopes: [],
        sourceRevision: "revision" as SemanticSnapshot["sourceRevision"],
        symbols: [
            {
                definingFilePath: "scripts/target/target.gml",
                displayName: "target",
                documentation: {
                    additionalTags: [],
                    description: "",
                    normalizedText: "",
                    parameters: [],
                    returns: null
                },
                kind: "script",
                name: "target",
                scopeId: "scope:target",
                symbolId: "gml/script/target"
            }
        ],
        tier: "full" as const,
        unresolvedReferences: [
            {
                end: 24,
                filePath: "scripts/source/source.gml",
                name: "target",
                resolution: {
                    candidateSymbolIds: ["gml/script/target"],
                    kind: "candidate" as const,
                    uncertaintyReason: "Lexical binding could not be proven."
                },
                start: 18
            }
        ]
    });
}

void test("snapshot refactor queries preserve exact occurrences and block uncertain rename closure", () => {
    const projectRoot = "/project";
    const queries = createSemanticSnapshotRefactorQueries(projectRoot, createSnapshot());

    assert.equal(queries.resolveSymbolId("target"), "gml/script/target");
    assert.equal(queries.hasSymbol("gml/script/target"), true);
    assert.deepEqual(queries.getSymbolAtPosition("/project/scripts/source/source.gml", 13), {
        name: "target",
        range: { end: 18, start: 12 },
        symbolId: "gml/script/target"
    });
    assert.equal(queries.getSymbolAtPosition("/project/scripts/source/source.gml", 18), null);
    assert.deepEqual(queries.getFileSymbols("/project/scripts/target/target.gml"), [{ id: "gml/script/target" }]);
    assert.deepEqual(queries.getSymbolOccurrences("target"), [
        {
            end: 18,
            kind: "reference",
            path: "/project/scripts/source/source.gml",
            scopeId: "scope:source",
            start: 12
        },
        {
            end: 16,
            kind: "definition",
            path: "/project/scripts/target/target.gml",
            scopeId: "scope:target",
            start: 10
        }
    ]);
    assert.equal(queries.getRenameSafetyGaps("gml/script/target").length, 1);
});

void test("snapshot refactor queries permit an exact cross-script call rename", async () => {
    const fixture = await createTempProjectWorkspace("gmloop-snapshot-refactor-query-");
    try {
        await fixture.writeProjectFile(
            "Game.yyp",
            JSON.stringify({
                name: "Game",
                resourceType: "GMProject",
                resources: [
                    { id: { name: "source", path: "scripts/source/source.yy" } },
                    { id: { name: "target", path: "scripts/target/target.yy" } }
                ]
            })
        );
        await fixture.writeProjectFile(
            "scripts/source/source.yy",
            JSON.stringify({ name: "source", resourceType: "GMScript" })
        );
        await fixture.writeProjectFile("scripts/source/source.gml", "function source() { target(); }");
        await fixture.writeProjectFile(
            "scripts/target/target.yy",
            JSON.stringify({ name: "target", resourceType: "GMScript" })
        );
        await fixture.writeProjectFile("scripts/target/target.gml", "function target() { return 1; }");

        const snapshot = createSemanticSnapshotFromProjectIndex(
            await buildProjectIndex(fixture.projectRoot),
            "full",
            "revision" as SemanticSnapshot["sourceRevision"]
        );
        const targetSymbol = snapshot.symbols.find((symbol) => symbol.name === "target");
        assert.ok(targetSymbol, "target must have a canonical symbol");
        const queries = createSemanticSnapshotRefactorQueries(fixture.projectRoot, snapshot);

        assert.equal(queries.getRenameSafetyGaps(targetSymbol.symbolId).length, 0);
        assert.equal(queries.getSymbolOccurrences("target", targetSymbol.symbolId).length, 2);
    } finally {
        await fixture.cleanup();
    }
});
