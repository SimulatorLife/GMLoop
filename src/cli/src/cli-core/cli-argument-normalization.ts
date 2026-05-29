/**
 * Pure argument normalization utilities for the CLI.
 *
 * These functions handle:
 * - `help` / `help <command>` alias expansion
 * - pnpm `--` argument separator stripping
 * - Implicit format targets (bare paths interpreted as `format --path`)
 * - Default action resolution via environment variable
 *
 * All functions are intentionally free of I/O, process startup, and side-effects
 * so they can be unit-tested without loading the full CLI module.
 */

import process from "node:process";

import { Core } from "@gmloop/core";

import { CLI_COMMAND_NAMES } from "../shared/command-names.js";

const { isNonEmptyArray } = Core;

export const FORMAT_ACTION = "format";

function resolveDefaultAction(): string {
    return process.env.PRETTIER_PLUGIN_GML_DEFAULT_ACTION === FORMAT_ACTION ? FORMAT_ACTION : "help";
}

function normalizeArgumentList(argv: unknown): Array<string> {
    if (!isNonEmptyArray(argv)) {
        return [];
    }

    const arr = argv as Array<unknown>;
    return [...arr] as Array<string>;
}

function isHelpRequest(input: unknown): boolean {
    if (typeof input !== "string") {
        return false;
    }

    const normalized = input.trim().toLowerCase();
    return normalized === "--help" || normalized === "-h" || normalized === "help";
}

function isStandaloneHelpRequest(args: Array<unknown>): boolean {
    return args.length === 1 && isHelpRequest(args[0]);
}

function isHelpAliasCommand(args: Array<unknown>): boolean {
    return args[0] === "help";
}

function containsHelpFlag(args: Array<unknown>): boolean {
    return args.some((argument) => argument === "--help" || argument === "-h");
}

function stripPnpmArgumentSeparators(args: Array<unknown>): Array<unknown> {
    return args.filter((argument) => argument !== "--");
}

function normalizeFormatCommandHelpShortcut(args: Array<unknown>): Array<unknown> {
    const firstArgument = args[0];
    if (typeof firstArgument !== "string") {
        return args;
    }

    const normalizedFirstArgument = firstArgument.trim().toLowerCase();
    if (normalizedFirstArgument.length === 0) {
        return args;
    }

    if (normalizedFirstArgument.startsWith("-")) {
        return args;
    }

    if (CLI_COMMAND_NAMES.has(normalizedFirstArgument)) {
        return args;
    }

    if (containsHelpFlag(args)) {
        return [FORMAT_ACTION, "--help"];
    }

    return [FORMAT_ACTION, "--path", firstArgument, ...args.slice(1)];
}

function resolveHelpAliasCommandArguments(args: Array<unknown>): Array<unknown> {
    if (args.length === 1) {
        return ["--help"];
    }

    return [...args.slice(1), "--help"];
}

function resolveHelpAliasArguments(args: Array<unknown>): Array<unknown> {
    if (args.length === 0) {
        return resolveDefaultAction() === FORMAT_ACTION ? [] : ["--help"];
    }

    if (isStandaloneHelpRequest(args)) {
        return ["--help"];
    }

    if (!isHelpAliasCommand(args)) {
        return normalizeFormatCommandHelpShortcut(args);
    }

    return resolveHelpAliasCommandArguments(args);
}

function normalizeCommandLineArguments(argv: unknown): Array<string> {
    const normalizedArgs = normalizeArgumentList(argv);
    const withoutSeparator = stripPnpmArgumentSeparators(normalizedArgs);
    return resolveHelpAliasArguments(withoutSeparator) as Array<string>;
}

export {
    containsHelpFlag,
    isHelpAliasCommand,
    isHelpRequest,
    isStandaloneHelpRequest,
    normalizeArgumentList,
    normalizeCommandLineArguments,
    normalizeFormatCommandHelpShortcut,
    resolveDefaultAction,
    resolveHelpAliasArguments,
    resolveHelpAliasCommandArguments,
    stripPnpmArgumentSeparators
};
