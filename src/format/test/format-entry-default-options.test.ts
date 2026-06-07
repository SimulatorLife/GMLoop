import assert from "node:assert/strict";
import test from "node:test";

import { defaultOptions, formatOptions } from "../src/format-entry.js";
import { DEFAULT_CORE_OPTION_OVERRIDES } from "../src/options/core-option-overrides.js";

void test("defaultOptions includes defaults defined by format options", () => {
    for (const [optionName, optionConfig] of Object.entries(formatOptions)) {
        if (!optionConfig || !Object.hasOwn(optionConfig, "default")) {
            continue;
        }

        const optionDefault = (optionConfig as { default: unknown }).default;
        assert.strictEqual(
            Reflect.get(defaultOptions, optionName),
            optionDefault,
            `expected default option ${optionName} to be present in defaultOptions`
        );
    }
});

void test("defaultOptions stays frozen and preserves forced core overrides", () => {
    const expectedCoreOverrides = DEFAULT_CORE_OPTION_OVERRIDES;

    assert.ok(Object.isFrozen(defaultOptions), "expected defaultOptions to be frozen");
    assert.strictEqual(defaultOptions.trailingComma, expectedCoreOverrides.trailingComma);
    assert.strictEqual(defaultOptions.arrowParens, expectedCoreOverrides.arrowParens);
});
