/**
 * Tests for CLI command names synchronization.
 *
 * Ensures that the central CLI_COMMAND_NAMES registry stays in sync with
 * the actual commands registered in the CLI, preventing maintenance issues
 * where new commands are added but the registry is not updated.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { CLI_COMMAND_NAMES } from "../src/shared/command-names.js";

void test("CLI_COMMAND_NAMES includes all expected commands", () => {
    const expectedCommands = [
        "format",
        "fix",
        "graph",
        "lint",
        "live-reload",
        "lookup-gml-identifier",
        "mcp",
        "object",
        "parse",
        "profile",
        "generate-gml-identifiers",
        "generate-quality-report",
        "collect-stats",
        "generate-feather-metadata",
        "project",
        "replay",
        "refactor",
        "resource",
        "room",
        "runner",
        "symbol",
        "test",
        "transpile",
        "ui",
        "validate",
        "help"
    ];

    for (const command of expectedCommands) {
        assert.ok(
            CLI_COMMAND_NAMES.has(command),
            `CLI_COMMAND_NAMES should include "${command}" command. If this test fails after adding a new command, ` +
                `update src/cli/src/shared/command-names.ts to include the new command name.`
        );
    }
});

void test("CLI_COMMAND_NAMES includes refactor command", () => {
    // This test specifically validates the fix: the refactor command was previously
    // missing from the hardcoded KNOWN_COMMANDS list, causing confusing error messages
    // when users accidentally used it as a path argument.
    assert.ok(
        CLI_COMMAND_NAMES.has("refactor"),
        'CLI_COMMAND_NAMES must include "refactor" command to provide accurate error messages'
    );
});

void test("CLI_COMMAND_NAMES is frozen", () => {
    assert.ok(Object.isFrozen(CLI_COMMAND_NAMES), "CLI_COMMAND_NAMES should be frozen to prevent modifications");
});

void test("CLI_COMMAND_NAMES is a Set", () => {
    assert.ok(CLI_COMMAND_NAMES instanceof Set, "CLI_COMMAND_NAMES should be a Set for efficient lookups");
});
