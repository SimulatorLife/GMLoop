import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { importFormatModule, resolveFormatEntryPoint } from "../src/format-runtime/entry-point.js";

// Node deprecated the legacy assert.equal helper; rely on the strict
// assertions to keep this suite locked to the modern API.
// Manual validation: `pnpm test -- src/cli/test/format-entry-point.test.js` still
// passes after migrating the call sites, confirming behaviour parity.
const temporaryDirectories = new Set<string>();

function createTemporaryFormatModuleFile({ baseDirectory = os.tmpdir() } = {}) {
    const directory = fs.mkdtempSync(path.join(baseDirectory, "prettier-plugin-gml-entry-"));
    temporaryDirectories.add(directory);

    const modulePath = path.join(directory, "custom-format-module.mjs");
    fs.writeFileSync(modulePath, "export {}\n");

    return modulePath;
}

afterEach(() => {
    for (const directory of temporaryDirectories) {
        try {
            fs.rmSync(directory, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors so tests do not mask the underlying failure.
            // If a test creates temporary files and then fails an assertion, the
            // afterEach hook still attempts to clean up those files. A secondary
            // failure during cleanup (e.g., permission denied, directory locked)
            // should not obscure the original test failure in the test runner output.
        }
    }

    temporaryDirectories.clear();
});

void describe("resolveFormatEntryPoint", () => {
    void it("prefers an environment override when the path exists", () => {
        const formatPath = createTemporaryFormatModuleFile();

        const resolved = resolveFormatEntryPoint({
            env: { PRETTIER_PLUGIN_GML_FORMAT_PATH: formatPath }
        });

        assert.strictEqual(resolved, formatPath);
    });

    void it("prefers call-site candidates before environment and default candidates", () => {
        const callSitePath = createTemporaryFormatModuleFile();
        const environmentPath = createTemporaryFormatModuleFile();

        const resolved = resolveFormatEntryPoint({
            candidates: [callSitePath],
            env: { PRETTIER_PLUGIN_GML_FORMAT_PATH: environmentPath }
        });

        assert.strictEqual(resolved, callSitePath);
    });

    void it("treats null options bags as absent overrides", () => {
        const expected = resolveFormatEntryPoint();
        const resolved = resolveFormatEntryPoint(null);

        assert.strictEqual(resolved, expected);
    });

    void it("checks each environment entry before falling back to defaults", () => {
        const formatPath = createTemporaryFormatModuleFile();
        const nonexistent = path.join(path.dirname(formatPath), "missing.mjs");
        const envValue = `${nonexistent}${path.delimiter}${formatPath}`;

        const resolved = resolveFormatEntryPoint({
            env: { PRETTIER_PLUGIN_GML_FORMAT_PATHS: envValue }
        });

        assert.strictEqual(resolved, formatPath);
    });

    void it("skips directory overrides when resolving the entry point", () => {
        const defaultEntryPoint = resolveFormatEntryPoint({ env: {} });
        const directoryOverride = fs.mkdtempSync(path.join(os.tmpdir(), "prettier-plugin-gml-entry-dir-"));
        temporaryDirectories.add(directoryOverride);

        const resolved = resolveFormatEntryPoint({
            env: { PRETTIER_PLUGIN_GML_FORMAT_PATH: directoryOverride }
        });

        assert.strictEqual(resolved, defaultEntryPoint);
    });

    void it("expands leading tildes in environment overrides", () => {
        const homeDirectory = os.homedir();
        if (!homeDirectory) {
            return;
        }

        const formatPath = createTemporaryFormatModuleFile({
            baseDirectory: homeDirectory
        });
        const tildePath = `~${formatPath.slice(homeDirectory.length)}`;

        const resolved = resolveFormatEntryPoint({
            env: { PRETTIER_PLUGIN_GML_FORMAT_PATH: tildePath }
        });

        assert.strictEqual(resolved, formatPath);
    });

    void it("falls back to built-in candidates when overrides are not provided", () => {
        const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
        const resolved = resolveFormatEntryPoint({ env: {} });

        assert.strictEqual(path.basename(resolved), "format-entry.js", "Should default to the format entry file.");
        assert.ok(
            resolved.startsWith(path.resolve(repoRoot, "src", "format")),
            "Expected the resolved path under the format workspace."
        );
    });
});

void describe("importFormatModule", () => {
    void it("imports the module located at the resolved entry point", async () => {
        const formatPath = createTemporaryFormatModuleFile();
        const moduleContents = ["export const sentinel = 1729;", "export default { languages: [] };"].join("\n");
        fs.writeFileSync(formatPath, `${moduleContents}\n`);

        const module = await importFormatModule({
            env: { PRETTIER_PLUGIN_GML_FORMAT_PATH: formatPath }
        });

        assert.strictEqual(module?.sentinel, 1729);
    });
});
