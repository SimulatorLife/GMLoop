import assert from "node:assert/strict";
import { test } from "node:test";

import { Command, InvalidArgumentError, Option } from "commander";

import { runCliTestCommand } from "../src/cli.js";
import { wrapInvalidArgumentResolver } from "../src/cli-core/command-parsing.js";
import {
    coerceRuntimeScope,
    coerceRuntimeScopeWithDefault,
    DEFAULT_RUNTIME_SCOPE,
    RUNTIME_SCOPES,
    type RuntimeScope
} from "../src/modules/runtime/scope.js";
import { withTempProject } from "./shared-temp-project.js";

void test("RUNTIME_SCOPES is frozen and contains the canonical values", () => {
    assert.ok(Object.isFrozen(RUNTIME_SCOPES));
    assert.equal(RUNTIME_SCOPES.global, "global");
    assert.equal(RUNTIME_SCOPES.instance, "instance");
});

void test("DEFAULT_RUNTIME_SCOPE points at the instance value", () => {
    assert.equal(DEFAULT_RUNTIME_SCOPE, "instance");
    assert.equal(DEFAULT_RUNTIME_SCOPE, RUNTIME_SCOPES.instance);
});

void test("coerceRuntimeScope returns the canonical string for valid values", () => {
    const valid: ReadonlyArray<RuntimeScope> = [RUNTIME_SCOPES.global, RUNTIME_SCOPES.instance];

    for (const value of valid) {
        assert.equal(coerceRuntimeScope(value), value);
    }
});

void test("coerceRuntimeScope trims surrounding whitespace", () => {
    assert.equal(coerceRuntimeScope("  global  "), "global");
    assert.equal(coerceRuntimeScope("\tinstance\n"), "instance");
});

void test("coerceRuntimeScope rejects unknown string values with a descriptive message", () => {
    const candidates: ReadonlyArray<string> = ["world", "session", "global,instance", "scope", "all"];

    for (const candidate of candidates) {
        assert.throws(
            () => coerceRuntimeScope(candidate),
            (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.match(
                    error.message,
                    new RegExp(String.raw`Invalid --scope value: "?"${candidate}"?\..*global, instance\.`)
                );
                return true;
            }
        );
    }
});

void test("coerceRuntimeScope rejects empty strings", () => {
    assert.throws(() => coerceRuntimeScope(""), /Invalid --scope value/u);
});

void test("coerceRuntimeScope rejects non-string inputs", () => {
    const nonStrings: ReadonlyArray<unknown> = [null, undefined, 0, 1, true, false, [], {}, Symbol("global")];

    for (const value of nonStrings) {
        assert.throws(
            () => coerceRuntimeScope(value),
            (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.match(error.message, /--scope must be provided as a string/u);
                return true;
            }
        );
    }
});

void test("wrapInvalidArgumentResolver converts coerceRuntimeScope errors to InvalidArgumentError", () => {
    const parser = wrapInvalidArgumentResolver(coerceRuntimeScope);

    assert.throws(
        () => parser("world"),
        (error: unknown) => error instanceof InvalidArgumentError && /world/u.test(error.message)
    );
    assert.throws(
        () => parser(null),
        (error: unknown) =>
            error instanceof InvalidArgumentError && /--scope must be provided as a string/u.test(error.message)
    );
});

void test("wrapped parser still accepts the canonical values", () => {
    const parser = wrapInvalidArgumentResolver(coerceRuntimeScope);

    assert.equal(parser("global"), RUNTIME_SCOPES.global);
    assert.equal(parser("instance"), RUNTIME_SCOPES.instance);
});

void test("coerceRuntimeScopeWithDefault falls back to the default for invalid input", () => {
    assert.equal(coerceRuntimeScopeWithDefault("global"), RUNTIME_SCOPES.global);
    assert.equal(coerceRuntimeScopeWithDefault(undefined), DEFAULT_RUNTIME_SCOPE);
    assert.equal(coerceRuntimeScopeWithDefault("world"), DEFAULT_RUNTIME_SCOPE);
});

void test("a Commander option using the validator reports both the bad value and the allowed set", () => {
    const command = new Command()
        .exitOverride()
        .allowExcessArguments(false)
        .addOption(
            new Option("--scope <scope>", "Scope: instance or global.").argParser(
                wrapInvalidArgumentResolver(coerceRuntimeScope)
            )
        );

    assert.throws(
        () => command.parse(["node", "test", "--scope", "world"], { from: "user" }),
        (error: unknown) => {
            if (!(error instanceof Error)) {
                return false;
            }
            const commanderError = error as Error & { code?: string };
            return (
                commanderError.code === "commander.invalidArgument" &&
                /world/u.test(commanderError.message) &&
                /global, instance/u.test(commanderError.message)
            );
        }
    );
});

void test("runtime set --scope rejects an unknown string with a descriptive error", async () => {
    await withTempProject("runtime-set-scope-invalid", async (projectRoot) => {
        const result = await runCliTestCommand({
            argv: [
                "runtime",
                "set",
                "--project",
                projectRoot,
                "--path",
                "hp",
                "--value",
                "1",
                "--scope",
                "world",
                "--json"
            ]
        });

        assert.notEqual(result.exitCode, 0);
        assert.match(result.stderr + result.stdout, /Invalid --scope value/u);
        assert.match(result.stderr + result.stdout, /global, instance/u);
    });
});

void test("runtime get --scope rejects an unknown string with a descriptive error", async () => {
    await withTempProject("runtime-get-scope-invalid", async (projectRoot) => {
        const result = await runCliTestCommand({
            argv: ["runtime", "get", "--project", projectRoot, "--path", "hp", "--scope", "world", "--json"]
        });

        assert.notEqual(result.exitCode, 0);
        assert.match(result.stderr + result.stdout, /Invalid --scope value/u);
        assert.match(result.stderr + result.stdout, /global, instance/u);
    });
});

void test("runtime set --scope still accepts the canonical 'global' value", async () => {
    await withTempProject("runtime-set-scope-global", async (projectRoot) => {
        const result = await runCliTestCommand({
            argv: [
                "runtime",
                "set",
                "--project",
                projectRoot,
                "--path",
                "hp",
                "--value",
                "42",
                "--scope",
                "global",
                "--json"
            ]
        });

        assert.equal(result.exitCode, 0);
        const payload = JSON.parse(result.stdout) as { payload: { ok: boolean; scope: RuntimeScope; value: number } };
        assert.equal(payload.payload.ok, true);
        assert.equal(payload.payload.scope, RUNTIME_SCOPES.global);
        assert.equal(payload.payload.value, 42);
    });
});

void test("runtime set defaults to the instance scope when --scope is omitted", async () => {
    await withTempProject("runtime-set-scope-default", async (projectRoot) => {
        const result = await runCliTestCommand({
            argv: ["runtime", "set", "--project", projectRoot, "--path", "hp", "--value", "7", "--json"]
        });

        assert.equal(result.exitCode, 0);
        const payload = JSON.parse(result.stdout) as { payload: { ok: boolean; scope: RuntimeScope } };
        assert.equal(payload.payload.ok, true);
        assert.equal(payload.payload.scope, DEFAULT_RUNTIME_SCOPE);
    });
});
