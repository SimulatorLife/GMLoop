import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    gmlRuleAutofixServices,
    gmlRuleBaseHelpersServices,
    gmlRuleDeprecatedIdentifierServices,
    gmlRuleDocCommentServices,
    gmlRuleLanguageServices,
    gmlRuleMalformedServices,
    gmlRuleRegionDirectiveServices
} from "../../../src/rules/gml/gml-rule-services.js";

const FEATHER_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../src/rules/feather");

/**
 * Reads every TypeScript file under the feather rules directory so contract
 * assertions can cover the helpers, pattern module, and individual rule
 * factory files rather than only the registry entry point.
 */
async function readFeatherSourceFiles(): Promise<ReadonlyMap<string, string>> {
    const topLevelEntries = await readdir(FEATHER_DIRECTORY, { withFileTypes: true });
    const rulesEntries = await readdir(path.join(FEATHER_DIRECTORY, "rules"), { withFileTypes: true });
    const candidatePaths: Array<string> = [];
    for (const entry of topLevelEntries) {
        if (entry.isFile() && entry.name.endsWith(".ts")) {
            candidatePaths.push(path.join(FEATHER_DIRECTORY, entry.name));
        }
    }
    for (const entry of rulesEntries) {
        if (entry.isFile() && entry.name.endsWith(".ts")) {
            candidatePaths.push(path.join(FEATHER_DIRECTORY, "rules", entry.name));
        }
    }
    const sources = await Promise.all(
        candidatePaths.map(async (absolutePath) => [absolutePath, await readFile(absolutePath, "utf8")] as const)
    );
    return new Map(sources);
}

void test("gmlRuleDocCommentServices exposes the doc-comment contract needed by rules", () => {
    assert.equal(typeof gmlRuleDocCommentServices.convertLegacyReturnsDescriptionLineToMetadata, "function");
    assert.equal(typeof gmlRuleDocCommentServices.convertLegacyReturnsDescriptionLinesToMetadata, "function");
    assert.equal(typeof gmlRuleDocCommentServices.promoteLeadingDocCommentTextToDescription, "function");
    assert.equal(typeof gmlRuleDocCommentServices.normalizeDocParamName, "function");
});

void test("gmlRuleDeprecatedIdentifierServices exposes the deprecated-identifier contract needed by rules", () => {
    assert.equal(typeof gmlRuleDeprecatedIdentifierServices.getDeprecatedIdentifierCatalogEntry, "function");
});

void test("gmlRuleLanguageServices exposes the language contract needed by rules", () => {
    assert.equal(typeof gmlRuleLanguageServices.createLimitedRecoveryProjection, "function");
});

void test("gmlRuleMalformedServices exposes only token-level malformed contracts needed by rules", () => {
    assert.equal(typeof gmlRuleMalformedServices.forEachScientificNotationToken, "function");
    assert.equal(
        Object.hasOwn(gmlRuleMalformedServices, "recoverParseSourceFromMissingBrace"),
        false,
        "structural parse recovery must stay inside lint language parsing, not the rule-facing malformed service"
    );
});

void test("gml-rule-services contracts are frozen and cannot be mutated at runtime", () => {
    assert.ok(Object.isFrozen(gmlRuleDocCommentServices));
    assert.ok(Object.isFrozen(gmlRuleDeprecatedIdentifierServices));
    assert.ok(Object.isFrozen(gmlRuleLanguageServices));
    assert.ok(Object.isFrozen(gmlRuleMalformedServices));
    assert.ok(Object.isFrozen(gmlRuleBaseHelpersServices));
});

void test("gmlRuleAutofixServices exposes the autofix-printing contract needed by rules", () => {
    assert.equal(typeof gmlRuleAutofixServices.printExpression, "function");
    assert.equal(typeof gmlRuleAutofixServices.printNodeForAutofix, "function");
    assert.equal(typeof gmlRuleAutofixServices.readNodeText, "function");
});

void test("gml-rule-services gmlRuleAutofixServices is frozen and cannot be mutated at runtime", () => {
    assert.ok(Object.isFrozen(gmlRuleAutofixServices));
});

void test("gmlRuleBaseHelpersServices exposes the cross-domain helper contract needed by rules", () => {
    assert.equal(typeof gmlRuleBaseHelpersServices.findMatchingBraceEndIndex, "function");
    assert.equal(typeof gmlRuleBaseHelpersServices.resolveLocFromIndex, "function");
});

void test("gml-rule-services gmlRuleBaseHelpersServices is frozen and cannot be mutated at runtime", () => {
    assert.ok(Object.isFrozen(gmlRuleBaseHelpersServices));
});

void test("gmlRuleRegionDirectiveServices exposes the region-parsing contract needed by rules", () => {
    assert.equal(typeof gmlRuleRegionDirectiveServices.collectRegionSourceLines, "function");
    assert.equal(typeof gmlRuleRegionDirectiveServices.readRegionDirectiveType, "function");
    assert.equal(typeof gmlRuleRegionDirectiveServices.resolveRegionDirectiveLineEnding, "function");
});

void test("gml-rule-services gmlRuleRegionDirectiveServices is frozen and cannot be mutated at runtime", () => {
    assert.ok(Object.isFrozen(gmlRuleRegionDirectiveServices));
});

void test("feather rules depend on the doc-comment rule-services contract, not deep relative imports", async () => {
    const sources = await readFeatherSourceFiles();
    const aggregated = [...sources.values()].join("\n");

    assert.ok(
        aggregated.includes("gmlRuleDocCommentServices"),
        "Feather rule sources must consume gmlRuleDocCommentServices from the shared rule-services facade."
    );
    assert.ok(
        !/from\s+["']\.\.\/\.\.\/doc-comment\/normalize-param-name\.js["']/.test(aggregated),
        "Feather rule sources must not reach two directory levels into src/lint/src/doc-comment/ for normalizeDocParamName."
    );
});

void test("feather rules depend on the base-helper rule-services contract, not deep relative imports", async () => {
    const sources = await readFeatherSourceFiles();
    const aggregated = [...sources.values()].join("\n");

    assert.ok(
        aggregated.includes("gmlRuleBaseHelpersServices"),
        "Feather rule sources must consume gmlRuleBaseHelpersServices from the shared rule-services facade."
    );
    assert.ok(
        !/from\s+["']\.\.\/\.\.\/gml\/rule-base-helpers\.js["']/.test(aggregated),
        "Feather rule sources must not reach two directory levels into src/lint/src/rules/gml/ for rule-base-helpers."
    );
});

void test("feather rules depend on the region-directive rule-services contract, not deep relative imports", async () => {
    const sources = await readFeatherSourceFiles();
    const aggregated = [...sources.values()].join("\n");

    assert.ok(
        !/from\s+["']\.\.\/\.\.\/language\/region-directives\.js["']/.test(aggregated),
        "Feather rule sources must not reach into src/lint/src/language/region-directives.js; consume gmlRuleRegionDirectiveServices through the shared rule-services facade instead."
    );
});
