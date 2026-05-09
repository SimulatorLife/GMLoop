import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import vm from "node:vm";

import { __test__ } from "../src/commands/generate-gml-identifiers.js";

const {
    applyFirstWin,
    mergeEntry,
    parseArrayLiteral,
    collectManualArrayIdentifiers,
    assertManualIdentifierArray,
    extractDeprecatedReplacementFromManualHtml,
    parseObsoleteIdentifierTableEntries
} = __test__;

const SAMPLE_SOURCE = `
const KEYWORDS = [
    "alpha",
    "beta"
];
`;

void describe("generate-gml-identifiers", () => {
    void describe("applyFirstWin", () => {
        void it("returns incoming when incoming is defined", () => {
            assert.equal(applyFirstWin("incoming", "current"), "incoming");
        });

        void it("falls back to current when incoming is undefined", () => {
            assert.equal(applyFirstWin(undefined, "current"), "current");
        });

        void it("returns undefined when both are undefined", () => {
            assert.equal(applyFirstWin(undefined, undefined), undefined);
        });

        void it("treats null as a nullish value that falls back to current", () => {
            assert.equal(applyFirstWin(null as unknown as string, "current"), "current");
        });

        void it("treats false as a defined value", () => {
            assert.equal(applyFirstWin(false as unknown as string, "current"), false);
        });
    });

    void describe("mergeEntry", () => {
        void it("creates a new entry when identifier is absent from map", () => {
            const map = new Map();
            mergeEntry(map, "foo", { type: "function", sources: ["manual:gml.js:KEYWORDS"] });
            const entry = map.get("foo");
            assert.ok(entry !== undefined);
            assert.equal(entry!.type, "function");
            assert.deepEqual([...entry!.sources], ["manual:gml.js:KEYWORDS"]);
            assert.equal(entry!.deprecated, false);
        });

        void it("sets deprecated to true when data.deprecated is true", () => {
            const map = new Map();
            mergeEntry(map, "foo", { type: "function", deprecated: true });
            const entry = map.get("foo")!;
            assert.equal(entry.deprecated, true);
        });

        void it("creates entry with empty sources Set when sources is empty array", () => {
            const map = new Map();
            mergeEntry(map, "foo", { type: "function", sources: [] });
            const entry = map.get("foo")!;
            assert.deepEqual([...entry.sources], []);
        });

        void it("creates entry with empty tags Set when tags is absent", () => {
            const map = new Map();
            mergeEntry(map, "foo", { type: "function" });
            const entry = map.get("foo")!;
            assert.deepEqual([...entry.tags], []);
        });

        void it("adds sources to existing entry", () => {
            const existingEntry = {
                type: "function",
                sources: new Set<string>(["source-a"]),
                tags: new Set<string>(),
                deprecated: false
            };
            const map = Object.freeze(new Map([["foo", existingEntry]]));
            mergeEntry(map, "foo", { sources: ["source-b"] });
            assert.deepEqual([...existingEntry.sources].sort(), ["source-a", "source-b"]);
        });

        void it("adds tags to existing entry", () => {
            const existingEntry = {
                type: "function",
                sources: new Set<string>(),
                tags: new Set<string>(["tag-a"]),
                deprecated: false
            };
            const map = Object.freeze(new Map([["foo", existingEntry]]));
            mergeEntry(map, "foo", { tags: ["tag-b"] });
            assert.deepEqual([...existingEntry.tags].sort(), ["tag-a", "tag-b"]);
        });

        void it("sets first-win field when current is absent", () => {
            const existingEntry = {
                type: "function",
                sources: new Set<string>(),
                tags: new Set<string>(),
                deprecated: false,
                manualPath: "test"
            };
            const map = Object.freeze(new Map([["foo", existingEntry]]));
            mergeEntry(map, "foo", { legacyCategory: "Obsolete Arrays" });
            assert.equal((existingEntry as { legacyCategory?: string }).legacyCategory, "Obsolete Arrays");
        });

        void it("ignores first-win field when current is already set and incoming is undefined", () => {
            const existingEntry = {
                type: "function",
                sources: new Set<string>(),
                tags: new Set<string>(),
                deprecated: false,
                legacyCategory: "Existing Category",
                manualPath: "test"
            };
            const map = Object.freeze(new Map([["foo", existingEntry]]));
            mergeEntry(map, "foo", {});
            assert.equal(existingEntry.legacyCategory, "Existing Category");
        });

        void it("accumulates deprecated: true without clobbering false", () => {
            const existingEntry = {
                type: "function",
                sources: new Set<string>(),
                tags: new Set<string>(),
                deprecated: false
            };
            const map = Object.freeze(new Map([["foo", existingEntry]]));
            mergeEntry(map, "foo", { deprecated: true });
            assert.equal(existingEntry.deprecated, true);
        });

        void it("does not reset deprecated: true when incoming deprecated is false", () => {
            const existingEntry = {
                type: "function",
                sources: new Set<string>(),
                tags: new Set<string>(),
                deprecated: true
            };
            const map = Object.freeze(new Map([["foo", existingEntry]]));
            mergeEntry(map, "foo", { deprecated: false });
            assert.equal(existingEntry.deprecated, true);
        });

        void it("upgrades replacement when incoming priority is higher", () => {
            const existingEntry = {
                type: "function",
                sources: new Set<string>(),
                tags: new Set<string>(),
                deprecated: false,
                replacement: undefined,
                replacementKind: "none" as const,
                manualPath: "test"
            };
            const map = Object.freeze(new Map([["foo", existingEntry]]));
            mergeEntry(map, "foo", {
                replacement: "new_func",
                replacementKind: "manual-migration"
            });
            assert.equal(existingEntry.replacement, "new_func");
            assert.equal(existingEntry.replacementKind, "manual-migration");
        });

        void it("upgrades replacementKind even when replacement is undefined but priority is higher", () => {
            const existingEntry = {
                type: "function",
                sources: new Set<string>(),
                tags: new Set<string>(),
                deprecated: false,
                replacement: undefined,
                replacementKind: "manual-migration" as const,
                manualPath: "test"
            };
            const map = Object.freeze(new Map([["foo", existingEntry]]));
            mergeEntry(map, "foo", {
                replacementKind: "direct-rename"
            });
            assert.equal(existingEntry.replacementKind, "direct-rename");
            assert.equal(existingEntry.replacement, undefined);
        });

        void it("does not downgrade replacement when incoming priority is lower", () => {
            const existingEntry = {
                type: "function",
                sources: new Set<string>(),
                tags: new Set<string>(),
                deprecated: false,
                replacement: "direct_replacement",
                replacementKind: "direct-rename" as const,
                manualPath: "test"
            };
            const map = Object.freeze(new Map([["foo", existingEntry]]));
            mergeEntry(map, "foo", {
                replacement: "less_preferred",
                replacementKind: "manual-migration"
            });
            assert.equal(existingEntry.replacement, "direct_replacement");
            assert.equal(existingEntry.replacementKind, "direct-rename");
        });

        void it("upgrades type when incoming priority is higher", () => {
            const existingEntry = {
                type: "literal",
                sources: new Set<string>(),
                tags: new Set<string>(),
                deprecated: false
            };
            const map = Object.freeze(new Map([["foo", existingEntry]]));
            mergeEntry(map, "foo", { type: "function" });
            assert.equal(existingEntry.type, "function");
        });

        void it("does not downgrade type when incoming priority is lower", () => {
            const existingEntry = {
                type: "function",
                sources: new Set<string>(),
                tags: new Set<string>(),
                deprecated: false
            };
            const map = Object.freeze(new Map([["foo", existingEntry]]));
            mergeEntry(map, "foo", { type: "literal" });
            assert.equal(existingEntry.type, "function");
        });

        void it("sets type to 'unknown' when neither incoming nor current has a defined type", () => {
            const existingEntry = {
                type: "unknown",
                sources: new Set<string>(),
                tags: new Set<string>(),
                deprecated: false
            };
            const map = Object.freeze(new Map([["foo", existingEntry]]));
            mergeEntry(map, "foo", { type: "unknown" });
            assert.equal(existingEntry.type, "unknown");
        });
    });

    void it("normalizes VM evaluation failures", () => {
        const thrown = Object.create(null);
        const restoreVm = mock.method(vm, "runInNewContext", () => {
            throw thrown;
        });

        try {
            assert.throws(
                () => parseArrayLiteral(SAMPLE_SOURCE, "KEYWORDS"),
                (error) => {
                    return (
                        error instanceof Error &&
                        error.message === "Failed to evaluate array literal for KEYWORDS: Unknown error" &&
                        error.cause === thrown
                    );
                }
            );
        } finally {
            restoreVm.mock.restore();
        }
    });

    void it("rejects manual identifier arrays that do not evaluate to arrays", () => {
        const identifierMap = new Map();

        assert.throws(
            () =>
                collectManualArrayIdentifiers(
                    identifierMap,
                    null,
                    { type: "keyword", source: "manual:gml.js:KEYWORDS" },
                    { identifier: "KEYWORDS" }
                ),
            (error) => {
                return (
                    error instanceof TypeError &&
                    /Manual identifier array 'manual:gml\.js:KEYWORDS' must evaluate to an array of strings\./.test(
                        error.message
                    ) &&
                    /Received null/.test(error.message)
                );
            }
        );

        assert.equal(identifierMap.size, 0);
    });

    void it("rejects manual identifier arrays containing non-string entries", () => {
        const identifierMap = new Map();

        assert.throws(
            () =>
                collectManualArrayIdentifiers(
                    identifierMap,
                    ["alpha", 5],
                    { type: "keyword", source: "manual:gml.js:KEYWORDS" },
                    { identifier: "KEYWORDS" }
                ),
            (error) => {
                return (
                    error instanceof TypeError &&
                    /Manual identifier array 'manual:gml\.js:KEYWORDS' must contain only strings\./.test(
                        error.message
                    ) &&
                    /Entry at index 1 was a number/.test(error.message)
                );
            }
        );

        assert.equal(identifierMap.size, 0);
    });

    void it("exposes assertManualIdentifierArray for tests", () => {
        const values = assertManualIdentifierArray(["alpha"], {
            identifier: "KEYWORDS",
            source: "manual:gml.js:KEYWORDS"
        });

        assert.deepEqual(values, ["alpha"]);
    });

    void it("extracts direct replacement metadata from deprecated manual pages", () => {
        const replacement = extractDeprecatedReplacementFromManualHtml(`
            <p class="note"><b>WARNING!</b> This function is deprecated (and replaced by
            <span class="inline"><a href="array_length.htm">array_length()</a></span>).</p>
        `);

        assert.deepEqual(replacement, {
            replacement: "array_length",
            replacementKind: "direct-rename"
        });
    });

    void it("parses obsolete identifier tables into normalized deprecated entries", () => {
        const entries = parseObsoleteIdentifierTableEntries(`
            <p><a class="dropspot" data-target="drop-down" href="#">Backgrounds</a></p>
            <div class="droptext" data-targetname="drop-down">
              <p class="dropspot">the following functions are obsolete:</p>
              <table>
                <tbody>
                  <tr>
                    <td>draw_background</td>
                    <td>room_set_<br />background_colour</td>
                  </tr>
                </tbody>
              </table>
              <p class="dropspot">background variables are no longer required:</p>
              <table>
                <tbody>
                  <tr>
                    <td>background_<br />index[0..7]</td>
                  </tr>
                </tbody>
              </table>
            </div>
        `);

        assert.deepEqual(entries, [
            {
                name: "draw_background",
                type: "function",
                legacyCategory: "Backgrounds",
                legacyUsage: "call"
            },
            {
                name: "room_set_background_colour",
                type: "function",
                legacyCategory: "Backgrounds",
                legacyUsage: "call"
            },
            {
                name: "background_index",
                type: "variable",
                legacyCategory: "Backgrounds",
                legacyUsage: "indexed-identifier"
            }
        ]);
    });
});
