import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createNumericTypeErrorFormatter, resolveIntegerOption } from "../src/shared/numeric-options.js";

void describe("numeric-options", () => {
    void describe("resolveIntegerOption", () => {
        void it("returns the coerced value", () => {
            assert.strictEqual(resolveIntegerOption(42, { coerce: (v) => v }), 42);
        });

        void it("returns defaultValue for undefined input", () => {
            assert.strictEqual(resolveIntegerOption(undefined, { defaultValue: 7, coerce: (v) => v }), 7);
        });

        void it("normalizes string inputs", () => {
            const result = resolveIntegerOption(" 42 ", {
                defaultValue: 0,
                coerce(value) {
                    return value + 1;
                }
            });
            assert.strictEqual(result, 43);
        });

        void it("returns default for blank strings", () => {
            const result = resolveIntegerOption("   ", {
                defaultValue: 9,
                coerce(value) {
                    return value;
                }
            });
            assert.strictEqual(result, 9);
        });

        void it("throws for invalid types", () => {
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
    });

    void describe("createNumericTypeErrorFormatter", () => {
        void it("formats a message with the provided label and type", () => {
            const formatter = createNumericTypeErrorFormatter("Progress bar width");
            assert.strictEqual(
                formatter("string"),
                "Progress bar width must be provided as a number (received type 'string')."
            );
        });
    });
});
