import assert from "node:assert/strict";
import { test } from "node:test";

// Prefer strict assertion helpers to avoid relying on Node.js' deprecated
// loose equality variants like assert.equal/assert.deepEqual.
import {
    assertNoLeadingOrTrailingWhitespace,
    assertNonEmptyString,
    capitalize,
    coalesceTrimmedString,
    createListSplitPattern,
    describeValueForError,
    formatWithIndefiniteArticle,
    getNonEmptyString,
    isIdentifierBoundaryCharacter,
    isNonEmptyString,
    isNonEmptyTrimmedString,
    isWordChar,
    normalizeExtensionSuffix,
    normalizeStringList,
    stripStringQuotes,
    toNormalizedLowerCaseSet,
    toNormalizedLowerCaseString,
    toTrimmedString
} from "../src/utils/string.js";

void test("toTrimmedString returns trimmed strings", () => {
    assert.strictEqual(toTrimmedString("  value  "), "value");
    assert.strictEqual(toTrimmedString("value"), "value");
    assert.strictEqual(toTrimmedString(""), "");
});

void test("toTrimmedString normalizes non-string values to empty strings", () => {
    assert.strictEqual(toTrimmedString(null), "");
    assert.strictEqual(toTrimmedString(), "");
    assert.strictEqual(toTrimmedString(123), "");
    assert.strictEqual(toTrimmedString({}), "");
});

void test("coalesceTrimmedString returns the first non-empty trimmed candidate", () => {
    assert.strictEqual(coalesceTrimmedString(null, "   ", "value"), "value");
    assert.strictEqual(coalesceTrimmedString("  first  ", "second"), "first");
    assert.strictEqual(coalesceTrimmedString(), "");
    assert.strictEqual(coalesceTrimmedString(null, "   "), "");
});

void test("normalizeExtensionSuffix lowercases and prefixes dot-separated values", () => {
    assert.strictEqual(normalizeExtensionSuffix(" gml"), ".gml");
    assert.strictEqual(normalizeExtensionSuffix("YY"), ".yy");
    assert.strictEqual(normalizeExtensionSuffix(".Md"), ".md");
});

void test("normalizeExtensionSuffix returns null for invalid inputs", () => {
    assert.strictEqual(normalizeExtensionSuffix("   "), null);
    assert.strictEqual(normalizeExtensionSuffix("."), null);
    assert.strictEqual(normalizeExtensionSuffix(42), null);
});

void test("normalizeStringList preserves entire strings when splitting is disabled", () => {
    assert.deepStrictEqual(normalizeStringList("alpha,beta", { splitPattern: null }), ["alpha,beta"]);
    assert.deepStrictEqual(normalizeStringList("alpha,beta", { splitPattern: false }), ["alpha,beta"]);
});

void test("createListSplitPattern deduplicates separators and preserves order", () => {
    const pattern = createListSplitPattern([",", ":", ","]);
    assert.deepStrictEqual("alpha,beta:gamma".split(pattern), ["alpha", "beta", "gamma"]);
});

void test("createListSplitPattern supports multi-character separators", () => {
    const pattern = createListSplitPattern(["::", "ab"]);
    assert.deepStrictEqual("one::twoabthree".split(pattern), ["one", "two", "three"]);
});

void test("createListSplitPattern optionally includes whitespace separators", () => {
    const pattern = createListSplitPattern([","], { includeWhitespace: true });
    assert.deepStrictEqual("one, two  three".split(pattern), ["one", "two", "three"]);
});

void test("createListSplitPattern treats null options like omitted options", () => {
    assert.doesNotThrow(() => createListSplitPattern([","], null));

    const pattern = createListSplitPattern([","], null);
    assert.deepStrictEqual("one,two".split(pattern), ["one", "two"]);
});

void test("createListSplitPattern requires a separator when whitespace is disabled", () => {
    assert.throws(() => createListSplitPattern([]), TypeError);
});

void test("toNormalizedLowerCaseString trims and lowercases input values", () => {
    assert.strictEqual(toNormalizedLowerCaseString("  JSON  "), "json");
    assert.strictEqual(toNormalizedLowerCaseString("Human"), "human");
    assert.strictEqual(toNormalizedLowerCaseString(123), "123");
});

void test("toNormalizedLowerCaseString tolerates nullish inputs", () => {
    assert.strictEqual(toNormalizedLowerCaseString(null), "");
    assert.strictEqual(toNormalizedLowerCaseString(), "");
    assert.strictEqual(toNormalizedLowerCaseString("   "), "");
});

void test("string utility helpers interoperate with trimmed strings", () => {
    const values = ["  one  ", "", "  two", "three  ", null];

    const normalized = values.map((value) => toTrimmedString(value)).filter((value) => isNonEmptyString(value));
    assert.deepStrictEqual(normalized, ["one", "two", "three"]);

    assert.strictEqual(isNonEmptyTrimmedString("  spaced  "), true);
    assert.strictEqual(isNonEmptyTrimmedString("   "), false);
    assert.strictEqual(capitalize("example"), "Example");
});

void test("isNonEmptyTrimmedString handles control characters correctly", () => {
    // Control characters (codes 0-31 except tab, newline, etc.) should NOT be considered whitespace
    // as they are not trimmed by String.prototype.trim()
    assert.strictEqual(
        isNonEmptyTrimmedString(String.fromCharCode(0)),
        true,
        "Null character (code 0) should be considered non-whitespace"
    );
    assert.strictEqual(
        isNonEmptyTrimmedString(String.fromCharCode(1)),
        true,
        "Control character (code 1) should be considered non-whitespace"
    );
    assert.strictEqual(
        isNonEmptyTrimmedString(String.fromCharCode(8)),
        true,
        "Backspace (code 8) should be considered non-whitespace"
    );
    assert.strictEqual(
        isNonEmptyTrimmedString(String.fromCharCode(14)),
        true,
        "Control character (code 14) should be considered non-whitespace"
    );
    assert.strictEqual(
        isNonEmptyTrimmedString(String.fromCharCode(31)),
        true,
        "Control character (code 31) should be considered non-whitespace"
    );
});

void test("isNonEmptyTrimmedString handles Unicode whitespace correctly", () => {
    // Non-breaking space (U+00A0) IS trimmed by String.prototype.trim()
    assert.strictEqual(
        isNonEmptyTrimmedString(String.fromCharCode(160)),
        false,
        "Non-breaking space (code 160) should be considered whitespace"
    );

    // Line separator (U+2028) and paragraph separator (U+2029) ARE trimmed
    assert.strictEqual(
        isNonEmptyTrimmedString(String.fromCharCode(8232)),
        false,
        "Line separator (code 8232) should be considered whitespace"
    );
    assert.strictEqual(
        isNonEmptyTrimmedString(String.fromCharCode(8233)),
        false,
        "Paragraph separator (code 8233) should be considered whitespace"
    );

    // Regular ASCII whitespace should still work
    assert.strictEqual(isNonEmptyTrimmedString(" "), false, "Space should be considered whitespace");
    assert.strictEqual(isNonEmptyTrimmedString("\t"), false, "Tab should be considered whitespace");
    assert.strictEqual(isNonEmptyTrimmedString("\n"), false, "Newline should be considered whitespace");
    assert.strictEqual(isNonEmptyTrimmedString("\r"), false, "Carriage return should be considered whitespace");
});

void test("getNonEmptyString returns null for empty candidates", () => {
    assert.strictEqual(getNonEmptyString("value"), "value");
    assert.strictEqual(getNonEmptyString(""), null);
    assert.strictEqual(getNonEmptyString(null), null);
    assert.strictEqual(getNonEmptyString(), null);
});

void test("toNormalizedLowerCaseSet trims, deduplicates, and lowercases entries", () => {
    const values = ["  Foo  ", "BAR", "foo", null, "   "];
    const result = toNormalizedLowerCaseSet(values);
    assert.deepStrictEqual([...result], ["foo", "bar"]);
});

void test("toNormalizedLowerCaseSet tolerates invalid inputs when allowed", () => {
    assert.deepStrictEqual([...toNormalizedLowerCaseSet(null)], []);
    assert.deepStrictEqual([...toNormalizedLowerCaseSet()], []);
    assert.deepStrictEqual([...toNormalizedLowerCaseSet(42)], []);
});

void test("capitalize leaves falsy and non-string inputs unchanged", () => {
    assert.strictEqual(capitalize(""), "");
    assert.strictEqual(capitalize(null), "");
    assert.strictEqual(capitalize(), "");
    assert.strictEqual(capitalize(42), "42");
});

void test("isWordChar validates alphanumeric and underscore characters", () => {
    assert.strictEqual(isWordChar("a"), true);
    assert.strictEqual(isWordChar("Z"), true);
    assert.strictEqual(isWordChar("0"), true);
    assert.strictEqual(isWordChar("_"), true);
    assert.strictEqual(isWordChar(""), false);
    assert.strictEqual(isWordChar("-"), false);
    assert.strictEqual(isWordChar(null), false);
});

void test("isIdentifierBoundaryCharacter treats non-word values as boundaries", () => {
    assert.strictEqual(isIdentifierBoundaryCharacter("a"), false);
    assert.strictEqual(isIdentifierBoundaryCharacter("Z"), false);
    assert.strictEqual(isIdentifierBoundaryCharacter("0"), false);
    assert.strictEqual(isIdentifierBoundaryCharacter("_"), false);
    assert.strictEqual(isIdentifierBoundaryCharacter("-"), true);
    assert.strictEqual(isIdentifierBoundaryCharacter(""), true);
    assert.strictEqual(isIdentifierBoundaryCharacter(null), true);
});

void test("assertNonEmptyString returns the validated value", () => {
    assert.strictEqual(assertNonEmptyString("value"), "value");
    assert.strictEqual(assertNonEmptyString("  padded  ", { trim: true }), "padded");
});

void test("assertNonEmptyString throws when value is not a non-empty string", () => {
    assert.throws(() => assertNonEmptyString(""), TypeError);
    assert.throws(() => assertNonEmptyString("   ", { trim: true }), TypeError);
    assert.throws(() => assertNonEmptyString(null), TypeError);
    assert.throws(() => assertNonEmptyString(42), TypeError);
});

void test("assertNoLeadingOrTrailingWhitespace returns the value when valid", () => {
    assert.strictEqual(assertNoLeadingOrTrailingWhitespace("value"), "value");
    assert.strictEqual(assertNoLeadingOrTrailingWhitespace("identifier_name"), "identifier_name");
    assert.strictEqual(assertNoLeadingOrTrailingWhitespace("CamelCase"), "CamelCase");
});

void test("assertNoLeadingOrTrailingWhitespace throws when value has leading whitespace", () => {
    assert.throws(() => assertNoLeadingOrTrailingWhitespace(" value"), Error);
    assert.throws(() => assertNoLeadingOrTrailingWhitespace("\tvalue"), Error);
    assert.throws(() => assertNoLeadingOrTrailingWhitespace("\nvalue"), Error);
});

void test("assertNoLeadingOrTrailingWhitespace throws when value has trailing whitespace", () => {
    assert.throws(() => assertNoLeadingOrTrailingWhitespace("value "), Error);
    assert.throws(() => assertNoLeadingOrTrailingWhitespace("value\t"), Error);
    assert.throws(() => assertNoLeadingOrTrailingWhitespace("value\n"), Error);
});

void test("assertNoLeadingOrTrailingWhitespace throws when value has both leading and trailing whitespace", () => {
    assert.throws(() => assertNoLeadingOrTrailingWhitespace(" value "), Error);
    assert.throws(() => assertNoLeadingOrTrailingWhitespace("\tvalue\t"), Error);
    assert.throws(() => assertNoLeadingOrTrailingWhitespace("  value  "), Error);
});

void test("assertNoLeadingOrTrailingWhitespace preserves internal whitespace", () => {
    assert.strictEqual(assertNoLeadingOrTrailingWhitespace("two words"), "two words");
    assert.strictEqual(assertNoLeadingOrTrailingWhitespace("multiple  spaces"), "multiple  spaces");
});

void test("assertNoLeadingOrTrailingWhitespace uses custom name in error message", () => {
    try {
        assertNoLeadingOrTrailingWhitespace(" value ", { name: "Custom field" });
        assert.fail("Expected error to be thrown");
    } catch (error) {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes("Custom field"));
    }
});

void test("assertNoLeadingOrTrailingWhitespace uses custom error message when provided", () => {
    try {
        assertNoLeadingOrTrailingWhitespace(" value ", { errorMessage: "Custom error" });
        assert.fail("Expected error to be thrown");
    } catch (error) {
        assert.ok(error instanceof Error);
        assert.strictEqual(error.message, "Custom error");
    }
});

void test("describeValueForError formats primitives and structured values", () => {
    assert.strictEqual(describeValueForError(null), "null");
    assert.strictEqual(describeValueForError(), "undefined");
    assert.strictEqual(describeValueForError("value"), '"value"');
    assert.strictEqual(describeValueForError(123), "123");
    assert.strictEqual(describeValueForError(123n), "123");
    assert.strictEqual(describeValueForError(false), "false");
    assert.strictEqual(describeValueForError({ key: "value" }), '{"key":"value"}');

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assert.strictEqual(describeValueForError(circular), "[object Object]");
});

void test("formatWithIndefiniteArticle selects the correct article", () => {
    assert.strictEqual(formatWithIndefiniteArticle("array"), "an array");
    assert.strictEqual(formatWithIndefiniteArticle("string"), "a string");
    assert.strictEqual(formatWithIndefiniteArticle(""), "a");
});

void test("describeValueForError can skip JSON serialization for complex values", () => {
    assert.strictEqual(describeValueForError({ example: true }, { stringifyUnknown: false }), "[object Object]");
});

void test("stripStringQuotes removes matching single and double quotes", () => {
    assert.strictEqual(stripStringQuotes('"value"'), "value");
    assert.strictEqual(stripStringQuotes("'value'"), "value");
    assert.strictEqual(stripStringQuotes('""'), "");
});

void test("stripStringQuotes returns null for unquoted or mismatched values", () => {
    assert.strictEqual(stripStringQuotes("value"), null);
    assert.strictEqual(stripStringQuotes("\"value'"), null);
    assert.strictEqual(stripStringQuotes("'value\""), null);
    assert.strictEqual(stripStringQuotes(null), null);
    assert.strictEqual(stripStringQuotes(42), null);
});
