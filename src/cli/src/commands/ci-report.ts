import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { Command } from "commander";

const MANIFEST_SCHEMA_VERSION = 1;
const REPORT_SCHEMA_VERSION = 3;
const TIMING_SCHEMA_VERSION = 1;
const DEFAULT_SHARD_COUNT = 5;
const TEST_TIMEOUT_MS = 120_000;
const SYNTHETIC_JUNIT_MARKER = "Test runner exited with status ";

type ProcessResult = Readonly<{
    status: number;
    signal: NodeJS.Signals | null;
}>;

type TestWeight = Readonly<{
    file: string;
    weightMs: number;
}>;

type TestShard = Readonly<{
    name: string;
    files: ReadonlyArray<string>;
    estimatedDurationMs: number;
}>;

type TestManifest = Readonly<{
    schemaVersion: number;
    shardCount: number;
    tests: ReadonlyArray<string>;
    manifestDigest: string;
    planDigest: string;
    shards: ReadonlyArray<TestShard>;
}>;

type ShardMetadata = Readonly<{
    schemaVersion: number;
    shard: string;
    completed: boolean;
    status: number;
    signal: NodeJS.Signals | null;
    durationMs: number;
    testFiles: ReadonlyArray<string>;
    manifestDigest: string;
    planDigest: string;
    reportFile: string;
}>;

type LintMetadata = Readonly<{
    schemaVersion: number;
    completed: boolean;
    status: number;
}>;

type JunitCaseTiming = Readonly<{
    name: string;
    location: string;
    durationSeconds: number;
}>;

type FileDuration = Readonly<{
    file: string;
    durationMs: number;
    source: "junit" | "shard-average";
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePath(value: string): string {
    return value.split(path.sep).join("/");
}

function digestText(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function digestStringList(values: ReadonlyArray<string>): string {
    return digestText(values.join("\0"));
}

function isComparableStatus(value: number): boolean {
    return Number.isInteger(value) && value >= 0 && value <= 1;
}

function parseInteger(value: string | undefined, fallback: number): number {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isInteger(parsed) ? parsed : fallback;
}

async function runProcess(command: string, args: ReadonlyArray<string>): Promise<ProcessResult> {
    return await new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", (code, signal) => {
            if (signal !== null) {
                resolve(Object.freeze({ status: 2, signal }));
                return;
            }
            resolve(Object.freeze({ status: code ?? 2, signal: null }));
        });
    });
}

async function readJsonFile(filePath: string): Promise<unknown> {
    return JSON.parse(await readFile(filePath, "utf8"));
}

async function readOptionalJsonFile(filePath: string): Promise<unknown | null> {
    try {
        return await readJsonFile(filePath);
    } catch (error) {
        if (isRecord(error) && error.code === "ENOENT") {
            return null;
        }
        return null;
    }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function collectFiles(rootDirectory: string): Promise<Array<string>> {
    const output: Array<string> = [];

    async function visit(currentDirectory: string): Promise<void> {
        let entries;
        try {
            entries = await readdir(currentDirectory, { withFileTypes: true });
        } catch (error) {
            if (isRecord(error) && error.code === "ENOENT") {
                return;
            }
            throw error;
        }

        for (const entry of entries) {
            if (entry.name === "node_modules") {
                continue;
            }
            const absolutePath = path.join(currentDirectory, entry.name);
            if (entry.isDirectory()) {
                await visit(absolutePath);
                continue;
            }
            if (entry.isFile()) {
                output.push(normalizePath(path.relative(process.cwd(), absolutePath)));
            }
        }
    }

    await visit(rootDirectory);
    return output;
}

function isPerformanceTest(relativePath: string): boolean {
    const normalized = normalizePath(relativePath).toLowerCase();
    const basename = path.posix.basename(normalized);
    return (
        normalized.includes("/dist/test/performance/") || basename.includes("performance") || basename.includes("perf")
    );
}

function isCanonicalTestPath(relativePath: string): boolean {
    const normalized = normalizePath(relativePath);
    if (!normalized.endsWith(".test.js") || isPerformanceTest(normalized)) {
        return false;
    }
    if (normalized.startsWith("src/") && normalized.includes("/dist/test/")) {
        return true;
    }
    return normalized.startsWith("test/dist/");
}

async function discoverCanonicalTests(): Promise<Array<string>> {
    const discovered = [
        ...(await collectFiles(path.join(process.cwd(), "src"))),
        ...(await collectFiles(path.join(process.cwd(), "test", "dist")))
    ];
    return [...new Set(discovered.filter(isCanonicalTestPath))].sort((left, right) => left.localeCompare(right));
}

function parseTimingHistory(value: unknown): Map<string, number> {
    const result = new Map<string, number>();
    if (!isRecord(value) || !Array.isArray(value.fileDurations)) {
        return result;
    }
    for (const entry of value.fileDurations) {
        if (!isRecord(entry) || typeof entry.file !== "string" || typeof entry.durationMs !== "number") {
            continue;
        }
        if (Number.isFinite(entry.durationMs) && entry.durationMs > 0) {
            result.set(normalizePath(entry.file), entry.durationMs);
        }
    }
    return result;
}

function median(values: ReadonlyArray<number>): number {
    if (values.length === 0) {
        return 1000;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const midpoint = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
        return sorted[midpoint] ?? 1000;
    }
    return ((sorted[midpoint - 1] ?? 1000) + (sorted[midpoint] ?? 1000)) / 2;
}

async function createTestWeights(
    tests: ReadonlyArray<string>,
    history: Map<string, number>
): Promise<Array<TestWeight>> {
    const knownDurations = tests
        .map((testFile) => history.get(testFile))
        .filter((value): value is number => value !== undefined);
    const fallbackDuration = median(knownDurations);
    const sizes = new Map<string, number>();
    for (const testFile of tests) {
        try {
            sizes.set(testFile, (await stat(testFile)).size);
        } catch {
            sizes.set(testFile, 1);
        }
    }
    const medianSize = Math.max(1, median([...sizes.values()]));

    return tests.map((testFile) => {
        const historicalDuration = history.get(testFile);
        if (historicalDuration !== undefined) {
            return Object.freeze({ file: testFile, weightMs: historicalDuration });
        }
        const sizeRatio = Math.min(2, Math.max(0.5, (sizes.get(testFile) ?? medianSize) / medianSize));
        return Object.freeze({ file: testFile, weightMs: Math.max(1, fallbackDuration * sizeRatio) });
    });
}

function createBalancedShardPlan(weights: ReadonlyArray<TestWeight>, shardCount: number): Array<TestShard> {
    if (!Number.isInteger(shardCount) || shardCount < 1) {
        throw new Error(`Shard count must be a positive integer; received ${shardCount}.`);
    }
    if (weights.length < shardCount) {
        throw new Error(`Cannot divide ${weights.length} test files across ${shardCount} non-empty shards.`);
    }

    const mutableShards = Array.from({ length: shardCount }, (_, index) => ({
        name: `shard-${index + 1}`,
        files: [] as Array<string>,
        estimatedDurationMs: 0
    }));

    const orderedWeights = [...weights].sort(
        (left, right) => right.weightMs - left.weightMs || left.file.localeCompare(right.file)
    );
    for (const testWeight of orderedWeights) {
        const target = [...mutableShards].sort(
            (left, right) => left.estimatedDurationMs - right.estimatedDurationMs || left.name.localeCompare(right.name)
        )[0];
        if (!target) {
            throw new Error("Unable to select a shard for a test file.");
        }
        target.files.push(testWeight.file);
        target.estimatedDurationMs += testWeight.weightMs;
    }

    return mutableShards.map((shard) =>
        Object.freeze({
            name: shard.name,
            files: Object.freeze([...shard.files].sort((left, right) => left.localeCompare(right))),
            estimatedDurationMs: Math.round(shard.estimatedDurationMs)
        })
    );
}

function calculateManifestDigest(tests: ReadonlyArray<string>): string {
    return digestStringList([...tests].sort((left, right) => left.localeCompare(right)));
}

function calculatePlanDigest(shards: ReadonlyArray<TestShard>): string {
    const planLines = [...shards]
        .sort((left, right) => left.name.localeCompare(right.name))
        .flatMap((shard) => shard.files.map((file) => `${shard.name}:${file}`));
    return digestStringList(planLines);
}

function findCoverageErrors(manifest: TestManifest, shardMetadata: ReadonlyArray<ShardMetadata>): Array<string> {
    const errors: Array<string> = [];
    const expectedShardNames = manifest.shards.map((shard) => shard.name).sort();
    const actualShardNames = shardMetadata.map((shard) => shard.shard).sort();
    if (JSON.stringify(expectedShardNames) !== JSON.stringify(actualShardNames)) {
        errors.push(`shard set mismatch (${actualShardNames.join(", ")} != ${expectedShardNames.join(", ")})`);
    }

    const seenFiles = new Set<string>();
    for (const shard of shardMetadata) {
        const expected = manifest.shards.find((candidate) => candidate.name === shard.shard);
        if (!expected) {
            errors.push(`unexpected shard ${shard.shard}`);
            continue;
        }
        const expectedFiles = [...expected.files].sort();
        const actualFiles = [...shard.testFiles].sort();
        if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) {
            errors.push(`shard ${shard.shard} test-file assignment does not match the manifest`);
        }
        for (const testFile of shard.testFiles) {
            if (seenFiles.has(testFile)) {
                errors.push(`test file ${testFile} appears in more than one shard`);
            }
            seenFiles.add(testFile);
        }
    }

    const expectedTests = [...manifest.tests].sort();
    const actualTests = [...seenFiles].sort();
    if (JSON.stringify(expectedTests) !== JSON.stringify(actualTests)) {
        const missing = expectedTests.filter((testFile) => !seenFiles.has(testFile));
        const extras = actualTests.filter((testFile) => !manifest.tests.includes(testFile));
        if (missing.length > 0) {
            errors.push(`missing test files: ${missing.join(", ")}`);
        }
        if (extras.length > 0) {
            errors.push(`unexpected test files: ${extras.join(", ")}`);
        }
    }
    return errors;
}

function parseManifest(value: unknown): TestManifest {
    if (!isRecord(value) || value.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
        throw new Error("Invalid test manifest schema.");
    }
    const shardCount =
        typeof value.shardCount === "number" && Number.isInteger(value.shardCount) ? value.shardCount : null;
    if (shardCount === null || !Array.isArray(value.tests) || !Array.isArray(value.shards)) {
        throw new Error("Test manifest is missing required fields.");
    }
    const tests = value.tests.filter((entry): entry is string => typeof entry === "string").map(normalizePath);
    if (tests.length !== value.tests.length || tests.length === 0) {
        throw new Error("Test manifest contains invalid or empty test paths.");
    }
    const shards: Array<TestShard> = [];
    for (const rawShard of value.shards) {
        if (!isRecord(rawShard) || typeof rawShard.name !== "string" || !Array.isArray(rawShard.files)) {
            throw new Error("Test manifest contains an invalid shard.");
        }
        const files = rawShard.files.filter((entry): entry is string => typeof entry === "string").map(normalizePath);
        if (files.length !== rawShard.files.length || files.length === 0) {
            throw new Error(`Test shard ${rawShard.name} has invalid or empty files.`);
        }
        shards.push(
            Object.freeze({
                name: rawShard.name,
                files: Object.freeze(files),
                estimatedDurationMs:
                    typeof rawShard.estimatedDurationMs === "number" && Number.isFinite(rawShard.estimatedDurationMs)
                        ? rawShard.estimatedDurationMs
                        : 0
            })
        );
    }
    const manifest: TestManifest = Object.freeze({
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        shardCount,
        tests: Object.freeze(tests),
        manifestDigest: typeof value.manifestDigest === "string" ? value.manifestDigest : "",
        planDigest: typeof value.planDigest === "string" ? value.planDigest : "",
        shards: Object.freeze(shards)
    });
    if (manifest.shardCount !== manifest.shards.length) {
        throw new Error("Test manifest shard count does not match the declared shard set.");
    }
    if (manifest.manifestDigest !== calculateManifestDigest(manifest.tests)) {
        throw new Error("Test manifest digest is invalid.");
    }
    if (manifest.planDigest !== calculatePlanDigest(manifest.shards)) {
        throw new Error("Test plan digest is invalid.");
    }
    const syntheticMetadata = manifest.shards.map((shard) =>
        Object.freeze({
            schemaVersion: 1,
            shard: shard.name,
            completed: true,
            status: 0,
            signal: null,
            durationMs: 0,
            testFiles: shard.files,
            manifestDigest: manifest.manifestDigest,
            planDigest: manifest.planDigest,
            reportFile: `tests-${shard.name}.xml`
        })
    );
    const coverageErrors = findCoverageErrors(manifest, syntheticMetadata);
    if (coverageErrors.length > 0) {
        throw new Error(`Test manifest does not cover the canonical corpus exactly once: ${coverageErrors.join("; ")}`);
    }
    return manifest;
}

async function createManifest(
    options: Readonly<{ output: string; history?: string; shardCount: number }>
): Promise<TestManifest> {
    const tests = await discoverCanonicalTests();
    if (tests.length === 0) {
        throw new Error("No canonical compiled test files were found.");
    }
    let history = new Map<string, number>();
    if (options.history) {
        history = parseTimingHistory(await readOptionalJsonFile(options.history));
    }
    const weights = await createTestWeights(tests, history);
    const shards = createBalancedShardPlan(weights, options.shardCount);
    const manifest: TestManifest = Object.freeze({
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        shardCount: options.shardCount,
        tests: Object.freeze(tests),
        manifestDigest: calculateManifestDigest(tests),
        planDigest: calculatePlanDigest(shards),
        shards: Object.freeze(shards)
    });
    await writeJsonFile(options.output, manifest);
    return manifest;
}

async function appendGithubOutputs(outputPath: string | undefined, manifest: TestManifest): Promise<void> {
    if (!outputPath) {
        return;
    }
    const matrix = JSON.stringify({ shard: manifest.shards.map((shard) => shard.name) });
    await appendFile(
        outputPath,
        `matrix=${matrix}\nmanifest_digest=${manifest.manifestDigest}\nplan_digest=${manifest.planDigest}\n`,
        "utf8"
    );
}

function decodeXml(value: string): string {
    return value
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&");
}

function parseXmlAttributes(fragment: string): Record<string, string> {
    const attributes: Record<string, string> = {};
    const pattern = /([A-Za-z_:][\w:.-]*)="([^"]*)"/gu;
    for (const match of fragment.matchAll(pattern)) {
        const key = match[1];
        const value = match[2];
        if (key !== undefined && value !== undefined) {
            attributes[key] = decodeXml(value);
        }
    }
    return attributes;
}

function parseJunitCases(xml: string): Array<JunitCaseTiming> {
    const output: Array<JunitCaseTiming> = [];
    for (const match of xml.matchAll(/<testcase\b([^>]*)>/gu)) {
        const attributes = parseXmlAttributes(match[1] ?? "");
        const durationSeconds = Number.parseFloat(attributes.time ?? attributes.duration ?? attributes.elapsed ?? "0");
        if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
            continue;
        }
        output.push(
            Object.freeze({
                name: attributes.name ?? "(unnamed test)",
                location: attributes.file ?? attributes.classname ?? "",
                durationSeconds
            })
        );
    }
    return output;
}

function isCompleteJunit(xml: string): boolean {
    return xml.includes("<testsuites") && xml.includes("</testsuites>") && !xml.includes(SYNTHETIC_JUNIT_MARKER);
}

async function runShard(
    options: Readonly<{ manifestPath: string; shardName: string; reportDirectory: string }>
): Promise<number> {
    const manifest = parseManifest(await readJsonFile(options.manifestPath));
    const shard = manifest.shards.find((candidate) => candidate.name === options.shardName);
    if (!shard) {
        throw new Error(`Unknown test shard ${options.shardName}.`);
    }
    await mkdir(options.reportDirectory, { recursive: true });
    const reportFile = `tests-${shard.name}.xml`;
    const reportPath = path.join(options.reportDirectory, reportFile);
    const started = performance.now();
    const result = await runProcess(process.execPath, [
        "--disable-warning=ExperimentalWarning",
        "--test-force-exit",
        "--test",
        `--test-timeout=${TEST_TIMEOUT_MS}`,
        "--test-reporter=dot",
        "--test-reporter-destination=stdout",
        "--test-reporter=junit",
        `--test-reporter-destination=${reportPath}`,
        ...shard.files
    ]);
    const metadata: ShardMetadata = Object.freeze({
        schemaVersion: 1,
        shard: shard.name,
        completed: result.signal === null,
        status: result.status,
        signal: result.signal,
        durationMs: Math.round(performance.now() - started),
        testFiles: shard.files,
        manifestDigest: manifest.manifestDigest,
        planDigest: manifest.planDigest,
        reportFile
    });
    await writeJsonFile(path.join(options.reportDirectory, `test-${shard.name}.json`), metadata);
    return result.status;
}

type EslintMessage = Readonly<{
    line: number;
    column: number;
    severity: number;
    message: string;
    ruleId: string | null;
}>;

type EslintResult = Readonly<{
    filePath: string;
    messages: ReadonlyArray<EslintMessage>;
}>;

function parseEslintResults(value: unknown): Array<EslintResult> {
    if (!Array.isArray(value)) {
        throw new TypeError("ESLint JSON output is not an array.");
    }
    return value.map((entry) => {
        if (!isRecord(entry) || typeof entry.filePath !== "string" || !Array.isArray(entry.messages)) {
            throw new Error("ESLint JSON output contains an invalid result entry.");
        }
        const messages = entry.messages.map((message) => {
            if (!isRecord(message) || typeof message.message !== "string") {
                throw new Error("ESLint JSON output contains an invalid message entry.");
            }
            return Object.freeze({
                line: typeof message.line === "number" ? message.line : 1,
                column: typeof message.column === "number" ? message.column : 1,
                severity: typeof message.severity === "number" ? message.severity : 1,
                message: message.message,
                ruleId: typeof message.ruleId === "string" ? message.ruleId : null
            });
        });
        return Object.freeze({ filePath: entry.filePath, messages: Object.freeze(messages) });
    });
}

function escapeXml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

function createCheckstyleXml(results: ReadonlyArray<EslintResult>): string {
    const files = results
        .filter((result) => result.messages.length > 0)
        .map((result) => {
            const relativePath = normalizePath(path.relative(process.cwd(), result.filePath) || result.filePath);
            const messages = result.messages
                .map((message) => {
                    const source = message.ruleId === null ? "eslint" : `eslint.${message.ruleId}`;
                    const severity = message.severity === 2 ? "error" : "warning";
                    return `    <error line="${Math.max(1, message.line)}" column="${Math.max(1, message.column)}" severity="${severity}" message="${escapeXml(message.message)}" source="${escapeXml(source)}" />`;
                })
                .join("\n");
            return `  <file name="${escapeXml(relativePath)}">\n${messages}\n  </file>`;
        })
        .join("\n");
    return `<?xml version="1.0" encoding="utf-8"?>\n<checkstyle version="8.0">\n${files}${files ? "\n" : ""}</checkstyle>\n`;
}

async function runLintReport(reportDirectory: string): Promise<number> {
    await mkdir(reportDirectory, { recursive: true });
    const jsonPath = path.join(reportDirectory, "eslint.json");
    const checkstylePath = path.join(reportDirectory, "eslint-checkstyle.xml");
    const result = await runProcess("pnpm", ["exec", "eslint", ".", "--format", "json", "--output-file", jsonPath]);
    let completed = false;
    try {
        const parsed = parseEslintResults(await readJsonFile(jsonPath));
        await writeFile(checkstylePath, createCheckstyleXml(parsed), "utf8");
        completed = result.signal === null && isComparableStatus(result.status);
    } catch (error) {
        console.error(error);
    }
    const metadata: LintMetadata = Object.freeze({
        schemaVersion: 1,
        completed,
        status: result.status
    });
    await writeJsonFile(path.join(reportDirectory, "lint-meta.json"), metadata);
    return result.status;
}

function parseShardMetadata(value: unknown): ShardMetadata {
    if (
        !isRecord(value) ||
        value.schemaVersion !== 1 ||
        typeof value.shard !== "string" ||
        !Array.isArray(value.testFiles)
    ) {
        throw new Error("Invalid test-shard metadata.");
    }
    const testFiles = value.testFiles.filter((entry): entry is string => typeof entry === "string").map(normalizePath);
    if (testFiles.length !== value.testFiles.length) {
        throw new Error(`Shard ${value.shard} contains an invalid test path.`);
    }
    return Object.freeze({
        schemaVersion: 1,
        shard: value.shard,
        completed: value.completed === true,
        status: typeof value.status === "number" ? value.status : 2,
        signal: typeof value.signal === "string" ? (value.signal as NodeJS.Signals) : null,
        durationMs: typeof value.durationMs === "number" ? value.durationMs : 0,
        testFiles: Object.freeze(testFiles),
        manifestDigest: typeof value.manifestDigest === "string" ? value.manifestDigest : "",
        planDigest: typeof value.planDigest === "string" ? value.planDigest : "",
        reportFile: typeof value.reportFile === "string" ? value.reportFile : ""
    });
}

function matchTimingToFile(location: string, files: ReadonlyArray<string>): string | null {
    const normalizedLocation = normalizePath(location).replace(/^file:\/\//u, "");
    const suffixMatches = files.filter((testFile) => normalizedLocation.endsWith(testFile));
    if (suffixMatches.length === 1) {
        return suffixMatches[0] ?? null;
    }
    const basename = path.posix.basename(normalizedLocation);
    const basenameMatches = files.filter((testFile) => path.posix.basename(testFile) === basename);
    return basenameMatches.length === 1 ? (basenameMatches[0] ?? null) : null;
}

function escapeMarkdown(value: string): string {
    return value.replaceAll("|", String.raw`\|`).replaceAll("\n", " ");
}

function formatDuration(seconds: number): string {
    return seconds >= 60 ? `${(seconds / 60).toFixed(2)} min` : `${seconds.toFixed(3)} s`;
}

async function assembleReport(
    options: Readonly<{
        manifestPath: string;
        reportDirectory: string;
        targetSha: string;
        toolingFingerprint: string;
        buildStatus: number;
    }>
): Promise<boolean> {
    const manifest = parseManifest(await readJsonFile(options.manifestPath));
    await mkdir(options.reportDirectory, { recursive: true });
    const lintValue = await readOptionalJsonFile(path.join(options.reportDirectory, "lint-meta.json"));
    const lintMetadata = isRecord(lintValue)
        ? Object.freeze({
              completed: lintValue.completed === true,
              status: typeof lintValue.status === "number" ? lintValue.status : 2
          })
        : Object.freeze({ completed: false, status: 2 });
    const shardMetadata: Array<ShardMetadata> = [];
    const junitCasesByShard = new Map<string, Array<JunitCaseTiming>>();
    let testReportSynthetic = false;

    for (const shard of manifest.shards) {
        const metadataValue = await readOptionalJsonFile(path.join(options.reportDirectory, `test-${shard.name}.json`));
        let metadata: ShardMetadata;
        try {
            metadata = parseShardMetadata(metadataValue);
        } catch {
            metadata = Object.freeze({
                schemaVersion: 1,
                shard: shard.name,
                completed: false,
                status: 2,
                signal: null,
                durationMs: 0,
                testFiles: Object.freeze([]),
                manifestDigest: "",
                planDigest: "",
                reportFile: `tests-${shard.name}.xml`
            });
        }
        shardMetadata.push(metadata);
        let junit = "";
        try {
            junit = await readFile(path.join(options.reportDirectory, metadata.reportFile), "utf8");
        } catch {
            junit = "";
        }
        if (junit.includes(SYNTHETIC_JUNIT_MARKER)) {
            testReportSynthetic = true;
        }
        junitCasesByShard.set(shard.name, parseJunitCases(junit));
    }

    const coverageErrors = findCoverageErrors(manifest, shardMetadata);
    const allShardsComparable = shardMetadata.every(
        (shard) =>
            shard.completed &&
            isComparableStatus(shard.status) &&
            shard.manifestDigest === manifest.manifestDigest &&
            shard.planDigest === manifest.planDigest
    );
    const testStatus = allShardsComparable ? Math.max(0, ...shardMetadata.map((shard) => shard.status)) : 2;
    const completed =
        options.buildStatus === 0 &&
        lintMetadata.completed &&
        isComparableStatus(lintMetadata.status) &&
        allShardsComparable &&
        coverageErrors.length === 0 &&
        !testReportSynthetic;

    const reportMetadata = Object.freeze({
        schemaVersion: REPORT_SCHEMA_VERSION,
        completed,
        targetSha: options.targetSha,
        toolingFingerprint: options.toolingFingerprint,
        buildStatus: options.buildStatus,
        lintStatus: lintMetadata.status,
        testStatus,
        testReportSynthetic,
        manifestDigest: manifest.manifestDigest,
        planDigest: manifest.planDigest,
        shardCount: manifest.shardCount,
        testShards: shardMetadata.map((shard) => ({
            name: shard.shard,
            completed: shard.completed,
            status: shard.status,
            signal: shard.signal,
            durationMs: shard.durationMs,
            testFileCount: shard.testFiles.length,
            testFiles: shard.testFiles,
            manifestDigest: shard.manifestDigest,
            planDigest: shard.planDigest,
            reportFile: shard.reportFile
        }))
    });
    await writeJsonFile(path.join(options.reportDirectory, "auto-merge-report.json"), reportMetadata);
    await writeJsonFile(path.join(options.reportDirectory, "test-manifest.json"), manifest);

    const allCases: Array<JunitCaseTiming & Readonly<{ shard: string }>> = [];
    const fileDurations = new Map<string, { durationMs: number; source: "junit" | "shard-average" }>();
    for (const shard of shardMetadata) {
        const cases = junitCasesByShard.get(shard.shard) ?? [];
        const attributed = new Map<string, number>();
        for (const testCase of cases) {
            allCases.push(Object.freeze({ ...testCase, shard: shard.shard }));
            const matchedFile = matchTimingToFile(testCase.location, shard.testFiles);
            if (matchedFile !== null) {
                attributed.set(matchedFile, (attributed.get(matchedFile) ?? 0) + testCase.durationSeconds * 1000);
            }
        }
        const fallbackDuration = shard.testFiles.length > 0 ? shard.durationMs / shard.testFiles.length : 0;
        for (const testFile of shard.testFiles) {
            const measured = attributed.get(testFile);
            fileDurations.set(testFile, {
                durationMs: Math.max(1, Math.round(measured ?? fallbackDuration)),
                source: measured === undefined ? "shard-average" : "junit"
            });
        }
    }

    const sortedCases = [...allCases].sort((left, right) => right.durationSeconds - left.durationSeconds);
    const timingData = Object.freeze({
        schemaVersion: TIMING_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        targetSha: options.targetSha,
        manifestDigest: manifest.manifestDigest,
        planDigest: manifest.planDigest,
        shards: shardMetadata.map((shard) => ({
            name: shard.shard,
            durationMs: shard.durationMs,
            testFileCount: shard.testFiles.length,
            status: shard.status
        })),
        fileDurations: manifest.tests.map((testFile): FileDuration => {
            const timing = fileDurations.get(testFile) ?? { durationMs: 1000, source: "shard-average" as const };
            return Object.freeze({ file: testFile, durationMs: timing.durationMs, source: timing.source });
        }),
        slowestTests: sortedCases.slice(0, 50)
    });
    await writeJsonFile(path.join(options.reportDirectory, "test-durations.json"), timingData);

    const markdown = [
        "### CI timing profile",
        "",
        "The synthetic-merge test corpus is balanced from trusted historical per-file timings when available. Every test file is covered exactly once by the versioned manifest.",
        "",
        "#### Test shard wall time",
        "",
        "| Shard | Test files | Status | Wall time |",
        "| --- | ---: | ---: | ---: |",
        ...[...shardMetadata]
            .sort((left, right) => right.durationMs - left.durationMs)
            .map(
                (shard) =>
                    `| ${escapeMarkdown(shard.shard)} | ${shard.testFiles.length} | ${shard.status} | ${formatDuration(shard.durationMs / 1000)} |`
            ),
        "",
        "#### Slowest test cases",
        "",
        "| Test | File / suite | Shard | Duration |",
        "| --- | --- | --- | ---: |",
        ...sortedCases
            .slice(0, 20)
            .map(
                (testCase) =>
                    `| ${escapeMarkdown(testCase.name)} | ${escapeMarkdown(testCase.location)} | ${escapeMarkdown(testCase.shard)} | ${formatDuration(testCase.durationSeconds)} |`
            ),
        ""
    ];
    await writeFile(path.join(options.reportDirectory, "test-durations.md"), markdown.join("\n"), "utf8");

    if (!completed) {
        for (const error of coverageErrors) {
            console.error(`Incomplete auto-merge report: ${error}`);
        }
    }
    return completed;
}

function validateCheckstyle(xml: string, errors: Array<string>): void {
    if (!xml.includes("<checkstyle") || !xml.includes("</checkstyle>")) {
        errors.push("eslint-checkstyle.xml is incomplete");
    }
}

async function validateReport(
    options: Readonly<{
        reportDirectory: string;
        expectedSha?: string;
        expectedFingerprint?: string;
    }>
): Promise<Array<string>> {
    const errors: Array<string> = [];
    const metadataValue = await readOptionalJsonFile(path.join(options.reportDirectory, "auto-merge-report.json"));
    const manifestValue = await readOptionalJsonFile(path.join(options.reportDirectory, "test-manifest.json"));
    if (!isRecord(metadataValue) || metadataValue.schemaVersion !== REPORT_SCHEMA_VERSION) {
        errors.push("auto-merge-report.json has an unsupported schema");
        return errors;
    }
    let manifest: TestManifest | null = null;
    try {
        manifest = parseManifest(manifestValue);
    } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    }
    if (metadataValue.completed !== true) {
        errors.push("report did not complete");
    }
    if (options.expectedSha && metadataValue.targetSha !== options.expectedSha) {
        errors.push(`target SHA mismatch (${String(metadataValue.targetSha ?? "missing")} != ${options.expectedSha})`);
    }
    if (options.expectedFingerprint && metadataValue.toolingFingerprint !== options.expectedFingerprint) {
        errors.push("report tooling fingerprint does not match the trusted validation tooling");
    }
    if (metadataValue.buildStatus !== 0) {
        errors.push(`build did not complete successfully (status ${String(metadataValue.buildStatus)})`);
    }
    if (typeof metadataValue.lintStatus !== "number" || !isComparableStatus(metadataValue.lintStatus)) {
        errors.push(`lint execution did not produce a comparable result (status ${String(metadataValue.lintStatus)})`);
    }
    if (typeof metadataValue.testStatus !== "number" || !isComparableStatus(metadataValue.testStatus)) {
        errors.push(`test execution did not produce a comparable result (status ${String(metadataValue.testStatus)})`);
    }
    if (metadataValue.testReportSynthetic === true) {
        errors.push("test output was synthesized after an incomplete runner execution");
    }

    if (manifest !== null) {
        if (metadataValue.manifestDigest !== manifest.manifestDigest) {
            errors.push("report manifest digest does not match test-manifest.json");
        }
        if (metadataValue.planDigest !== manifest.planDigest) {
            errors.push("report plan digest does not match test-manifest.json");
        }
        if (metadataValue.shardCount !== manifest.shardCount) {
            errors.push("report shard count does not match test-manifest.json");
        }
        if (Array.isArray(metadataValue.testShards)) {
            const parsedShards: Array<ShardMetadata> = [];
            for (const rawShard of metadataValue.testShards) {
                if (!isRecord(rawShard) || typeof rawShard.name !== "string" || !Array.isArray(rawShard.testFiles)) {
                    errors.push("report contains an invalid test shard");
                    continue;
                }
                const reportFile = typeof rawShard.reportFile === "string" ? rawShard.reportFile : "";
                if (!reportFile || path.basename(reportFile) !== reportFile) {
                    errors.push(`shard ${rawShard.name} has an invalid report file path`);
                    continue;
                }
                const shard: ShardMetadata = Object.freeze({
                    schemaVersion: 1,
                    shard: rawShard.name,
                    completed: rawShard.completed === true,
                    status: typeof rawShard.status === "number" ? rawShard.status : 2,
                    signal: typeof rawShard.signal === "string" ? (rawShard.signal as NodeJS.Signals) : null,
                    durationMs: typeof rawShard.durationMs === "number" ? rawShard.durationMs : 0,
                    testFiles: Object.freeze(
                        rawShard.testFiles
                            .filter((entry): entry is string => typeof entry === "string")
                            .map(normalizePath)
                    ),
                    manifestDigest: typeof rawShard.manifestDigest === "string" ? rawShard.manifestDigest : "",
                    planDigest: typeof rawShard.planDigest === "string" ? rawShard.planDigest : "",
                    reportFile
                });
                parsedShards.push(shard);
                if (!shard.completed) {
                    errors.push(`test shard ${shard.shard} did not complete`);
                }
                if (!isComparableStatus(shard.status)) {
                    errors.push(
                        `test shard ${shard.shard} did not produce a comparable result (status ${shard.status})`
                    );
                }
                if (shard.manifestDigest !== manifest.manifestDigest || shard.planDigest !== manifest.planDigest) {
                    errors.push(`test shard ${shard.shard} provenance does not match the manifest`);
                }
                let junit = "";
                try {
                    junit = await readFile(path.join(options.reportDirectory, shard.reportFile), "utf8");
                } catch {
                    errors.push(`${shard.reportFile} is missing`);
                }
                if (junit && !isCompleteJunit(junit)) {
                    errors.push(`${shard.reportFile} is incomplete or synthetic`);
                }
            }
            errors.push(...findCoverageErrors(manifest, parsedShards));
        } else {
            errors.push("report does not declare test shards");
        }
    }

    try {
        validateCheckstyle(await readFile(path.join(options.reportDirectory, "eslint-checkstyle.xml"), "utf8"), errors);
    } catch {
        errors.push("eslint-checkstyle.xml is missing");
    }
    return errors;
}

async function stageCompiledRuntime(outputDirectory: string): Promise<void> {
    const candidates = [
        ...(await collectFiles(path.join(process.cwd(), "src"))),
        ...(await collectFiles(path.join(process.cwd(), "test", "dist")))
    ];
    const runtimeFiles = candidates.filter((relativePath) => {
        const normalized = normalizePath(relativePath);
        const isDistFile =
            normalized.startsWith("test/dist/") || (normalized.startsWith("src/") && normalized.includes("/dist/"));
        if (!isDistFile) {
            return false;
        }
        return (
            !normalized.endsWith(".map") &&
            !normalized.endsWith(".d.ts") &&
            !normalized.endsWith(".d.ts.map") &&
            !normalized.endsWith(".tsbuildinfo")
        );
    });
    if (runtimeFiles.length === 0) {
        throw new Error("No compiled runtime files were found to stage.");
    }
    for (const relativePath of runtimeFiles) {
        const destination = path.join(outputDirectory, relativePath);
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(relativePath, destination);
    }
    console.log(`Staged ${runtimeFiles.length} compiled runtime files in ${outputDirectory}.`);
}

async function runLocalReport(reportDirectory: string, shardCount: number): Promise<number> {
    const buildResult = await runProcess("pnpm", ["exec", "tsc", "-b"]);
    if (buildResult.status !== 0) {
        return buildResult.status;
    }
    const lintPromise = runLintReport(reportDirectory);
    const manifestPath = path.join(reportDirectory, "test-manifest.json");
    const manifest = await createManifest({ output: manifestPath, shardCount });
    const shardStatusesPromise = Promise.all(
        manifest.shards.map((shard) => runShard({ manifestPath, shardName: shard.name, reportDirectory }))
    );
    const [lintStatus, shardStatuses] = await Promise.all([lintPromise, shardStatusesPromise]);
    const targetSha = process.env.GMLOOP_REPORT_TARGET_SHA?.trim() || "local";
    const toolingFingerprint = process.env.GMLOOP_REPORT_TOOL_FINGERPRINT?.trim() || "local";
    const completed = await assembleReport({
        manifestPath,
        reportDirectory,
        targetSha,
        toolingFingerprint,
        buildStatus: buildResult.status
    });
    if (!completed) {
        return 2;
    }
    return Math.max(lintStatus, ...shardStatuses);
}

function createPositiveIntegerParser(label: string): (value: string) => number {
    return (value: string) => {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
            throw new Error(`${label} must be a positive integer.`);
        }
        return parsed;
    };
}

/**
 * Create the internal CI-report command surface used by local reporting and GitHub Actions.
 */
export function createCiReportCommand(): Command {
    const command = new Command()
        .name("ci-report")
        .description("Internal CI report orchestration and validation utilities.");

    command
        .command("list-tests")
        .description("Print the canonical compiled non-performance test corpus.")
        .action(async () => {
            for (const testFile of await discoverCanonicalTests()) {
                console.log(testFile);
            }
        });

    command
        .command("manifest")
        .description("Create a deterministic balanced test manifest.")
        .requiredOption("--output <path>")
        .option("--history <path>")
        .option("--shards <count>", "Number of test shards", createPositiveIntegerParser("shards"), DEFAULT_SHARD_COUNT)
        .option("--github-output <path>")
        .action(async (options: { output: string; history?: string; shards: number; githubOutput?: string }) => {
            const manifest = await createManifest({
                output: options.output,
                history: options.history,
                shardCount: options.shards
            });
            await appendGithubOutputs(options.githubOutput, manifest);
            console.log(`Created ${manifest.shards.length} balanced shards for ${manifest.tests.length} test files.`);
        });

    command
        .command("run-shard")
        .requiredOption("--manifest <path>")
        .requiredOption("--shard <name>")
        .option("--report-dir <path>", "Report directory", "reports")
        .action(async (options: { manifest: string; shard: string; reportDir: string }) => {
            process.exitCode = await runShard({
                manifestPath: options.manifest,
                shardName: options.shard,
                reportDirectory: options.reportDir
            });
        });

    command
        .command("lint")
        .option("--report-dir <path>", "Report directory", "reports")
        .action(async (options: { reportDir: string }) => {
            process.exitCode = await runLintReport(options.reportDir);
        });

    command
        .command("assemble")
        .requiredOption("--manifest <path>")
        .requiredOption("--target-sha <sha>")
        .requiredOption("--fingerprint <value>")
        .requiredOption("--build-status <status>", "Build status", (value: string) => parseInteger(value, 2))
        .option("--report-dir <path>", "Report directory", "reports")
        .action(
            async (options: {
                manifest: string;
                targetSha: string;
                fingerprint: string;
                buildStatus: number;
                reportDir: string;
            }) => {
                const completed = await assembleReport({
                    manifestPath: options.manifest,
                    reportDirectory: options.reportDir,
                    targetSha: options.targetSha,
                    toolingFingerprint: options.fingerprint,
                    buildStatus: options.buildStatus
                });
                process.exitCode = completed ? 0 : 1;
            }
        );

    command
        .command("validate")
        .option("--report-dir <path>", "Report directory", "reports")
        .option("--expected-sha <sha>")
        .option("--expected-fingerprint <value>")
        .action(async (options: { reportDir: string; expectedSha?: string; expectedFingerprint?: string }) => {
            const errors = await validateReport({
                reportDirectory: options.reportDir,
                expectedSha: options.expectedSha,
                expectedFingerprint: options.expectedFingerprint
            });
            for (const error of errors) {
                console.error(`Invalid auto-merge report: ${error}`);
            }
            process.exitCode = errors.length === 0 ? 0 : 1;
        });

    command
        .command("stage-compiled")
        .requiredOption("--output <path>")
        .action(async (options: { output: string }) => {
            await stageCompiledRuntime(options.output);
        });

    command
        .command("local")
        .option("--report-dir <path>", "Report directory", "reports")
        .option("--shards <count>", "Number of test shards", createPositiveIntegerParser("shards"), DEFAULT_SHARD_COUNT)
        .action(async (options: { reportDir: string; shards: number }) => {
            process.exitCode = await runLocalReport(options.reportDir, options.shards);
        });

    return command;
}

/** Test-only access to deterministic CI-report primitives. */
export const __ciReportTest__ = Object.freeze({
    calculateManifestDigest,
    calculatePlanDigest,
    createBalancedShardPlan,
    findCoverageErrors,
    isCanonicalTestPath
});

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(path.resolve(invokedPath)).href === import.meta.url) {
    try {
        await createCiReportCommand().parseAsync(process.argv);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 2;
    }
}
