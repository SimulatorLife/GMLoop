import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";

void test("lint --help output includes an examples section", async () => {
    const { stdout } = await runCliTestCommand({ argv: ["lint", "--help"] });

    assert.match(stdout, /Examples:/);
});

void test("lint --help output shows a basic lint invocation example", async () => {
    const { stdout } = await runCliTestCommand({ argv: ["lint", "--help"] });

    assert.match(stdout, /pnpm dlx prettier-plugin-gml lint path\/to\/project/);
});

void test("lint --help output shows a --write example", async () => {
    const { stdout } = await runCliTestCommand({ argv: ["lint", "--help"] });

    assert.match(stdout, /pnpm dlx prettier-plugin-gml lint --write/);
});

void test("lint --help output documents --path and --list options", async () => {
    const { stdout } = await runCliTestCommand({ argv: ["lint", "--help"] });

    assert.match(stdout, /--path <path>/);
    assert.match(stdout, /--config <path>/);
    assert.match(stdout, /--list/);
    assert.match(stdout, /--verbose/);
});

void test("lint --list prints command settings and exits without linting", async () => {
    const { stdout, stderr, exitCode } = await runCliTestCommand({ argv: ["lint", "--list"] });

    assert.equal(exitCode, 0);
    assert.match(stdout, /Path override:/);
    assert.match(stdout, /Fix mode:/);
    assert.equal(stderr, "");
});

void test("lint --help output shows a --max-warnings CI example with a .gml path", async () => {
    const { stdout } = await runCliTestCommand({ argv: ["lint", "--help"] });

    assert.match(stdout, /--max-warnings 0.*\.gml/);
});

void test("lint reports when no .gml files are found in the provided path", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-cli-lint-empty-"));

    try {
        await writeFile(path.join(temporaryDirectory, "readme.txt"), "not gml\n", "utf8");

        const result = await runCliTestCommand({
            argv: ["lint", temporaryDirectory]
        });

        assert.equal(result.exitCode, 0);
        assert.match(result.stderr, /No \.gml files were linted in/);
        assert.match(result.stderr, /Lint only processes \.gml sources/);
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});

void test("lint prints a clean-run summary when all files pass with no diagnostics", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-cli-lint-clean-"));

    try {
        // A trivial GML script that triggers no lint rules.
        await writeFile(path.join(temporaryDirectory, "clean.gml"), "var x = 1;\n", "utf8");

        const result = await runCliTestCommand({
            argv: ["lint", "--no-default-config", temporaryDirectory]
        });

        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /✓.*file.*checked.*no problems found/);
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});

void test("lint clean-run summary is suppressed when --quiet is active", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-cli-lint-quiet-"));

    try {
        await writeFile(path.join(temporaryDirectory, "clean.gml"), "var x = 1;\n", "utf8");

        const result = await runCliTestCommand({
            argv: ["lint", "--quiet", "--no-default-config", temporaryDirectory]
        });

        assert.equal(result.exitCode, 0);
        assert.equal(result.stdout, "");
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});

void test("lint clean-run summary is not printed when the formatter produces its own output", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-cli-lint-json-"));

    try {
        await writeFile(path.join(temporaryDirectory, "clean.gml"), "var x = 1;\n", "utf8");

        const result = await runCliTestCommand({
            argv: ["lint", "--formatter", "json", "--no-default-config", temporaryDirectory]
        });

        assert.equal(result.exitCode, 0);
        // JSON formatter always produces output; the clean summary must not be appended.
        assert.doesNotMatch(result.stdout, /✓.*no problems found/);
        // Output must still be valid JSON.
        assert.doesNotThrow(() => JSON.parse(result.stdout));
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});

void test("lint clean-run summary uses singular 'file' for exactly one file", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-cli-lint-singular-"));

    try {
        await writeFile(path.join(temporaryDirectory, "clean.gml"), "var x = 1;\n", "utf8");

        const result = await runCliTestCommand({
            argv: ["lint", "--no-default-config", temporaryDirectory]
        });

        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /✓ 1 file checked, no problems found\./);
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});

void test("lint clean-run summary uses plural 'files' for more than one file", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-cli-lint-plural-"));

    try {
        await writeFile(path.join(temporaryDirectory, "a.gml"), "var x = 1;\n", "utf8");
        await writeFile(path.join(temporaryDirectory, "b.gml"), "var y = 2;\n", "utf8");

        const result = await runCliTestCommand({
            argv: ["lint", "--no-default-config", temporaryDirectory]
        });

        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /✓ 2 files checked, no problems found\./);
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});

void test("lint accepts --path pointing to a .yyp file and lints the project directory", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-cli-lint-yyp-"));

    try {
        await writeFile(path.join(temporaryDirectory, "project.yyp"), JSON.stringify({ name: "MyGame" }), "utf8");
        await writeFile(path.join(temporaryDirectory, "clean.gml"), "var x = 1;\n", "utf8");

        const result = await runCliTestCommand({
            argv: ["lint", "--no-default-config", "--path", path.join(temporaryDirectory, "project.yyp")]
        });

        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /✓ 1 file checked, no problems found\./);
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});

void test("lint accepts --path pointing to a single .gml file target", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-cli-lint-file-path-"));

    try {
        await writeFile(path.join(temporaryDirectory, "clean.gml"), "var x = 1;\n", "utf8");
        await writeFile(path.join(temporaryDirectory, "ignored.gml"), "var y = 2;\n", "utf8");

        const result = await runCliTestCommand({
            argv: ["lint", "--no-default-config", "--path", path.join(temporaryDirectory, "clean.gml")]
        });

        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, /✓ 1 file checked, no problems found\./);
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});
