import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { runCollectStats } from "../src/commands/collect-stats.js";

void describe("runCollectStats", () => {
    const tempDirs: Array<string> = [];

    after(() => {
        for (const dir of tempDirs) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    function createTempDir(): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "collect-stats-test-"));
        tempDirs.push(dir);
        return dir;
    }

    void it("writes a valid JSON file with a trailing newline", () => {
        const tempDir = createTempDir();
        const outputPath = path.join(tempDir, "stats.json");

        runCollectStats({ command: { opts: () => ({ output: outputPath }) } });

        assert.ok(fs.existsSync(outputPath), "output file should be written");

        const raw = fs.readFileSync(outputPath, "utf8");

        assert.ok(raw.endsWith("\n"), "output JSON must end with a trailing newline");
        assert.doesNotThrow(() => JSON.parse(raw), "output must be valid JSON");
    });

    void it("creates the output directory when it does not exist", () => {
        const tempDir = createTempDir();
        const outputPath = path.join(tempDir, "nested", "subdir", "stats.json");

        runCollectStats({ command: { opts: () => ({ output: outputPath }) } });

        assert.ok(fs.existsSync(outputPath), "output file should be created in a nested directory");
    });
});
