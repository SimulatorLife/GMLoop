import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "@gmloop/core";
import { Command, InvalidArgumentError } from "commander";

import { parseCommandLine, portValidator, wrapInvalidArgumentResolver } from "../src/cli-core/command-parsing.js";
import { isCliUsageError } from "../src/cli-core/errors.js";

const { isObjectLike } = Core;

const createTestCommand = () => {
    return new Command().exitOverride().allowExcessArguments(false);
};

void describe("parseCommandLine", () => {
    void it("parses arguments and exposes command state", () => {
        const command = createTestCommand().argument("<value>").option("--flag");

        const result = parseCommandLine(command, ["--flag", "example"]);

        assert.strictEqual(result.helpRequested, false);
        assert.ok(result.usage.includes("Usage"));

        const options = command.opts();
        const [value] = command.processedArgs;
        assert.strictEqual(options.flag, true);
        assert.strictEqual(value, "example");
    });

    void it("returns help metadata when the user requests help", () => {
        const command = createTestCommand().option("--flag");

        const result = parseCommandLine(command, ["--help"]);

        assert.strictEqual(result.helpRequested, true);
        assert.ok(result.usage.includes("--flag"));
    });

    void it("wraps Commander usage errors as CliUsageError instances", () => {
        const command = createTestCommand().option("--flag");

        assert.throws(
            () => parseCommandLine(command, ["--unknown", "value"]),
            (error) =>
                isCliUsageError(error) && error.message.includes("unknown option") && typeof error.usage === "string"
        );
    });

    void it("supports Commander-style errors without Error prototypes", () => {
        interface MinimalCommanderError extends Error {
            code: string;
        }

        const command = {
            parse() {
                const commanderError = new Error("bad option") as MinimalCommanderError;
                commanderError.name = "CommanderError";
                commanderError.code = "commander.invalidOption";
                Object.setPrototypeOf(commanderError, null);

                throw commanderError;
            },
            helpInformation() {
                return "usage info";
            }
        };

        assert.throws(
            () => parseCommandLine(command, []),
            (error) => isCliUsageError(error) && error.message === "bad option" && error.usage === "usage info"
        );
    });
});

void describe("wrapInvalidArgumentResolver", () => {
    void it("returns the resolver result when no error is thrown", () => {
        const resolver = wrapInvalidArgumentResolver((value: string) => value.toUpperCase());

        assert.strictEqual(resolver("value"), "VALUE");
    });

    void it("wraps thrown errors as InvalidArgumentError instances", () => {
        const resolver = wrapInvalidArgumentResolver((value) => {
            if (value !== "ok") {
                throw new TypeError("invalid value");
            }

            return value;
        });

        assert.throws(
            () => resolver("nope"),
            (error) =>
                error instanceof InvalidArgumentError &&
                error.message === "invalid value" &&
                error.cause instanceof TypeError
        );
    });

    void it("applies the fallback message when the thrown value lacks a message", () => {
        const fallback = "Invalid option value.";
        const resolver = wrapInvalidArgumentResolver(
            () => {
                const reasonError = new Error("bad input");
                const reasonObject = reasonError as unknown as Record<string, unknown>;
                delete reasonObject.message;
                reasonObject.reason = "bad input";
                throw reasonError;
            },
            { fallbackMessage: fallback }
        );

        assert.throws(
            () => resolver("value"),
            (error) => {
                if (!(error instanceof InvalidArgumentError)) {
                    return false;
                }
                const causeObject = isObjectLike(error.cause) ? (error.cause as Record<string, unknown>) : null;
                if (!causeObject || !("reason" in causeObject)) {
                    return false;
                }
                return (causeObject.reason as string) === "bad input" && error.message === fallback;
            }
        );
    });

    void it("supports custom error constructors", () => {
        class CustomInvalidArgumentError extends Error {}

        const resolver = wrapInvalidArgumentResolver(
            () => {
                throw new Error("bad news");
            },
            { errorConstructor: CustomInvalidArgumentError }
        );

        assert.throws(
            () => resolver("value"),
            (error) =>
                error instanceof CustomInvalidArgumentError &&
                error.message === "bad news" &&
                error.cause instanceof Error
        );
    });
});

void describe("portValidator", () => {
    void it("accepts the minimum valid port (1)", () => {
        assert.strictEqual(portValidator("1"), 1);
    });

    void it("accepts a typical HTTP port (80)", () => {
        assert.strictEqual(portValidator("80"), 80);
    });

    void it("accepts a common dev server port (8080)", () => {
        assert.strictEqual(portValidator("8080"), 8080);
    });

    void it("accepts the maximum valid port (65535)", () => {
        assert.strictEqual(portValidator("65535"), 65_535);
    });

    void it("rejects port zero", () => {
        assert.throws(
            () => portValidator("0"),
            (error) => error instanceof InvalidArgumentError && /Port must be between 1 and 65535/.test(error.message)
        );
    });

    void it("rejects a port above the maximum", () => {
        assert.throws(
            () => portValidator("65536"),
            (error) => error instanceof InvalidArgumentError && /Port must be between 1 and 65535/.test(error.message)
        );
    });

    void it("rejects a negative port number", () => {
        assert.throws(
            () => portValidator("-1"),
            (error) => error instanceof InvalidArgumentError && /Port must be between 1 and 65535/.test(error.message)
        );
    });

    void it("rejects non-numeric input", () => {
        assert.throws(
            () => portValidator("abc"),
            (error) => error instanceof InvalidArgumentError && /Port must be between 1 and 65535/.test(error.message)
        );
    });
});

void describe("integer coercion helpers: import from Core, not command-parsing", () => {
    // coercePositiveInteger, coerceNonNegativeInteger, and resolveIntegerOption
    // were previously re-exported from command-parsing.ts under the same names,
    // adding indirection with no extra semantics (the "defaultNow" anti-pattern).
    // They were removed so callers always import from @gmloop/core directly.

    void it("coercePositiveInteger accepts valid positive integers", () => {
        assert.strictEqual(Core.coercePositiveInteger(5, { createErrorMessage: () => "too small" }), 5);
    });

    void it("coercePositiveInteger rejects non-positive values", () => {
        assert.throws(
            () => Core.coercePositiveInteger(0, { createErrorMessage: () => "must be positive" }),
            /must be positive/
        );
    });

    void it("coerceNonNegativeInteger accepts zero", () => {
        assert.strictEqual(Core.coerceNonNegativeInteger(0, { createErrorMessage: () => "negative" }), 0);
    });

    void it("coerceNonNegativeInteger rejects negative values", () => {
        assert.throws(
            () => Core.coerceNonNegativeInteger(-1, { createErrorMessage: () => "must be >= 0" }),
            /must be >= 0/
        );
    });

    void it("resolveIntegerOption returns the coerced value", () => {
        assert.strictEqual(Core.resolveIntegerOption(42, { coerce: (v) => v }), 42);
    });

    void it("resolveIntegerOption returns defaultValue for undefined input", () => {
        assert.strictEqual(Core.resolveIntegerOption(undefined, { defaultValue: 7, coerce: (v) => v }), 7);
    });
});
