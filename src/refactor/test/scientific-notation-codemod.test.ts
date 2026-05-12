import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "../index.js";

const { applyScientificNotationCodemod } = Refactor.ScientificNotation;

void test("applyScientificNotationCodemod expands scientific literals in code", () => {
    const sourceText = "var tiny = 1e-3;\nvar huge = 2.5E+3;\n";
    const result = applyScientificNotationCodemod(sourceText);
    assert.equal(result.changed, true);
    assert.equal(result.outputText, "var tiny = 0.001;\nvar huge = 2500;\n");
    assert.equal(result.appliedEdits.length, 2);
});

void test("applyScientificNotationCodemod ignores scientific-looking text in comments and strings", () => {
    const sourceText = 'var text = "1e-6";\n// 9e+2 in comment\nvar value = 4;\n';
    const result = applyScientificNotationCodemod(sourceText);
    assert.equal(result.changed, false);
    assert.equal(result.outputText, sourceText);
});

void test("executeConfiguredCodemods runs scientificNotation codemod", async () => {
    const engine = new Refactor.RefactorEngine();
    const result = await engine.executeConfiguredCodemods({
        projectRoot: "/project",
        targetPaths: ["/project"],
        gmlFilePaths: ["scripts/example.gml"],
        config: {
            codemods: {
                scientificNotation: {}
            }
        },
        readFile: async () => "return 6.2e-4;\n"
    });

    assert.deepEqual(result.summaries, [
        {
            id: "scientificNotation",
            changed: true,
            changedFiles: ["scripts/example.gml"],
            warnings: [],
            errors: []
        }
    ]);
    assert.equal(result.appliedFiles.get("scripts/example.gml"), "return 0.00062;\n");
});
