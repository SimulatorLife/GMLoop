/**
 * Regression guard: the format option helper modules
 * (`options/logical-operators-style.ts` and
 * `options/trailing-comma-option.ts`) have been slimmed down to expose
 * only the constants and normalizers the formatter actually consumes.
 *
 * Why this guard exists
 * ---------------------
 * The previous shape of `logical-operators-style.ts` re-exported
 * `isLogicalOperatorsStyle`, a Boolean membership helper that was never
 * referenced outside its own definition file. The previous shape of
 * `trailing-comma-option.ts` exposed `isTrailingCommaValue` and
 * `assertTrailingCommaValue` for a `trailingComma` Prettier-core option
 * the formatter now hard-locks to `TRAILING_COMMA.NONE` via
 * {@link DEFAULT_CORE_OPTION_OVERRIDES}. Reintroducing those helpers
 * would couple consumers to a domain the formatter no longer owns and
 * pull in `createEnumeratedOptionHelpers` plumbing that exists only to
 * serve those helpers. The same module also listed an `ES5` member
 * inside `TRAILING_COMMA` that was never referenced from production
 * code paths.
 *
 * The guards below read the option modules from disk and assert the
 * surviving public surface. If anyone re-exports the dead helpers or
 * revives the unused `ES5` constant, the assertions fail loudly so the
 * cleanup can be re-applied.
 *
 * (target-state.md §2.3, §3.2 — option modules expose only the constants
 * and normalizers the formatter actually consumes.)
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as LogicalOperatorsStyleModule from "../src/options/logical-operators-style.js";
import * as TrailingCommaOptionModule from "../src/options/trailing-comma-option.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const LOGICAL_OPERATORS_STYLE_PATH = path.resolve(REPOSITORY_ROOT, "src/format/src/options/logical-operators-style.ts");
const TRAILING_COMMA_OPTION_PATH = path.resolve(REPOSITORY_ROOT, "src/format/src/options/trailing-comma-option.ts");

void test("logical-operators-style.ts no longer exports the dead isLogicalOperatorsStyle helper", async () => {
    const source = await readFile(LOGICAL_OPERATORS_STYLE_PATH, "utf8");

    assert.doesNotMatch(
        source,
        /\bexport\s+function\s+isLogicalOperatorsStyle\b/u,
        "logical-operators-style.ts must not re-export the dead isLogicalOperatorsStyle helper"
    );
    assert.equal(
        "isLogicalOperatorsStyle" in LogicalOperatorsStyleModule,
        false,
        "isLogicalOperatorsStyle must not be exposed from the logical-operators-style module"
    );
});

void test("trailing-comma-option.ts no longer exports the dead validators", async () => {
    const source = await readFile(TRAILING_COMMA_OPTION_PATH, "utf8");

    assert.doesNotMatch(
        source,
        /\bexport\s+(?:function|\{[^}]*\bassertTrailingCommaValue\b[^}]*\})\b/u,
        "trailing-comma-option.ts must not re-export assertTrailingCommaValue"
    );
    assert.doesNotMatch(
        source,
        /\bisTrailingCommaValue\b/u,
        "trailing-comma-option.ts must not reference isTrailingCommaValue"
    );
    assert.equal(
        "assertTrailingCommaValue" in TrailingCommaOptionModule,
        false,
        "assertTrailingCommaValue must not be exposed from the trailing-comma-option module"
    );
    assert.equal(
        "isTrailingCommaValue" in TrailingCommaOptionModule,
        false,
        "isTrailingCommaValue must not be exposed from the trailing-comma-option module"
    );
});

void test("trailing-comma-option.ts no longer ships the unused ES5 constant", async () => {
    const source = await readFile(TRAILING_COMMA_OPTION_PATH, "utf8");

    assert.doesNotMatch(
        source,
        /\bES5\s*:\s*"es5"/u,
        "TRAILING_COMMA.ES5 must not be reintroduced; the formatter never references it"
    );
    assert.equal(
        "ES5" in TrailingCommaOptionModule.TRAILING_COMMA,
        false,
        "TRAILING_COMMA.ES5 must not be exposed from the trailing-comma-option module"
    );
});

void test("canonical helpers remain exported so the simplified module is still consumable", () => {
    assert.strictEqual(typeof LogicalOperatorsStyleModule.normalizeLogicalOperatorsStyle, "function");
    assert.ok(LogicalOperatorsStyleModule.LogicalOperatorsStyle);
    assert.ok(TrailingCommaOptionModule.TRAILING_COMMA);
});
