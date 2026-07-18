import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    InvalidGameMakerProjectFileError,
    isInvalidGameMakerProjectFileError,
    validateGameMakerProjectFilePath
} from "../../src/workflow/project-file-validation.js";

async function withTemporaryProjectDirectory(callback: (directory: string) => Promise<void>): Promise<void> {
    const directory = await mkdtemp(path.join(os.tmpdir(), "gmloop-project-validation-"));
    try {
        await callback(directory);
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
}

void test("validateGameMakerProjectFilePath accepts a valid GameMaker project manifest", async () => {
    await withTemporaryProjectDirectory(async (directory) => {
        const projectPath = path.join(directory, "Game.yyp");
        await writeFile(
            projectPath,
            JSON.stringify({ name: "Game", resourceType: "GMProject", resources: [] }),
            "utf8"
        );

        assert.equal(await validateGameMakerProjectFilePath(projectPath), projectPath);
    });
});

void test("validateGameMakerProjectFilePath rejects directories and non-yyp paths", async () => {
    await withTemporaryProjectDirectory(async (directory) => {
        await assert.rejects(
            () => validateGameMakerProjectFilePath(directory),
            (error: unknown) =>
                isInvalidGameMakerProjectFileError(error) && /selecting its \.yyp file/u.test(error.message)
        );

        const textPath = path.join(directory, "not-a-project.txt");
        await writeFile(textPath, "not a project", "utf8");
        await assert.rejects(() => validateGameMakerProjectFilePath(textPath), InvalidGameMakerProjectFileError);
    });
});

void test("validateGameMakerProjectFilePath rejects malformed and non-project manifests", async () => {
    await withTemporaryProjectDirectory(async (directory) => {
        const malformedPath = path.join(directory, "Malformed.yyp");
        await writeFile(malformedPath, "{not-json", "utf8");
        await assert.rejects(() => validateGameMakerProjectFilePath(malformedPath), InvalidGameMakerProjectFileError);

        const nonProjectPath = path.join(directory, "Resource.yyp");
        await writeFile(nonProjectPath, JSON.stringify({ name: "Resource", resourceType: "GMScript" }), "utf8");
        await assert.rejects(() => validateGameMakerProjectFilePath(nonProjectPath), InvalidGameMakerProjectFileError);

        const missingResourcesPath = path.join(directory, "Incomplete.yyp");
        await writeFile(
            missingResourcesPath,
            JSON.stringify({ name: "Incomplete", resourceType: "GMProject" }),
            "utf8"
        );
        await assert.rejects(
            () => validateGameMakerProjectFilePath(missingResourcesPath),
            InvalidGameMakerProjectFileError
        );
    });
});
