import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { createEnumeratedOptionHelpers, normalizeEnumeratedOption } from "../src/utils/enumerated-options.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const ENUMERATED_OPTIONS_SOURCE_PATH = path.resolve(REPOSITORY_ROOT, "src/core/src/utils/enumerated-options.ts");

void describe("createEnumeratedOptionHelpers", () => {
    void it("normalizes to lowercase by default", () => {
        const helpers = createEnumeratedOptionHelpers(["json", "yaml"]);
        assert.equal(helpers.normalize("JSON"), "json");
        assert.equal(helpers.normalize("YaML"), "yaml");
    });

    void it("only accepts the options object shape; the legacy positional-formatter branch is not reintroduced", async () => {
        // The second argument was a positional `formatError` function in an
        // older revision of this API. Callers now pass `{ formatError }`
        // instead, so the object shape below is the only supported form.
        const helpers = createEnumeratedOptionHelpers(["json"], {
            formatError: (list, received) => `Expected: ${list}. Got: ${received}.`
        });
        assert.equal(helpers.normalize("json"), "json");

        const source = await readFile(ENUMERATED_OPTIONS_SOURCE_PATH, "utf8");
        assert.doesNotMatch(
            source,
            /typeof options === ["']function["']/u,
            "the deprecated positional-formatter detection branch must not be reintroduced"
        );
    });

    void it("performs case-sensitive matching when caseSensitive is true", () => {
        const helpers = createEnumeratedOptionHelpers(["script", "var"], {
            caseSensitive: true
        });
        assert.equal(helpers.normalize("script"), "script");
        assert.equal(helpers.normalize("SCRIPT"), null);
        assert.equal(helpers.normalize("Script"), null);
    });

    void it("preserves value order in error messages when not sorting", () => {
        const helpers = createEnumeratedOptionHelpers(["zoo", "apple", "banana"], {
            caseSensitive: true
        });
        assert.throws(
            () => helpers.requireValue("invalid"),
            (error: Error) => error.message.includes("apple, banana, zoo")
        );
    });

    void it("type guard works with case-sensitive matching", () => {
        const helpers = createEnumeratedOptionHelpers(["script", "var"], {
            caseSensitive: true
        });
        const testValue: unknown = "script";
        if (helpers.normalize(testValue) !== null) {
            // Type should be narrowed
            assert.equal(testValue, "script");
        }
    });
});

void describe("normalizeEnumeratedOption", () => {
    const formats = new Set(["json", "human"]);

    void it("returns the fallback for undefined values", () => {
        assert.equal(normalizeEnumeratedOption(undefined, "json", formats), "json");
    });

    void it("normalizes string input using the default coercion", () => {
        assert.equal(normalizeEnumeratedOption(" HUMAN ", null, formats), "human");
    });

    void it("returns null when the normalized value is invalid", () => {
        assert.equal(normalizeEnumeratedOption("xml", "json", formats), null);
    });

    void it("supports custom coercion callbacks", () => {
        const numbers = new Set(["one", "two"]);
        const result = normalizeEnumeratedOption(2, "one", numbers, {
            coerce: (value) => {
                if (value === 2) {
                    return "two";
                }

                if (typeof value === "string") {
                    return value;
                }

                if (typeof value === "number") {
                    return value.toString();
                }

                throw new TypeError("Unexpected enumerated option value");
            }
        });
        assert.equal(result, "two");
    });

    void it("throws when the valid value collection lacks a has method", () => {
        assert.throws(
            () => normalizeEnumeratedOption("two", "one", {}),
            (error) => error instanceof TypeError && error.message.includes("has function")
        );
    });
});
