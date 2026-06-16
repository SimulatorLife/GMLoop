import assert from "node:assert/strict";
import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";
import { ESLint } from "eslint";

function createRuleConfig(rules: Readonly<Record<string, "warn">>): Array<Record<string, unknown>> {
    return [
        {
            files: ["**/*.gml"],
            language: "gml/gml",
            plugins: {
                gml: LintWorkspace.Lint.plugin,
                feather: LintWorkspace.Lint.featherPlugin
            },
            rules
        }
    ];
}

async function lintSource(
    sourceText: string,
    rules: Readonly<Record<string, "warn">>,
    fix: boolean
): Promise<ESLint.LintResult> {
    const eslint = new ESLint({
        overrideConfigFile: true,
        fix,
        overrideConfig: createRuleConfig(rules)
    });
    const [result] = await eslint.lintText(sourceText, { filePath: "conflict-precedence.gml" });
    return result;
}

void test("conflict registry records Feather-owned overlaps without stripping Feather fixes", () => {
    const conflictsByRuleId = new Map(
        LintWorkspace.Lint.services.featherManifest.entries.map((entry) => [entry.ruleId, entry.conflictingGmlRuleIds])
    );

    assert.deepEqual(conflictsByRuleId.get("feather/gm1062"), ["gml/normalize-doc-comments"]);
    assert.deepEqual(conflictsByRuleId.get("feather/gm2061"), []);
    assert.equal(LintWorkspace.Lint.featherPlugin.rules.gm1062.meta?.fixable, "code");
    assert.equal(LintWorkspace.Lint.featherPlugin.rules.gm2061.meta?.fixable, "code");
});

void test("documentation conflict reports in both namespaces and Feather owns the official diagnostic fix", async () => {
    const sourceText = [
        "/// @function example",
        "/// @param {String} value - description",
        "/// @desc Example function.",
        "function example(value) {",
        "    return value;",
        "}",
        ""
    ].join("\n");
    const bothRules = {
        "gml/normalize-doc-comments": "warn",
        "feather/gm1062": "warn"
    } as const;

    const diagnosticResult = await lintSource(sourceText, bothRules, false);
    assert.deepEqual(
        new Set(diagnosticResult.messages.map((message) => message.ruleId)),
        new Set(["gml/normalize-doc-comments", "feather/gm1062"])
    );

    const featherResult = await lintSource(sourceText, { "feather/gm1062": "warn" }, true);
    assert.notEqual(featherResult.output, undefined);
    assert.notEqual(featherResult.output, sourceText);

    const gmlResult = await lintSource(sourceText, { "gml/normalize-doc-comments": "warn" }, true);
    assert.notEqual(gmlResult.output, undefined);
    assert.notEqual(gmlResult.output, sourceText);
});

void test("migrated logical-flow nullish fix is owned only by Feather GM2061", async () => {
    const sourceText = ["array = modify_array(array);", "if (array == undefined) array = [];", ""].join("\n");
    const bothRules = {
        "gml/optimize-logical-flow": "warn",
        "feather/gm2061": "warn"
    } as const;

    const diagnosticResult = await lintSource(sourceText, bothRules, false);
    assert.deepEqual(
        new Set(diagnosticResult.messages.map((message) => message.ruleId)),
        new Set(["feather/gm2061"])
    );

    const featherResult = await lintSource(sourceText, { "feather/gm2061": "warn" }, true);
    assert.equal(featherResult.output, "array = modify_array(array) ?? [];\n");

    const firstPass = await lintSource(sourceText, bothRules, true);
    assert.equal(firstPass.output, "array = modify_array(array) ?? [];\n");
    assert.equal(firstPass.messages.length, 0);

    const secondPass = await lintSource(firstPass.output, bothRules, true);
    assert.equal(secondPass.output, undefined);
    assert.equal(secondPass.messages.length, 0);
});
