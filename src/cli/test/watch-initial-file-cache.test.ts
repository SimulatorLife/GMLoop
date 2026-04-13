import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clearInitialFileDataCache, takeInitialFileData } from "../src/commands/watch-source-analysis.js";

void describe("watch command initial file cache", () => {
    void it("removes consumed startup cache entries to release memory during the initial scan", () => {
        const filePath = "/project/scripts/player.gml";
        const cachedEntry = {
            content: "function player() { return 1; }",
            ast: { type: "Program" }
        };
        const fileDataCache = new Map([[filePath, cachedEntry]]);

        const consumedEntry = takeInitialFileData(fileDataCache, filePath);

        assert.equal(consumedEntry, cachedEntry, "expected cached startup data to be returned");
        assert.equal(fileDataCache.size, 0, "consumed entries should be removed immediately");
        assert.equal(fileDataCache.has(filePath), false, "consumed file path should no longer be cached");
    });

    void it("leaves the cache untouched when a file was not cached", () => {
        const fileDataCache = new Map([
            [
                "/project/scripts/other.gml",
                {
                    content: "function other() { return 2; }",
                    ast: { type: "Program" }
                }
            ]
        ]);

        const consumedEntry = takeInitialFileData(fileDataCache, "/project/scripts/missing.gml");

        assert.equal(consumedEntry, undefined, "missing files should not produce cached data");
        assert.equal(fileDataCache.size, 1, "unrelated cached entries should be preserved");
    });

    void it("clears unconsumed startup cache entries after the initial scan", () => {
        const fileDataCache = new Map([
            [
                "/project/scripts/leftover.gml",
                {
                    content: "function leftover() { return 3; }",
                    ast: { type: "Program" }
                }
            ]
        ]);

        clearInitialFileDataCache(fileDataCache);

        assert.equal(fileDataCache.size, 0, "all startup cache entries should be removed after startup");
    });

    void it("handles missing startup cache when clearing", () => {
        clearInitialFileDataCache(undefined);
        assert.ok(true, "clearing an absent cache should be a no-op");
    });
});
