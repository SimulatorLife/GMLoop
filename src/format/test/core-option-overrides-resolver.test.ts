/**
 * Regression tests for the core-option-overrides module.
 *
 * Validates that the formatter's Prettier-core option overrides are locked to
 * safe defaults and that resolveCoreOptionOverrides() always returns the
 * canonical frozen map — there is no external resolver hook or user-value
 * normalisation path that could introduce non-GML behaviour.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_CORE_OPTION_OVERRIDES, resolveCoreOptionOverrides } from "../src/options/core-option-overrides.js";

void describe("resolveCoreOptionOverrides", () => {
    void it("returns the canonical frozen override map", () => {
        const overrides = resolveCoreOptionOverrides();
        assert.strictEqual(overrides, DEFAULT_CORE_OPTION_OVERRIDES);
        assert.deepEqual(Object.keys(overrides).toSorted(), [
            "arrowParens",
            "htmlWhitespaceSensitivity",
            "jsxSingleQuote",
            "proseWrap",
            "singleAttributePerLine",
            "trailingComma"
        ]);
    });

    void it("returns the canonical map unconditionally", () => {
        // Confirm the function always returns the same frozen map — there is no
        // resolver hook or user-value normalisation path.
        const overrides = resolveCoreOptionOverrides();
        assert.strictEqual(overrides, DEFAULT_CORE_OPTION_OVERRIDES);
    });
});

void describe("DEFAULT_CORE_OPTION_OVERRIDES", () => {
    void it("is deeply frozen", () => {
        assert.ok(Object.isFrozen(DEFAULT_CORE_OPTION_OVERRIDES));
        assert.ok(Object.isFrozen(DEFAULT_CORE_OPTION_OVERRIDES));
    });

    void it("locks trailingComma to 'none' (GML positional commas)", () => {
        assert.equal(DEFAULT_CORE_OPTION_OVERRIDES.trailingComma, "none");
    });

    void it("locks arrowParens to 'always' (no GML arrow functions)", () => {
        assert.equal(DEFAULT_CORE_OPTION_OVERRIDES.arrowParens, "always");
    });

    void it("locks JSX/HTML/prose options to defaults", () => {
        assert.equal(DEFAULT_CORE_OPTION_OVERRIDES.singleAttributePerLine, false);
        assert.equal(DEFAULT_CORE_OPTION_OVERRIDES.jsxSingleQuote, false);
        assert.equal(DEFAULT_CORE_OPTION_OVERRIDES.proseWrap, "preserve");
        assert.equal(DEFAULT_CORE_OPTION_OVERRIDES.htmlWhitespaceSensitivity, "css");
    });
});
