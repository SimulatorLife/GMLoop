import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const BUILD_EVIDENCE_SCHEMA_VERSION = 1;
const BUILD_EVIDENCE_FILE = "build-evidence.json";

type BuildEvidence = Readonly<{
    schemaVersion: number;
    targetSha: string;
    completed: boolean;
    succeeded: boolean;
    status: number | null;
    signal: NodeJS.Signals | null;
    testsSkippedReason: "build-failed" | null;
}>;

type ProcessResult = Readonly<{
    status: number | null;
    signal: NodeJS.Signals | null;
}>;

function readOption(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
    return process.argv.includes(name);
}

async function runBuild(): Promise<ProcessResult> {
    return await new Promise((resolve, reject) => {
        const child = spawn("pnpm", ["exec", "tsc", "-b"], { stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", (code, signal) => {
            resolve(Object.freeze({ status: code, signal }));
        });
    });
}

async function writeEvidence(reportDirectory: string, evidence: BuildEvidence): Promise<void> {
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(path.join(reportDirectory, BUILD_EVIDENCE_FILE), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

async function appendOutputs(outputPath: string | undefined, evidence: BuildEvidence): Promise<void> {
    if (!outputPath) {
        return;
    }
    const status = evidence.status === null ? "" : String(evidence.status);
    await appendFile(
        outputPath,
        `completed=${String(evidence.completed)}\nsucceeded=${String(evidence.succeeded)}\nstatus=${status}\n`,
        "utf8"
    );
}

function parseEvidence(value: unknown): BuildEvidence {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error("Build evidence must be an object.");
    }
    const record = value as Record<string, unknown>;
    if (record.schemaVersion !== BUILD_EVIDENCE_SCHEMA_VERSION || typeof record.targetSha !== "string") {
        throw new Error("Build evidence has an unsupported schema or missing target SHA.");
    }
    const status = typeof record.status === "number" && Number.isInteger(record.status) ? record.status : null;
    const signal = typeof record.signal === "string" ? (record.signal as NodeJS.Signals) : null;
    return Object.freeze({
        schemaVersion: BUILD_EVIDENCE_SCHEMA_VERSION,
        targetSha: record.targetSha,
        completed: record.completed === true,
        succeeded: record.succeeded === true,
        status,
        signal,
        testsSkippedReason: record.testsSkippedReason === "build-failed" ? "build-failed" : null
    });
}

function validateEvidence(evidence: BuildEvidence, expectedSha: string | undefined, requireFailure: boolean): Array<string> {
    const errors: Array<string> = [];
    if (!evidence.completed || evidence.signal !== null || evidence.status === null) {
        errors.push("build process did not complete normally");
    }
    if (expectedSha && evidence.targetSha !== expectedSha) {
        errors.push(`target SHA mismatch (${evidence.targetSha} != ${expectedSha})`);
    }
    if (evidence.succeeded !== (evidence.status === 0)) {
        errors.push("build success flag does not match the process status");
    }
    if (evidence.succeeded && evidence.testsSkippedReason !== null) {
        errors.push("successful build incorrectly declares skipped tests");
    }
    if (!evidence.succeeded && evidence.testsSkippedReason !== "build-failed") {
        errors.push("failed build does not explicitly declare tests skipped because the build failed");
    }
    if (requireFailure && evidence.succeeded) {
        errors.push("expected a deterministic build failure but the build succeeded");
    }
    return errors;
}

async function runCommand(): Promise<number> {
    const targetSha = readOption("--target-sha")?.trim();
    const reportDirectory = readOption("--report-dir")?.trim() || "reports";
    if (!targetSha) {
        throw new Error("--target-sha is required.");
    }

    const result = await runBuild();
    const completed = result.signal === null && result.status !== null;
    const succeeded = completed && result.status === 0;
    const evidence: BuildEvidence = Object.freeze({
        schemaVersion: BUILD_EVIDENCE_SCHEMA_VERSION,
        targetSha,
        completed,
        succeeded,
        status: result.status,
        signal: result.signal,
        testsSkippedReason: completed && !succeeded ? "build-failed" : null
    });
    await writeEvidence(reportDirectory, evidence);
    await appendOutputs(readOption("--github-output"), evidence);

    if (!completed) {
        console.error(`Build execution did not complete normally${result.signal ? ` (${result.signal})` : ""}.`);
        return 2;
    }
    if (!succeeded) {
        console.log(`Build completed with status ${String(result.status)}; recording comparable build-failure evidence.`);
    }
    return 0;
}

async function validateCommand(): Promise<number> {
    const reportDirectory = readOption("--report-dir")?.trim() || "reports";
    const raw = JSON.parse(await readFile(path.join(reportDirectory, BUILD_EVIDENCE_FILE), "utf8")) as unknown;
    const evidence = parseEvidence(raw);
    const errors = validateEvidence(evidence, readOption("--expected-sha")?.trim(), hasFlag("--require-failure"));
    for (const error of errors) {
        console.error(`Invalid build evidence: ${error}`);
    }
    return errors.length === 0 ? 0 : 1;
}

export const __ciBuildEvidenceTest__ = Object.freeze({ parseEvidence, validateEvidence });

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(path.resolve(invokedPath)).href === import.meta.url) {
    const subcommand = process.argv[2];
    try {
        if (subcommand === "run") {
            process.exitCode = await runCommand();
        } else if (subcommand === "validate") {
            process.exitCode = await validateCommand();
        } else {
            throw new Error("Expected subcommand 'run' or 'validate'.");
        }
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 2;
    }
}
