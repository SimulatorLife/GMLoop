import assert from "node:assert/strict";
import { test } from "node:test";

import {
    clearIdentifierMetadataCache,
    getBuiltInHoverInfo,
    resetReservedIdentifierMetadataLoader,
    setReservedIdentifierMetadataLoader
} from "../src/resources/gml-identifier-loading.js";

test.afterEach(() => {
    resetReservedIdentifierMetadataLoader();
    clearIdentifierMetadataCache();
});

void test("getBuiltInHoverInfo normalizes a complete hover payload into the contract shape", () => {
    setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            abs: {
                type: "function",
                hover: {
                    signature: "abs(val)",
                    description: "Absolute value of the input.",
                    parameters: [{ name: "val", type: "Real", description: "The number to turn absolute." }],
                    returnType: "Real"
                }
            }
        }
    }));

    const hover = getBuiltInHoverInfo("abs");

    assert.deepEqual(hover, {
        signature: "abs(val)",
        description: "Absolute value of the input.",
        parameters: [{ name: "val", type: "Real", description: "The number to turn absolute." }],
        returnType: "Real"
    });
});

void test("getBuiltInHoverInfo returns null when the identifier is absent", () => {
    setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            abs: { type: "function" }
        }
    }));

    assert.equal(getBuiltInHoverInfo("absent"), null);
});

void test("getBuiltInHoverInfo returns null when the descriptor has no hover field", () => {
    setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            Accessors: { type: "accessor" }
        }
    }));

    assert.equal(getBuiltInHoverInfo("Accessors"), null);
});

void test("getBuiltInHoverInfo filters out malformed parameter entries instead of throwing", () => {
    setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            abs: {
                type: "function",
                hover: {
                    signature: "abs(val)",
                    description: "Absolute value of the input.",
                    parameters: [
                        { name: "val", type: "Real" },
                        null,
                        { type: "Real" },
                        { name: "" },
                        { name: "extra", type: 42 }
                    ],
                    returnType: "Real"
                }
            }
        }
    }));

    const hover = getBuiltInHoverInfo("abs");

    assert.deepEqual(hover?.parameters, [
        { name: "val", type: "Real", description: null },
        { name: "extra", type: null, description: null }
    ]);
});

void test("getBuiltInHoverInfo replaces missing string fields with null", () => {
    setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            abs: {
                type: "function",
                hover: {
                    parameters: []
                }
            }
        }
    }));

    const hover = getBuiltInHoverInfo("abs");

    assert.deepEqual(hover, {
        signature: null,
        description: null,
        parameters: [],
        returnType: null
    });
});

void test("getBuiltInHoverInfo tolerates non-object hover payloads", () => {
    setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            abs: {
                type: "function",
                hover: "not-an-object"
            }
        }
    }));

    assert.equal(getBuiltInHoverInfo("abs"), null);
});

void test("getBuiltInHoverInfo caches the lookup so repeat calls return the same reference", () => {
    setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            abs: {
                type: "function",
                hover: {
                    signature: "abs(val)",
                    description: "Absolute value of the input.",
                    parameters: [],
                    returnType: "Real"
                }
            }
        }
    }));

    const first = getBuiltInHoverInfo("abs");
    const second = getBuiltInHoverInfo("abs");

    assert.strictEqual(first, second);
});

void test("clearIdentifierMetadataCache invalidates the hover-info cache", () => {
    setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            abs: {
                type: "function",
                hover: { signature: "abs(val)", parameters: [], returnType: "Real" }
            }
        }
    }));

    const first = getBuiltInHoverInfo("abs");

    setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            abs: {
                type: "function",
                hover: { signature: "abs(value)", parameters: [], returnType: "Real" }
            }
        }
    }));

    clearIdentifierMetadataCache();

    const second = getBuiltInHoverInfo("abs");

    assert.notStrictEqual(first, second);
    assert.equal(second?.signature, "abs(value)");
});

void test("getBuiltInHoverInfo returns null when the metadata payload is missing identifiers", () => {
    setReservedIdentifierMetadataLoader(() => ({
        meta: { packageName: null }
    }));

    assert.equal(getBuiltInHoverInfo("abs"), null);
});
