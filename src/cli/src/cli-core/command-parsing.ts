import { Core } from "@gmloop/core";
import { InvalidArgumentError } from "commander";

import { isCommanderErrorLike, isCommanderHelpDisplayedError } from "./commander-error-utils.js";
import type { CommanderCommandLike } from "./commander-types.js";
import { CliUsageError } from "./errors.js";

type InvalidArgumentResolver = (value: unknown, ...rest: Array<unknown>) => unknown;

interface WrapInvalidArgumentResolverOptions {
    errorConstructor?: new (message: string) => Error;
    fallbackMessage?: string;
}

export interface ParseCommandLineResult {
    helpRequested: boolean;
    usage: string;
}

/**
 * An argParser for Commander.js options that validates port numbers.
 * Ports must be integers in the range 1–65535.
 */
export const portValidator = wrapInvalidArgumentResolver((value: string) => {
    const parsed = Number.parseInt(value);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 65_535) {
        throw new Error("Port must be between 1 and 65535");
    }
    return parsed;
});

/**
 * Create an argParser for Commander.js options that validates integers against
 * a minimum value.
 *
 * @param {number} min - Minimum allowed value (inclusive)
 * @param {string} errorMessage - Error message to display on validation failure
 * @returns {(value: string) => number} An argParser function for Commander.js
 */
export function createMinimumValueValidator(min: number, errorMessage: string) {
    return wrapInvalidArgumentResolver((value: string) => {
        const parsed = Number.parseInt(value);
        if (Number.isNaN(parsed) || parsed < min) {
            throw new Error(errorMessage);
        }
        return parsed;
    });
}

/**
 * Wrap a Commander option resolver so thrown errors are converted into
 * {@link InvalidArgumentError} instances. Callers can provide a custom error
 * constructor (for example when subclassing Commander) along with an optional
 * fallback message used when the thrown value lacks a descriptive message.
 *
 * @param {(value: unknown, ...rest: Array<unknown>) => unknown} resolver Value
 *        normalizer invoked by Commander when parsing option input.
 * @param {{
 *   errorConstructor?: new (message: string) => Error,
 *   fallbackMessage?: string
 * }} [options]
 * @returns {(value: unknown, ...rest: Array<unknown>) => unknown}
 */
export function wrapInvalidArgumentResolver(
    resolver: InvalidArgumentResolver,
    options: WrapInvalidArgumentResolverOptions = {}
): InvalidArgumentResolver {
    Core.assertFunction(resolver, "resolver");

    const { errorConstructor, fallbackMessage = "Invalid option value." } = options;

    const InvalidArgumentErrorConstructor =
        typeof errorConstructor === "function" ? errorConstructor : InvalidArgumentError;

    return (...args: Parameters<InvalidArgumentResolver>) => {
        try {
            return resolver(...args);
        } catch (error: unknown) {
            const message = Core.getErrorMessage(error, { fallback: fallbackMessage }) || fallbackMessage;
            const invalidArgumentError = new InvalidArgumentErrorConstructor(message);

            if (error && typeof error === "object") {
                invalidArgumentError.cause = error;
            }

            throw invalidArgumentError;
        }
    };
}

/**
 * Parse CLI arguments for a Commander.js command while normalizing help and
 * usage errors.
 *
 * @param {import("commander").Command} command
 * @param {Array<string>} args
 * @returns {{ helpRequested: boolean, usage: string }}
 */
export function parseCommandLine(command: CommanderCommandLike, args: Array<string>): ParseCommandLineResult {
    if (typeof command.parse !== "function") {
        throw new TypeError("Command must provide parse().");
    }

    if (typeof command.helpInformation !== "function") {
        throw new TypeError("Command must provide helpInformation().");
    }

    try {
        command.parse(args, { from: "user" });
        return {
            helpRequested: false,
            usage: command.helpInformation()
        };
    } catch (error: unknown) {
        if (isCommanderHelpDisplayedError(error)) {
            return {
                helpRequested: true,
                usage: command.helpInformation()
            };
        }

        if (isCommanderErrorLike(error)) {
            throw new CliUsageError(error.message.trim(), {
                usage: command.helpInformation()
            });
        }

        throw error;
    }
}
