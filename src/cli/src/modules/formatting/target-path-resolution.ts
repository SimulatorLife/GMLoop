import { stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { Core } from "@gmloop/core";

import { CliUsageError } from "../../cli-core/errors.js";
import { pathExistsSync } from "../../shared/path-exists.js";
import { formatTargetAccessErrorMessage } from "../../shared/target-path-access-guidance.js";

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
        throw new CliUsageError(formatTargetAccessErrorMessage(target, error, originalInput), { usage });
    }
}
