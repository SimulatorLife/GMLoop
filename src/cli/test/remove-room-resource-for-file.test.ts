import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { removeRoomResourceForFile } from "../src/commands/watch/dependency-updates.js";

type RoomJson = Record<string, unknown>;
type CleanupContext = Parameters<typeof removeRoomResourceForFile>[0];

function createContext(): CleanupContext {
    return {
        roomResources: new Map<string, RoomJson>(),
        resourcePatches: new Map()
    };
}

void describe("removeRoomResourceForFile", () => {
    void it("drops the cached room JSON and its matching resource patch", () => {
        const context = createContext();
        const filePath = "/project/rooms/room_main/room_main.yy";
        context.roomResources.set(filePath, { name: "room_main", resourceType: "GMRoom" });
        context.resourcePatches.set("resource/room/room_main", {
            kind: "resource",
            id: "resource/room/room_main",
            resourceType: "GMRoom",
            resourceName: "room_main",
            layerUpdates: [],
            metadata: { sourcePath: filePath, sourceHash: "hash", timestamp: 0 }
        });

        const removed = removeRoomResourceForFile(context, filePath);

        assert.equal(removed, 2, "expected both the room JSON and its patch to be removed");
        assert.equal(context.roomResources.has(filePath), false, "room JSON should be evicted");
        assert.equal(context.resourcePatches.has("resource/room/room_main"), false, "resource patch should be evicted");
    });

    void it("removes only the room JSON when no matching patch was ever broadcast", () => {
        const context = createContext();
        const filePath = "/project/rooms/room_empty/room_empty.yy";
        context.roomResources.set(filePath, { name: "room_empty", resourceType: "GMRoom" });

        const removed = removeRoomResourceForFile(context, filePath);

        assert.equal(removed, 1, "expected only the room JSON to be removed");
        assert.equal(context.roomResources.has(filePath), false);
    });

    void it("leaves unrelated rooms and patches untouched", () => {
        const context = createContext();
        const filePath = "/project/rooms/room_main/room_main.yy";
        const otherPath = "/project/rooms/room_other/room_other.yy";
        context.roomResources.set(filePath, { name: "room_main", resourceType: "GMRoom" });
        context.roomResources.set(otherPath, { name: "room_other", resourceType: "GMRoom" });
        context.resourcePatches.set("resource/room/room_other", {
            kind: "resource",
            id: "resource/room/room_other",
            resourceType: "GMRoom",
            resourceName: "room_other",
            layerUpdates: [],
            metadata: { sourcePath: otherPath, sourceHash: "hash", timestamp: 0 }
        });

        removeRoomResourceForFile(context, filePath);

        assert.equal(context.roomResources.has(otherPath), true, "unrelated room should still be cached");
        assert.equal(context.resourcePatches.has("resource/room/room_other"), true, "unrelated patch should remain");
    });

    void it("returns zero and leaves the maps intact when the file was never tracked", () => {
        const context = createContext();

        const removed = removeRoomResourceForFile(context, "/project/rooms/never_seen/never_seen.yy");

        assert.equal(removed, 0);
        assert.equal(context.roomResources.size, 0);
        assert.equal(context.resourcePatches.size, 0);
    });
});
