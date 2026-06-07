import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "../index.js";

const { applyDocCommentAlignmentCodemod } = Refactor.DocCommentAlignment;

void test("applyDocCommentAlignmentCodemod aligns doc @param names and order", () => {
    const sourceText = [
        "/// @param oldName old value",
        "/// @param y y value",
        "function sample(x, y) {",
        "    return x + y;",
        "}",
        ""
    ].join("\n");
    const result = applyDocCommentAlignmentCodemod(sourceText);
    assert.equal(result.changed, true);
    assert.equal(
        result.outputText,
        [
            "/// @param x old value",
            "/// @param y y value",
            "function sample(x, y) {",
            "    return x + y;",
            "}",
            ""
        ].join("\n")
    );
});

void test("applyDocCommentAlignmentCodemod marks defaulted params as optional", () => {
    const sourceText = [
        "/// @param count item count",
        "/// @param mode operation mode",
        'function sample(count, mode = "fast") {',
        "    return mode;",
        "}",
        ""
    ].join("\n");
    const result = applyDocCommentAlignmentCodemod(sourceText);
    assert.equal(result.changed, true);
    assert.equal(
        result.outputText,
        [
            "/// @param count item count",
            "/// @param [mode] operation mode",
            'function sample(count, mode = "fast") {',
            "    return mode;",
            "}",
            ""
        ].join("\n")
    );
});

void test("executeConfiguredCodemods runs docCommentAlignment codemod", async () => {
    const sourceText = [
        "/// @param b value b",
        "/// @param a value a",
        "function sample(a, b) {",
        "    return a + b;",
        "}",
        ""
    ].join("\n");
    const engine = new Refactor.RefactorEngine();
    const result = await engine.executeConfiguredCodemods({
        projectRoot: "/project",
        targetPaths: ["/project"],
        gmlFilePaths: ["scripts/example.gml"],
        config: {
            codemods: {
                docCommentAlignment: {}
            }
        },
        readFile: async () => sourceText
    });

    assert.deepEqual(result.summaries, [
        {
            id: "docCommentAlignment",
            changed: true,
            changedFiles: ["scripts/example.gml"],
            warnings: [],
            errors: []
        }
    ]);
    assert.match(result.appliedFiles.get("scripts/example.gml") ?? "", /@param a value a/);
    assert.match(result.appliedFiles.get("scripts/example.gml") ?? "", /@param b value b/);
});
