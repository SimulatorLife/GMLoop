import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "../../index.js";

void describe("suppressTrailingLineComment", () => {
    void it("removes matching line comments from the owner comment list", () => {
        const node = {
            comments: [
                { type: "CommentLine", value: "keep", start: { line: 2 } },
                { type: "CommentLine", value: "remove", loc: { start: { line: 3 } } },
                { type: "CommentBlock", value: "retain", start: { line: 3 } }
            ]
        };

        Core.suppressTrailingLineComment(node, 3);

        assert.equal(node.comments.length, 2);
        assert.equal(node.comments[0]?.value, "keep");
        assert.equal(node.comments[1]?.type, "CommentBlock");
    });

    void it("falls back to the root when the owner has no comments", () => {
        const owner = {};
        const root = {
            comments: [{ type: "CommentLine", value: "root", start: { line: 7 } }]
        };

        Core.suppressTrailingLineComment(owner, 7, root);

        assert.equal(root.comments.length, 0);
    });
});

void describe("hasInlineCommentBetween", () => {
    void it("detects inline comments between sibling expressions from traversal context objects", () => {
        const sourceText = "alpha /* keep */ beta";
        const left = { start: { index: 0 }, end: { index: 4 } };
        const right = { start: { index: 17 }, end: { index: 20 } };

        assert.equal(Core.hasInlineCommentBetween(left, right, { sourceText }), true);
    });

    void it("accepts raw source strings and ignores whitespace-only gaps", () => {
        const sourceText = "alpha   beta";
        const left = { start: { index: 0 }, end: { index: 4 } };
        const right = { start: { index: 8 }, end: { index: 11 } };

        assert.equal(Core.hasInlineCommentBetween(left, right, sourceText), false);
    });

    void it("prefers originalText when both text fields are present", () => {
        const left = { start: { index: 0 }, end: { index: 4 } };
        const right = { start: { index: 17 }, end: { index: 20 } };

        assert.equal(
            Core.hasInlineCommentBetween(left, right, {
                sourceText: "alpha   beta",
                originalText: "alpha // keep\nbeta"
            }),
            true
        );
    });

    void it("does not report comments that begin at or after the right node boundary", () => {
        const sourceText = "alpha beta // trailing";
        const left = { start: { index: 0 }, end: { index: 4 } };
        const right = { start: { index: 10 }, end: { index: 13 } };

        assert.equal(Core.hasInlineCommentBetween(left, right, sourceText), false);
    });
});
