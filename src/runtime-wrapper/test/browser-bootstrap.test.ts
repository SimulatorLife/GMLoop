import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { liveReloadBootstrapConfig } from "../browser/config.js";
import { applyMathSafetyPatches, initializeLiveReload } from "../browser/index.js";
import { createRuntimeWrapper } from "../browser/runtime/index.js";
import { createWebSocketClient } from "../browser/websocket/index.js";

void test("runtime-wrapper exposes a browser bootstrap entry at the public browser path", () => {
    assert.equal(typeof initializeLiveReload, "function");
});

void test("runtime-wrapper browser subtree contains the runtime and websocket modules used by the bootstrap", () => {
    assert.equal(typeof createRuntimeWrapper, "function");
    assert.equal(typeof createWebSocketClient, "function");
});

void test("runtime-wrapper browser bootstrap config exports a websocket-aware default object", () => {
    assert.equal(typeof liveReloadBootstrapConfig.websocketUrl, "string");
    assert.match(liveReloadBootstrapConfig.websocketUrl, /^ws:\/\//u);
});

void test("runtime-wrapper browser dist assets do not contain bare workspace imports", async () => {
    const currentFilePath = fileURLToPath(import.meta.url);
    const distRoot = path.resolve(path.dirname(currentFilePath), "..");
    const browserDistRoot = path.join(distRoot, "browser");
    const jsFiles = await listJavaScriptFiles(browserDistRoot);

    assert.ok(jsFiles.length > 0, "Expected browser dist assets to be emitted before the test runs.");

    for (const jsFile of jsFiles) {
        const contents = await fs.readFile(jsFile, "utf8");
        assert.doesNotMatch(
            contents,
            /from\s+["']@gmloop\//u,
            `${path.relative(distRoot, jsFile)} must be browser-loadable without package-name resolution.`
        );
    }
});

async function listJavaScriptFiles(directoryPath: string): Promise<Array<string>> {
    const entries = await fs.readdir(directoryPath, { withFileTypes: true });
    const nestedFiles = await Promise.all(
        entries.map(async (entry) => {
            const entryPath = path.join(directoryPath, entry.name);
            if (entry.isDirectory()) {
                return listJavaScriptFiles(entryPath);
            }

            if (entry.isFile() && entry.name.endsWith(".js")) {
                return [entryPath];
            }

            return [];
        })
    );

    return nestedFiles.flat();
}

void test("applyMathSafetyPatches installs safety patches for GameMaker HTML5 math functions", () => {
    const globalScope = {} as Record<string, unknown>;

    // Mock GameMaker's yyGetReal and a buggy math function (e.g., sqrt)
    globalScope.yyGetReal = Number;

    let originalCalled: boolean;
    globalScope.sqrt = function (x: unknown) {
        originalCalled = true;
        const val = Number(x);
        if (val < 0) throw new Error("Cannot apply sqrt to negative number.");
        return Math.sqrt(val);
    };

    // Install patches
    applyMathSafetyPatches(globalScope);

    // Passing NaN should safely return NaN and bypass the original function
    const patchedSqrt = globalScope.sqrt as (v: unknown) => unknown;
    originalCalled = false;
    const result = patchedSqrt(Number.NaN);

    assert.ok(Number.isNaN(result), "Expected patched sqrt(NaN) to return NaN");
    assert.strictEqual(originalCalled, false, "Expected original sqrt to be bypassed for NaN");

    // Passing a valid number should call original function
    const validResult = patchedSqrt(4);
    assert.strictEqual(validResult, 2, "Expected patched sqrt(4) to return 2");
    assert.strictEqual(originalCalled, true, "Expected original sqrt to be called for valid number");
});
