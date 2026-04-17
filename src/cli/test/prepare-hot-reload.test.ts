import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { createPrepareHotReloadCommand } from "../src/commands/prepare-hot-reload.js";
import {
    __test__,
    DEFAULT_GM_TEMP_ROOT,
    DEFAULT_WEBSOCKET_URL,
    prepareHotReloadInjection
} from "../src/modules/hot-reload/inject-runtime.js";

const { HOT_RELOAD_MARKER_START, extractGmWebServerRoot, parseRuntimeWrapperAssetManifest } = __test__;
const HOT_RELOAD_ASSET_MANIFEST = path.join(".gml-hot-reload", "runtime-wrapper-assets.manifest.json");

async function createTempDir(prefix: string): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createRuntimeWrapperRoot(root: string): Promise<string> {
    const runtimeRoot = path.join(root, "runtime-wrapper-dist");
    await fs.mkdir(path.join(runtimeRoot, "src", "runtime"), { recursive: true });
    await fs.mkdir(path.join(runtimeRoot, "src", "websocket"), { recursive: true });
    await fs.writeFile(
        path.join(runtimeRoot, "index.js"),
        `export const entry = true;
`,
        "utf8"
    );
    await fs.writeFile(
        path.join(runtimeRoot, "src", "runtime", "index.js"),
        `export const createRuntimeWrapper = () => ({});
export const installScriptCallAdapter = () => {};
`,
        "utf8"
    );
    await fs.writeFile(
        path.join(runtimeRoot, "src", "websocket", "index.js"),
        `export const createWebSocketClient = () => {};
`,
        "utf8"
    );
    return runtimeRoot;
}

void describe("prepareHotReloadInjection", () => {
    void it("injects the hot-reload snippet and copies runtime assets", async () => {
        const root = await createTempDir("gml-hot-reload-");
        const outputRoot = path.join(root, "output");
        const runtimeWrapperRoot = await createRuntimeWrapperRoot(root);
        await fs.mkdir(outputRoot, { recursive: true });
        const indexPath = path.join(outputRoot, "index.html");
        await fs.writeFile(indexPath, "<html><body><h1>Demo</h1></body></html>", "utf8");

        const result = await prepareHotReloadInjection({
            html5OutputRoot: outputRoot,
            runtimeWrapperRoot,
            websocketUrl: "ws://127.0.0.1:9999"
        });

        const updated = await fs.readFile(indexPath, "utf8");
        assert.match(updated, new RegExp(HOT_RELOAD_MARKER_START));
        assert.match(updated, /ws:\/\/127\.0\.0\.1:9999/);

        const runtimeEntry = path.join(result.runtimeWrapperTargetRoot, "index.js");
        const runtimeStats = await fs.stat(runtimeEntry);
        assert.ok(runtimeStats.isFile());
    });

    void it("skips recopying runtime assets when the wrapper manifest is unchanged", async () => {
        const root = await createTempDir("gml-hot-reload-skip-copy-");
        const outputRoot = path.join(root, "output");
        const runtimeWrapperRoot = await createRuntimeWrapperRoot(root);
        await fs.mkdir(outputRoot, { recursive: true });
        await fs.writeFile(path.join(outputRoot, "index.html"), "<html><body><h1>Demo</h1></body></html>", "utf8");

        const firstResult = await prepareHotReloadInjection({
            html5OutputRoot: outputRoot,
            runtimeWrapperRoot,
            websocketUrl: "ws://127.0.0.1:9999"
        });
        assert.equal(firstResult.copiedAssets, true);

        const runtimeEntry = path.join(firstResult.runtimeWrapperTargetRoot, "index.js");
        const manifestPath = path.join(outputRoot, HOT_RELOAD_ASSET_MANIFEST);
        const firstRuntimeStats = await fs.stat(runtimeEntry);
        const firstManifestContents = await fs.readFile(manifestPath, "utf8");

        await new Promise((resolve) => setTimeout(resolve, 20));

        const secondResult = await prepareHotReloadInjection({
            html5OutputRoot: outputRoot,
            runtimeWrapperRoot,
            websocketUrl: "ws://127.0.0.1:9999"
        });

        const secondRuntimeStats = await fs.stat(runtimeEntry);
        const secondManifestContents = await fs.readFile(manifestPath, "utf8");

        assert.equal(secondResult.copiedAssets, false);
        assert.equal(secondRuntimeStats.mtimeMs, firstRuntimeStats.mtimeMs);
        assert.equal(secondManifestContents, firstManifestContents);
    });

    void it("auto-detects the newest HTML5 output directory", async () => {
        const root = await createTempDir("gml-hot-reload-root-");
        const older = path.join(root, "older");
        const newer = path.join(root, "newer");
        await fs.mkdir(older, { recursive: true });
        await fs.mkdir(newer, { recursive: true });
        const runtimeWrapperRoot = await createRuntimeWrapperRoot(root);
        await fs.writeFile(path.join(older, "index.html"), "<html></html>", "utf8");
        await fs.writeFile(path.join(newer, "index.html"), "<html></html>", "utf8");

        const past = new Date(Date.now() - 10_000);
        const now = new Date();
        await fs.utimes(path.join(older, "index.html"), past, past);
        await fs.utimes(path.join(newer, "index.html"), now, now);

        const result = await prepareHotReloadInjection({
            gmTempRoot: root,
            runtimeWrapperRoot
        });

        assert.equal(result.outputRoot, newer);
    });

    void it("fails fast when the HTML5 temp root is missing", async () => {
        const root = await createTempDir("gml-hot-reload-missing-");
        const missingRoot = path.join(root, "gml-missing");
        await fs.rm(missingRoot, { recursive: true, force: true });

        await assert.rejects(
            () => prepareHotReloadInjection({ gmTempRoot: missingRoot }),
            (error) => {
                assert.ok(error instanceof Error);
                assert.match(error.message, /GameMaker HTML5 temporary output root '.*' was not found/i);
                return true;
            }
        );
    });
});

void describe("GMWebServ root parsing", () => {
    void it("extracts the -root path from a GMWebServ command line", () => {
        const sample = "/path/GMWebServ -v -root /private/tmp/GameMakerStudio2/GMS2TEMP/Project_Javascript";
        const root = extractGmWebServerRoot(sample);
        assert.equal(root, "/private/tmp/GameMakerStudio2/GMS2TEMP/Project_Javascript");
    });

    void it("returns null when no GMWebServ root is present", () => {
        assert.equal(extractGmWebServerRoot("/bin/other"), null);
    });
});

void describe("runtime wrapper asset manifest parsing", () => {
    void it("returns cloned entry objects so parsed manifests cannot mutate the original JSON payload", () => {
        const manifestPayload = {
            version: 1,
            entries: [{ relativePath: "index.js", size: 12, mtimeMs: 1234 }]
        };

        const parsed = parseRuntimeWrapperAssetManifest(JSON.stringify(manifestPayload));
        assert.ok(parsed);
        assert.notEqual(parsed.entries[0], manifestPayload.entries[0]);
        assert.deepEqual(parsed.entries, manifestPayload.entries);
    });
});

void describe("prepare-hot-reload command", () => {
    void it("exposes defaults for temp root and websocket URL", () => {
        const command = createPrepareHotReloadCommand();
        const options = command.options;
        const tempRootOption = options.find((opt) => opt.long === "--gm-temp-root");
        const websocketOption = options.find((opt) => opt.long === "--websocket-url");

        assert.ok(tempRootOption);
        assert.equal(tempRootOption.defaultValue, DEFAULT_GM_TEMP_ROOT);
        assert.ok(websocketOption);
        assert.equal(websocketOption.defaultValue, DEFAULT_WEBSOCKET_URL);
    });
});
