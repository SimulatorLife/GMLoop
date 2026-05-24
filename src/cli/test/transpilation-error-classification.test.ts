import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { Transpiler } from "@gmloop/transpiler";

import { type TranspilationContext, transpileFile } from "../src/modules/transpilation/coordinator.js";

function createTranspilationContext(): TranspilationContext {
    return {
        transpiler: new Transpiler.GmlTranspiler(),
        patches: [],
        metrics: [],
        errors: [],
        lastSuccessfulPatches: new Map(),
        bounds: { maxEntries: 10 },
        totalPatchCount: 0,
        websocketServer: null
    };
}

void describe("Transpilation error classification", () => {
    void it("should classify syntax errors correctly", async (t) => {
        const tempDir = await mkdir(path.join(tmpdir(), `transpile-test-${Date.now()}`), { recursive: true });
        const testFile = path.join(tempDir, "syntax-error.gml");

        t.after(async () => {
            await rm(tempDir, { recursive: true, force: true });
        });
        await writeFile(testFile, "function test() {\n    var x = 10\n", "utf8");

        const context = createTranspilationContext();

        const content = "function test() {\n    var x = 10\n";
        const result = transpileFile(context, testFile, content, 2, { verbose: false, quiet: true });

        assert.strictEqual(result.success, false);
        assert.ok(result.error);
        assert.strictEqual(result.error.category, "syntax");
        assert.ok(result.error.line !== undefined || result.error.column !== undefined);
    });

    void it("should classify validation errors correctly", async (t) => {
        const tempDir = await mkdir(path.join(tmpdir(), `transpile-test-${Date.now()}`), { recursive: true });
        const testFile = path.join(tempDir, "validation-error.gml");

        t.after(async () => {
            await rm(tempDir, { recursive: true, force: true });
        });
        const context = createTranspilationContext();

        const emptyContent = "";
        const result = transpileFile(context, testFile, emptyContent, 0, { verbose: false, quiet: true });

        assert.strictEqual(result.success, false);
        assert.ok(result.error);
        assert.strictEqual(result.error.category, "validation");
    });

    void it("should provide recovery hints for common errors", async (t) => {
        const tempDir = await mkdir(path.join(tmpdir(), `transpile-test-${Date.now()}`), { recursive: true });
        const testFile = path.join(tempDir, "missing-brace.gml");

        t.after(async () => {
            await rm(tempDir, { recursive: true, force: true });
        });

        await writeFile(testFile, "function test() {\n    var x = 10;\n", "utf8");

        const context = createTranspilationContext();

        const content = "function test() {\n    var x = 10;\n";
        const result = transpileFile(context, testFile, content, 2, { verbose: false, quiet: true });

        assert.strictEqual(result.success, false);
        assert.ok(result.error);
        if (result.error.recoveryHint) {
            assert.ok(
                result.error.recoveryHint.includes("brace") || result.error.recoveryHint.includes("unclosed"),
                "Expected recovery hint about braces or unclosed blocks"
            );
        }
    });

    void it("should track error categories in statistics", async (t) => {
        const tempDir = await mkdir(path.join(tmpdir(), `transpile-test-${Date.now()}`), { recursive: true });

        t.after(async () => {
            await rm(tempDir, { recursive: true, force: true });
        });
        const context = createTranspilationContext();

        const testFile1 = path.join(tempDir, "error1.gml");
        transpileFile(context, testFile1, "function test() {", 1, { verbose: false, quiet: true });

        const testFile2 = path.join(tempDir, "error2.gml");
        transpileFile(context, testFile2, "", 0, { verbose: false, quiet: true });

        assert.strictEqual(context.errors.length, 2);
        assert.ok(context.errors.every((error) => error.category !== undefined));

        const categories = new Set(context.errors.map((error) => error.category));
        assert.ok(categories.size > 0, "Should have at least one error category");
    });

    void it("should successfully transpile valid GML code", async (t) => {
        const tempDir = await mkdir(path.join(tmpdir(), `transpile-test-${Date.now()}`), { recursive: true });
        const testFile = path.join(tempDir, "valid.gml");

        t.after(async () => {
            await rm(tempDir, { recursive: true, force: true });
        });
        const context = createTranspilationContext();

        const content = "function test() {\n    var x = 10;\n    return x;\n}";
        const result = transpileFile(context, testFile, content, 4, { verbose: false, quiet: true });

        assert.strictEqual(result.success, true);
        assert.ok(result.patch);
        assert.ok(result.metrics);
        assert.strictEqual(context.errors.length, 0);
    });

    void it("should store patch history without retaining full payloads", async (t) => {
        const tempDir = await mkdir(path.join(tmpdir(), `transpile-test-${Date.now()}`), { recursive: true });
        const testFile = path.join(tempDir, "history.gml");

        t.after(async () => {
            await rm(tempDir, { recursive: true, force: true });
        });

        const context = createTranspilationContext();

        const content = "function test() {\n    var x = 10;\n    return x;\n}";
        const result = transpileFile(context, testFile, content, 4, { verbose: false, quiet: true });

        assert.strictEqual(result.success, true);
        assert.ok(result.patch);
        assert.strictEqual(context.patches.length, 1);

        const patchHistory = context.patches[0];
        assert.ok(!("js_body" in patchHistory), "Patch history should not retain JavaScript payloads");
        assert.strictEqual(
            patchHistory.jsBodyBytes,
            Buffer.byteLength(result.patch.js_body, "utf8"),
            "Patch history should retain payload size for memory tracking"
        );
    });

    void it("should skip emitting duplicate runtime patches when transpiled output is unchanged", async (t) => {
        const tempDir = await mkdir(path.join(tmpdir(), `transpile-test-${Date.now()}`), { recursive: true });
        const testFile = path.join(tempDir, "unchanged-runtime-patch.gml");

        t.after(async () => {
            await rm(tempDir, { recursive: true, force: true });
        });

        const content = "function unchanged_patch() {\n    return 1;\n}";
        await writeFile(testFile, content, "utf8");

        let broadcastCount = 0;
        const context = createTranspilationContext();
        context.websocketServer = {
            broadcast: () => {
                broadcastCount += 1;
                return {
                    successCount: 1,
                    failureCount: 0,
                    totalClients: 1
                };
            },
            getClientCount: () => 1
        };

        const firstResult = transpileFile(context, testFile, content, 3, { verbose: false, quiet: true });
        const secondResult = transpileFile(context, testFile, content, 3, { verbose: false, quiet: true });

        assert.strictEqual(firstResult.success, true);
        assert.strictEqual(secondResult.success, true);
        assert.strictEqual(broadcastCount, 1, "duplicate runtime patch should not be broadcast twice");
        assert.strictEqual(context.totalPatchCount, 1, "duplicate runtime patch should not increase patch counter");
        assert.strictEqual(context.patches.length, 1, "duplicate runtime patch should not add history entries");
        assert.strictEqual(context.metrics.length, 2, "transpilation metrics should still capture both executions");
    });
});
