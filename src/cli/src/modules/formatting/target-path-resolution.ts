import { stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { Core } from "@gmloop/core";

import { CliUsageError } from "../../cli-core/errors.js";
import { CLI_COMMAND_NAMES } from "../../shared/command-names.js";
import { pathExistsSync } from "../../shared/path-exists.js";
import { formatPathForDisplay } from "../../workflow/display-path.js";
import { evaluateCommandMisclassification, REPOSITORY_HELP_COMMAND } from "./command-misclassification-policy.js";

/**
 * Build the guidance paragraph that the format command renders when the
 * `--path` argument does not exist on disk. The paragraph is shaped by the
 * {@link evaluateCommandMisclassification} policy so the wording stays in
 * sync with the policy's decision branches.
 *
 * @param inputToCheck - The original raw token the user passed to `--path`.
 * @returns The full guidance paragraph, or `null` when the policy reports
 *          that the input is unambiguously a filesystem path and no
 *          command-misclassification guidance applies.
 */
function buildCommandMisclassificationGuidance(inputToCheck: string): string | null {
    const decision = evaluateCommandMisclassification({
        target: inputToCheck,
        knownCommands: CLI_COMMAND_NAMES
    });

    if (decision.kind === "not-a-candidate") {
        return null;
    }

    if (decision.kind === "known-command") {
        return [
            `Did you mean to run the '${decision.commandName}' command?`,
            "If so, do not provide it as an argument to 'format'. Instead, run it directly:",
            decision.helpSuggestion,
            "If you intended to format a file or directory, verify the path exists relative",
            `to the current working directory (${process.cwd()}) or provide an absolute path.`
        ].join(" ");
    }

    if (decision.kind === "probable-typo") {
        return [
            `Did you mean to run a command? If so, the command '${inputToCheck}' is not recognized.`,
            `Did you mean '${decision.suggestedCommand}'? ${decision.helpSuggestion}`,
            `Run "${REPOSITORY_HELP_COMMAND}" to see available commands in this checkout (or "gmloop --help" if installed globally).`,
            "If you intended to format a file or directory, verify the path exists relative",
            `to the current working directory (${process.cwd()}) or provide an absolute path.`
        ].join(" ");
    }

    return [
        `Did you mean to run a command? If so, the command '${inputToCheck}' is not recognized.`,
        decision.helpSuggestion,
        "If you intended to format a file or directory, verify the path exists relative",
        `to the current working directory (${process.cwd()}) or provide an absolute path.`
    ].join(" ");
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
                "If the path conflicts with a command name, invoke the format subcommand explicitly (pnpm run cli -- format --path <path>)."
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
            if (pathExistsSync(resolvedRawTarget)) {
                return resolvedRawTarget;
            }

            if (pathExistsSync(resolvedNormalizedTarget)) {
                return resolvedNormalizedTarget;
            }
        }
    }

    return resolvedNormalizedTarget;
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
                const commandGuidance = buildCommandMisclassificationGuidance(inputToCheck);
                if (commandGuidance !== null) {
                    return commandGuidance;
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
        })();
        const messageParts = [`Unable to access ${formattedTarget}: ${details}.`];

        if (guidance) {
            messageParts.push(guidance);
        }

        throw new CliUsageError(messageParts.join(" "), { usage });
    }
}
