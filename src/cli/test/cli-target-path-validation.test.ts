import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { CliUsageError } from "../src/cli-core/errors.js";
import { __formatTest__ } from "../src/commands/format.js";

const { validateTargetPathInputForTests, resolveTargetPathFromInputForTests } = __formatTest__;

void test("validateTargetPathInput rejects non-string values", () => {
    const usage = "usage summary";

    assert.throws(
        () =>
            validateTargetPathInputForTests({
                targetPathProvided: true,
                targetPathInput: { path: "src" },
                usage
            }),
        (error) => {
            assert.ok(error instanceof CliUsageError);
            assert.strictEqual(error.message, "Target path must be provided as a string. Received a plain object.");
            assert.strictEqual(error.usage, usage);
            return true;
        }
    );
});

void test("target path helpers normalize valid inputs", () => {
    assert.doesNotThrow(() =>
        validateTargetPathInputForTests({
            targetPathProvided: true,
            targetPathInput: "src",
            usage: ""
        })
    );

    const resolvedTarget = resolveTargetPathFromInputForTests("src");
    assert.strictEqual(resolvedTarget, path.resolve(process.cwd(), "src"));

    const defaultTarget = resolveTargetPathFromInputForTests(null);
    assert.strictEqual(defaultTarget, path.resolve(process.cwd(), "."));
});

void test("resolveTargetPathFromInput falls back to the raw value when sanitized path is missing", async () => {
    const targetPaths = await prepareTargetPathFixture({
        createRawDirectory: true
    });

    try {
        const resolved = resolveTargetPathFromInputForTests(targetPaths.sanitizedName, {
            rawTargetPathInput: targetPaths.rawName
        });
        assert.strictEqual(resolved, targetPaths.rawPath);
    } finally {
        await targetPaths.cleanup();
    }
});

void test("resolveTargetPathFromInput prefers the raw value when both paths exist", async () => {
    const targetPaths = await prepareTargetPathFixture({
        createRawDirectory: true,
        createSanitizedDirectory: true
    });

    try {
        const resolved = resolveTargetPathFromInputForTests(targetPaths.sanitizedName, {
            rawTargetPathInput: targetPaths.rawName
        });
        assert.strictEqual(resolved, targetPaths.rawPath);
    } finally {
        await targetPaths.cleanup();
    }
});

void test("resolveTargetPathFromInput falls back to the sanitized path when only it exists", async () => {
    const targetPaths = await prepareTargetPathFixture({
        createSanitizedDirectory: true
    });

    try {
        const resolved = resolveTargetPathFromInputForTests(targetPaths.sanitizedName, {
            rawTargetPathInput: targetPaths.rawName
        });
        assert.strictEqual(resolved, targetPaths.sanitizedPath);
    } finally {
        await targetPaths.cleanup();
    }
});

void test("resolveTargetPathFromInput returns the sanitized path when neither candidate exists", async () => {
    const targetPaths = await prepareTargetPathFixture({});

    try {
        const resolved = resolveTargetPathFromInputForTests(targetPaths.sanitizedName, {
            rawTargetPathInput: targetPaths.rawName
        });
        assert.strictEqual(resolved, targetPaths.sanitizedPath);
    } finally {
        await targetPaths.cleanup();
    }
});

async function prepareTargetPathFixture({
    createRawDirectory = false,
    createSanitizedDirectory = false
}: {
    createRawDirectory?: boolean;
    createSanitizedDirectory?: boolean;
}) {
    const uniqueSuffix = randomUUID();
    const rawName = ` ${uniqueSuffix}-target`;
    const sanitizedName = `${uniqueSuffix}-target`;
    const rawPath = path.resolve(process.cwd(), rawName);
    const sanitizedPath = path.resolve(process.cwd(), sanitizedName);

    await fs.rm(rawPath, { recursive: true, force: true });
    await fs.rm(sanitizedPath, { recursive: true, force: true });

    if (createRawDirectory) {
        await fs.mkdir(rawPath, { recursive: true });
    }

    if (createSanitizedDirectory) {
        await fs.mkdir(sanitizedPath, { recursive: true });
    }

    return {
        rawName,
        sanitizedName,
        rawPath,
        sanitizedPath,
        cleanup: async () => {
            await fs.rm(rawPath, { recursive: true, force: true });
            await fs.rm(sanitizedPath, { recursive: true, force: true });
        }
    };
}
