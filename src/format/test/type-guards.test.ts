import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AstPath } from "prettier";

import {
    hasLineBreak,
    isInlineEmptyBlockComment,
    isInsideConstructorFunction,
    isSimpleCallArgument
} from "../src/printer/type-guards.js";

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
// isSimpleCallArgument
// ---------------------------------------------------------------------------

void describe("isSimpleCallArgument", () => {
    void it("returns false for non-object inputs", () => {
        assert.equal(isSimpleCallArgument(null), false);
        assert.equal(isSimpleCallArgument(undefined), false);
        assert.equal(isSimpleCallArgument("foo"), false);
        assert.equal(isSimpleCallArgument(42), false);
        assert.equal(isSimpleCallArgument(true), false);
    });

    void it("returns false for objects without a string type", () => {
        assert.equal(isSimpleCallArgument({}), false);
        assert.equal(isSimpleCallArgument({ type: 7 }), false);
    });

    void it("returns true for leaf value types in SIMPLE_CALL_ARGUMENT_TYPES", () => {
        assert.equal(isSimpleCallArgument({ type: "Identifier", name: "x" }), true);
        assert.equal(isSimpleCallArgument({ type: "Literal", value: "42" }), true);
        assert.equal(isSimpleCallArgument({ type: "Literal", value: '"hello"' }), true);
        assert.equal(isSimpleCallArgument({ type: "MemberDotExpression" }), true);
        assert.equal(isSimpleCallArgument({ type: "MemberIndexExpression" }), true);
        assert.equal(isSimpleCallArgument({ type: "ThisExpression" }), true);
        assert.equal(isSimpleCallArgument({ type: "BooleanLiteral", value: true }), true);
        assert.equal(isSimpleCallArgument({ type: "UndefinedLiteral" }), true);
    });

    void it("returns true for string-literal values that look like undefined/noone", () => {
        // The old code carried an explicit branch for these values; Literal is
        // already in SIMPLE_CALL_ARGUMENT_TYPES so the simple-set check covers
        // them. The new code preserves the same observable behavior.
        assert.equal(isSimpleCallArgument({ type: "Literal", value: "undefined" }), true);
        assert.equal(isSimpleCallArgument({ type: "Literal", value: "noone" }), true);
        assert.equal(isSimpleCallArgument({ type: "Literal", value: "UNDEFINED" }), true);
    });

    void it("returns false for complex-argument node types", () => {
        assert.equal(isSimpleCallArgument({ type: "FunctionDeclaration" }), false);
        assert.equal(isSimpleCallArgument({ type: "FunctionExpression" }), false);
        assert.equal(isSimpleCallArgument({ type: "ConstructorDeclaration" }), false);
        assert.equal(isSimpleCallArgument({ type: "StructExpression" }), false);
    });

    void it("returns false for CallExpression nodes (not classified as simple arguments)", () => {
        // Both simple and complex call expressions return false here; the
        // formatter's layout heuristics intentionally exclude CallExpression
        // from the simple-argument prefix to avoid grouping decisions that
        // would otherwise vary based on the callee's internals.
        assert.equal(
            isSimpleCallArgument({ type: "CallExpression", object: { type: "Identifier" }, arguments: [] }),
            false
        );
        assert.equal(
            isSimpleCallArgument({
                type: "CallExpression",
                object: { type: "Identifier" },
                arguments: [{ type: "Literal", value: "1" }]
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
