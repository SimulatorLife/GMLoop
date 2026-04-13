import assert from "node:assert/strict";
import test from "node:test";

import type { ESLint } from "eslint";

import { __lintCommandTest__ } from "../src/commands/lint.js";

const {
    aggregateLintTotals,
    createRetainedLintResult,
    collectOutOfRootFilePaths,
    formatPathSample,
    formatOutOfRootWarning,
    OUT_OF_ROOT_DISPLAY_LIMIT,
    emitLintCleanSummary
} = __lintCommandTest__;

// ---------------------------------------------------------------------------
// aggregateLintTotals
// ---------------------------------------------------------------------------

void test("aggregateLintTotals returns zero totals for an empty results array", () => {
    const totals = aggregateLintTotals([], { allowParseErrors: false });
    assert.equal(totals.errorCount, 0);
    assert.equal(totals.warningCount, 0);
});

void test("aggregateLintTotals sums errorCount across results", () => {
    const results = [
        { errorCount: 2, fatalErrorCount: 0, warningCount: 0, messages: [] },
        { errorCount: 3, fatalErrorCount: 0, warningCount: 0, messages: [] }
    ];
    const totals = aggregateLintTotals(results, { allowParseErrors: false });
    assert.equal(totals.errorCount, 5);
    assert.equal(totals.warningCount, 0);
});

void test("aggregateLintTotals folds fatalErrorCount into errorCount", () => {
    const results = [{ errorCount: 1, fatalErrorCount: 2, warningCount: 0, messages: [] }];
    const totals = aggregateLintTotals(results, { allowParseErrors: false });
    assert.equal(totals.errorCount, 3);
});

void test("aggregateLintTotals sums warningCount across results", () => {
    const results = [
        { errorCount: 0, fatalErrorCount: 0, warningCount: 4, messages: [] },
        { errorCount: 0, fatalErrorCount: 0, warningCount: 6, messages: [] }
    ];
    const totals = aggregateLintTotals(results, { allowParseErrors: false });
    assert.equal(totals.errorCount, 0);
    assert.equal(totals.warningCount, 10);
});

void test("aggregateLintTotals handles mixed errors, fatal errors, and warnings", () => {
    const results = [
        { errorCount: 1, fatalErrorCount: 1, warningCount: 2, messages: [] },
        { errorCount: 0, fatalErrorCount: 3, warningCount: 1, messages: [] }
    ];
    const totals = aggregateLintTotals(results, { allowParseErrors: false });
    assert.equal(totals.errorCount, 5); // 1+1 + 0+3
    assert.equal(totals.warningCount, 3); // 2 + 1
});

void test("aggregateLintTotals can ignore fatal parsing diagnostics for fix workflows", () => {
    const results = [
        {
            errorCount: 0,
            fatalErrorCount: 1,
            warningCount: 0,
            messages: [
                {
                    fatal: true as const,
                    message: "Parsing error: unexpected symbol",
                    line: 1,
                    column: 1,
                    ruleId: null,
                    severity: 2 as const
                }
            ]
        },
        {
            errorCount: 1,
            fatalErrorCount: 1,
            warningCount: 2,
            messages: [
                {
                    fatal: true as const,
                    message: "Occurred while linting file.gml",
                    line: 1,
                    column: 1,
                    ruleId: null,
                    severity: 2 as const
                }
            ]
        }
    ];
    const totals = aggregateLintTotals(results, { allowParseErrors: true });
    assert.equal(totals.errorCount, 2);
    assert.equal(totals.warningCount, 2);
});

void test("aggregateLintTotals ignores parse fatals when ESLint also increments errorCount", () => {
    const totals = aggregateLintTotals(
        [
            {
                errorCount: 1,
                fatalErrorCount: 1,
                warningCount: 0,
                messages: [
                    {
                        fatal: true as const,
                        message: "Parsing error: Syntax Error (line 1, column 1): unexpected symbol ';'",
                        line: 1,
                        column: 1,
                        ruleId: null,
                        severity: 2 as const
                    }
                ]
            }
        ],
        { allowParseErrors: true }
    );

    assert.equal(totals.errorCount, 0);
    assert.equal(totals.warningCount, 0);
});

void test("createRetainedLintResult drops heavyweight source payloads while preserving reporting fields", () => {
    const retained = createRetainedLintResult({
        filePath: "/tmp/example.gml",
        messages: [
            {
                ruleId: "gml/example",
                severity: 1,
                message: "example",
                line: 1,
                column: 1,
                nodeType: "Identifier",
                fix: {
                    range: [0, 1],
                    text: "x".repeat(10_000)
                },
                suggestions: [
                    {
                        desc: "replace",
                        fix: {
                            range: [0, 1],
                            text: "y".repeat(10_000)
                        }
                    }
                ]
            }
        ],
        suppressedMessages: [
            {
                ruleId: "gml/example-suppressed",
                severity: 1,
                message: "suppressed",
                line: 1,
                column: 1,
                nodeType: "Identifier",
                fix: {
                    range: [0, 1],
                    text: "z".repeat(10_000)
                },
                suggestions: []
            }
        ],
        errorCount: 1,
        fatalErrorCount: 0,
        warningCount: 2,
        fixableErrorCount: 1,
        fixableWarningCount: 2,
        usedDeprecatedRules: [],
        source: "var value = 1;",
        output: "var value = 2;"
    } as unknown as ESLint.LintResult);

    assert.deepEqual(retained, {
        filePath: "/tmp/example.gml",
        messages: [
            {
                ruleId: "gml/example",
                severity: 1,
                message: "example",
                line: 1,
                column: 1,
                nodeType: "Identifier"
            }
        ],
        suppressedMessages: [
            {
                ruleId: "gml/example-suppressed",
                severity: 1,
                message: "suppressed",
                line: 1,
                column: 1,
                nodeType: "Identifier"
            }
        ],
        errorCount: 1,
        fatalErrorCount: 0,
        warningCount: 2,
        fixableErrorCount: 1,
        fixableWarningCount: 2,
        usedDeprecatedRules: []
    });
    assert.equal("source" in retained, false);
    assert.equal("output" in retained, false);
    assert.equal("fix" in retained.messages[0], false);
    assert.equal("suggestions" in retained.messages[0], false);
    assert.equal("fix" in retained.suppressedMessages[0], false);
    assert.equal("suggestions" in retained.suppressedMessages[0], false);
});

// ---------------------------------------------------------------------------
// collectOutOfRootFilePaths
// ---------------------------------------------------------------------------

void test("collectOutOfRootFilePaths returns empty array when no results", () => {
    const paths = collectOutOfRootFilePaths([], "/project");
    assert.deepEqual(paths, []);
});

void test("collectOutOfRootFilePaths filters to only out-of-root paths", () => {
    const results = [
        { filePath: "/project/in-root.gml" },
        { filePath: "/other/file.gml" },
        { filePath: "/project/also-in-root.gml" },
        { filePath: "/remote/file.gml" }
    ];
    const paths = collectOutOfRootFilePaths(results, "/project");
    assert.deepEqual(paths, ["/other/file.gml", "/remote/file.gml"]);
});

void test("collectOutOfRootFilePaths returns all paths when all are out-of-root", () => {
    const results = [{ filePath: "/a/b.gml" }, { filePath: "/c/d.gml" }];
    const paths = collectOutOfRootFilePaths(results, "/project");
    assert.deepEqual(paths, ["/a/b.gml", "/c/d.gml"]);
});

void test("collectOutOfRootFilePaths returns empty array when all paths are in-root", () => {
    const results = [{ filePath: "/project/a.gml" }, { filePath: "/project/b.gml" }];
    const paths = collectOutOfRootFilePaths(results, "/project");
    assert.deepEqual(paths, []);
});

// ---------------------------------------------------------------------------
// formatPathSample
// ---------------------------------------------------------------------------

void test("formatPathSample joins paths with newlines when within display limit", () => {
    const output = formatPathSample(["/a.gml", "/b.gml", "/c.gml"]);
    assert.equal(output, "/a.gml\n/b.gml\n/c.gml");
});

void test("formatPathSample appends 'and N more...' when count exceeds display limit", () => {
    const paths = Array.from({ length: OUT_OF_ROOT_DISPLAY_LIMIT + 5 }, (_, i) => `/path/${i}.gml`);
    const output = formatPathSample(paths);
    assert.ok(output.includes("and 5 more..."), `expected suffix in: ${output}`);
});

void test("formatPathSample shows exactly OUT_OF_ROOT_DISPLAY_LIMIT paths in the sample", () => {
    const paths = Array.from({ length: OUT_OF_ROOT_DISPLAY_LIMIT + 3 }, (_, i) => `/path/${i}.gml`);
    const output = formatPathSample(paths);
    const lines = output.split("\n");
    const suffixIndex = lines.findIndex((l) => l.startsWith("and "));
    assert.equal(suffixIndex, OUT_OF_ROOT_DISPLAY_LIMIT);
});

void test("formatPathSample does not append suffix when count equals display limit exactly", () => {
    const paths = Array.from({ length: OUT_OF_ROOT_DISPLAY_LIMIT }, (_, i) => `/path/${i}.gml`);
    const output = formatPathSample(paths);
    assert.ok(!output.includes("more..."), "should not append suffix when count equals limit");
});

// ---------------------------------------------------------------------------
// formatOutOfRootWarning
// ---------------------------------------------------------------------------

void test("formatOutOfRootWarning prefixes with GML_PROJECT_OUT_OF_ROOT header", () => {
    const output = formatOutOfRootWarning(["/a/b.gml"]);
    assert.ok(output.startsWith("GML_PROJECT_OUT_OF_ROOT:\n"), `unexpected prefix in: ${output}`);
});

void test("formatOutOfRootWarning includes all paths and no suffix when within display limit", () => {
    const paths = ["/a.gml", "/b.gml", "/c.gml"];
    const output = formatOutOfRootWarning(paths);
    assert.ok(output.includes("/a.gml"));
    assert.ok(output.includes("/b.gml"));
    assert.ok(output.includes("/c.gml"));
    assert.ok(!output.includes("more..."), "should not append suffix when within limit");
});

void test("formatOutOfRootWarning delegates truncation to formatPathSample", () => {
    const paths = Array.from({ length: OUT_OF_ROOT_DISPLAY_LIMIT + 7 }, (_, i) => `/path/${i}.gml`);
    const output = formatOutOfRootWarning(paths);
    assert.ok(output.startsWith("GML_PROJECT_OUT_OF_ROOT:\n"));
    assert.ok(output.includes("and 7 more..."), `expected suffix in: ${output}`);
});

// ---------------------------------------------------------------------------
// emitLintCleanSummary
// ---------------------------------------------------------------------------

void test("emitLintCleanSummary logs singular 'file' label for fileCount of 1", () => {
    const logged: Array<string> = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
    };
    try {
        emitLintCleanSummary(1);
    } finally {
        console.log = original;
    }
    assert.equal(logged.length, 1);
    assert.match(logged[0], /✓ 1 file checked, no problems found\./);
});

void test("emitLintCleanSummary logs plural 'files' label for fileCount greater than 1", () => {
    const logged: Array<string> = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
    };
    try {
        emitLintCleanSummary(3);
    } finally {
        console.log = original;
    }
    assert.equal(logged.length, 1);
    assert.match(logged[0], /✓ 3 files checked, no problems found\./);
});
