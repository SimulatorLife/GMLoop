import assert from "node:assert/strict";
import test from "node:test";

import { ESLint } from "eslint";

import { Lint } from "../../src/index.js";

void test("feather/gm2031 does not loop when close already precedes open", { timeout: 5000 }, async () => {
    const eslint = new ESLint({
        overrideConfigFile: true,
        fix: true,
        overrideConfig: [
            {
                files: ["**/*.gml"],
                plugins: {
                    feather: Lint.featherPlugin,
                    gml: Lint.plugin
                },
                language: "gml/gml",
                languageOptions: {
                    recovery: "limited"
                },
                rules: {
                    "feather/gm2031": "error"
                }
            }
        ]
    });

    const source = ["file_find_close();", '_file2 = file_find_first("*.txt", fa_readonly);'].join("\n");

    const [result] = await eslint.lintText(source, { filePath: "gm2031-regression.gml" });
    assert.equal(result.output ?? source, source);
});
