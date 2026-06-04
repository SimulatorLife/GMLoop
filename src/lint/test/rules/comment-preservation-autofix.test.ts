import assert from "node:assert/strict";
import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";
import { ruleIds } from "@gmloop/lint";
import { ESLint, type Linter } from "eslint";

import { lintWithRule } from "./lint-rule-test-harness.js";

function buildAllRuleLevels(): Linter.RulesRecord {
    return Object.fromEntries(Object.values(ruleIds).map((ruleId) => [ruleId, "error" satisfies Linter.RuleEntry]));
}

async function runAllRuleAutofixes(
    sourceText: string,
    rules: Linter.RulesRecord = buildAllRuleLevels()
): Promise<Readonly<{ output: string; messages: ReadonlyArray<Linter.LintMessage> }>> {
    const eslint = new ESLint({
        overrideConfigFile: true,
        fix: true,
        overrideConfig: [
            {
                files: ["**/*.gml"],
                plugins: {
                    gml: LintWorkspace.Lint.plugin,
                    feather: LintWorkspace.Lint.featherPlugin
                },
                language: "gml/gml",
                rules
            }
        ]
    });

    const [result] = await eslint.lintText(sourceText, {
        filePath: "comment-preservation.gml"
    });

    return Object.freeze({
        output: result.output ?? sourceText,
        messages: Object.freeze(result.messages)
    });
}

void test("optimize-logical-flow preserves block comments while rewriting nested branches", () => {
    const input = [
        "function move_actor() {",
        "    // Verlet integration, figure out the speed from the previous frame based on how far the player has moved",
        "    spd = pos.Sub(prevPos);",
        "",
        "    // Apply gravity to speed vector",
        "    if (longjump and (spd.Dot(upDir) > 0)) {",
        "        spd = spd.Sub(upDir.Mul(gravity_strength * 0.7));",
        "    } else {",
        "        spd = spd.Sub(upDir.Mul(gravity_strength));",
        "    }",
        "}",
        ""
    ].join("\n");

    const expected = [
        "function move_actor() {",
        "    // Verlet integration, figure out the speed from the previous frame based on how far the player has moved",
        "    spd = pos.Sub(prevPos);",
        "",
        "    // Apply gravity to speed vector",
        "    spd = longjump and spd.Dot(upDir) > 0 ? spd.Sub(upDir.Mul(gravity_strength * 0.7)) : spd.Sub(upDir.Mul(gravity_strength));",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("optimize-logical-flow", input, {});

    assert.equal(result.messages.length, 1);
    assert.equal(result.output, expected);
    assert.match(result.output, /\/\/ Verlet integration/u);
    assert.match(result.output, /\/\/ Apply gravity to speed vector/u);
});

void test("combined auto-fixes preserve comments from the InterplanetaryFootball diff scenario", async () => {
    const input = [
        "/// @description",
        "",
        "// Movement variables",
        "z = 1000;",
        "pos = new Vector3(x, y, z);",
        "",
        "move = function() {",
        "    // Verlet integration, figure out the speed from the previous frame based on how far the player has moved",
        "    spd = pos.Sub(prevPos);",
        "",
        "    // Update previous position so that it's ready for the next frame",
        "    prevPos = pos;",
        "",
        "    // Apply gravity to speed vector",
        "    if (longjump and (spd.Dot(upDir) > 0)) {",
        "        spd = spd.Sub(upDir.Mul(gravity_strength * 0.7));",
        "    } else {",
        "        spd = spd.Sub(upDir.Mul(gravity_strength));",
        "    }",
        "",
        "    // Apply input to speed vector",
        "    if (move_spd != 0) {",
        "        spd = spd.Add(input_vec.Mul(move_spd));",
        "    }",
        "",
        "    // Execute gravity function",
        "    if (is_callable(gravityFunction)) {",
        "        with (self) { // weird workaround that makes sure this object calls the function. FSM systems be weird like that.",
        "            targetUpDir = gravityFunction(pos);",
        "        }",
        "    }",
        "",
        "    // Update up-vector",
        "    var dp = max(0, upDir.Dot(targetUpDir));",
        "    var weight = 0.4 + ((1.2 * dp) * dp);",
        "    upDir = upDir.Add(targetUpDir.Mul(weight)).Normalize();",
        "};",
        "",
        "/// @description Updates ground_dist' each step",
        "update_ground_dist = function(ray_len = 128) {",
        "    if (ground) {",
        "        ground_dist = 0;",
        "    }",
        "};",
        ""
    ].join("\n");

    const result = await runAllRuleAutofixes(input, {
        "gml/optimize-logical-flow": "error",
        "gml/prefer-epsilon-comparisons": "error",
        "gml/optimize-math-expressions": "error",
        "gml/normalize-doc-comments": "error"
    });
    const { output } = result;

    assert.equal(result.messages.length, 0);
    assert.match(output, /\/\/ Movement variables/u);
    assert.match(
        output,
        /\/\/ Verlet integration, figure out the speed from the previous frame based on how far the player has moved/u
    );
    assert.match(output, /\/\/ Update previous position so that it's ready for the next frame/u);
    assert.match(output, /\/\/ Apply gravity to speed vector/u);
    assert.match(output, /\/\/ Apply input to speed vector/u);
    assert.match(output, /\/\/ Execute gravity function/u);
    assert.match(
        output,
        /\/\/ weird workaround that makes sure this object calls the function\. FSM systems be weird like that\./u
    );
    assert.match(output, /\/\/ Update up-vector/u);
    assert.match(
        output,
        /spd = longjump and spd\.Dot\(upDir\) > 0 \? spd\.Sub\(upDir\.Mul\(gravity_strength \* 0\.7\)\) : spd\.Sub\(upDir\.Mul\(gravity_strength\)\);/u
    );
    assert.match(output, /if \(abs\(move_spd\) > math_get_epsilon\(\)\) \{/u);
    assert.match(output, /var weight = 0\.4 \+ 1\.2 \* sqr\(dp\);/u);
    assert.match(output, /\/\/\/ @description Updates ground_dist' each step/u);
    assert.match(output, /\/\/\/ @param \[ray_len=128\]/u);
    assert.match(output, /\/\/\/ @returns \{undefined\}/u);
});
