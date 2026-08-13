/**
 * Compares two aggregated result sets (typically "base" vs "target") to detect new
 * test failures (regressions), previously-failing tests that are now resolved, and
 * added/removed/renamed test counts, along with human-readable summaries of both.
 */

import path from "node:path";

import { Core } from "@gmloop/core";

import { CliUsageError } from "../../cli-core/errors.js";
import { ScanStatus, TestCaseStatus } from "../../modules/quality-report/index.js";
import {
    buildTestRecordIdentityKey,
    FILE_NAME_SEPARATOR,
    getNormalizedTestRecordIdentity,
    isCanonicalTestRecord,
    resolveResultsMap,
    type TestRecordEntry
} from "./result-aggregation.js";

function normalizeLocator(testCase) {
    const node = testCase?.node || {};
    const rawFile = typeof node.file === "string" ? node.file.trim() : "";
    const testName = typeof node.name === "string" ? node.name.trim() : "";
    if (!testName) {
        return null;
    }
    if (rawFile) {
        return `file:${path.normalize(rawFile).replaceAll("\\", "/").toLowerCase()}${FILE_NAME_SEPARATOR}${testName}`;
    }
    const className = typeof node.classname === "string" ? node.classname.trim() : "";
    if (className) {
        return `class:${className}${FILE_NAME_SEPARATOR}${testName}`.toLowerCase();
    }
    return null;
}

function normalizeReportFileName(record) {
    const reportFilePath = typeof record?.reportFilePath === "string" ? record.reportFilePath : "";
    return path.basename(reportFilePath).trim().toLowerCase();
}

function isComparableReportRecord(record, comparableReportNames) {
    const reportName = normalizeReportFileName(record);
    return !reportName || comparableReportNames.has(reportName);
}

function collectReportNames(resultSet) {
    const reportNames = new Set();
    for (const record of resultSet.results.values()) {
        const reportName = normalizeReportFileName(record);
        if (reportName) {
            reportNames.add(reportName);
        }
    }
    return reportNames;
}

function collectComparableReportNames(sourceResults, comparisonResults) {
    const sourceReportNames = collectReportNames(sourceResults);
    const comparisonReportNames = collectReportNames(comparisonResults);
    const commonReportNames = new Set();

    for (const reportName of sourceReportNames) {
        if (comparisonReportNames.has(reportName)) {
            commonReportNames.add(reportName);
        }
    }

    return commonReportNames;
}

function collectComparableRecordIdentities(resultSet, comparableReportNames) {
    const identities = new Set();
    for (const record of resultSet.results.values()) {
        if (!isComparableReportRecord(record, comparableReportNames)) {
            continue;
        }

        const identity = normalizeLocator(record);
        if (identity) {
            identities.add(identity);
        }
    }
    return identities;
}

function collectMissingCases(sourceResults, comparisonResults) {
    const comparableReportNames = collectComparableReportNames(sourceResults, comparisonResults);
    const comparisonIdentities = collectComparableRecordIdentities(comparisonResults, comparableReportNames);
    const missing = [];
    for (const [key, record] of sourceResults.results.entries()) {
        if (
            !comparisonResults.results.has(key) &&
            isComparableReportRecord(record, comparableReportNames) &&
            !comparisonIdentities.has(normalizeLocator(record))
        ) {
            missing.push(record);
        }
    }
    return missing;
}

function collectCaseDifferences(baseResults, targetResults) {
    return {
        newCases: collectMissingCases(targetResults, baseResults),
        removedCases: collectMissingCases(baseResults, targetResults)
    };
}

function createLocatorCounts(records) {
    const counts = new Map();
    for (const record of records) {
        const locator = normalizeLocator(record);
        if (!locator) {
            continue;
        }

        counts.set(locator, (counts.get(locator) || 0) + 1);
    }
    return counts;
}

function decrementLocatorCount(locator, store) {
    const next = (store.get(locator) || 0) - 1;
    if (next > 0) {
        store.set(locator, next);
    } else {
        store.delete(locator);
    }
}

function countRenamedCases(newCases, removedCases) {
    const removedByLocator = createLocatorCounts(removedCases);

    let renameCount = 0;
    for (const record of newCases) {
        const locator = normalizeLocator(record);
        if (!locator) {
            continue;
        }

        const remaining = removedByLocator.get(locator);
        if (!remaining) {
            continue;
        }

        decrementLocatorCount(locator, removedByLocator);
        renameCount += 1;
    }

    return renameCount;
}

function computeTestDiff(baseResults, targetResults) {
    if (!baseResults?.usedDir || !targetResults?.usedDir) {
        return null;
    }

    const { newCases, removedCases } = collectCaseDifferences(baseResults, targetResults);

    const renameCount = countRenamedCases(newCases, removedCases);

    const adjustedNew = Math.max(0, newCases.length - renameCount);
    const adjustedRemoved = Math.max(0, removedCases.length - renameCount);

    return {
        newTests: adjustedNew,
        removedTests: adjustedRemoved,
        renamedTests: renameCount
    };
}

/**
 * Build a secondary lookup of base test statuses keyed by `(file, testName)`.
 *
 * This is used to match target failures against base results when the JUnit suite
 * hierarchy changes and test keys are renamed (for example due to malformed wrappers).
 * Matching by `(file, testName)` lets us distinguish genuinely new failing tests
 * (which should be ignored) from renamed pre-existing tests (which should keep their
 * original base status).
 */
function buildBaseStatusesByFileAndName(baseResults: Map<string, unknown>): Map<string, string> {
    const index = new Map<string, string>();
    for (const record of baseResults.values()) {
        const r = record as TestRecordEntry;
        if (
            r.status !== TestCaseStatus.FAILED &&
            r.status !== TestCaseStatus.PASSED &&
            r.status !== TestCaseStatus.SKIPPED
        ) {
            continue;
        }
        const { fileLowerCase, name } = getNormalizedTestRecordIdentity(r);
        if (fileLowerCase && name) {
            index.set(`${fileLowerCase}${FILE_NAME_SEPARATOR}${name}`, r.status);
        }
    }
    return index;
}

/**
 * Build a lookup of target statuses from canonical `tests.xml` keyed by
 * `(file, testName)`.
 *
 * When auxiliary XML reports carry malformed suite wrappers, the same logical
 * test may appear under a different key and look like a new failure. Canonical
 * `tests.xml` output is authoritative when present, so regression detection
 * should ignore auxiliary duplicates that map back to an existing canonical
 * identity.
 */
function buildCanonicalTargetStatusesByFileAndName(targetResults: Map<string, unknown>): Map<string, string> {
    const index = new Map<string, string>();
    for (const record of targetResults.values()) {
        const r = record as TestRecordEntry;
        if (!isCanonicalTestRecord(r)) {
            continue;
        }
        if (
            r.status !== TestCaseStatus.FAILED &&
            r.status !== TestCaseStatus.PASSED &&
            r.status !== TestCaseStatus.SKIPPED
        ) {
            continue;
        }
        const { fileLowerCase, name } = getNormalizedTestRecordIdentity(r);
        if (fileLowerCase && name) {
            index.set(`${fileLowerCase}${FILE_NAME_SEPARATOR}${name}`, r.status);
        }
    }
    return index;
}

/**
 * Build a set of file paths that have at least one PASSING test case in the target
 * results.
 *
 * This is used to detect node test runner file-level crash records: when the runner
 * itself encounters an IPC-deserialization error, it emits a synthetic testcase whose
 * `name` equals the (relative) file path. If the file already has passing inner tests,
 * the file-level failure is an infrastructure artifact and must not be reported as a
 * code regression.
 */
function buildTargetFilesWithPassingTests(targetResults: Map<string, unknown>): Set<string> {
    const passingFiles = new Set<string>();
    for (const record of targetResults.values()) {
        const r = record as TestRecordEntry;
        if (r.status === TestCaseStatus.PASSED) {
            const { fileLowerCase } = getNormalizedTestRecordIdentity(r);
            if (fileLowerCase) {
                passingFiles.add(fileLowerCase);
            }
        }
    }
    return passingFiles;
}

/**
 * Return true if a failing testcase looks like a node test runner file-level crash
 * record rather than an actual test failure.
 *
 * Node's JUnit reporter emits a synthetic `<testcase>` whose `name` equals the
 * relative test-file path (e.g. `src/cli/dist/test/foo.test.js`) when the test
 * subprocess crashes mid-execution (for example, due to an IPC deserialization
 * error). The `file` attribute on that record is the absolute path to the same
 * file. If other inner tests in that file passed successfully in the target, the
 * crash is an infrastructure artifact that should not block auto-merge.
 */
function isNodeRunnerFileLevelCrash(targetRecord: TestRecordEntry, targetFilesWithPassingTests: Set<string>): boolean {
    const { file, fileLowerCase, name } = getNormalizedTestRecordIdentity(targetRecord);
    if (!file || !name) {
        return false;
    }
    // The synthetic record's name is the relative path portion of the absolute file path.
    if (!fileLowerCase.endsWith(name.toLowerCase())) {
        return false;
    }
    // Confirm it looks like a test file path.
    if (!name.endsWith(".test.js") && !name.endsWith(".test.mjs")) {
        return false;
    }
    // If passing inner tests exist for this file, the crash is a runner artefact.
    return targetFilesWithPassingTests.has(fileLowerCase);
}

function createRegressionRecord({
    baseResults,
    key,
    targetRecord,
    baseStatusesByFileAndName,
    canonicalTargetStatusesByFileAndName,
    targetFilesWithPassingTests
}: {
    baseResults: Map<string, unknown>;
    key: string;
    targetRecord: TestRecordEntry | null | undefined;
    baseStatusesByFileAndName: Map<string, string>;
    canonicalTargetStatusesByFileAndName: Map<string, string>;
    targetFilesWithPassingTests: Set<string>;
}): { key: string; from: string; to: string; detail: unknown } | null {
    if (!targetRecord || targetRecord.status !== TestCaseStatus.FAILED) {
        return null;
    }

    const { fileLowerCase, name } = getNormalizedTestRecordIdentity(targetRecord);
    const identityKey = fileLowerCase && name ? `${fileLowerCase}${FILE_NAME_SEPARATOR}${name}` : "";
    const canonicalTargetStatus = identityKey ? canonicalTargetStatusesByFileAndName.get(identityKey) : undefined;
    if (!isCanonicalTestRecord(targetRecord) && canonicalTargetStatus) {
        return null;
    }

    const baseRecord = baseResults.get(key) as { status?: string } | undefined;
    let baseStatus = baseRecord?.status;
    if (baseStatus === TestCaseStatus.FAILED) {
        return null;
    }

    // If there is no base record with this exact key, check whether this test
    // corresponds to a base failure that was already failing under a different key.
    // This happens when a test runner bug produces a malformed JUnit XML structure
    // (e.g., `<undefined>` wrapper tags), causing the suite-path prefix of existing
    // tests to change. Those renamed failures must not be reported as new regressions.
    if (baseStatus === undefined) {
        // Newly introduced tests are intentionally excluded from regression checks.
        // Only renamed tests that map back to an existing base status are eligible.
        const renamedBaseStatus = identityKey ? baseStatusesByFileAndName.get(identityKey) : undefined;
        if (!renamedBaseStatus) {
            return null;
        }

        baseStatus = renamedBaseStatus;
        if (baseStatus === TestCaseStatus.FAILED) {
            return null;
        }
        // Detect node test runner file-level crash records: synthetic testcases where
        // the name equals the file path and the file has other passing inner tests.
        // These are infrastructure artefacts produced by the test runner itself (e.g.,
        // IPC-deserialization errors) and must not be reported as code regressions.
        if (isNodeRunnerFileLevelCrash(targetRecord, targetFilesWithPassingTests)) {
            return null;
        }
    }

    return {
        key,
        from: baseStatus ?? ScanStatus.MISSING,
        to: targetRecord.status,
        detail: targetRecord
    };
}

/**
 * Derive regression summaries for each failed target test case.
 */
function collectRegressions({ baseResults, targetResults }) {
    const regressions = [];
    const baseStatusesByFileAndName = buildBaseStatusesByFileAndName(baseResults);
    const canonicalTargetStatusesByFileAndName = buildCanonicalTargetStatusesByFileAndName(targetResults);
    const targetFilesWithPassingTests = buildTargetFilesWithPassingTests(targetResults);

    for (const [key, targetRecord] of targetResults.entries()) {
        const regression = createRegressionRecord({
            baseResults,
            key,
            targetRecord,
            baseStatusesByFileAndName,
            canonicalTargetStatusesByFileAndName,
            targetFilesWithPassingTests
        });

        if (regression) {
            regressions.push(regression);
        }
    }

    return regressions;
}

function createResolvedFailureRecord({ baseResults, key, targetResults }) {
    const baseRecord = baseResults.get(key);
    if (!baseRecord || baseRecord.status !== TestCaseStatus.FAILED) {
        return null;
    }

    const targetRecord = targetResults.get(key);
    const targetStatus = targetRecord?.status;
    if (targetStatus === TestCaseStatus.FAILED) {
        return null;
    }

    return {
        key,
        from: baseRecord.status,
        to: targetStatus ?? ScanStatus.MISSING,
        detail: baseRecord
    };
}

/**
 * Derive records for historical failures that are no longer failing.
 */
function collectResolvedFailures({ baseResults, targetResults }) {
    const resolved = [];

    for (const key of baseResults.keys()) {
        const record = createResolvedFailureRecord({
            baseResults,
            key,
            targetResults
        });

        if (record) {
            resolved.push(record);
        }
    }

    return resolved;
}

function detectRegressions(baseResults, targetResults) {
    return collectRegressions({
        baseResults: resolveResultsMap(baseResults),
        targetResults: resolveResultsMap(targetResults)
    });
}

function detectResolvedFailures(baseResults, targetResults) {
    return collectResolvedFailures({
        baseResults: resolveResultsMap(baseResults),
        targetResults: resolveResultsMap(targetResults)
    });
}

function formatRegression(regression) {
    const descriptor = regression.detail?.displayName || regression.key;
    const fromLabel = regression.from === ScanStatus.MISSING ? "missing" : regression.from;
    return `- ${descriptor} (${fromLabel} -> ${regression.to})`;
}

function chooseTargetResultSet({ merged, head }) {
    const usingMerged = Boolean(merged.usedDir);
    const target = usingMerged ? merged : head;
    const targetLabel = usingMerged
        ? `synthetic merge (${merged.displayDir || "merge/reports"})`
        : `PR head (${head.displayDir || "reports"})`;

    return { target, targetLabel, usingMerged };
}

function ensureResultsAvailability(base, target) {
    if (!base.usedDir) {
        throw new CliUsageError("Unable to locate base test results; regression detection cannot proceed.");
    }

    if (!target.usedDir) {
        throw new CliUsageError("Unable to locate target test results; regression detection cannot proceed.");
    }
}

function appendRegressionContext(lines, resolvedFailures) {
    if (resolvedFailures.length === 0) {
        return lines;
    }

    const noun = resolvedFailures.length === 1 ? "test" : "tests";
    const verb = resolvedFailures.length === 1 ? "is" : "are";
    const hint =
        `${resolvedFailures.length} previously failing ${noun} ${verb} now ` +
        "passing or missing, so totals may appear unchanged.";
    return [...lines, `Note: ${hint}`];
}

function reportRegressionSummary(regressions, targetLabel, { resolvedFailures = [] } = {}) {
    if (regressions.length > 0) {
        const lines = [
            `New failing tests detected (compared to base using ${targetLabel}):`,
            ...regressions.map((regression) => formatRegression(regression))
        ];

        return {
            exitCode: 1,
            lines: appendRegressionContext(lines, resolvedFailures)
        };
    }

    return {
        exitCode: 0,
        lines: [`No new failing tests compared to base using ${targetLabel}.`]
    };
}

function calculateFailureBreakdown(baseResults, targetResults) {
    if (!baseResults?.usedDir || !targetResults?.usedDir) {
        return null;
    }

    const baseResultMap = resolveResultsMap(baseResults);
    const targetResultMap = resolveResultsMap(targetResults);

    const baseFailedKeys = new Set();
    const baseFailedIdentities = new Set();
    for (const [key, baseRecord] of baseResultMap.entries()) {
        const record = baseRecord as TestRecordEntry;
        if (record.status !== TestCaseStatus.FAILED) {
            continue;
        }

        baseFailedKeys.add(key);
        const identity = buildTestRecordIdentityKey(record);
        if (identity) {
            baseFailedIdentities.add(identity);
        }
    }

    let preExistingFailures = 0;
    let newFailures = 0;

    for (const [key, targetRecord] of targetResultMap.entries()) {
        const record = targetRecord as TestRecordEntry;
        if (record.status !== TestCaseStatus.FAILED) {
            continue;
        }

        if (baseFailedKeys.has(key)) {
            preExistingFailures += 1;
            continue;
        }

        const identity = buildTestRecordIdentityKey(record);
        if (identity && baseFailedIdentities.has(identity)) {
            preExistingFailures += 1;
        } else {
            newFailures += 1;
        }
    }

    return {
        preExistingFailures,
        newFailures
    };
}

function describeRegressionCause(regressions, diff) {
    if (!Core.isNonEmptyArray(regressions)) {
        return "";
    }

    const buckets = regressions.reduce((counts, item) => {
        const fromKey = String(item?.from ?? ScanStatus.MISSING);
        counts.set(fromKey, (counts.get(fromKey) || 0) + 1);
        return counts;
    }, new Map());

    const fragments = [];
    const addFragment = (count, singular, plural) => {
        if (count <= 0) {
            return;
        }
        fragments.push(count === 1 ? `1 ${singular}` : `${count} ${plural}`);
    };

    const knownStatuses = [
        {
            key: ScanStatus.MISSING,
            singular: "test is failing but was not present in base (added or renamed)",
            plural: "tests are failing but were not present in base (added or renamed)"
        },
        {
            key: TestCaseStatus.PASSED,
            singular: "test is now failing after passing in base",
            plural: "tests are now failing after passing in base"
        },
        {
            key: TestCaseStatus.SKIPPED,
            singular: "test is now failing after being skipped in base",
            plural: "tests are now failing after being skipped in base"
        }
    ];

    for (const status of knownStatuses) {
        addFragment(buckets.get(status.key) || 0, status.singular, status.plural);
    }

    const knownKeys = new Set(knownStatuses.map((status) => status.key));
    for (const [fromKey, count] of buckets.entries()) {
        if (knownKeys.has(fromKey)) {
            continue;
        }
        addFragment(
            count,
            `test is now failing after being ${fromKey} in base`,
            `tests are now failing after being ${fromKey} in base`
        );
    }

    if (diff?.renamedTests > 0) {
        addFragment(
            diff.renamedTests,
            "test appears to have been renamed compared to base",
            "tests appear to have been renamed compared to base"
        );
    }

    return fragments.join("; ");
}

function summarizeRegressedTests(regressions, limit = 5) {
    if (!Core.isNonEmptyArray(regressions)) {
        return "";
    }

    const descriptors = [];
    for (const item of regressions) {
        const descriptor = (item?.detail?.displayName || item?.key || "").trim();
        if (descriptor) {
            descriptors.push(descriptor);
        }
    }

    if (descriptors.length === 0) {
        return "";
    }

    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5;
    const maxItems = Math.max(1, normalizedLimit);
    const visible = descriptors.slice(0, maxItems);
    const remaining = descriptors.length - visible.length;
    const label = descriptors.length === 1 ? "Impacted test" : "Impacted tests";
    const formatted = visible.map((name) => `\`${name}\``).join(", ");

    if (remaining > 0) {
        return `${label} (showing ${visible.length} of ${descriptors.length}): ${formatted}`;
    }

    return `${label}: ${formatted}`;
}

export {
    calculateFailureBreakdown,
    chooseTargetResultSet,
    computeTestDiff,
    describeRegressionCause,
    detectRegressions,
    detectResolvedFailures,
    ensureResultsAvailability,
    reportRegressionSummary,
    summarizeRegressedTests
};
