import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GmlNode } from "../src/emitter/ast.js";
import { wrapConditional, wrapConditionalBody, wrapRawBody } from "../src/emitter/code-wrapping.js";

// Simple visitor that returns the node type for testing
function mockVisitor(node: GmlNode): string {
    if (node.type === "Identifier") {
        return "x";
    }
    if (node.type === "BinaryExpression") {
        return "x > 5";
    }
    if (node.type === "BlockStatement") {
        return "{\nx = 1;\n}";
    }
    if (node.type === "ParenthesizedExpression") {
        return "x";
    }
    if (node.type === "ExpressionStatement") {
        return "x = 1";
    }
    return node.type;
}

function statementWithSemicolonVisitor(): string {
    return "x = 1;";
}

function emptyStatementVisitor(): string {
    return "";
}

function returnStatementVisitor(): string {
    return "return x";
}

function whitespaceStatementVisitor(): string {
    return "   ";
}

const absentNodes: Array<{ label: string; node: null | undefined }> = [
    { label: "null", node: null },
    { label: "undefined", node: undefined }
];

void describe("wrapConditional", () => {
    void it("wraps expression in parentheses by default", () => {
        const node = { type: "BinaryExpression" } as GmlNode;
        const result = wrapConditional(node, mockVisitor);
        assert.strictEqual(result, "(x > 5)");
    });

    void it("returns raw expression when raw=true", () => {
        const node = { type: "BinaryExpression" } as GmlNode;
        const result = wrapConditional(node, mockVisitor, true);
        assert.strictEqual(result, "x > 5");
    });

    void it("unwraps ParenthesizedExpression to avoid double-wrapping", () => {
        const node = {
            type: "ParenthesizedExpression",
            expression: { type: "Identifier" } as GmlNode
        } as GmlNode;
        const result = wrapConditional(node, mockVisitor);
        assert.strictEqual(result, "(x)");
    });

    for (const { label, node } of absentNodes) {
        void it(`returns (undefined) for ${label} node when raw=false`, () => {
            const result = wrapConditional(node, mockVisitor);
            assert.strictEqual(result, "(undefined)");
        });

        void it(`returns empty string for ${label} node when raw=true`, () => {
            const result = wrapConditional(node, mockVisitor, true);
            assert.strictEqual(result, "");
        });
    }
});

void describe("wrapConditionalBody", () => {
    for (const { label, node } of absentNodes) {
        void it(`returns empty block for ${label} node`, () => {
            const result = wrapConditionalBody(node, mockVisitor);
            assert.strictEqual(result, " {\n}\n");
        });
    }

    void it("uses BlockStatement as-is with leading space", () => {
        const node = { type: "BlockStatement" } as GmlNode;
        const result = wrapConditionalBody(node, mockVisitor);
        assert.strictEqual(result, " {\nx = 1;\n}");
    });

    void it("wraps single statement in block with semicolon", () => {
        const node = { type: "ExpressionStatement" } as GmlNode;
        const result = wrapConditionalBody(node, mockVisitor);
        assert.strictEqual(result, " {\nx = 1;\n}");
    });

    void it("does not add semicolon if statement already has one", () => {
        const node = { type: "ExpressionStatement" } as GmlNode;
        const result = wrapConditionalBody(node, statementWithSemicolonVisitor);
        assert.strictEqual(result, " {\nx = 1;\n}");
    });

    void it("handles empty statement gracefully", () => {
        const node = { type: "ExpressionStatement" } as GmlNode;
        const result = wrapConditionalBody(node, emptyStatementVisitor);
        assert.strictEqual(result, " {\n\n}");
    });

    void it("handles whitespace-only statement", () => {
        const node = { type: "ExpressionStatement" } as GmlNode;
        const result = wrapConditionalBody(node, whitespaceStatementVisitor);
        assert.strictEqual(result, " {\n   ;\n}");
    });
});

void describe("wrapRawBody", () => {
    for (const { label, node } of absentNodes) {
        void it(`returns raw empty block for ${label} node`, () => {
            const result = wrapRawBody(node, mockVisitor);
            assert.strictEqual(result, "{\n}\n");
        });
    }

    void it("uses BlockStatement as-is without leading space", () => {
        const node = { type: "BlockStatement" } as GmlNode;
        const result = wrapRawBody(node, mockVisitor);
        assert.strictEqual(result, "{\nx = 1;\n}");
    });

    void it("wraps single statement in block with semicolon and trims", () => {
        const node = { type: "ExpressionStatement" } as GmlNode;
        const result = wrapRawBody(node, mockVisitor);
        assert.strictEqual(result, "{\nx = 1;\n}");
    });

    void it("does not add semicolon if statement already has one", () => {
        const node = { type: "ExpressionStatement" } as GmlNode;
        const result = wrapRawBody(node, statementWithSemicolonVisitor);
        assert.strictEqual(result, "{\nx = 1;\n}");
    });

    void it("handles empty statement gracefully", () => {
        const node = { type: "ExpressionStatement" } as GmlNode;
        const result = wrapRawBody(node, emptyStatementVisitor);
        assert.strictEqual(result, "{\n\n}");
    });

    void it("trims leading newline from wrapped block", () => {
        const node = { type: "ReturnStatement" } as GmlNode;
        const result = wrapRawBody(node, returnStatementVisitor);
        // The \n at the start should be trimmed
        assert.ok(!result.startsWith("\n{"));
        assert.ok(result.startsWith("{"));
    });
});
