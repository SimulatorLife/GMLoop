/**
 * Tests for the standalone helpers extracted from `commands/symbol.ts`:
 *
 * - {@link parseSymbolIncludeOption}: parses the comma-separated `--include`
 *   value into a normalised, read-only `Set<string>`.
 * - {@link narrowSymbolCandidatesByName}: narrows graph-search candidates
 *   to exact-name matches, falling back from case-sensitive to
 *   case-insensitive comparison.
 *
 * The helpers were lifted out of the `runSymbolInspectAction` orchestrator
 * so the command handler can read as a sequence of delegation steps at a
 * single abstraction layer. These tests pin down the contracts the
 * orchestrator relies on so future changes to either helper cannot
 * silently change inspect behaviour.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { narrowSymbolCandidatesByName, parseSymbolIncludeOption } from "../src/commands/symbol.js";

void describe("parseSymbolIncludeOption", () => {
    void it("returns an empty set when the raw value is undefined", () => {
        const result = parseSymbolIncludeOption(undefined);
        assert.ok(result instanceof Set, "Should always return a Set");
        assert.strictEqual(result.size, 0, "Undefined input should yield no tokens");
    });

    void it("returns an empty set when the raw value is an empty string", () => {
        const result = parseSymbolIncludeOption("");
        assert.strictEqual(result.size, 0, "Empty string should yield no tokens");
    });

    void it("splits comma-separated tokens and lower-cases each entry", () => {
        const result = parseSymbolIncludeOption("Node,CONTEXT,Neighbors");
        assert.deepEqual(
            [...result].sort(),
            ["context", "neighbors", "node"],
            "Should normalise tokens to lower case while preserving each unique token"
        );
    });

    void it("trims surrounding whitespace from each token", () => {
        const result = parseSymbolIncludeOption(" node ,  context  ,neighbors ");
        assert.deepEqual(
            [...result].sort(),
            ["context", "neighbors", "node"],
            "Whitespace around tokens should not leak into the parsed entries"
        );
    });

    void it("drops empty tokens produced by stray commas or whitespace", () => {
        const result = parseSymbolIncludeOption("node,,context , ,neighbors,");
        assert.deepEqual([...result].sort(), ["context", "neighbors", "node"], "Empty tokens should be filtered out");
    });

    void it("returns a read-only Set contract (no mutation methods exposed beyond Set)", () => {
        const result = parseSymbolIncludeOption("node,context");
        assert.ok(result instanceof Set, "Return type should be a Set");
        assert.strictEqual(result.size, 2, "Should contain exactly the two supplied tokens");
    });
});

void describe("narrowSymbolCandidatesByName", () => {
    type NamedCandidate = Readonly<{ id: string; name: string }>;

    const fixtureCandidates: ReadonlyArray<NamedCandidate> = [
        { id: "exact", name: "demo" },
        { id: "other", name: "other_script" },
        { id: "misspelt", name: "Demo" }
    ];

    void it("returns only exact case-sensitive matches when at least one exists", () => {
        const result = narrowSymbolCandidatesByName(fixtureCandidates, "demo");
        assert.deepEqual(
            result.map((candidate) => candidate.id),
            ["exact"],
            "Should return only the exact case-sensitive match"
        );
    });

    void it("falls back to case-insensitive matches when no case-sensitive match exists", () => {
        const result = narrowSymbolCandidatesByName([fixtureCandidates[1], fixtureCandidates[2]], "demo");
        assert.deepEqual(
            result.map((candidate) => candidate.id),
            ["misspelt"],
            "Should fall back to case-insensitive match when no case-sensitive match exists"
        );
    });

    void it("prefers case-sensitive matches over case-insensitive matches", () => {
        const result = narrowSymbolCandidatesByName(fixtureCandidates, "Demo");
        assert.deepEqual(
            result.map((candidate) => candidate.id),
            ["misspelt"],
            "Should prefer the exact case-sensitive match over the case-insensitive one"
        );
    });

    void it("returns the original list when no name matches in either pass", () => {
        const result = narrowSymbolCandidatesByName(fixtureCandidates, "no_such_name");
        assert.deepEqual(
            result.map((candidate) => candidate.id),
            ["exact", "other", "misspelt"],
            "Should return the original ordering when neither pass narrows the list"
        );
    });

    void it("preserves candidate order within the narrowed subset", () => {
        const orderedCandidates: ReadonlyArray<NamedCandidate> = [
            { id: "first", name: "demo" },
            { id: "second", name: "demo" }
        ];
        const result = narrowSymbolCandidatesByName(orderedCandidates, "demo");
        assert.deepEqual(
            result.map((candidate) => candidate.id),
            ["first", "second"],
            "Should retain the input ordering within the narrowed subset"
        );
    });

    void it("handles an empty candidate list without throwing", () => {
        const result = narrowSymbolCandidatesByName<NamedCandidate>([], "demo");
        assert.deepEqual(result, [], "Should return an empty list when given an empty candidate list");
    });
});
