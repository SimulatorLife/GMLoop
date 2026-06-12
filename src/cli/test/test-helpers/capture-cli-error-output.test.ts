import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { captureCliErrorOutput } from "./capture-cli-error-output.js";

void describe("captureCliErrorOutput", () => {
    void it("captures console.error output written by the action", async () => {
        const { logged, exitCodes } = await captureCliErrorOutput(() => {
            console.error("first line");
            console.error("second", "line");
        });

        assert.deepEqual(logged, ["first line", "second line"]);
        assert.deepEqual(exitCodes, []);
    });

    void it("captures the exit code passed to process.exit", async () => {
        const triggerExit = (code: number) => Promise.resolve().then(() => process.exit(code));

        const { logged, exitCodes } = await captureCliErrorOutput(() => {
            console.error("about to exit");
            return assert.rejects(triggerExit(7), /process\.exit called with code 7/u);
        });

        assert.deepEqual(logged, ["about to exit"]);
        assert.deepEqual(exitCodes, [7]);
    });

    void it("records the exit code before throwing the synthetic error", async () => {
        const triggerExit = (code: number) => Promise.resolve().then(() => process.exit(code));

        const { exitCodes } = await captureCliErrorOutput(() => {
            return assert.rejects(triggerExit(2), /process\.exit called with code 2/u);
        });

        assert.deepEqual(exitCodes, [2]);
    });

    void it("restores console.error even when the action throws", async () => {
        const originalError = console.error;
        const expectedError = new Error("action failed");

        await assert.rejects(async () => {
            await captureCliErrorOutput(() => {
                throw expectedError;
            });
        }, /action failed/u);

        assert.equal(console.error, originalError);
    });

    void it("restores process.exit even when the action throws", async () => {
        const originalExit = process.exit;
        const expectedError = new Error("action failed");

        await assert.rejects(async () => {
            await captureCliErrorOutput(() => {
                throw expectedError;
            });
        }, /action failed/u);

        assert.equal(process.exit, originalExit);
    });

    void it("awaits async actions before restoring mocks", async () => {
        const order: string[] = [];
        const originalError = console.error;

        await captureCliErrorOutput(async () => {
            await Promise.resolve();
            order.push("inside");
            console.error("from action");
        });
        order.push("after");

        assert.deepEqual(order, ["inside", "after"]);
        assert.equal(console.error, originalError);
    });
});
