import assert from "node:assert/strict";
import { execFile, type ExecFileOptions } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { CLI } from "@gmloop/cli";
import { Core } from "@gmloop/core";

const { runCliTestCommand } = CLI;
const { isNonEmptyArray } = Core;

const execFileBase = promisify(execFile);

const normalizeExecOutput = (value: string | Buffer) => (typeof value === "string" ? value : value.toString());

async function createDummyRefactorProject(tempDirectory: string): Promise<void> {
    const projectFile = path.join(tempDirectory, "project.yyp");
    await fs.writeFile(
        projectFile,
        JSON.stringify({
            resources: [{ id: { name: "script1", path: "scripts/script1/script1.yy" } }]
        }),
        "utf8"
    );

    const scriptDir = path.join(tempDirectory, "scripts/script1");
    await fs.mkdir(scriptDir, { recursive: true });
    await fs.writeFile(
        path.join(scriptDir, "script1.yy"),
        JSON.stringify({ resourceType: "GMScript", name: "script1" }),
        "utf8"
    );
    await fs.writeFile(path.join(scriptDir, "script1.gml"), "function script1() { return 1; }", "utf8");
}

async function execFileAsync(command: string, args: Array<string>, options?: ExecFileOptions) {
    if (command === "node" && isNonEmptyArray(args) && args[0] === wrapperPath) {
        const [, ...cliArgs] = args;
        return await runCliTestCommand({
            argv: cliArgs,
            env: options?.env,
            cwd: options?.cwd
        });
    }

    const output = await execFileBase(command, args, options);
    return {
        stdout: normalizeExecOutput(output.stdout),
        stderr: normalizeExecOutput(output.stderr),
        exitCode: 0
    };
}

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const candidateDist = path.resolve(currentDirectory, "../dist/index.js");
const wrapperPath = fsSync.existsSync(candidateDist) ? candidateDist : path.resolve(currentDirectory, "../src/cli.js");

async function createTemporaryDirectory() {
    const directoryPrefix = path.join(os.tmpdir(), "gml-verbose-test-");
    return fs.mkdtemp(directoryPrefix);
}

void describe("CLI Verbose Logging", () => {
    void it("does not show debug logs by default for format command", async () => {
        const tempDirectory = await createTemporaryDirectory();
        try {
            const targetFile = path.join(tempDirectory, "script.gml");
            await fs.writeFile(targetFile, "var a = 1;\n", "utf8");

            const { stdout, stderr } = await execFileAsync("node", [wrapperPath, "--path", tempDirectory]);

            assert.doesNotMatch(stdout, /DEBUG:/i);
            assert.doesNotMatch(stderr, /DEBUG:/i);
        } finally {
            await fs.rm(tempDirectory, { recursive: true, force: true });
        }
    });

    void it("reports per-file and overall timing when --verbose is provided for format command", async () => {
        const tempDirectory = await createTemporaryDirectory();
        try {
            const unformattedFile = path.join(tempDirectory, "script-unformatted.gml");
            const formattedFile = path.join(tempDirectory, "script-formatted.gml");
            await fs.writeFile(unformattedFile, "var a=1;\n", "utf8");
            await fs.writeFile(formattedFile, "var b = 2;\n", "utf8");

            const { stdout, exitCode } = await execFileAsync("node", [
                wrapperPath,
                "--verbose",
                "--path",
                tempDirectory,
                "--write"
            ]);

            assert.equal(exitCode, 0);
            assert.match(stdout, /Formatted .*script-unformatted\.gml \([0-9]+\.[0-9]{2}ms\)/);
            assert.match(stdout, /Checked .*script-formatted\.gml \(already formatted, [0-9]+\.[0-9]{2}ms\)/);
            assert.match(stdout, /Verbose timing: processed 2 formattable files in [0-9]+\.[0-9]{2}ms\./);
        } finally {
            await fs.rm(tempDirectory, { recursive: true, force: true });
        }
    });

    void it("reports per-file and overall timing when --verbose is provided for lint command", async () => {
        const tempDirectory = await createTemporaryDirectory();
        try {
            await createDummyRefactorProject(tempDirectory);
            const projectPath = path.join(tempDirectory, "project.yyp");

            const { stderr, exitCode } = await execFileAsync("node", [
                wrapperPath,
                "lint",
                "--verbose",
                "--path",
                projectPath,
                tempDirectory
            ]);

            assert.equal(exitCode, 0);
            assert.match(stderr, /\[timing\] Linted .*script1\.gml in [0-9]+\.[0-9]{2}ms\./);
            assert.match(stderr, /\[timing\] Completed lint run for 1 file in [0-9]+\.[0-9]{2}ms\./);
        } finally {
            await fs.rm(tempDirectory, { recursive: true, force: true });
        }
    });

    void it("shows debug logs when --verbose is provided for refactor command", async () => {
        const tempDirectory = await createTemporaryDirectory();
        try {
            await createDummyRefactorProject(tempDirectory);

            const { stdout } = await execFileAsync("node", [
                wrapperPath,
                "refactor",
                "--path",
                tempDirectory,
                "--old-name",
                "script1",
                "--new-name",
                "script2",
                "--verbose"
            ]);

            assert.match(stdout, /DEBUG: Discovered 2 yyFiles/);
            assert.match(stdout, /DEBUG: analyseResourceFiles parsed 2/);
        } finally {
            await fs.rm(tempDirectory, { recursive: true, force: true });
        }
    });

    void it("shows refactor --list settings output without applying changes", async () => {
        const tempDirectory = await createTemporaryDirectory();
        try {
            await createDummyRefactorProject(tempDirectory);

            const { stdout, exitCode } = await execFileAsync("node", [
                wrapperPath,
                "refactor",
                "--path",
                tempDirectory,
                "--old-name",
                "script1",
                "--new-name",
                "script2",
                "--list"
            ]);

            assert.equal(exitCode, 0);
            assert.match(stdout, /Mode: rename/);
            assert.match(stdout, /Execution mode: dry-run \(default\)/);
            assert.match(stdout, /Verbose mode: disabled/);
        } finally {
            await fs.rm(tempDirectory, { recursive: true, force: true });
        }
    });

    void it("does not show debug logs by default for refactor command", async () => {
        const tempDirectory = await createTemporaryDirectory();
        try {
            await createDummyRefactorProject(tempDirectory);

            const { stdout } = await execFileAsync("node", [
                wrapperPath,
                "refactor",
                "--path",
                tempDirectory,
                "--old-name",
                "script1",
                "--new-name",
                "script2"
            ]);

            assert.doesNotMatch(stdout, /DEBUG:/);
            assert.doesNotMatch(stdout, /\[GmlSemanticBridge]/);
        } finally {
            await fs.rm(tempDirectory, { recursive: true, force: true });
        }
    });
});
