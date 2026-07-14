import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRunnerArgsInput } from "../src/commands/runner.js";

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

void test("parseRunnerArgsInput returns an empty array for whitespace-only input", () => {
    // Regression: empty/whitespace input must not surface `undefined` to the
    // runtime runner controller and must not crash `JSON.parse` with an
    // opaque "Unexpected end of JSON input" error.
    assert.deepEqual(parseRunnerArgsInput(""), []);
    assert.deepEqual(parseRunnerArgsInput("   "), []);
    assert.deepEqual(parseRunnerArgsInput("\n\t  \n"), []);
});

void test("parseRunnerArgsInput splits whitespace-delimited arguments", () => {
    // The non-JSON branch must drop runs of whitespace and discard empty
    // entries produced by leading/trailing whitespace, mirroring the
    // `child_process.spawn` argv contract.
    assert.deepEqual(parseRunnerArgsInput("--inspect=9229 --watch"), ["--inspect=9229", "--watch"]);
    assert.deepEqual(parseRunnerArgsInput("  -e   print(1)  "), ["-e", "print(1)"]);
    assert.deepEqual(parseRunnerArgsInput("\tflag\n"), ["flag"]);
});

void test("parseRunnerArgsInput accepts a JSON array of strings", () => {
    // Happy path: a hand-curated JSON array is forwarded verbatim. This is
    // the shape used by the existing runner-command integration tests, so it
    // must continue to round-trip without any wrapping or sanitisation.
    assert.deepEqual(parseRunnerArgsInput('["-e","setInterval(() => {}, 1000)"]'), [
        "-e",
        "setInterval(() => {}, 1000)"
    ]);
    assert.deepEqual(parseRunnerArgsInput('["a", "b", "c"]'), ["a", "b", "c"]);
    assert.deepEqual(parseRunnerArgsInput("[]"), []);
});

void test("parseRunnerArgsInput surfaces a TypeError for malformed JSON", () => {
    // Regression: previously the raw `SyntaxError` from `JSON.parse` escaped
    // through, crashing the CLI with an opaque "Unexpected token" message
    // whenever a user supplied truncated or otherwise invalid JSON. The
    // hardened parser must catch the underlying syntax error and rethrow a
    // `TypeError` whose message names both the offending field and the
    // original input, so the failure mode is self-documenting.
    const malformed = "[1, 2,";
    assert.throws(
        () => parseRunnerArgsInput(malformed),
        (error: unknown) => {
            assert.ok(error instanceof TypeError, `expected TypeError, received ${describeError(error)}`);
            assert.match(
                error.message,
                /GMLOOP_RUNNER_ARGS JSON is malformed/u,
                "error message must name the offending field"
            );
            assert.ok(error.message.includes(malformed), "error message must include the offending payload");
            assert.ok(
                error.cause !== undefined,
                "error must attach the original SyntaxError via `cause` for diagnostics"
            );
            return true;
        }
    );

    // Standalone bracket without a closing bracket must also produce a
    // structured TypeError rather than an opaque SyntaxError.
    assert.throws(
        () => parseRunnerArgsInput("["),
        (error: unknown) => error instanceof TypeError && /GMLOOP_RUNNER_ARGS JSON is malformed/u.test(error.message)
    );

    // Garbage that happens to start with `[` must not slip through.
    assert.throws(
        () => parseRunnerArgsInput("[not-json"),
        (error: unknown) => error instanceof TypeError && /GMLOOP_RUNNER_ARGS JSON is malformed/u.test(error.message)
    );
});

void test("parseRunnerArgsInput leaves whitespace-delimited, non-bracketed JSON-like input untouched", () => {
    // The parser only treats `[`-prefixed input as JSON; anything else is
    // whitespace-split verbatim. This contract means primitive JSON values
    // (`null`, `"--inspect"`, `9229`, `true`) and JSON objects are passed
    // through unchanged rather than coerced into a runner argument list.
    // Hardening the parser must not silently flip that behaviour and start
    // swallowing shapes that were previously forwarded as-is.
    assert.deepEqual(parseRunnerArgsInput("null"), ["null"]);
    assert.deepEqual(parseRunnerArgsInput('"--inspect"'), ['"--inspect"']);
    assert.deepEqual(parseRunnerArgsInput("9229"), ["9229"]);
    assert.deepEqual(parseRunnerArgsInput("true"), ["true"]);
    assert.deepEqual(parseRunnerArgsInput('{"flag":"--inspect"}'), ['{"flag":"--inspect"}']);
});

void test("parseRunnerArgsInput rejects JSON arrays containing non-string entries", () => {
    // Mixed-shape arrays are a common mistake when callers paste a JSON
    // snippet that mixes primitives. The parser must surface the offending
    // index and the actual kind rather than silently coercing the entry.
    const cases: ReadonlyArray<Readonly<{ actual: string; index: number; input: string }>> = [
        { actual: "number", index: 1, input: '["--inspect", 9229]' },
        { actual: "boolean", index: 0, input: "[true]" },
        { actual: "null", index: 2, input: '["a", "b", null]' },
        { actual: "object", index: 0, input: '[{"flag":true}]' },
        { actual: "number", index: 2, input: '["a", "b", 3, 4]' }
    ];

    for (const { actual, index, input } of cases) {
        assert.throws(
            () => parseRunnerArgsInput(input),
            (error: unknown) => {
                assert.ok(
                    error instanceof TypeError,
                    `expected TypeError for ${input}, received ${describeError(error)}`
                );
                assert.match(
                    error.message,
                    new RegExp(`entry at index ${index} must be a string, received ${actual}`, "u"),
                    `error message must name the offending index (${index}) and kind (${actual}) for input ${input}`
                );
                return true;
            }
        );
    }
});

void test("parseRunnerArgsInput is pure and side-effect free", () => {
    // Calling the parser repeatedly with the same input must yield the same
    // observable output. This guards against accidental caching of the
    // parsed array (which would alias the caller's reference and let them
    // mutate downstream state).
    const input = '["--inspect=9229", "--watch"]';
    const first = parseRunnerArgsInput(input);
    const second = parseRunnerArgsInput(input);
    assert.deepEqual(first, ["--inspect=9229", "--watch"]);
    assert.deepEqual(second, first);
});
