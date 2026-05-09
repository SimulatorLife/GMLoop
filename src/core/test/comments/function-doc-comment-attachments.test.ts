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

void test("Core.normalizeFunctionDocCommentAttachments attaches multiple comments to distinct targets without interference", () => {
    // Create a minimal AST where each comment is immediately adjacent to its function.
    // Indices are calculated from the actual joined source string so that
    // containsOnlyWhitespaceAndComments() returns true for every (comment → function) pair.
    //
    // Joined source: "/// @function foo()\nfunction foo() {}\n/// @function bar()\nfunction bar() {}\n"
    // Character breakdown:
    //   0-18: "/// @function foo()"   (commentA: indices 0-18)
    //   19:   "\n"
    //   20-33: "function foo() {}"    (functionFoo: indices 20-33)
    //   34:   "\n"
    //   35-53: "/// @function bar()"  (commentB: indices 35-53)
    //   54:   "\n"
    //   55-68: "function bar() {}"    (functionBar: indices 55-68)
    const commentA: CommentLike = {
        type: "CommentLine",
        value: "/// @function foo()",
        start: { index: 0 },
        end: { index: 19 }
    };
    const commentB: CommentLike = {
        type: "CommentLine",
        value: "/// @function bar()",
        start: { index: 35 },
        end: { index: 54 }
    };
    const functionFoo: FunctionNodeLike = {
        type: "FunctionDeclaration",
        start: { index: 20 },
        end: { index: 34 }
    };
    const functionBar: FunctionNodeLike = {
        type: "FunctionDeclaration",
        start: { index: 55 },
        end: { index: 69 }
    };
    const rootNode = {
        type: "Program",
        body: [functionFoo, functionBar]
    };
    // Must match the indices above exactly.
    const sourceText = `/// @function foo()\nfunction foo() {}\n/// @function bar()\nfunction bar() {}\n`;

    Core.normalizeFunctionDocCommentAttachments(rootNode, [commentA, commentB], sourceText);

    assert.deepStrictEqual(functionFoo.docComments, [commentA]);
    assert.deepStrictEqual(functionBar.docComments, [commentB]);
    assert.equal(commentA._gmlAttachedDocComment, true);
    assert.equal(commentB._gmlAttachedDocComment, true);
});

void test("Core.normalizeFunctionDocCommentAttachments handles repeated comment source without target interference", () => {
    // Use a shared reference object across multiple comment nodes to simulate the
    // kind of aliasing that could occur if the same comment is somehow processed
    // twice or if a comment node is reused across separate parse trees.
    //
    // Source text (with exact indices):
    //   "/// @function shared()\nfunction() {}\nfunction() {}\n"
    //   0-20: comment "/// @function shared()"  (start:0, end:21)
    //   21: "\n"
    //   22-34: "function() {}"  (firstFunction: start:22, end:35)
    //   35: "\n"
    //   36-48: "function() {}"  (secondFunction: start:36, end:49)
    const sharedComment: CommentLike = {
        type: "CommentLine",
        value: "/// @function shared()",
        start: { index: 0 },
        end: { index: 21 }
    };
    const firstFunction: FunctionNodeLike = {
        type: "FunctionDeclaration",
        start: { index: 22 },
        end: { index: 35 }
    };
    const secondFunction: FunctionNodeLike = {
        type: "FunctionDeclaration",
        start: { index: 36 },
        end: { index: 49 }
    };
    const rootNode = {
        type: "Program",
        body: [firstFunction, secondFunction]
    };
    // Must match the indices above exactly.
    const sourceText = "/// @function shared()\nfunction() {}\nfunction() {}\n";

    // Both comment references point to the same object; the function should only attach
    // one of them (the first reachable one) and the other should remain unattached.
    Core.normalizeFunctionDocCommentAttachments(rootNode, [sharedComment, sharedComment], sourceText);

    // Only one copy of the comment should be attached even when the same comment
    // node is processed twice via repeated references.
    const attachedCount = [firstFunction, secondFunction].reduce((count, fn) => {
        return count + (Array.isArray(fn.docComments) ? fn.docComments.length : 0);
    }, 0);
    assert.ok(attachedCount >= 1, "At least one function should have the comment attached");
    assert.ok(attachedCount <= 1, "Comment should be attached to at most one function");
});
