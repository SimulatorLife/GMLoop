import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AstPath } from "prettier";

import { hasLineBreak, isInlineEmptyBlockComment, isInsideConstructorFunction } from "../src/printer/type-guards.js";

function makePath(ancestors: Array<{ type: string } | null>): AstPath<any> {
    return {
        getValue: () => ({ type: "Identifier" }),
        getParentNode: (level: number = 0) => ancestors[level] ?? null
    } as unknown as AstPath<any>;
}

// ---------------------------------------------------------------------------
// hasLineBreak
// ---------------------------------------------------------------------------

void describe("hasLineBreak", () => {
    void it("returns false for non-string inputs", () => {
        assert.equal(hasLineBreak(null), false);
        assert.equal(hasLineBreak(undefined), false);
        assert.equal(hasLineBreak(123), false);
        assert.equal(hasLineBreak(true), false);
        assert.equal(hasLineBreak({}), false);
    });

    void it("returns false for empty string", () => {
        assert.equal(hasLineBreak(""), false);
    });

    void it("returns false for strings without line breaks", () => {
        assert.equal(hasLineBreak("hello world"), false);
        assert.equal(hasLineBreak("  // comment  "), false);
        assert.equal(hasLineBreak("function() { return 1; }"), false);
    });

    void it("returns true for LF", () => {
        assert.equal(hasLineBreak("\n"), true);
        assert.equal(hasLineBreak("before\nafter"), true);
    });

    void it("returns true for CR", () => {
        assert.equal(hasLineBreak("\r"), true);
        assert.equal(hasLineBreak("before\rafter"), true);
    });

    void it("returns true for CRLF", () => {
        assert.equal(hasLineBreak("\r\n"), true);
        assert.equal(hasLineBreak("before\r\nafter"), true);
    });

    void it("returns true for LS (U+2028)", () => {
        assert.equal(hasLineBreak("\u2028"), true);
    });

    void it("returns true for PS (U+2029)", () => {
        assert.equal(hasLineBreak("\u2029"), true);
    });
});

// ---------------------------------------------------------------------------
// isInlineEmptyBlockComment
// ---------------------------------------------------------------------------

void describe("isInlineEmptyBlockComment", () => {
    void it("returns false for null or non-object", () => {
        assert.equal(isInlineEmptyBlockComment(null), false);
        assert.equal(isInlineEmptyBlockComment(undefined), false);
        assert.equal(isInlineEmptyBlockComment("string"), false);
    });

    void it("returns false for non-block comments", () => {
        assert.equal(isInlineEmptyBlockComment({ type: "CommentLine" }), false);
    });

    void it("returns false for multi-line block comments", () => {
        assert.equal(
            isInlineEmptyBlockComment({
                type: "CommentBlock",
                leadingWS: "\n",
                trailingWS: "\n",
                lineCount: 2,
                value: "content"
            }),
            false
        );
    });

    void it("returns false for comments with line breaks in content", () => {
        assert.equal(
            isInlineEmptyBlockComment({
                type: "CommentBlock",
                leadingWS: "",
                trailingWS: "",
                lineCount: 1,
                value: "line1\nline2"
            }),
            false
        );
    });

    void it("returns true for single-line block comments without line breaks", () => {
        assert.equal(
            isInlineEmptyBlockComment({
                type: "CommentBlock",
                leadingWS: "",
                trailingWS: "",
                lineCount: 1,
                value: "empty"
            }),
            true
        );
    });

    void it("returns false for comments with leading whitespace containing line breaks", () => {
        assert.equal(
            isInlineEmptyBlockComment({
                type: "CommentBlock",
                leadingWS: "\n// prior",
                trailingWS: "",
                lineCount: 1,
                value: "empty"
            }),
            false
        );
    });
});

// ---------------------------------------------------------------------------
// isInsideConstructorFunction
// ---------------------------------------------------------------------------

void describe("type guard helpers", () => {
    void it("detects function declarations nested inside constructors", () => {
        const path = makePath([
            { type: "FunctionDeclaration" },
            { type: "BlockStatement" },
            { type: "ConstructorDeclaration" },
            { type: "Program" }
        ]);

        assert.equal(isInsideConstructorFunction(path), true);
    });

    void it("returns false when no constructor ancestor exists", () => {
        const path = makePath([{ type: "FunctionDeclaration" }, { type: "BlockStatement" }, { type: "Program" }]);

        assert.equal(isInsideConstructorFunction(path), false);
    });

    void it("returns false when a constructor is not separated by a function declaration", () => {
        const path = makePath([{ type: "BlockStatement" }, { type: "ConstructorDeclaration" }, { type: "Program" }]);

        assert.equal(isInsideConstructorFunction(path), false);
    });

    void it("returns false when the function declaration is not owned by a block", () => {
        const path = makePath([
            { type: "FunctionDeclaration" },
            { type: "ConstructorDeclaration" },
            { type: "Program" }
        ]);

        assert.equal(isInsideConstructorFunction(path), false);
    });
});
