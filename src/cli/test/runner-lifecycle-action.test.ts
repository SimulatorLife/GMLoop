import assert from "node:assert/strict";
import { test } from "node:test";

import { Argument, Command, InvalidArgumentError } from "commander";

import { runCliTestCommand } from "../src/cli.js";
import { wrapInvalidArgumentResolver } from "../src/cli-core/command-parsing.js";
import {
    coerceRunnerLifecycleAction,
    RUNNER_LIFECYCLE_ACTIONS,
    type RunnerLifecycleAction
} from "../src/modules/runtime/lifecycle.js";

function describeError(error: unknown): string {
    if (error instanceof Error) {
        return `${error.name}: ${error.message}`;
    }

    if (typeof error === "string") {
        return error;
    }

    if (error === null) {
        return "null";
    }

    if (error === undefined) {
        return "undefined";
    }

    return Object.getPrototypeOf(error)?.constructor?.name ?? typeof error;
}

void test("RUNNER_LIFECYCLE_ACTIONS is frozen and contains the canonical values", () => {
    assert.ok(Object.isFrozen(RUNNER_LIFECYCLE_ACTIONS));
    assert.equal(RUNNER_LIFECYCLE_ACTIONS.start, "start");
    assert.equal(RUNNER_LIFECYCLE_ACTIONS.stop, "stop");
    assert.equal(RUNNER_LIFECYCLE_ACTIONS.restart, "restart");
    assert.equal(RUNNER_LIFECYCLE_ACTIONS.pause, "pause");
    assert.equal(RUNNER_LIFECYCLE_ACTIONS.resume, "resume");
});

void test("coerceRunnerLifecycleAction returns the canonical string for every valid value", () => {
    const valid: ReadonlyArray<RunnerLifecycleAction> = [
        RUNNER_LIFECYCLE_ACTIONS.start,
        RUNNER_LIFECYCLE_ACTIONS.stop,
        RUNNER_LIFECYCLE_ACTIONS.restart,
        RUNNER_LIFECYCLE_ACTIONS.pause,
        RUNNER_LIFECYCLE_ACTIONS.resume
    ];

    for (const value of valid) {
        assert.equal(coerceRunnerLifecycleAction(value), value);
    }
});

void test("coerceRunnerLifecycleAction trims surrounding whitespace", () => {
    assert.equal(coerceRunnerLifecycleAction("  start  "), RUNNER_LIFECYCLE_ACTIONS.start);
    assert.equal(coerceRunnerLifecycleAction("\tstop\n"), RUNNER_LIFECYCLE_ACTIONS.stop);
    assert.equal(coerceRunnerLifecycleAction(" resume "), RUNNER_LIFECYCLE_ACTIONS.resume);
});

void test("coerceRunnerLifecycleAction rejects unknown string values with a descriptive message", () => {
    const candidates: ReadonlyArray<string> = ["launch", "halt", "START", "Stop", "reboot", "start,stop", "start stop"];

    for (const candidate of candidates) {
        assert.throws(
            () => coerceRunnerLifecycleAction(candidate),
            (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.match(
                    error.message,
                    new RegExp(
                        String.raw`Invalid lifecycle action: "${candidate}".*Allowed values: start, stop, restart, pause, resume\.`
                    )
                );
                return true;
            }
        );
    }
});

void test("coerceRunnerLifecycleAction rejects empty and whitespace-only strings", () => {
    assert.throws(() => coerceRunnerLifecycleAction(""), /Invalid lifecycle action/u);
    assert.throws(() => coerceRunnerLifecycleAction("   "), /Invalid lifecycle action/u);
    assert.throws(() => coerceRunnerLifecycleAction("\t\n"), /Invalid lifecycle action/u);
});

void test("coerceRunnerLifecycleAction rejects non-string inputs with a TypeError", () => {
    const nonStrings: ReadonlyArray<unknown> = [null, undefined, 0, 1, true, false, [], {}, Symbol("start")];

    for (const value of nonStrings) {
        assert.throws(
            () => coerceRunnerLifecycleAction(value),
            (error: unknown) => {
                assert.ok(error instanceof TypeError, `expected TypeError, received ${describeError(error)}`);
                assert.match(error.message, /expected a string/u);
                return true;
            }
        );
    }
});

void test("wrapInvalidArgumentResolver converts coerceRunnerLifecycleAction errors to InvalidArgumentError", () => {
    const parser = wrapInvalidArgumentResolver(coerceRunnerLifecycleAction);

    assert.throws(
        () => parser("launch"),
        (error: unknown) => error instanceof InvalidArgumentError && /launch/u.test(error.message)
    );
    assert.throws(
        () => parser(null),
        (error: unknown) => error instanceof InvalidArgumentError && /expected a string/u.test(error.message)
    );
});

void test("wrapped parser still accepts the canonical values", () => {
    const parser = wrapInvalidArgumentResolver(coerceRunnerLifecycleAction);

    for (const value of Object.values(RUNNER_LIFECYCLE_ACTIONS)) {
        assert.equal(parser(value), value);
    }
});

void test("a Commander argument using the validator reports both the bad value and the allowed set", () => {
    const command = new Command()
        .exitOverride()
        .addArgument(
            new Argument("<action>", "Lifecycle action to perform.")
                .choices(Object.values(RUNNER_LIFECYCLE_ACTIONS))
                .argParser(wrapInvalidArgumentResolver(coerceRunnerLifecycleAction))
        )
        .action(() => {});

    assert.throws(
        () => command.parse(["launch"], { from: "user" }),
        (error: unknown) => {
            if (!(error instanceof Error)) {
                return false;
            }
            // Commander wraps InvalidArgumentError into a CommanderError with code
            // `commander.invalidArgument`. Check the code instead of the constructor
            // identity so the assertion reflects the public contract.
            const commanderError = error as Error & { code?: string };
            return (
                commanderError.code === "commander.invalidArgument" &&
                /launch/u.test(commanderError.message) &&
                /start, stop, restart, pause, resume/u.test(commanderError.message)
            );
        }
    );
});

void test("runner lifecycle --help documents the lifecycle actions", async () => {
    const { stdout } = await runCliTestCommand({ argv: ["runner", "lifecycle", "--help"] });

    assert.match(stdout, /<action>/u);
    // The frozen RUNNER_LIFECYCLE_ACTIONS keys should all appear in the usage line.
    for (const action of Object.values(RUNNER_LIFECYCLE_ACTIONS)) {
        assert.ok(stdout.includes(action), `expected --help output to mention "${action}"`);
    }
});

void test("runner lifecycle rejects an unknown action with a descriptive error", async () => {
    const result = await runCliTestCommand({
        argv: ["runner", "lifecycle", "launch", "--project", "/tmp/non-existent-project-12345"]
    });

    assert.notEqual(result.exitCode, 0);
    assert.match(
        result.stderr + result.stdout,
        /Invalid lifecycle action: "launch"\. Allowed values: start, stop, restart, pause, resume\./u
    );
});

void test("runner lifecycle rejects an empty action with a descriptive error", async () => {
    const result = await runCliTestCommand({
        argv: ["runner", "lifecycle", "", "--project", "/tmp/non-existent-project-12345"]
    });

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr + result.stdout, /Invalid lifecycle action/u);
});
