import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { findProjectRoot } from "../src/project-index/index.js";
import { __loadBuiltInIdentifiersForTests as loadBuiltInIdentifiersForTests } from "../src/symbols/built-in-identifiers.js";

function createMockFs(entries) {
    const normalizedEntries = new Map();
    for (const [rawPath, value] of Object.entries(entries)) {
        normalizedEntries.set(path.resolve(rawPath), value);
    }

    return {
        async readDir(targetPath) {
            const normalizedPath = path.resolve(targetPath);
            const node = normalizedEntries.get(normalizedPath);
            if (!node) {
                const error: any = new Error(`No such directory: ${normalizedPath}`);
                error.code = "ENOENT";
                throw error;
            }
            if (node.type !== "dir") {
                const error: any = new Error(`Not a directory: ${normalizedPath}`);
                error.code = "ENOTDIR";
                throw error;
            }
            return [...node.entries];
        },
        async stat(targetPath) {
            const normalizedPath = path.resolve(targetPath);
            const node = normalizedEntries.get(normalizedPath);
            if (!node) {
                const error: any = new Error(`No such file: ${normalizedPath}`);
                error.code = "ENOENT";
                throw error;
            }
            return { mtimeMs: node.mtimeMs ?? 0 };
        }
    };
}

void test("findProjectRoot returns nearest directory containing a manifest", async () => {
    const projectRoot = path.resolve("/workspace/project");
    const filePath = path.join(projectRoot, "scripts", "enemy", "attack.gml");
    const mockFs = createMockFs({
        [projectRoot]: {
            type: "dir",
            entries: ["project.yyp", "scripts"]
        },
        [path.join(projectRoot, "project.yyp")]: {
            type: "file",
            mtimeMs: 10
        },
        [path.join(projectRoot, "scripts")]: {
            type: "dir",
            entries: ["enemy"]
        },
        [path.join(projectRoot, "scripts", "enemy")]: {
            type: "dir",
            entries: ["attack.gml"]
        },
        [filePath]: {
            type: "file",
            mtimeMs: 20
        }
    });

    const result = await findProjectRoot({ filepath: filePath }, mockFs);
    assert.equal(result, projectRoot);
});

void test("findProjectRoot returns null when no manifest is discovered", async () => {
    const workingDir = path.resolve("/workspace/random");
    const filePath = path.join(workingDir, "scratch", "notes.gml");
    const mockFs = createMockFs({
        [workingDir]: { type: "dir", entries: ["scratch"] },
        [path.join(workingDir, "scratch")]: {
            type: "dir",
            entries: ["notes.gml"]
        },
        [filePath]: { type: "file", mtimeMs: 5 }
    });

    const result = await findProjectRoot({ filepath: filePath }, mockFs);
    assert.equal(result, null);
});

void test("findProjectRoot treats nullish directory listings as empty", async () => {
    const projectRoot = path.resolve("/workspace/project");
    const filePath = path.join(projectRoot, "scripts", "enemy", "attack.gml");

    const directoryResponses = new Map([
        [path.join(projectRoot, "scripts"), null],
        [path.join(projectRoot, "scripts", "enemy"), undefined],
        [projectRoot, null]
    ]);

    const mockFs = {
        async readDir(targetPath) {
            const normalizedPath = path.resolve(targetPath);
            if (directoryResponses.has(normalizedPath)) {
                return directoryResponses.get(normalizedPath);
            }
            return [];
        }
    };

    await assert.doesNotReject(async () => {
        const result = await findProjectRoot({ filepath: filePath }, mockFs);
        assert.equal(result, null);
    });
});

void test("findProjectRoot surfaces abort message before filesystem access", async () => {
    const controller = new AbortController();
    controller.abort(null);

    let readAttempted = false;
    const stubFs = {
        async readDir() {
            readAttempted = true;
            throw new Error("readDir should not run when aborted");
        }
    };

    await assert.rejects(
        findProjectRoot(
            {
                filepath: path.resolve("/workspace/project/scripts/file.gml"),
                signal: controller.signal
            },
            stubFs
        ),
        (error) => {
            assert.equal((error as any)?.message, "Project root discovery was aborted.");
            return true;
        }
    );

    assert.equal(readAttempted, false);
});

void test("loadBuiltInIdentifiers respects abort guard", async () => {
    const controller = new AbortController();
    controller.abort(null);

    let statAttempted = false;
    let readAttempted = false;
    const stubFs = {
        async stat() {
            statAttempted = true;
            throw new Error("stat should not run when aborted");
        },
        async readFile() {
            readAttempted = true;
            throw new Error("readFile should not run when aborted");
        }
    };

    await assert.rejects(
        loadBuiltInIdentifiersForTests(stubFs, null, {
            signal: controller.signal
        }),
        (error) => {
            assert.equal((error as any)?.message, "Project index build was aborted.");
            return true;
        }
    );

    assert.equal(statAttempted, false);
    assert.equal(readAttempted, false);
});
