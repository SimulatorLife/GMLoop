import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MacroDefinition, MacroDefinitionsBySourcePath } from "@gmloop/transpiler";

import { cleanupRemovedFile } from "../src/commands/watch/dependency-updates.js";
import { DependencyTracker } from "../src/modules/transpilation/dependency-tracker.js";

type CleanupContext = Parameters<typeof cleanupRemovedFile>[0];

function createMacroDefinition(name: string, sourcePath: string): MacroDefinition {
    return { name, parameters: [], value: "1", sourcePath };
}

function createContext(): CleanupContext {
    return {
        dependencyTracker: new DependencyTracker(),
        dependentRetranspileConcurrency: 1,
        scriptNames: new Set<string>(),
        verboseOutputEnabled: false,
        quiet: true,
        fileSnapshots: new Map<string, number>(),
        fileContentHashes: new Map<string, string>(),
        fileContentLengths: new Map<string, number>(),
        lastSuccessfulPatches: new Map(),
        sourcePathToPatchIds: new Map<string, Set<string>>(),
        debouncedHandlers: new Map(),
        macroDefinitionsBySourcePath: new Map() as MacroDefinitionsBySourcePath,
        macroDefinitions: new Map<string, MacroDefinition>()
    };
}

void describe("cleanupRemovedFile", () => {
    void it("clears every per-file cache entry for the removed file", () => {
        const context = createContext();
        const filePath = "/project/scripts/player.gml";

        context.scriptNames.add("player");
        context.fileSnapshots.set(filePath, 123);
        context.fileContentHashes.set(filePath, "hash");
        context.fileContentLengths.set(filePath, 42);
        context.sourcePathToPatchIds.set(filePath, new Set(["gml/script/player"]));
        context.lastSuccessfulPatches.set("gml/script/player", {
            js_body: "function player() {}",
            metadata: { sourcePath: filePath, sourceHash: "hash", timestamp: 0 }
        } as never);
        context.dependencyTracker.registerFileDefines(filePath, ["gml/script/player"]);

        cleanupRemovedFile(context, filePath);

        assert.equal(context.scriptNames.has("player"), false, "script name should be unregistered");
        assert.equal(context.fileSnapshots.has(filePath), false);
        assert.equal(context.fileContentHashes.has(filePath), false);
        assert.equal(context.fileContentLengths.has(filePath), false);
        assert.equal(context.lastSuccessfulPatches.has("gml/script/player"), false);
        assert.equal(context.sourcePathToPatchIds.has(filePath), false);
        assert.deepEqual(context.dependencyTracker.getFileDefinitions(filePath), []);
    });

    void it("cancels and forgets a pending debounced handler for the removed file", () => {
        const context = createContext();
        const filePath = "/project/scripts/player.gml";
        let cancelled = false;
        context.debouncedHandlers.set(filePath, {
            cancel: () => {
                cancelled = true;
            }
        } as never);

        cleanupRemovedFile(context, filePath);

        assert.equal(cancelled, true, "the debounced handler should be cancelled");
        assert.equal(context.debouncedHandlers.has(filePath), false);
    });

    void it("returns dependents affected by the file's removed macro definitions", () => {
        const context = createContext();
        const filePath = "/project/scripts/constants.gml";
        const dependentFile = "/project/scripts/player.gml";

        context.macroDefinitionsBySourcePath.set(
            filePath,
            new Map([["SPEED", createMacroDefinition("SPEED", filePath)]])
        );
        context.macroDefinitions = new Map([["SPEED", createMacroDefinition("SPEED", filePath)]]);
        context.dependencyTracker.registerFileReferences(dependentFile, ["gml/macro/SPEED"]);

        const affectedDependents = cleanupRemovedFile(context, filePath);

        assert.deepEqual(affectedDependents, [dependentFile]);
        assert.equal(context.macroDefinitionsBySourcePath.has(filePath), false);
        assert.equal(context.macroDefinitions.has("SPEED"), false, "removed macro should drop from the project table");
    });

    void it("returns no dependents when the removed file defined no macros and nothing referenced it", () => {
        const context = createContext();
        const filePath = "/project/scripts/unused.gml";

        const affectedDependents = cleanupRemovedFile(context, filePath);

        assert.deepEqual(affectedDependents, []);
    });
});
