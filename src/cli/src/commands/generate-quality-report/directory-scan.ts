/**
 * Scans a single candidate results directory on disk and classifies its report
 * files (JUnit XML, LCOV coverage, Checkstyle lint, JSCPD duplicates, project
 * health) into the shape consumed by result aggregation.
 */

import path from "node:path";
import process from "node:process";

import { Core } from "@gmloop/core";

import { ScanStatus } from "../../modules/quality-report/index.js";
import { traverseDirectoryEntries } from "../../shared/directory-traversal.js";
import { pathExistsSync } from "../../shared/path-exists.js";
import { collectTestCasesFromXmlFile } from "./junit-parsing.js";

const { compactArray, parseJsonWithContext, readTextFileSync, toArray } = Core;

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
                    found += Number.parseInt(line.slice(3), 10) || 0;
                } else if (line.startsWith("LH:")) {
                    hit += Number.parseInt(line.slice(3), 10) || 0;
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
    return pathExistsSync(resolvedPath, (stat) => stat.isDirectory());
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

function collectDirectoryTestCases(xmlFiles, root) {
    const aggregate = createTestCaseAggregate();

    for (const filePath of xmlFiles) {
        const displayPath = path.relative(root || process.cwd(), filePath);
        const additions = collectTestCasesFromXmlFile(filePath, displayPath);

        mergeTestCaseAggregate(aggregate, additions);
    }

    return aggregate;
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

export { normalizeResultDirectories, readDuplicates, scanResultDirectory };
