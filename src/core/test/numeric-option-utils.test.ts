import assert from "node:assert/strict";
import { test } from "node:test";

import {
    coerceNonNegativeInteger,
    coercePositiveInteger,
    coercePositiveIntegerOption,
    normalizeNumericOption,
    resolveIntegerOption
} from "../src/utils/numeric-options.js";

void test("coercePositiveInteger enforces a minimum of 1", () => {
    assert.strictEqual(coercePositiveInteger(5, { createErrorMessage: () => "" }), 5);
    assert.throws(
        () => coercePositiveInteger(0, { createErrorMessage: () => "too small" }),
        new TypeError("too small")
    );
});

void test("coerceNonNegativeInteger enforces a minimum of 0", () => {
    assert.strictEqual(coerceNonNegativeInteger(2, { createErrorMessage: () => "" }), 2);
    assert.throws(
        () =>
            coerceNonNegativeInteger(-1, {
                createErrorMessage: (received: string) => `bad: ${received}`
            }),
        new TypeError("bad: -1")
    );
});

void test("coercePositiveIntegerOption falls back to defaults", () => {
    assert.strictEqual(coercePositiveIntegerOption(7, 3), 7);
    assert.strictEqual(coercePositiveIntegerOption(undefined, 3), 3);
    assert.strictEqual(coercePositiveIntegerOption(null, 3), 3);
    assert.strictEqual(coercePositiveIntegerOption(0, 3), 3);
});

void test("coercePositiveIntegerOption respects zero replacement", () => {
    assert.strictEqual(coercePositiveIntegerOption(0, 3, { zeroReplacement: 10 }), 10);
    assert.strictEqual(coercePositiveIntegerOption("bad", 4, { zeroReplacement: 8 }), 4);
});

void test("coercePositiveIntegerOption normalizes numeric strings", () => {
    assert.strictEqual(coercePositiveIntegerOption("12", 5), 12);
    assert.strictEqual(coercePositiveIntegerOption(" 9 ", 1), 9);
    assert.strictEqual(coercePositiveIntegerOption("0", 7, { zeroReplacement: 0 }), 0);
    assert.strictEqual(coercePositiveIntegerOption("", 6), 6);
});

void test("resolveIntegerOption normalizes string inputs", () => {
    const result = resolveIntegerOption(" 42 ", {
        defaultValue: 0,
        coerce(value) {
            return value + 1;
        }
    });
    assert.strictEqual(result, 43);
});

void test("resolveIntegerOption returns default for blank strings", () => {
    const result = resolveIntegerOption("   ", {
        defaultValue: 9,
        coerce(value) {
            return value;
        }
    });
    assert.strictEqual(result, 9);
});

void test("resolveIntegerOption throws for invalid types", () => {
    assert.throws(
        () =>
            resolveIntegerOption(
                {},
                {
                    defaultValue: 0,
                    coerce(value) {
                        return value;
                    },
                    typeErrorMessage: (type) => `bad type: ${type}`
                }
            ),
        new TypeError("bad type: object")
    );
});

void test("normalizeNumericOption returns undefined for nullish inputs", () => {
    assert.strictEqual(
        normalizeNumericOption(null, {
            optionName: "example",
            coerce() {
                throw new Error("should not coerce");
            },
            formatTypeError: () => ""
        }),
        undefined
    );
});

void test("normalizeNumericOption trims strings and forwards context", () => {
    let receivedOptions;
    const result = normalizeNumericOption(" 5 ", {
        optionName: "example",
        coerce(value, options) {
            receivedOptions = options;
            return value * 2;
        },
        formatTypeError(optionName, type) {
            return `${optionName}:${type}`;
        }
    });

    assert.strictEqual(result, 10);
    assert.deepStrictEqual(receivedOptions, {
        optionName: "example",
        rawType: "string",
        rawValue: " 5 ",
        received: '" 5 "',
        isString: true
    });
});

void test("normalizeNumericOption forwards context for numeric inputs", () => {
    const result = normalizeNumericOption(7, {
        optionName: "example",
        coerce(value, options) {
            assert.deepStrictEqual(options, {
                optionName: "example",
                rawType: "number",
                rawValue: 7,
                received: "7",
                isString: false
            });
            return value;
        },
        formatTypeError(optionName, type) {
            return `${optionName}:${type}`;
        }
    });
    assert.strictEqual(result, 7);
});

void test("normalizeNumericOption throws when type is invalid", () => {
    assert.throws(
        () =>
            normalizeNumericOption(Symbol.for("bad"), {
                optionName: "example",
                coerce(value) {
                    return value;
                },
                formatTypeError(optionName, type) {
                    return `${optionName}:${type}`;
                }
            }),
        new Error("example:symbol")
    );
});

void test("normalizeNumericOption ignores blank strings", () => {
    const result = normalizeNumericOption("   ", {
        optionName: "example",
        coerce(value) {
            return value;
        },
        formatTypeError(optionName, type) {
            return `${optionName}:${type}`;
        }
    });
    assert.strictEqual(result, undefined);
});
