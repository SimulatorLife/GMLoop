import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { createLiveReloadCommand } from "../src/commands/live-reload.js";
import { __test__ as liveReloadAssetTest } from "../src/modules/live-reload/asset-sync.js";
import {
    DEFAULT_GM_TEMP_ROOT,
    DEFAULT_LIVE_RELOAD_WEBSOCKET_PORT,
    HOT_RELOAD_MARKER_START,
    LIVE_RELOAD_BOOTSTRAP_CONFIG_RELATIVE_PATH
} from "../src/modules/live-reload/config.js";
import { prepareLiveReload } from "../src/modules/live-reload/session.js";

const HOT_RELOAD_ASSET_MANIFEST = path.join(".gml-hot-reload", "runtime-wrapper-assets.manifest.json");
const { parseRuntimeWrapperAssetManifest } = liveReloadAssetTest;

async function createTempDir(prefix: string): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createRuntimeWrapperRoot(root: string): Promise<string> {
    const runtimeRoot = path.join(root, "runtime-wrapper-dist");
    await fs.mkdir(path.join(runtimeRoot, "browser"), { recursive: true });
    await fs.mkdir(path.join(runtimeRoot, "src", "runtime"), { recursive: true });
    await fs.mkdir(path.join(runtimeRoot, "src", "timing"), { recursive: true });
    await fs.mkdir(path.join(runtimeRoot, "src", "websocket"), { recursive: true });
    await fs.writeFile(path.join(runtimeRoot, "browser", "index.js"), "export const browserEntry = true;\n", "utf8");
    await fs.writeFile(
        path.join(runtimeRoot, "browser", "config.js"),
        "export const liveReloadBootstrapConfig = {};\n",
        "utf8"
    );
    await fs.writeFile(
        path.join(runtimeRoot, "src", "runtime", "index.js"),
        "export const createRuntimeWrapper = () => ({});\nexport const installScriptCallAdapter = () => {};\n",
        "utf8"
    );
    await fs.writeFile(path.join(runtimeRoot, "src", "timing", "index.js"), "export const Timing = true;\n", "utf8");
    await fs.writeFile(
        path.join(runtimeRoot, "src", "websocket", "index.js"),
        "export const createWebSocketClient = () => {};\n",
        "utf8"
    );
    return runtimeRoot;
}

function createLiveReloadPrepareCommand() {
    const command = createLiveReloadCommand();
    const prepareCommand = command.commands.find((entry) => entry.name() === "prepare");
    assert.ok(prepareCommand);
    return prepareCommand;
}

void describe("prepareLiveReload", () => {
    void it("injects a single bootstrap script tag and copies browser-public assets", async () => {
        const root = await createTempDir("gml-live-reload-");
        const outputRoot = path.join(root, "output");
        const runtimeWrapperRoot = await createRuntimeWrapperRoot(root);
        await fs.mkdir(outputRoot, { recursive: true });
        const indexPath = path.join(outputRoot, "index.html");
        await fs.writeFile(indexPath, "<html><body><h1>Demo</h1></body></html>", "utf8");

        const result = await prepareLiveReload({
            html5OutputRoot: outputRoot,
            runtimeWrapperDistRoot: runtimeWrapperRoot,
            bootstrapConfig: {
                websocketUrl: "ws://127.0.0.1:9999",
                statusUrl: "http://127.0.0.1:17991/status",
                logLevel: "debug"
            }
        });

        const updated = await fs.readFile(indexPath, "utf8");
        assert.match(updated, new RegExp(HOT_RELOAD_MARKER_START));
        assert.match(
            updated,
            /<script type="module" src="\.\/\.gml-hot-reload\/runtime-wrapper\/browser\/index\.js"><\/script>/u
        );
        assert.doesNotMatch(updated, /runtime-wrapper\/src\/runtime\/index\.js/u);

        const runtimeEntryStats = await fs.stat(result.assets.bootstrapEntryPath);
        assert.equal(runtimeEntryStats.isFile(), true);

        const generatedConfigPath = path.join(
            outputRoot,
            ".gml-hot-reload",
            LIVE_RELOAD_BOOTSTRAP_CONFIG_RELATIVE_PATH
        );
        const generatedConfig = await fs.readFile(generatedConfigPath, "utf8");
        assert.match(generatedConfig, /ws:\/\/127\.0\.0\.1:9999/u);
        assert.match(generatedConfig, /17991/u);
    });

    void it("skips recopying runtime assets when the manifest is unchanged", async () => {
        const root = await createTempDir("gml-live-reload-skip-copy-");
        const outputRoot = path.join(root, "output");
        const runtimeWrapperRoot = await createRuntimeWrapperRoot(root);
        await fs.mkdir(outputRoot, { recursive: true });
        await fs.writeFile(path.join(outputRoot, "index.html"), "<html><body><h1>Demo</h1></body></html>", "utf8");

        const firstResult = await prepareLiveReload({
            html5OutputRoot: outputRoot,
            runtimeWrapperDistRoot: runtimeWrapperRoot,
            bootstrapConfig: {
                websocketUrl: "ws://127.0.0.1:9999"
            }
        });
        assert.equal(firstResult.assets.copiedAssets, true);

        const manifestPath = path.join(outputRoot, HOT_RELOAD_ASSET_MANIFEST);
        const firstEntryStats = await fs.stat(firstResult.assets.bootstrapEntryPath);
        const firstManifestContents = await fs.readFile(manifestPath, "utf8");

        await new Promise((resolve) => setTimeout(resolve, 20));

        const secondResult = await prepareLiveReload({
            html5OutputRoot: outputRoot,
            runtimeWrapperDistRoot: runtimeWrapperRoot,
            bootstrapConfig: {
                websocketUrl: "ws://127.0.0.1:9999"
            }
        });

        const secondEntryStats = await fs.stat(secondResult.assets.bootstrapEntryPath);
        const secondManifestContents = await fs.readFile(manifestPath, "utf8");

        assert.equal(secondResult.assets.copiedAssets, false);
        assert.equal(secondEntryStats.mtimeMs, firstEntryStats.mtimeMs);
        assert.equal(secondManifestContents, firstManifestContents);
    });

    void it("auto-detects the newest HTML5 output directory", async () => {
        const root = await createTempDir("gml-live-reload-root-");
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

        const result = await prepareLiveReload({
            gmTempRoot: root,
            runtimeWrapperDistRoot: runtimeWrapperRoot,
            bootstrapConfig: {
                websocketUrl: "ws://127.0.0.1:9999"
            }
        });

        assert.equal(result.target.outputRoot, newer);
    });

    void it("fails fast when the HTML5 temp root is missing", async () => {
        const root = await createTempDir("gml-live-reload-missing-");
        const missingRoot = path.join(root, "gml-missing");
        await fs.rm(missingRoot, { recursive: true, force: true });

        await assert.rejects(
            () =>
                prepareLiveReload({
                    gmTempRoot: missingRoot,
                    bootstrapConfig: {
                        websocketUrl: "ws://127.0.0.1:9999"
                    }
                }),
            (error) => {
                assert.ok(error instanceof Error);
                assert.match(error.message, /GameMaker HTML5 temporary output root '.*' was not found/i);
                return true;
            }
        );
    });
});

void describe("runtime wrapper asset manifest parsing", () => {
    void it("returns cloned entry objects so parsed manifests cannot mutate the original JSON payload", () => {
        const manifestPayload = {
            version: 2,
            entries: [{ relativePath: "browser/index.js", size: 12, mtimeMs: 1234 }]
        };

        const parsed = parseRuntimeWrapperAssetManifest(JSON.stringify(manifestPayload));
        assert.ok(parsed);
        assert.notEqual(parsed.entries[0], manifestPayload.entries[0]);
        assert.deepEqual(parsed.entries, manifestPayload.entries);
    });
});

void describe("live-reload prepare command", () => {
    void it("exposes defaults for temp root and websocket port", () => {
        const command = createLiveReloadPrepareCommand();
        const options = command.options;
        const tempRootOption = options.find((opt) => opt.long === "--gm-temp-root");
        const websocketOption = options.find((opt) => opt.long === "--websocket-port");

        assert.ok(tempRootOption);
        assert.equal(tempRootOption.defaultValue, DEFAULT_GM_TEMP_ROOT);
        assert.ok(websocketOption);
        assert.equal(websocketOption.defaultValue, DEFAULT_LIVE_RELOAD_WEBSOCKET_PORT);
    });
});
