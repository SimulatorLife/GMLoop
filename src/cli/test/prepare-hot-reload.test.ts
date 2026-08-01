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
const { areRuntimeWrapperAssetManifestsEqual, parseRuntimeWrapperAssetManifest } = liveReloadAssetTest;

async function createTempDir(prefix: string): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function createRuntimeWrapperRoot(root: string): Promise<string> {
    const runtimeRoot = path.join(root, "runtime-wrapper-dist");
    await fs.mkdir(path.join(runtimeRoot, "src", "browser", "runtime"), { recursive: true });
    await fs.mkdir(path.join(runtimeRoot, "src", "browser", "timing"), { recursive: true });
    await fs.mkdir(path.join(runtimeRoot, "src", "browser", "websocket"), { recursive: true });
    await fs.writeFile(
        path.join(runtimeRoot, "src", "browser", "index.js"),
        [
            'import { createRuntimeWrapper, installScriptCallAdapter } from "./runtime/index.js";',
            'import { createWebSocketClient } from "./websocket/index.js";',
            "export function initializeLiveReload() {",
            "  const wrapper = createRuntimeWrapper();",
            "  installScriptCallAdapter(wrapper);",
            '  createWebSocketClient({ wrapper, url: "ws://127.0.0.1:17890" });',
            "  return wrapper;",
            "}",
            ""
        ].join("\n"),
        "utf8"
    );
    await fs.writeFile(
        path.join(runtimeRoot, "src", "browser", "config.js"),
        "export const liveReloadBootstrapConfig = {};\n",
        "utf8"
    );
    await fs.writeFile(
        path.join(runtimeRoot, "src", "browser", "runtime", "index.js"),
        "export const createRuntimeWrapper = () => ({});\nexport const installScriptCallAdapter = () => {};\n",
        "utf8"
    );
    await fs.writeFile(
        path.join(runtimeRoot, "src", "browser", "timing", "index.js"),
        "export const Timing = true;\n",
        "utf8"
    );
    await fs.writeFile(
        path.join(runtimeRoot, "src", "browser", "websocket", "index.js"),
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
            /<script type="module" src="\.\/\.gml-hot-reload\/runtime-wrapper\/src\/browser\/index\.js"><\/script>/u
        );
        assert.doesNotMatch(updated, /runtime-wrapper\/browser\/index\.js/u);

        const runtimeEntryStats = await fs.stat(result.assets.bootstrapEntryPath);
        assert.equal(runtimeEntryStats.isFile(), true);
        const browserRuntimeStats = await fs.stat(
            path.join(outputRoot, ".gml-hot-reload", "runtime-wrapper", "src", "browser", "runtime", "index.js")
        );
        assert.equal(browserRuntimeStats.isFile(), true);
        await assert.rejects(
            () => fs.stat(path.join(outputRoot, ".gml-hot-reload", "runtime-wrapper", "browser")),
            /ENOENT/u
        );

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

    void it("skips rewriting the bootstrap config when its rendered contents are unchanged", async () => {
        const root = await createTempDir("gml-live-reload-skip-config-write-");
        const outputRoot = path.join(root, "output");
        const runtimeWrapperRoot = await createRuntimeWrapperRoot(root);
        await fs.mkdir(outputRoot, { recursive: true });
        await fs.writeFile(path.join(outputRoot, "index.html"), "<html><body><h1>Demo</h1></body></html>", "utf8");

        const bootstrapConfig = {
            websocketUrl: "ws://127.0.0.1:9999",
            statusUrl: "http://127.0.0.1:17991/status",
            logLevel: "debug"
        } as const;

        await prepareLiveReload({
            html5OutputRoot: outputRoot,
            runtimeWrapperDistRoot: runtimeWrapperRoot,
            bootstrapConfig
        });

        const configPath = path.join(outputRoot, ".gml-hot-reload", LIVE_RELOAD_BOOTSTRAP_CONFIG_RELATIVE_PATH);
        const firstStats = await fs.stat(configPath);

        await new Promise((resolve) => setTimeout(resolve, 20));

        await prepareLiveReload({
            html5OutputRoot: outputRoot,
            runtimeWrapperDistRoot: runtimeWrapperRoot,
            bootstrapConfig
        });

        const secondStats = await fs.stat(configPath);
        assert.equal(
            secondStats.mtimeMs,
            firstStats.mtimeMs,
            "Bootstrap config should be skipped when its rendered contents are unchanged"
        );
    });

    void it("rewrites the bootstrap config when its contents actually change", async () => {
        const root = await createTempDir("gml-live-reload-rewrite-config-");
        const outputRoot = path.join(root, "output");
        const runtimeWrapperRoot = await createRuntimeWrapperRoot(root);
        await fs.mkdir(outputRoot, { recursive: true });
        await fs.writeFile(path.join(outputRoot, "index.html"), "<html><body><h1>Demo</h1></body></html>", "utf8");

        await prepareLiveReload({
            html5OutputRoot: outputRoot,
            runtimeWrapperDistRoot: runtimeWrapperRoot,
            bootstrapConfig: {
                websocketUrl: "ws://127.0.0.1:9999"
            }
        });

        const configPath = path.join(outputRoot, ".gml-hot-reload", LIVE_RELOAD_BOOTSTRAP_CONFIG_RELATIVE_PATH);
        const firstStats = await fs.stat(configPath);

        await new Promise((resolve) => setTimeout(resolve, 20));

        await prepareLiveReload({
            html5OutputRoot: outputRoot,
            runtimeWrapperDistRoot: runtimeWrapperRoot,
            bootstrapConfig: {
                websocketUrl: "ws://127.0.0.1:8888"
            }
        });

        const secondStats = await fs.stat(configPath);
        const secondContents = await fs.readFile(configPath, "utf8");
        assert.notEqual(secondStats.mtimeMs, firstStats.mtimeMs);
        assert.match(secondContents, /ws:\/\/127\.0\.0\.1:8888/u);
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
            version: 3,
            entries: [{ relativePath: "src/browser/index.js", size: 12, mtimeMs: 1234 }]
        };

        const parsed = parseRuntimeWrapperAssetManifest(JSON.stringify(manifestPayload));
        assert.ok(parsed);
        assert.notEqual(parsed.entries[0], manifestPayload.entries[0]);
        assert.deepEqual(parsed.entries, manifestPayload.entries);
    });
});

void describe("areRuntimeWrapperAssetManifestsEqual", () => {
    // The tolerance window of `Core.areNumbersApproximatelyEqual` scales with the
    // magnitude of the inputs (`EPSILON * max(1, |a|, |b|) * 4`). For an mtime
    // value of ~1.7e12 (typical post-2024 milliseconds since epoch), the
    // resulting window is on the order of a few microseconds — wide enough to
    // mask filesystem-precision drift that previously forced redundant asset
    // recopies, but narrow enough that genuine mtime changes still register.
    const SAMPLE_MTIME_MS = 1_720_451_123_456;
    // 1 nanosecond of drift is far inside the tolerance window for
    // `SAMPLE_MTIME_MS` (the epsilon window is ~1.5µs at this magnitude).
    // Strict `===` would treat this as unequal; the regression asserts that
    // the new tolerance-aware comparison absorbs it, which is the failure
    // mode the original strict-equality check suffered from after `fs.cp`
    // round trips or cross-filesystem `fs.stat()` comparisons.
    const NANOSECOND_DRIFT_MS = 1e-6;

    void it("treats manifests with byte-identical mtimes as equal", () => {
        const left = createManifest(SAMPLE_MTIME_MS);
        const right = createManifest(SAMPLE_MTIME_MS);

        assert.equal(areRuntimeWrapperAssetManifestsEqual(left, right), true);
    });

    void it("treats sub-microsecond mtime drift as equal (regression)", () => {
        const left = createManifest(SAMPLE_MTIME_MS);
        const right = createManifest(SAMPLE_MTIME_MS + NANOSECOND_DRIFT_MS);

        assert.equal(
            areRuntimeWrapperAssetManifestsEqual(left, right),
            true,
            "nanosecond-level mtime drift must not flip an asset manifest to 'changed'"
        );
    });

    void it("detects mtime changes that exceed the tolerance window", () => {
        // A 1 millisecond shift on an mtime of ~1.7e12 is several orders of
        // magnitude larger than the epsilon window (~1.5µs at this magnitude),
        // so the helper must still report the manifests as unequal — otherwise
        // we would silently skip recopying assets that legitimately changed.
        const left = createManifest(SAMPLE_MTIME_MS);
        const right = createManifest(SAMPLE_MTIME_MS + 1);

        assert.equal(areRuntimeWrapperAssetManifestsEqual(left, right), false);
    });

    void it("rejects manifests whose entry count differs", () => {
        const left = createManifest(SAMPLE_MTIME_MS);
        const right = { version: 3, entries: [] };

        assert.equal(areRuntimeWrapperAssetManifestsEqual(left, right), false);
    });

    void it("rejects manifests whose version differs", () => {
        const left = createManifest(SAMPLE_MTIME_MS);
        const right = { version: 2, entries: [...left.entries] };

        assert.equal(areRuntimeWrapperAssetManifestsEqual(left, right), false);
    });

    void it("detects size changes while ignoring harmless mtime drift", () => {
        // `size` is an integer byte count from `fs.stat`, so any difference
        // reflects real content change and must short-circuit the comparison.
        // The unchanged mtime confirms the drift-tolerance path is still
        // engaged for unrelated entries within the same manifest.
        const left = createManifest(SAMPLE_MTIME_MS);
        const right = { version: 3, entries: [{ ...left.entries[0], size: 8192 }] };

        assert.equal(areRuntimeWrapperAssetManifestsEqual(left, right), false);
    });

    void it("detects path changes while ignoring harmless mtime drift", () => {
        const left = createManifest(SAMPLE_MTIME_MS);
        const right = {
            version: 3,
            entries: [{ ...left.entries[0], relativePath: "src/browser/runtime/index.js" }]
        };

        assert.equal(areRuntimeWrapperAssetManifestsEqual(left, right), false);
    });
});

// Build a single-entry manifest with the given mtime so each test can mutate
// just the field under test. `size` and `relativePath` are kept stable because
// the comparison must keep their strict-equality semantics (size is an
// integer byte count; relativePath is a canonical string).
function createManifest(mtimeMs: number): {
    version: number;
    entries: Array<{ relativePath: string; size: number; mtimeMs: number }>;
} {
    return {
        version: 3,
        entries: [{ relativePath: "src/browser/index.js", size: 4096, mtimeMs }]
    };
}

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
