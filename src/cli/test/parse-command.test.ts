import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";
import { createParseCommand } from "../src/commands/parse.js";

async function withTemporaryDirectory<T>(callback: (directory: string) => Promise<T>): Promise<T> {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-cli-parse-"));

    try {
        return await callback(temporaryDirectory);
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
}

void test("createParseCommand exposes shared parse options and optional positional path", () => {
    const command = createParseCommand();

    assert.equal(command.name(), "parse");
    assert.equal(command.registeredArguments.length, 1);
    assert.equal(command.registeredArguments[0]?.required, false);
    assert.equal(command.registeredArguments[0]?.name(), "path");
    assert.ok(command.options.some((option) => option.long === "--path"));
    assert.ok(command.options.some((option) => option.long === "--write"));
    assert.ok(command.options.some((option) => option.long === "--list"));
    assert.ok(command.options.some((option) => option.long === "--verbose"));
});

void test("parse --help output documents command examples and shared options", async () => {
    const { stdout, stderr, exitCode } = await runCliTestCommand({ argv: ["parse", "--help"] });

    assert.equal(exitCode, 0);
    assert.equal(stderr, "");
    assert.match(stdout, /Examples:/);
    assert.match(stdout, /gmloop parse --path path\/to\/script\.gml/);
    assert.match(stdout, /gmloop parse --write --path path\/to\/project/);
    assert.match(stdout, /--path <path>/);
    assert.match(stdout, /--write/);
    assert.match(stdout, /--list/);
    assert.match(stdout, /--verbose/);
});

void test("parse --list prints command settings and exits without parsing", async () => {
    await withTemporaryDirectory(async (temporaryDirectory) => {
        const result = await runCliTestCommand({
            argv: ["parse", "--path", temporaryDirectory, "--list", "--verbose"]
        });

        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.match(result.stdout, /Target path:/);
        assert.match(result.stdout, /Execution mode: dry-run \(stdout AST JSON\)/);
        assert.match(result.stdout, /Verbose mode: enabled/);
        assert.match(result.stdout, /Output: stdout/);
    });
});

void test("parse prints a single-file AST to stdout in dry-run mode", async () => {
    await withTemporaryDirectory(async (temporaryDirectory) => {
        const sourcePath = path.join(temporaryDirectory, "script.gml");
        const outputPath = `${sourcePath}.ast.json`;
        await writeFile(sourcePath, "var value = 1;\n", "utf8");

        const result = await runCliTestCommand({
            argv: ["parse", "--path", sourcePath]
        });

        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        const parsedOutput = JSON.parse(result.stdout) as { type?: string; body?: Array<{ type?: string }> };
        assert.equal(parsedOutput.type, "Program");
        assert.equal(Array.isArray(parsedOutput.body), true);
        await assert.rejects(access(outputPath));
    });
});

void test("parse prints directory AST payloads to stdout in dry-run mode", async () => {
    await withTemporaryDirectory(async (temporaryDirectory) => {
        await writeFile(path.join(temporaryDirectory, "b.gml"), "var b = 2;\n", "utf8");
        await mkdir(path.join(temporaryDirectory, "nested"));
        await writeFile(path.join(temporaryDirectory, "nested", "a.gml"), "var a = 1;\n", "utf8");
        await writeFile(path.join(temporaryDirectory, "notes.txt"), "not parsed\n", "utf8");

        const result = await runCliTestCommand({
            argv: ["parse", "--path", "."],
            cwd: temporaryDirectory
        });

        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        const parsedOutput = JSON.parse(result.stdout) as {
            files?: Array<{ path?: string; ast?: { type?: string } }>;
        };

        assert.deepEqual(
            parsedOutput.files?.map((file) => file.path),
            ["b.gml", path.join("nested", "a.gml")]
        );
        assert.deepEqual(
            parsedOutput.files?.map((file) => file.ast?.type),
            ["Program", "Program"]
        );
    });
});

void test("parse --write writes AST JSON artifacts for directory targets", async () => {
    await withTemporaryDirectory(async (temporaryDirectory) => {
        await writeFile(path.join(temporaryDirectory, "first.gml"), "var first = 1;\n", "utf8");
        await mkdir(path.join(temporaryDirectory, "nested"));
        await writeFile(path.join(temporaryDirectory, "nested", "second.gml"), "var second = 2;\n", "utf8");

        const result = await runCliTestCommand({
            argv: ["parse", "--path", ".", "--write"],
            cwd: temporaryDirectory
        });

        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.match(result.stdout, /Wrote first\.gml\.ast\.json/);
        assert.match(result.stdout, /Wrote nested\/second\.gml\.ast\.json/);
        assert.match(result.stdout, /Parsed and wrote 2 AST JSON files\./);

        const firstAst = JSON.parse(await readFile(path.join(temporaryDirectory, "first.gml.ast.json"), "utf8")) as {
            type?: string;
        };
        const secondAst = JSON.parse(
            await readFile(path.join(temporaryDirectory, "nested", "second.gml.ast.json"), "utf8")
        ) as { type?: string };

        assert.equal(firstAst.type, "Program");
        assert.equal(secondAst.type, "Program");
    });
});

void test("parse accepts a .yyp target path and parses project .gml files", async () => {
    await withTemporaryDirectory(async (temporaryDirectory) => {
        await writeFile(path.join(temporaryDirectory, "MyGame.yyp"), JSON.stringify({ name: "MyGame" }), "utf8");
        await mkdir(path.join(temporaryDirectory, "scripts", "demo"), { recursive: true });
        await writeFile(path.join(temporaryDirectory, "scripts", "demo", "demo.gml"), "var demo = 1;\n", "utf8");

        const result = await runCliTestCommand({
            argv: ["parse", "--path", path.join(temporaryDirectory, "MyGame.yyp"), "--write"]
        });

        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        await access(path.join(temporaryDirectory, "scripts", "demo", "demo.gml.ast.json"));
    });
});

void test("parse --help output warns that the command never defaults to the current working directory", async () => {
    const { stdout, stderr, exitCode } = await runCliTestCommand({ argv: ["parse", "--help"] });

    assert.equal(exitCode, 0);
    assert.equal(stderr, "");
    assert.match(stdout, /Parse never defaults to the current working directory/);
    assert.match(stdout, /node_modules/);
    assert.match(stdout, /--path or a\npositional \.gml file, directory, or \.yyp path/);
});

void test("parse with no target prints a usage error and never recurses the working directory", async () => {
    await withTemporaryDirectory(async (temporaryDirectory) => {
        // Seed the working directory with a deeply-nested `.gml` file that
        // would otherwise be parsed if the command fell back to the cwd.
        const nestedDirectory = path.join(temporaryDirectory, "src", "scripts");
        await mkdir(nestedDirectory, { recursive: true });
        const nestedSourcePath = path.join(nestedDirectory, "hidden.gml");
        await writeFile(nestedSourcePath, "var hidden = 1;\n", "utf8");

        const result = await runCliTestCommand({
            argv: ["parse"],
            cwd: temporaryDirectory
        });

        assert.equal(result.exitCode, 1);
        assert.match(result.stderr, /A target \.gml file, directory, or \.yyp path is required\./);
        assert.match(result.stderr, /Parse never defaults to the current working directory/);
        assert.match(result.stderr, /pnpm dlx gmloop parse --path path\/to\/script\.gml/);
        assert.match(result.stderr, /Usage: gmloop parse/);
        // The nested `.gml` source must remain untouched — no AST JSON file
        // should have been written, no AST should have been printed to stdout.
        assert.equal(result.stdout, "");
        await assert.rejects(access(`${nestedSourcePath}.ast.json`));
    });
});

void test("parse --list with no target still reports a (none) target instead of recursing", async () => {
    await withTemporaryDirectory(async (temporaryDirectory) => {
        const result = await runCliTestCommand({
            argv: ["parse", "--list"],
            cwd: temporaryDirectory
        });

        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");
        assert.match(result.stdout, /Target path: \(none\)/);
        assert.match(result.stdout, /Execution mode: dry-run \(stdout AST JSON\)/);
    });
});
