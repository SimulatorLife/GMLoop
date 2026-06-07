import assert from "node:assert/strict";
import { test } from "node:test";

import { Core } from "@gmloop/core";

const { stripCommentsTransform } = Core;

void test("stripCommentsTransform removes comment nodes from AST", () => {
    const ast = {
        type: "Program",
        comments: [
            { type: "CommentLine", value: "// header comment" },
            { type: "CommentBlock", value: "/* block */" }
        ],
        body: [
            {
                type: "ExpressionStatement",
                comments: [{ type: "CommentLine", value: "// inline" }]
            }
        ]
    };

    stripCommentsTransform.transform(ast);

    // Root-level comments array is cleared
    assert.deepEqual((ast as any).comments, []);
    // Nested comment arrays are removed entirely
    assert.ok(!Object.hasOwn(ast.body[0], "comments"));
});

void test("stripCommentsTransform removes JSDoc properties when stripJsDoc is true", () => {
    const ast = {
        type: "FunctionDeclaration",
        doc: "function doc",
        docComment: "/** @param x */",
        jsdoc: { params: [] }
    };

    stripCommentsTransform.transform(ast, {
        stripComments: false,
        stripJsDoc: true,
        dropCommentedOutCode: false
    });

    assert.ok(!Object.hasOwn(ast, "doc"));
    assert.ok(!Object.hasOwn(ast, "docComment"));
    assert.ok(!Object.hasOwn(ast, "jsdoc"));
});

void test("stripCommentsTransform preserves non-comment nodes when stripComments is false", () => {
    const ast = {
        type: "Program",
        comments: [{ type: "CommentLine", value: "// keep me" }],
        body: []
    };

    stripCommentsTransform.transform(ast, {
        stripComments: false,
        stripJsDoc: false,
        dropCommentedOutCode: false
    });

    // Comments are left intact when stripComments is disabled
    assert.equal((ast as any).comments.length, 1);
});

void test("stripCommentsTransform filters only comment nodes from mixed comments arrays", () => {
    const nonCommentEntry = { type: "Annotation", value: "@someAnnotation" };
    const ast = {
        type: "Program",
        comments: [{ type: "CommentLine", value: "// remove" }, nonCommentEntry]
    };

    stripCommentsTransform.transform(ast);

    // The non-comment entry is preserved, the comment node is removed
    const remaining = (ast as any).comments as unknown[];
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0], nonCommentEntry);
});

void test("stripCommentsTransform returns the ast unchanged when given a non-object", () => {
    const result = stripCommentsTransform.transform(null);
    assert.equal(result, null);
});

void test("stripCommentsTransform has expected name and defaultOptions", () => {
    assert.equal(stripCommentsTransform.name, "strip-comments");
    assert.equal(stripCommentsTransform.defaultOptions.stripComments, true);
    assert.equal(stripCommentsTransform.defaultOptions.stripJsDoc, true);
    assert.equal(stripCommentsTransform.defaultOptions.dropCommentedOutCode, false);
});
