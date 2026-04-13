import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveCliVersion } from "../src/cli-core/version.js";

// Read package.json synchronously to avoid using `require` in ESM modules.
const cliPackageVersion = JSON.parse(
    fs.readFileSync(path.resolve(fileURLToPath(new URL("../../package.json", import.meta.url))), "utf8")
).version;

interface VersionEnv {
    PRETTIER_PLUGIN_GML_VERSION?: string;
    npm_package_version?: string;
}

/**
 * Run a test with a controlled version environment, then restore the original
 * process.env values regardless of success or failure.
 */
function withVersionEnv(env: VersionEnv, fn: () => void): void {
    const originalPluginVersion = process.env.PRETTIER_PLUGIN_GML_VERSION;
    const originalNpmVersion = process.env.npm_package_version;

    try {
        if ("PRETTIER_PLUGIN_GML_VERSION" in env) {
            if (env.PRETTIER_PLUGIN_GML_VERSION === undefined) {
                delete process.env.PRETTIER_PLUGIN_GML_VERSION;
            } else {
                process.env.PRETTIER_PLUGIN_GML_VERSION = env.PRETTIER_PLUGIN_GML_VERSION;
            }
        }

        if ("npm_package_version" in env) {
            if (env.npm_package_version === undefined) {
                delete process.env.npm_package_version;
            } else {
                process.env.npm_package_version = env.npm_package_version;
            }
        }

        fn();
    } finally {
        if (originalPluginVersion === undefined) {
            delete process.env.PRETTIER_PLUGIN_GML_VERSION;
        } else {
            process.env.PRETTIER_PLUGIN_GML_VERSION = originalPluginVersion;
        }

        if (originalNpmVersion === undefined) {
            delete process.env.npm_package_version;
        } else {
            process.env.npm_package_version = originalNpmVersion;
        }
    }
}

void describe("resolveCliVersion", { concurrency: 1 }, () => {
    void test("resolveCliVersion prefers the PRETTIER_PLUGIN_GML_VERSION override", () => {
        withVersionEnv({ PRETTIER_PLUGIN_GML_VERSION: "  1.2.3  ", npm_package_version: "ignored" }, () => {
            assert.equal(resolveCliVersion(), "1.2.3");
        });
    });

    void test("resolveCliVersion falls back to the CLI package version when metadata is available", () => {
        withVersionEnv({ PRETTIER_PLUGIN_GML_VERSION: undefined, npm_package_version: undefined }, () => {
            assert.equal(resolveCliVersion(), cliPackageVersion);
        });
    });

    void test("resolveCliVersion falls back to npm_package_version when no override is set", () => {
        withVersionEnv({ PRETTIER_PLUGIN_GML_VERSION: undefined, npm_package_version: " 9.8.7 " }, () => {
            assert.equal(resolveCliVersion(), "9.8.7");
        });
    });

    void test("resolveCliVersion skips whitespace-only PRETTIER_PLUGIN_GML_VERSION and falls back to npm_package_version", () => {
        withVersionEnv({ PRETTIER_PLUGIN_GML_VERSION: "   ", npm_package_version: "4.5.6" }, () => {
            assert.equal(resolveCliVersion(), "4.5.6");
        });
    });

    void test("resolveCliVersion skips empty PRETTIER_PLUGIN_GML_VERSION and falls back to npm_package_version", () => {
        withVersionEnv({ PRETTIER_PLUGIN_GML_VERSION: "", npm_package_version: "2.0.0" }, () => {
            assert.equal(resolveCliVersion(), "2.0.0");
        });
    });
});
