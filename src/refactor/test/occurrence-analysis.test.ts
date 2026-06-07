/**
 * Tests for occurrence analysis utilities.
 */

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    classifyOccurrences,
    countAffectedFiles,
    filterOccurrencesByKind,
    findOccurrencesInFile,
    groupOccurrencesByFile
} from "../src/occurrence-analysis.js";
import { OccurrenceKind, type SymbolOccurrence } from "../src/types.js";

void describe("classifyOccurrences", () => {
    void it("classifies empty array", () => {
        const result = classifyOccurrences([]);
        assert.equal(result.total, 0);
        assert.equal(result.definitions, 0);
        assert.equal(result.references, 0);
        assert.equal(result.byFile.size, 0);
        assert.equal(result.byKind.size, 0);
    });

    void it("classifies single definition", () => {
        const occurrences: Array<SymbolOccurrence> = [
            {
                path: "scripts/player.gml",
                start: 0,
                end: 10,
                kind: OccurrenceKind.DEFINITION
            }
        ];

        const result = classifyOccurrences(occurrences);
        assert.equal(result.total, 1);
        assert.equal(result.definitions, 1);
        assert.equal(result.references, 0);
        assert.equal(result.byFile.size, 1);
        assert.equal(result.byFile.get("scripts/player.gml"), 1);
        assert.equal(result.byKind.get(OccurrenceKind.DEFINITION), 1);
    });

    void it("classifies single reference", () => {
        const occurrences: Array<SymbolOccurrence> = [
            {
                path: "scripts/enemy.gml",
                start: 50,
                end: 60,
                kind: OccurrenceKind.REFERENCE
            }
        ];

        const result = classifyOccurrences(occurrences);
        assert.equal(result.total, 1);
        assert.equal(result.definitions, 0);
        assert.equal(result.references, 1);
        assert.equal(result.byKind.get(OccurrenceKind.REFERENCE), 1);
    });

    void it("classifies mixed occurrences", () => {
        const occurrences: Array<SymbolOccurrence> = [
            {
                path: "scripts/player.gml",
                start: 0,
                end: 10,
                kind: OccurrenceKind.DEFINITION
            },
            {
                path: "scripts/player.gml",
                start: 100,
                end: 110,
                kind: OccurrenceKind.REFERENCE
            },
            {
                path: "scripts/enemy.gml",
                start: 50,
                end: 60,
                kind: OccurrenceKind.REFERENCE
            }
        ];

        const result = classifyOccurrences(occurrences);
        assert.equal(result.total, 3);
        assert.equal(result.definitions, 1);
        assert.equal(result.references, 2);
        assert.equal(result.byFile.size, 2);
        assert.equal(result.byFile.get("scripts/player.gml"), 2);
        assert.equal(result.byFile.get("scripts/enemy.gml"), 1);
    });

    void it("handles occurrences without kind", () => {
        const occurrences: Array<SymbolOccurrence> = [
            {
                path: "scripts/test.gml",
                start: 0,
                end: 10
            }
        ];

        const result = classifyOccurrences(occurrences);
        assert.equal(result.total, 1);
        assert.equal(result.definitions, 0);
        assert.equal(result.references, 0);
        assert.equal(result.byKind.get("unknown"), 1);
    });

    void it("handles occurrences without path", () => {
        const occurrences: Array<SymbolOccurrence> = [
            {
                path: "",
                start: 0,
                end: 10,
                kind: OccurrenceKind.REFERENCE
            }
        ];

        const result = classifyOccurrences(occurrences);
        assert.equal(result.total, 1);
        assert.equal(result.references, 1);
        // Empty paths are now skipped, so byFile should be empty
        assert.equal(result.byFile.size, 0);
    });

    void it("throws on invalid input type", () => {
        assert.throws(() => classifyOccurrences(null), {
            name: "TypeError",
            message: /requires an array/
        });

        assert.throws(() => classifyOccurrences("not an array" as unknown as Array<SymbolOccurrence>), {
            name: "TypeError",
            message: /requires an array/
        });
    });

    void it("handles malformed occurrence objects", () => {
        const occurrences = [
            null,
            undefined,
            { path: "scripts/test.gml", start: 0, end: 10, kind: OccurrenceKind.DEFINITION }
        ] as unknown as Array<SymbolOccurrence>;

        const result = classifyOccurrences(occurrences);
        assert.equal(result.total, 3);
        assert.equal(result.definitions, 1);
    });
});

void describe("filterOccurrencesByKind", () => {
    const occurrences: Array<SymbolOccurrence> = [
        { path: "a.gml", start: 0, end: 10, kind: OccurrenceKind.DEFINITION },
        { path: "b.gml", start: 0, end: 10, kind: OccurrenceKind.REFERENCE },
        { path: "c.gml", start: 0, end: 10, kind: OccurrenceKind.REFERENCE }
    ];

    void it("filters by single kind", () => {
        const definitions = filterOccurrencesByKind(occurrences, [OccurrenceKind.DEFINITION]);
        assert.equal(definitions.length, 1);
        assert.equal(definitions[0].kind, OccurrenceKind.DEFINITION);
    });

    void it("filters by multiple kinds", () => {
        const refs = filterOccurrencesByKind(occurrences, [OccurrenceKind.REFERENCE]);
        assert.equal(refs.length, 2);
    });

    void it("returns empty array for no matches", () => {
        const result = filterOccurrencesByKind(occurrences, ["nonexistent"]);
        assert.equal(result.length, 0);
    });

    void it("handles empty kinds array", () => {
        const result = filterOccurrencesByKind(occurrences, []);
        assert.equal(result.length, 0);
    });

    void it("handles empty occurrences array", () => {
        const result = filterOccurrencesByKind([], [OccurrenceKind.DEFINITION]);
        assert.equal(result.length, 0);
    });

    void it("validates input types", () => {
        assert.throws(() => filterOccurrencesByKind(null, [OccurrenceKind.DEFINITION]), {
            name: "TypeError",
            message: /requires an array of occurrences/
        });

        assert.throws(() => filterOccurrencesByKind(occurrences, "not an array" as unknown as Array<string>), {
            name: "TypeError",
            message: /requires an array of kinds/
        });
    });

    void it("handles occurrences without kind field", () => {
        const mixed: Array<SymbolOccurrence> = [
            { path: "a.gml", start: 0, end: 10, kind: OccurrenceKind.DEFINITION },
            { path: "b.gml", start: 0, end: 10 }
        ];

        const result = filterOccurrencesByKind(mixed, ["unknown"]);
        assert.equal(result.length, 1);
    });
});

void describe("groupOccurrencesByFile", () => {
    void it("groups occurrences by file path", () => {
        const occurrences: Array<SymbolOccurrence> = [
            { path: "a.gml", start: 0, end: 10, kind: OccurrenceKind.DEFINITION },
            { path: "a.gml", start: 20, end: 30, kind: OccurrenceKind.REFERENCE },
            { path: "b.gml", start: 0, end: 10, kind: OccurrenceKind.REFERENCE }
        ];

        const grouped = groupOccurrencesByFile(occurrences);
        assert.equal(grouped.size, 2);
        assert.equal(grouped.get("a.gml")?.length, 2);
        assert.equal(grouped.get("b.gml")?.length, 1);
    });

    void it("handles empty array", () => {
        const grouped = groupOccurrencesByFile([]);
        assert.equal(grouped.size, 0);
    });

    void it("handles single file", () => {
        const occurrences: Array<SymbolOccurrence> = [
            { path: "test.gml", start: 0, end: 10, kind: OccurrenceKind.DEFINITION },
            { path: "test.gml", start: 20, end: 30, kind: OccurrenceKind.REFERENCE }
        ];

        const grouped = groupOccurrencesByFile(occurrences);
        assert.equal(grouped.size, 1);
        assert.equal(grouped.get("test.gml")?.length, 2);
    });

    void it("validates input type", () => {
        assert.throws(() => groupOccurrencesByFile(null), {
            name: "TypeError",
            message: /requires an array/
        });
    });

    void it("handles occurrences without path", () => {
        const occurrences = [
            { path: "", start: 0, end: 10, kind: OccurrenceKind.DEFINITION }
        ] as unknown as Array<SymbolOccurrence>;

        const grouped = groupOccurrencesByFile(occurrences);
        // Empty paths are now skipped
        assert.equal(grouped.size, 0);
    });

    void it("handles malformed occurrences", () => {
        const occurrences = [
            null,
            { path: "a.gml", start: 0, end: 10, kind: OccurrenceKind.DEFINITION },
            undefined
        ] as unknown as Array<SymbolOccurrence>;

        const grouped = groupOccurrencesByFile(occurrences);
        assert.equal(grouped.size, 1);
        assert.equal(grouped.get("a.gml")?.length, 1);
    });
});

void describe("findOccurrencesInFile", () => {
    const occurrences: Array<SymbolOccurrence> = [
        { path: "scripts/player.gml", start: 0, end: 10, kind: OccurrenceKind.DEFINITION },
        { path: "scripts/player.gml", start: 20, end: 30, kind: OccurrenceKind.REFERENCE },
        { path: "scripts/enemy.gml", start: 0, end: 10, kind: OccurrenceKind.REFERENCE }
    ];

    void it("finds occurrences in specific file", () => {
        const result = findOccurrencesInFile(occurrences, "scripts/player.gml");
        assert.equal(result.length, 2);
        assert.ok(result.every((occ) => occ.path === "scripts/player.gml"));
    });

    void it("returns empty array for file with no occurrences", () => {
        const result = findOccurrencesInFile(occurrences, "scripts/boss.gml");
        assert.equal(result.length, 0);
    });

    void it("handles empty occurrences array", () => {
        const result = findOccurrencesInFile([], "scripts/player.gml");
        assert.equal(result.length, 0);
    });

    void it("validates input types", () => {
        assert.throws(() => findOccurrencesInFile(null, "test.gml"), {
            name: "TypeError",
            message: /requires an array of occurrences/
        });

        assert.throws(() => findOccurrencesInFile(occurrences, ""), {
            name: "TypeError",
            message: /requires a non-empty file path string/
        });

        assert.throws(() => findOccurrencesInFile(occurrences, null), {
            name: "TypeError",
            message: /requires a non-empty file path string/
        });
    });

    void it("performs exact path matching", () => {
        const result = findOccurrencesInFile(occurrences, "scripts/player.gm");
        assert.equal(result.length, 0);
    });
});

void describe("countAffectedFiles", () => {
    void it("counts unique files", () => {
        const occurrences: Array<SymbolOccurrence> = [
            {
                path: "scripts/player.gml",
                start: 0,
                end: 10,
                kind: OccurrenceKind.DEFINITION
            },
            {
                path: "scripts/player.gml",
                start: 20,
                end: 30,
                kind: OccurrenceKind.REFERENCE
            },
            { path: "scripts/enemy.gml", start: 0, end: 10, kind: OccurrenceKind.REFERENCE }
        ];

        const count = countAffectedFiles(occurrences);
        assert.equal(count, 2);
    });

    void it("returns 0 for empty array", () => {
        const count = countAffectedFiles([]);
        assert.equal(count, 0);
    });

    void it("returns 1 for single file", () => {
        const occurrences: Array<SymbolOccurrence> = [
            { path: "test.gml", start: 0, end: 10, kind: OccurrenceKind.DEFINITION },
            { path: "test.gml", start: 20, end: 30, kind: OccurrenceKind.REFERENCE }
        ];

        const count = countAffectedFiles(occurrences);
        assert.equal(count, 1);
    });

    void it("validates input type", () => {
        assert.throws(() => countAffectedFiles(null), {
            name: "TypeError",
            message: /requires an array/
        });
    });

    void it("handles occurrences without path field", () => {
        const occurrences = [
            { path: "a.gml", start: 0, end: 10, kind: OccurrenceKind.DEFINITION },
            { start: 0, end: 10, kind: OccurrenceKind.REFERENCE }
        ] as unknown as Array<SymbolOccurrence>;

        const count = countAffectedFiles(occurrences);
        assert.equal(count, 1);
    });

    void it("handles malformed occurrences", () => {
        const occurrences = [
            null,
            { path: "a.gml", start: 0, end: 10, kind: OccurrenceKind.DEFINITION },
            undefined,
            { path: "b.gml", start: 0, end: 10, kind: OccurrenceKind.DEFINITION }
        ] as unknown as Array<SymbolOccurrence>;

        const count = countAffectedFiles(occurrences);
        assert.equal(count, 2);
    });

    void it("skips empty paths", () => {
        const occurrences = [
            { path: "", start: 0, end: 10, kind: OccurrenceKind.DEFINITION },
            { path: "a.gml", start: 0, end: 10, kind: OccurrenceKind.DEFINITION }
        ] as unknown as Array<SymbolOccurrence>;

        const count = countAffectedFiles(occurrences);
        // Empty paths are now skipped, so count should be 1
        assert.equal(count, 1);
    });
});
