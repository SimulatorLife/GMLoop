import assert from "node:assert/strict";
import test from "node:test";

import {
    createProjectNavigationIndex,
    findNavigationDefinitions,
    findNavigationReferences,
    findNavigationSymbolAtPosition,
    resolveNavigationSymbolId
} from "../src/navigation/index.js";

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
