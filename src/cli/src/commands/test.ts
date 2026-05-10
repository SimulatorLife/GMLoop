import { spawnSync } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createPathOption } from "../cli-core/shared-command-options.js";
import { readArtifactJson, resolveArtifactDirectory, writeArtifactJson } from "../modules/runtime/index.js";
import { discoverProjectRoot } from "../workflow/project-root.js";

type TestOptions = Readonly<{
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

function printTestPayload(payload: unknown, asJson: boolean): void {
    if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }
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

async function collectTestFilePaths(directory: string): Promise<Array<string>> {
    const entries = await Core.safeReaddirDirent({ readDir: readdir }, directory);
    const nestedPaths = await Promise.all(
        entries.map(async (entry) => {
            if (
                entry.name === "node_modules" ||
                entry.name === ".git" ||
                entry.name === "dist" ||
                entry.name === ".gmloop"
            ) {
                return [] as Array<string>;
            }

            const resolved = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                return await collectTestFilePaths(resolved);
            }

            if (!entry.isFile()) {
                return [] as Array<string>;
            }

            const lowered = entry.name.toLowerCase();
            const isTestFile = lowered.endsWith(".test.ts") || lowered.endsWith(".test.js");
            return isTestFile ? [resolved] : [];
        })
    );
    return nestedPaths.flat();
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

async function runTestListAction(options: TestOptions): Promise<void> {
    const projectRoot = await resolveTestProjectRoot(options);
    const files = await findTestFiles(projectRoot, options.pattern);
    printTestPayload(
        { command: "test list", payload: { count: files.length, files, ok: true, projectRoot } },
        options.json === true
    );
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
        printTestPayload(
            { command: "test run", payload: { ok: true, outputPath, projectRoot, run: emptyPayload } },
            options.json === true
        );
        return;
    }

    const subprocessArguments = ["--test", ...files];
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

    printTestPayload(
        {
            command: "test run",
            payload: {
                ok: runPayload.exitCode === 0,
                outputPath,
                projectRoot,
                run: runPayload
            }
        },
        options.json === true
    );
}

async function runTestResultsAction(options: TestOptions): Promise<void> {
    const projectRoot = await resolveTestProjectRoot(options);
    const outputPath = path.join(resolveArtifactDirectory(projectRoot, "test"), "latest.json");
    const payload = await readArtifactJson<PersistedTestRun>(outputPath);
    if (!payload) {
        printTestPayload(
            { command: "test results", payload: { ok: false, reason: "results_not_found" } },
            options.json === true
        );
        return;
    }
    printTestPayload(
        { command: "test results", payload: { ok: true, outputPath, projectRoot, run: payload } },
        options.json === true
    );
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
    const testCaseCreate = addTestSharedOptions(
        applyStandardCommandOptions(new Command("create")).description("Create a test case.")
    );
    testCaseCreate.action(function testCaseCreateAction() {
        printTestPayload(
            {
                command: "test case create",
                payload: {
                    ok: false,
                    reason: "not_implemented"
                }
            },
            this.opts<TestOptions>().json === true
        );
    });
    const testCaseUpdate = addTestSharedOptions(
        applyStandardCommandOptions(new Command("update")).description("Update a test case.")
    );
    testCaseUpdate.action(function testCaseUpdateAction() {
        printTestPayload(
            {
                command: "test case update",
                payload: {
                    ok: false,
                    reason: "not_implemented"
                }
            },
            this.opts<TestOptions>().json === true
        );
    });
    testCase.addCommand(testCaseCreate);
    testCase.addCommand(testCaseUpdate);

    command.addCommand(run);
    command.addCommand(list);
    command.addCommand(results);
    command.addCommand(testCase);
    return command;
}
