import assert from "node:assert/strict";
import test from "node:test";

import { getFileMtime, listDirectory } from "../src/fs/index.js";
import { isErrorWithCode } from "../src/utils/error.js";

void test("isErrorWithCode matches Node.js-style error codes", () => {
    const enoent = new Error("no such file") as NodeJS.ErrnoException;
    enoent.code = "ENOENT";

    assert.ok(isErrorWithCode(enoent, "ENOENT"), "should match ENOENT");
    assert.ok(isErrorWithCode(enoent, "ENOENT", "EACCES"), "should match when ENOENT is in a multi-code list");
    assert.ok(!isErrorWithCode(enoent, "EACCES"), "should not match a different code");
});

void test("isErrorWithCode returns false for non-Error values", () => {
    assert.ok(!isErrorWithCode(null, "ENOENT"));
    assert.ok(!isErrorWithCode(undefined, "ENOENT"));
    assert.ok(!isErrorWithCode("string error", "ENOENT"));
    assert.ok(!isErrorWithCode(42, "ENOENT"));
    assert.ok(!isErrorWithCode({}, "ENOENT"));
});

void test("isErrorWithCode returns false when error has no code property", () => {
    assert.ok(!isErrorWithCode(new Error("plain error"), "ENOENT"));
});

void test("listDirectory snapshots iterable results", async () => {
    const source = ["alpha", "beta"];
    const facade = {
        readDir: async () => source
    };

    const result = await listDirectory(facade, "/project");

    assert.deepEqual(result, source);
    assert.notStrictEqual(result, source);

    result.push("gamma");
    assert.deepEqual(source, ["alpha", "beta"]);
});

void test("listDirectory returns an empty array for missing directories", async () => {
    const error = new Error("missing") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    const facade = {
        readDir: async () => {
            throw error;
        }
    };

    const entries = await listDirectory(facade, "/missing");

    assert.deepEqual(entries, []);
});

void test("getFileMtime resolves to numeric mtimes when available", async () => {
    const facade = {
        stat: async () => ({ mtimeMs: 123 })
    };

    assert.strictEqual(await getFileMtime(facade, "/project/manifest.json"), 123);
});

void test("getFileMtime returns null when file is missing", async () => {
    const error = new Error("deleted") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    const facade = {
        stat: async () => {
            throw error;
        }
    };

    assert.strictEqual(await getFileMtime(facade, "/project/missing.json"), null);
});
