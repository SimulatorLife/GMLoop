import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    gmlRuleAutofixServices,
    gmlRuleDeprecatedIdentifierServices,
    gmlRuleDocCommentServices,
    gmlRuleLanguageServices,
    gmlRuleMalformedServices
} from "../../../src/rules/gml/gml-rule-services.js";

const FEATHER_RULE_SOURCE_PATH = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../src/rules/feather/create-feather-rule.ts"
);

void test("gmlRuleDocCommentServices exposes the doc-comment contract needed by rules", () => {
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

void test("gmlRuleMalformedServices exposes the malformed contract needed by rules", () => {
    assert.equal(typeof gmlRuleMalformedServices.forEachScientificNotationToken, "function");
});

void test("gml-rule-services contracts are frozen and cannot be mutated at runtime", () => {
    assert.ok(Object.isFrozen(gmlRuleDocCommentServices));
    assert.ok(Object.isFrozen(gmlRuleDeprecatedIdentifierServices));
    assert.ok(Object.isFrozen(gmlRuleLanguageServices));
    assert.ok(Object.isFrozen(gmlRuleMalformedServices));
});

void test("gmlRuleAutofixServices exposes the autofix-printing contract needed by rules", () => {
    assert.equal(typeof gmlRuleAutofixServices.printExpression, "function");
    assert.equal(typeof gmlRuleAutofixServices.printNodeForAutofix, "function");
    assert.equal(typeof gmlRuleAutofixServices.readNodeText, "function");
});

void test("gml-rule-services gmlRuleAutofixServices is frozen and cannot be mutated at runtime", () => {
    assert.ok(Object.isFrozen(gmlRuleAutofixServices));
});

void test("create-feather-rule depends on the doc-comment rule-services contract, not deep relative imports", async () => {
    const source = await readFile(FEATHER_RULE_SOURCE_PATH, "utf8");

    assert.ok(
        source.includes("gmlRuleDocCommentServices"),
        "create-feather-rule.ts must consume gmlRuleDocCommentServices from the shared rule-services facade."
    );
    assert.ok(
        !/from\s+["']\.\.\/\.\.\/doc-comment\/normalize-param-name\.js["']/.test(source),
        "create-feather-rule.ts must not reach two directory levels into src/lint/src/doc-comment/ for normalizeDocParamName."
    );
});
