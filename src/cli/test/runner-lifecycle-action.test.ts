/**
 * Contract tests for `coerceRunnerLifecycleAction` and its integrations.
 *
 * The contract for rejecting an invalid lifecycle action is deliberately
 * narrow: the user must see what they typed wrong and what the available
 * alternatives are. The exact prefix, separator, and trailing punctuation of
 * the error message are presentation concerns, not part of the contract, so
 * these tests assert the user-visible contents (the bad input and every
 * canonical allowed action) rather than a full-message regex.
 *
 * The set of canonical allowed actions lives in {@link RUNNER_LIFECYCLE_ACTIONS}.
 * Tests derive `ALLOWED_LIFECYCLE_ACTIONS` from that frozen object once and
 * reuse it everywhere, so adding or renaming an action only requires editing
 * the source module rather than chasing hardcoded strings through this file.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "@gmloop/core";
import { Argument, Command, InvalidArgumentError } from "commander";

import { runCliTestCommand } from "../src/cli.js";
import { wrapInvalidArgumentResolver } from "../src/cli-core/command-parsing.js";
import {
    coerceRunnerLifecycleAction,
    RUNNER_LIFECYCLE_ACTIONS,
    type RunnerLifecycleAction
} from "../src/modules/runtime/lifecycle.js";

const ALLOWED_LIFECYCLE_ACTIONS: ReadonlyArray<RunnerLifecycleAction> = Object.freeze(
    Object.values(RUNNER_LIFECYCLE_ACTIONS)
);

function describeError(value: unknown): string {
    if (value instanceof Error) {
        return `${value.name}: ${value.message}`;
    }

    if (typeof value === "string") {
        return value;
    }

    if (value === null) {
        return "null";
    }

    if (value === undefined) {
        return "undefined";
    }

    if (typeof value === "symbol") {
        return value.toString();
    }

    return Object.getPrototypeOf(value)?.constructor?.name ?? typeof value;
}

/**
 * Assert that `error` carries the invalid-action contract: it must be an
 * `Error` whose message names the bad input and every canonical allowed
 * action. Word boundaries (`\b`) keep a candidate like `start` from being
 * matched inside `restart` or `start,stop`.
 */
function assertReportsInvalidAction(
    error: unknown,
    badValue: string,
    allowedActions: ReadonlyArray<RunnerLifecycleAction>
): void {
    assert.ok(
        error instanceof Error,
        `expected an Error reporting the invalid action, received ${describeError(error)}`
    );

    const badValuePattern = new RegExp(String.raw`\b${Core.escapeRegExp(badValue)}\b`, "u");
    assert.match(
        error.message,
        badValuePattern,
        `expected the error message to name the bad input "${badValue}", received: ${error.message}`
    );

    for (const allowedAction of allowedActions) {
        const allowedPattern = new RegExp(String.raw`\b${Core.escapeRegExp(allowedAction)}\b`, "u");
        assert.match(
            error.message,
            allowedPattern,
            `expected the error message to list "${allowedAction}" as an allowed action, received: ${error.message}`
        );
    }
}

void describe("RUNNER_LIFECYCLE_ACTIONS constants", () => {
    void it("is a frozen object so consumers cannot mutate the shared defaults", () => {
        assert.ok(Object.isFrozen(RUNNER_LIFECYCLE_ACTIONS));
    });

    void it("only exposes non-empty string values", () => {
        for (const value of ALLOWED_LIFECYCLE_ACTIONS) {
            assert.equal(typeof value, "string");
            assert.ok(value.length > 0);
        }
    });

    void it("enumerates every canonical action exactly once", () => {
        assert.equal(new Set(ALLOWED_LIFECYCLE_ACTIONS).size, ALLOWED_LIFECYCLE_ACTIONS.length);
    });
});

void describe("coerceRunnerLifecycleAction", () => {
    void it("returns the canonical string for every allowed value", () => {
        for (const value of ALLOWED_LIFECYCLE_ACTIONS) {
            assert.equal(coerceRunnerLifecycleAction(value), value);
        }
    });

    void it("trims surrounding whitespace before validating", () => {
        assert.equal(coerceRunnerLifecycleAction("  start  "), RUNNER_LIFECYCLE_ACTIONS.start);
        assert.equal(coerceRunnerLifecycleAction("\tstop\n"), RUNNER_LIFECYCLE_ACTIONS.stop);
        assert.equal(coerceRunnerLifecycleAction(" resume "), RUNNER_LIFECYCLE_ACTIONS.resume);
    });

    void it("rejects unknown string values with an Error that names the bad input and the allowed set", () => {
        const candidates: ReadonlyArray<string> = [
            "launch",
            "halt",
            "START",
            "Stop",
            "reboot",
            "start,stop",
            "start stop"
        ];

        for (const candidate of candidates) {
            assert.throws(
                () => coerceRunnerLifecycleAction(candidate),
                (error: unknown) => {
                    assert.ok(
                        !(error instanceof TypeError),
                        `unknown string input should throw a generic Error, not a TypeError (got ${describeError(error)})`
                    );
                    assertReportsInvalidAction(error, candidate, ALLOWED_LIFECYCLE_ACTIONS);
                    return true;
                }
            );
        }
    });

    void it("rejects empty and whitespace-only strings with a generic Error (not a TypeError)", () => {
        const candidates: ReadonlyArray<string> = ["", "   ", "\t\n"];

        for (const candidate of candidates) {
            assert.throws(
                () => coerceRunnerLifecycleAction(candidate),
                (error: unknown) => {
                    assert.ok(
                        error instanceof Error && !(error instanceof TypeError),
                        `expected a non-TypeError Error for ${JSON.stringify(candidate)}, received ${describeError(error)}`
                    );
                    return true;
                }
            );
        }
    });

    void it("rejects non-string inputs with a TypeError", () => {
        const nonStrings: ReadonlyArray<unknown> = [null, undefined, 0, 1, true, false, [], {}, Symbol("start")];

        for (const value of nonStrings) {
            assert.throws(
                () => coerceRunnerLifecycleAction(value),
                (error: unknown) => {
                    assert.ok(
                        error instanceof TypeError,
                        `expected a TypeError for ${describeError(value)}, received ${describeError(error)}`
                    );
                    return true;
                }
            );
        }
    });
});

void describe("wrapInvalidArgumentResolver(coerceRunnerLifecycleAction)", () => {
    void it("wraps unknown-action errors in an InvalidArgumentError that still names the bad input and allowed actions", () => {
        const parser = wrapInvalidArgumentResolver(coerceRunnerLifecycleAction);

        assert.throws(
            () => parser("launch"),
            (error: unknown) => {
                assert.ok(
                    error instanceof InvalidArgumentError,
                    `expected an InvalidArgumentError, received ${describeError(error)}`
                );
                assertReportsInvalidAction(error, "launch", ALLOWED_LIFECYCLE_ACTIONS);
                return true;
            }
        );
    });

    void it("wraps non-string input errors in an InvalidArgumentError wrapping the original TypeError", () => {
        const parser = wrapInvalidArgumentResolver(coerceRunnerLifecycleAction);

        assert.throws(
            () => parser(null),
            (error: unknown) => {
                assert.ok(
                    error instanceof InvalidArgumentError,
                    `expected an InvalidArgumentError, received ${describeError(error)}`
                );
                return true;
            }
        );
    });

    void it("passes every allowed value through unchanged", () => {
        const parser = wrapInvalidArgumentResolver(coerceRunnerLifecycleAction);

        for (const value of ALLOWED_LIFECYCLE_ACTIONS) {
            assert.equal(parser(value), value);
        }
    });
});

void describe("Commander argument using coerceRunnerLifecycleAction", () => {
    void it("surfaces the bad value and the allowed actions as a commander.invalidArgument error", () => {
        const command = new Command()
            .exitOverride()
            .addArgument(
                new Argument("<action>", "Lifecycle action to perform.")
                    .choices([...ALLOWED_LIFECYCLE_ACTIONS])
                    .argParser(wrapInvalidArgumentResolver(coerceRunnerLifecycleAction))
            )
            .action(() => {});

        assert.throws(
            () => command.parse(["launch"], { from: "user" }),
            (error: unknown) => {
                if (!(error instanceof Error)) {
                    return false;
                }

                const commanderError = error as Error & { code?: string };
                assert.equal(
                    commanderError.code,
                    "commander.invalidArgument",
                    `expected a commander.invalidArgument error, received: ${commanderError.code ?? "<no code>"}`
                );

                assertReportsInvalidAction(commanderError, "launch", ALLOWED_LIFECYCLE_ACTIONS);
                return true;
            }
        );
    });
});

void describe("runner lifecycle CLI", () => {
    void it("documents every allowed action in --help", async () => {
        const { stdout } = await runCliTestCommand({ argv: ["runner", "lifecycle", "--help"] });

        assert.match(stdout, /<action>/u);
        for (const action of ALLOWED_LIFECYCLE_ACTIONS) {
            assert.ok(stdout.includes(action), `expected --help output to mention "${action}"`);
        }
    });

    void it("rejects an unknown action with a non-zero exit and an actionable error message", async () => {
        const result = await runCliTestCommand({
            argv: ["runner", "lifecycle", "launch", "--project", "/tmp/non-existent-project-12345"]
        });

        assert.notEqual(result.exitCode, 0);
        const combinedOutput = `${result.stderr}\n${result.stdout}`;
        const badValuePattern = new RegExp(String.raw`\b${Core.escapeRegExp("launch")}\b`, "u");
        assert.match(combinedOutput, badValuePattern);

        for (const allowedAction of ALLOWED_LIFECYCLE_ACTIONS) {
            const allowedPattern = new RegExp(String.raw`\b${Core.escapeRegExp(allowedAction)}\b`, "u");
            assert.match(
                combinedOutput,
                allowedPattern,
                `expected CLI error to list "${allowedAction}" as an allowed action, received: ${combinedOutput}`
            );
        }
    });

    void it("rejects an empty action with a non-zero exit and an actionable error message", async () => {
        const result = await runCliTestCommand({
            argv: ["runner", "lifecycle", "", "--project", "/tmp/non-existent-project-12345"]
        });

        assert.notEqual(result.exitCode, 0);
        assert.match(`${result.stderr}\n${result.stdout}`, /lifecycle action/u);
    });
});
