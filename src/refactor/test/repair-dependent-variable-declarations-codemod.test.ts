import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "../index.js";

const { applyRepairDependentVariableDeclarationsCodemod } = Refactor.RepairDependentVariableDeclarations;

void test("splits dependent comma-separated declarations in evaluation order", () => {
    const sourceText = [
        "function build(index) {",
        "    var nz_dir = index == 0 ? 1 : -1,",
        "        norm1 = [0, 0, nz_dir],",
        "        norm2 = scr_array_copy(norm1);",
        "    return norm2;",
        "}",
        ""
    ].join("\n");

    const result = applyRepairDependentVariableDeclarationsCodemod(sourceText);

    assert.equal(result.changed, true);
    assert.equal(
        result.outputText,
        [
            "function build(index) {",
            "    var nz_dir = index == 0 ? 1 : -1;",
            "        var norm1 = [0, 0, nz_dir];",
            "        var norm2 = scr_array_copy(norm1);",
            "    return norm2;",
            "}",
            ""
        ].join("\n")
    );
    assert.equal(result.appliedEdits.length, 1);
});

void test("preserves comments between dependent declarators", () => {
    const sourceText = "var first = 1 /* before */, // after\n    second = first;\n";
    const result = applyRepairDependentVariableDeclarationsCodemod(sourceText);

    assert.equal(result.outputText, "var first = 1 /* before */; // after\n    var second = first;\n");
});

void test("leaves independent declarations unchanged", () => {
    const sourceText = "var first = 1, second = 2;\n";
    const result = applyRepairDependentVariableDeclarationsCodemod(sourceText);

    assert.equal(result.changed, false);
    assert.equal(result.outputText, sourceText);
});

void test("leaves for initializers unchanged", () => {
    const sourceText = "for (var first = 1, second = first; second < 3; second++) { }\n";
    const result = applyRepairDependentVariableDeclarationsCodemod(sourceText);

    assert.equal(result.changed, false);
    assert.equal(result.outputText, sourceText);
});

void test("is idempotent and runs through configured codemod execution", async () => {
    const sourceText = "var first = 1, second = first;\n";
    const firstPass = applyRepairDependentVariableDeclarationsCodemod(sourceText);
    const secondPass = applyRepairDependentVariableDeclarationsCodemod(firstPass.outputText);

    assert.equal(secondPass.changed, false);

    const engine = new Refactor.RefactorEngine();
    const result = await engine.executeConfiguredCodemods({
        projectRoot: "/project",
        targetPaths: ["/project"],
        gmlFilePaths: ["scripts/example/example.gml"],
        config: {
            codemods: {
                repairDependentVariableDeclarations: {}
            }
        },
        readFile: async () => sourceText
    });

    assert.deepEqual(result.summaries, [
        {
            id: "repairDependentVariableDeclarations",
            changed: true,
            changedFiles: ["scripts/example/example.gml"],
            warnings: [],
            errors: []
        }
    ]);
});
