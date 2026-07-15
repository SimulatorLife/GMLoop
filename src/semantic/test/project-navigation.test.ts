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
import { listSemanticRenameSafetyGaps } from "../src/project-index/rename-safety.js";
import type { SemanticSnapshot } from "../src/project-index/semantic-snapshot.js";
import { createSemanticSnapshotFromProjectIndex } from "../src/project-index/semantic-snapshot-codec.js";

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

void test("project navigation uses canonical occurrences without recreating relationship references", () => {
    const snapshot: SemanticSnapshot = Object.freeze({
        dependencies: [],
        occurrences: [
            {
                end: 15,
                filePath: "scripts/target.gml",
                resolution: { kind: "exact" as const },
                role: "definition" as const,
                scopeId: "script:target",
                start: 9,
                symbolId: "gml/script/target"
            },
            {
                end: 30,
                filePath: "scripts/use.gml",
                resolution: { kind: "exact" as const },
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
    assert.equal(findNavigationReferences(index, symbolId, false).length, 1);
    assert.equal(findNavigationSymbolAtPosition(index, "/tmp/game/scripts/use.gml", 25)?.symbolId, symbolId);
    assert.equal(findNavigationSymbolAtPosition(index, "/tmp/game/scripts/caller.gml", 13), null);
});

void test("semantic snapshot keeps ambiguous bare calls unresolved", () => {
    const snapshot = createSemanticSnapshotFromProjectIndex(
        {
            identifiers: {
                functions: {
                    first: {
                        declarations: [
                            { filePath: "scripts/first.gml", location: { end: { index: 8 }, start: { index: 0 } } }
                        ],
                        filePath: "scripts/first.gml",
                        identifierId: "gml/function/first-duplicate",
                        name: "duplicate"
                    },
                    second: {
                        declarations: [
                            { filePath: "scripts/second.gml", location: { end: { index: 8 }, start: { index: 0 } } }
                        ],
                        filePath: "scripts/second.gml",
                        identifierId: "gml/function/second-duplicate",
                        name: "duplicate"
                    }
                }
            },
            relationships: {
                scriptCalls: [
                    {
                        from: { filePath: "scripts/caller.gml", scopeId: "scope:caller" },
                        isResolved: false,
                        location: { end: { index: 16 }, start: { index: 8 } },
                        target: { name: "duplicate", scopeId: null }
                    }
                ]
            }
        },
        "full",
        "ambiguous" as SemanticSnapshot["sourceRevision"]
    );
    assert.deepEqual(snapshot.unresolvedReferences, [
        {
            end: 17,
            filePath: "scripts/caller.gml",
            name: "duplicate",
            resolution: {
                candidateSymbolIds: ["gml/function/first-duplicate", "gml/function/second-duplicate"],
                kind: "ambiguous",
                uncertaintyReason: "Multiple same-named declarations prevent a unique binding."
            },
            start: 8
        }
    ]);
    assert.equal(
        snapshot.occurrences.some(
            (occurrence) => occurrence.role === "reference" && occurrence.filePath === "scripts/caller.gml"
        ),
        false
    );
});

void test("semantic snapshot marks an unbound same-named identifier as a candidate", () => {
    const snapshot = createSemanticSnapshotFromProjectIndex(
        {
            files: {
                "scripts/caller.gml": {
                    ignoredIdentifiers: [{ end: { index: 10 }, name: "helper", start: { index: 4 } }]
                }
            },
            identifiers: {
                functions: {
                    helper: {
                        declarations: [
                            { filePath: "scripts/helper.gml", location: { end: { index: 5 }, start: { index: 0 } } }
                        ],
                        filePath: "scripts/helper.gml",
                        identifierId: "gml/function/helper",
                        name: "helper"
                    }
                }
            }
        },
        "full",
        "candidate" as SemanticSnapshot["sourceRevision"]
    );

    assert.deepEqual(snapshot.unresolvedReferences, [
        {
            end: 11,
            filePath: "scripts/caller.gml",
            name: "helper",
            resolution: {
                candidateSymbolIds: ["gml/function/helper"],
                kind: "candidate",
                uncertaintyReason: "A same-named declaration exists, but lexical binding could not be proven."
            },
            start: 4
        }
    ]);
});

void test("rename safety blocks the requested symbol's uncertain references", () => {
    const snapshot = createSemanticSnapshotFromProjectIndex(
        {
            identifiers: {
                functions: {
                    first: {
                        declarations: [
                            { filePath: "scripts/first.gml", location: { end: { index: 8 }, start: { index: 0 } } }
                        ],
                        filePath: "scripts/first.gml",
                        identifierId: "gml/function/first-duplicate",
                        name: "duplicate"
                    },
                    second: {
                        declarations: [
                            { filePath: "scripts/second.gml", location: { end: { index: 8 }, start: { index: 0 } } }
                        ],
                        filePath: "scripts/second.gml",
                        identifierId: "gml/function/second-duplicate",
                        name: "duplicate"
                    }
                }
            },
            relationships: {
                scriptCalls: [
                    {
                        from: { filePath: "scripts/caller.gml", scopeId: "scope:caller" },
                        isResolved: false,
                        location: { end: { index: 16 }, start: { index: 8 } },
                        target: { name: "duplicate", scopeId: null }
                    }
                ]
            }
        },
        "full",
        "rename-safety" as SemanticSnapshot["sourceRevision"]
    );

    assert.deepEqual(listSemanticRenameSafetyGaps(snapshot, "gml/function/first-duplicate"), [
        {
            end: 17,
            filePath: "scripts/caller.gml",
            kind: "uncertainReference",
            message: "Cannot safely rename 'duplicate': an ambiguous binding exists at scripts/caller.gml:8-17.",
            name: "duplicate",
            resolution: {
                candidateSymbolIds: ["gml/function/first-duplicate", "gml/function/second-duplicate"],
                kind: "ambiguous",
                uncertaintyReason: "Multiple same-named declarations prevent a unique binding."
            },
            start: 8,
            symbolId: "gml/function/first-duplicate"
        }
    ]);
});

void test("rename safety rejects a definitions snapshot", () => {
    const definitionsSnapshot: SemanticSnapshot = Object.freeze({
        dependencies: [],
        occurrences: [],
        relationships: [],
        resources: [],
        scopes: [],
        sourceRevision: "definitions" as SemanticSnapshot["sourceRevision"],
        symbols: [],
        tier: "definitions",
        unresolvedReferences: []
    });

    assert.deepEqual(listSemanticRenameSafetyGaps(definitionsSnapshot, "gml/script/target"), [
        {
            kind: "incompleteTier",
            message: "Rename safety requires a compatible full semantic snapshot.",
            symbolId: "gml/script/target"
        }
    ]);
});

void test("semantic snapshot binds a script call by target scope before its shared function name", () => {
    const snapshot = createSemanticSnapshotFromProjectIndex(
        {
            identifiers: {
                functions: {
                    targetFunction: {
                        declarations: [
                            { filePath: "scripts/target.gml", location: { end: { index: 15 }, start: { index: 0 } } }
                        ],
                        identifierId: "gml/function/target",
                        name: "target",
                        scopeId: "function:target"
                    }
                },
                scripts: {
                    targetScript: {
                        declarations: [
                            { filePath: "scripts/target.gml", location: { end: { index: 15 }, start: { index: 0 } } }
                        ],
                        identifierId: "gml/script/target",
                        name: "target",
                        scopeId: "script:target"
                    }
                }
            },
            relationships: {
                scriptCalls: [
                    {
                        from: { filePath: "scripts/caller.gml", scopeId: "script:caller" },
                        isResolved: true,
                        location: { end: { index: 14 }, start: { index: 8 } },
                        target: { name: "target", scopeId: "script:target" }
                    }
                ]
            }
        },
        "full",
        "scope-bound" as SemanticSnapshot["sourceRevision"]
    );

    assert.deepEqual(
        snapshot.occurrences.filter((occurrence) => occurrence.role === "reference"),
        [
            {
                end: 15,
                filePath: "scripts/caller.gml",
                resolution: { kind: "exact" as const },
                role: "reference",
                scopeId: "script:caller",
                start: 8,
                symbolId: "gml/script/target"
            }
        ]
    );
});

void test("project navigation prioritizes structs and functions over script resources", () => {
    const index = createProjectNavigationIndex({
        projectRoot: "/tmp/game",
        identifiers: {
            scripts: {
                ActorSoundManager: {
                    identifierId: "script:scope:script:ActorSoundManager",
                    name: "ActorSoundManager",
                    displayName: "ActorSoundManager",
                    declarations: [
                        {
                            filePath: "scripts/ActorSoundManager.gml",
                            start: { index: 9 },
                            end: { index: 26 },
                            scopeId: "scope:script:ActorSoundManager"
                        }
                    ]
                }
            },
            structs: {
                ActorSoundManager: {
                    identifierId: "struct:ActorSoundManager",
                    name: "ActorSoundManager",
                    displayName: "ActorSoundManager",
                    declarations: [
                        {
                            filePath: "scripts/ActorSoundManager.gml",
                            start: { index: 9 },
                            end: { index: 26 },
                            scopeId: "scope:script:ActorSoundManager"
                        }
                    ]
                }
            }
        }
    });

    // 1. resolveNavigationSymbolId should return the struct instead of the script
    const symbolId = resolveNavigationSymbolId(index, "ActorSoundManager");
    assert.equal(symbolId, "struct:ActorSoundManager");

    // 2. findNavigationSymbolAtPosition should return the struct occurrence instead of the script occurrence
    const occurrence = findNavigationSymbolAtPosition(index, "/tmp/game/scripts/ActorSoundManager.gml", 12);
    assert.equal(occurrence?.symbolId, "struct:ActorSoundManager");
    assert.equal(occurrence?.kind, "struct");
});
