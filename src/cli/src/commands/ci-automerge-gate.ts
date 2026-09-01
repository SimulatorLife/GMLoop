import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const BUILD_FILE = "build-evidence.json";
const REPORT_FILE = "auto-merge-report.json";
const MANIFEST_FILE = "test-manifest.json";
const LINT_FILE = "eslint.json";
const CASES_FILE = "test-cases.json";
const POLICY_FILE = ".github/ci/automerge-policy.json";

type StringMap = Record<string, string>;
type JsonRecord = Record<string, unknown>;
type ParsedArgs = Readonly<{ options: StringMap }>;
type LintFinding = Readonly<{ file: string; severity: number; ruleId: string; message: string; identity: string }>;
type CaseEvidence = Readonly<{ file: string; name: string; status: "passed" | "failed" | "skipped" }>;
type CaseCounts = { total: number; failed: number; skipped: number; sample: CaseEvidence };
type ComparisonItem = Readonly<{ key: string; count: number; sample: CaseEvidence }>;
type TestComparison = Readonly<{
    baseCaseCount: number;
    targetCaseCount: number;
    netRemovedCaseCount: number;
    removedFiles: ReadonlyArray<string>;
    removedCases: ReadonlyArray<ComparisonItem>;
    newFailures: ReadonlyArray<ComparisonItem>;
    newSkips: ReadonlyArray<ComparisonItem>;
}>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseArguments(argv: ReadonlyArray<string>): ParsedArgs {
    const options: StringMap = {};
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index] ?? "";
        if (!value.startsWith("--")) continue;
        const next = argv[index + 1];
        if (next === undefined || next.startsWith("--")) options[value.slice(2)] = "true";
        else {
            options[value.slice(2)] = next;
            index += 1;
        }
    }
    return Object.freeze({ options });
}

function requireOption(args: ParsedArgs, name: string): string {
    const value = args.options[name]?.trim();
    if (!value) throw new Error(`--${name} is required.`);
    return value;
}

function readJson(file: string): unknown {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
}

function writeJson(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function appendOutputs(file: string | undefined, values: Readonly<Record<string, string | boolean>>): void {
    if (!file) return;
    fs.appendFileSync(
        file,
        `${Object.entries(values)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join("\n")}\n`,
        "utf8"
    );
}

function normalizePath(value: string): string {
    return value.replaceAll("\\", "/");
}

function normalizeRepositoryPath(value: string): string {
    const normalized = normalizePath(value);
    const root = normalizePath(process.cwd()).replace(/\/$/u, "");
    if (normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1);
    const marker = "/GMLoop/";
    const markerIndex = normalized.lastIndexOf(marker);
    return markerIndex === -1 ? normalized.replace(/^\.\//u, "") : normalized.slice(markerIndex + marker.length);
}

function readMaxRemovedTestCases(): number {
    const policy = readJson(POLICY_FILE);
    if (!isRecord(policy)) throw new Error("Malformed auto-merge policy.");
    const value = policy.maxRemovedTestCases;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
        throw new Error("Auto-merge policy maxRemovedTestCases must be an integer from 0 through 100.");
    }
    return value;
}

function normalizeLintMessage(ruleId: string, message: string): string {
    if (ruleId === "max-lines" || ruleId === "max-lines-per-function") {
        return message.replace(/too many lines \(\d+\)(?=\. Maximum allowed is \d+\.)/u, "too many lines (<current>)");
    }
    if (ruleId === "sonarjs/cognitive-complexity") {
        return message.replace(
            /Cognitive Complexity from \d+ to the (?=\d+ allowed\.)/u,
            "Cognitive Complexity from <current> to the "
        );
    }
    return message;
}

function collectLintFindings(value: unknown): Array<LintFinding> {
    if (!Array.isArray(value)) throw new Error("Lint evidence is not an array.");
    const output: Array<LintFinding> = [];
    for (const fileValue of value) {
        if (!isRecord(fileValue) || typeof fileValue.filePath !== "string" || !Array.isArray(fileValue.messages))
            throw new Error("Malformed lint evidence.");
        for (const message of fileValue.messages) {
            if (!isRecord(message) || ![1, 2].includes(Number(message.severity)) || typeof message.message !== "string")
                continue;
            const file = normalizeRepositoryPath(fileValue.filePath);
            const severity = Number(message.severity);
            const ruleId = typeof message.ruleId === "string" ? message.ruleId : "";
            const identity = [file, ruleId, normalizeLintMessage(ruleId, message.message)].join("\0");
            output.push(Object.freeze({ file, severity, ruleId, message: message.message, identity }));
        }
    }
    return output;
}

function compareLint(
    baseValue: unknown,
    targetValue: unknown
): Readonly<{ baseCount: number; targetCount: number; added: ReadonlyArray<LintFinding> }> {
    const base = collectLintFindings(baseValue);
    const target = collectLintFindings(targetValue);
    const baseByIdentity = new Map<string, Array<number>>();
    for (const finding of base) {
        const values = baseByIdentity.get(finding.identity) ?? [];
        values.push(finding.severity);
        baseByIdentity.set(finding.identity, values);
    }
    for (const severities of baseByIdentity.values()) severities.sort((left, right) => right - left);
    const targetByIdentity = new Map<string, Array<LintFinding>>();
    for (const finding of target) {
        const values = targetByIdentity.get(finding.identity) ?? [];
        values.push(finding);
        targetByIdentity.set(finding.identity, values);
    }
    const added: Array<LintFinding> = [];
    for (const [identity, findings] of targetByIdentity) {
        findings.sort((left, right) => right.severity - left.severity);
        const baselineSeverities = baseByIdentity.get(identity) ?? [];
        findings.forEach((finding, index) => {
            if (baselineSeverities[index] === undefined || finding.severity > (baselineSeverities[index] ?? 0))
                added.push(finding);
        });
    }
    return Object.freeze({ baseCount: base.length, targetCount: target.length, added: Object.freeze(added) });
}

function readManifestTests(value: unknown): ReadonlyArray<string> {
    if (!isRecord(value) || !Array.isArray(value.tests)) throw new Error("Malformed test manifest.");
    const tests = value.tests.filter((entry): entry is string => typeof entry === "string").map(normalizePath);
    if (tests.length !== value.tests.length) throw new Error("Malformed test path in manifest.");
    return Object.freeze(tests);
}

function readCases(value: unknown): Array<CaseEvidence> {
    if (!Array.isArray(value)) throw new Error("Malformed normalized test-case evidence.");
    return value.map((entry) => {
        if (
            !isRecord(entry) ||
            typeof entry.file !== "string" ||
            typeof entry.name !== "string" ||
            !["passed", "failed", "skipped"].includes(String(entry.status))
        )
            throw new Error("Malformed normalized test case.");
        return Object.freeze({
            file: normalizeRepositoryPath(entry.file),
            name: entry.name,
            status: entry.status as CaseEvidence["status"]
        });
    });
}

function summarizeCases(cases: ReadonlyArray<CaseEvidence>): Map<string, CaseCounts> {
    const result = new Map<string, CaseCounts>();
    for (const testCase of cases) {
        const key = `${testCase.file}\0${testCase.name}`;
        const counts = result.get(key) ?? { total: 0, failed: 0, skipped: 0, sample: testCase };
        counts.total += 1;
        if (testCase.status === "failed") counts.failed += 1;
        if (testCase.status === "skipped") counts.skipped += 1;
        result.set(key, counts);
    }
    return result;
}

function compareTests(
    baseManifest: unknown,
    targetManifest: unknown,
    baseCasesValue: unknown,
    targetCasesValue: unknown
): TestComparison {
    const baseFiles = new Set(readManifestTests(baseManifest));
    const targetFiles = new Set(readManifestTests(targetManifest));
    const removedFiles = [...baseFiles]
        .filter((file) => !targetFiles.has(file))
        .sort((left, right) => left.localeCompare(right));
    const baseCases = readCases(baseCasesValue);
    const targetCases = readCases(targetCasesValue);
    const base = summarizeCases(baseCases);
    const target = summarizeCases(targetCases);
    const removedCases: Array<ComparisonItem> = [];
    const newFailures: Array<ComparisonItem> = [];
    const newSkips: Array<ComparisonItem> = [];
    for (const [key, baseCounts] of base) {
        const targetCounts = target.get(key) ?? { total: 0, failed: 0, skipped: 0, sample: baseCounts.sample };
        if (targetCounts.total < baseCounts.total)
            removedCases.push(
                Object.freeze({ key, count: baseCounts.total - targetCounts.total, sample: baseCounts.sample })
            );
        if (targetCounts.failed > baseCounts.failed)
            newFailures.push(
                Object.freeze({ key, count: targetCounts.failed - baseCounts.failed, sample: targetCounts.sample })
            );
        if (targetCounts.skipped > baseCounts.skipped)
            newSkips.push(
                Object.freeze({ key, count: targetCounts.skipped - baseCounts.skipped, sample: targetCounts.sample })
            );
    }
    for (const [key, targetCounts] of target) {
        if (base.has(key)) continue;
        if (targetCounts.failed > 0)
            newFailures.push(Object.freeze({ key, count: targetCounts.failed, sample: targetCounts.sample }));
        if (targetCounts.skipped > 0)
            newSkips.push(Object.freeze({ key, count: targetCounts.skipped, sample: targetCounts.sample }));
    }
    return Object.freeze({
        baseCaseCount: baseCases.length,
        targetCaseCount: targetCases.length,
        netRemovedCaseCount: Math.max(0, baseCases.length - targetCases.length),
        removedFiles: Object.freeze(removedFiles),
        removedCases: Object.freeze(removedCases),
        newFailures: Object.freeze(newFailures),
        newSkips: Object.freeze(newSkips)
    });
}

function isPassingTestReport(value: unknown): boolean {
    return isRecord(value) && value.completed === true && value.testStatus === 0;
}

function evidenceKind(directory: string): "full" | "build-failure" {
    const build = readJson(path.join(directory, BUILD_FILE));
    if (!isRecord(build) || build.completed !== true) throw new Error(`Incomplete build evidence in ${directory}.`);
    if (build.succeeded !== true) return "build-failure";
    const report = readJson(path.join(directory, REPORT_FILE));
    if (!isRecord(report) || report.completed !== true) throw new Error(`Incomplete full report in ${directory}.`);
    return "full";
}

function formatSamples(items: ReadonlyArray<ComparisonItem>, limit = 8): Array<string> {
    return items.slice(0, limit).map((item) => `- ${item.sample.file} :: ${item.sample.name}`);
}

function commandEvaluate(args: ParsedArgs): number {
    const baseDirectory = requireOption(args, "base");
    const mergeDirectory = requireOption(args, "merge");
    const ancestorDirectory = args.options.ancestor?.trim() ?? "";
    const maxRemovedTestCases = readMaxRemovedTestCases();
    const baseKind = evidenceKind(baseDirectory);
    const mergeKind = evidenceKind(mergeDirectory);
    const baseBuild = readJson(path.join(baseDirectory, BUILD_FILE));
    const mergeBuild = readJson(path.join(mergeDirectory, BUILD_FILE));
    const baseSha = isRecord(baseBuild) && typeof baseBuild.targetSha === "string" ? baseBuild.targetSha : "";
    const mergeSha = isRecord(mergeBuild) && typeof mergeBuild.targetSha === "string" ? mergeBuild.targetSha : "";
    let green = false;
    let reason = "infrastructure";
    let baselineKind = "base";
    let netRemovedTestCases = 0;
    const lines = ["### Trusted auto-merge evaluation", ""];
    if (mergeKind === "build-failure") {
        reason = "build-failure";
        lines.push("❌ The exact synthetic merge does not complete the full repository build.");
    } else {
        let baselineDirectory = baseDirectory;
        if (baseKind === "build-failure") {
            baselineKind = "ancestor";
            if (!ancestorDirectory || evidenceKind(ancestorDirectory) !== "full") {
                reason = "baseline-unavailable";
                lines.push("❌ `main` is build-broken and no verified complete ancestor baseline is available.");
                baselineDirectory = "";
            } else {
                baselineDirectory = ancestorDirectory;
                lines.push(
                    "ℹ️ Current `main` is build-broken; quality regressions are compared against the verified nearest complete ancestor baseline."
                );
            }
        }
        if (baselineDirectory) {
            const lint = compareLint(
                readJson(path.join(baselineDirectory, LINT_FILE)),
                readJson(path.join(mergeDirectory, LINT_FILE))
            );
            const tests = compareTests(
                readJson(path.join(baselineDirectory, MANIFEST_FILE)),
                readJson(path.join(mergeDirectory, MANIFEST_FILE)),
                readJson(path.join(baselineDirectory, CASES_FILE)),
                readJson(path.join(mergeDirectory, CASES_FILE))
            );
            const comparableCaseInventory =
                isPassingTestReport(readJson(path.join(baselineDirectory, REPORT_FILE))) &&
                isPassingTestReport(readJson(path.join(mergeDirectory, REPORT_FILE)));
            netRemovedTestCases = comparableCaseInventory ? tests.netRemovedCaseCount : 0;
            const exceedsRemovalBudget = comparableCaseInventory && tests.netRemovedCaseCount > maxRemovedTestCases;
            const removedFilesWithoutComparableCases = !comparableCaseInventory && tests.removedFiles.length > 0;
            const hasRegression =
                lint.added.length > 0 ||
                exceedsRemovalBudget ||
                removedFilesWithoutComparableCases ||
                tests.newFailures.length > 0 ||
                tests.newSkips.length > 0;
            if (hasRegression) {
                reason = "quality-regression";
                lines.push("", "❌ The exact synthetic merge weakens the trusted quality baseline.");
                if (lint.added.length > 0)
                    lines.push(
                        "",
                        `**New/upgraded lint findings (${lint.added.length})**`,
                        ...lint.added
                            .slice(0, 8)
                            .map((item) => `- ${item.file}: ${item.ruleId || "eslint"}: ${item.message}`)
                    );
                if (exceedsRemovalBudget) {
                    lines.push(
                        "",
                        `**Net test-case reduction exceeds policy (${tests.netRemovedCaseCount} removed; maximum ${maxRemovedTestCases})**`,
                        `- Test cases: ${tests.baseCaseCount} baseline → ${tests.targetCaseCount} merged.`
                    );
                    if (tests.removedFiles.length > 0)
                        lines.push(`- Removed canonical test files: ${tests.removedFiles.length}.`);
                    if (tests.removedCases.length > 0) lines.push(...formatSamples(tests.removedCases));
                }
                if (removedFilesWithoutComparableCases) {
                    lines.push(
                        "",
                        `**Canonical test files removed while test-case inventories are partial (${tests.removedFiles.length})**`,
                        ...tests.removedFiles.slice(0, 8).map((file) => `- ${file}`)
                    );
                }
                if (tests.newFailures.length > 0)
                    lines.push(
                        "",
                        `**Newly failing test cases (${tests.newFailures.reduce((total, item) => total + item.count, 0)})**`,
                        ...formatSamples(tests.newFailures)
                    );
                if (tests.newSkips.length > 0)
                    lines.push(
                        "",
                        `**Newly skipped test cases (${tests.newSkips.reduce((total, item) => total + item.count, 0)})**`,
                        ...formatSamples(tests.newSkips)
                    );
            } else {
                green = true;
                reason = baseKind === "build-failure" ? "recovery" : "clean";
                lines.push(
                    "",
                    "✅ No new lint warnings/errors, newly failing tests, or newly skipped tests were introduced.",
                    "",
                    `- Lint findings: ${lint.baseCount} baseline → ${lint.targetCount} merged; **0 new/upgraded**.`,
                    `- Canonical test files removed: **${tests.removedFiles.length}**.`,
                    "- Newly failing / newly skipped test cases: **0 / 0**."
                );
                if (comparableCaseInventory) {
                    lines.push(
                        `- Test cases: ${tests.baseCaseCount} baseline → ${tests.targetCaseCount} merged; **net reduction ${tests.netRemovedCaseCount}/${maxRemovedTestCases} allowed**.`
                    );
                    if (tests.removedCases.length > 0) {
                        const grossRemovedCases = tests.removedCases.reduce((total, item) => total + item.count, 0);
                        lines.push(
                            "",
                            `ℹ️ Gross removed/renamed test-case identities: **${grossRemovedCases}**; new passing cases offset these when calculating net reduction.`
                        );
                    }
                } else {
                    lines.push(
                        "- Test-case removal budget: **not evaluated from partial failing-run JUnit inventories**.",
                        "- Canonical test-file removal remains enforced while baseline or merge tests are not fully passing."
                    );
                }
            }
        }
    }
    writeJson(requireOption(args, "output"), {
        schemaVersion: 1,
        green,
        reason,
        baselineKind,
        baseSha,
        mergeSha,
        maxRemovedTestCases,
        netRemovedTestCases
    });
    fs.writeFileSync(requireOption(args, "summary"), `${lines.join("\n")}\n`, "utf8");
    appendOutputs(args.options["github-output"], { green, reason, baseline_kind: baselineKind });
    return 0;
}

function selfTest(): void {
    const baselineLint = [
        { filePath: "/repo/a.ts", messages: [{ severity: 1, ruleId: "x", message: "old", line: 1 }] }
    ];
    const movedLint = [{ filePath: "/repo/a.ts", messages: [{ severity: 1, ruleId: "x", message: "old", line: 99 }] }];
    assert.equal(compareLint(baselineLint, movedLint).added.length, 0);
    const upgradedLint = [
        { filePath: "/repo/a.ts", messages: [{ severity: 2, ruleId: "x", message: "old", line: 99 }] }
    ];
    assert.equal(compareLint(baselineLint, upgradedLint).added.length, 1);
    const baselineMaxLines = [
        {
            filePath: "/repo/a.ts",
            messages: [
                { severity: 1, ruleId: "max-lines", message: "File has too many lines (1000). Maximum allowed is 600." }
            ]
        }
    ];
    const changedMaxLines = [
        {
            filePath: "/repo/a.ts",
            messages: [
                { severity: 1, ruleId: "max-lines", message: "File has too many lines (1070). Maximum allowed is 600." }
            ]
        }
    ];
    assert.equal(compareLint(baselineMaxLines, changedMaxLines).added.length, 0);
    const baselineFunctionLines = [
        {
            filePath: "/repo/a.ts",
            messages: [
                {
                    severity: 1,
                    ruleId: "max-lines-per-function",
                    message: "Function 'work' has too many lines (220). Maximum allowed is 150."
                }
            ]
        }
    ];
    const changedFunctionLines = [
        {
            filePath: "/repo/a.ts",
            messages: [
                {
                    severity: 1,
                    ruleId: "max-lines-per-function",
                    message: "Function 'work' has too many lines (240). Maximum allowed is 150."
                }
            ]
        }
    ];
    assert.equal(compareLint(baselineFunctionLines, changedFunctionLines).added.length, 0);
    const baselineComplexity = [
        {
            filePath: "/repo/a.ts",
            messages: [
                {
                    severity: 1,
                    ruleId: "sonarjs/cognitive-complexity",
                    message: "Refactor this function to reduce its Cognitive Complexity from 70 to the 15 allowed."
                }
            ]
        }
    ];
    const changedComplexity = [
        {
            filePath: "/repo/a.ts",
            messages: [
                {
                    severity: 1,
                    ruleId: "sonarjs/cognitive-complexity",
                    message: "Refactor this function to reduce its Cognitive Complexity from 72 to the 15 allowed."
                }
            ]
        }
    ];
    assert.equal(compareLint(baselineComplexity, changedComplexity).added.length, 0);
    const changedThreshold = [
        {
            filePath: "/repo/a.ts",
            messages: [
                { severity: 1, ruleId: "max-lines", message: "File has too many lines (1070). Maximum allowed is 500." }
            ]
        }
    ];
    assert.equal(compareLint(baselineMaxLines, changedThreshold).added.length, 1);
    const manifest = { tests: ["a.test.js"] };
    const passing = [{ file: "a.test.js", name: "works", status: "passed" }];
    assert.equal(
        compareTests(manifest, manifest, passing, [{ ...passing[0], status: "failed" }]).newFailures.length,
        1
    );
    assert.equal(compareTests(manifest, manifest, passing, [{ ...passing[0], status: "skipped" }]).newSkips.length, 1);
    assert.equal(compareTests(manifest, manifest, passing, []).removedCases.length, 1);
    assert.equal(compareTests(manifest, { tests: [] }, passing, []).removedFiles.length, 1);
    assert.equal(
        compareTests(manifest, manifest, [], [{ file: "a.test.js", name: "new", status: "failed" }]).newFailures.length,
        1
    );
    assert.equal(isPassingTestReport({ completed: true, testStatus: 0 }), true);
    assert.equal(isPassingTestReport({ completed: true, testStatus: 1 }), false);
    assert.equal(isPassingTestReport({ completed: false, testStatus: 0 }), false);

    const baselineCases = ["one", "two", "three", "four", "five"].map((name) => ({
        file: "a.test.js",
        name,
        status: "passed" as const
    }));
    const threeRemoved = compareTests(manifest, manifest, baselineCases, baselineCases.slice(0, 2));
    assert.equal(threeRemoved.netRemovedCaseCount, 3);
    assert.equal(threeRemoved.netRemovedCaseCount > 3, false);
    const fourRemoved = compareTests(manifest, manifest, baselineCases, baselineCases.slice(0, 1));
    assert.equal(fourRemoved.netRemovedCaseCount, 4);
    assert.equal(fourRemoved.netRemovedCaseCount > 3, true);

    const deduplicatedWithReplacement = compareTests(manifest, manifest, baselineCases, [
        { file: "a.test.js", name: "replacement-one", status: "passed" },
        { file: "a.test.js", name: "replacement-two", status: "passed" },
        { file: "a.test.js", name: "replacement-three", status: "passed" },
        { file: "a.test.js", name: "replacement-four", status: "passed" }
    ]);
    assert.equal(
        deduplicatedWithReplacement.removedCases.reduce((total, item) => total + item.count, 0),
        5
    );
    assert.equal(deduplicatedWithReplacement.netRemovedCaseCount, 1);
    assert.equal(deduplicatedWithReplacement.newFailures.length, 0);
    assert.equal(deduplicatedWithReplacement.newSkips.length, 0);

    process.stdout.write("ci-automerge gate self-test passed\n");
}

function main(): number {
    const [command = "", ...rest] = process.argv.slice(2);
    if (command === "self-test") {
        selfTest();
        return 0;
    }
    if (command === "evaluate") return commandEvaluate(parseArguments(rest));
    throw new Error(`Unknown ci-automerge-gate command: ${command || "(missing)"}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.exitCode = main();
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
        process.exitCode = 2;
    }
}
