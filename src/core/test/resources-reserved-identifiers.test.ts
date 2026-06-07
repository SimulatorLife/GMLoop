import assert from "node:assert/strict";
import { test } from "node:test";

import {
    loadReservedIdentifierNames,
    resetReservedIdentifierMetadataLoader,
    setReservedIdentifierMetadataLoader
} from "../src/resources/gml-identifier-loading.js";

function toSortedArray(set: Set<unknown>) {
    return Array.from(set).sort();
}

test.afterEach(() => {
    resetReservedIdentifierMetadataLoader();
});

void test("custom metadata loader honours default exclusion filters", () => {
    const cleanup = setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            foo: { type: "Function" },
            bar: { type: "keyword" },
            baz: { type: "literal" },
            quux: { type: "" }
        }
    }));

    const names = loadReservedIdentifierNames();

    assert.deepEqual(toSortedArray(names), ["foo"]);

    cleanup();
});

void test("cleanup handler only restores the active loader", () => {
    const cleanupFirst = setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            foo: { type: "function" }
        }
    }));

    setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            bar: { type: "function" }
        }
    }));

    cleanupFirst();

    const names = loadReservedIdentifierNames();

    assert.ok(names.has("bar"));
    assert.ok(!names.has("foo"));
});

void test("invalid loader input resets to the default implementation", () => {
    const cleanup = setReservedIdentifierMetadataLoader(null);

    assert.equal(typeof cleanup, "function");

    const replacementCleanup = setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            baz: { type: "function" }
        }
    }));

    const names = loadReservedIdentifierNames();

    assert.deepEqual(toSortedArray(names), ["baz"]);

    replacementCleanup();
});
