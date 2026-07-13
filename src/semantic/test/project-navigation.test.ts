import assert from "node:assert/strict";
import test from "node:test";

import {
    createProjectNavigationIndex,
    createProjectNavigationIndexFromSemanticSnapshot,
    findNavigationDefinitions,
    findNavigationReferences,
    findNavigationSymbolAtPosition,
    resolveNavigationSymbolId
} from "../src/navigation/index.js";
import type { SemanticSnapshot } from "../src/project-index/semantic-snapshot.js";

void test("project navigation separates definitions and references with exclusive ranges", () => {
    const index = createProjectNavigationIndex({
        projectRoot: "/tmp/game",
        identifiers: {
            scripts: {
                "scope:script:target": {
                    identifierId: "script:scope:script:target",
                    name: "target",
                    displayName: "target",
                    declarations: [
                        {
                            filePath: "scripts/target/target.gml",
                            start: { index: 9 },
                            end: { index: 14 },
                            scopeId: "scope:script:target"
                        }
                    ],
                    references: [
                        {
                            filePath: "scripts/source/source.gml",
                            start: { index: 24 },
                            end: { index: 29 },
                            scopeId: "scope:script:source"
                        }
                    ]
                }
            }
        }
    });

    const symbolId = resolveNavigationSymbolId(index, "target");
    assert.equal(symbolId, "script:scope:script:target");

    const definitions = findNavigationDefinitions(index, symbolId);
    assert.equal(definitions.length, 1);
    assert.deepEqual(definitions[0].location.range, { start: 9, end: 15 });

    const referencesOnly = findNavigationReferences(index, symbolId, false);
    assert.equal(referencesOnly.length, 1);
    assert.equal(referencesOnly[0].role, "reference");

    const allOccurrences = findNavigationReferences(index, symbolId, true);
    assert.equal(allOccurrences.length, 2);

    const occurrenceAtCall = findNavigationSymbolAtPosition(index, "/tmp/game/scripts/source/source.gml", 25);
    assert.equal(occurrenceAtCall?.symbolId, symbolId);

    const occurrenceAtExclusiveEnd = findNavigationSymbolAtPosition(index, "/tmp/game/scripts/source/source.gml", 30);
    assert.equal(occurrenceAtExclusiveEnd, null);
});

void test("project navigation restores directly from normalized semantic facts", () => {
    const snapshot: SemanticSnapshot = Object.freeze({
        dependencies: [],
        occurrences: [
            {
                end: 15,
                filePath: "scripts/target.gml",
                role: "definition" as const,
                scopeId: "script:target",
                start: 9,
                symbolId: "gml/script/target"
            },
            {
                end: 30,
                filePath: "scripts/use.gml",
                role: "reference" as const,
                scopeId: "script:use",
                start: 24,
                symbolId: "gml/script/target"
            }
        ],
        relationships: [
            {
                kind: "scriptCall",
                ownerFilePath: "scripts/caller.gml",
                payload: {
                    end: 18,
                    fromScopeId: "script:caller",
                    start: 12,
                    targetName: "target",
                    targetScopeId: "script:target"
                },
                relationshipId: "script-call:scripts/caller.gml:0"
            }
        ],
        resources: [],
        scopes: [],
        sourceRevision: "revision" as SemanticSnapshot["sourceRevision"],
        symbols: [
            {
                definingFilePath: "scripts/target.gml",
                displayName: "target",
                documentation: {
                    additionalTags: [],
                    description: "Target docs",
                    normalizedText: "Target docs",
                    parameters: [],
                    returns: null
                },
                kind: "scripts",
                name: "target",
                scopeId: "script:target",
                symbolId: "gml/script/target"
            }
        ],
        tier: "full",
        unresolvedReferences: []
    });
    const index = createProjectNavigationIndexFromSemanticSnapshot("/tmp/game", snapshot);
    const symbolId = resolveNavigationSymbolId(index, "target");
    assert.equal(symbolId, "gml/script/target");
    assert.equal(findNavigationDefinitions(index, symbolId).length, 1);
    assert.equal(findNavigationReferences(index, symbolId, false).length, 2);
    assert.equal(findNavigationSymbolAtPosition(index, "/tmp/game/scripts/use.gml", 25)?.symbolId, symbolId);
    assert.equal(findNavigationSymbolAtPosition(index, "/tmp/game/scripts/caller.gml", 13)?.symbolId, symbolId);
});
