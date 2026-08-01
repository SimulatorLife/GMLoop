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

export const STILE_OPTIMIZE_MATH_OUTPUT_HASH = "898d2b6c1e4fa1edc3fdd4616739172c9fbcbb9409417e9e4dbb56b64fcb80a2";

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
 *
 * Use this helper when the test needs the rule's fixed output (for example, to
 * assert that a specific token appears in the rewritten source). When the test
 * only needs the rule's messages or to confirm that the rule skips a class of
 * inputs without applying any fixes, prefer {@link lintSingleRuleVerifyOnlyWithTiming}
 * which avoids `verifyAndFix`'s post-fix verification re-parse and runs the
 * rule in a single pass.
 */
export function lintSingleRuleWithTiming(ruleId: string, sourceText: string, filePath: string): TimedLintRunResult {
    const configEntry = createLintRuleConfigEntry(ruleId);

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
 * Result of {@link lintSingleRuleVerifyOnlyWithTiming}. Unlike
 * {@link TimedLintRunResult} this helper does not need to apply fixes, so it
 * does not capture a fixed output text — callers that only care about whether
 * the rule fired (or how long it took) can assert on `messages` directly.
 */
export type TimedLintVerifyRunResult = Readonly<{
    elapsedMilliseconds: number;
    ruleMilliseconds: number;
    messages: ReadonlyArray<LinterVerifyMessage>;
}>;

/**
 * Builds the shared lint flat-config entry used by the timing helpers. Lifted
 * out of {@link lintSingleRuleWithTiming} so the verify-only helper can reuse
 * the exact same rule wiring without duplicating literals.
 *
 * @param ruleId Single-rule id to enable under the `gml/gml` language.
 * @returns Flat config entry suitable for `Linter.verify` / `verifyAndFix`.
 */
function createLintRuleConfigEntry(ruleId: string): LinterTypes.Config {
    return {
        files: ["**/*.gml"],
        plugins: {
            gml: Lint.plugin
        },
        language: "gml/gml",
        rules: {
            [ruleId]: "warn"
        }
    } satisfies LinterTypes.Config;
}

/**
 * Runs a single GML lint rule against `sourceText` using ESLint's `verify`
 * API (single parse + rule pass) and returns wall-clock elapsed milliseconds
 * and the reported messages.
 *
 * This avoids the post-fix verification cycle that `linter.verifyAndFix` runs
 * after every fix pass. For "skip"-style performance regressions — where the
 * rule is expected to produce zero messages — using `verify` is functionally
 * equivalent to `verifyAndFix` (no fixes means output stays equal to the
 * input) but cuts roughly the re-verify cost from the timing measurement.
 */
export function lintSingleRuleVerifyOnlyWithTiming(
    ruleId: string,
    sourceText: string,
    filePath: string
): TimedLintVerifyRunResult {
    const configEntry = createLintRuleConfigEntry(ruleId);

    const linter = new Linter({ configType: "flat" });

    const startedAtNanoseconds = process.hrtime.bigint();
    const messages = linter.verify(sourceText, configEntry, {
        filename: filePath
    });
    const elapsedMilliseconds = Number(process.hrtime.bigint() - startedAtNanoseconds) / 1e6;

    return Object.freeze({
        elapsedMilliseconds,
        ruleMilliseconds: elapsedMilliseconds,
        messages: Object.freeze(messages)
    });
}

type LinterFix = NonNullable<LinterVerifyMessage["fix"]>;

/**
 * Applies ESLint-style non-overlapping fixes to a source string.
 *
 * Mirrors the algorithm ESLint uses in `SourceCodeFixer`:
 * - Sort fixes by `range[0]` ascending, with ties broken by `range[1]` descending.
 * - Skip any fix whose range starts inside the range of an already-applied fix.
 * - Track the right-edge of the last applied range so subsequent fix ranges
 *   (which were computed against the original source) don't shift into a
 *   region already written.
 *
 * @param sourceText Original source text the fix ranges were computed against.
 * @param fixes Sortable list of `Linter` fix descriptors.
 * @returns Source with all non-overlapping fixes applied.
 */
function applyNonOverlappingFixes(sourceText: string, fixes: ReadonlyArray<LinterFix>): string {
    if (fixes.length === 0) {
        return sourceText;
    }

    const sortedFixes = [...fixes].sort((left, right) => {
        if (left.range[0] !== right.range[0]) {
            return left.range[0] - right.range[0];
        }
        return right.range[1] - left.range[1];
    });

    let output = sourceText;
    let lastAppliedEnd = 0;

    for (const fix of sortedFixes) {
        const [start, end] = fix.range;
        if (start < lastAppliedEnd) {
            continue;
        }
        output = output.slice(0, start) + fix.text + output.slice(end);
        lastAppliedEnd = end;
    }

    return output;
}

/**
 * Runs a single GML lint rule against `sourceText` once via `linter.verify`,
 * then applies the rule's proposed fixes through a single deterministic pass
 * and returns both the resulting source and the elapsed timing.
 *
 * This is roughly twice as fast as {@link lintSingleRuleWithTiming} for rules
 * that produce fixes: it skips ESLint's `verifyAndFix` re-verification cycle,
 * which re-parses and re-runs the rule after every fix pass. The helper is
 * only sound for suites of non-overlapping fixes — when the rule's reported
 * fix ranges overlap, it transparently falls back to `verifyAndFix` to
 * preserve correctness.
 *
 * For coverage fidelity we additionally clear `messages` of any reports whose
 * fix was applied, matching `verifyAndFix`'s post-fix message semantics.
 */
export function lintSingleRuleWithTimingFastApply(
    ruleId: string,
    sourceText: string,
    filePath: string
): TimedLintRunResult {
    const configEntry = createLintRuleConfigEntry(ruleId);

    const linter = new Linter({ configType: "flat" });

    const startedAtNanoseconds = process.hrtime.bigint();
    const messages = linter.verify(sourceText, configEntry, { filename: filePath });
    const fixes = messages
        .map((message) => message.fix)
        .filter((fix): fix is LinterFix => fix !== null && fix !== undefined);

    if (hasOverlappingFixes(fixes)) {
        // Overlapping fixes need ESLint's full multi-pass verifyAndFix to apply
        // safely. Re-run with the slow path so the test still gets a correct
        // result; the timing measurement reflects only the slow run.
        const result = linter.verifyAndFix(sourceText, configEntry, { filename: filePath });
        const elapsedMilliseconds = Number(process.hrtime.bigint() - startedAtNanoseconds) / 1e6;
        return Object.freeze({
            elapsedMilliseconds,
            ruleMilliseconds: elapsedMilliseconds,
            messages: Object.freeze(result.messages),
            outputText: result.output
        });
    }

    const outputText = applyNonOverlappingFixes(sourceText, fixes);
    const fixedRangeSet = new Set(fixes.map((fix) => `${fix.range[0]}:${fix.range[1]}`));
    const remainingMessages = messages.filter(
        (message) => message.fix === null || !fixedRangeSet.has(`${message.fix.range[0]}:${message.fix.range[1]}`)
    );
    const elapsedMilliseconds = Number(process.hrtime.bigint() - startedAtNanoseconds) / 1e6;

    return Object.freeze({
        elapsedMilliseconds,
        ruleMilliseconds: elapsedMilliseconds,
        messages: Object.freeze(remainingMessages),
        outputText
    });
}

/**
 * Returns whether any pair of `fixes` overlaps in source range. Used to decide
 * whether a single-pass fix application is safe or the caller needs to fall
 * back to ESLint's multi-pass `verifyAndFix`.
 */
function hasOverlappingFixes(fixes: ReadonlyArray<LinterFix>): boolean {
    if (fixes.length < 2) {
        return false;
    }

    const sorted = [...fixes].sort((left, right) => left.range[0] - right.range[0]);
    let previousEnd = sorted[0]?.range[1] ?? 0;

    for (let index = 1; index < sorted.length; index += 1) {
        const fix = sorted[index];
        if (fix === undefined) {
            continue;
        }
        const [start] = fix.range;
        if (start < previousEnd) {
            return true;
        }
        previousEnd = Math.max(previousEnd, fix.range[1]);
    }
    return false;
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
    concurrency: false,
    timeout: 300_000
});
