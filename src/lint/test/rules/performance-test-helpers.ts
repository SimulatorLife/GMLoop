import { createHash } from "node:crypto";

import * as LintWorkspace from "@gmloop/lint";
import { ESLint, type Linter } from "eslint";

const { Lint } = LintWorkspace;

export const STILE_FIXTURE_URL = new URL("../../../../parser/test/input/stile.gml", import.meta.url);

export type TimedLintRunResult = Readonly<{
    elapsedMilliseconds: number;
    ruleMilliseconds: number;
    messages: ReadonlyArray<ESLint.LintResult["messages"][number]>;
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
 * Runs a single GML lint rule against `sourceText` using ESLint in fix mode and
 * returns wall-clock elapsed milliseconds, ESLint rule timing, reported messages,
 * and the fixed output text.
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
    } satisfies Linter.Config;

    const eslint = new ESLint({
        overrideConfigFile: true,
        fix: true,
        stats: true,
        overrideConfig: [configEntry]
    });

    const startedAtNanoseconds = process.hrtime.bigint();
    const [result] = await eslint.lintText(sourceText, { filePath });
    const elapsedMilliseconds = Number(process.hrtime.bigint() - startedAtNanoseconds) / 1e6;

    const passTimings = result.stats?.times?.passes ?? [];
    const ruleMilliseconds = passTimings.reduce((accumulator, passTiming) => {
        return accumulator + (passTiming.rules[ruleId]?.total ?? 0);
    }, 0);

    return Object.freeze({
        elapsedMilliseconds,
        ruleMilliseconds,
        messages: Object.freeze(result.messages),
        outputText: result.output ?? sourceText
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
