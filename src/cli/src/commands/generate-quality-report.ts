import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Core } from "@gmloop/core";
import { Command } from "commander";
import { XMLParser } from "fast-xml-parser";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { CliUsageError, handleCliError } from "../cli-core/errors.js";
import { ParseResultStatus, ScanStatus, TestCaseStatus } from "../modules/quality-report/index.js";
import { scanProjectHealth } from "../modules/quality-report/project-health.js";
import { traverseDirectoryEntries } from "../shared/directory-traversal.js";

const {
    assertArray,
    compactArray,
    ensureMap,
    getErrorMessageOrFallback,
    isNonEmptyArray,
    isNonEmptyTrimmedString,
    isObjectLike,
    parseJsonWithContext,
    readTextFileSync,
    toArray,
    toTrimmedString
} = Core;

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ""
});

function hasAnyOwn(object: Record<string, unknown>, keys: string[]): boolean {
    return keys.some((key) => Object.hasOwn(object, key));
}

function looksLikeTestCase(node) {
    if (!isObjectLike(node) || Array.isArray(node)) {
        return false;
    }

    if (hasAnyOwn(node, ["testcase", "testsuite"])) {
        return false;
    }

    if (Object.hasOwn(node, "tests")) {
        return false;
    }

    if (!isNonEmptyTrimmedString(node.name)) {
        return false;
    }

    if (isNonEmptyTrimmedString(node.classname)) {
        return true;
    }

    if (hasAnyOwn(node, ["failure", "error", "skipped"])) {
        return true;
    }

    return hasAnyOwn(node, ["time", "duration", "elapsed"]);
}

function normalizeSuiteName(name) {
    return toTrimmedString(name);
}

function pushNormalizedSuiteSegments(target, segments) {
    const targetSegments = assertArray(target, {
        name: "target",
        errorMessage: "target must be an array"
    });
    const sourceSegments = toArray(segments);

    for (const segment of sourceSegments) {
        const normalized = normalizeSuiteName(segment);
        if (!normalized) {
            continue;
        }

        targetSegments.push(normalized);
    }

    return targetSegments;
}

function buildTestKey(testNode, suitePath) {
    const parts = [];
    pushNormalizedSuiteSegments(parts, suitePath);
    const className = toTrimmedString(testNode?.classname);
    if (className && (parts.length === 0 || parts.at(-1) !== className)) {
        parts.push(className);
    }
    const testName = toTrimmedString(testNode?.name);
    parts.push(testName || "(unnamed test)");
    return parts.join(" :: ");
}

function describeTestCase(testNode, suitePath) {
    const parts = [];
    pushNormalizedSuiteSegments(parts, suitePath);
    const testName = toTrimmedString(testNode?.name);
    if (testName) {
        parts.push(testName);
    }
    const file = toTrimmedString(testNode?.file);
    if (file) {
        return `${parts.join(" :: ")} [${file}]`;
    }
    return parts.join(" :: ");
}

function computeStatus(testNode) {
    const hasFailure = Object.hasOwn(testNode, "failure") || Object.hasOwn(testNode, "error");
    if (hasFailure) {
        return TestCaseStatus.FAILED;
    }
    if (Object.hasOwn(testNode, "skipped")) {
        return TestCaseStatus.SKIPPED;
    }
    return TestCaseStatus.PASSED;
}

function createTestTraversalQueue(root) {
    return [{ node: root, suitePath: [] }];
}

/**
 * Push all {@link nodes} onto the traversal queue with a shared suite path.
 *
 * Centralising the mutation keeps the orchestrator focused on sequencing.
 */
function enqueueTraversalNodes(queue, nodes, suitePath) {
    for (const child of nodes) {
        queue.push({ node: child, suitePath });
    }
    return queue;
}

function enqueueObjectLikeChildren(queue, node, suitePath) {
    for (const [key, value] of Object.entries(node)) {
        if (key === "testcase" || key === "testsuite") {
            continue;
        }

        if (!isObjectLike(value)) {
            continue;
        }

        queue.push({ node: value, suitePath });
    }
    return queue;
}

function resolveNextSuitePath(node, suitePath, { hasTestcase, hasTestsuite }) {
    const normalizedSuiteName = normalizeSuiteName(node?.name);
    const shouldExtendSuitePath = normalizedSuiteName && (hasTestcase || hasTestsuite);

    if (!shouldExtendSuitePath) {
        return suitePath;
    }

    return pushNormalizedSuiteSegments([...suitePath], normalizedSuiteName);
}

/**
 * Record a single testcase result in the aggregate list.
 */
function recordSuiteTestCase(cases, node, suitePath, reportFilePath = "") {
    const key = buildTestKey(node, suitePath);
    const displayName = describeTestCase(node, suitePath) || key;
    const time = Number.parseFloat(node.time) || 0;

    cases.push({
        node,
        suitePath,
        key,
        status: computeStatus(node),
        displayName,
        time,
        reportFilePath
    });
    return cases;
}

/**
 * Execute a visitor callback for each item in the traversal queue until exhausted
 * or the visitor signals early termination.
 *
 * Isolates the low-level queue iteration mechanics from high-level processing logic.
 *
 * @param queue - The traversal queue containing items to process
 * @param visitor - Callback invoked for each item; returns `true` to terminate early
 */
function processTraversalQueue<T>(queue: T[], visitor: (item: T, queue: T[]) => boolean | void): void {
    while (queue.length > 0) {
        const item = queue.pop();
        // Skip if undefined (defensive check for malformed queue entries)
        if (item === undefined) {
            continue;
        }
        const shouldTerminate = visitor(item, queue);
        if (shouldTerminate === true) {
            break;
        }
    }
}

function collectTestCases(root, { reportFilePath = "" }: { reportFilePath?: string } = {}) {
    const cases = [];
    const queue = createTestTraversalQueue(root);

    processTraversalQueue(queue, ({ node, suitePath }, traversalQueue) => {
        if (!node) {
            return;
        }

        if (Array.isArray(node)) {
            enqueueTraversalNodes(traversalQueue, node, suitePath);
            return;
        }

        if (!isObjectLike(node)) {
            return;
        }

        const hasTestcase = Object.hasOwn(node, "testcase");
        const hasTestsuite = Object.hasOwn(node, "testsuite");
        const nextSuitePath = resolveNextSuitePath(node, suitePath, {
            hasTestcase,
            hasTestsuite
        });

        if (looksLikeTestCase(node)) {
            recordSuiteTestCase(cases, node, suitePath, reportFilePath);
        }

        if (hasTestcase) {
            enqueueTraversalNodes(traversalQueue, toArray(node.testcase), nextSuitePath);
        }

        if (hasTestsuite) {
            enqueueTraversalNodes(traversalQueue, toArray(node.testsuite), nextSuitePath);
        }

        enqueueObjectLikeChildren(traversalQueue, node, nextSuitePath);
    });

    return cases;
}

function normalizeResultDirectories(candidateDirs, workspaceRoot) {
    return compactArray(toArray(candidateDirs)).map((candidate) => {
        const resolved = path.isAbsolute(candidate) ? candidate : path.join(workspaceRoot, candidate);
        return {
            resolved,
            display: path.relative(workspaceRoot, resolved) || resolved
        };
    });
}

function listFilesRecursive(root) {
    const files = [];
    traverseDirectoryEntries(root, {
        onFile: (fullPath) => {
            files.push(fullPath);
        },
        shouldDescend: () => true,
        continueOnReadError: true,
        ignoreDotEntries: true
    });
    return files;
}

function readCoverage(lcovFiles) {
    if (lcovFiles.length === 0) {
        return null;
    }
    let found = 0;
    let hit = 0;
    for (const file of lcovFiles) {
        try {
            const text = readTextFileSync(file);
            for (const line of text.split(/\r?\n/)) {
                if (line.startsWith("LF:")) {
                    found += Number.parseInt(line.slice(3)) || 0;
                } else if (line.startsWith("LH:")) {
                    hit += Number.parseInt(line.slice(3)) || 0;
                }
            }
        } catch {
            // Ignore read errors when parsing LCOV files. If a coverage file is
            // malformed, missing, or unreadable, the function continues processing
            // with the coverage data it was able to parse so far. This resilience
            // ensures the quality report can still be generated even when some
            // coverage files are incomplete or corrupted.
        }
    }
    if (found <= 0) {
        return { found: 0, hit, pct: null };
    }
    return { found, hit, pct: (hit / found) * 100 };
}

function readCheckstyle(checkstyleFiles) {
    if (checkstyleFiles.length === 0) {
        return null;
    }
    let warnings = 0;
    let errors = 0;
    for (const file of checkstyleFiles) {
        try {
            const xml = readTextFileSync(file);
            for (const match of xml.matchAll(/<error\b[^>]*severity="([^"]*)"/gi)) {
                const severity = (match[1] || "").toLowerCase();
                if (severity === "warning") {
                    warnings += 1;
                } else if (severity === "error") {
                    errors += 1;
                }
            }
        } catch {
            // Ignore read errors when parsing Checkstyle XML files. If a lint
            // report file is malformed, missing, or unreadable, the function
            // continues processing with the error/warning counts it was able to
            // parse so far. This resilience ensures the quality report can still
            // be generated even when some lint reports are incomplete or corrupted.
        }
    }
    return { warnings, errors };
}

function normalizeLocator(testCase) {
    const node = testCase?.node || {};
    const rawFile = typeof node.file === "string" ? node.file.trim() : "";
    if (rawFile) {
        return `file:${path.normalize(rawFile).replaceAll("\\", "/").toLowerCase()}`;
    }
    const className = typeof node.classname === "string" ? node.classname.trim() : "";
    if (className) {
        return `class:${className}`.toLowerCase();
    }
    if (isNonEmptyArray(testCase?.suitePath)) {
        return `suite:${testCase.suitePath.join("::")}`.toLowerCase();
    }
    return null;
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

function collectCaseDifferences(baseResults, targetResults) {
    return {
        newCases: collectMissingCases(targetResults, baseResults),
        removedCases: collectMissingCases(baseResults, targetResults)
    };
}

function collectMissingCases(sourceResults, comparisonResults) {
    const comparableReportNames = collectComparableReportNames(sourceResults, comparisonResults);
    const missing = [];
    for (const [key, record] of sourceResults.results.entries()) {
        if (!comparisonResults.results.has(key) && isComparableReportRecord(record, comparableReportNames)) {
            missing.push(record);
        }
    }
    return missing;
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

function normalizeReportFileName(record) {
    const reportFilePath = typeof record?.reportFilePath === "string" ? record.reportFilePath : "";
    return path.basename(reportFilePath).trim().toLowerCase();
}

function isComparableReportRecord(record, comparableReportNames) {
    const reportName = normalizeReportFileName(record);
    return !reportName || comparableReportNames.has(reportName);
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

function createDirectoryScanResult(
    status,
    { notes = [], cases = [], coverage = null, lint = null, duplicates = null, health = null } = {}
) {
    return {
        status,
        notes,
        cases,
        coverage,
        lint,
        duplicates,
        health
    };
}

function scanResultDirectory(directory, root) {
    if (!isExistingDirectory(directory.resolved)) {
        return createDirectoryScanResult(ScanStatus.MISSING);
    }

    const allFiles = listFilesRecursive(directory.resolved);
    const { xmlFiles, lcovFiles, checkstyleFiles, jscpdFiles, healthFiles } = classifyReportFiles(allFiles);

    if (xmlFiles.length === 0) {
        return createDirectoryScanResult(ScanStatus.EMPTY);
    }

    const { cases, notes } = collectDirectoryTestCases(xmlFiles, root);
    const coverage = readCoverage(lcovFiles);
    const lint = readCheckstyle(checkstyleFiles);
    const duplicates = readDuplicates(jscpdFiles);
    const health = readProjectHealth(healthFiles);

    if (cases.length === 0) {
        return createDirectoryScanResult(ScanStatus.EMPTY, {
            notes,
            coverage,
            lint,
            duplicates,
            health
        });
    }

    return createDirectoryScanResult(ScanStatus.FOUND, {
        notes,
        cases,
        coverage,
        lint,
        duplicates,
        health
    });
}

function readDuplicates(files) {
    if (!files || files.length === 0) {
        return null;
    }
    const file = files[0];
    try {
        const content = readTextFileSync(file);
        const data = parseJsonWithContext(content, {
            source: file,
            description: "JSCPD report"
        });
        return data.statistics?.total || null;
    } catch {
        return null;
    }
}

function readProjectHealth(files) {
    if (!files || files.length === 0) {
        return null;
    }
    const file = files[0];
    try {
        const content = readTextFileSync(file);
        return parseJsonWithContext(content, {
            source: file,
            description: "project health report"
        });
    } catch {
        return null;
    }
}

function isExistingDirectory(resolvedPath) {
    return fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory();
}

/**
 * Check if a file path represents an XML file.
 */
function isXmlFile(filePath: string): boolean {
    return filePath.endsWith(".xml");
}

/**
 * Check if a file path represents an LCOV coverage file.
 */
function isLcovFile(filePath: string): boolean {
    return path.basename(filePath) === "lcov.info";
}

/**
 * Check if a file path represents a Checkstyle report file.
 */
function isCheckstyleFile(filePath: string): boolean {
    return /checkstyle/i.test(path.basename(filePath));
}

/**
 * Check if a file path represents a JSCPD duplicate detection report.
 */
function isJscpdReportFile(filePath: string): boolean {
    return path.basename(filePath) === "jscpd-report.json";
}

/**
 * Check if a file path represents a project health report.
 */
function isProjectHealthFile(filePath: string): boolean {
    return path.basename(filePath) === "project-health.json";
}

/**
 * Classify a list of files into specific report types.
 *
 * Centralizes file type detection logic so orchestrator functions work with
 * classified file collections instead of raw predicates and inline filters.
 */
function classifyReportFiles(files: string[]): {
    xmlFiles: string[];
    lcovFiles: string[];
    checkstyleFiles: string[];
    jscpdFiles: string[];
    healthFiles: string[];
} {
    return {
        xmlFiles: files.filter(isXmlFile),
        lcovFiles: files.filter(isLcovFile),
        checkstyleFiles: files.filter(isCheckstyleFile),
        jscpdFiles: files.filter(isJscpdReportFile),
        healthFiles: files.filter(isProjectHealthFile)
    };
}

function collectDirectoryTestCases(xmlFiles, root) {
    const aggregate = createTestCaseAggregate();

    for (const filePath of xmlFiles) {
        const displayPath = path.relative(root || process.cwd(), filePath);
        const additions = collectTestCasesFromXmlFile(filePath, displayPath);

        mergeTestCaseAggregate(aggregate, additions);
    }

    return aggregate;
}

function createTestCaseAggregate() {
    return { cases: [], notes: [] };
}

/**
 * Merge the parsed test case results into the accumulating aggregate.
 *
 * Isolating the array mutations here ensures the directory collector only
 * sequences work instead of pushing elements directly.
 */
function mergeTestCaseAggregate(target, additions) {
    if (!additions) {
        return target;
    }

    const { cases = [], notes = [] } = additions;

    if (cases.length > 0) {
        target.cases.push(...cases);
    }

    if (notes.length > 0) {
        target.notes.push(...notes);
    }

    return target;
}

function collectTestCasesFromXmlFile(filePath, displayPath) {
    const readResult = readXmlFile(filePath, displayPath);
    if (readResult.status === ParseResultStatus.ERROR) {
        return { cases: [], notes: [readResult.note] };
    }

    const xml = readResult.contents;
    if (!xml.trim()) {
        return { cases: [], notes: [] };
    }

    const parseResult = parseXmlTestCases(xml, displayPath, filePath);
    if (parseResult.status === ParseResultStatus.ERROR) {
        return { cases: [], notes: [parseResult.note] };
    }

    if (parseResult.status === ParseResultStatus.IGNORED) {
        return {
            cases: [],
            notes: parseResult.note ? [parseResult.note] : []
        };
    }

    return { cases: parseResult.cases, notes: [] };
}

function readXmlFile(filePath, displayPath) {
    try {
        return { status: ParseResultStatus.OK, contents: readTextFileSync(filePath) };
    } catch (error) {
        const message = getErrorMessageOrFallback(error);
        return {
            status: ParseResultStatus.ERROR,
            note: `Failed to read ${displayPath}: ${message}`
        };
    }
}

function parseXmlTestCases(xml, displayPath, reportFilePath = "") {
    try {
        const data = parser.parse(xml);
        if (isCheckstyleDocument(data)) {
            return {
                status: ParseResultStatus.IGNORED,
                note: `Ignoring checkstyle report ${displayPath}; no test cases found.`
            };
        }
        if (!documentContainsTestElements(data)) {
            return {
                status: ParseResultStatus.ERROR,
                note: `Parsed ${displayPath} but it does not contain any test suites or cases.`
            };
        }
        return {
            status: ParseResultStatus.OK,
            cases: collectTestCases(data, { reportFilePath })
        };
    } catch (error) {
        const message = getErrorMessageOrFallback(error);
        return {
            status: ParseResultStatus.ERROR,
            note: `Failed to parse ${displayPath}: ${message}`
        };
    }
}

function isCheckstyleDocument(document) {
    if (!isObjectLike(document) || Array.isArray(document)) {
        return false;
    }

    const root = document.checkstyle;
    if (!isObjectLike(root) || Array.isArray(root)) {
        return false;
    }

    if (hasAnyOwn(root, ["testsuite", "testcase"])) {
        return false;
    }

    const files = toArray(root.file);
    if (files.length === 0) {
        return true;
    }

    return files.every((file) => isObjectLike(file) && isNonEmptyTrimmedString(file.name));
}

function documentContainsTestElements(document) {
    const queue = [document];
    let found = false;

    processTraversalQueue(queue, (current, queueRef) => {
        if (Array.isArray(current)) {
            enqueueTraversalValues(queueRef, current);
            return;
        }

        if (!isObjectLike(current)) {
            return;
        }

        if (
            Object.hasOwn(current, "testcase") ||
            Object.hasOwn(current, "testsuite") ||
            Object.hasOwn(current, "testsuites")
        ) {
            found = true;
            return true; // Terminate early
        }

        enqueueObjectChildValues(queueRef, current);
    });

    return found;
}

/**
 * Appends traversal candidates to the queue.
 */
function enqueueTraversalValues(queue, values) {
    queue.push(...values);
}

/**
 * Appends all object child values to the traversal queue.
 */
function enqueueObjectChildValues(queue, object) {
    enqueueTraversalValues(queue, Object.values(object));
}

function recordTestCases(aggregates, testCases) {
    const { results } = aggregates;

    for (const testCase of testCases) {
        const existingRecord = results.get(testCase.key);
        const preferredRecord = choosePreferredTestRecord(existingRecord, testCase);
        results.set(testCase.key, preferredRecord);
    }
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

type AggregatedTestRecord = TestRecordEntry & {
    key?: string;
    displayName?: string;
    time?: number;
    reportFilePath: string;
};

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
    if (fs.existsSync(parentFile)) {
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

        if (scan.status === ScanStatus.MISSING || scan.status === ScanStatus.EMPTY) {
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
            health: scan.health
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

/** Shared record shape for test-case entries in the results maps. */
type TestRecordNode = { file?: string; name?: string };
type TestRecordEntry = { status?: string; node?: TestRecordNode; reportFilePath?: string };

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
 * Return true when a record originated from canonical `tests.xml`.
 */
function isCanonicalTestRecord(record: TestRecordEntry): boolean {
    return typeof record.reportFilePath === "string" && isCanonicalTestsXmlReportPath(record.reportFilePath);
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

export function createGenerateQualityReportCommand() {
    return applyStandardCommandOptions(
        new Command()
            .name("generate-quality-report")
            .description("Generate a quality report (tests, lint, coverage, duplicates) and detect regressions.")
            .option("--base <path>", "Path to base reports")
            .option("--head <path>", "Path to head reports")
            .option("--merge <path>", "Path to merge reports")
            .option("--report-file <path>", "Path to write the report markdown file")
    );
}

export function runGenerateQualityReport({ command }: any = {}) {
    const options = command?.opts() || {};
    const exitCode = runCli(options);

    if (exitCode === 10) {
        return exitCode;
    }

    if (exitCode !== 0) {
        process.exitCode = exitCode;
        throw new CliUsageError("Test regressions detected.");
    }

    return 0;
}

type ReportTableState = {
    testRows: Array<string>;
    qualityRows: Array<string>;
};

/**
 * Create the report table containers with their headings pre-populated.
 */
function createQualityReportTables(): ReportTableState {
    return {
        testRows: [
            "#### Test Results",
            "",
            "| Target | Total | Passed | Failed | Skipped | New | Removed | Renamed | Duration | Coverage |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
        ],
        qualityRows: [
            "#### Code Quality",
            "",
            "| Target | Lint Warnings | Lint Errors | Duplicated Code | Build Size | Files > 1k LoC | TODOs |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"
        ]
    };
}

/**
 * Append report rows for an available result set, keeping the orchestration
 * layer free from direct array mutation.
 */
function addReportRowForResultSet(
    tables: ReportTableState,
    {
        label,
        results,
        diffStats,
        healthStats = null
    }: {
        label: string;
        results: { usedDir?: string | null; lint?: unknown; duplicates?: unknown; health?: unknown };
        diffStats: any;
        healthStats?: unknown;
    }
): void {
    if (!results?.usedDir) {
        return;
    }

    tables.testRows.push(generateTestRow(label, results, diffStats));
    tables.qualityRows.push(generateQualityRow(label, results, healthStats));
}

/**
 * Resolve a user-friendly label for the head results, optionally including the
 * current branch name when the base and merged inputs are not present.
 */
function resolveHeadReportLabel({ base, merged }) {
    if (base.usedDir || merged.usedDir) {
        return "PR (Head)";
    }

    let label = "Current";
    try {
        const branch = execSync("git rev-parse --abbrev-ref HEAD", {
            encoding: "utf8"
        }).trim();
        if (branch) {
            label = `Local (${branch})`;
        }
    } catch {
        // Ignore git command errors to avoid breaking the report generation.
        // REASON: Retrieving the current git branch name is a cosmetic enhancement
        // for the quality report label. If the git command fails (e.g., not in a
        // git repository, git not installed, or detached HEAD state), we fall back
        // to the default label without branch information rather than aborting.
        // WHAT WOULD BREAK: Propagating the exception would prevent the quality
        // report from being generated, even though the underlying data is valid.
    }
    return label;
}

/**
 * Format the final report markdown table with the test and quality sections.
 */
function formatQualityReportTable({ testRows, qualityRows }: ReportTableState): string {
    return [...testRows, "", ...qualityRows].join("\n");
}

function formatRegressionComparisonFlow({
    base,
    head,
    merged
}: {
    base: { usedDir?: string | null };
    head: { usedDir?: string | null };
    merged: { usedDir?: string | null };
}): string {
    const lines = [
        "#### Regression Comparison Flow",
        "",
        "- Base: baseline snapshot used as the source of truth for historical pass/fail state.",
        "- PR (Head): pull request head commit snapshot."
    ];

    if (merged.usedDir) {
        lines.push(
            "- Merged: synthetic merge snapshot for this PR event (`base.sha + head.sha`).",
            "- Regression gate target: **Merged**."
        );
    } else {
        lines.push("- Merged: unavailable for this run.", "- Regression gate target: **PR (Head)**.");
    }

    if (!base.usedDir && !head.usedDir && !merged.usedDir) {
        lines.push("- Regression gate target: unavailable (missing required artifacts).");
    }

    return lines.join("\n");
}

function runCli(options: any = {}) {
    const workspaceRoot = process.env.GITHUB_WORKSPACE || process.cwd();
    const reportFile = options.reportFile || path.join("reports", "summary-report.md");

    const baseDir = options.base ? [options.base] : [path.join("base", "reports"), "base-reports"];
    const headDir = options.head ? [options.head] : ["reports"];
    const mergeDir = options.merge ? [options.merge] : [path.join("merge", "reports"), "merge-reports"];

    const base = readTestResults(baseDir, { workspace: workspaceRoot });
    const head = readTestResults(headDir, { workspace: workspaceRoot });
    const merged = readTestResults(mergeDir, { workspace: workspaceRoot });

    const { target, usingMerged } = chooseTargetResultSet({
        merged,
        head
    });

    const diffStats = {
        base: base.usedDir ? { newTests: 0, removedTests: 0, renamedTests: 0 } : null,
        head: computeTestDiff(base, head),
        merge: computeTestDiff(base, merged)
    };

    const healthStats = scanProjectHealth(workspaceRoot);

    const reportTables = createQualityReportTables();

    addReportRowForResultSet(reportTables, {
        label: "Base",
        results: base,
        diffStats: diffStats.base
    });

    addReportRowForResultSet(reportTables, {
        label: resolveHeadReportLabel({ base, merged }),
        results: head,
        diffStats: diffStats.head,
        healthStats
    });

    addReportRowForResultSet(reportTables, {
        label: "Merged",
        results: merged,
        diffStats: diffStats.merge
    });

    const table = formatQualityReportTable(reportTables);
    const comparisonFlow = formatRegressionComparisonFlow({
        base,
        head,
        merged
    });
    console.log(table);
    console.log(`\n${comparisonFlow}`);

    let exitCode = 0;
    let statusLine;

    if (base.usedDir && target.usedDir) {
        const regressions = detectRegressions(base, target);
        const gateLabel = usingMerged ? "Base → Merged" : "Base → PR (Head)";
        if (regressions.length > 0) {
            exitCode = 10;
            const cause = describeRegressionCause(regressions, diffStats[usingMerged ? "merge" : "head"]);
            const summary = summarizeRegressedTests(regressions);
            statusLine = `❌ Test regressions detected (${gateLabel}). ${summary}. Cause: ${cause}`;
        } else {
            statusLine = `✅ No test regressions detected (${gateLabel}).`;
        }
    } else {
        statusLine = "⚠️ Unable to compare base and target results (missing artifacts for gate target).";
    }

    console.log(`\n${statusLine}`);

    if (reportFile) {
        const reportContent = [
            "<!-- automerge-pr-test-summary -->",
            "### Quality Report Summary",
            "",
            table,
            "",
            comparisonFlow,
            "",
            statusLine
        ].join("\n");
        fs.writeFileSync(reportFile, reportContent);
    }

    return exitCode;
}

const isMainModule = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isMainModule) {
    try {
        const exitCode = runCli();
        if (typeof exitCode === "number") {
            process.exitCode = exitCode;
        }
    } catch (error) {
        handleCliError(error, {
            prefix: "Failed to detect test regressions.",
            exitCode: typeof error?.exitCode === "number" ? error.exitCode : 1
        });
    }
}

export {
    collectTestCases,
    detectRegressions,
    detectResolvedFailures,
    ensureResultsAvailability,
    readTestResults,
    reportRegressionSummary
};

const fmtCoverage = (data) => {
    if (!data || !Number.isFinite(data.pct)) {
        return "—";
    }
    return `${data.pct.toFixed(1)}%`;
};

const fmtTime = (s) =>
    !Number.isFinite(s) || s <= 0
        ? "—"
        : s < 1
          ? `${(s * 1000).toFixed(0)}ms`
          : s >= 60
            ? `${Math.floor(s / 60)}m ${(s - Math.floor(s / 60) * 60).toFixed(1)}s`
            : `${s.toFixed(2)}s`;

const fmtLintCount = (value) => (value == null ? "—" : `${value}`);

const fmtDuplicates = (data) => {
    if (!data) {
        return "—";
    }
    return `${data.percentage}% (${data.clones})`;
};

function formatDiffValue(value) {
    return value == null ? "—" : `${Math.max(0, value)}`;
}

function generateTestRow(label, results, diffStats) {
    const totals = results.stats || {};
    const hasAny = totals.total > 0;
    const coverageCell = fmtCoverage(results.coverage);
    const diff = diffStats
        ? {
              newTests: formatDiffValue(diffStats.newTests),
              removedTests: formatDiffValue(diffStats.removedTests),
              renamedTests: formatDiffValue(diffStats.renamedTests)
          }
        : { newTests: "—", removedTests: "—", renamedTests: "—" };

    if (!hasAny) {
        return `| ${label} | — | — | — | — | ${diff.newTests} | ${diff.removedTests} | ${diff.renamedTests} | — | ${coverageCell} |`;
    }
    return `| ${label} | ${totals.total} | ${totals.passed} | ${totals.failed} | ${totals.skipped} | ${diff.newTests} | ${diff.removedTests} | ${diff.renamedTests} | ${fmtTime(totals.time)} | ${coverageCell} |`;
}

function generateQualityRow(label, results, healthStats = null) {
    const stats = healthStats || results.health;
    const lintWarningsCell = fmtLintCount(results.lint?.warnings);
    const lintErrorsCell = fmtLintCount(results.lint?.errors);
    const duplicatesCell = fmtDuplicates(results.duplicates);
    const buildSizeCell = stats ? stats.buildSize : "—";
    const largeFilesCell = stats ? stats.largeFiles : "—";
    const todosCell = stats ? stats.todos : "—";

    return `| ${label} | ${lintWarningsCell} | ${lintErrorsCell} | ${duplicatesCell} | ${buildSizeCell} | ${largeFilesCell} | ${todosCell} |`;
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
