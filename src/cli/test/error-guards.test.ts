import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isRecord, tryParseJsonPayload } from "../src/shared/error-guards.js";

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
