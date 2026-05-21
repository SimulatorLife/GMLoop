import { createHash } from "node:crypto";

import * as LintWorkspace from "@gmloop/lint";
import { Linter, type Linter as LinterTypes } from "eslint";

const { Lint } = LintWorkspace;

export const STILE_FIXTURE_URL = new URL("../../../../parser/test/input/stile.gml", import.meta.url);

type LinterVerifyMessage = ReturnType<Linter["verifyAndFix"]>["messages"][number];

export type TimedLintRunResult = Readonly<{
    elapsedMilliseconds: number;
    ruleMilliseconds: number;
    messages: ReadonlyArray<LinterVerifyMessage>;
    outputText: string;
}>;

export const STILE_OPTIMIZE_MATH_OUTPUT_HASH = "25c5f2d39f30aed9597fd4b2f78944fef837928236b2d787db3f1ac3a42253c1";

/**
 * Builds a batch of GML source lines with deeply nested loop-invariant expressions,
 * used to stress-test the `prefer-loop-invariant-expressions` rule.
 */
export function buildLoopInvariantStressBatchSource(loopCount: number, invariantTermsPerLoop: number): string {
    const lines: string[] = [];

    for (let loopIndex = 0; loopIndex < loopCount; loopIndex += 1) {
        let invariantExpression = `(a_${loopIndex}_0 + b_${loopIndex}_0)`;
        for (let termIndex = 1; termIndex < invariantTermsPerLoop; termIndex += 1) {
            invariantExpression = `(${invariantExpression} + (a_${loopIndex}_${termIndex} + b_${loopIndex}_${termIndex}))`;
        }

        lines.push(
            `repeat (count_${loopIndex}) {`,
            `    total_${loopIndex} += (${invariantExpression}) + random(3);`,
            "}"
        );
    }

    lines.push("");
    return lines.join("\n");
}

/**
 * Runs a single GML lint rule against `sourceText` using ESLint's in-process
 * `Linter` API in fix mode and returns wall-clock elapsed milliseconds,
 * reported messages, and the fixed output text.
 */
export async function lintSingleRuleWithTiming(
    ruleId: string,
    sourceText: string,
    filePath: string
): Promise<TimedLintRunResult> {
    const configEntry = {
        files: ["**/*.gml"],
        plugins: {
            gml: Lint.plugin
        },
        language: "gml/gml",
        rules: {
            [ruleId]: "warn"
        }
    } satisfies LinterTypes.Config;

    const linter = new Linter({ configType: "flat" });

    const startedAtNanoseconds = process.hrtime.bigint();
    const result = linter.verifyAndFix(sourceText, configEntry, {
        filename: filePath
    });
    const elapsedMilliseconds = Number(process.hrtime.bigint() - startedAtNanoseconds) / 1e6;

    return Object.freeze({
        elapsedMilliseconds,
        ruleMilliseconds: elapsedMilliseconds,
        messages: Object.freeze(result.messages),
        outputText: result.output
    });
}

/**
 * Returns a SHA-256 hex digest of `outputText`, used to pin expected fixed output
 * across runs without embedding the full source in the test file.
 */
export function createOutputHash(outputText: string): string {
    return createHash("sha256").update(outputText).digest("hex");
}

/**
 * Shared `node:test` options for sequential performance tests.
 */
export const SEQUENTIAL_PERFORMANCE_TEST_OPTIONS = Object.freeze({
    concurrency: false
});
