import assert from "node:assert/strict";
import { test } from "node:test";

import { __agentPackTest__ } from "../src/modules/auto-game-agent-pack/project-agent-pack.js";

const { parseAgentPackReceipt } = __agentPackTest__;

const SOURCE_PATH = "/projects/example/.gmloop/agent-pack.json";

function describeError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }

    if (typeof error === "string") {
        return error;
    }

    if (error === null) {
        return "null";
    }

    if (error === undefined) {
        return "undefined";
    }

    return Object.getPrototypeOf(error)?.constructor?.name ?? typeof error;
}

function makeReceipt(overrides: Readonly<Record<string, unknown>> = {}): string {
    return JSON.stringify({
        conflicts: [],
        files: {},
        package: "@gmloop/agent-pack",
        version: "1.2.3",
        ...overrides
    });
}

void test("parseAgentPackReceipt accepts a well-formed receipt", () => {
    // Happy path: every documented field is present and well-typed, so the
    // parser must round-trip the receipt unchanged. The result is frozen so
    // downstream consumers can rely on referential integrity.
    const source = makeReceipt({
        conflicts: ["AGENTS.md", ".gitignore"],
        files: { ".agents/skills/foo/SKILL.md": "abc123" }
    });

    const receipt = parseAgentPackReceipt(source, SOURCE_PATH);

    assert.equal(receipt.package, "@gmloop/agent-pack");
    assert.equal(receipt.version, "1.2.3");
    assert.deepEqual(receipt.conflicts, [".gitignore", "AGENTS.md"]);
    assert.deepEqual(receipt.files, { ".agents/skills/foo/SKILL.md": "abc123" });
    assert.ok(Object.isFrozen(receipt));
});

void test("parseAgentPackReceipt tolerates absent optional fields", () => {
    // The conflicts and files fields are documented as optional by the
    // installer, which leaves them out on first-run receipts. The parser
    // must accept them as missing without rejecting the payload.
    const source = JSON.stringify({
        package: "@gmloop/agent-pack",
        version: "1.0.0"
    });

    const receipt = parseAgentPackReceipt(source, SOURCE_PATH);

    assert.deepEqual(receipt.conflicts, []);
    assert.deepEqual(receipt.files, {});
});

void test("parseAgentPackReceipt surfaces a TypeError for malformed JSON", () => {
    // Regression: the previous implementation let the raw `SyntaxError`
    // from `JSON.parse` escape through, surfacing an opaque "Unexpected
    // token" message that did not name the receipt or the offending
    // payload. The hardening wraps the parse in a structured guard so the
    // CLI can render a self-documenting failure.
    const malformed = '{ "package": "@gmloop/agent-pack", "version":';
    assert.throws(
        () => parseAgentPackReceipt(malformed, SOURCE_PATH),
        (error: unknown) => {
            assert.ok(error instanceof TypeError, `expected TypeError, received ${describeError(error)}`);
            assert.match(
                error.message,
                /@gmloop\/agent-pack receipt JSON is malformed/u,
                "error message must name the receipt"
            );
            assert.ok(error.message.includes(SOURCE_PATH), "error message must include the source path");
            assert.ok(
                error.cause !== undefined,
                "error must attach the original SyntaxError via `cause` for diagnostics"
            );
            return true;
        }
    );

    // Truncated JSON (no closing brace) must follow the same hardened path.
    assert.throws(
        () => parseAgentPackReceipt('{"package":"@gmloop/agent-pack"', SOURCE_PATH),
        (error: unknown) =>
            error instanceof TypeError && /@gmloop\/agent-pack receipt JSON is malformed/u.test(error.message)
    );

    // Garbage tokens that are not JSON must follow the same hardened path.
    assert.throws(
        () => parseAgentPackReceipt("not json at all", SOURCE_PATH),
        (error: unknown) =>
            error instanceof TypeError && /@gmloop\/agent-pack receipt JSON is malformed/u.test(error.message)
    );
});

void test("parseAgentPackReceipt rejects top-level non-object payloads", () => {
    // The receipt schema is documented as a JSON object, so primitives,
    // arrays, and `null` are all malformed and must surface a TypeError
    // that names the actual kind so callers can diagnose the corruption.
    const cases: ReadonlyArray<Readonly<{ expected: string; source: string }>> = [
        { expected: "null", source: "null" },
        { expected: "an array", source: "[]" },
        { expected: "an array", source: '["@gmloop/agent-pack", "1.0.0"]' },
        { expected: "string", source: '"@gmloop/agent-pack"' },
        { expected: "number", source: "42" },
        { expected: "boolean", source: "true" }
    ];

    for (const { expected, source } of cases) {
        assert.throws(
            () => parseAgentPackReceipt(source, SOURCE_PATH),
            (error: unknown) => {
                assert.ok(
                    error instanceof TypeError,
                    `expected TypeError for ${source}, received ${describeError(error)}`
                );
                assert.ok(
                    error.message.includes("must be a JSON object"),
                    `error message must identify the top-level branch for source ${source}`
                );
                assert.ok(
                    error.message.includes(`received ${expected}`),
                    `error message must name the actual kind (${expected}) for source ${source}`
                );
                assert.ok(error.message.includes(SOURCE_PATH), "error message must include the source path");
                return true;
            }
        );
    }
});

void test("parseAgentPackReceipt rejects an unexpected package discriminant", () => {
    // The package field is a string-typed discriminant; any value other
    // than "@gmloop/agent-pack" indicates the receipt was produced by a
    // different agent pack and must be rejected with a message that quotes
    // the offending value.
    const cases: ReadonlyArray<Readonly<{ actual: string; source: Record<string, unknown> }>> = [
        { actual: '"some-other-pack"', source: { package: "some-other-pack", version: "1.0.0" } },
        { actual: "null", source: { package: null, version: "1.0.0" } },
        { actual: "number", source: { package: 42, version: "1.0.0" } },
        { actual: "boolean", source: { package: true, version: "1.0.0" } },
        { actual: "undefined", source: { version: "1.0.0" } }
    ];

    for (const { actual, source } of cases) {
        assert.throws(
            () => parseAgentPackReceipt(JSON.stringify(source), SOURCE_PATH),
            (error: unknown) => {
                assert.ok(
                    error instanceof TypeError,
                    `expected TypeError for ${JSON.stringify(source)}, received ${describeError(error)}`
                );
                assert.ok(
                    error.message.includes("unexpected package"),
                    `error message must identify the package branch for source ${JSON.stringify(source)}`
                );
                assert.ok(
                    error.message.includes(actual),
                    `error message must include the actual package description (${actual}) for source ${JSON.stringify(source)}`
                );
                return true;
            }
        );
    }
});

void test("parseAgentPackReceipt rejects non-string and empty version fields", () => {
    // The version field is required and must be a non-empty string.
    const cases: ReadonlyArray<Readonly<{ actual: string; source: Record<string, unknown> }>> = [
        { actual: "null", source: { package: "@gmloop/agent-pack", version: null } },
        { actual: "number", source: { package: "@gmloop/agent-pack", version: 1 } },
        { actual: "boolean", source: { package: "@gmloop/agent-pack", version: true } },
        { actual: "object", source: { package: "@gmloop/agent-pack", version: {} } },
        { actual: "array", source: { package: "@gmloop/agent-pack", version: [] } },
        { actual: "undefined", source: { package: "@gmloop/agent-pack" } }
    ];

    for (const { actual, source } of cases) {
        assert.throws(
            () => parseAgentPackReceipt(JSON.stringify(source), SOURCE_PATH),
            (error: unknown) => {
                assert.ok(
                    error instanceof TypeError,
                    `expected TypeError for ${JSON.stringify(source)}, received ${describeError(error)}`
                );
                assert.match(
                    error.message,
                    /version must be a string/u,
                    `error message must identify the version field for source ${JSON.stringify(source)}`
                );
                assert.ok(error.message.includes(actual), `error message must include the actual kind (${actual})`);
                return true;
            }
        );
    }

    // Whitespace-only and empty strings must hit the dedicated
    // non-empty-string branch rather than the type branch.
    for (const emptyVersion of ["", "   ", "\n\t"]) {
        assert.throws(
            () =>
                parseAgentPackReceipt(
                    JSON.stringify({ package: "@gmloop/agent-pack", version: emptyVersion }),
                    SOURCE_PATH
                ),
            (error: unknown) => {
                assert.ok(error instanceof TypeError, `expected TypeError for version=${JSON.stringify(emptyVersion)}`);
                assert.match(
                    error.message,
                    /version must be a non-empty string/u,
                    "error message must call out the empty-version branch"
                );
                return true;
            }
        );
    }
});

void test("parseAgentPackReceipt rejects conflicts arrays with non-string entries", () => {
    // Conflicts is documented as a string array; any non-string entry —
    // including nested objects, numbers, booleans, and `null` — must be
    // rejected with a message that names the offending index and kind so
    // the user can locate the bad row.
    const cases: ReadonlyArray<Readonly<{ actual: string; index: number; source: unknown[] }>> = [
        { actual: "number", index: 1, source: ["AGENTS.md", 42] },
        { actual: "boolean", index: 0, source: [true] },
        { actual: "null", index: 2, source: ["AGENTS.md", ".gitignore", null] },
        { actual: "object", index: 0, source: [{ name: "AGENTS.md" }] }
    ];

    for (const { actual, index, source } of cases) {
        const payload = {
            conflicts: source,
            files: {},
            package: "@gmloop/agent-pack",
            version: "1.0.0"
        };
        assert.throws(
            () => parseAgentPackReceipt(JSON.stringify(payload), SOURCE_PATH),
            (error: unknown) => {
                assert.ok(error instanceof TypeError, `expected TypeError for conflicts=${JSON.stringify(source)}`);
                assert.match(
                    error.message,
                    new RegExp(`'conflicts' entry at index ${index} must be a string, received ${actual}`, "u"),
                    `error message must identify the offending index (${index}) and kind (${actual})`
                );
                return true;
            }
        );
    }

    // Non-array conflicts values must hit the dedicated type branch.
    assert.throws(
        () =>
            parseAgentPackReceipt(
                JSON.stringify({
                    conflicts: "AGENTS.md",
                    files: {},
                    package: "@gmloop/agent-pack",
                    version: "1.0.0"
                }),
                SOURCE_PATH
            ),
        (error: unknown) => {
            assert.ok(error instanceof TypeError, "expected TypeError for string conflicts");
            assert.match(error.message, /'conflicts' must be an array of strings/u);
            return true;
        }
    );
});

void test("parseAgentPackReceipt rejects files records with unsafe paths or non-string values", () => {
    // Files maps project-relative paths to source hashes; both halves must
    // be strings, and the key must be a safe project-relative path. Any
    // deviation must surface a TypeError that identifies the offending key
    // or value kind.
    const cases: ReadonlyArray<Readonly<{ reason: string; source: Record<string, unknown> }>> = [
        { reason: "value of kind number", source: { "scripts/foo.gml": 42 } },
        { reason: "value of kind null", source: { "scripts/foo.gml": null } },
        { reason: "value of kind boolean", source: { "scripts/foo.gml": true } },
        { reason: "value of kind object", source: { "scripts/foo.gml": { hash: "x" } } },
        { reason: 'unsafe path "../outside"', source: { "../outside": "abc" } },
        { reason: 'unsafe path "/absolute"', source: { "/absolute": "abc" } }
    ];

    for (const { reason, source } of cases) {
        const payload = { conflicts: [], files: source, package: "@gmloop/agent-pack", version: "1.0.0" };
        assert.throws(
            () => parseAgentPackReceipt(JSON.stringify(payload), SOURCE_PATH),
            (error: unknown) => {
                assert.ok(error instanceof TypeError, `expected TypeError for files=${JSON.stringify(source)}`);
                assert.ok(
                    error.message.includes("'files' is malformed"),
                    `error message must identify the files branch for source ${JSON.stringify(source)}`
                );
                assert.ok(
                    error.message.includes(reason),
                    `error message must include the reason (${reason}) for source ${JSON.stringify(source)}`
                );
                return true;
            }
        );
    }

    // Non-object files values must hit the dedicated type branch.
    assert.throws(
        () =>
            parseAgentPackReceipt(
                JSON.stringify({
                    conflicts: [],
                    files: ["scripts/foo.gml"],
                    package: "@gmloop/agent-pack",
                    version: "1.0.0"
                }),
                SOURCE_PATH
            ),
        (error: unknown) => {
            assert.ok(error instanceof TypeError, "expected TypeError for array files");
            assert.match(error.message, /'files' must be an object of string values/u);
            return true;
        }
    );
});

void test("parseAgentPackReceipt is pure and side-effect free", () => {
    // Calling the parser repeatedly with the same input must yield the
    // same observable output. This guards against accidental caching of
    // the parsed object (which would alias downstream mutations) or
    // mutation of the caller's source string during parsing.
    const source = makeReceipt({
        conflicts: ["AGENTS.md", ".gitignore"],
        files: { ".agents/skills/foo/SKILL.md": "abc123" }
    });
    const sourceSnapshot = source.slice();

    const first = parseAgentPackReceipt(source, SOURCE_PATH);
    const second = parseAgentPackReceipt(source, SOURCE_PATH);

    assert.deepEqual(first, second);
    assert.notEqual(first, second, "each parse call must return a fresh frozen object");
    assert.equal(source, sourceSnapshot, "input string must remain untouched");
});
