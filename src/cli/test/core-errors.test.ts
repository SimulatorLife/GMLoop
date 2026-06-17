import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import {
    CliUsageError,
    createCliCommandErrorHandler,
    createCliErrorDetails,
    formatCliError,
    handleCliError,
    markAsCliUsageError
} from "../src/cli-core/errors.js";

void describe("cli error formatting", () => {
    void it("omits stack traces and prefixes for usage errors", () => {
        const error = new CliUsageError("Missing project path");

        const output = formatCliError(error);

        assert.equal(output, "Missing project path");
    });

    void it("recognizes branded usage errors even if renamed", () => {
        const error = new CliUsageError("Missing project path");
        error.name = "OtherCliError";

        const output = formatCliError(error);

        assert.equal(output, "Missing project path");
    });

    void it("brands external error-like values", () => {
        const error = markAsCliUsageError({ message: "Missing project path" });

        const output = formatCliError(error);

        assert.equal(output, "Missing project path");
    });

    void it("logs usage guidance without redundant prefixes", () => {
        const error = new CliUsageError("Missing project path", {
            usage: "Usage: prettier-wrapper [options] <path>"
        });
        const { logged, exitCodes } = captureConsoleAndExit(() => {
            handleCliError(error, { prefix: "Failed." });
        });

        assert.deepEqual(logged, ["Missing project path\n\nUsage: prettier-wrapper [options] <path>"]);
        assert.deepEqual(exitCodes, [1]);
    });

    void it("includes prefixes for non-usage errors", () => {
        const error = new Error("Something exploded");
        const { logged, exitCodes } = captureConsoleAndExit(() => {
            handleCliError(error, { prefix: "Failed." });
        });

        assert.equal(exitCodes.length, 1);
        assert.equal(exitCodes[0], 1);
        assert.equal(logged.length, 1);
        assert.ok(logged[0].startsWith("Failed.\nError: Something exploded"));
        assert.deepEqual(exitCodes, [1]);
    });
});

void describe("cli error details", () => {
    void it("normalizes message, name, code, and stack", () => {
        const error: Error & { code?: string } = new Error("kaboom");
        error.code = "ENOENT";

        const details = createCliErrorDetails(error);

        assert.equal(details.message, "kaboom");
        assert.equal(details.name, "Error");
        assert.equal(details.code, "ENOENT");
        assert.ok(Array.isArray(details.stack));
        assert.ok(details.stack.length > 0);
    });

    void it("uses fallback metadata for non-error values", () => {
        const details = createCliErrorDetails(undefined, {
            fallbackMessage: "Something went wrong"
        });

        assert.equal(details.message, "Something went wrong");
        assert.equal(details.name, "Error");
        assert.equal(details.code, undefined);
        assert.equal(details.stack, undefined);
    });

    void it("derives the error name from the @@toStringTag when missing", () => {
        const tagError = {
            message: "boom",
            [Symbol.toStringTag]: "DOMException"
        };

        const details = createCliErrorDetails(tagError);

        assert.equal(details.name, "DOMException");
    });
});

function captureConsoleAndExit(run) {
    const logged: string[] = [];
    const exitCodes: number[] = [];
    const restoreConsole = mock.method(console, "error", (...args) => {
        logged.push(args.join(" "));
    });
    const restoreExit = mock.method(process, "exit", (code) => {
        exitCodes.push(code);
    });

    try {
        run();
    } finally {
        restoreConsole.mock.restore();
        restoreExit.mock.restore();
    }

    return { logged, exitCodes };
}

void describe("createCliCommandErrorHandler", () => {
    void it("delegates non-usage errors to handleCliError with the configured prefix", () => {
        const { logged, exitCodes } = captureConsoleAndExit(() => {
            const handler = createCliCommandErrorHandler({ prefix: "Lint command failed.", exitCode: 2 });
            handler(new Error("kaboom"));
        });

        assert.equal(logged.length, 1);
        assert.ok(logged[0].startsWith("Lint command failed.\nError: kaboom"));
        assert.deepEqual(exitCodes, [2]);
    });

    void it("defaults the exit code to 1 when no options are provided", () => {
        const { logged, exitCodes } = captureConsoleAndExit(() => {
            const handler = createCliCommandErrorHandler();
            handler(new Error("kaboom"));
        });

        assert.equal(logged.length, 1);
        assert.ok(logged[0].startsWith("Error: kaboom"));
        assert.deepEqual(exitCodes, [1]);
    });

    void it("omits the prefix for branded usage errors", () => {
        const usageError = new CliUsageError("Missing path");
        const { logged, exitCodes } = captureConsoleAndExit(() => {
            const handler = createCliCommandErrorHandler({ prefix: "Should not appear." });
            handler(usageError);
        });

        assert.deepEqual(logged, ["Missing path"]);
        assert.deepEqual(exitCodes, [1]);
    });

    void it("ignores the command context passed by the registry", () => {
        const { logged, exitCodes } = captureConsoleAndExit(() => {
            // The registry invokes handlers with an extra context object; the
            // helper must accept (and ignore) it without throwing at runtime.
            const handler: (error: unknown, context?: unknown) => never = createCliCommandErrorHandler({
                prefix: "Test command failed."
            });
            handler(new Error("oops"), { command: { name: () => "test" } });
        });

        assert.equal(logged.length, 1);
        assert.ok(logged[0].startsWith("Test command failed."));
        assert.deepEqual(exitCodes, [1]);
    });
});
