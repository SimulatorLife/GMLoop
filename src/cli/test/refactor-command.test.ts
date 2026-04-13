/**
 * Tests for the refactor command.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runCliTestCommand } from "../src/cli.js";
import { createRefactorCommand } from "../src/commands/refactor.js";

void describe("Refactor command", () => {
    void it("should create refactor command with correct name", () => {
        const command = createRefactorCommand();
        assert.equal(command.name(), "refactor");
    });

    void it("should have required options", () => {
        const command = createRefactorCommand();
        const options = command.options;

        const symbolIdOption = options.find((opt) => opt.long === "--symbol-id");
        const oldNameOption = options.find((opt) => opt.long === "--old-name");
        const newNameOption = options.find((opt) => opt.long === "--new-name");
        const pathOption = options.find((opt) => opt.long === "--path");
        const legacyProjectOption = options.find((opt) => opt.long === "--project");
        const legacyProjectRootOption = options.find((opt) => opt.long === "--project-root");
        const configOption = options.find((opt) => opt.long === "--config");
        const dryRunOption = options.find((opt) => opt.long === "--dry-run");
        const writeOption = options.find((opt) => opt.long === "--write");
        const legacyWriteOption = options.find((opt) => opt.long === "--write");
        const onlyOption = options.find((opt) => opt.long === "--only");
        const listOption = options.find((opt) => opt.long === "--list");
        const verboseOption = options.find((opt) => opt.long === "--verbose");
        const checkHotReloadOption = options.find((opt) => opt.long === "--check-hot-reload");

        assert.ok(symbolIdOption, "Should have --symbol-id option");
        assert.ok(oldNameOption, "Should have --old-name option");
        assert.ok(newNameOption, "Should have --new-name option");
        assert.ok(pathOption, "Should have --path option");
        assert.equal(legacyProjectOption, undefined, "Should not expose legacy --project option");
        assert.equal(legacyProjectRootOption, undefined, "Should not expose legacy --project-root option");
        assert.ok(configOption, "Should have --config option");
        assert.equal(dryRunOption, undefined, "Should not expose --dry-run option");
        assert.ok(writeOption, "Should have --write option");
        assert.equal(legacyWriteOption, undefined, "Should not expose legacy --write option");
        assert.ok(onlyOption, "Should have --only option");
        assert.ok(listOption, "Should have --list option");
        assert.ok(verboseOption, "Should have --verbose option");
        assert.ok(checkHotReloadOption, "Should have --check-hot-reload option");
    });

    void it("should have correct default values", () => {
        const command = createRefactorCommand();
        const options = command.options;

        const pathOption = options.find((opt) => opt.long === "--path");
        const writeOption = options.find((opt) => opt.long === "--write");
        const listOption = options.find((opt) => opt.long === "--list");
        const verboseOption = options.find((opt) => opt.long === "--verbose");
        const checkHotReloadOption = options.find((opt) => opt.long === "--check-hot-reload");

        assert.equal(pathOption.defaultValue, undefined);
        assert.equal(writeOption.defaultValue, false);
        assert.equal(listOption.defaultValue, false);
        assert.equal(verboseOption.defaultValue, false);
        assert.equal(checkHotReloadOption.defaultValue, false);
    });

    void it("should have correct description", () => {
        const command = createRefactorCommand();
        assert.equal(command.description(), "Perform safe, project-wide code transformations");
    });

    void it("should expose codemod operation arguments", () => {
        const command = createRefactorCommand();
        assert.equal(command.registeredArguments.length, 2);
        assert.equal(command.registeredArguments[0]?.required, false);
        assert.equal(command.registeredArguments[1]?.variadic, true);
    });

    void it("surfaces missing-argument errors as actionable usage guidance without a stack trace", async () => {
        // Running refactor with no arguments should produce a clean, human-readable
        // error message (no internal stack frames visible) and append the command's
        // usage text so the contributor knows what to provide next.
        const result = await runCliTestCommand({ argv: ["refactor"] });

        assert.equal(result.exitCode, 1, "Should exit with code 1 when mode cannot be inferred");
        assert.match(
            result.stderr,
            /Could not infer refactor mode\. Provide --old-name\/--symbol-id with --new-name for renames/,
            "Should surface the actionable guidance message"
        );
        assert.match(
            result.stderr,
            /Usage: prettier-plugin-gml refactor \[options\] \[operation\] \[paths\.\.\.\]/,
            "Should include usage text so the user knows what to provide"
        );
        // No internal file path fragments should appear in the error output – the
        // raw stack trace is opaque noise for a simple usage mistake.
        assert.doesNotMatch(result.stderr, /\bat .*\/refactor\.js/, "Should not expose a raw stack trace");
    });
});
