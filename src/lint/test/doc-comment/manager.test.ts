import assert from "node:assert/strict";
import test from "node:test";

import {
    resolveDocCommentCollectionService,
    resolveDocCommentDescriptionService,
    resolveDocCommentPresenceService,
    resolveDocCommentTraversalService,
    resolveDocCommentUpdateService
} from "../../src/doc-comment/index.js";

void test("doc comment services are frozen and expose required methods", () => {
    const ast = { type: "Program", body: [] };

    const traversal = resolveDocCommentTraversalService(ast);
    const collection = resolveDocCommentCollectionService(ast);
    const presence = resolveDocCommentPresenceService(ast);
    const descriptions = resolveDocCommentDescriptionService(ast);
    const updates = resolveDocCommentUpdateService(ast);

    assert.ok(Object.isFrozen(traversal));
    assert.ok(Object.isFrozen(collection));
    assert.ok(Object.isFrozen(presence));
    assert.ok(Object.isFrozen(descriptions));
    assert.ok(Object.isFrozen(updates));

    assert.strictEqual(typeof traversal.forEach, "function");
    assert.strictEqual(typeof collection.getComments, "function");
    assert.strictEqual(typeof presence.hasDocComment, "function");
    assert.strictEqual(typeof descriptions.extractDescription, "function");
    assert.strictEqual(typeof updates.applyUpdates, "function");

    // All resolvers return the same cached manager — no per-facet wrappers.
    assert.strictEqual(traversal, collection);
    assert.strictEqual(collection, presence);
    assert.strictEqual(presence, descriptions);
    assert.strictEqual(descriptions, updates);
});

void test("doc comment services reuse cached views and tolerate missing AST", () => {
    const ast = { type: "Program", body: [] };

    const firstTraversal = resolveDocCommentTraversalService(ast);
    const secondTraversal = resolveDocCommentTraversalService(ast);
    const firstCollection = resolveDocCommentCollectionService(ast);
    const secondCollection = resolveDocCommentCollectionService(ast);
    const firstPresence = resolveDocCommentPresenceService(ast);
    const secondPresence = resolveDocCommentPresenceService(ast);
    const firstDescriptions = resolveDocCommentDescriptionService(ast);
    const secondDescriptions = resolveDocCommentDescriptionService(ast);
    const firstUpdates = resolveDocCommentUpdateService(ast);
    const secondUpdates = resolveDocCommentUpdateService(ast);

    assert.strictEqual(firstTraversal, secondTraversal);
    assert.strictEqual(firstCollection, secondCollection);
    assert.strictEqual(firstPresence, secondPresence);
    assert.strictEqual(firstDescriptions, secondDescriptions);
    assert.strictEqual(firstUpdates, secondUpdates);

    const noopTraversal = resolveDocCommentTraversalService(null);
    const noopCollection = resolveDocCommentCollectionService(null);
    const noopPresence = resolveDocCommentPresenceService();
    const noopDescriptions = resolveDocCommentDescriptionService();
    const noopUpdates = resolveDocCommentUpdateService();

    let visited = false;
    noopTraversal.forEach(() => {
        visited = true;
    });
    assert.strictEqual(visited, false);

    assert.deepStrictEqual(noopCollection.getComments({}), []);
    assert.strictEqual(noopPresence.hasDocComment({}), false);
    assert.strictEqual(noopDescriptions.extractDescription({}), null);
    assert.doesNotThrow(() => noopUpdates.applyUpdates(new Map()));
});

void test("doc comment collection tolerates sibling mutation during traversal", () => {
    const docComment = {
        type: "CommentLine",
        value: "/ @description mutated",
        start: { index: 25 }
    };

    const body = [];

    const secondFunction = {
        type: "FunctionDeclaration",
        start: { index: 30 },
        end: { index: 32 },
        body: []
    };

    const firstFunction = {
        type: "FunctionDeclaration",
        start: { index: 10 },
        end: { index: 12 },
        body: []
    };

    Object.defineProperty(firstFunction, "mutateDuringTraversal", {
        enumerable: true,
        get() {
            const removalIndex = body.indexOf(secondFunction);
            if (removalIndex !== -1) {
                body.splice(removalIndex, 1);
            }
            return null;
        }
    });

    body.push(firstFunction, secondFunction);

    const ast = {
        type: "Program",
        body,
        comments: [docComment]
    };

    const { getComments } = resolveDocCommentCollectionService(ast);

    assert.deepStrictEqual(getComments(firstFunction), []);
    assert.deepStrictEqual(getComments(secondFunction), [docComment]);
});
