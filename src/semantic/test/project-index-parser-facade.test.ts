import assert from "node:assert/strict";
import test from "node:test";

import { getDefaultProjectIndexParser, resolveProjectIndexParser } from "../src/project-index/index.js";

void test("resolveProjectIndexParser uses parseGml override when provided", () => {
    const calls: Array<string> = [];

    const parser = resolveProjectIndexParser({
        parseGml(sourceText: string) {
            calls.push(sourceText);
            return { ok: true };
        }
    });

    const result = parser("test_source");

    assert.deepEqual(result, { ok: true });
    assert.deepEqual(calls, ["test_source"]);
});

void test("resolveProjectIndexParser returns default parser when parseGml override is absent", () => {
    const parser = resolveProjectIndexParser(null);

    assert.equal(parser, getDefaultProjectIndexParser());
});
