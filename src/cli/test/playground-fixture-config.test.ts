import assert from "node:assert/strict";
import { test } from "node:test";

import { __graphCommandTest__ } from "../src/commands/graph/index.js";

const { parsePlaygroundFixtureConfig } = __graphCommandTest__;

const SOURCE_PATH = "/projects/example/src/format/test/fixtures/sample/gmloop.json";

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

void test("parsePlaygroundFixtureConfig accepts a well-formed object payload", () => {
    // Happy path: every documented field is present and well-typed, so the
    // parser must round-trip the payload unchanged. The result is frozen so
    // downstream consumers can rely on referential integrity.
    const source = JSON.stringify({
        formatOptions: { tabWidth: 4, useTabs: false },
        lintRuleset: "recommended"
    });

    const config = parsePlaygroundFixtureConfig(source, SOURCE_PATH);

    assert.deepEqual(config, { formatOptions: { tabWidth: 4, useTabs: false }, lintRuleset: "recommended" });
    assert.ok(Object.isFrozen(config), "result must be frozen to discourage downstream mutation");
});

void test("parsePlaygroundFixtureConfig accepts an empty object payload", () => {
    // An empty fixture config is a legitimate value for fixtures that exercise
    // only the defaults. The helper must accept it without flagging it as a
    // schema violation so existing fixtures do not regress.
    const config = parsePlaygroundFixtureConfig("{}", SOURCE_PATH);

    assert.deepEqual(config, {});
});

void test("parsePlaygroundFixtureConfig surfaces a TypeError for malformed JSON", () => {
    // Regression: the previous implementation let the raw `SyntaxError`
    // from `JSON.parse` escape through, surfacing an opaque "Unexpected
    // token" message that did not name the offending file. The hardening
    // wraps the parse in a structured guard so the CLI can render a
    // self-documenting failure and the playground discovery path can
    // recover by skipping just the malformed fixture.
    const malformed = '{ "formatOptions": { "tabWidth":';

    assert.throws(
        () => parsePlaygroundFixtureConfig(malformed, SOURCE_PATH),
        (error: unknown) => {
            assert.ok(error instanceof TypeError, `expected TypeError, received ${describeError(error)}`);
            assert.match(error.message, /not valid JSON/u, "error message must describe the failure");
            assert.ok(error.message.includes(SOURCE_PATH), "error message must include the source path");
            assert.ok(
                error.cause !== undefined,
                "error must attach the original SyntaxError via `cause` for diagnostics"
            );
            return true;
        }
    );

    // A truncated JSON payload (no closing brace) must follow the same
    // hardened path rather than leaking a bare parse error.
    assert.throws(
        () => parsePlaygroundFixtureConfig('{"formatOptions":', SOURCE_PATH),
        (error: unknown) => {
            assert.ok(error instanceof TypeError, `expected TypeError, received ${describeError(error)}`);
            assert.match(error.message, /not valid JSON/u);
            return true;
        }
    );
});

void test("parsePlaygroundFixtureConfig rejects a top-level null payload", () => {
    // Regression: `JSON.parse("null")` succeeds and yields `null`, which
    // the previous `as Record<string, unknown>` cast silently accepted.
    // Downstream code that reads `config.refactor` then crashed with a
    // TypeError far from the original bad payload. The hardening rejects
    // this case up front so the failure surfaces at the parse boundary.
    assert.throws(
        () => parsePlaygroundFixtureConfig("null", SOURCE_PATH),
        (error: unknown) => {
            assert.ok(error instanceof TypeError, `expected TypeError, received ${describeError(error)}`);
            assert.match(error.message, /must be a JSON object/u);
            assert.match(error.message, /received null/u, "error message must describe the actual kind");
            assert.ok(error.message.includes(SOURCE_PATH), "error message must include the source path");
            return true;
        }
    );
});

void test("parsePlaygroundFixtureConfig rejects a top-level array payload", () => {
    // Arrays pass the `typeof === "object"` and non-null checks but still
    // expose only numeric keys, which the playground codemod path would
    // crash on when destructuring named properties. The guard catches this
    // explicitly so the user gets a precise diagnosis instead of a stack
    // trace originating inside the refactor engine.
    const arraySource = JSON.stringify([{ refactor: true }, { refactor: false }]);

    assert.throws(
        () => parsePlaygroundFixtureConfig(arraySource, SOURCE_PATH),
        (error: unknown) => {
            assert.ok(error instanceof TypeError, `expected TypeError, received ${describeError(error)}`);
            assert.match(error.message, /must be a JSON object/u);
            assert.match(error.message, /received array/u, "error message must describe the actual kind");
            return true;
        }
    );
});

void test("parsePlaygroundFixtureConfig rejects a top-level primitive payload", () => {
    // Bare primitives parse successfully and would have been silently
    // cast to a record by the previous implementation. Each variant is
    // covered so the failure mode is consistent regardless of which
    // accidental literal the user typed into the file.
    const primitiveCases: ReadonlyArray<{ description: string; source: string }> = [
        { description: "string", source: '"just a string"' },
        { description: "number", source: "42" },
        { description: "boolean", source: "true" }
    ];

    for (const { description, source } of primitiveCases) {
        assert.throws(
            () => parsePlaygroundFixtureConfig(source, SOURCE_PATH),
            (error: unknown) => {
                assert.ok(
                    error instanceof TypeError,
                    `${description}: expected TypeError, received ${describeError(error)}`
                );
                assert.match(error.message, /must be a JSON object/u);
                assert.match(error.message, new RegExp(`received ${description}`, "u"));
                return true;
            },
            `${description} payload must be rejected`
        );
    }
});

void test("parsePlaygroundFixtureConfig rejects an empty payload", () => {
    // An empty string is a common copy/paste mistake and would previously
    // surface as a bare `SyntaxError: Unexpected end of JSON input`. The
    // hardening routes it through the same self-documenting guard.
    assert.throws(
        () => parsePlaygroundFixtureConfig("", SOURCE_PATH),
        (error: unknown) => {
            assert.ok(error instanceof TypeError, `expected TypeError, received ${describeError(error)}`);
            assert.match(error.message, /not valid JSON/u);
            assert.ok(error.message.includes(SOURCE_PATH), "error message must include the source path");
            return true;
        }
    );
});

void test("parsePlaygroundFixtureConfig returns a shallow clone that callers can safely use", () => {
    // The frozen returned object must not share identity with the parsed
    // payload, so downstream mutations on the typed view cannot leak back
    // into the helper's return value. Equality of value (not reference)
    // is the contract callers rely on.
    const source = JSON.stringify({ a: 1, nested: { b: 2 } });
    const first = parsePlaygroundFixtureConfig(source, SOURCE_PATH);
    const second = parsePlaygroundFixtureConfig(source, SOURCE_PATH);

    assert.notEqual(first, second, "each invocation must return a distinct frozen object");
    assert.deepEqual(first, second, "values must be deeply equal across invocations");
    assert.deepEqual(first, { a: 1, nested: { b: 2 } });
});
