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

    function captureStdIO(callback: () => void): { stdout: string; stderr: string } {
        const originalStdoutWrite = process.stdout.write.bind(process.stdout);
        const originalStderrWrite = process.stderr.write.bind(process.stderr);
        let stdout = "";
        let stderr = "";

        process.stdout.write = (chunk: string | Uint8Array, ...rest: Array<unknown>) => {
            stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
            const callbackArg = rest.find(
                (value): value is (error?: Error | null) => void => typeof value === "function"
            );
            if (callbackArg) {
                callbackArg();
            }
            return true;
        };

        process.stderr.write = (chunk: string | Uint8Array, ...rest: Array<unknown>) => {
            stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
            const callbackArg = rest.find(
                (value): value is (error?: Error | null) => void => typeof value === "function"
            );
            if (callbackArg) {
                callbackArg();
            }
            return true;
        };

        try {
            callback();
        } finally {
            process.stdout.write = originalStdoutWrite;
            process.stderr.write = originalStderrWrite;
        }

        return { stderr, stdout };
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

    void it("prints a human-readable summary by default", () => {
        const tempDir = createTempDir();
        const outputPath = path.join(tempDir, "stats.json");

        const { stdout } = captureStdIO(() => runCollectStats({ command: { opts: () => ({ output: outputPath }) } }));

        assert.match(stdout, /Project health statistics:/u);
        assert.match(stdout, /Large source files\s+\d+/u);
        assert.match(stdout, /TODO markers\s+\d+/u);
        assert.match(stdout, /Combined build output size/u);
        assert.match(
            stdout,
            new RegExp(`Report written to ${outputPath.replaceAll(/[\\^$.*+?()[\]{}|]/gu, String.raw`\$&`)}`)
        );
    });

    void it("--json emits machine-readable JSON to stdout", () => {
        const tempDir = createTempDir();
        const outputPath = path.join(tempDir, "stats.json");

        const { stdout } = captureStdIO(() =>
            runCollectStats({ command: { opts: () => ({ output: outputPath, json: true }) } })
        );

        const trimmed = stdout.trim();
        assert.doesNotThrow(() => JSON.parse(trimmed), "--json output must be valid JSON");
        assert.deepEqual(Object.keys(JSON.parse(trimmed)).sort(), ["buildSize", "largeFiles", "todos"]);
    });

    void it("--quiet suppresses stdout output but still writes the report", () => {
        const tempDir = createTempDir();
        const outputPath = path.join(tempDir, "stats.json");

        const { stdout } = captureStdIO(() =>
            runCollectStats({ command: { opts: () => ({ output: outputPath, quiet: true }) } })
        );

        assert.equal(stdout, "", "--quiet must suppress stdout output");
        assert.ok(fs.existsSync(outputPath), "report file must still be written in --quiet mode");
    });
});
