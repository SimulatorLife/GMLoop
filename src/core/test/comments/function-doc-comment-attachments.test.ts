import assert from "node:assert/strict";
import { test } from "node:test";

import { Core } from "../../index.js";

type CommentLike = {
    type: string;
    value: string;
    start: { index: number };
    end: { index: number };
    _gmlAttachedDocComment?: boolean;
};

type FunctionNodeLike = {
    type: string;
    start: { index: number };
    end: { index: number };
    docComments?: unknown[];
};

function createDocCommentFixture(functionStartIndex: number): {
    comment: CommentLike;
    functionNode: FunctionNodeLike;
    rootNode: { type: string; body: Array<FunctionNodeLike> };
} {
    const comment: CommentLike = {
        type: "CommentLine",
        value: "/// @function demo()",
        start: { index: 0 },
        end: { index: 19 }
    };
    const functionNode: FunctionNodeLike = {
        type: "FunctionDeclaration",
        start: { index: functionStartIndex },
        end: { index: functionStartIndex + 18 }
    };
    const rootNode = {
        type: "Program",
        body: [functionNode]
    };

    return { comment, functionNode, rootNode };
}

void test("Core.normalizeFunctionDocCommentAttachments attaches reachable function tag comments", () => {
    const { comment, functionNode, rootNode } = createDocCommentFixture(20);
    const sourceText = ["/// @function demo()", "function demo() {}", ""].join("\n");

    Core.normalizeFunctionDocCommentAttachments(rootNode, [comment], sourceText);

    assert.deepStrictEqual(functionNode.docComments, [comment]);
    assert.equal(comment._gmlAttachedDocComment, true);
});

void test("Core.normalizeFunctionDocCommentAttachments does not cross non-comment code when finding a target", () => {
    const { comment, functionNode, rootNode } = createDocCommentFixture(31);
    const sourceText = ["/// @function demo()", "var blocker = 1;", "function demo() {}", ""].join("\n");

    Core.normalizeFunctionDocCommentAttachments(rootNode, [comment], sourceText);

    assert.equal(functionNode.docComments, undefined);
    assert.equal(comment._gmlAttachedDocComment, undefined);
});
