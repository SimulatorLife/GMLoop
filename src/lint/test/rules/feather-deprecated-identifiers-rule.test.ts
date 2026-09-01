import assert from "node:assert/strict";
import test from "node:test";

import * as CoreWorkspace from "@gmloop/core";
import * as LintWorkspace from "@gmloop/lint";

import { clearDeprecatedIdentifierCatalogCache } from "../../src/services/deprecated-identifiers/index.js";
import { assertEquals } from "../assertions.js";
import { lintWithRule } from "./lint-rule-test-harness.js";

function resetDeprecatedMetadataState(): void {
    CoreWorkspace.Core.resetReservedIdentifierMetadataLoader();
    CoreWorkspace.Core.clearIdentifierMetadataCache();
    clearDeprecatedIdentifierCatalogCache();
}

test.afterEach(() => {
    resetDeprecatedMetadataState();
});

function withDeprecatedMetadata(metadata: Record<string, Record<string, unknown>>): void {
    CoreWorkspace.Core.setReservedIdentifierMetadataLoader(() => ({
        identifiers: metadata
    }));
    clearDeprecatedIdentifierCatalogCache();
}

void test("deprecated Feather rules are registered and recommended", () => {
    for (const ruleName of ["gm1017", "gm1023", "gm1024"]) {
        assert.ok(LintWorkspace.Lint.featherPlugin.rules[ruleName]);
        assertEquals(LintWorkspace.Lint.configs.recommended[1]?.rules[`feather/${ruleName}`], "warn");
    }
});

void test("gm1017 fixes safe direct deprecated function renames", () => {
    withDeprecatedMetadata({
        array_length_2d: {
            type: "function",
            deprecated: true,
            replacement: "array_length",
            replacementKind: "direct-rename",
            legacyUsage: "call",
            diagnosticOwner: "gml"
        }
    });

    const input = ["var count = array_length_2d(items);", ""].join("\n");
    const result = lintWithRule("gm1017", input, {}, LintWorkspace.Lint.featherPlugin.rules);

    assertEquals(result.messages.length, 1);
    assertEquals(result.messages[0]?.messageId, "diagnostic");
    assertEquals(result.output, ["var count = array_length(items);", ""].join("\n"));
});

void test("gm1017 fixes deprecated array API renames", () => {
    withDeprecatedMetadata({
        array_length_1d: {
            type: "function",
            deprecated: true,
            replacement: "array_length",
            replacementKind: "direct-rename",
            legacyUsage: "call",
            diagnosticOwner: "feather"
        },
        array_height_2d: {
            type: "function",
            deprecated: true,
            replacement: "array_height",
            replacementKind: "direct-rename",
            legacyUsage: "call",
            diagnosticOwner: "feather"
        }
    });

    const input = ["var count = array_length_1d(items);", "var height = array_height_2d(items);", ""].join("\n");
    const result = lintWithRule("gm1017", input, {}, LintWorkspace.Lint.featherPlugin.rules);

    assertEquals(result.messages.length, 2);
    assertEquals(
        result.output,
        ["var count = array_length(items);", "var height = array_height(items);", ""].join("\n")
    );
});

void test("gm1024 fixes safe direct deprecated built-in variable renames", () => {
    withDeprecatedMetadata({
        secure_mode: {
            type: "variable",
            deprecated: true,
            replacement: "security_enabled",
            replacementKind: "direct-rename",
            legacyUsage: "identifier",
            diagnosticOwner: "gml"
        }
    });

    const input = ["if (secure_mode) {", "    show_debug_message(secure_mode);", "}", ""].join("\n");
    const result = lintWithRule("gm1024", input, {}, LintWorkspace.Lint.featherPlugin.rules);

    assertEquals(result.messages.length, 2);
    assertEquals(
        result.output,
        ["if (security_enabled) {", "    show_debug_message(security_enabled);", "}", ""].join("\n")
    );
});

void test("gm1023 fixes deprecated constants", () => {
    withDeprecatedMetadata({
        os_win32: {
            type: "literal",
            deprecated: true,
            replacement: "os_windows",
            replacementKind: "direct-rename",
            legacyUsage: "identifier",
            diagnosticOwner: "feather"
        }
    });

    const input = ["if (os_type == os_win32) {", "    global.platform = os_win32;", "}", ""].join("\n");
    const result = lintWithRule("gm1023", input, {}, LintWorkspace.Lint.featherPlugin.rules);

    assertEquals(result.messages.length, 2);
    assertEquals(
        result.output,
        ["if (os_type == os_windows) {", "    global.platform = os_windows;", "}", ""].join("\n")
    );
});

void test("gm1024 reports indexed legacy globals without an unsafe fix", () => {
    withDeprecatedMetadata({
        background_index: {
            type: "variable",
            deprecated: true,
            replacementKind: "manual-migration",
            legacyCategory: "Backgrounds",
            legacyUsage: "indexed-identifier",
            diagnosticOwner: "gml"
        }
    });

    const input = ["background_index[0] = spr_sky;", ""].join("\n");
    const result = lintWithRule("gm1024", input, {}, LintWorkspace.Lint.featherPlugin.rules);

    assertEquals(result.messages.length, 1);
    assertEquals(result.output, input);
});

void test("deprecated Feather rules skip identifiers shadowed by local declarations", () => {
    withDeprecatedMetadata({
        secure_mode: {
            type: "variable",
            deprecated: true,
            replacement: "security_enabled",
            replacementKind: "direct-rename",
            legacyUsage: "identifier",
            diagnosticOwner: "gml"
        }
    });

    const input = ["var secure_mode = true;", "show_debug_message(secure_mode);", ""].join("\n");
    const result = lintWithRule("gm1024", input, {}, LintWorkspace.Lint.featherPlugin.rules);

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("gm1024 keeps reporting outer-scope deprecated identifiers when an inner function shadows them", () => {
    withDeprecatedMetadata({
        secure_mode: {
            type: "variable",
            deprecated: true,
            replacement: "security_enabled",
            replacementKind: "direct-rename",
            legacyUsage: "identifier",
            diagnosticOwner: "gml"
        }
    });

    const input = [
        "function demo() {",
        "    var secure_mode = true;",
        "    return secure_mode;",
        "}",
        "",
        "if (secure_mode) {",
        "    show_debug_message(secure_mode);",
        "}",
        ""
    ].join("\n");
    const result = lintWithRule("gm1024", input, {}, LintWorkspace.Lint.featherPlugin.rules);

    assertEquals(result.messages.length, 2);
    assertEquals(
        result.output,
        [
            "function demo() {",
            "    var secure_mode = true;",
            "    return secure_mode;",
            "}",
            "",
            "if (security_enabled) {",
            "    show_debug_message(security_enabled);",
            "}",
            ""
        ].join("\n")
    );
});

void test("removed duplicate GML rule IDs are absent from public surfaces", () => {
    const removedRuleNames = [
        "no-legacy-api",
        "normalize-data-structure-accessors",
        "require-trailing-optional-defaults",
        "prefer-repeat-loops"
    ];
    const catalogRuleIds = new Set(LintWorkspace.listLintRuleCatalogEntries().map((entry) => entry.ruleId));
    const configuredRuleIds = new Set(
        [
            LintWorkspace.Lint.configs.all,
            LintWorkspace.Lint.configs.recommended,
            LintWorkspace.Lint.configs.feather,
            LintWorkspace.Lint.configs.performance
        ].flatMap((configs) => configs.flatMap((config) => Object.keys(config.rules)))
    );

    for (const ruleName of removedRuleNames) {
        const fullRuleId = `gml/${ruleName}`;
        assertEquals(ruleName in LintWorkspace.Lint.plugin.rules, false);
        assertEquals(catalogRuleIds.has(fullRuleId), false);
        assertEquals(configuredRuleIds.has(fullRuleId), false);
    }

    assertEquals("GmlNoLegacyApi" in LintWorkspace.ruleIds, false);
    assertEquals("GmlNormalizeDataStructureAccessors" in LintWorkspace.ruleIds, false);
    assertEquals("GmlRequireTrailingOptionalDefaults" in LintWorkspace.ruleIds, false);
    assertEquals("GmlPreferRepeatLoops" in LintWorkspace.ruleIds, false);
});
