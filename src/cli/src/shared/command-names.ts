/**
 * Central registry of all CLI command names.
 *
 * This module exports the canonical list of command names recognized by the CLI.
 * Import this set when validating user input, generating help text, or checking
 * whether an unknown input might be a typo of a valid command.
 *
 * Having a single source of truth for command names ensures that:
 * - The format command can detect likely command typos in error messages
 * - The list stays in sync as new commands are added
 * - Command name changes are reflected consistently throughout the CLI
 */

export const CLI_COMMAND_NAMES = Object.freeze(
    new Set([
        "format",
        "fix",
        "graph",
        "lint",
        "lookup-gml-identifier",
        "parse",
        "generate-gml-identifiers",
        "generate-quality-report",
        "collect-stats",
        "generate-feather-metadata",
        "prepare-hot-reload",
        "refactor",
        "resource",
        "runner",
        "symbol",
        "transpile",
        "validate",
        "watch",
        "watch-status",
        "help"
    ])
);
