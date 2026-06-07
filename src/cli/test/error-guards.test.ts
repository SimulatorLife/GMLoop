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
});
