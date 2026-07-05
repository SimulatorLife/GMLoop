import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRuntimeValue } from "../src/commands/runtime.js";

void test("parseRuntimeValue returns the empty string for whitespace-only input", () => {
    // Regression: empty/whitespace input must not surface `undefined` to the
    // state store or trip any downstream serializer.
    assert.equal(parseRuntimeValue(""), "");
    assert.equal(parseRuntimeValue("   "), "");
    assert.equal(parseRuntimeValue("\n\t  \n"), "");
});

void test("parseRuntimeValue accepts primitive literals", () => {
    assert.equal(parseRuntimeValue("true"), true);
    assert.equal(parseRuntimeValue("false"), false);
    assert.equal(parseRuntimeValue("null"), null);
});

void test("parseRuntimeValue coerces numeric literals", () => {
    assert.equal(parseRuntimeValue("0"), 0);
    assert.equal(parseRuntimeValue("42"), 42);
    assert.equal(parseRuntimeValue("-7"), -7);
    assert.equal(parseRuntimeValue("3.14"), 3.14);
});

void test("parseRuntimeValue preserves a quoted JSON string unquoted", () => {
    // JSON.parse treats the quoted form as a string literal; the guard then
    // returns the unquoted primitive, matching downstream expectations.
    assert.equal(parseRuntimeValue('"hello"'), "hello");
    assert.equal(parseRuntimeValue('"with spaces"'), "with spaces");
    assert.equal(parseRuntimeValue('""'), "");
});

void test("parseRuntimeValue returns arrays of primitives unchanged", () => {
    // Arrays of primitives are the only non-primitive shape the runtime store
    // can persist without rewriting, so the guard must accept them as-is.
    assert.deepEqual(parseRuntimeValue("[1,2,3]"), [1, 2, 3]);
    assert.deepEqual(parseRuntimeValue('["a","b"]'), ["a", "b"]);
    assert.deepEqual(parseRuntimeValue("[]"), []);
    assert.deepEqual(parseRuntimeValue('[true,null,42,"text"]'), [true, null, 42, "text"]);
});

void test("parseRuntimeValue falls back to the trimmed raw string on JSON parse failure", () => {
    // Regression: the previous implementation returned `value` (raw, with
    // surrounding whitespace) when JSON.parse failed, leaking whitespace into
    // the state store. The hardening now returns the trimmed string so that
    // callers always see the same value they printed back.
    assert.equal(parseRuntimeValue("hello"), "hello");
    assert.equal(parseRuntimeValue("hello world"), "hello world");
    assert.equal(parseRuntimeValue(" hello "), "hello");
    assert.equal(parseRuntimeValue("\t'q'\t"), "'q'");
    assert.equal(parseRuntimeValue("[1,2,"), "[1,2,");
    assert.equal(parseRuntimeValue("{a:1}"), "{a:1}");
});

void test("parseRuntimeValue rejects JSON objects by returning the trimmed string", () => {
    // Regression: the previous implementation passed plain objects through to
    // `sanitizeRuntimeValue`, which then stored `null` while the CLI payload
    // echoed the original object back to the caller — a confusing mismatch.
    // The hardening now treats a non-serializable JSON shape as malformed
    // input and returns the trimmed raw string so that the printed value and
    // the stored value match.
    assert.equal(parseRuntimeValue('{"foo":1}'), '{"foo":1}');
    assert.equal(parseRuntimeValue('  {"foo":1}  '), '{"foo":1}');
    assert.equal(parseRuntimeValue('{"nested":{"x":1}}'), '{"nested":{"x":1}}');
    assert.equal(parseRuntimeValue('{"arr":[1,{"x":2}]}'), '{"arr":[1,{"x":2}]}');
});

void test("parseRuntimeValue rejects arrays containing non-serializable entries", () => {
    // The guard requires *every* element of an array to be serializable; a
    // mixed-shape array is treated as malformed and falls back to the
    // trimmed string rather than partially surviving sanitization.
    assert.equal(parseRuntimeValue('[1,{"x":1}]'), '[1,{"x":1}]');
    assert.equal(parseRuntimeValue('[{"only":true}]'), '[{"only":true}]');
});

void test("parseRuntimeValue returns strings for ambiguous numeric tokens", () => {
    // `Number("00")` is `0` and `String(0)` is `"0"`, so the strict numeric
    // shortcut (`String(maybeNumber) === trimmed`) does not match — the value
    // must reach JSON.parse or the trimmed-string fallback. JSON.parse
    // accepts leading-zero literals in modern V8, and the trimmed fallback
    // accepts them as raw text. The hardening must preserve the user's
    // intent either way: either as a number `0` or as the literal string
    // `"00"`, never as something unexpected like `[0]`.
    const result = parseRuntimeValue("00");
    assert.ok(result === 0 || result === "00", `expected 0 or "00", received ${JSON.stringify(result)}`);
});

void test("parseRuntimeValue is pure and side-effect free", () => {
    // Calling the parser repeatedly with the same input must yield the same
    // observable output — a guard against accidental caching or mutation.
    const input = '  {"foo":1}  ';
    for (let index = 0; index < 5; index += 1) {
        assert.equal(parseRuntimeValue(input), '{"foo":1}');
    }
});
