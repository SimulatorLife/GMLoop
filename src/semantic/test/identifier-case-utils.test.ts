import assert from "node:assert/strict";
import test from "node:test";

import {
    formatIdentifierCase,
    getIdentifierCaseStyleMetadata,
    isIdentifierCase,
    normalizeIdentifierCase
} from "../src/identifier-case/identifier-case-utils.js";

// Node.js deprecated assert.equal; rely on the strict helpers to avoid implicit
// coercion. Manual validation: `node --test src/semantic/test/identifier-case-utils.test.js`.
void test("normalisation preserves prefixes and numeric suffixes", () => {
    const normalized = normalizeIdentifierCase("global.hp_max_2");

    assert.strictEqual(normalized.prefix, "global.");
    assert.strictEqual(normalized.suffixSeparator, "_");
    assert.strictEqual(normalized.suffixDigits, "2");
    assert.deepStrictEqual(
        normalized.tokens.map((token) => ({ ...token })),
        [
            { normalized: "hp", type: "word" },
            { normalized: "max", type: "word" }
        ]
    );

    const rebuilt = formatIdentifierCase(normalized, "camel");
    assert.strictEqual(rebuilt, "global.hpMax_2");
});

void test("leading and trailing underscores are stable across conversions", () => {
    const source = "__hpMax__";
    const normalized = normalizeIdentifierCase(source);

    assert.strictEqual(normalized.leadingUnderscores, "__");
    assert.strictEqual(normalized.trailingUnderscores, "__");
    const camel = formatIdentifierCase(normalized, "camel");
    assert.strictEqual(camel, source);

    const pascal = formatIdentifierCase(normalized, "pascal");
    assert.strictEqual(pascal.startsWith(normalized.leadingUnderscores), true);
    assert.strictEqual(pascal.endsWith(normalized.trailingUnderscores), true);
    assert.strictEqual(
        pascal.slice(normalized.leadingUnderscores.length, pascal.length - normalized.trailingUnderscores.length),
        "HpMax"
    );
});

void test("all-underscore identifiers preserve edge underscore metadata", () => {
    const normalized = normalizeIdentifierCase("___");

    assert.strictEqual(normalized.leadingUnderscores, "___");
    assert.strictEqual(normalized.trailingUnderscores, "___");
    assert.deepStrictEqual(normalized.tokens, []);
    assert.strictEqual(formatIdentifierCase(normalized, "camel"), "______");
});

void test("mixed alphanumeric identifiers join digits intelligently in snake cases", () => {
    const normalized = normalizeIdentifierCase("hp2DMax");

    assert.strictEqual(formatIdentifierCase(normalized, "camel"), "hp2DMax");
    assert.strictEqual(formatIdentifierCase(normalized, "pascal"), "Hp2DMax");
    assert.strictEqual(formatIdentifierCase(normalized, "snake-lower"), "hp2d_max");
    assert.strictEqual(formatIdentifierCase(normalized, "snake-upper"), "HP2D_MAX");
});

void test("idempotence checks report already compliant identifiers", () => {
    assert.strictEqual(isIdentifierCase("hpMax", "camel"), true);
    assert.strictEqual(isIdentifierCase("HpMax", "pascal"), true);
    assert.strictEqual(isIdentifierCase("hp_max", "snake-lower"), true);
    assert.strictEqual(isIdentifierCase("HP_MAX", "snake-upper"), true);

    assert.strictEqual(isIdentifierCase("hp_max", "camel"), false);
});

void test("style metadata exposes descriptions", () => {
    assert.strictEqual(
        getIdentifierCaseStyleMetadata("camel").description,
        "Convert identifiers to lower camelCase (e.g. `exampleName`)."
    );
    assert.strictEqual(
        getIdentifierCaseStyleMetadata("off").description,
        "Disable automatic identifier case rewriting."
    );
    assert.throws(() => getIdentifierCaseStyleMetadata("unknown"), {
        message: "Unsupported identifier case: unknown"
    });
});

void test("numeric suffixes remain attached regardless of case", () => {
    const normalized = normalizeIdentifierCase("self.hp_value99");

    assert.strictEqual(normalized.prefix, "self.");
    assert.strictEqual(formatIdentifierCase(normalized, "camel"), "self.hpValue99");
    assert.strictEqual(formatIdentifierCase(normalized, "pascal"), "self.HpValue99");
    assert.strictEqual(formatIdentifierCase(normalized, "snake-lower"), "self.hp_value99");
});
