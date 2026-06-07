import assert from "node:assert/strict";
import test from "node:test";

import { createCommentBlockNode, createCommentLineNode, createWhitespaceNode } from "../src/ast/comment-nodes.js";
import { createHiddenNodeProcessor } from "../src/ast/hidden-node-processor.js";

void test("createCommentLineNode strips leading markers and records metadata", () => {
    const token = { line: 5, start: 10, stop: 18 };
    const comment = createCommentLineNode({
        token,
        tokenText: "// example",
        leadingWS: "\n",
        leadingChar: ";"
    });

    assert.equal(comment.type, "CommentLine");
    assert.equal(comment.value, " example");
    assert.equal(comment.leadingWS, "\n");
    assert.equal(comment.leadingChar, ";");
    assert.equal(comment.trailingWS, "");
    assert.equal(comment.trailingChar, "");
    assert.deepEqual(comment.start, { line: 5, index: 10 });
    assert.deepEqual(comment.end, { line: 5, index: 18 });
});

void test("createCommentBlockNode tracks line count and boundaries", () => {
    const token = { line: 2, start: 4, stop: 25 };
    const comment = createCommentBlockNode({
        token,
        tokenText: "/* multi\nline */",
        leadingWS: "  ",
        leadingChar: "}"
    });

    assert.equal(comment.type, "CommentBlock");
    assert.equal(comment.value, " multi\nline ");
    assert.equal(comment.leadingWS, "  ");
    assert.equal(comment.leadingChar, "}");
    assert.equal(comment.lineCount, 2);
    assert.deepEqual(comment.start, { line: 2, index: 4 });
    assert.deepEqual(comment.end, { line: 3, index: 25 });
});

void test("createWhitespaceNode annotates newlines", () => {
    const token = { line: 7, start: 3, stop: 4 };
    const whitespace = createWhitespaceNode({
        token,
        tokenText: "\n",
        isNewline: true
    });

    assert.equal(whitespace.type, "Whitespace");
    assert.equal(whitespace.value, "\n");
    assert.equal(whitespace.line, 7);
    assert.equal(whitespace.isNewline, true);
    assert.deepEqual(whitespace.start, { line: 7, index: 3 });
    assert.deepEqual(whitespace.end, { line: 8, index: 4 });
});

void test("hidden node processor collects comments and whitespace", () => {
    const comments = [];
    const whitespaces = [];
    const lexerTokens = {
        EOF: 0,
        SingleLineComment: 1,
        MultiLineComment: 2,
        WhiteSpaces: 3,
        LineTerminator: 4,
        Identifier: 5
    };
    const processor = createHiddenNodeProcessor({
        comments,
        whitespaces,
        lexerTokens
    });

    const tokens = [
        {
            type: lexerTokens.SingleLineComment,
            text: "// first",
            line: 1,
            start: 0,
            stop: 7
        },
        {
            type: lexerTokens.WhiteSpaces,
            text: " ",
            line: 1,
            start: 8,
            stop: 8
        },
        {
            type: lexerTokens.MultiLineComment,
            text: "/* second */",
            line: 1,
            start: 9,
            stop: 20
        },
        {
            type: lexerTokens.LineTerminator,
            text: "\n",
            line: 1,
            start: 21,
            stop: 21
        },
        {
            type: lexerTokens.Identifier,
            text: "var",
            line: 2,
            start: 0,
            stop: 2
        },
        {
            type: lexerTokens.WhiteSpaces,
            text: "\n\n",
            line: 2,
            start: 3,
            stop: 4
        },
        {
            type: lexerTokens.SingleLineComment,
            text: "// trailing",
            line: 4,
            start: 0,
            stop: 10
        },
        { type: lexerTokens.EOF, text: "", line: 4, start: 11, stop: 11 }
    ];

    for (const token of tokens) {
        processor.processToken(token);
        if (processor.hasReachedEnd()) {
            break;
        }
    }

    assert.equal(comments.length, 3);
    assert.equal(whitespaces.length, 3);

    const [first, second, last] = comments;
    assert.equal(first.isTopComment, true);
    assert.equal(last.isBottomComment, true);
    assert.equal(second.leadingWS, " ");
    assert.equal(second.trailingWS, "\n");
    assert.equal(last.leadingChar, "r");
    assert.equal(last.trailingWS, "");
});

void test("hidden node processor does not emit debug logs", () => {
    const comments: Array<unknown> = [];
    const whitespaces: Array<unknown> = [];
    const lexerTokens = {
        EOF: 0,
        SingleLineComment: 1,
        MultiLineComment: 2,
        WhiteSpaces: 3,
        LineTerminator: 4,
        Identifier: 5
    };
    const processor = createHiddenNodeProcessor({
        comments,
        whitespaces,
        lexerTokens
    });

    const originalLog = console.log;
    const capturedLogs: Array<unknown[]> = [];
    console.log = (...args: Array<unknown>) => {
        capturedLogs.push(args);
    };

    try {
        processor.processToken({
            type: lexerTokens.SingleLineComment,
            text: "// comment",
            line: 1,
            start: 0,
            stop: 9
        });

        processor.processToken({
            type: lexerTokens.MultiLineComment,
            text: "/* block */",
            line: 1,
            start: 10,
            stop: 20
        });
    } finally {
        console.log = originalLog;
    }

    assert.equal(capturedLogs.length, 0);
    assert.equal(comments.length, 2);
    assert.equal(whitespaces.length, 0);
});

void test("hidden node processor initializes state with correct defaults", () => {
    const comments: Array<unknown> = [];
    const whitespaces: Array<unknown> = [];
    const lexerTokens = {
        EOF: 0,
        SingleLineComment: 1,
        MultiLineComment: 2,
        WhiteSpaces: 3,
        LineTerminator: 4,
        Identifier: 5
    };

    const processor = createHiddenNodeProcessor({
        comments,
        whitespaces,
        lexerTokens
    });

    assert.equal(processor.hasReachedEnd(), false);
});
