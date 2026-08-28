import process from "node:process";

import { Core } from "@gmloop/core";

import { formatPathForDisplay } from "../workflow/display-path.js";
import { CLI_COMMAND_NAMES } from "./command-names.js";

const MAX_COMMAND_LENGTH_DIFFERENCE = 2;
const MAX_COMMAND_CHARACTER_DIFFERENCES = 2;
const COMMAND_PATTERN = /^[a-z][a-z0-9_-]*$/i;
const REPOSITORY_HELP_COMMAND = "pnpm run cli -- --help";

function describeHelpCommandSuggestion(commandName: string): string {
    return `Run "pnpm run cli -- ${commandName} --help" from this repository checkout (or "${commandName} --help" when the CLI is installed globally).`;
}

/**
 * Determine whether the provided target looks like a command name rather than a file path.
 */
function looksLikeCommandName(target: string): boolean {
    if (!isCommandInputCandidate(target)) {
        return false;
    }

    if (CLI_COMMAND_NAMES.has(target)) {
        return true;
    }

    if (!COMMAND_PATTERN.test(target)) {
        return false;
    }

    if (hasSimilarKnownCommand(target, CLI_COMMAND_NAMES)) {
        return true;
    }

    return true;
}

/**
 * Check whether input could plausibly be a command rather than a path.
 */
function isCommandInputCandidate(target: string): boolean {
    if (target.includes("/") || target.includes("\\")) {
        return false;
    }

    return !/\.\w+$/.test(target);
}

/**
 * Identify likely command typos by comparing character positions.
 */
function hasSimilarKnownCommand(target: string, knownCommands: Set<string>): boolean {
    const lowerTarget = target.toLowerCase();

    for (const command of knownCommands) {
        if (!isWithinCommandLengthThreshold(command, lowerTarget)) {
            continue;
        }

        const differences = countCommandCharacterDifferences(command, lowerTarget, MAX_COMMAND_CHARACTER_DIFFERENCES);

        if (isWithinCommandSimilarityThreshold(differences, command.length)) {
            return true;
        }
    }

    return false;
}

function resolveClosestKnownCommand(target: string, knownCommands: Set<string>): string | null {
    const normalizedTarget = target.toLowerCase();
    let closestCommand: string | null = null;
    let closestScore = Number.POSITIVE_INFINITY;

    for (const command of knownCommands) {
        if (!isWithinCommandLengthThreshold(command, normalizedTarget)) {
            continue;
        }

        const differences = countCommandCharacterDifferences(command, normalizedTarget, Number.POSITIVE_INFINITY);

        if (!isWithinCommandSimilarityThreshold(differences, command.length)) {
            continue;
        }

        const score = differences + Math.abs(command.length - normalizedTarget.length);

        if (score < closestScore) {
            closestScore = score;
            closestCommand = command;
        }
    }

    return closestCommand;
}

function isWithinCommandLengthThreshold(command: string, target: string): boolean {
    return Math.abs(command.length - target.length) <= MAX_COMMAND_LENGTH_DIFFERENCE;
}

function countCommandCharacterDifferences(command: string, target: string, maxDifferences: number): number {
    let differences = 0;
    const minLength = Math.min(command.length, target.length);

    for (let index = 0; index < minLength; index += 1) {
        if (command[index] !== target[index]) {
            differences += 1;
            if (differences > maxDifferences) {
                break;
            }
        }
    }

    return differences;
}

function isWithinCommandSimilarityThreshold(differences: number, commandLength: number): boolean {
    return differences <= MAX_COMMAND_CHARACTER_DIFFERENCES && differences < commandLength / 2;
}

/**
 * Build actionable follow-up guidance for a failed target-path access attempt.
 *
 * Shared by every command that resolves a `.gml` file/directory/`.yyp` target
 * (format, parse, transpile, ...) so a missing or mistyped path produces the
 * same "did you mean a command?" / "verify the path" advice everywhere,
 * rather than each command inventing its own wording.
 */
export function describeMissingPathGuidance(error: unknown, originalInput: string): string | null {
    if (Core.isErrorWithCode(error, "ENOENT")) {
        if (looksLikeCommandName(originalInput)) {
            const isKnownCommand = CLI_COMMAND_NAMES.has(originalInput);
            const suggestedCommand = isKnownCommand
                ? originalInput
                : resolveClosestKnownCommand(originalInput, CLI_COMMAND_NAMES);
            const guidanceParts = isKnownCommand
                ? [
                      `Did you mean to run the '${originalInput}' command?`,
                      "If so, do not provide it as an argument. Instead, run it directly:",
                      describeHelpCommandSuggestion(originalInput),
                      "If you intended to target a file or directory, verify the path exists relative",
                      `to the current working directory (${process.cwd()}) or provide an absolute path.`
                  ]
                : [
                      `Did you mean to run a command? If so, the command '${originalInput}' is not recognized.`,
                      ...(suggestedCommand === null
                          ? []
                          : [`Did you mean '${suggestedCommand}'? ${describeHelpCommandSuggestion(suggestedCommand)}`]),
                      `Run "${REPOSITORY_HELP_COMMAND}" to see available commands in this checkout (or "gmloop --help" if installed globally).`,
                      "If you intended to target a file or directory, verify the path exists relative",
                      `to the current working directory (${process.cwd()}) or provide an absolute path.`
                  ];
            return guidanceParts.join(" ");
        }

        const guidanceParts = [
            "Verify the path exists relative to the current working directory",
            `(${process.cwd()}) or provide an absolute path.`,
            `Run "${REPOSITORY_HELP_COMMAND}" to review available commands and usage examples in this checkout (or "gmloop --help" if installed globally).`
        ];

        return guidanceParts.join(" ");
    }

    if (Core.isErrorWithCode(error, "EACCES")) {
        return "Check that you have permission to read the path.";
    }

    return null;
}

/**
 * Format the standard "Unable to access <path>: <reason>." error message,
 * including actionable guidance, for a failed target-path stat/lstat call.
 */
export function formatTargetAccessErrorMessage(target: string, error: unknown, originalInput?: string): string {
    const details = Core.getErrorMessageOrFallback(error);
    const formattedTarget = formatPathForDisplay(target);
    const guidance = describeMissingPathGuidance(error, originalInput ?? target);
    const messageParts = [`Unable to access ${formattedTarget}: ${details}.`];

    if (guidance) {
        messageParts.push(guidance);
    }

    return messageParts.join(" ");
}
