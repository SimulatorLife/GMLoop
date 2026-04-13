import assert from "node:assert/strict";
import test from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { assertEquals, assertNotEquals } from "../assertions.js";

const { Lint } = LintWorkspace;

function assertIsFrozenObject(value: unknown, message: string) {
    assertEquals(typeof value, "object", `${message} should be an object`);
    assertNotEquals(value, null, `${message} should not be null`);
    assertEquals(Object.isFrozen(value), true, `${message} should be frozen`);
}

void test("Lint namespace exports plugin/configs/ruleIds/services and is deeply frozen at top level", () => {
    assertIsFrozenObject(Lint, "Lint");
    assertIsFrozenObject(Lint.plugin, "Lint.plugin");
    assertIsFrozenObject(Lint.featherPlugin, "Lint.featherPlugin");
    assertIsFrozenObject(Lint.configs, "Lint.configs");
    assertIsFrozenObject(Lint.ruleIds, "Lint.ruleIds");
    assertIsFrozenObject(Lint.services, "Lint.services");
});

void test("ruleIds contract keeps canonical ids with PascalCase keys", () => {
    const ruleIdEntries = Object.entries(Lint.ruleIds as Record<string, string>);
    assert.ok(ruleIdEntries.length > 0);

    for (const [mapKey, fullRuleId] of ruleIdEntries) {
        assert.match(mapKey, /^(?:Gml[A-Z]\w+|FeatherGM\d{4})$/, `Unexpected ruleIds key: ${mapKey}`);
        assert.match(fullRuleId, /^(?:gml|feather)\/.+$/, `Unexpected canonical full rule id: ${fullRuleId}`);
    }

    assertEquals((Lint.ruleIds as Record<string, string>).GmlNoGlobalvar, "gml/no-globalvar");
    assertEquals((Lint.ruleIds as Record<string, string>).GmlNoLegacyApi, "gml/no-legacy-api");
    assertEquals((Lint.ruleIds as Record<string, string>).GmlPreferArrayPush, "gml/prefer-array-push");
    assertEquals(
        (Lint.ruleIds as Record<string, string>).GmlPreferCompoundAssignments,
        "gml/prefer-compound-assignments"
    );
    assertEquals(
        (Lint.ruleIds as Record<string, string>).GmlPreferIncrementDecrementOperators,
        "gml/prefer-increment-decrement-operators"
    );
    assertEquals((Lint.ruleIds as Record<string, string>).GmlPreferDirectReturn, "gml/prefer-direct-return");
    assertEquals((Lint.ruleIds as Record<string, string>).GmlRemoveDefaultComments, "gml/remove-default-comments");
    assertEquals((Lint.ruleIds as Record<string, string>).FeatherGM1000, "feather/gm1000");
});

void test("config arrays are readonly FlatConfig[] values and share the pinned file glob", () => {
    const expectedGlob = Object.freeze(["**/*.gml"]);
    assert.deepEqual(expectedGlob, ["**/*.gml"]);

    const sets = [Lint.configs.recommended, Lint.configs.feather, Lint.configs.performance];
    for (const configSet of sets) {
        assert.ok(Array.isArray(configSet));
        assertEquals(Object.isFrozen(configSet), true);
        assert.ok(configSet.length > 0);
        for (const config of configSet) {
            assert.deepEqual(config.files, expectedGlob);
        }
    }

    const [recommendedGml, recommendedFeather] = Lint.configs.recommended;
    assertEquals(recommendedGml.language, "gml/gml");
    assert.deepEqual(recommendedGml.languageOptions, { recovery: "limited" });
    assertEquals(Object.isFrozen(recommendedGml.languageOptions), true);
    assertEquals(recommendedGml.plugins?.gml, Lint.plugin);
    assertEquals(recommendedGml.rules["gml/require-argument-separators"], "error");
    assertEquals(recommendedGml.rules["gml/no-empty-regions"], "warn");
    assertEquals(recommendedGml.rules["gml/no-legacy-api"], "warn");
    assertEquals(recommendedGml.rules["gml/no-scientific-notation"], "error");
    assertEquals(recommendedGml.rules["gml/prefer-array-push"], "warn");
    assertEquals(recommendedGml.rules["gml/prefer-compound-assignments"], "warn");
    assertEquals(recommendedGml.rules["gml/prefer-direct-return"], "warn");
    assertEquals(recommendedGml.rules["gml/prefer-increment-decrement-operators"], "warn");
    assertEquals(recommendedGml.rules["gml/prefer-loop-invariant-expressions"], "warn");
    assertEquals(recommendedGml.rules["gml/remove-default-comments"], "warn");
    assertEquals(recommendedGml.rules["gml/normalize-data-structure-accessors"], "warn");
    assertEquals(recommendedGml.rules["gml/require-region-pairs"], "error");
    assertEquals(recommendedGml.rules["gml/require-trailing-optional-defaults"], "warn");

    assertEquals(recommendedFeather.plugins?.feather, Lint.featherPlugin);
    assertEquals(recommendedFeather.language, undefined);
    assertEquals(recommendedFeather.languageOptions, undefined);
    assertEquals(recommendedFeather.rules["feather/gm1003"], "warn");
    assertEquals(recommendedFeather.rules["feather/gm1009"], "warn");
    assertEquals(recommendedFeather.rules["feather/gm1033"], "warn");
    assertEquals(recommendedFeather.rules["feather/gm1041"], "warn");
    assertEquals(recommendedFeather.rules["feather/gm2007"], "warn");
    assertEquals(recommendedFeather.rules["feather/gm2020"], "warn");
    assertEquals(Object.keys(recommendedFeather.rules).length, 6);

    const [featherOverlay] = Lint.configs.feather;
    assertEquals(featherOverlay.plugins?.feather, Lint.featherPlugin);
});

void test("feather overlay still exposes the full manifest independently of recommended", () => {
    const [featherOverlay] = Lint.configs.feather;
    const manifestRuleIds = Lint.services.featherManifest.entries.map((entry) => entry.ruleId);

    assertEquals(Object.keys(featherOverlay.rules).length, manifestRuleIds.length);
    for (const ruleId of manifestRuleIds) {
        assertEquals(featherOverlay.rules[ruleId], "warn", `${ruleId} should remain enabled in configs.feather`);
    }
});

void test("semver-sensitive lint constants are pinned", () => {
    assertEquals(Lint.services.featherManifest.schemaVersion, 1);
    assert.ok(Array.isArray(Lint.services.performanceOverrideRuleIds));
    assertEquals(Object.isFrozen(Lint.services.performanceOverrideRuleIds), true);
    for (const ruleId of Lint.services.performanceOverrideRuleIds) {
        assert.match(ruleId, /^(?:gml|feather)\/.+$/);
    }
});

void test("services namespace excludes project-aware analysis helpers", () => {
    const forbiddenServiceNames = [
        "createProjectAnalysisSnapshotFromProjectIndex",
        "createPrebuiltProjectAnalysisProvider",
        "createProjectLintContextRegistry",
        "createProjectSettingsFromRegistry",
        "defaultProjectIndexExcludes",
        "resolveNearestProjectRoot",
        "resolveForcedProjectRoot"
    ];

    for (const serviceName of forbiddenServiceNames) {
        assert.equal(serviceName in Lint.services, false, `${serviceName} must not be exported from Lint.services`);
    }
});

void test("feather namespace rule IDs are strictly feather/gm#### only", () => {
    const featherRuleShortNames = Object.keys(Lint.featherPlugin.rules);
    assert.ok(featherRuleShortNames.length > 0);
    for (const shortName of featherRuleShortNames) {
        assert.match(shortName, /^gm\d{4}$/u, `Unexpected feather rule short name: ${shortName}`);
    }
});

void test("Lint namespace does not expose internal doc-comment implementation helpers (target-state.md §2.3)", () => {
    // Internal doc-comment helpers must be imported directly from the
    // doc-comment module (src/lint/src/doc-comment/*.ts) rather than leaked
    // through the public Lint namespace.  The public surface is intentionally
    // limited to: plugin, featherPlugin, configs, ruleIds, services.
    assert.equal("normalizeLintRulesConfig" in Lint, false);
    assert.equal("createLintRuleEntriesFromProjectConfig" in Lint, false);
    assert.equal("projectConfig" in Lint.services, false);

    const forbiddenExports = [
        "collectSyntheticDocCommentLines",
        "collectLeadingProgramLineComments",
        "collectAdjacentLeadingSourceLineComments",
        "extractLeadingNonDocCommentLines",
        "resolveDocCommentTraversalService",
        "resolveDocCommentCollectionService",
        "resolveDocCommentPresenceService",
        "resolveDocCommentDescriptionService",
        "resolveDocCommentUpdateService",
        "buildDocumentedParamNameLookup",
        "extractDocumentedParamNames",
        "mergeSyntheticDocComments",
        "computeSyntheticFunctionDocLines",
        "convertLegacyReturnsDescriptionLinesToMetadata",
        "Malformed"
    ];

    for (const name of forbiddenExports) {
        assert.equal(
            name in Lint,
            false,
            `Lint must not expose internal helper '${name}'; use a direct import from the doc-comment module instead (target-state.md §2.3)`
        );
    }
});
