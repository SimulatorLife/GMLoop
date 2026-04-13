import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { Core } from "@gmloop/core";

import { CliUsageError } from "../cli-core/errors.js";
import { CLI_COMMAND_NAMES } from "../shared/command-names.js";

const MAX_COMMAND_LENGTH_DIFFERENCE = 2;
const MAX_COMMAND_CHARACTER_DIFFERENCES = 2;
const COMMAND_PATTERN = /^[a-z][a-z0-9_-]*$/i;

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
 * Describe target-path input for error messages.
 */
function describeTargetPathInput(value: unknown): string {
    if (value === null) {
        return "null";
    }

    if (value === undefined) {
        return "undefined";
    }

    if (typeof value === "string") {
        return value.length === 0 ? "an empty string" : `string '${value}'`;
    }

    if (typeof value === "number" || typeof value === "bigint") {
        return `${typeof value} ${String(value)}`;
    }

    if (typeof value === "boolean") {
        return `boolean ${value}`;
    }

    if (typeof value === "symbol") {
        return "a symbol";
    }

    if (typeof value === "function") {
        return value.name ? `function ${value.name}` : "a function";
    }

    const tagName = Core.getObjectTagName(value);
    if (tagName === "Array") {
        return "an array";
    }

    if (tagName === "Object" || !tagName) {
        return "a plain object";
    }

    const article = /^[aeiou]/i.test(tagName) ? "an" : "a";
    return `${article} ${tagName} object`;
}

/**
 * Checks if the given input looks like a help flag or help command.
 */
export function isHelpRequest(input: unknown): boolean {
    if (typeof input !== "string") {
        return false;
    }

    const normalized = input.trim().toLowerCase();
    return normalized === "--help" || normalized === "-h" || normalized === "help";
}

/**
 * Validate command input to ensure the caller supplied a usable target path.
 */
export function validateTargetPathInput({
    targetPathProvided,
    targetPathInput,
    usage
}: {
    targetPathProvided: boolean;
    targetPathInput: unknown;
    usage: string;
}): void {
    if (!targetPathProvided) {
        return;
    }

    if (targetPathInput == null || targetPathInput === "") {
        throw new CliUsageError(
            [
                "Target path cannot be empty. Pass a directory or file to format (relative or absolute) or omit --path to format the current working directory.",
                "If the path conflicts with a command name, invoke the format subcommand explicitly (prettier-plugin-gml format --path <path>)."
            ].join(" "),
            { usage }
        );
    }

    if (typeof targetPathInput !== "string") {
        const description = describeTargetPathInput(targetPathInput);
        throw new CliUsageError(`Target path must be provided as a string. Received ${description}.`, { usage });
    }
}

/**
 * Resolve the file system path that should be formatted.
 */
export function resolveTargetPathFromInput(
    targetPathInput: unknown,
    { rawTargetPathInput }: { rawTargetPathInput?: string } = {}
): string {
    const hasExplicitTarget = Core.isNonEmptyString(targetPathInput);
    const normalizedTarget = hasExplicitTarget ? targetPathInput : ".";
    const resolvedNormalizedTarget = path.resolve(process.cwd(), normalizedTarget);

    if (hasExplicitTarget && typeof rawTargetPathInput === "string") {
        const resolvedRawTarget = path.resolve(process.cwd(), rawTargetPathInput);

        if (resolvedRawTarget !== resolvedNormalizedTarget) {
            if (safeExistsSync(resolvedRawTarget)) {
                return resolvedRawTarget;
            }

            if (safeExistsSync(resolvedNormalizedTarget)) {
                return resolvedNormalizedTarget;
            }
        }
    }

    return resolvedNormalizedTarget;
}

function safeExistsSync(candidatePath: string): boolean {
    try {
        return existsSync(candidatePath);
    } catch {
        return false;
    }
}

/**
 * Resolve file-system stats for target path and wrap common usage errors.
 */
export async function resolveTargetStats(
    target: string,
    { usage, originalInput }: { usage?: string; originalInput?: string } = {}
) {
    try {
        return await stat(target);
    } catch (error) {
        const details = Core.getErrorMessageOrFallback(error);
        const formattedTarget = formatPathForDisplay(target);
        const guidance = (() => {
            if (Core.isErrorWithCode(error, "ENOENT")) {
                const inputToCheck = originalInput ?? target;
                if (looksLikeCommandName(inputToCheck)) {
                    const isKnownCommand = CLI_COMMAND_NAMES.has(inputToCheck);
                    const suggestedCommand = isKnownCommand
                        ? inputToCheck
                        : resolveClosestKnownCommand(inputToCheck, CLI_COMMAND_NAMES);
                    const guidanceParts = isKnownCommand
                        ? [
                              `Did you mean to run the '${inputToCheck}' command?`,
                              "If so, do not provide it as an argument to 'format'. Instead, run it directly:",
                              `"prettier-plugin-gml ${inputToCheck} --help" for usage information.`,
                              "If you intended to format a file or directory, verify the path exists relative",
                              `to the current working directory (${process.cwd()}) or provide an absolute path.`
                          ]
                        : [
                              `Did you mean to run a command? If so, the command '${inputToCheck}' is not recognized.`,
                              ...(suggestedCommand === null
                                  ? []
                                  : [
                                        `Did you mean '${suggestedCommand}'? Try "prettier-plugin-gml ${suggestedCommand} --help".`
                                    ]),
                              'Run "prettier-plugin-gml --help" to see available commands.',
                              "If you intended to format a file or directory, verify the path exists relative",
                              `to the current working directory (${process.cwd()}) or provide an absolute path.`
                          ];
                    return guidanceParts.join(" ");
                }

                const guidanceParts = [
                    "Verify the path exists relative to the current working directory",
                    `(${process.cwd()}) or provide an absolute path.`,
                    'Run "prettier-plugin-gml --help" to review available commands and usage examples.'
                ];

                return guidanceParts.join(" ");
            }

            if (Core.isErrorWithCode(error, "EACCES")) {
                return "Check that you have permission to read the path.";
            }

            return null;
        })();
        const messageParts = [`Unable to access ${formattedTarget}: ${details}.`];

        if (guidance) {
            messageParts.push(guidance);
        }

        throw new CliUsageError(messageParts.join(" "), { usage });
    }
}

function formatPathForDisplay(targetPath: string): string {
    const resolvedTarget = path.resolve(targetPath);
    const resolvedCwd = process.cwd();
    const relativePath = path.relative(resolvedCwd, resolvedTarget);

    if (resolvedTarget === resolvedCwd) {
        return ".";
    }

    if (relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
        return relativePath;
    }

    return resolvedTarget;
}
