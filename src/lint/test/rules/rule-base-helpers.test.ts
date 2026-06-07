import assert from "node:assert/strict";
import test from "node:test";

import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import {
    collectIdentifierNamesInSubtree,
    createCommentTokenRangeIndex,
    findFirstAstNodeBy,
    findNextNonWhitespaceIndex,
    findPreviousNonWhitespaceCharacter,
    findPreviousNonWhitespaceIndex,
    isAssignmentExpressionNode,
    isAssignmentExpressionNodeWithOperator,
    isIdentifierNode,
    isMemberIndexExpressionNode,
    isVariableDeclaratorNode,
    rangeContainsCommentToken,
    resolveLocFromIndex,
    sourceRangeContainsCommentToken,
    walkAstNodes
} from "../../src/rules/gml/rule-base-helpers.js";
import { assertEquals } from "../assertions.js";

const isIncrementAssignmentOperator = (operator: unknown): operator is "+=" | "-=" =>
    operator === "+=" || operator === "-=";
const isSimpleAssignmentOperator = (operator: unknown): operator is "=" => operator === "=";

void test("findFirstAstNodeBy returns the first matching node in source order", () => {
    const astRoot = {
        type: "Program",
        body: [
            { type: "Identifier", name: "first" },
            { type: "Identifier", name: "second" }
        ]
    };

    const matchedNode = findFirstAstNodeBy(astRoot, (node) => node.type === "Identifier");

    assert.ok(matchedNode);
    assertEquals(matchedNode.name, "first");
});

void test("findFirstAstNodeBy ignores parent cycles and returns null when unmatched", () => {
    const identifierNode: { type: string; name: string; parent?: unknown } = {
        type: "Identifier",
        name: "stable"
    };
    const astRoot = {
        type: "Program",
        body: [identifierNode]
    };
    identifierNode.parent = astRoot;

    const matchedNode = findFirstAstNodeBy(astRoot, (node) => node.type === "BinaryExpression");

    assertEquals(matchedNode, null);
});

void test("walkAstNodes preserves source order when traversing array children", () => {
    const astRoot = {
        type: "Program",
        body: [
            { type: "Identifier", name: "alpha" },
            { type: "Identifier", name: "beta" },
            { type: "Identifier", name: "gamma" }
        ]
    };

    const visitedIdentifiers: string[] = [];
    walkAstNodes(astRoot, (node) => {
        if (typeof node.name === "string") {
            visitedIdentifiers.push(node.name);
        }
    });

    assert.deepEqual(visitedIdentifiers, ["alpha", "beta", "gamma"]);
});

void test("Core.cloneAstNode keeps local parent links without cloning ancestors", () => {
    const identifierNode: { type: string; name: string; parent?: unknown } = {
        type: "Identifier",
        name: "value"
    };
    const astRoot = {
        type: "Program",
        body: [identifierNode]
    };
    const externalParent = {
        type: "FunctionDeclaration",
        body: [astRoot]
    };
    identifierNode.parent = astRoot;
    (astRoot as { parent?: unknown }).parent = externalParent;

    const clonedRoot = Core.cloneAstNode(astRoot) as Record<string, unknown>;
    const clonedIdentifier = (clonedRoot.body as Array<Record<string, unknown>>)[0];

    assert.equal("parent" in clonedRoot, false);
    assert.ok(clonedIdentifier);
    assert.equal(clonedIdentifier.parent, clonedRoot);
});

void test("Core.cloneAstNode preserves nested node values", () => {
    const astRoot = {
        type: "AssignmentExpression",
        operator: "=",
        left: { type: "Identifier", name: "target" },
        right: { type: "Literal", value: "42" }
    };

    const clonedRoot = Core.cloneAstNode(astRoot) as Record<string, unknown>;
    const clonedLeft = clonedRoot.left as Record<string, unknown>;
    const clonedRight = clonedRoot.right as Record<string, unknown>;

    assert.notEqual(clonedRoot, astRoot);
    assert.equal(clonedRoot.type, "AssignmentExpression");
    assert.equal(clonedRoot.operator, "=");
    assert.equal(clonedLeft.type, "Identifier");
    assert.equal(clonedLeft.name, "target");
    assert.equal(clonedRight.type, "Literal");
    assert.equal(clonedRight.value, "42");
    assert.equal(clonedLeft.parent, clonedRoot);
    assert.equal(clonedRight.parent, clonedRoot);
});

void test("sourceRangeContainsCommentToken detects line and block comment markers within the requested span", () => {
    const sourceText = [
        "var plain = 1;",
        "var withLine = 2; // inline",
        "/* block */ var withBlock = 3;",
        "var tail = 4;"
    ].join("\n");

    const plainStart = sourceText.indexOf("var plain = 1;");
    const plainEnd = plainStart + "var plain = 1;".length;
    const lineStart = sourceText.indexOf("var withLine = 2;");
    const lineEnd = lineStart + "var withLine = 2; // inline".length;
    const blockStart = sourceText.indexOf("/* block */");
    const blockEnd = blockStart + "/* block */".length;

    assert.equal(sourceRangeContainsCommentToken(sourceText, plainStart, plainEnd), false);
    assert.equal(sourceRangeContainsCommentToken(sourceText, lineStart, lineEnd), true);
    assert.equal(sourceRangeContainsCommentToken(sourceText, blockStart, blockEnd), true);
});

void test("findPreviousNonWhitespaceIndex skips whitespace and returns the closest token index", () => {
    const sourceText = "if   (value)";
    const ifIndex = sourceText.indexOf("(");

    assert.equal(findPreviousNonWhitespaceIndex(sourceText, ifIndex, false), 1);
});

void test("findPreviousNonWhitespaceIndex honors line boundaries when requested", () => {
    const sourceText = "else\n  if (value)";
    const ifIndex = sourceText.indexOf("if");

    assert.equal(findPreviousNonWhitespaceIndex(sourceText, ifIndex, true), null);
    assert.equal(findPreviousNonWhitespaceIndex(sourceText, ifIndex, false), 3);
});

void test("findPreviousNonWhitespaceCharacter returns null when no prior token exists", () => {
    assert.equal(findPreviousNonWhitespaceCharacter("   \t", 2, false), null);
    assert.equal(findPreviousNonWhitespaceCharacter("x + y", 4, false), "+");
});

void test("findNextNonWhitespaceIndex skips whitespace and returns the closest token index", () => {
    const sourceText = "x + y";
    const spaceIndex = sourceText.indexOf(" ");

    assert.equal(findNextNonWhitespaceIndex(sourceText, spaceIndex), spaceIndex + 1);
});

void test("findNextNonWhitespaceIndex returns null when no trailing token exists", () => {
    assert.equal(findNextNonWhitespaceIndex("abc   ", 3), null);
    assert.equal(findNextNonWhitespaceIndex("abc", 3), null);
});

void test("rangeContainsCommentToken uses the prefix index to detect comment markers without rescanning", () => {
    const sourceText = [
        "value = 1;",
        'message = "not // a comment";',
        "score = 2; // inline",
        "/* banner */ total = 3;"
    ].join("\n");
    const commentTokenRangeIndex = createCommentTokenRangeIndex(sourceText);

    const plainStart = sourceText.indexOf("value = 1;");
    const plainEnd = plainStart + "value = 1;".length;
    const inlineStart = sourceText.indexOf("score = 2;");
    const inlineEnd = inlineStart + "score = 2; // inline".length;
    const blockStart = sourceText.indexOf("/* banner */");
    const blockEnd = blockStart + "/* banner */".length;

    assert.equal(rangeContainsCommentToken(commentTokenRangeIndex, plainStart, plainEnd), false);
    assert.equal(rangeContainsCommentToken(commentTokenRangeIndex, inlineStart, inlineEnd), true);
    assert.equal(rangeContainsCommentToken(commentTokenRangeIndex, blockStart, blockEnd), true);
});

void test("isAssignmentExpressionNodeWithOperator matches assignment nodes with accepted operators", () => {
    const node = {
        type: "AssignmentExpression",
        operator: "+=",
        left: { type: "Identifier", name: "count" },
        right: { type: "Literal", value: "1" }
    };

    assert.equal(isAssignmentExpressionNodeWithOperator(node, isIncrementAssignmentOperator), true);
});

void test("isAssignmentExpressionNodeWithOperator rejects non-assignment and missing-key candidates", () => {
    assert.equal(
        isAssignmentExpressionNodeWithOperator(
            {
                type: "AssignmentExpression",
                operator: "=",
                left: { type: "Identifier", name: "value" }
            },
            isSimpleAssignmentOperator
        ),
        false
    );
    assert.equal(
        isAssignmentExpressionNodeWithOperator(
            {
                type: "BinaryExpression",
                operator: "=",
                left: { type: "Identifier", name: "value" },
                right: { type: "Literal", value: "1" }
            },
            isSimpleAssignmentOperator
        ),
        false
    );
});

// ── Shared node type guard tests ──────────────────────────────────────

void test("isIdentifierNode accepts a well-formed Identifier node", () => {
    const node = { type: "Identifier", name: "count" };
    assert.equal(isIdentifierNode(node), true);
});

void test("isIdentifierNode rejects a node without a string name", () => {
    assert.equal(isIdentifierNode({ type: "Identifier" }), false);
    assert.equal(isIdentifierNode({ type: "Identifier", name: 42 }), false);
});

void test("isIdentifierNode rejects non-Identifier node types", () => {
    assert.equal(isIdentifierNode({ type: "Literal", value: "hello" }), false);
    assert.equal(isIdentifierNode(null), false);
    assert.equal(isIdentifierNode("string"), false);
    assert.equal(isIdentifierNode([{ type: "Identifier", name: "x" }]), false);
});

void test("isMemberIndexExpressionNode accepts a MemberIndexExpression node", () => {
    const node = { type: "MemberIndexExpression", object: {}, property: [{}], accessor: "[" };
    assert.equal(isMemberIndexExpressionNode(node), true);
});

void test("isMemberIndexExpressionNode accepts minimal MemberIndexExpression (type only)", () => {
    assert.equal(isMemberIndexExpressionNode({ type: "MemberIndexExpression" }), true);
});

void test("isMemberIndexExpressionNode rejects non-matching types and non-objects", () => {
    assert.equal(isMemberIndexExpressionNode({ type: "CallExpression" }), false);
    assert.equal(isMemberIndexExpressionNode(null), false);
    assert.equal(isMemberIndexExpressionNode(undefined), false);
    assert.equal(isMemberIndexExpressionNode(42), false);
});

void test("isVariableDeclaratorNode accepts a VariableDeclarator node", () => {
    const node = { type: "VariableDeclarator", id: { type: "Identifier", name: "x" }, init: null };
    assert.equal(isVariableDeclaratorNode(node), true);
});

void test("isVariableDeclaratorNode accepts minimal VariableDeclarator (type only)", () => {
    assert.equal(isVariableDeclaratorNode({ type: "VariableDeclarator" }), true);
});

void test("isVariableDeclaratorNode rejects non-matching types and non-objects", () => {
    assert.equal(isVariableDeclaratorNode({ type: "VariableDeclaration" }), false);
    assert.equal(isVariableDeclaratorNode(null), false);
    assert.equal(isVariableDeclaratorNode([]), false);
});

void test("isAssignmentExpressionNode accepts any assignment operator", () => {
    const equals = { type: "AssignmentExpression", operator: "=", left: {}, right: {} };
    const plusEquals = { type: "AssignmentExpression", operator: "+=", left: {}, right: {} };
    assert.equal(isAssignmentExpressionNode(equals), true);
    assert.equal(isAssignmentExpressionNode(plusEquals), true);
});

void test("isAssignmentExpressionNode accepts minimal AssignmentExpression (type only)", () => {
    assert.equal(isAssignmentExpressionNode({ type: "AssignmentExpression" }), true);
});

void test("isAssignmentExpressionNode rejects non-matching types and non-objects", () => {
    assert.equal(isAssignmentExpressionNode({ type: "BinaryExpression", operator: "=" }), false);
    assert.equal(isAssignmentExpressionNode(null), false);
    assert.equal(isAssignmentExpressionNode("AssignmentExpression"), false);
});

// ── Shared guard integration: collectIdentifierNamesInSubtree ─────────

void test("collectIdentifierNamesInSubtree uses the shared isIdentifierNode guard", () => {
    const ast = {
        type: "Program",
        body: [
            {
                type: "VariableDeclaration",
                declarations: [
                    {
                        type: "VariableDeclarator",
                        id: { type: "Identifier", name: "alpha" },
                        init: { type: "Identifier", name: "beta" }
                    }
                ]
            }
        ]
    };

    const names = collectIdentifierNamesInSubtree(ast);
    assert.deepEqual([...names].sort(), ["alpha", "beta"]);
});

// Helper that produces a minimal Rule.RuleContext stub for resolveLocFromIndex tests.
// The stub can optionally expose a getLocFromIndex implementation on sourceCode.
function createStubRuleContext(
    sourceText: string,
    getLocFromIndex?: (index: number) => { line: number; column: number } | undefined
): Rule.RuleContext {
    return {
        sourceCode: {
            text: sourceText,
            ...(getLocFromIndex === undefined ? {} : { getLocFromIndex })
        }
    } as unknown as Rule.RuleContext;
}

void test("resolveLocFromIndex returns line 1 column 0 for index 0 in a single-line source", () => {
    const context = createStubRuleContext("var x = 1;");
    const loc = resolveLocFromIndex(context, "var x = 1;", 0);
    assert.deepEqual(loc, { line: 1, column: 0 });
});

void test("resolveLocFromIndex advances to the correct column within line 1", () => {
    const context = createStubRuleContext("var x = 1;");
    // index 4 is the 'x' character on the first (and only) line
    const loc = resolveLocFromIndex(context, "var x = 1;", 4);
    assert.deepEqual(loc, { line: 1, column: 4 });
});

void test("resolveLocFromIndex increments line number after each newline", () => {
    const source = "line1\nline2\nline3";
    const context = createStubRuleContext(source);
    // index of the 'l' in 'line3' is 12
    const indexOfLine3 = source.indexOf("line3");
    const loc = resolveLocFromIndex(context, source, indexOfLine3);
    assert.deepEqual(loc, { line: 3, column: 0 });
});

void test("resolveLocFromIndex clamps a negative index to line 1 column 0", () => {
    const context = createStubRuleContext("abc");
    const loc = resolveLocFromIndex(context, "abc", -5);
    assert.deepEqual(loc, { line: 1, column: 0 });
});

void test("resolveLocFromIndex clamps an index beyond source length to the end", () => {
    const source = "abc";
    const context = createStubRuleContext(source);
    const loc = resolveLocFromIndex(context, source, 9999);
    assert.deepEqual(loc, { line: 1, column: source.length });
});

void test("resolveLocFromIndex prefers getLocFromIndex when it returns a valid location", () => {
    const source = "foo\nbar";
    const stubbedLoc = { line: 99, column: 42 };
    const context = createStubRuleContext(source, () => stubbedLoc);
    const loc = resolveLocFromIndex(context, source, 0);
    assert.deepEqual(loc, stubbedLoc);
});

void test("resolveLocFromIndex falls back to manual scan when getLocFromIndex returns undefined", () => {
    const source = "hello\nworld";
    const context = createStubRuleContext(source, () => undefined);
    // index of 'w' in 'world' is 6
    const loc = resolveLocFromIndex(context, source, 6);
    assert.deepEqual(loc, { line: 2, column: 0 });
});

void test("resolveLocFromIndex falls back to manual scan when getLocFromIndex returns non-finite coords", () => {
    const source = "hello\nworld";
    const context = createStubRuleContext(source, () => ({ line: Number.NaN, column: 0 }));
    const loc = resolveLocFromIndex(context, source, 6);
    assert.deepEqual(loc, { line: 2, column: 0 });
});
