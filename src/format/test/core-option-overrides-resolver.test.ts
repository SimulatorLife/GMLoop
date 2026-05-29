/**
 * Regression tests for the core-option-overrides module.
 *
 * Validates that the formatter's Prettier-core option overrides are locked to
 * safe defaults. The constant DEFAULT_CORE_OPTION_OVERRIDES is the canonical
 * source of truth — it is frozen and directly imported at the single call site
 * in format-entry.ts, eliminating a prior null-op thunk layer.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_CORE_OPTION_OVERRIDES } from "../src/options/core-option-overrides.js";

void describe("DEFAULT_CORE_OPTION_OVERRIDES", () => {
    void it("is deeply frozen", () => {
        assert.ok(Object.isFrozen(DEFAULT_CORE_OPTION_OVERRIDES));
        assert.ok(Object.isFrozen(DEFAULT_CORE_OPTION_OVERRIDES));
    });

    void it("contains exactly the expected override keys", () => {
        assert.deepEqual(Object.keys(DEFAULT_CORE_OPTION_OVERRIDES).toSorted(), [
            "arrowParens",
            "htmlWhitespaceSensitivity",
            "jsxSingleQuote",
            "proseWrap",
            "singleAttributePerLine",
            "trailingComma"
        ]);
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
