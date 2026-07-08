import assert from "node:assert/strict";
import test from "node:test";

import {
    collectAdjacentLeadingSourceLineComments,
    collectLeadingProgramLineComments,
    collectSyntheticDocCommentLines,
    computeSyntheticFunctionDocLines,
    extractLeadingNonDocCommentLines,
    getArgumentIndexFromIdentifier,
    getArgumentIndexFromReferenceNode,
    getIdentifierFromParameterNode,
    mergeSyntheticDocComments,
    prepareDocCommentEnvironment,
    promoteLeadingDocCommentTextToDescription,
    reorderDescriptionLinesToTop,
    resolveParameterName
} from "../../src/doc-comment/index.js";

void test("transform doc-comment helpers remain reachable through the lint doc-comment barrel", () => {
    const expectedFunctions = [
        collectAdjacentLeadingSourceLineComments,
        collectLeadingProgramLineComments,
        collectSyntheticDocCommentLines,
        computeSyntheticFunctionDocLines,
        extractLeadingNonDocCommentLines,
        getArgumentIndexFromIdentifier,
        getArgumentIndexFromReferenceNode,
        getIdentifierFromParameterNode,
        mergeSyntheticDocComments,
        prepareDocCommentEnvironment,
        promoteLeadingDocCommentTextToDescription,
        reorderDescriptionLinesToTop,
        resolveParameterName
    ];

    for (const candidate of expectedFunctions) {
        assert.equal(typeof candidate, "function");
    }
});

void test("resolveParameterName reads the name from identifier-shaped parameters", () => {
    assert.equal(resolveParameterName({ type: "Identifier", name: "foo" }), "foo");
    assert.equal(resolveParameterName({ type: "Identifier", name: "_bar" }), "_bar");
    assert.equal(resolveParameterName(null), undefined);
});

void test("getArgumentIndexFromIdentifier parses argument-N names", () => {
    assert.equal(getArgumentIndexFromIdentifier("argument0"), 0);
    assert.equal(getArgumentIndexFromIdentifier("argument12"), 12);
    assert.equal(getArgumentIndexFromIdentifier("notArgument"), null);
    assert.equal(getArgumentIndexFromIdentifier(undefined), null);
});
