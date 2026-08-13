/**
 * Parses JUnit-style XML documents (and detects Checkstyle documents that should be
 * ignored) into the flat test-case record shape consumed by the rest of the quality
 * report pipeline. Pure parsing/tree-walking helpers only; no filesystem access.
 */

import path from "node:path";

import { Core } from "@gmloop/core";
import { XMLParser } from "fast-xml-parser";

import { ParseResultStatus, TestCaseStatus } from "../../modules/quality-report/index.js";

const {
    assertArray,
    getErrorMessageOrFallback,
    isNonEmptyTrimmedString,
    isObjectLike,
    readTextFileSync,
    toArray,
    toTrimmedString
} = Core;

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ""
});

const NON_WORKSPACE_PATH_SEGMENTS = new Set(["dist", "test", "tests", "reports", "report", "node_modules"]);
const NON_WORKSPACE_PATH_PATTERNS = [/^report-/u];
const GENERIC_REPORT_FILE_STEMS = new Set([
    "junit",
    "junit-report",
    "report",
    "results",
    "root",
    "suite",
    "test",
    "test-results",
    "tests"
]);

function xmlContainsPotentialTestElements(xml: string): boolean {
    const lowered = xml.toLowerCase();
    return lowered.includes("<testsuite") || lowered.includes("<testsuites") || lowered.includes("<testcase");
}

function xmlLooksLikeCheckstyle(xml: string): boolean {
    return xml.toLowerCase().includes("<checkstyle");
}

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

function extractWorkspaceNameFromPath(candidatePath: string): string {
    if (!candidatePath) {
        return "";
    }
    const normalized = candidatePath.replaceAll("\\", "/");
    const segments = normalized.split("/");
    const srcIndex = segments.indexOf("src");
    if (srcIndex !== -1 && srcIndex + 1 < segments.length) {
        return segments[srcIndex + 1];
    }
    return "";
}

function extractWorkspaceNameFromReportPath(reportFilePath: string): string {
    if (!reportFilePath) {
        return "";
    }

    const normalized = reportFilePath.replaceAll("\\", "/");
    const workspaceFromDirectory = extractWorkspaceNameFromPath(normalized);
    if (workspaceFromDirectory) {
        return workspaceFromDirectory;
    }

    const reportFileStem = path.basename(normalized, path.extname(normalized));
    if (reportFileStem && !GENERIC_REPORT_FILE_STEMS.has(reportFileStem)) {
        return reportFileStem;
    }

    const parentDirectoryName = path.basename(path.dirname(normalized));
    if (
        !parentDirectoryName ||
        NON_WORKSPACE_PATH_SEGMENTS.has(parentDirectoryName) ||
        NON_WORKSPACE_PATH_PATTERNS.some((pattern) => pattern.test(parentDirectoryName))
    ) {
        return "";
    }
    return parentDirectoryName;
}

/**
 * Record a single testcase result in the aggregate list.
 */
function recordSuiteTestCase(cases, node, suitePath, reportFilePath = "") {
    const key = buildTestKey(node, suitePath);
    const displayName = describeTestCase(node, suitePath) || key;
    const time = Number.parseFloat(node.time) || 0;
    const workspace =
        extractWorkspaceNameFromPath(toTrimmedString(node.file)) || extractWorkspaceNameFromReportPath(reportFilePath);

    cases.push({
        node,
        suitePath,
        key,
        status: computeStatus(node),
        displayName,
        time,
        reportFilePath,
        workspace
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
    if (!xmlContainsPotentialTestElements(xml)) {
        if (xmlLooksLikeCheckstyle(xml)) {
            return {
                status: ParseResultStatus.IGNORED,
                note: `Ignoring checkstyle report ${displayPath}; no test cases found.`
            };
        }

        return {
            status: ParseResultStatus.ERROR,
            note: `Parsed ${displayPath} but it does not contain any test suites or cases.`
        };
    }

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

export { collectTestCases, collectTestCasesFromXmlFile };
