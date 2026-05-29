import assert from "node:assert/strict";
import test from "node:test";

import { runWithMissingPathFallback } from "../src/project-index/fs-facade.js";

void test("runWithMissingPathFallback returns operation result when no error occurs", async () => {
    const value = await runWithMissingPathFallback(
        async () => "ok",
        () => "fallback"
    );

    assert.equal(value, "ok");
});

void test("runWithMissingPathFallback returns fallback value for ENOENT errors", async () => {
    const missingFileError = Object.assign(new Error("missing"), {
        code: "ENOENT"
    });

    const value = await runWithMissingPathFallback(
        async () => {
            throw missingFileError;
        },
        () => "fallback"
    );

    assert.equal(value, "fallback");
});

void test("runWithMissingPathFallback rethrows non-ENOENT errors", async () => {
    const permissionError = Object.assign(new Error("denied"), {
        code: "EACCES"
    });

    await assert.rejects(
        async () =>
            runWithMissingPathFallback(
                async () => {
                    throw permissionError;
                },
                () => "fallback"
            ),
        permissionError
    );
});
