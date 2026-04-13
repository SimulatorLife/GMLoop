import assert from "node:assert/strict";
import test from "node:test";

import { resolveProjectIndexParser } from "../src/project-index/index.js";

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

void test("resolveProjectIndexParser ignores unrecognised alias properties and uses canonical parseGml", () => {
    const legacyCalls: Array<string> = [];
    const canonicalCalls: Array<string> = [];

    const parser = resolveProjectIndexParser({
        parserFacade: {
            parse(sourceText: string) {
                legacyCalls.push(sourceText);
                return { source: "legacy" };
            }
        },
        parseGml(sourceText: string) {
            canonicalCalls.push(sourceText);
            return { source: "canonical" };
        }
    });

    const result = parser("test_source");

    assert.deepEqual(result, { source: "canonical" });
    assert.deepEqual(canonicalCalls, ["test_source"]);
    assert.deepEqual(legacyCalls, []);
});
