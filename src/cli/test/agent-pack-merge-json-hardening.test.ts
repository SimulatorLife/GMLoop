import assert from "node:assert/strict";
import { test } from "node:test";

import { __agentPackTest__ } from "../src/modules/auto-game-agent-pack/project-agent-pack.js";

const { parseJsonObject } = __agentPackTest__;

const SOURCE_PATH = "/projects/example/.vscode/settings.json";

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

void test("parseJsonObject returns a plain object for well-formed JSON", () => {
    // Regression: the previous implementation returned the JSON-parsed
    // object via a shallow clone. The hardened variant delegates to
    // {@link Core.parseJsonObjectWithContext} which returns the same
    // parsed object reference. The contract that callers depend on is
    // the resulting shape, not the identity, so the round-trip property
    // must hold for any well-formed input.
    const source = JSON.stringify({ "editor.tabSize": 4, "files.autoSave": "afterDelay" });

    const parsed = parseJsonObject(source, SOURCE_PATH);

    assert.deepEqual(parsed, { "editor.tabSize": 4, "files.autoSave": "afterDelay" });
});

void test("parseJsonObject accepts an empty JSON object literal", () => {
    // Empty objects are a valid input — the merge routines treat absent
    // keys as "add", so an empty object must be tolerated to support the
    // first-run bootstrap path.
    const parsed = parseJsonObject("{}", SOURCE_PATH);

    assert.deepEqual(parsed, {});
});

void test("parseJsonObject surfaces a SyntaxError for malformed JSON with source context", () => {
    // Regression: the previous implementation let the raw `SyntaxError`
    // from `JSON.parse` escape through with no project context. The
    // hardened variant decorates the failure with the source path and
    // the document description so the CLI can render a self-documenting
    // diagnostic instead of an opaque "Unexpected token" message.
    const cases: ReadonlyArray<Readonly<{ reason: string; source: string }>> = [
        { reason: "truncated object", source: '{"editor.tabSize":' },
        { reason: "trailing garbage", source: '{"a":1} extra' },
        { reason: "missing closing brace", source: '{"a":1' },
        { reason: "bare identifier", source: "not json at all" },
        { reason: "empty input", source: "" }
    ];

    for (const { reason, source } of cases) {
        assert.throws(
            () => parseJsonObject(source, SOURCE_PATH),
            (error: unknown) => {
                assert.ok(
                    error instanceof SyntaxError,
                    `expected SyntaxError for ${reason}, received ${describeError(error)}`
                );
                assert.ok(
                    error.message.includes(SOURCE_PATH),
                    `error message must include the source path for ${reason}, received ${error.message}`
                );
                return true;
            }
        );
    }
});

void test("parseJsonObject preserves the underlying SyntaxError via cause", () => {
    // The hardened wrapper must surface the original parser failure
    // through `cause` so log scrubs and structured error reports can
    // surface the precise token-position detail that `JSON.parse` raised.
    let captured: unknown;
    try {
        parseJsonObject('{"editor.tabSize":', SOURCE_PATH);
    } catch (error) {
        captured = error;
    }

    assert.ok(captured instanceof Error, "parseJsonObject must raise an Error instance");
    assert.ok(captured.cause !== undefined, "cause must carry the underlying SyntaxError for diagnostics");
    if (captured.cause instanceof Error) {
        // The underlying cause is a JSON SyntaxError, so the name should
        // reflect the parser-detected failure ("SyntaxError" on Node's
        // modern V8 builds, and historically "JSON.parse" on older ones).
        assert.ok(
            captured.cause.name === "SyntaxError" || captured.cause.name === "JSON.parse",
            `expected SyntaxError or JSON.parse name on cause, received ${captured.cause.name}`
        );
    }
});

void test("parseJsonObject rejects top-level non-object payloads with a TypeError", () => {
    // Regression: the previous implementation raised a bare
    // `Expected a JSON object in <path>` error for any non-object
    // payload, which did not identify the actual kind. The hardened
    // variant surfaces a `TypeError` whose message includes both the
    // source path and the actual kind — matching the project's
    // `parsePackageJsonContents` convention so the diagnostics read
    // identically across modules.
    const cases: ReadonlyArray<Readonly<{ description: string; source: string }>> = [
        { description: "an array", source: '["editor.tabSize", 4]' },
        { description: "a number", source: "42" },
        { description: "a boolean", source: "true" },
        { description: "null", source: "null" },
        { description: "a string", source: '"editor.tabSize"' },
        { description: "an empty string", source: '""' }
    ];

    for (const { description, source } of cases) {
        assert.throws(
            () => parseJsonObject(source, SOURCE_PATH),
            (error: unknown) => {
                assert.ok(
                    error instanceof TypeError,
                    `expected TypeError for ${description}, received ${describeError(error)}`
                );
                assert.ok(
                    error.message.includes("must contain a JSON object"),
                    `error message must identify the object-shape branch for ${description}, received ${error.message}`
                );
                assert.ok(
                    error.message.includes(`Received ${description}`),
                    `error message must name the actual kind (${description}) for ${description}, received ${error.message}`
                );
                assert.ok(
                    error.message.includes(SOURCE_PATH),
                    `error message must include the source path for ${description}, received ${error.message}`
                );
                return true;
            }
        );
    }
});

void test("parseJsonObject lets the caller's try/catch downshift shape failures to a fallback", () => {
    // The merge routines wrap `parseJsonObject` in a `try`/`catch` that
    // downgrades any failure to a `"conflict"` disposition. That
    // contract must still hold after the hardening: callers can rely on
    // catching either the syntactic or the shape failure as a single
    // error channel without deciding which one fired.
    const cases: ReadonlyArray<Readonly<{ description: string; source: string }>> = [
        { description: "truncated JSON", source: '{"a":' },
        { description: "top-level array", source: "[]" },
        { description: "top-level number", source: "7" }
    ];

    for (const { description, source } of cases) {
        let captured: unknown;
        try {
            parseJsonObject(source, SOURCE_PATH);
        } catch (error) {
            captured = error;
        }

        assert.ok(captured instanceof Error, `expected Error for ${description}, received ${describeError(captured)}`);
        assert.ok(
            captured instanceof SyntaxError || captured instanceof TypeError,
            `expected SyntaxError or TypeError for ${description}, received ${describeError(captured)}`
        );
    }
});

void test("parseJsonObject is pure and does not mutate the input string", () => {
    // Defensive: the hardened parser must not rewrite the caller's
    // source string (e.g. by trimming it) so anyone reading the value
    // back through `readFile` later observes byte-for-byte identical
    // contents. Mirrors the purity test on `parseAgentPackReceipt`.
    const source = JSON.stringify({ "editor.tabSize": 4 });
    const snapshot = source.slice();

    parseJsonObject(source, SOURCE_PATH);
    parseJsonObject(source, SOURCE_PATH);

    assert.equal(source, snapshot, "input string must remain untouched across repeated calls");
});
