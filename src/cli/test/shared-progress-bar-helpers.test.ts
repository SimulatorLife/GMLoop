import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import {
    disposeProgressBars,
    type ProgressBarLike,
    renderProgressBar,
    resetProgressBarRegistryForTesting
} from "../src/shared/progress-bar.js";

const ESCAPE_PREFIX = String.fromCharCode(0x1b);
const ANSI_ESCAPE_SEQUENCE_PATTERN = new RegExp(String.raw`${ESCAPE_PREFIX}\[[0-9;?]*[A-Za-z]`, "g");

function createMockStdout() {
    const noopListener = () => {};

    return {
        isTTY: true,
        columns: 80,
        clearLine: () => {},
        clearScreenDown: () => {},
        cursor: () => {},
        cursorSave: () => {},
        cursorRestore: () => {},
        cursorTo: () => {},
        moveCursor: () => {},
        lineWrapping: () => {},
        on: noopListener,
        removeListener: noopListener,
        write: (...args: any[]) => {
            void args;
        }
    };
}

void describe("manual CLI helpers", () => {
    afterEach(() => {
        mock.restoreAll();
        resetProgressBarRegistryForTesting();
    });

    void it("renders progress output with the default progress bar", () => {
        const stdout = createMockStdout();
        const writes = [];
        stdout.write = (chunk) => {
            writes.push(chunk);
        };

        renderProgressBar("Task", 0, 3, 5, {
            stdout
        });
        renderProgressBar("Task", 1, 3, 5, {
            stdout
        });
        renderProgressBar("Task", 3, 3, 5, {
            stdout
        });

        const sanitized = writes.join("").replaceAll(ANSI_ESCAPE_SEQUENCE_PATTERN, "").replaceAll("\r", "\n");

        assert.match(sanitized, /Task \[[^\]]*\] 0\/3/);
        assert.match(sanitized, /Task \[[^\]]*\] 1\/3/);
        assert.match(sanitized, /Task \[[^\]]*\] 3\/3/);
    });

    void it("throws when createBar is not a function", () => {
        const stdout = createMockStdout();

        assert.throws(() => {
            renderProgressBar("Task", 0, 1, 5, {
                stdout,
                createBar: 42 as unknown as () => never
            });
        }, /createBar must be a function/);
    });

    void it("creates a custom progress bar once per label", () => {
        const stdout = createMockStdout();
        const bar: ProgressBarLike = {
            setTotal: () => {},
            update: () => {},
            start: () => {},
            stop: () => {}
        };
        const createBar = mock.fn(() => bar);

        renderProgressBar("Task", 0, 5, 10, { stdout, createBar });
        renderProgressBar("Task", 1, 5, 10, { stdout, createBar });

        assert.equal(createBar.mock.callCount(), 1);
        assert.deepEqual(createBar.mock.calls[0]?.arguments, ["Task", 10, { stream: stdout }]);
    });

    void it("disposes active progress bars", () => {
        const createdBars = new Set();
        const stopCounts = new Map();
        const stdout = createMockStdout();
        const createBar = mock.fn(() => {
            const bar: ProgressBarLike = {
                setTotal: () => {},
                update: () => {},
                start: () => {},
                stop: () => {}
            };

            bar.start = () => {
                createdBars.add(bar);
            };

            bar.stop = () => {
                stopCounts.set(bar, (stopCounts.get(bar) ?? 0) + 1);
            };

            return bar;
        });

        disposeProgressBars();
        renderProgressBar("Task", 1, 4, 10, { stdout, createBar });
        renderProgressBar("Task", 2, 4, 10, { stdout, createBar });

        assert.equal(createdBars.size, 1);
        const [firstBar] = createdBars;
        assert.equal(stopCounts.get(firstBar) ?? 0, 0);

        disposeProgressBars();
        assert.equal(stopCounts.get(firstBar), 1);

        disposeProgressBars();
        assert.equal(stopCounts.get(firstBar), 1);

        renderProgressBar("Task", 3, 4, 10, { stdout, createBar });
        assert.equal(createdBars.size, 2);
    });

    void it("stops active progress bars when rendering becomes unavailable", () => {
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

        renderProgressBar("Task", 0, 5, 10, { stdout, createBar });
        renderProgressBar("Task", 1, 5, 10, { stdout, createBar });

        const nonInteractiveStdout = { ...stdout, isTTY: false };
        renderProgressBar("Task", 2, 5, 10, {
            stdout: nonInteractiveStdout,
            createBar
        });

        assert.equal(stopMock.mock.callCount(), 1);

        const stopCountAfterDisable = stopMock.mock.callCount();

        renderProgressBar("Task", 0, 5, 10, { stdout, createBar });
        renderProgressBar("Task", 5, 5, 10, { stdout, createBar });

        assert.equal(createBar.mock.callCount(), 2);
        assert.equal(stopMock.mock.callCount(), stopCountAfterDisable + 1);
    });
});
