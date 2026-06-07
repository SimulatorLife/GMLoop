import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyEnvOptionOverride, applyEnvOptionOverrides } from "../src/cli-core/env-overrides.js";
import { isCliUsageError } from "../src/cli-core/errors.js";

void describe("applyEnvOptionOverride", () => {
    void it("sets the option when the environment variable is defined", () => {
        const calls = [];
        const command = {
            setOptionValueWithSource(...args) {
                calls.push(args);
            }
        };

        applyEnvOptionOverride({
            command,
            env: { TEST_VALUE: "value" },
            envVar: "TEST_VALUE",
            optionName: "testOption"
        });

        assert.deepEqual(calls, [["testOption", "value", "env"]]);
    });

    void it("ignores undefined environment variables", () => {
        const command = {
            setOptionValueWithSource() {
                throw new Error("should not be called");
            }
        };

        applyEnvOptionOverride({
            command,
            env: {},
            envVar: "MISSING",
            optionName: "testOption"
        });
    });

    void it("ignores overrides when the command cannot accept option values", () => {
        assert.doesNotThrow(() =>
            applyEnvOptionOverride({
                command: null,
                env: { TEST_VALUE: "value" },
                envVar: "TEST_VALUE",
                optionName: "testOption"
            })
        );

        const command = {};
        assert.doesNotThrow(() =>
            applyEnvOptionOverride({
                command,
                env: { TEST_VALUE: "value" },
                envVar: "TEST_VALUE",
                optionName: "testOption"
            })
        );
    });

    void it("wraps resolver failures in a CliUsageError and preserves usage", () => {
        const command = {
            setOptionValueWithSource() {
                throw new Error("should not be called");
            }
        };

        assert.throws(
            () =>
                applyEnvOptionOverride({
                    command,
                    env: { TEST_VALUE: "value" },
                    envVar: "TEST_VALUE",
                    optionName: "testOption",
                    resolveValue() {
                        throw new Error("bad value");
                    },
                    getUsage: () => "usage information"
                }),
            (error) => {
                assert.ok(isCliUsageError(error));
                assert.equal(error.message, "bad value");
                assert.equal(error.usage, "usage information");
                return true;
            }
        );
    });

    void it("provides a fallback error message when the resolver throws without one", () => {
        const command = {
            setOptionValueWithSource() {
                throw new Error("should not be called");
            }
        };

        assert.throws(
            () =>
                applyEnvOptionOverride({
                    command,
                    env: { TEST_VALUE: "value" },
                    envVar: "TEST_VALUE",
                    optionName: "testOption",
                    resolveValue() {
                        throw new Error("Error when resolving");
                    }
                }),
            (error) => {
                assert.ok(isCliUsageError(error));
                assert.equal(error.message, "Invalid value provided for TEST_VALUE.");
                return true;
            }
        );
    });

    void it("preserves resolver failures that mimic Error objects", () => {
        const command = {
            setOptionValueWithSource() {
                throw new Error("should not be called");
            }
        };

        const failure = Object.assign(new Error("custom failure"), {
            name: "ResolverFailure"
        });

        assert.throws(
            () =>
                applyEnvOptionOverride({
                    command,
                    env: { TEST_VALUE: "value" },
                    envVar: "TEST_VALUE",
                    optionName: "testOption",
                    resolveValue() {
                        throw failure;
                    }
                }),
            (error) => {
                assert.ok(isCliUsageError(error));
                assert.equal(error.message, "custom failure");
                assert.equal(error.cause, failure);
                return true;
            }
        );
    });
});

void describe("applyEnvOptionOverrides", () => {
    void it("applies each override when the environment variables are defined", () => {
        const calls = [];
        const command = {
            setOptionValueWithSource(...args) {
                calls.push(args);
            }
        };

        applyEnvOptionOverrides({
            command,
            env: {
                FIRST: "value",
                SECOND: "42"
            },
            overrides: [
                { envVar: "FIRST", optionName: "firstOption" },
                {
                    envVar: "SECOND",
                    optionName: "secondOption",
                    resolveValue(value) {
                        return Number.parseInt(value, 10);
                    }
                }
            ]
        });

        assert.deepEqual(calls, [
            ["firstOption", "value", "env"],
            ["secondOption", 42, "env"]
        ]);
    });

    void it("respects a shared getUsage fallback", () => {
        const command = {
            setOptionValueWithSource() {
                throw new Error("should not be called");
            }
        };

        assert.throws(
            () =>
                applyEnvOptionOverrides({
                    command,
                    env: { BAD: "value" },
                    overrides: [
                        {
                            envVar: "BAD",
                            optionName: "badOption",
                            resolveValue() {
                                throw new Error("not allowed");
                            }
                        }
                    ],
                    getUsage: () => "usage info"
                }),
            (error) => {
                assert.ok(isCliUsageError(error));
                assert.equal(error.message, "not allowed");
                assert.equal(error.usage, "usage info");
                return true;
            }
        );
    });

    void it("prefers override-level getUsage when provided", () => {
        const command = {
            setOptionValueWithSource() {
                throw new Error("should not be called");
            }
        };

        assert.throws(
            () =>
                applyEnvOptionOverrides({
                    command,
                    env: { BAD: "value" },
                    overrides: [
                        {
                            envVar: "BAD",
                            optionName: "badOption",
                            resolveValue() {
                                throw new Error("not allowed");
                            },
                            getUsage: () => "override usage"
                        }
                    ],
                    getUsage: () => "shared usage"
                }),
            (error) => {
                assert.ok(isCliUsageError(error));
                assert.equal(error.message, "not allowed");
                assert.equal(error.usage, "override usage");
                return true;
            }
        );
    });
});
