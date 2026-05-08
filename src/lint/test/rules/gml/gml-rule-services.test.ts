import assert from "node:assert/strict";
import test from "node:test";

import {
    gmlRuleAutofixServices,
    gmlRuleDeprecatedIdentifierServices,
    gmlRuleDocCommentServices,
    gmlRuleLanguageServices,
    gmlRuleMalformedServices
} from "../../../src/rules/gml/gml-rule-services.js";

void test("gmlRuleDocCommentServices exposes the doc-comment contract needed by rules", () => {
    assert.equal(typeof gmlRuleDocCommentServices.convertLegacyReturnsDescriptionLinesToMetadata, "function");
    assert.equal(typeof gmlRuleDocCommentServices.promoteLeadingDocCommentTextToDescription, "function");
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
