import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import * as LintWorkspace from "@gmloop/lint";

import { assertEquals } from "../assertions.js";

type RuleMeta = Readonly<{
    docs: Readonly<Record<string, unknown>>;
    messages: Readonly<Record<string, string>>;
    schema: ReadonlyArray<unknown>;
    fixable?: "code" | "whitespace";
}>;

const expectedRules = Object.freeze([
    {
        shortName: "prefer-hoistable-loop-accessors",
        messageId: "preferHoistableLoopAccessor",
        schema: [
            {
                type: "object",
                additionalProperties: false,
                properties: {
                    minOccurrences: { type: "integer", minimum: 2, default: 2 },
                    functionSuffixes: {
                        type: "object",
                        additionalProperties: {
                            anyOf: [{ type: "string", minLength: 1 }, { type: "null" }]
                        }
                    },
                    reportUnsafe: { type: "boolean", default: true }
                }
            }
        ]
    },
    {
        shortName: "prefer-loop-invariant-expressions",
        messageId: "preferLoopInvariantExpressions",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "prefer-repeat-loops",
        messageId: "preferRepeatLoops",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "prefer-struct-literal-assignments",
        messageId: "preferStructLiteralAssignments",
        schema: [
            {
                type: "object",
                additionalProperties: false,
                properties: { reportUnsafe: { type: "boolean", default: true } }
            }
        ]
    },
    {
        shortName: "prefer-array-push",
        messageId: "preferArrayPush",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "prefer-compound-assignments",
        messageId: "preferCompoundAssignments",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "prefer-increment-decrement-operators",
        messageId: "preferIncrementDecrementOperators",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "prefer-direct-return",
        messageId: "preferDirectReturn",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "optimize-logical-flow",
        messageId: "optimizeLogicalFlow",
        schema: [
            {
                type: "object",
                additionalProperties: false,
                properties: { maxBooleanVariables: { type: "integer", minimum: 1, maximum: 10, default: 10 } }
            }
        ]
    },
    {
        shortName: "no-globalvar",
        messageId: "noGlobalvar",
        schema: []
    },
    {
        shortName: "no-empty-regions",
        messageId: "noEmptyRegions",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "no-legacy-api",
        messageId: "noLegacyApi",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "no-scientific-notation",
        messageId: "noScientificNotation",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "no-unnecessary-string-interpolation",
        messageId: "noUnnecessaryStringInterpolation",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "remove-default-comments",
        messageId: "removeDefaultComments",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "normalize-doc-comments",
        messageId: "normalizeDocComments",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "normalize-banner-comments",
        messageId: "normalizeBannerComments",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "normalize-directives",
        messageId: "normalizeDirectives",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "require-control-flow-braces",
        messageId: "requireControlFlowBraces",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "require-region-pairs",
        messageId: "requireRegionPairs",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "no-assignment-in-condition",
        messageId: "noAssignmentInCondition",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "prefer-is-undefined-check",
        messageId: "preferIsUndefinedCheck",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "prefer-epsilon-comparisons",
        messageId: "preferEpsilonComparisons",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "normalize-operator-aliases",
        messageId: "normalizeOperatorAliases",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "prefer-string-interpolation",
        messageId: "preferStringInterpolation",
        schema: [
            {
                type: "object",
                additionalProperties: false,
                properties: { reportUnsafe: { type: "boolean", default: true } }
            }
        ]
    },
    {
        shortName: "optimize-math-expressions",
        messageId: "optimizeMathExpressions",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "require-argument-separators",
        messageId: "requireArgumentSeparators",
        schema: [
            { type: "object", additionalProperties: false, properties: { repair: { type: "boolean", default: true } } }
        ]
    },
    {
        shortName: "normalize-data-structure-accessors",
        messageId: "normalizeDataStructureAccessors",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "require-trailing-optional-defaults",
        messageId: "requireTrailingOptionalDefaults",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "simplify-real-calls",
        messageId: "simplifyRealCalls",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    },
    {
        shortName: "no-unary-plus-on-identifier",
        messageId: "noUnaryPlusOnIdentifier",
        schema: [{ type: "object", additionalProperties: false, properties: {} }]
    }
]);

function getRuleMeta(ruleId: string): RuleMeta {
    const rule = LintWorkspace.Lint.plugin.rules[ruleId] as unknown as { meta: RuleMeta };
    return rule.meta;
}

function resolveSourceRoot(testDirectory: string): string {
    const candidates = [
        path.resolve(testDirectory, "../src"),
        path.resolve(testDirectory, "../../src"),
        path.resolve(testDirectory, "../../../src")
    ];
    const resolved = candidates.find((candidate) => existsSync(path.join(candidate, "language/recovery.ts")));
    if (!resolved) {
        throw new Error(`Unable to resolve lint source root from ${testDirectory}`);
    }

    return resolved;
}

void test("recommended baseline rules expose stable messageIds and exact schemas", () => {
    for (const ruleDefinition of expectedRules) {
        const rule = LintWorkspace.Lint.plugin.rules[ruleDefinition.shortName] as {
            meta?: { messages?: Record<string, string>; schema?: ReadonlyArray<unknown>; fixable?: string };
        };

        assertEquals(typeof rule.meta?.messages?.[ruleDefinition.messageId], "string");
        assert.deepEqual(rule.meta?.schema, ruleDefinition.schema);
        const expectedFixable = ruleDefinition.shortName === "no-globalvar" ? undefined : "code";
        assertEquals(rule.meta?.fixable, expectedFixable);
    }
});

void test("feather rules declare fixable metadata for autofix reports", () => {
    const allRuleIds = Object.values(LintWorkspace.Lint.ruleIds as Record<string, string>);
    for (const ruleId of allRuleIds) {
        if (!ruleId.startsWith("feather/")) {
            continue;
        }

        const shortName = ruleId.replace("feather/", "");
        assert.match(shortName, /^gm\d{4}$/u, `Unexpected feather rule id: ${ruleId}`);
        const rule = LintWorkspace.Lint.featherPlugin.rules[shortName] as { meta?: { fixable?: string } };
        assertEquals(rule.meta?.fixable, "code", `${ruleId} must set meta.fixable to 'code'`);
    }
});

void test("all gml rules are local-only and do not require project context", () => {
    for (const { shortName: ruleId } of expectedRules) {
        const { docs, messages } = getRuleMeta(ruleId);
        assertEquals(docs.requiresProjectContext, false, `${ruleId} should not require project context`);
        assertEquals("gml" in docs, false, `${ruleId} should not declare docs.gml metadata`);
        assertEquals(
            "missingProjectContext" in messages,
            false,
            `${ruleId} should not declare missingProjectContext message`
        );
    }
});

void test("all registered lint rules return non-empty listeners (no silent placeholder rules)", () => {
    const allRuleModules = {
        ...LintWorkspace.Lint.plugin.rules,
        ...LintWorkspace.Lint.featherPlugin.rules
    };

    for (const [ruleShortName, ruleModule] of Object.entries(allRuleModules)) {
        const listeners = ruleModule.create({
            options: [{}],
            settings: {},
            sourceCode: {
                text: "var value = 1;\n",
                parserServices: {
                    gml: {
                        filePath: "sample.gml"
                    }
                },
                getLocFromIndex: () => ({ line: 1, column: 0 })
            },
            report: () => undefined
        } as never);

        assertEquals(
            Object.keys(listeners).length > 0,
            true,
            `${ruleShortName} unexpectedly returned an empty listener object`
        );
    }
});

void test("only gml/require-argument-separators may consume inserted separator recovery metadata", () => {
    assert.ok(
        LintWorkspace.Lint.ruleIds.GmlRequireArgumentSeparators,
        "Expected require-argument-separators rule id to exist."
    );

    const testDirectory = path.dirname(fileURLToPath(import.meta.url));
    const sourceRoot = resolveSourceRoot(testDirectory);
    const rulesDirectory = path.join(sourceRoot, "rules");
    const recoveryDirectory = path.join(sourceRoot, "language");

    const recoveryModulePath = path.join(recoveryDirectory, "recovery.ts");
    const recoveryModuleSource = readFileSync(recoveryModulePath, "utf8");
    assertEquals(
        recoveryModuleSource.includes("INSERTED_ARGUMENT_SEPARATOR_KIND"),
        true,
        "Expected recovery contract constant to exist."
    );

    const queue = [rulesDirectory];
    const ruleSourceFilePaths: Array<string> = [];
    while (queue.length > 0) {
        const currentDirectory = queue.pop();
        if (!currentDirectory) {
            continue;
        }

        for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
            const entryPath = path.join(currentDirectory, entry.name);
            if (entry.isDirectory()) {
                queue.push(entryPath);
                continue;
            }

            if (entry.isFile() && entry.name.endsWith(".ts")) {
                ruleSourceFilePaths.push(entryPath);
            }
        }
    }

    const forbiddenReferences = ruleSourceFilePaths.filter((filePath) => {
        const source = readFileSync(filePath, "utf8");
        return (
            source.includes("INSERTED_ARGUMENT_SEPARATOR_KIND") ||
            source.includes("inserted-argument-separator") ||
            source.includes("InsertedArgumentSeparatorRecovery")
        );
    });

    assert.deepEqual(
        forbiddenReferences,
        [],
        "Recovery separator metadata must remain language-owned and not be consumed directly by unrelated rules."
    );
});
