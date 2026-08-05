/**
 * Tests for the consolidated script-name registration helpers exposed by
 * `src/cli/src/commands/watch/source-analysis.ts`.
 *
 * These helpers were previously duplicated between `watch.ts` and
 * `watch/dependency-updates.ts` (with `unregisterScriptName` only in the
 * latter). The duplicate copies hid `unregisterScriptName` from watch tests
 * and forced both files to import the same primitive path resolvers.
 *
 * The helpers are pure and stateless apart from the `Set` they mutate, so
 * the assertions can run in isolation without standing up the watch command.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ensureScriptNameRegistered,
    getScriptNameFromPath,
    unregisterScriptName
} from "../src/commands/watch/source-analysis.js";

void describe("watch script-name helpers", () => {
    void it("getScriptNameFromPath returns the basename for files under scripts/", () => {
        assert.equal(getScriptNameFromPath("/project/scripts/foo.gml"), "foo");
        assert.equal(getScriptNameFromPath("/project/scripts/sub/bar.gml"), "sub");
    });

    void it("getScriptNameFromPath returns null when the path is not under scripts/", () => {
        assert.equal(getScriptNameFromPath("/project/objects/obj_player/Step_0.gml"), null);
        assert.equal(getScriptNameFromPath("/project/random.gml"), null);
    });

    void it("ensureScriptNameRegistered inserts the resolved name", () => {
        const scriptNames = new Set<string>();

        ensureScriptNameRegistered("/project/scripts/widget.gml", scriptNames);

        assert.deepEqual([...scriptNames], ["widget"]);
    });

    void it("ensureScriptNameRegistered is a no-op for paths without a script name", () => {
        const scriptNames = new Set<string>();

        ensureScriptNameRegistered("/project/objects/obj_player/Step_0.gml", scriptNames);

        assert.equal(scriptNames.size, 0);
    });

    void it("unregisterScriptName removes the resolved name when present", () => {
        const scriptNames = new Set<string>(["widget", "other"]);

        unregisterScriptName("/project/scripts/widget.gml", scriptNames);

        assert.deepEqual([...scriptNames], ["other"]);
    });

    void it("unregisterScriptName is a no-op when the resolved name is absent", () => {
        const scriptNames = new Set<string>(["other"]);

        unregisterScriptName("/project/scripts/widget.gml", scriptNames);

        assert.deepEqual([...scriptNames], ["other"]);
    });

    void it("unregisterScriptName is a no-op for paths without a script name", () => {
        const scriptNames = new Set<string>(["other"]);

        unregisterScriptName("/project/objects/obj_player/Step_0.gml", scriptNames);

        assert.deepEqual([...scriptNames], ["other"]);
    });
});
