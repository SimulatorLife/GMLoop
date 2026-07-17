import assert from "node:assert/strict";
import { test } from "node:test";

import { Linter } from "eslint";

import { gmlRuleDefinitions } from "../../src/rules/catalog.js";
import { createGmlRule } from "../../src/rules/gml/create-gml-rules.js";
import {
    DEFAULT_MAX_CANONICAL_FORM_VALUE,
    DEFAULT_NUMERIC_LITERAL_EPSILON,
    MIN_OPTIMIZE_MATH_EPSILON,
    MIN_OPTIMIZE_MATH_MAX_CANONICAL_FORM_VALUE
} from "../../src/rules/gml/math/math-policy-constants.js";
import { DEFAULT_NUMERIC_LITERAL_POLICY } from "../../src/rules/gml/rules/optimize-math-skip-evaluator.js";
import { lintWithRule } from "./lint-rule-test-harness.js";

void test("optimize-math-expressions schema declares epsilon and maxCanonicalFormValue options", () => {
    const definition = gmlRuleDefinitions.find((entry) => entry.shortName === "optimize-math-expressions");
    assert.ok(definition, "expected optimize-math-expressions to be defined in the catalog");
    assert.ok(definition.schema, "expected schema to be declared for optimize-math-expressions");

    const [schema] = definition.schema as ReadonlyArray<Record<string, unknown>>;
    const properties = schema?.properties as Record<string, Record<string, unknown>>;
    assert.ok(properties, "expected schema to declare a properties object");

    assert.ok(properties.epsilon, "expected schema to expose epsilon option");
    assert.strictEqual(properties.epsilon.default, DEFAULT_NUMERIC_LITERAL_EPSILON);
    assert.strictEqual(properties.epsilon.minimum, MIN_OPTIMIZE_MATH_EPSILON);
    assert.strictEqual(properties.epsilon.exclusiveMinimum, 0);
    assert.strictEqual(properties.epsilon.type, "number");

    assert.ok(properties.maxCanonicalFormValue, "expected schema to expose maxCanonicalFormValue option");
    assert.strictEqual(properties.maxCanonicalFormValue.default, DEFAULT_MAX_CANONICAL_FORM_VALUE);
    assert.strictEqual(properties.maxCanonicalFormValue.minimum, MIN_OPTIMIZE_MATH_MAX_CANONICAL_FORM_VALUE);
    assert.strictEqual(properties.maxCanonicalFormValue.exclusiveMinimum, 0);
    assert.strictEqual(properties.maxCanonicalFormValue.type, "number");

    // additionalProperties must be `false` so unexpected options are rejected
    // by ESLint's option validator instead of silently ignored.
    assert.strictEqual(schema.additionalProperties, false);
});

void test("optimize-math-expressions schema defaults match DEFAULT_NUMERIC_LITERAL_POLICY", () => {
    // The rule must keep its schema defaults in lockstep with the runtime
    // default policy, otherwise users who omit options would observe a
    // different behaviour than rule callers that import the policy directly.
    const definition = gmlRuleDefinitions.find((entry) => entry.shortName === "optimize-math-expressions");
    assert.ok(definition);
    const [schema] = definition.schema as ReadonlyArray<Record<string, unknown>>;
    const properties = schema.properties as Record<string, Record<string, unknown>>;

    assert.strictEqual(properties.epsilon.default, DEFAULT_NUMERIC_LITERAL_POLICY.epsilon);
    assert.strictEqual(properties.maxCanonicalFormValue.default, DEFAULT_NUMERIC_LITERAL_POLICY.maxCanonicalFormValue);
});

void test("optimize-math-expressions rule module compiles with the documented schema", () => {
    // ESLint rejects rule modules whose meta.schema doesn't validate against
    // user-supplied options. Compiling the rule module here is the cheapest
    // way to catch accidental schema/runtime mismatches.
    const definition = gmlRuleDefinitions.find((entry) => entry.shortName === "optimize-math-expressions");
    assert.ok(definition);

    const rule = createGmlRule(definition);
    assert.equal(typeof rule.create, "function");
    assert.equal(typeof rule.meta, "object");
    assert.ok(Array.isArray(rule.meta.schema), "meta.schema should be an array");
});

void test("optimize-math-expressions accepts a tighter epsilon option without raising", () => {
    // Tightening the canonical-form epsilon should not break the rule. The
    // exact rewrite output may shift between options, but the rule must at
    // least run to completion and produce a diagnostic.
    const input = "half = size / 2;\n";

    const result = lintWithRule("optimize-math-expressions", input, {
        epsilon: 1e-12,
        maxCanonicalFormValue: 1e15
    });

    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0]?.messageId, "optimizeMathExpressions");
});

void test("optimize-math-expressions rejects epsilon overrides below the schema floor", () => {
    // ESLint applies the schema *before* invoking the rule, so values below
    // `minimum` must surface as a config-validation error rather than be
    // silently clamped. The `Linter` throws synchronously when a flat config
    // fails schema validation, so we assert that the throw happens.
    const definition = gmlRuleDefinitions.find((entry) => entry.shortName === "optimize-math-expressions");
    assert.ok(definition);

    const linter = new Linter();
    const config: import("eslint").Linter.Config = {
        plugins: {
            gmloop: {
                rules: {
                    "optimize-math-expressions": createGmlRule(definition)
                }
            }
        },
        rules: {
            "gmloop/optimize-math-expressions": ["error", { epsilon: 0 }]
        }
    };

    assert.throws(
        () => linter.verify("var x = 1;\n", config),
        /should be >= 1e-15/u,
        "expected ESLint to reject epsilon=0 with the schema floor"
    );
});

void test("optimize-math-expressions rejects maxCanonicalFormValue overrides below the schema floor", () => {
    const definition = gmlRuleDefinitions.find((entry) => entry.shortName === "optimize-math-expressions");
    assert.ok(definition);

    const linter = new Linter();
    const config: import("eslint").Linter.Config = {
        plugins: {
            gmloop: {
                rules: {
                    "optimize-math-expressions": createGmlRule(definition)
                }
            }
        },
        rules: {
            "gmloop/optimize-math-expressions": ["error", { maxCanonicalFormValue: 1 }]
        }
    };

    assert.throws(
        () => linter.verify("var x = 1;\n", config),
        /should be >= 1000000/u,
        "expected ESLint to reject maxCanonicalFormValue=1 with the schema floor"
    );
});
