import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createPathOption, createWriteOption } from "../cli-core/shared-command-options.js";
import {
    readArtifactJson,
    readValidatedArtifactJson,
    resolveArtifactDirectory,
    writeArtifactJson
} from "../modules/runtime/index.js";
import { isRecord } from "../shared/error-guards.js";
import { discoverProjectRoot } from "../workflow/project-root.js";

type TestOptions = Readonly<{
    expected?: string;
    json?: boolean;
    path?: string;
    pattern?: string;
}>;

type PersistedTestRun = Readonly<{
    command: string;
    exitCode: number;
    failed: number;
    files: ReadonlyArray<string>;
    passed: number;
    skipped: number;
    startedAt: string;
    stderr: string;
    stdout: string;
}>;

type TestCaseMutationOptions = TestOptions &
    Readonly<{
        write?: boolean;
    }>;

type TestCaseManifest = Readonly<{
    cases: ReadonlyArray<TestCaseManifestEntry>;
    version: "1";
}>;

type TestCaseManifestEntry = Readonly<{
    expected?: string;
    name: string;
    target: string;
}>;

const TEST_CASE_MANIFEST_VERSION = "1" as const;
const EMPTY_TEST_CASE_MANIFEST: TestCaseManifest = Object.freeze({
    cases: Object.freeze([]) as ReadonlyArray<TestCaseManifestEntry>,
    version: TEST_CASE_MANIFEST_VERSION
});

/**
 * Type guard that confirms a parsed JSON value matches the
 * {@link TestCaseManifestEntry} contract.
 *
 * The guard rejects every shape that {@link sortTestCaseEntries} cannot
 * safely consume (non-string `target`/`name`, missing keys, `null` or array
 * entries) so the downstream sorter never observes a value that would throw
 * on `String.prototype.localeCompare`. The `expected` field is validated
 * loosely: it is allowed to be absent and, when present, must be a
 * non-blank string.
 */
function isValidTestCaseManifestEntry(value: unknown): value is TestCaseManifestEntry {
    if (!isRecord(value)) {
        return false;
    }

    if (!Core.isNonEmptyString(value.target)) {
        return false;
    }

    if (!Core.isNonEmptyString(value.name)) {
        return false;
    }

    if (value.expected !== undefined && typeof value.expected !== "string") {
        return false;
    }

    return true;
}

/**
 * Type guard for the full {@link TestCaseManifest} shape.
 *
 * The guard is intentionally stricter than the legacy `Array.isArray` check:
 * it requires the top-level value to be a plain object, the schema version
 * to equal `"1"` (so a future, incompatible manifest is not silently accepted
 * under the current contract), and every entry to satisfy
 * {@link isValidTestCaseManifestEntry}. Failures bubble up to
 * {@link readTestCaseManifest} as `null` and the call site falls back to an
 * empty manifest, preventing tampered or truncated files from crashing the
 * CLI when a user later runs `test case create` or `test case update`.
 */
function isValidTestCaseManifest(value: unknown): value is TestCaseManifest {
    if (!isRecord(value)) {
        return false;
    }

    if (value.version !== TEST_CASE_MANIFEST_VERSION) {
        return false;
    }

    if (!Array.isArray(value.cases)) {
        return false;
    }

    return value.cases.every(isValidTestCaseManifestEntry);
}

function printTestPayload(payload: unknown): void {
    console.log(JSON.stringify(payload, null, 2));
}

function addTestSharedOptions(command: Command): Command {
    return command.addOption(createPathOption()).option("--json", "Emit JSON output.");
}

async function resolveTestProjectRoot(options: TestOptions): Promise<string> {
    return await discoverProjectRoot({ explicitProjectPath: options.path });
}

async function findTestFiles(projectRoot: string, pattern: string | undefined): Promise<Array<string>> {
    const candidateFiles = await collectTestFilePaths(projectRoot);
    const normalizedPattern = pattern?.trim().toLowerCase() ?? "";

    const results = candidateFiles.map((candidateFilePath) => {
        const relative = path.relative(projectRoot, candidateFilePath);
        if (normalizedPattern.length > 0 && !relative.toLowerCase().includes(normalizedPattern)) {
            return null;
        }
        return relative;
    });

    const filteredResults = results.filter((result): result is string => result !== null);
    return filteredResults.sort((left, right) => left.localeCompare(right));
}

const TEST_FILE_EXCLUDED_DIRECTORY_NAMES = new Set(Core.DEFAULT_PROJECT_EXCLUDES.directoryNames);

async function collectTestFilePaths(directory: string): Promise<Array<string>> {
    const relativeFilePaths = await Core.listRelativeFilePathsRecursively(directory, {
        shouldEnterDirectory: ({ entryName }) => !TEST_FILE_EXCLUDED_DIRECTORY_NAMES.has(entryName),
        includeFile: ({ entryName }) => {
            const lowered = entryName.toLowerCase();
            return lowered.endsWith(".test.ts") || lowered.endsWith(".test.js");
        }
    });
    return relativeFilePaths.map((relativeFilePath) => path.join(directory, relativeFilePath));
}

function parseNodeTestSummary(output: string): { failed: number; passed: number; skipped: number } {
    const passed = Number(/# pass\s+(\d+)/u.exec(output)?.[1] ?? "0");
    const failed = Number(/# fail\s+(\d+)/u.exec(output)?.[1] ?? "0");
    const skipped = Number(/# skipped\s+(\d+)/u.exec(output)?.[1] ?? "0");
    return {
        failed: Number.isFinite(failed) ? failed : 0,
        passed: Number.isFinite(passed) ? passed : 0,
        skipped: Number.isFinite(skipped) ? skipped : 0
    };
}

async function persistTestResults(projectRoot: string, payload: PersistedTestRun): Promise<string> {
    const directory = resolveArtifactDirectory(projectRoot, "test");
    await mkdir(directory, { recursive: true });
    const outputPath = path.join(directory, "latest.json");
    await writeArtifactJson(outputPath, payload);
    return outputPath;
}

function getTestCaseManifestPath(projectRoot: string): string {
    return path.join(resolveArtifactDirectory(projectRoot, "test"), "cases.json");
}

function sortTestCaseEntries(entries: ReadonlyArray<TestCaseManifestEntry>): Array<TestCaseManifestEntry> {
    return [...entries].sort((left, right) => {
        const byTarget = left.target.localeCompare(right.target);
        if (byTarget !== 0) {
            return byTarget;
        }
        return left.name.localeCompare(right.name);
    });
}

function createTestCaseManifest(entries: ReadonlyArray<TestCaseManifestEntry>): TestCaseManifest {
    return Object.freeze({
        cases: Object.freeze(sortTestCaseEntries(entries)),
        version: "1"
    });
}

async function readTestCaseManifest(projectRoot: string): Promise<TestCaseManifest> {
    const manifestPath = getTestCaseManifestPath(projectRoot);
    const manifest = await readValidatedArtifactJson<TestCaseManifest>(manifestPath, {
        validate: isValidTestCaseManifest
    });
    if (manifest === null) {
        return EMPTY_TEST_CASE_MANIFEST;
    }
    return createTestCaseManifest(manifest.cases);
}

async function writeTestCaseManifest(projectRoot: string, manifest: TestCaseManifest): Promise<string> {
    const testArtifactsDirectory = resolveArtifactDirectory(projectRoot, "test");
    await mkdir(testArtifactsDirectory, { recursive: true });
    const manifestPath = getTestCaseManifestPath(projectRoot);
    await writeArtifactJson(manifestPath, manifest);
    return manifestPath;
}

/**
 * Canonicalize a test case entry from raw CLI arguments.
 *
 * The manifest contract allows the `expected` field to be absent when the
 * caller has no expectation to record, but the CLI surfaces the flag as
 * `string | undefined`. This helper collapses both shapes (and trims a
 * non-empty value) into the single immutable entry shape consumed by
 * {@link upsertTestCaseEntry} and the persisted manifest.
 *
 * @param parameters - The raw CLI arguments for the entry.
 * @param parameters.target - Stable target function/script identifier.
 * @param parameters.name - Stable test case name within the target.
 * @param parameters.expected - Optional, free-form expected behaviour summary.
 * @returns A frozen {@link TestCaseManifestEntry} that omits `expected` when
 *   the supplied value is absent or whitespace-only.
 */
function normalizeTestCaseEntry(parameters: {
    target: string;
    name: string;
    expected: string | undefined;
}): TestCaseManifestEntry {
    const { target, name, expected } = parameters;
    if (typeof expected === "string" && expected.trim().length > 0) {
        return Object.freeze({ expected: expected.trim(), name, target });
    }
    return Object.freeze({ name, target });
}

/**
 * Locate the index of a manifest entry by its `(target, name)` pair.
 *
 * Centralizing the composite-key lookup keeps the orchestrating command
 * handlers free of inline `Array.prototype.findIndex` calls and prevents the
 * two callers from drifting on the equality semantics.
 *
 * @param manifest - The manifest to search.
 * @param target - Target identifier to match.
 * @param name - Case name to match.
 * @returns The zero-based index of the matching entry, or `-1` when no entry
 *   matches.
 */
function findTestCaseEntryIndex(manifest: TestCaseManifest, target: string, name: string): number {
    return manifest.cases.findIndex((entry) => entry.target === target && entry.name === name);
}

/**
 * Structural equality check for {@link TestCaseManifestEntry} values.
 *
 * Entries are flat objects of primitive values, so a JSON round-trip
 * comparison provides a deterministic, allocation-light equality check. The
 * comparison is sensitive to property insertion order, which is acceptable
 * because {@link normalizeTestCaseEntry} emits fields in a single canonical
 * order (`{ expected, name, target }` or `{ name, target }`). Exposing this
 * helper lets the command handlers treat the change-detection step as a
 * single delegation rather than re-encoding the serialization logic inline.
 *
 * @param left - First entry to compare.
 * @param right - Second entry to compare.
 * @returns `true` when both entries serialize to identical JSON; otherwise
 *   `false`.
 */
function areTestCaseEntriesStructurallyEqual(left: TestCaseManifestEntry, right: TestCaseManifestEntry): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Result of upserting an entry into a {@link TestCaseManifest}.
 */
type TestCaseUpsertResult = Readonly<{
    manifest: TestCaseManifest;
    entry: TestCaseManifestEntry;
    changed: boolean;
}>;

/**
 * Insert or replace an entry in a manifest, preserving sort order.
 *
 * The helper performs the array bookkeeping the command handlers used to do
 * inline (`findIndex` to detect existence, a `splice`-style spread to mutate
 * the entries array, and a structural equality check for change detection).
 * Callers receive an immutable {@link TestCaseManifest} plus the entry that
 * was ultimately stored, so the orchestrators can focus on payload assembly
 * and write semantics rather than on primitive array manipulation.
 *
 * @param parameters - The manifest to update and the entry to upsert.
 * @param parameters.manifest - The current manifest, treated as immutable.
 * @param parameters.entry - The entry to insert or replace.
 * @returns The resulting manifest, the stored entry, and whether the entry
 *   was newly added (`true`) or replaced an existing entry whose shape
 *   changed (`true`) versus left an existing identical entry untouched
 *   (`false`).
 */
function upsertTestCaseEntry(parameters: {
    manifest: TestCaseManifest;
    entry: TestCaseManifestEntry;
}): TestCaseUpsertResult {
    const { manifest, entry } = parameters;
    const existingIndex = findTestCaseEntryIndex(manifest, entry.target, entry.name);

    if (existingIndex === -1) {
        return {
            changed: true,
            entry,
            manifest: createTestCaseManifest([...manifest.cases, entry])
        };
    }

    const existing = manifest.cases[existingIndex];
    if (existing !== undefined && areTestCaseEntriesStructurallyEqual(existing, entry)) {
        return { changed: false, entry: existing, manifest };
    }

    const nextCases = [...manifest.cases];
    nextCases[existingIndex] = entry;
    return {
        changed: true,
        entry,
        manifest: createTestCaseManifest(nextCases)
    };
}

async function runTestListAction(options: TestOptions): Promise<void> {
    const projectRoot = await resolveTestProjectRoot(options);
    const files = await findTestFiles(projectRoot, options.pattern);
    printTestPayload({ command: "test list", payload: { count: files.length, files, ok: true, projectRoot } });
}

async function runTestRunAction(options: TestOptions): Promise<void> {
    const projectRoot = await resolveTestProjectRoot(options);
    const files = await findTestFiles(projectRoot, options.pattern);

    if (files.length === 0) {
        const emptyPayload: PersistedTestRun = {
            command: `${process.execPath} --test`,
            exitCode: 0,
            failed: 0,
            files,
            passed: 0,
            skipped: 0,
            startedAt: new Date().toISOString(),
            stderr: "",
            stdout: ""
        };
        const outputPath = await persistTestResults(projectRoot, emptyPayload);
        printTestPayload({ command: "test run", payload: { ok: true, outputPath, projectRoot, run: emptyPayload } });
        return;
    }

    const subprocessArguments = ["--disable-warning=ExperimentalWarning", "--test", ...files];
    const startedAt = new Date().toISOString();
    const result = spawnSync(process.execPath, subprocessArguments, {
        cwd: projectRoot,
        encoding: "utf8"
    });

    const stdout = typeof result.stdout === "string" ? result.stdout : "";
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    const summary = parseNodeTestSummary(`${stdout}\n${stderr}`);
    const passed =
        summary.passed === 0 && summary.failed === 0 && (result.status ?? 1) === 0 ? files.length : summary.passed;

    const runPayload: PersistedTestRun = {
        command: `${process.execPath} ${subprocessArguments.join(" ")}`,
        exitCode: result.status ?? 1,
        failed: summary.failed,
        files,
        passed,
        skipped: summary.skipped,
        startedAt,
        stderr,
        stdout
    };

    const outputPath = await persistTestResults(projectRoot, runPayload);

    printTestPayload({
        command: "test run",
        payload: {
            ok: runPayload.exitCode === 0,
            outputPath,
            projectRoot,
            run: runPayload
        }
    });
}

async function runTestResultsAction(options: TestOptions): Promise<void> {
    const projectRoot = await resolveTestProjectRoot(options);
    const outputPath = path.join(resolveArtifactDirectory(projectRoot, "test"), "latest.json");
    const payload = await readArtifactJson<PersistedTestRun>(outputPath);
    if (!payload) {
        printTestPayload({ command: "test results", payload: { ok: false, reason: "results_not_found" } });
        return;
    }
    printTestPayload({ command: "test results", payload: { ok: true, outputPath, projectRoot, run: payload } });
}

async function runTestCaseCreateAction(
    options: TestCaseMutationOptions,
    target: string,
    name: string,
    expected: string | undefined
): Promise<void> {
    const projectRoot = await resolveTestProjectRoot(options);
    const manifest = await readTestCaseManifest(projectRoot);
    const entry = normalizeTestCaseEntry({ expected, name, target });
    const { changed, manifest: nextManifest } = upsertTestCaseEntry({ entry, manifest });
    const writeMode = options.write === true;
    const manifestPath = writeMode ? await writeTestCaseManifest(projectRoot, nextManifest) : null;

    printTestPayload({
        command: "test case create",
        payload: {
            case: entry,
            changed,
            manifestPath,
            mode: writeMode ? "apply" : "dry-run",
            ok: true,
            projectRoot
        }
    });
}

async function runTestCaseListAction(options: TestOptions, target: string | undefined): Promise<void> {
    const projectRoot = await resolveTestProjectRoot(options);
    const manifest = await readTestCaseManifest(projectRoot);
    const cases = target === undefined ? manifest.cases : manifest.cases.filter((entry) => entry.target === target);

    printTestPayload({
        command: "test case list",
        payload: {
            cases,
            count: cases.length,
            ok: true,
            projectRoot
        }
    });
}

async function runTestCaseDeleteAction(options: TestCaseMutationOptions, target: string, name: string): Promise<void> {
    const projectRoot = await resolveTestProjectRoot(options);
    const manifest = await readTestCaseManifest(projectRoot);
    const writeMode = options.write === true;
    const existingIndex = findTestCaseEntryIndex(manifest, target, name);

    if (existingIndex === -1) {
        printTestPayload({
            command: "test case delete",
            payload: {
                case: { name, target },
                mode: writeMode ? "apply" : "dry-run",
                ok: false,
                reason: "test_case_not_found"
            }
        });
        return;
    }

    const remainingCases = manifest.cases.filter((_entry, index) => index !== existingIndex);
    const nextManifest = createTestCaseManifest(remainingCases);
    const manifestPath = writeMode ? await writeTestCaseManifest(projectRoot, nextManifest) : null;

    printTestPayload({
        command: "test case delete",
        payload: {
            case: { name, target },
            manifestPath,
            mode: writeMode ? "apply" : "dry-run",
            ok: true,
            projectRoot
        }
    });
}

async function runTestCaseUpdateAction(
    options: TestCaseMutationOptions,
    target: string,
    name: string,
    expected: string | undefined
): Promise<void> {
    const projectRoot = await resolveTestProjectRoot(options);
    const manifest = await readTestCaseManifest(projectRoot);
    const writeMode = options.write === true;

    if (findTestCaseEntryIndex(manifest, target, name) === -1) {
        printTestPayload({
            command: "test case update",
            payload: {
                case: { name, target },
                mode: writeMode ? "apply" : "dry-run",
                ok: false,
                reason: "test_case_not_found"
            }
        });
        return;
    }

    const entry = normalizeTestCaseEntry({ expected, name, target });
    const { changed, manifest: nextManifest } = upsertTestCaseEntry({ entry, manifest });
    const manifestPath = writeMode && changed ? await writeTestCaseManifest(projectRoot, nextManifest) : null;

    printTestPayload({
        command: "test case update",
        payload: {
            case: entry,
            changed,
            manifestPath,
            mode: writeMode ? "apply" : "dry-run",
            ok: true,
            projectRoot
        }
    });
}

export function createTestCommand(): Command {
    const command = applyStandardCommandOptions(new Command("test")).description("Discover and execute test suites.");

    const run = addTestSharedOptions(
        applyStandardCommandOptions(new Command("run"))
            .description("Run Node test suites.")
            .option("--pattern <value>", "Only include test files whose relative path contains this substring.")
    );
    run.action(async function testRunAction() {
        await runTestRunAction(this.opts<TestOptions>());
    });

    const list = addTestSharedOptions(
        applyStandardCommandOptions(new Command("list"))
            .description("List test suites.")
            .option("--pattern <value>", "Only include test files whose relative path contains this substring.")
    );
    list.action(async function testListAction() {
        await runTestListAction(this.opts<TestOptions>());
    });

    const results = addTestSharedOptions(
        applyStandardCommandOptions(new Command("results")).description("Read latest test run results.")
    );
    results.action(async function testResultsAction() {
        await runTestResultsAction(this.opts<TestOptions>());
    });

    const testCase = applyStandardCommandOptions(new Command("case")).description("Manage test cases.");
    const testCaseList = addTestSharedOptions(
        applyStandardCommandOptions(new Command("list"))
            .description("List test cases.")
            .option("--target <value>", "Only include cases for this target function/script identifier.")
    );
    testCaseList.action(async function testCaseListAction() {
        const options = this.opts<TestOptions & Readonly<{ target?: string }>>();
        await runTestCaseListAction(options, options.target);
    });
    const testCaseCreate = addTestSharedOptions(
        applyStandardCommandOptions(new Command("create"))
            .description("Create a test case.")
            .argument("<target>", "Target function/script identifier under test.")
            .argument("<name>", "Stable test case name.")
            .option("--expected <value>", "Expected behavior summary for this test case.")
            .addOption(createWriteOption())
    );
    testCaseCreate.action(async function testCaseCreateAction(target: string, name: string) {
        const options = this.opts<TestCaseMutationOptions>();
        await runTestCaseCreateAction(options, target, name, options.expected);
    });
    const testCaseUpdate = addTestSharedOptions(
        applyStandardCommandOptions(new Command("update"))
            .description("Update a test case.")
            .argument("<target>", "Target function/script identifier under test.")
            .argument("<name>", "Stable test case name.")
            .option("--expected <value>", "Updated expected behavior summary.")
            .addOption(createWriteOption())
    );
    testCaseUpdate.action(async function testCaseUpdateAction(target: string, name: string) {
        const options = this.opts<TestCaseMutationOptions>();
        await runTestCaseUpdateAction(options, target, name, options.expected);
    });
    const testCaseDelete = addTestSharedOptions(
        applyStandardCommandOptions(new Command("delete"))
            .description("Delete a test case.")
            .argument("<target>", "Target function/script identifier under test.")
            .argument("<name>", "Stable test case name.")
            .addOption(createWriteOption())
    );
    testCaseDelete.action(async function testCaseDeleteAction(target: string, name: string) {
        const options = this.opts<TestCaseMutationOptions>();
        await runTestCaseDeleteAction(options, target, name);
    });
    testCase.addCommand(testCaseList);
    testCase.addCommand(testCaseCreate);
    testCase.addCommand(testCaseUpdate);
    testCase.addCommand(testCaseDelete);

    command.addCommand(run);
    command.addCommand(list);
    command.addCommand(results);
    command.addCommand(testCase);
    return command;
}

/**
 * Test-only entry point exposing the manifest validators so unit tests can
 * exercise the schema guard directly. Kept under a frozen `__private__` bag
 * to mirror the convention used elsewhere in the CLI (e.g. `runtime.ts`) and
 * discourage accidental consumption by runtime callers.
 */
export const __testCommandTestHelpers__ = Object.freeze({
    areTestCaseEntriesStructurallyEqual,
    findTestCaseEntryIndex,
    isValidTestCaseManifest,
    isValidTestCaseManifestEntry,
    normalizeTestCaseEntry,
    upsertTestCaseEntry
});
