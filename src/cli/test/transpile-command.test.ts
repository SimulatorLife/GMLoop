import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCliTestCommand } from "../src/cli.js";
import { createTranspileCommand } from "../src/commands/transpile.js";

void test("createTranspileCommand exposes shared options", () => {
    const command = createTranspileCommand();

    assert.equal(command.name(), "transpile");
    assert.ok(command.options.some((option) => option.long === "--path"));
    assert.ok(command.options.some((option) => option.long === "--write"));
    assert.ok(command.options.some((option) => option.long === "--list"));
    assert.ok(command.options.some((option) => option.long === "--verbose"));
    assert.equal(command.registeredArguments.length, 0);
});

void test("transpile --help output documents examples and shared options", async () => {
    const result = await runCliTestCommand({
        argv: ["transpile", "--help"]
    });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Examples:/);
    assert.match(result.stdout, /prettier-plugin-gml transpile --path path\/to\/script\.gml/);
    assert.match(result.stdout, /--path <path>/);
    assert.match(result.stdout, /--write/);
    assert.match(result.stdout, /--list/);
    assert.match(result.stdout, /--verbose/);
});

void test("transpile --list prints command settings and exits", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-transpile-list-"));

    try {
        const result = await runCliTestCommand({
            argv: ["transpile", "--list", "--path", temporaryDirectory]
        });

        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /Target directory:/);
        assert.match(result.stdout, /GML files discovered:/);
        assert.match(result.stdout, /Execution mode: dry-run \(default, no writes\)/);
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});

void test("transpile dry-run emits JavaScript to stdout without writing files", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-transpile-dry-run-"));
    const sourcePath = path.join(temporaryDirectory, "demo_script.gml");
    const outputPath = path.join(temporaryDirectory, "demo_script.js");

    try {
        await writeFile(sourcePath, "function demo_script(a, b) { return a + b; }\n", "utf8");

        const result = await runCliTestCommand({
            argv: ["transpile", "--path", sourcePath]
        });

        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /args\[0\]/);
        assert.match(result.stdout, /args\[1\]/);
        assert.match(result.stdout, /a \+ b/);
        assert.match(result.stdout, /Transpiled 1 file to JavaScript \(dry-run\)/);
        await assert.rejects(async () => access(outputPath));
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});

void test("transpile --write writes JavaScript output files", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-transpile-fix-"));
    const sourcePath = path.join(temporaryDirectory, "compute_total.gml");
    const outputPath = path.join(temporaryDirectory, "compute_total.js");

    try {
        await writeFile(sourcePath, "function compute_total(value) { return value * 2; }\n", "utf8");

        const result = await runCliTestCommand({
            argv: ["transpile", "--write", "--path", sourcePath]
        });

        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /Transpiled 1 file and wrote JavaScript output files\./);

        const outputText = await readFile(outputPath, "utf8");
        assert.match(outputText, /args\[0\]/);
        assert.match(outputText, /value \* 2/);
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});

void test("transpile reports supported target types when passed a non-GML file", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-transpile-invalid-target-"));
    const invalidTargetPath = path.join(temporaryDirectory, "notes.txt");

    try {
        await writeFile(invalidTargetPath, "not gml", "utf8");

        const result = await runCliTestCommand({
            argv: ["transpile", "--path", invalidTargetPath]
        });

        assert.equal(result.exitCode, 1);
        assert.match(result.stderr, /Transpile only accepts \.gml files, \.yyp files, or directories\./);
        assert.match(result.stderr, /notes\.txt/);
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});
