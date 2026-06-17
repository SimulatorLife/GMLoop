import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { pathExists, pathExistsSync } from "../src/shared/path-exists.js";

async function createTemporaryDirectory() {
    const prefix = path.join(os.tmpdir(), "gml-path-exists-");
    return fs.mkdtemp(prefix);
}

async function withTemporaryDirectory(callback: (tempDir: string) => Promise<void>) {
    const tempDir = await createTemporaryDirectory();
    try {
        await callback(tempDir);
    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }
}

void describe("pathExistsSync helper (CLI)", () => {
    void it("returns true for an existing file", async () => {
        await withTemporaryDirectory(async (tempDir) => {
            const filePath = path.join(tempDir, "present.txt");
            await fs.writeFile(filePath, "hello", "utf8");
            assert.equal(pathExistsSync(filePath), true);
        });
    });

    void it("returns false for a missing path", async () => {
        await withTemporaryDirectory(async (tempDir) => {
            const missingPath = path.join(tempDir, "absent.txt");
            assert.equal(pathExistsSync(missingPath), false);
        });
    });

    void it("returns true for an existing directory", async () => {
        await withTemporaryDirectory(async (tempDir) => {
            assert.equal(pathExistsSync(tempDir), true);
        });
    });

    void it("runs the predicate against the resolved stats", async () => {
        await withTemporaryDirectory(async (tempDir) => {
            const filePath = path.join(tempDir, "marker.txt");
            await fs.writeFile(filePath, "x", "utf8");
            assert.equal(
                pathExistsSync(filePath, (stat) => stat.isFile()),
                true
            );
            assert.equal(
                pathExistsSync(filePath, (stat) => stat.isDirectory()),
                false
            );
        });
    });

    void it("returns false when the predicate rejects a real stat", async () => {
        await withTemporaryDirectory(async (tempDir) => {
            assert.equal(
                pathExistsSync(tempDir, (stat) => stat.isFile()),
                false
            );
        });
    });

    void it("treats unreadable / broken paths as missing", () => {
        // A non-existent absolute path should resolve to false just like the
        // historical `fs.existsSync` contract.
        const definitelyMissing = path.join(os.tmpdir(), `definitely-not-here-${Date.now()}`);
        assert.equal(pathExistsSync(definitelyMissing), false);
    });
});

void describe("pathExists helper (CLI)", () => {
    void it("returns true for an existing file", async () => {
        await withTemporaryDirectory(async (tempDir) => {
            const filePath = path.join(tempDir, "present.txt");
            await fs.writeFile(filePath, "hello", "utf8");
            assert.equal(await pathExists(filePath), true);
        });
    });

    void it("returns false for a missing path", async () => {
        await withTemporaryDirectory(async (tempDir) => {
            const missingPath = path.join(tempDir, "absent.txt");
            assert.equal(await pathExists(missingPath), false);
        });
    });

    void it("returns true for an existing directory", async () => {
        await withTemporaryDirectory(async (tempDir) => {
            assert.equal(await pathExists(tempDir), true);
        });
    });

    void it("runs the predicate against the resolved stats", async () => {
        await withTemporaryDirectory(async (tempDir) => {
            const filePath = path.join(tempDir, "marker.txt");
            await fs.writeFile(filePath, "x", "utf8");
            assert.equal(await pathExists(filePath, (stat) => stat.isFile()), true);
            assert.equal(await pathExists(filePath, (stat) => stat.isDirectory()), false);
        });
    });

    void it("returns false when the predicate rejects a real stat", async () => {
        await withTemporaryDirectory(async (tempDir) => {
            assert.equal(await pathExists(tempDir, (stat) => stat.isFile()), false);
        });
    });

    void it("treats unreadable / broken paths as missing", async () => {
        const definitelyMissing = path.join(os.tmpdir(), `definitely-not-here-${Date.now()}`);
        assert.equal(await pathExists(definitelyMissing), false);
    });
});
