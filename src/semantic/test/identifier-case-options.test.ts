import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    getIdentifierCaseScopeOptionName,
    IDENTIFIER_CASE_ACKNOWLEDGE_ASSETS_OPTION_NAME,
    IDENTIFIER_CASE_BASE_OPTION_NAME,
    IDENTIFIER_CASE_IGNORE_OPTION_NAME,
    IDENTIFIER_CASE_INHERIT_VALUE,
    IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES_OPTION_NAME,
    IDENTIFIER_CASE_PRESERVE_OPTION_NAME,
    IDENTIFIER_CASE_PROJECT_INDEX_CONCURRENCY_OPTION_NAME,
    IDENTIFIER_CASE_SCOPE_NAMES,
    identifierCaseOptions,
    IdentifierCaseStyle,
    isIdentifierCaseStyle,
    normalizeIdentifierCaseOptions,
    parseIdentifierCaseStyle,
    requireIdentifierCaseStyle
} from "../src/identifier-case/options.js";

void describe("gml identifier case option normalization", () => {
    void it("defaults to disabled renaming when options are omitted", () => {
        const normalized = normalizeIdentifierCaseOptions({});

        assert.strictEqual(normalized.baseStyle, IdentifierCaseStyle.OFF);
        for (const scope of IDENTIFIER_CASE_SCOPE_NAMES) {
            assert.strictEqual(normalized.scopeSettings[scope], IDENTIFIER_CASE_INHERIT_VALUE);
            assert.strictEqual(normalized.scopeStyles[scope], IdentifierCaseStyle.OFF);
        }
        assert.deepStrictEqual(normalized.ignorePatterns, []);
        assert.deepStrictEqual(normalized.preservedIdentifiers, []);
        assert.strictEqual(normalized.assetRenamesAcknowledged, false);
    });

    void it("allows scope overrides while inheriting the base style", () => {
        const normalized = normalizeIdentifierCaseOptions({
            [IDENTIFIER_CASE_BASE_OPTION_NAME]: "pascal",
            [getIdentifierCaseScopeOptionName("globals")]: "snake-upper",
            [getIdentifierCaseScopeOptionName("locals")]: IDENTIFIER_CASE_INHERIT_VALUE,
            [getIdentifierCaseScopeOptionName("functions")]: "camel",
            [IDENTIFIER_CASE_IGNORE_OPTION_NAME]: "temp_, debug",
            [IDENTIFIER_CASE_PRESERVE_OPTION_NAME]: ["hp", "PlayerScore"],
            [IDENTIFIER_CASE_ACKNOWLEDGE_ASSETS_OPTION_NAME]: true,
            [getIdentifierCaseScopeOptionName("assets")]: "snake-upper"
        });

        assert.strictEqual(normalized.baseStyle, "pascal");
        assert.strictEqual(normalized.scopeStyles.functions, "camel");
        assert.strictEqual(normalized.scopeStyles.globals, "snake-upper");
        assert.strictEqual(normalized.scopeStyles.locals, "pascal");
        assert.ok(normalized.ignorePatterns.includes("temp_"));
        assert.ok(normalized.ignorePatterns.includes("debug"));
        assert.deepStrictEqual(normalized.preservedIdentifiers, ["hp", "PlayerScore"]);
        assert.strictEqual(normalized.assetRenamesAcknowledged, true);
    });

    void it("rejects unknown locals identifier case style values", () => {
        assert.throws(
            () =>
                normalizeIdentifierCaseOptions({
                    [getIdentifierCaseScopeOptionName("locals")]: "kebab"
                }),
            /invalid identifier case style/i
        );
    });

    void it("accepts valid locals identifier case style values", () => {
        const normalized = normalizeIdentifierCaseOptions({
            [getIdentifierCaseScopeOptionName("locals")]: IdentifierCaseStyle.SNAKE_UPPER
        });

        assert.strictEqual(normalized.scopeStyles.locals, IdentifierCaseStyle.SNAKE_UPPER);
    });

    void it("rejects enabling asset renames without acknowledgment", () => {
        assert.throws(
            () =>
                normalizeIdentifierCaseOptions({
                    [IDENTIFIER_CASE_BASE_OPTION_NAME]: "camel",
                    [getIdentifierCaseScopeOptionName("assets")]: IDENTIFIER_CASE_INHERIT_VALUE
                }),
            /acknowledging asset renames/i
        );
    });

    void it("rejects unknown asset identifier case style values", () => {
        assert.throws(
            () =>
                normalizeIdentifierCaseOptions({
                    [IDENTIFIER_CASE_ACKNOWLEDGE_ASSETS_OPTION_NAME]: true,
                    [getIdentifierCaseScopeOptionName("assets")]: "kebab"
                }),
            /invalid identifier case style/i
        );
    });

    void it("allows asset renames when explicitly acknowledged", () => {
        const normalized = normalizeIdentifierCaseOptions({
            [IDENTIFIER_CASE_BASE_OPTION_NAME]: "snake-lower",
            [IDENTIFIER_CASE_ACKNOWLEDGE_ASSETS_OPTION_NAME]: true
        });

        assert.strictEqual(normalized.scopeStyles.assets, "snake-lower");
        assert.strictEqual(normalized.assetRenamesAcknowledged, true);
    });

    void it("applies consistent integer option metadata", () => {
        const storeLimitOption = identifierCaseOptions[IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES_OPTION_NAME];
        const concurrencyOption = identifierCaseOptions[IDENTIFIER_CASE_PROJECT_INDEX_CONCURRENCY_OPTION_NAME];

        assert.strictEqual(storeLimitOption.type, "int");
        assert.strictEqual(storeLimitOption.category, "gml");
        assert.deepStrictEqual(storeLimitOption.range, { start: 0, end: Infinity });

        assert.strictEqual(concurrencyOption.type, "int");
        assert.strictEqual(concurrencyOption.category, "gml");
        assert.deepStrictEqual(concurrencyOption.range, { start: 1, end: Infinity });
    });

    void it("narrows valid identifier case styles through the type guard", () => {
        for (const style of Object.values(IdentifierCaseStyle)) {
            assert.strictEqual(isIdentifierCaseStyle(style), true, `expected '${style}' to be recognised`);
        }

        // Invalid literals must reject so callers can fail fast instead of
        // accidentally treating arbitrary strings as styles.
        assert.strictEqual(isIdentifierCaseStyle("kebab"), false);
        assert.strictEqual(isIdentifierCaseStyle("Camel"), false, "matching is case-sensitive");
        assert.strictEqual(isIdentifierCaseStyle(""), false);
        assert.strictEqual(isIdentifierCaseStyle(undefined), false);
        assert.strictEqual(isIdentifierCaseStyle(null), false);
        assert.strictEqual(isIdentifierCaseStyle(42), false);
        assert.strictEqual(isIdentifierCaseStyle({}), false);
    });

    void it("returns null from parseIdentifierCaseStyle for unknown values", () => {
        assert.strictEqual(parseIdentifierCaseStyle(IdentifierCaseStyle.CAMEL), IdentifierCaseStyle.CAMEL);
        assert.strictEqual(parseIdentifierCaseStyle("snake-lower"), IdentifierCaseStyle.SNAKE_LOWER);

        assert.strictEqual(parseIdentifierCaseStyle("kebab"), null);
        assert.strictEqual(parseIdentifierCaseStyle("CAMEL"), null, "matching is case-sensitive");
        assert.strictEqual(parseIdentifierCaseStyle(undefined), null);
        assert.strictEqual(parseIdentifierCaseStyle(null), null);
        assert.strictEqual(parseIdentifierCaseStyle(0), null);
    });

    void it("returns the typed value from requireIdentifierCaseStyle for valid input", () => {
        // The return value must be the same literal reference as the typed
        // constant so downstream `=== IdentifierCaseStyle.X` checks keep
        // working without translation.
        for (const style of Object.values(IdentifierCaseStyle)) {
            assert.strictEqual(requireIdentifierCaseStyle(style), style);
        }
    });

    void it("throws RangeError from requireIdentifierCaseStyle for invalid input", () => {
        assert.throws(() => requireIdentifierCaseStyle("kebab"), {
            name: "RangeError",
            message: /invalid identifier case style/i
        });

        // Non-string input must also fail fast: a stray number from a JSON
        // config should not silently become the default.
        assert.throws(() => requireIdentifierCaseStyle(42), { name: "RangeError" });
        assert.throws(() => requireIdentifierCaseStyle(undefined), { name: "RangeError" });
        assert.throws(() => requireIdentifierCaseStyle(null), { name: "RangeError" });
        assert.throws(() => requireIdentifierCaseStyle({}), { name: "RangeError" });
    });

    void it("includes the caller's context label in requireIdentifierCaseStyle errors", () => {
        assert.throws(
            () => requireIdentifierCaseStyle("kebab", "gmlIdentifierCaseFunctions"),
            /gmlIdentifierCaseFunctions/
        );
    });

    void it("fails fast on invalid styles for every scope, not just locals", () => {
        // The previous implementation only validated the `locals` scope;
        // any typo in `globals`, `functions`, etc. silently fell back to
        // the base style. Every scope must now reject unknown values.
        for (const scope of IDENTIFIER_CASE_SCOPE_NAMES) {
            if (scope === "assets") {
                // `assets` also requires an acknowledgement flag, so it
                // throws a different error before reaching style
                // validation. Skip it here and cover it separately below.
                continue;
            }

            assert.throws(
                () =>
                    normalizeIdentifierCaseOptions({
                        [getIdentifierCaseScopeOptionName(scope)]: "kebab"
                    }),
                /invalid identifier case style/i,
                `expected '${scope}' scope to reject unknown styles`
            );
        }

        assert.throws(
            () =>
                normalizeIdentifierCaseOptions({
                    [IDENTIFIER_CASE_ACKNOWLEDGE_ASSETS_OPTION_NAME]: true,
                    [getIdentifierCaseScopeOptionName("assets")]: "kebab"
                }),
            /invalid identifier case style/i
        );
    });
});
