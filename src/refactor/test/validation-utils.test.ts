import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    assertValidIdentifierName,
    extractSymbolName,
    parseSymbolIdParts,
    tryNormalizeIdentifierName
} from "../src/rename/index.js";

void describe("assertValidIdentifierName", () => {
    void test("accepts valid identifier", () => {
        const result = assertValidIdentifierName("validName");
        assert.strictEqual(result, "validName");
    });

    void test("accepts identifier with underscores", () => {
        const result = assertValidIdentifierName("valid_name_123");
        assert.strictEqual(result, "valid_name_123");
    });

    void test("accepts identifier starting with underscore", () => {
        const result = assertValidIdentifierName("_privateName");
        assert.strictEqual(result, "_privateName");
    });

    void test("rejects identifier with leading whitespace", () => {
        assert.throws(() => assertValidIdentifierName(" name"), {
            message: /leading or trailing whitespace/
        });
    });

    void test("rejects identifier with trailing whitespace", () => {
        assert.throws(() => assertValidIdentifierName("name "), {
            message: /leading or trailing whitespace/
        });
    });

    void test("rejects empty string", () => {
        assert.throws(() => assertValidIdentifierName(""), {
            message: /must not be empty/
        });
    });

    void test("rejects non-string input", () => {
        assert.throws(() => assertValidIdentifierName(123), {
            name: "TypeError"
        });
    });

    void test("rejects identifier starting with number", () => {
        assert.throws(() => assertValidIdentifierName("123name"), {
            message: /not a valid GML identifier/
        });
    });

    void test("rejects identifier with special characters", () => {
        assert.throws(() => assertValidIdentifierName("name-with-dash"), {
            message: /not a valid GML identifier/
        });
    });
});

void describe("tryNormalizeIdentifierName", () => {
    void test("returns validated name for a valid identifier", () => {
        assert.strictEqual(tryNormalizeIdentifierName("validName"), "validName");
    });

    void test("returns validated name for identifier with underscores and digits", () => {
        assert.strictEqual(tryNormalizeIdentifierName("valid_name_123"), "valid_name_123");
    });

    void test("returns null for empty string", () => {
        assert.strictEqual(tryNormalizeIdentifierName(""), null);
    });

    void test("returns null for identifier with leading whitespace", () => {
        assert.strictEqual(tryNormalizeIdentifierName(" name"), null);
    });

    void test("returns null for identifier starting with a digit", () => {
        assert.strictEqual(tryNormalizeIdentifierName("123name"), null);
    });

    void test("returns null for identifier with special characters", () => {
        assert.strictEqual(tryNormalizeIdentifierName("name-with-dash"), null);
    });

    void test("returns null for non-string input: number", () => {
        assert.strictEqual(tryNormalizeIdentifierName(42), null);
    });

    void test("returns null for non-string input: null", () => {
        assert.strictEqual(tryNormalizeIdentifierName(null), null);
    });

    void test("returns null for non-string input: undefined", () => {
        assert.strictEqual(tryNormalizeIdentifierName(undefined), null);
    });
});

void describe("extractSymbolName", () => {
    void test("extracts symbol name from fully-qualified ID", () => {
        assert.strictEqual(extractSymbolName("gml/script/scr_player"), "scr_player");
        assert.strictEqual(extractSymbolName("gml/var/hp"), "hp");
        assert.strictEqual(extractSymbolName("gml/event/create"), "create");
    });

    void test("returns original ID when no slashes present", () => {
        assert.strictEqual(extractSymbolName("invalid"), "invalid");
        assert.strictEqual(extractSymbolName("simple"), "simple");
    });

    void test("handles trailing slash", () => {
        assert.strictEqual(extractSymbolName("gml/script/"), "");
    });

    void test("handles multiple slashes", () => {
        assert.strictEqual(extractSymbolName("gml/nested/path/to/symbol"), "symbol");
    });

    void test("handles empty string", () => {
        assert.strictEqual(extractSymbolName(""), "");
    });

    void test("handles single segment", () => {
        assert.strictEqual(extractSymbolName("segment"), "segment");
    });
});

void describe("parseSymbolIdParts", () => {
    void test("parses valid symbol IDs", () => {
        assert.deepStrictEqual(parseSymbolIdParts("gml/script/scr_player"), {
            segments: ["gml", "script", "scr_player"],
            symbolKind: "script",
            symbolName: "scr_player"
        });
    });

    void test("returns null for malformed symbol IDs", () => {
        assert.strictEqual(parseSymbolIdParts("gml/script"), null);
        assert.strictEqual(parseSymbolIdParts("script"), null);
    });

    void test("handles extra path segments", () => {
        assert.deepStrictEqual(parseSymbolIdParts("gml/nested/path/to/symbol"), {
            segments: ["gml", "nested", "path", "to", "symbol"],
            symbolKind: "nested",
            symbolName: "symbol"
        });
    });
});
