import assert from "node:assert/strict";
import { test } from "node:test";

import {
    loadManualFunctionNames,
    resetReservedIdentifierMetadataLoader,
    setReservedIdentifierMetadataLoader
} from "../src/resources/gml-identifier-loading.js";

test.afterEach(() => {
    resetReservedIdentifierMetadataLoader();
});

void test("loadManualFunctionNames returns known manual functions", () => {
    const names = loadManualFunctionNames();

    assert.ok(names.has("abs"), "Expected manual function 'abs' to be present");
});

void test("loadManualFunctionNames filters to function identifiers", () => {
    const cleanup = setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            foo: { type: "function" },
            bar: { type: "keyword" },
            baz: { type: "FUNCTION" },
            quux: { type: "unknown" },
            quuz: { type: "" }
        }
    }));

    const names = loadManualFunctionNames();

    assert.deepEqual(Array.from(names).toSorted(), ["baz", "foo", "quux"]);

    cleanup();
});
