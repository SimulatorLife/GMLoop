import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractErrorMessage, isRecord, tryParseJsonPayload } from "../src/shared/error-guards.js";

void describe("tryParseJsonPayload", () => {
    void it("returns parsed object for valid JSON object payloads", () => {
        const parsed = tryParseJsonPayload('{"name":"gmloop","count":2}');

        assert.deepEqual(parsed, { name: "gmloop", count: 2 });
    });

    void it("returns null for empty input instead of legacy empty-object compatibility", () => {
        assert.equal(tryParseJsonPayload(""), null);
    });

    void it("returns null for malformed JSON", () => {
        assert.equal(tryParseJsonPayload("{"), null);
    });

    void it("returns null for valid non-object JSON payloads", () => {
        assert.equal(tryParseJsonPayload("[]"), null);
        assert.equal(tryParseJsonPayload("true"), null);
        assert.equal(tryParseJsonPayload("1"), null);
        assert.equal(tryParseJsonPayload('"text"'), null);
    });
});

void describe("isRecord", () => {
    void it("recognizes plain objects only", () => {
        assert.equal(isRecord({}), true);
        assert.equal(isRecord({ key: "value" }), true);
        assert.equal(isRecord([]), false);
        assert.equal(isRecord(null), false);
        assert.equal(isRecord("text"), false);
        assert.equal(isRecord(123), false);
    });

    void it("rejects undefined, booleans, bigints, symbols, and functions", () => {
        assert.equal(isRecord(undefined), false);
        assert.equal(isRecord(true), false);
        assert.equal(isRecord(false), false);
        assert.equal(isRecord(0n), false);
        assert.equal(isRecord(Symbol("s")), false);
        assert.equal(
            isRecord(() => {}),
            false
        );
    });

    void it("accepts null-prototype and class instances", () => {
        // The shared `Core.isPlainObject` predicate accepts null-prototype
        // objects and class instances, matching the historical bespoke
        // implementation. The type predicate still narrows to
        // `Record<string, unknown>` so downstream property access is
        // permitted.
        const nullPrototype = Object.create(null) as Record<string, unknown>;
        assert.equal(isRecord(nullPrototype), true);

        class CustomExample {
            public readonly name = "instance";
        }
        const instance = new CustomExample();
        assert.equal(isRecord(instance), true);
    });

    void it("narrows the type predicate for property access", () => {
        const candidate: unknown = { hello: "world" };
        if (isRecord(candidate)) {
            // This assignment would fail to type-check if `isRecord` did not
            // narrow to `Record<string, unknown>`.
            const value: unknown = candidate.hello;
            assert.equal(value, "world");
        } else {
            assert.fail("Expected isRecord to return true for a plain object");
        }
    });
});

void describe("extractErrorMessage", () => {
    void it("returns the message of a standard Error", () => {
        assert.equal(extractErrorMessage(new Error("boom")), "boom");
    });

    void it("returns the message of a TypeError subclass", () => {
        assert.equal(extractErrorMessage(new TypeError("bad input")), "bad input");
    });

    void it("returns strings verbatim", () => {
        assert.equal(extractErrorMessage("plain text"), "plain text");
    });

    void it("returns a non-empty placeholder for null", () => {
        // Regression: the ad-hoc `error instanceof Error ? error.message :
        // String(error)` pattern used across the CLI produced the literal
        // string `"null"` for `null` thrown values. Centralising the
        // extraction through `Core.getErrorMessageOrFallback` yields a
        // descriptive placeholder instead.
        const message = extractErrorMessage(null);
        assert.notEqual(message, "");
        assert.notEqual(message, "null");
    });

    void it("returns a non-empty placeholder for undefined", () => {
        // Regression: the previous ad-hoc pattern produced the literal
        // string `"undefined"` for `undefined` thrown values.
        const message = extractErrorMessage(undefined);
        assert.notEqual(message, "");
        assert.notEqual(message, "undefined");
    });

    void it("returns a non-empty message for an Error with an empty message property", () => {
        // Regression: the previous ad-hoc pattern could yield an empty
        // string for an Error whose `.message` was empty, which then
        // produced an empty user-facing diagnostic. The centralised helper
        // routes empty messages through the same fallback path as `null`
        // and `undefined`, so the result must remain non-empty.
        const emptyMessageError = new Error("placeholder");
        Reflect.set(emptyMessageError, "message", "");
        const message = extractErrorMessage(emptyMessageError);
        assert.notEqual(message, "");
    });

    void it("falls back to a non-empty placeholder for primitives without a string representation", () => {
        // Regression: the previous ad-hoc pattern produced the literal
        // `"undefined"` for `void`-returning expressions and the literal
        // stringification of any primitive. The centralised helper returns
        // a stable, non-empty placeholder so callers can rely on every
        // result being safe to embed in user-facing messages.
        const nullish = extractErrorMessage(undefined);
        const numeric = extractErrorMessage(42);
        const boolean = extractErrorMessage(false);

        assert.notEqual(nullish, "");
        assert.notEqual(numeric, "");
        assert.notEqual(boolean, "");
    });

    void it("returns a non-empty placeholder for thrown objects without an Error-like shape", () => {
        // Regression: the previous ad-hoc pattern produced the literal
        // stringification of arbitrary thrown objects (e.g. `"[object Object]"`)
        // or the JSON serialisation of a thrown value, which leaks the
        // internal representation. The centralised helper routes every
        // non-error, non-string value through a stable, non-empty fallback so
        // user-facing diagnostics stay predictable.
        class UnlabeledThrow {
            public readonly reason = "boom";
        }

        const message = extractErrorMessage(new UnlabeledThrow());
        assert.notEqual(message, "");
        assert.notEqual(message, "[object Object]");
    });

    void it("never propagates a thrown toString when extracting a message", () => {
        // Regression: the previous ad-hoc pattern invoked `String(error)`
        // unconditionally, which throws if the value's `toString` throws.
        // The centralised helper must not allow such a throw to escape the
        // extraction path; instead it returns a stable, non-empty placeholder.
        const unstable = {
            toString(): string {
                throw new Error("cannot stringify");
            }
        };

        const message = extractErrorMessage(unstable);
        assert.notEqual(message, "");
    });
});
