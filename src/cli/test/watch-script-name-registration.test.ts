/**
 * Focused tests for the script-name registration helpers shared by the watch
 * command and its dependency-update helpers.
 *
 * The helpers (`getScriptNameFromPath`, `ensureScriptNameRegistered`,
 * `unregisterScriptName`) live in `source-analysis.ts` so both call sites can
 * share a single implementation. These tests verify their contract directly
 * without standing up the full watch pipeline.
 */

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
    ensureScriptNameRegistered,
    getScriptNameFromPath,
    unregisterScriptName
} from "../src/commands/watch/source-analysis.js";

void describe("watch command script-name registration helpers", () => {
    void it("resolves the canonical script name for files under a scripts directory", () => {
        const scriptPath = path.join(process.cwd(), "scripts", "scr_player.gml");

        const scriptName = getScriptNameFromPath(scriptPath);

        assert.equal(scriptName, "scr_player", "scripts/<name>.gml should resolve to the script basename");
    });

    void it("returns null for files outside a recognised scripts/object layout", () => {
        const loosePath = path.join(process.cwd(), "loose", "scr_stray.gml");

        const scriptName = getScriptNameFromPath(loosePath);

        assert.equal(scriptName, null);
    });

    void it("registers and unregisters the resolved name against the shared set", () => {
        const scriptNames = new Set<string>();
        const scriptPath = path.join(process.cwd(), "scripts", "scr_lifecycle.gml");

        ensureScriptNameRegistered(scriptPath, scriptNames);
        assert.equal(scriptNames.size, 1, "first registration should add exactly one entry");

        ensureScriptNameRegistered(scriptPath, scriptNames);
        assert.equal(scriptNames.size, 1, "duplicate registration must not grow the set");

        unregisterScriptName(scriptPath, scriptNames);
        assert.equal(scriptNames.size, 0, "unregistration should remove the resolved name");

        unregisterScriptName(scriptPath, scriptNames);
        assert.equal(scriptNames.size, 0, "unregistering an absent entry must be a no-op");
    });

    void it("leaves the set untouched when the path is not a recognised script", () => {
        const scriptNames = new Set<string>();
        const loosePath = path.join(process.cwd(), "loose", "scr_noop.gml");

        ensureScriptNameRegistered(loosePath, scriptNames);
        assert.equal(scriptNames.size, 0, "unrecognised paths must not pollute the set");

        unregisterScriptName(loosePath, scriptNames);
        assert.equal(scriptNames.size, 0);
    });
});
