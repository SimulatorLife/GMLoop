import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import {
    renderProgressBar,
    resetProgressBarRegistryForTesting,
    withProgressBarCleanup
} from "../src/shared/progress-bar.js";

function createMockStdout() {
    return {
        isTTY: true,
        clearLine: () => {},
        clearScreenDown: () => {},
        cursorTo: () => {},
        moveCursor: () => {},
        cursor: () => {},
        cursorSave: () => {},
        cursorRestore: () => {},
        lineWrapping: () => {},
        on: () => {},
        removeListener: () => {},
        write: () => {}
    };
}

void describe("progress bar cleanup", () => {
    afterEach(() => {
        mock.restoreAll();
        resetProgressBarRegistryForTesting();
    });

    void it("disposes active progress bars when callbacks fail", async (t) => {
        const stdout = createMockStdout();
        const stopMock = mock.fn();
        const createBar = mock.fn(() => ({
            setTotal: () => {},
            update: () => {},
            start: () => {},
            stop: (...args) => {
                stopMock(...args);
            }
        }));

        await assert.rejects(
            withProgressBarCleanup(async () => {
                const label = `${t.name} progress bar`;

                renderProgressBar(label, 0, 2, 10, {
                    stdout,
                    createBar
                });
                throw new Error("boom");
            }),
            /boom/
        );

        assert.equal(stopMock.mock.callCount(), 1);
    });
});
