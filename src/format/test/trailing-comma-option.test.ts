/**
 * Regression tests for the `TRAILING_COMMA` option constants.
 *
 * The option helper module previously also exported `assertTrailingCommaValue`
 * and `isTrailingCommaValue`. Those validators only existed to support a
 * `trailingComma` Prettier-core option that the formatter now ignores:
 * {@link DEFAULT_CORE_OPTION_OVERRIDES} lock `trailingComma` to
 * {@link TRAILING_COMMA.NONE}, so any user-supplied alternative is dropped
 * without round-tripping through these helpers. The dead validators were
 * removed; these tests pin the constants the formatter still consumes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TRAILING_COMMA } from "../src/options/trailing-comma-option.js";

void describe("trailing comma option constants", () => {
    void it("freezes the constants object so accidental mutation is rejected", () => {
        assert.ok(Object.isFrozen(TRAILING_COMMA), "TRAILING_COMMA must be frozen");
    });

    void it("uses Prettier-canonical string values that align with `RequiredOptions`", () => {
        assert.equal(TRAILING_COMMA.NONE, "none");
        assert.equal(TRAILING_COMMA.ALL, "all");
    });

    void it("exposes only the values still referenced by the formatter", () => {
        // `ES5` was previously listed as a valid trailing-comma option but
        // was never referenced by any production code; removing it from the
        // frozen constants keeps the public surface aligned with what the
        // formatter actually uses. `NONE` and `ALL` are both referenced from
        // production code paths (`core-option-overrides.ts` and
        // `printer/delimited-list.ts` respectively), so they stay.
        assert.deepEqual(Object.keys(TRAILING_COMMA).toSorted(), ["ALL", "NONE"]);
    });
});
