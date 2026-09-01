import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { __testCommandTestHelpers__ } from "../src/commands/test.js";

const { areTestCaseEntriesStructurallyEqual, findTestCaseEntryIndex, normalizeTestCaseEntry, upsertTestCaseEntry } =
    __testCommandTestHelpers__;

void describe("normalizeTestCaseEntry", () => {
    void it("omits the expected field when undefined", () => {
        const entry = normalizeTestCaseEntry({ expected: undefined, name: "case_a", target: "scr_demo" });
        assert.deepEqual({ ...entry }, { name: "case_a", target: "scr_demo" });
        assert.equal(Object.hasOwn(entry, "expected"), false);
    });

    void it("omits the expected field when it is an empty string", () => {
        const entry = normalizeTestCaseEntry({ expected: "", name: "case_a", target: "scr_demo" });
        assert.deepEqual({ ...entry }, { name: "case_a", target: "scr_demo" });
        assert.equal(Object.hasOwn(entry, "expected"), false);
    });

    void it("omits the expected field when it contains only whitespace", () => {
        const entry = normalizeTestCaseEntry({ expected: "   \t\n  ", name: "case_a", target: "scr_demo" });
        assert.deepEqual({ ...entry }, { name: "case_a", target: "scr_demo" });
        assert.equal(Object.hasOwn(entry, "expected"), false);
    });

    void it("trims surrounding whitespace from a non-empty expected value", () => {
        const entry = normalizeTestCaseEntry({
            expected: "  Enemy dies at zero HP  ",
            name: "case_a",
            target: "scr_demo"
        });
        assert.deepEqual(
            { ...entry },
            {
                expected: "Enemy dies at zero HP",
                name: "case_a",
                target: "scr_demo"
            }
        );
    });

    void it("returns a frozen entry object", () => {
        const entry = normalizeTestCaseEntry({ expected: undefined, name: "case_a", target: "scr_demo" });
        assert.equal(Object.isFrozen(entry), true);
    });
});

void describe("findTestCaseEntryIndex", () => {
    const manifest = {
        cases: [
            Object.freeze({ name: "case_a", target: "scr_demo" }),
            Object.freeze({ expected: "burns", name: "case_b", target: "scr_demo" }),
            Object.freeze({ name: "case_c", target: "scr_other" })
        ],
        version: "1" as const
    };

    void it("returns the matching index when the (target, name) pair exists", () => {
        assert.equal(findTestCaseEntryIndex(manifest, "scr_demo", "case_a"), 0);
        assert.equal(findTestCaseEntryIndex(manifest, "scr_demo", "case_b"), 1);
        assert.equal(findTestCaseEntryIndex(manifest, "scr_other", "case_c"), 2);
    });

    void it("returns -1 when the target matches but the name does not", () => {
        assert.equal(findTestCaseEntryIndex(manifest, "scr_demo", "missing"), -1);
    });

    void it("returns -1 when the name matches but the target does not", () => {
        assert.equal(findTestCaseEntryIndex(manifest, "scr_missing", "case_a"), -1);
    });

    void it("returns -1 when both fields differ", () => {
        assert.equal(findTestCaseEntryIndex(manifest, "scr_other", "missing"), -1);
    });

    void it("returns -1 when searching an empty manifest", () => {
        const emptyManifest = { cases: [], version: "1" as const };
        assert.equal(findTestCaseEntryIndex(emptyManifest, "scr_demo", "case_a"), -1);
    });
});

void describe("areTestCaseEntriesStructurallyEqual", () => {
    void it("returns true for entries produced by normalizeTestCaseEntry regardless of insertion order at the call site", () => {
        // Mirrors the canonical shape produced by `normalizeTestCaseEntry` for
        // a non-empty `expected`: the helper always emits properties in the
        // same `{ expected, name, target }` order, so two such entries compare
        // equal under the JSON-round-trip strategy the helper uses.
        const left = Object.freeze({ expected: "x", name: "a", target: "scr_demo" });
        const right = Object.freeze({ expected: "x", name: "a", target: "scr_demo" });
        assert.equal(areTestCaseEntriesStructurallyEqual(left, right), true);
    });

    void it("returns true when both entries omit the expected field identically", () => {
        const left = Object.freeze({ name: "a", target: "scr_demo" });
        const right = Object.freeze({ name: "a", target: "scr_demo" });
        assert.equal(areTestCaseEntriesStructurallyEqual(left, right), true);
    });

    void it("returns false when one entry has expected and the other does not", () => {
        const left = Object.freeze({ name: "a", target: "scr_demo" });
        const right = Object.freeze({ expected: "x", name: "a", target: "scr_demo" });
        assert.equal(areTestCaseEntriesStructurallyEqual(left, right), false);
    });

    void it("returns false when the target differs", () => {
        const left = Object.freeze({ name: "a", target: "scr_demo" });
        const right = Object.freeze({ name: "a", target: "scr_other" });
        assert.equal(areTestCaseEntriesStructurallyEqual(left, right), false);
    });

    void it("returns false when the name differs", () => {
        const left = Object.freeze({ name: "a", target: "scr_demo" });
        const right = Object.freeze({ name: "b", target: "scr_demo" });
        assert.equal(areTestCaseEntriesStructurallyEqual(left, right), false);
    });

    void it("returns false when the expected value differs", () => {
        const left = Object.freeze({ expected: "x", name: "a", target: "scr_demo" });
        const right = Object.freeze({ expected: "y", name: "a", target: "scr_demo" });
        assert.equal(areTestCaseEntriesStructurallyEqual(left, right), false);
    });
});

void describe("upsertTestCaseEntry", () => {
    const buildManifest = (cases: ReadonlyArray<{ expected?: string; name: string; target: string }>) =>
        Object.freeze({
            cases: Object.freeze(cases.map((entry) => Object.freeze(entry))),
            version: "1" as const
        });

    void it("appends a new entry and reports changed when the entry is missing", () => {
        const manifest = buildManifest([]);
        const entry = normalizeTestCaseEntry({ expected: undefined, name: "case_a", target: "scr_demo" });
        const result = upsertTestCaseEntry({ entry, manifest });
        assert.equal(result.changed, true);
        assert.equal(result.entry, entry);
        assert.deepEqual(result.manifest.cases, [entry]);
        // The original manifest must not be mutated.
        assert.equal(manifest.cases.length, 0);
    });

    void it("preserves the sorted order when adding a new entry", () => {
        const manifest = buildManifest([{ name: "zeta", target: "scr_z" }]);
        const entry = normalizeTestCaseEntry({ expected: undefined, name: "alpha", target: "scr_a" });
        const result = upsertTestCaseEntry({ entry, manifest });
        assert.equal(result.manifest.cases.length, 2);
        assert.equal(result.manifest.cases[0], entry);
    });

    void it("replaces an existing entry in place and reports changed when fields differ", () => {
        const manifest = buildManifest([{ name: "case_a", target: "scr_demo" }]);
        const entry = normalizeTestCaseEntry({
            expected: "new behaviour",
            name: "case_a",
            target: "scr_demo"
        });
        const result = upsertTestCaseEntry({ entry, manifest });
        assert.equal(result.changed, true);
        assert.equal(result.manifest.cases.length, 1);
        assert.equal(result.manifest.cases[0], entry);
    });

    void it("returns the unchanged manifest when the entry already matches structurally", () => {
        const manifest = buildManifest([{ expected: "behaves", name: "case_a", target: "scr_demo" }]);
        const entry = normalizeTestCaseEntry({ expected: "behaves", name: "case_a", target: "scr_demo" });
        const result = upsertTestCaseEntry({ entry, manifest });
        assert.equal(result.changed, false);
        assert.equal(result.manifest, manifest);
        // The pre-existing entry is what gets surfaced back to the caller so
        // downstream payloads report the manifest-authoritative value.
        assert.notEqual(result.entry, entry);
    });

    void it("does not mutate the original entries array when replacing", () => {
        const manifest = buildManifest([{ name: "case_a", target: "scr_demo" }]);
        const before = manifest.cases;
        const entry = normalizeTestCaseEntry({ expected: "x", name: "case_a", target: "scr_demo" });
        upsertTestCaseEntry({ entry, manifest });
        assert.equal(manifest.cases, before);
        assert.equal(manifest.cases.length, 1);
        assert.equal(Object.hasOwn(manifest.cases[0], "expected"), false);
    });

    void it("uses the (target, name) pair as the lookup key when the same name appears under different targets", () => {
        const manifest = buildManifest([
            { name: "case_a", target: "scr_demo" },
            { name: "case_a", target: "scr_other" }
        ]);
        const entry = normalizeTestCaseEntry({ expected: "replacement", name: "case_a", target: "scr_other" });
        const result = upsertTestCaseEntry({ entry, manifest });
        assert.equal(result.changed, true);
        assert.equal(result.manifest.cases.length, 2);
        assert.equal(result.manifest.cases[0], manifest.cases[0]);
        assert.equal(result.manifest.cases[1], entry);
    });
});
