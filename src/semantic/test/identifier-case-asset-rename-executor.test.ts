import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { __private__, createAssetRenameExecutor } from "../src/identifier-case/asset-renames/executor.js";
import { DEFAULT_WRITE_ACCESS_MODE } from "../src/identifier-case/identifier-case-helpers.js";

const { ensureWritableDirectory, ensureWritableFile, readJsonFile } = __private__;

void describe("asset rename executor filesystem utilities", () => {
    void it("skips directory creation when accessSync allows writing", () => {
        const calls = [];
        const fsFacade = {
            accessSync(targetPath, mode) {
                calls.push({ targetPath, mode });
            },
            mkdirSync() {
                assert.fail("mkdirSync should not be invoked when directory is accessible");
            }
        };

        ensureWritableDirectory(fsFacade, "/tmp/demo");

        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0].targetPath, "/tmp/demo");
        assert.strictEqual(calls[0].mode, DEFAULT_WRITE_ACCESS_MODE);
    });

    void it("uses existsSync fallback when accessSync is unavailable", () => {
        let mkdirCalled = false;
        const fsFacade = {
            existsSync(targetPath) {
                assert.strictEqual(targetPath, "/tmp/demo");
                return true;
            },
            mkdirSync() {
                mkdirCalled = true;
            }
        };

        ensureWritableDirectory(fsFacade, "/tmp/demo");

        assert.strictEqual(mkdirCalled, false);
    });

    void it("skips directory creation when file is already accessible", () => {
        let mkdirCalled = false;
        const fsFacade = {
            statSync(targetPath) {
                assert.strictEqual(targetPath, "/tmp/demo/file.yy");
                return {};
            },
            mkdirSync() {
                mkdirCalled = true;
            }
        };

        ensureWritableFile(fsFacade, "/tmp/demo/file.yy");

        assert.strictEqual(mkdirCalled, false);
    });

    void it("ensures the parent directory exists when a file is missing", () => {
        const ensuredDirectories = [];
        const fsFacade = {
            statSync() {
                const error: any = new Error("missing file");
                error.code = "ENOENT";
                throw error;
            },
            existsSync() {
                return false;
            },
            mkdirSync(targetPath) {
                ensuredDirectories.push(targetPath);
            }
        };

        const filePath = path.join("/tmp", "demo", "file.yy");

        ensureWritableFile(fsFacade, filePath);

        assert.deepStrictEqual(ensuredDirectories, [path.join("/tmp", "demo")]);
    });
});

void describe("asset rename executor JSON helpers", () => {
    void it("caches parsed JSON results", () => {
        let readCount = 0;
        const fsFacade = {
            readFileSync(targetPath) {
                readCount += 1;
                assert.strictEqual(targetPath, "/tmp/resource.yy");
                return '{"name":"demo"}';
            }
        };

        const cache = new Map();
        const first = readJsonFile(fsFacade, "/tmp/resource.yy", cache);
        const second = readJsonFile(fsFacade, "/tmp/resource.yy", cache);

        assert.equal(readCount, 1);
        assert.strictEqual(first, second);
        assert.deepStrictEqual(first, { name: "demo" });
    });

    void it("wraps JSON parse failures with contextual errors", () => {
        const fsFacade = {
            readFileSync() {
                return "{ invalid";
            }
        };

        let error;
        try {
            readJsonFile(fsFacade, "/tmp/broken.yy", new Map());
        } catch (error_) {
            error = error_;
        }

        assert.ok(error);
        assert.equal(error.name, "ProjectMetadataParseError");
        assert.match(error.message, /Failed to parse GameMaker metadata/);
        assert.match(error.message, /\/tmp\/broken\.yy/);
    });

    void it("rejects resource payloads that are not plain objects", () => {
        const fsFacade = {
            readFileSync() {
                return "[]";
            }
        };

        assert.throws(
            () => {
                readJsonFile(fsFacade, "/tmp/list.yy", new Map());
            },
            {
                name: "TypeError",
                message: "Resource JSON at /tmp/list.yy must be a plain object."
            }
        );
    });
});

void describe("asset rename executor memory management", () => {
    const gc = typeof globalThis.gc === "function" ? globalThis.gc : null;

    void it("clears cached JSON payloads after commit to reduce heap usage", () => {
        const largePayload = "x".repeat(1024 * 256);
        const largeJson = JSON.stringify({ name: "demo", payload: largePayload });
        let readCount = 0;
        const fsFacade = {
            readFileSync() {
                readCount += 1;
                return largeJson;
            },
            accessSync() {},
            writeFileSync() {},
            renameSync() {},
            statSync() {
                return fs.statSync(process.cwd());
            },
            mkdirSync() {},
            existsSync() {
                return false;
            }
        };

        const executor = createAssetRenameExecutor({
            projectIndex: { projectRoot: "/project" },
            fsFacade
        });

        if (gc) {
            gc();
        }

        const baselineHeap = process.memoryUsage().heapUsed;
        const renameCount = 120;
        for (let i = 0; i < renameCount; i += 1) {
            executor.queueRename({
                resourcePath: `assets/${i}.yy`,
                toName: "demo"
            });
        }

        if (gc) {
            gc();
        }

        const readCountAfterQueue = readCount;
        const cachedHeap = process.memoryUsage().heapUsed;
        const result = executor.commit();

        // Functional verification: after commit() the JSON cache must be cleared.
        // Re-queuing a path that was previously cached should trigger a fresh
        // filesystem read rather than returning the cached value.
        executor.queueRename({ resourcePath: "assets/0.yy", toName: "demo" });
        assert.equal(
            readCount,
            readCountAfterQueue + 1,
            "Expected a fresh filesystem read after commit(), confirming the JSON cache was cleared."
        );

        if (gc) {
            gc();
        }

        const finalHeap = process.memoryUsage().heapUsed;

        const reclaimedBytes = cachedHeap - finalHeap;
        const reclaimedMiB = Math.round(reclaimedBytes / 1024 / 1024);

        assert.equal(result.writes.length, 0);
        assert.ok(readCount > 0);
        if (!gc) {
            return;
        }

        assert.ok(
            reclaimedBytes > 10 * 1024 * 1024,
            `Expected heap usage to drop by at least 10 MiB after commit (baseline ${Math.round(
                baselineHeap / 1024 / 1024
            )} MiB, cached ${Math.round(cachedHeap / 1024 / 1024)} MiB, final ${Math.round(
                finalHeap / 1024 / 1024
            )} MiB, reclaimed ${reclaimedMiB} MiB).`
        );
    });
});
