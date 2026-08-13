/**
 * Merges directory scan results (JUnit test cases plus coverage/lint/duplicates/health
 * side-data) across candidate directories into a single canonical result set, deduping
 * test records that were reported by more than one report file.
 */

import path from "node:path";
import process from "node:process";

import { Core } from "@gmloop/core";

import { ScanStatus, TestCaseStatus } from "../../modules/quality-report/index.js";
import { pathExistsSync } from "../../shared/path-exists.js";
import { normalizeResultDirectories, readDuplicates, scanResultDirectory } from "./directory-scan.js";

const { ensureMap, toTrimmedString } = Core;

/** Shared record shape for test-case entries in the results maps. */
type TestRecordNode = { file?: string; name?: string };
type TestRecordEntry = { status?: string; node?: TestRecordNode; reportFilePath?: string };

type AggregatedTestRecord = TestRecordEntry & {
    key?: string;
    displayName?: string;
    time?: number;
    reportFilePath: string;
};

/** Separator used when combining file path and test name into a lookup key. */
const FILE_NAME_SEPARATOR = "::";

/**
 * Normalize file/name identity fields from a parsed test record.
 */
function getNormalizedTestRecordIdentity(record: TestRecordEntry): {
    file: string;
    fileLowerCase: string;
    name: string;
} {
    const file = typeof record.node?.file === "string" ? record.node.file.trim() : "";
    const name = typeof record.node?.name === "string" ? record.node.name.trim() : "";

    return {
        file,
        fileLowerCase: file.toLowerCase(),
        name
    };
}

function isCanonicalTestsXmlReportPath(reportFilePath: string): boolean {
    const reportPath = toTrimmedString(reportFilePath);
    if (!reportPath) {
        return false;
    }
    return path.basename(reportPath).toLowerCase() === "tests.xml";
}

function buildTestRecordIdentityKey(record: TestRecordEntry): string {
    const { fileLowerCase, name } = getNormalizedTestRecordIdentity(record);
    return fileLowerCase && name ? `${fileLowerCase}${FILE_NAME_SEPARATOR}${name}` : "";
}

function choosePreferredTestRecord(
    existingRecord: AggregatedTestRecord | undefined,
    incomingRecord: AggregatedTestRecord
): AggregatedTestRecord {
    if (!existingRecord) {
        return incomingRecord;
    }

    const existingIsCanonical = isCanonicalTestsXmlReportPath(existingRecord.reportFilePath);
    const incomingIsCanonical = isCanonicalTestsXmlReportPath(incomingRecord.reportFilePath);

    if (existingIsCanonical && !incomingIsCanonical) {
        return existingRecord;
    }

    if (incomingIsCanonical && !existingIsCanonical) {
        return incomingRecord;
    }

    return incomingRecord;
}

function recordTestCases(aggregates, testCases) {
    const { results } = aggregates;

    for (const testCase of testCases) {
        const existingRecord = results.get(testCase.key);
        const preferredRecord = choosePreferredTestRecord(existingRecord, testCase);
        results.set(testCase.key, preferredRecord);
    }
}

function collectCanonicalTestRecordIdentities(results: Map<string, AggregatedTestRecord>): Set<string> {
    const identities = new Set<string>();

    for (const record of results.values()) {
        if (!isCanonicalTestRecord(record)) {
            continue;
        }

        const identityKey = buildTestRecordIdentityKey(record);
        if (identityKey) {
            identities.add(identityKey);
        }
    }

    return identities;
}

function removeNonCanonicalRecordsDuplicatedByCanonicalIdentity(results: Map<string, AggregatedTestRecord>): void {
    const canonicalIdentities = collectCanonicalTestRecordIdentities(results);
    if (canonicalIdentities.size === 0) {
        return;
    }

    for (const [key, record] of results.entries()) {
        const identityKey = buildTestRecordIdentityKey(record);
        if (!identityKey || isCanonicalTestRecord(record) || !canonicalIdentities.has(identityKey)) {
            continue;
        }

        results.delete(key);
    }
}

function computeAggregateStatsFromResults(results: Map<string, AggregatedTestRecord>) {
    const stats = { total: 0, passed: 0, failed: 0, skipped: 0, time: 0 };
    for (const record of results.values()) {
        stats.total += 1;
        stats.time += Number(record.time) || 0;
        if (record.status === TestCaseStatus.FAILED) {
            stats.failed += 1;
        } else if (record.status === TestCaseStatus.SKIPPED) {
            stats.skipped += 1;
        } else {
            stats.passed += 1;
        }
    }
    return stats;
}

function createResultAggregates() {
    return {
        results: new Map(),
        stats: { total: 0, passed: 0, failed: 0, skipped: 0, time: 0 }
    };
}

interface DetectTestResultsOptions {
    workspace?: string;
}

/**
 * Append missing directory diagnostic messages to the notes collection.
 * Centralizes the bookkeeping logic so the orchestrator can delegate.
 */
function appendMissingDirectoryNotes(notes: string[], missingDirs: string[]): void {
    if (missingDirs.length === 1) {
        notes.push(`No directory found at ${missingDirs[0]}.`);
    } else if (missingDirs.length > 1) {
        notes.push(`No directory found at any of: ${missingDirs.join(", ")}.`);
    }
}

/**
 * Append empty directory diagnostic messages to the notes collection.
 * Centralizes the bookkeeping logic so the orchestrator can delegate.
 */
function appendEmptyDirectoryNotes(notes: string[], emptyDirs: string[]): void {
    if (emptyDirs.length === 1) {
        notes.push(`No JUnit XML files found in ${emptyDirs[0]}.`);
    } else if (emptyDirs.length > 1) {
        notes.push(`No JUnit XML files found in: ${emptyDirs.join(", ")}.`);
    }
}

/**
 * Attempt to locate duplicate detection report in the parent directory.
 * Isolates the fallback logic so the orchestrator delegates rather than
 * manipulating filesystem paths directly.
 */
function resolveDuplicatesWithFallback(scan: { duplicates: unknown }, directory: { resolved: string }): unknown {
    if (scan.duplicates) {
        return scan.duplicates;
    }

    const parentFile = path.join(directory.resolved, "..", "jscpd-report.json");
    if (pathExistsSync(parentFile)) {
        return readDuplicates([parentFile]);
    }

    return null;
}

/**
 * Record the scan result for tracking diagnostic purposes.
 * Isolates the array mutations and status checks so the orchestrator
 * reads as a sequence of delegation steps.
 */
function recordScanDiagnostics(
    scan: { status: ScanStatus; notes: string[] },
    directory: { display: string },
    { notes, missingDirs, emptyDirs }: { notes: string[]; missingDirs: string[]; emptyDirs: string[] }
): void {
    if (scan.notes.length > 0) {
        notes.push(...scan.notes);
    }

    if (scan.status === ScanStatus.MISSING) {
        missingDirs.push(directory.display);
    } else if (scan.status === ScanStatus.EMPTY) {
        emptyDirs.push(directory.display);
    }
}

function hasUsableReportPayload(scan: {
    coverage: unknown;
    lint: { warnings?: number; errors?: number } | null;
    duplicates: unknown;
    health: unknown;
}): boolean {
    return Boolean(scan.coverage || scan.duplicates || scan.health || scan.lint);
}

function readTestResults(candidateDirs, { workspace }: DetectTestResultsOptions = {}) {
    const workspaceRoot = workspace || process.env.GITHUB_WORKSPACE || process.cwd();
    const directories = normalizeResultDirectories(candidateDirs, workspaceRoot);
    const aggregates = createResultAggregates();
    const notes = [];
    const missingDirs = [];
    const emptyDirs = [];

    for (const directory of directories) {
        const scan = scanResultDirectory(directory, workspaceRoot);

        recordScanDiagnostics(scan, directory, { notes, missingDirs, emptyDirs });

        if (scan.status === ScanStatus.MISSING || (scan.status === ScanStatus.EMPTY && !hasUsableReportPayload(scan))) {
            continue;
        }

        recordTestCases(aggregates, scan.cases);
        removeNonCanonicalRecordsDuplicatedByCanonicalIdentity(aggregates.results);

        const duplicates = resolveDuplicatesWithFallback(scan, directory);
        const stats = computeAggregateStatsFromResults(aggregates.results);

        return {
            ...aggregates,
            stats,
            usedDir: directory.resolved,
            displayDir: directory.display,
            notes,
            coverage: scan.coverage,
            lint: scan.lint,
            duplicates,
            health: scan.health,
            cases: scan.cases
        };
    }

    appendMissingDirectoryNotes(notes, missingDirs);
    appendEmptyDirectoryNotes(notes, emptyDirs);

    return {
        ...aggregates,
        usedDir: null,
        displayDir: "",
        notes,
        coverage: null,
        lint: null,
        duplicates: null,
        health: null
    };
}

/**
 * Normalize result-set inputs so downstream helpers can rely on Map semantics.
 */
function resolveResultsMap(resultSet) {
    const { results } = resultSet ?? {};
    return ensureMap(results);
}

/**
 * Return true when a record originated from canonical `tests.xml`.
 */
function isCanonicalTestRecord(record: TestRecordEntry): boolean {
    return typeof record.reportFilePath === "string" && isCanonicalTestsXmlReportPath(record.reportFilePath);
}

export {
    buildTestRecordIdentityKey,
    FILE_NAME_SEPARATOR,
    getNormalizedTestRecordIdentity,
    isCanonicalTestRecord,
    isCanonicalTestsXmlReportPath,
    readTestResults,
    resolveResultsMap
};
export type { AggregatedTestRecord, TestRecordEntry, TestRecordNode };
