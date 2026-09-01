import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AstPath } from "prettier";

import {
    expressionIsStringLike,
    hasLineBreak,
    isInlineEmptyBlockComment,
    isInsideConstructorFunction,
    isNumericComputationNode,
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

    void it("returns false for adjacent character codes around the ASCII line breaks", () => {
        // Just below LF (10) and CR (13) must not be misclassified as line breaks,
        // guarding the ASCII fast-path range filter.
        assert.equal(hasLineBreak(String.fromCharCode(9)), false); // tab
        assert.equal(hasLineBreak(String.fromCharCode(11)), false);
        assert.equal(hasLineBreak(String.fromCharCode(12)), false);
        assert.equal(hasLineBreak(String.fromCharCode(14)), false);
    });

    void it("returns false for codes between CR and the Unicode line separators", () => {
        // The gap between ASCII line breaks (max 13) and Unicode separators (8232+)
        // contains a huge range of printable ASCII and Basic Latin characters; none
        // of those should ever be reported as line breaks.
        assert.equal(hasLineBreak(String.fromCharCode(32)), false); // space
        assert.equal(hasLineBreak(String.fromCharCode(126)), false); // ~
        assert.equal(hasLineBreak(String.fromCharCode(8231)), false); // just before LS
        assert.equal(hasLineBreak(String.fromCharCode(8234)), false); // just after PS
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
// isNumericComputationNode
// ---------------------------------------------------------------------------

void describe("isNumericComputationNode", () => {
    void it("returns false for non-object inputs", () => {
        assert.equal(isNumericComputationNode(null), false);
        assert.equal(isNumericComputationNode(undefined), false);
        assert.equal(isNumericComputationNode(42), false);
        assert.equal(isNumericComputationNode("1"), false);
    });

    void it("returns false for unknown node types", () => {
        assert.equal(isNumericComputationNode({ type: "Identifier", name: "x" }), false);
        assert.equal(isNumericComputationNode({ type: "BlockStatement" }), false);
    });

    void it("returns true for numeric literals (number value)", () => {
        assert.equal(isNumericComputationNode({ type: "Literal", value: 0 }), true);
        assert.equal(isNumericComputationNode({ type: "Literal", value: 42 }), true);
        assert.equal(isNumericComputationNode({ type: "Literal", value: -1 }), true);
        assert.equal(isNumericComputationNode({ type: "Literal", value: 3.14 }), true);
    });

    void it("returns true for string literals that match the numeric pattern", () => {
        assert.equal(isNumericComputationNode({ type: "Literal", value: "0" }), true);
        assert.equal(isNumericComputationNode({ type: "Literal", value: "123" }), true);
        assert.equal(isNumericComputationNode({ type: "Literal", value: "-1.5" }), true);
        assert.equal(isNumericComputationNode({ type: "Literal", value: "0.5" }), true);
    });

    void it("returns false for string literals that are not numeric", () => {
        assert.equal(isNumericComputationNode({ type: "Literal", value: "abc" }), false);
        assert.equal(isNumericComputationNode({ type: "Literal", value: '"hello"' }), false);
        assert.equal(isNumericComputationNode({ type: "Literal", value: "1abc" }), false);
    });

    void it("returns true for arithmetic binary expressions over numeric operands", () => {
        const plus = {
            type: "BinaryExpression",
            operator: "+",
            left: { type: "Literal", value: 1 },
            right: { type: "Literal", value: 2 }
        };
        const mul = {
            type: "BinaryExpression",
            operator: "*",
            left: { type: "Literal", value: 1 },
            right: { type: "Literal", value: 2 }
        };
        const div = {
            type: "BinaryExpression",
            operator: "div",
            left: { type: "Literal", value: 1 },
            right: { type: "Literal", value: 2 }
        };
        assert.equal(isNumericComputationNode(plus), true);
        assert.equal(isNumericComputationNode(mul), true);
        assert.equal(isNumericComputationNode(div), true);
    });

    void it("returns false for non-arithmetic binary expressions", () => {
        const and = {
            type: "BinaryExpression",
            operator: "&&",
            left: { type: "Literal", value: 1 },
            right: { type: "Literal", value: 2 }
        };
        const eq = {
            type: "BinaryExpression",
            operator: "==",
            left: { type: "Literal", value: 1 },
            right: { type: "Literal", value: 2 }
        };
        assert.equal(isNumericComputationNode(and), false);
        assert.equal(isNumericComputationNode(eq), false);
    });

    void it("returns false when either operand of an arithmetic expression is non-numeric", () => {
        const nonNumeric = {
            type: "BinaryExpression",
            operator: "+",
            left: { type: "Literal", value: 1 },
            right: { type: "Identifier", name: "x" }
        };
        assert.equal(isNumericComputationNode(nonNumeric), false);
    });

    void it("handles UnaryExpression +/- recursively", () => {
        const neg = { type: "UnaryExpression", operator: "-", argument: { type: "Literal", value: 5 } };
        const pos = { type: "UnaryExpression", operator: "+", argument: { type: "Literal", value: 5 } };
        const not = { type: "UnaryExpression", operator: "!", argument: { type: "Literal", value: 5 } };
        assert.equal(isNumericComputationNode(neg), true);
        assert.equal(isNumericComputationNode(pos), true);
        assert.equal(isNumericComputationNode(not), false);
    });

    void it("unwraps ParenthesizedExpression recursively", () => {
        const wrapped = { type: "ParenthesizedExpression", expression: { type: "Literal", value: 7 } };
        assert.equal(isNumericComputationNode(wrapped), true);
    });

    void it("treats numeric-returning CallExpressions as numeric", () => {
        const call = {
            type: "CallExpression",
            object: { type: "Identifier", name: "sqrt" },
            arguments: [{ type: "Literal", value: 2 }]
        };
        assert.equal(isNumericComputationNode(call), true);
    });

    void it("excludes string-producing CallExpressions from numeric computations", () => {
        const call = {
            type: "CallExpression",
            object: { type: "Identifier", name: "string" },
            arguments: [{ type: "Literal", value: 2 }]
        };
        assert.equal(isNumericComputationNode(call), false);
        const fmtCall = {
            type: "CallExpression",
            object: { type: "Identifier", name: "string_format" },
            arguments: []
        };
        assert.equal(isNumericComputationNode(fmtCall), false);
    });
});

// ---------------------------------------------------------------------------
// expressionIsStringLike
// ---------------------------------------------------------------------------

void describe("expressionIsStringLike", () => {
    void it("returns false for non-object inputs", () => {
        assert.equal(expressionIsStringLike(null), false);
        assert.equal(expressionIsStringLike(undefined), false);
        assert.equal(expressionIsStringLike(42), false);
        assert.equal(expressionIsStringLike('"x"'), false);
    });

    void it("returns true for string literals (quoted form)", () => {
        assert.equal(expressionIsStringLike({ type: "Literal", value: '"hello"' }), true);
        assert.equal(expressionIsStringLike({ type: "Literal", value: '""' }), true);
        assert.equal(expressionIsStringLike({ type: "Literal", value: '"a"' }), true);
    });

    void it("returns false for non-string literals", () => {
        assert.equal(expressionIsStringLike({ type: "Literal", value: 42 }), false);
        assert.equal(expressionIsStringLike({ type: "Literal", value: true }), false);
        assert.equal(expressionIsStringLike({ type: "Literal", value: "unquoted" }), false);
        assert.equal(expressionIsStringLike({ type: "Literal", value: null }), false);
    });

    void it("unwraps ParenthesizedExpression recursively", () => {
        const wrapped = { type: "ParenthesizedExpression", expression: { type: "Literal", value: '"a"' } };
        assert.equal(expressionIsStringLike(wrapped), true);
        const notString = { type: "ParenthesizedExpression", expression: { type: "Literal", value: 42 } };
        assert.equal(expressionIsStringLike(notString), false);
    });

    void it("returns true for + concatenation when either operand is string-like", () => {
        const left = {
            type: "BinaryExpression",
            operator: "+",
            left: { type: "Literal", value: '"a"' },
            right: { type: "Literal", value: 1 }
        };
        const right = {
            type: "BinaryExpression",
            operator: "+",
            left: { type: "Literal", value: 1 },
            right: { type: "Literal", value: '"a"' }
        };
        assert.equal(expressionIsStringLike(left), true);
        assert.equal(expressionIsStringLike(right), true);
    });

    void it("returns false for + concatenation when neither operand is string-like", () => {
        const both = {
            type: "BinaryExpression",
            operator: "+",
            left: { type: "Literal", value: 1 },
            right: { type: "Literal", value: 2 }
        };
        assert.equal(expressionIsStringLike(both), false);
    });

    void it("returns false for non-+ binary expressions even with string operands", () => {
        const sub = {
            type: "BinaryExpression",
            operator: "-",
            left: { type: "Literal", value: '"a"' },
            right: { type: "Literal", value: 1 }
        };
        assert.equal(expressionIsStringLike(sub), false);
    });

    void it("returns true for string-conversion call expressions", () => {
        const stringCall = { type: "CallExpression", object: { type: "Identifier", name: "string" }, arguments: [] };
        const stringFormat = {
            type: "CallExpression",
            object: { type: "Identifier", name: "string_format" },
            arguments: []
        };
        const stringUpper = {
            type: "CallExpression",
            object: { type: "Identifier", name: "string_upper" },
            arguments: []
        };
        assert.equal(expressionIsStringLike(stringCall), true);
        assert.equal(expressionIsStringLike(stringFormat), true);
        assert.equal(expressionIsStringLike(stringUpper), true);
    });

    void it("returns false for non-string call expressions", () => {
        const sqrt = { type: "CallExpression", object: { type: "Identifier", name: "sqrt" }, arguments: [] };
        assert.equal(expressionIsStringLike(sqrt), false);
    });

    void it("returns false for unknown node types", () => {
        assert.equal(expressionIsStringLike({ type: "Identifier", name: "x" }), false);
        assert.equal(expressionIsStringLike({ type: "BlockStatement" }), false);
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
