import assert from "node:assert/strict";
import { test } from "node:test";

import * as CoreWorkspace from "@gmloop/core";
import * as LintWorkspace from "@gmloop/lint";
import { ESLint } from "eslint";

import { clearDeprecatedIdentifierCatalogCache } from "../../src/services/deprecated-identifiers/index.js";

function resetDeprecatedMetadataState(): void {
    CoreWorkspace.Core.resetReservedIdentifierMetadataLoader();
    CoreWorkspace.Core.clearIdentifierMetadataCache();
    clearDeprecatedIdentifierCatalogCache();
}

test.afterEach(() => {
    resetDeprecatedMetadataState();
});

function createMutableRecommendedConfig(): Array<Record<string, unknown>> {
    return LintWorkspace.Lint.configs.recommended.map((config) => ({
        ...config,
        files: [...config.files],
        plugins: config.plugins ? { ...config.plugins } : undefined,
        rules: { ...config.rules }
    }));
}

void test("recommended config auto-fixes simplify-real-calls and no-legacy-api together", async () => {
    CoreWorkspace.Core.setReservedIdentifierMetadataLoader(() => ({
        identifiers: {
            array_length_2d: {
                type: "function",
                deprecated: true,
                replacement: "array_length",
                replacementKind: "direct-rename",
                legacyUsage: "call",
                diagnosticOwner: "gml"
            }
        }
    }));
    clearDeprecatedIdentifierCatalogCache();

    const sourceText = ['var total = real("5");', "var count = array_length_2d(items);", ""].join("\n");
    const recommendedConfig = createMutableRecommendedConfig();

    const eslint = new ESLint({
        overrideConfigFile: true,
        fix: true,
        overrideConfig: recommendedConfig
    });

    const [result] = await eslint.lintText(sourceText, {
        filePath: "recommended-config-autofix.gml"
    });

    assert.equal(result.output, ["var total = 5;", "var count = array_length(items);", ""].join("\n"));
    assert.equal(result.messages.length, 0);
});

void test("recommended config auto-fixes prefer-array-push and prefer-increment-decrement-operators together", async () => {
    const sourceText = [
        "var items = [];",
        "var total = 0;",
        "items[array_length(items)] = total;",
        "total += 1;",
        "self.hp -= 1;",
        ""
    ].join("\n");

    const eslint = new ESLint({
        overrideConfigFile: true,
        fix: true,
        overrideConfig: createMutableRecommendedConfig()
    });

    const [result] = await eslint.lintText(sourceText, {
        filePath: "recommended-config-autofix.gml"
    });

    assert.equal(
        result.output,
        ["var items = [];", "var total = 0;", "array_push(items, total);", "total++;", "self.hp--;", ""].join("\n")
    );
    assert.equal(result.messages.length, 0);
});

void test("recommended config auto-fixes malformed region pairs", async () => {
    const sourceText = ["#region This is my region", "var value = 1;", ""].join("\n");

    const eslint = new ESLint({
        overrideConfigFile: true,
        fix: true,
        overrideConfig: createMutableRecommendedConfig()
    });

    const [result] = await eslint.lintText(sourceText, {
        filePath: "recommended-config-regions.gml"
    });

    assert.equal(result.output, ["#region This is my region", "var value = 1;", "#endregion", ""].join("\n"));
    assert.equal(result.messages.length, 0);
});

void test("recommended config applies the conservative feather safe subset", async () => {
    const sourceText = [
        "enum Fruit {",
        '    APPLE = "10",',
        "}",
        "var flags = fa_readonly + fa_archive;",
        "var nextRoom = room + 1;",
        ";;;",
        'var actor = instance_create_layer(0, 0, "Instances", "obj_player");',
        "var counter",
        "all.hp = 0;",
        ""
    ].join("\n");

    const eslint = new ESLint({
        overrideConfigFile: true,
        fix: true,
        overrideConfig: createMutableRecommendedConfig()
    });

    const [result] = await eslint.lintText(sourceText, {
        filePath: "recommended-config-safe-feather.gml"
    });

    assert.equal(
        result.output,
        [
            "enum Fruit {",
            "    APPLE = 10",
            "}",
            "var flags = fa_readonly | fa_archive;",
            "var nextRoom = room_next(room);",
            'var actor = instance_create_layer(0, 0, "Instances", obj_player);',
            "var counter;",
            "with (all) {",
            "    hp = 0;",
            "}"
        ].join("\n")
    );
    assert.equal(result.messages.length, 0);
});
