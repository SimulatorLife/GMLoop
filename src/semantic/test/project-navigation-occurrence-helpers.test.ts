import assert from "node:assert/strict";
import test from "node:test";

import {
    createProjectNavigationIndex,
    occurrenceCoversOffset,
    occurrenceEndOffset,
    occurrenceFilePath,
    occurrenceRangeLength,
    occurrenceStartOffset
} from "../src/navigation/index.js";
import type { GmlNavigationOccurrence, GmlProjectNavigationIndex } from "../src/navigation/project-navigation.js";

function createTargetScriptIndex(): GmlProjectNavigationIndex {
    return createProjectNavigationIndex({
        projectRoot: "/tmp/game",
        identifiers: {
            scripts: {
                "scope:script:target": {
                    identifierId: "script:scope:script:target",
                    name: "target",
                    displayName: "target",
                    declarations: [
                        {
                            filePath: "scripts/target.gml",
                            start: { index: 9 },
                            end: { index: 14 },
                            scopeId: "scope:script:target"
                        }
                    ]
                }
            }
        }
    });
}

function firstOccurrence(index: GmlProjectNavigationIndex): GmlNavigationOccurrence {
    const occurrences = index.occurrencesByFilePath.get("/tmp/game/scripts/target.gml");
    assert.ok(occurrences, "expected occurrences to be indexed for the target file");
    const [first] = occurrences;
    assert.ok(first, "expected at least one indexed occurrence");
    return first;
}

void test("occurrence file path helper returns the indexed occurrence's location", () => {
    const index = createTargetScriptIndex();
    assert.equal(occurrenceFilePath(firstOccurrence(index)), "/tmp/game/scripts/target.gml");
});

void test("occurrence start and end offset helpers expose the inclusive range boundary", () => {
    const index = createTargetScriptIndex();
    const occurrence = firstOccurrence(index);
    assert.equal(occurrenceStartOffset(occurrence), 9);
    assert.equal(occurrenceEndOffset(occurrence), 15, "the indexed range is exclusive of the end offset");
});

void test("occurrence range length helper returns the inclusive width of the indexed range", () => {
    const index = createTargetScriptIndex();
    assert.equal(occurrenceRangeLength(firstOccurrence(index)), 6);
});

void test("occurrence covers offset helper matches the inclusive start and exclusive end semantics", () => {
    const index = createTargetScriptIndex();
    const occurrence = firstOccurrence(index);
    assert.equal(occurrenceCoversOffset(occurrence, 9), true, "offsets at the inclusive start are covered");
    assert.equal(occurrenceCoversOffset(occurrence, 12), true, "offsets inside the range are covered");
    assert.equal(occurrenceCoversOffset(occurrence, 15), false, "the exclusive end offset is not covered");
    assert.equal(occurrenceCoversOffset(occurrence, 0), false, "offsets before the range are not covered");
});
