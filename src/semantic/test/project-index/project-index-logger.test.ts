import assert from "node:assert/strict";
import test from "node:test";

import {
    logProjectIndexDebug,
    logProjectIndexDebugError,
    type ProjectIndexLogger
} from "../../src/project-index/project-index-logger.js";

void test("logProjectIndexDebug emits via log when available", () => {
    const logs: Array<unknown> = [];
    const logger: ProjectIndexLogger = {
        log: (...args) => logs.push(args),
        debug: () => {},
        error: () => {}
    };

    logProjectIndexDebug(logger, "hello", "world");
    assert.deepEqual(logs, [["hello", "world"]]);
});

void test("logProjectIndexDebug falls back to debug when log is missing", () => {
    const logs: Array<unknown> = [];
    const logger: ProjectIndexLogger = {
        debug: (...args) => logs.push(args)
    };

    logProjectIndexDebug(logger, "debug message");
    assert.deepEqual(logs, [["debug message"]]);
});

void test("logProjectIndexDebug preserves logger method context", () => {
    const logger: ProjectIndexLogger & {
        readonly prefix: string;
        calls: Array<string>;
    } = {
        prefix: "[semantic]",
        calls: [],
        log(this: { prefix: string; calls: Array<string> }, message?: string) {
            this.calls.push(`${this.prefix} ${message ?? ""}`.trim());
        }
    };

    logProjectIndexDebug(logger, "indexing");
    assert.deepEqual(logger.calls, ["[semantic] indexing"]);
});

void test("logProjectIndexDebug does nothing when no emitter is available", () => {
    logProjectIndexDebug(null, "should not appear");
    logProjectIndexDebug(undefined, "should not appear");
    logProjectIndexDebug({}, "should not appear");
});

void test("logProjectIndexDebugError emits via error when available", () => {
    const logs: Array<unknown> = [];
    const logger: ProjectIndexLogger = {
        log: () => {},
        debug: () => {},
        error: (...args) => logs.push(args)
    };

    logProjectIndexDebugError(logger, "Stat failed", new Error("ENOENT: no such file"));
    assert.deepEqual(logs, [["Stat failed: ENOENT: no such file"]]);
});

void test("logProjectIndexDebugError falls back to log when error is missing", () => {
    const logs: Array<unknown> = [];
    const logger: ProjectIndexLogger = {
        log: (...args) => logs.push(args),
        debug: () => {}
    };

    logProjectIndexDebugError(logger, "Stat failed", new Error("ENOENT: no such file"));
    assert.deepEqual(logs, [["Stat failed: ENOENT: no such file"]]);
});

void test("logProjectIndexDebugError falls back to debug when error and log are missing", () => {
    const logs: Array<unknown> = [];
    const logger: ProjectIndexLogger = {
        debug: (...args) => logs.push(args)
    };

    logProjectIndexDebugError(logger, "Stat failed", new Error("ENOENT: no such file"));
    assert.deepEqual(logs, [["Stat failed: ENOENT: no such file"]]);
});

void test("logProjectIndexDebugError does nothing when no emitter is available", () => {
    logProjectIndexDebugError(null, "should not appear", new Error("test"));
    logProjectIndexDebugError(undefined, "should not appear", new Error("test"));
    logProjectIndexDebugError({}, "should not appear", new Error("test"));
});

void test("logProjectIndexDebugError omits suffix when error has no message", () => {
    const logs: Array<unknown> = [];
    const logger: ProjectIndexLogger = {
        log: (...args) => logs.push(args)
    };

    logProjectIndexDebugError(logger, "Stat failed", {});
    assert.deepEqual(logs, [["Stat failed"]]);
});

void test("logProjectIndexDebugError handles string errors", () => {
    const logs: Array<unknown> = [];
    const logger: ProjectIndexLogger = {
        log: (...args) => logs.push(args)
    };

    logProjectIndexDebugError(logger, "Stat failed", "ENOENT: no such file");
    assert.deepEqual(logs, [["Stat failed: ENOENT: no such file"]]);
});

void test("logProjectIndexDebugError handles null/undefined errors gracefully", () => {
    const logs: Array<unknown> = [];
    const logger: ProjectIndexLogger = {
        log: (...args) => logs.push(args)
    };

    logProjectIndexDebugError(logger, "Stat failed", null);
    logProjectIndexDebugError(logger, "Stat failed", undefined);
    assert.deepEqual(logs, [["Stat failed"], ["Stat failed"]]);
});
