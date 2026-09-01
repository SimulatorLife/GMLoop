import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { getFileMtime, listDirectory, readJsonFileSyncOrDefault, safeReaddirWithFileTypes } from "../src/fs/index.js";
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

void test("safeReaddirWithFileTypes returns entries from an existing directory", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "gmloop-safe-readdir-"));
    try {
        writeFileSync(path.join(directory, "alpha.txt"), "alpha");
        writeFileSync(path.join(directory, "beta.txt"), "beta");

        const entries = await safeReaddirWithFileTypes(directory);

        const names = entries.map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
        assert.deepEqual(names, ["alpha.txt", "beta.txt"]);
        assert.ok(entries.every((entry) => entry.isFile()));
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

void test("safeReaddirWithFileTypes returns an empty array when the directory is missing", async () => {
    const directory = path.join(tmpdir(), "gmloop-safe-readdir-missing", `${Date.now()}-${Math.random()}`);

    const entries = await safeReaddirWithFileTypes(directory);

    assert.deepEqual(entries, []);
});

void test("safeReaddirWithFileTypes returns an empty array when the path is a file", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "gmloop-safe-readdir-"));
    try {
        const filePath = path.join(directory, "not-a-directory.txt");
        writeFileSync(filePath, "hello");

        const entries = await safeReaddirWithFileTypes(filePath);

        assert.deepEqual(entries, []);
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

void test("readJsonFileSyncOrDefault normalizes a parsed JSON payload", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "gmloop-read-json-"));
    try {
        const filePath = path.join(directory, "state.json");
        writeFileSync(filePath, JSON.stringify({ count: 2 }), "utf8");

        const result = readJsonFileSyncOrDefault(
            filePath,
            (value) => ({ count: (value as { count: number }).count * 10 }),
            { count: 0 }
        );

        assert.deepEqual(result, { count: 20 });
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});

void test("readJsonFileSyncOrDefault falls back to the default when the file is missing", () => {
    const missingPath = path.join(tmpdir(), "gmloop-read-json-missing", `${Date.now()}-${Math.random()}.json`);

    const result = readJsonFileSyncOrDefault(missingPath, (value) => value, { fallback: true });

    assert.deepEqual(result, { fallback: true });
});

void test("readJsonFileSyncOrDefault falls back to the default when the file contains invalid JSON", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "gmloop-read-json-invalid-"));
    try {
        const filePath = path.join(directory, "state.json");
        writeFileSync(filePath, "not json", "utf8");

        const result = readJsonFileSyncOrDefault(filePath, (value) => value, { fallback: true });

        assert.deepEqual(result, { fallback: true });
    } finally {
        rmSync(directory, { recursive: true, force: true });
    }
});
