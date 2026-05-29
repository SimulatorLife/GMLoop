import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { liveReloadBootstrapConfig } from "../browser/config.js";
import { initializeLiveReload } from "../browser/index.js";
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
