import assert from "node:assert/strict";
import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { runGmlRule } from "./rule-test-harness.js";

function runNormalizeDocCommentsRule(code: string, programNode: Record<string, unknown>): string {
    return runGmlRule({
        rule: LintWorkspace.Lint.plugin.rules["normalize-doc-comments"],
        code,
        programNode
    }).output;
}

function createProgramForMultilineDefaultFunction(code: string): Record<string, unknown> {
    const functionStart = code.indexOf("function bake");
    const matrixStart = code.indexOf("matrix =");
    const matrixEnd = code.indexOf("), mask");
    const maskStart = code.indexOf("mask = 0");
    const maskEnd = code.indexOf(") {", maskStart);

    assert.notEqual(functionStart, -1);
    assert.notEqual(matrixStart, -1);
    assert.notEqual(matrixEnd, -1);
    assert.notEqual(maskStart, -1);
    assert.notEqual(maskEnd, -1);

    return {
        type: "Program",
        body: [
            {
                type: "FunctionDeclaration",
                id: { type: "Identifier", name: "bake" },
                params: [
                    { type: "Identifier", name: "aab" },
                    {
                        type: "DefaultParameter",
                        left: { type: "Identifier", name: "matrix" },
                        range: [matrixStart, matrixEnd + 1]
                    },
                    {
                        type: "DefaultParameter",
                        left: { type: "Identifier", name: "mask" },
                        range: [maskStart, maskEnd]
                    }
                ],
                body: { type: "BlockStatement", body: [] },
                range: [functionStart, code.length],
                start: functionStart,
                end: code.length
            }
        ]
    };
}

void test("normalize-doc-comments omits multiline default values from generated @param tags", () => {
    const input = [
        "function bake(aab, matrix = matrix_build_identity(",
        "), mask = 0) {",
        "    return matrix;",
        "}"
    ].join("\n");

    const output = runNormalizeDocCommentsRule(input, createProgramForMultilineDefaultFunction(input));

    assert.match(output, /^\/\/\/ @param aab$/m);
    assert.match(output, /^\/\/\/ @param \[matrix\]$/m);
    assert.match(output, /^\/\/\/ @param \[mask=0\]$/m);
    assert.doesNotMatch(output, /^\/\/\/ @param \[matrix=matrix_build_identity\($/m);
    assert.doesNotMatch(output, /^\)\]$/m);
});
