import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { emitJsonErrorAndExit } from "../src/shared/json-error-payload.js";

void describe("emitJsonErrorAndExit", () => {
    void it("writes the canonical JSON envelope to stdout, echoes the message to stderr, and exits with code 1", () => {
        const { stdoutLines, stderrLines, exitCodes } = captureStdoutStderrAndExit(() => {
            emitJsonErrorAndExit({
                command: "live-reload wait-for-patch",
                code: "connection_failed",
                error: "Failed to connect to the active live-reload status server."
            });
        });

        assert.equal(stdoutLines.length, 1);
        const envelope = JSON.parse(stdoutLines[0]) as Record<string, unknown>;
        assert.equal(envelope.command, "live-reload wait-for-patch");
        assert.equal(envelope.ok, false);
        assert.equal(envelope.code, "connection_failed");
        assert.equal(envelope.error, "Failed to connect to the active live-reload status server.");

        assert.deepEqual(stderrLines, ["Failed to connect to the active live-reload status server."]);
        assert.deepEqual(exitCodes, [1]);
    });

    void it("honours an explicit exit code override", () => {
        const { stdoutLines, stderrLines, exitCodes } = captureStdoutStderrAndExit(() => {
            emitJsonErrorAndExit({
                command: "symbol inspect",
                code: "unresolved",
                error: "Symbol not found.",
                exitCode: 7
            });
        });

        assert.deepEqual(exitCodes, [7]);
        const envelope = JSON.parse(stdoutLines[0]) as Record<string, unknown>;
        assert.equal(envelope.command, "symbol inspect");
        assert.equal(envelope.code, "unresolved");
        assert.equal(envelope.error, "Symbol not found.");
        assert.deepEqual(stderrLines, ["Symbol not found."]);
    });

    void it("merges extra fields into the JSON envelope without disturbing the canonical keys", () => {
        const { stdoutLines, exitCodes } = captureStdoutStderrAndExit(() => {
            emitJsonErrorAndExit({
                command: "symbol inspect",
                code: "ambiguous",
                error: "Ambiguous query.",
                extras: {
                    candidates: [
                        { id: "n1", kind: "script", name: "demo" },
                        { id: "n2", kind: "object", name: "demo" }
                    ]
                }
            });
        });

        const envelope = JSON.parse(stdoutLines[0]) as Record<string, unknown>;
        assert.equal(envelope.command, "symbol inspect");
        assert.equal(envelope.ok, false);
        assert.equal(envelope.code, "ambiguous");
        assert.equal(envelope.error, "Ambiguous query.");
        assert.deepEqual(envelope.candidates, [
            { id: "n1", kind: "script", name: "demo" },
            { id: "n2", kind: "object", name: "demo" }
        ]);
        assert.deepEqual(exitCodes, [1]);
    });
});

interface CapturedStdoutStderrAndExit {
    readonly stdoutLines: ReadonlyArray<string>;
    readonly stderrLines: ReadonlyArray<string>;
    readonly exitCodes: ReadonlyArray<number | undefined>;
}

function captureStdoutStderrAndExit(run: () => void): CapturedStdoutStderrAndExit {
    const stdoutLines: Array<string> = [];
    const stderrLines: Array<string> = [];
    const exitCodes: Array<number | undefined> = [];

    const restoreStdout = mock.method(console, "log", (...args) => {
        stdoutLines.push(args.join(" "));
    });
    const restoreStderr = mock.method(console, "error", (...args) => {
        stderrLines.push(args.join(" "));
    });
    const restoreExit = mock.method(process, "exit", (code?: number) => {
        exitCodes.push(code);
    });

    try {
        run();
    } finally {
        restoreStdout.mock.restore();
        restoreStderr.mock.restore();
        restoreExit.mock.restore();
    }

    return { stdoutLines, stderrLines, exitCodes };
}
