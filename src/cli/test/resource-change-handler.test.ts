import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
    diffRoomBackgroundLayers,
    handleResourceFileChange,
    primeRoomResource
} from "../src/commands/watch/resource-change-handler.js";

void describe("room resource changes", () => {
    void it("emits only modified background-layer properties", () => {
        const previous = {
            layers: [{ resourceType: "GMRBackgroundLayer", name: "Background", colour: 1, hspeed: 0, visible: true }]
        };
        const current = {
            layers: [{ resourceType: "GMRBackgroundLayer", name: "Background", colour: 2, hspeed: 0, visible: false }]
        };

        assert.deepStrictEqual(diffRoomBackgroundLayers(previous, current), [
            {
                layerName: "Background",
                layerType: "GMRBackgroundLayer",
                properties: { colour: 2, visible: false }
            }
        ]);
    });

    void it("broadcasts a background colour patch after a primed room save", async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), "gmloop-room-resource-"));
        const filePath = path.join(directory, "Room1.yy");
        const roomResources = new Map<string, Record<string, unknown>>();
        const patches: Array<unknown> = [];
        const context = {
            fileSnapshots: new Map<string, number>(),
            fileContentHashes: new Map<string, string>(),
            resourcePatches: new Map(),
            totalPatchCount: 0,
            websocketServer: {
                broadcast(patch: unknown) {
                    patches.push(patch);
                    return { successCount: 1, failureCount: 0, totalClients: 1 };
                },
                getClientCount() {
                    return 1;
                },
                getLastStreamedPatch() {
                    return null;
                }
            },
            transientEmptyFileReadRetryCount: 0,
            transientEmptyFileReadRetryDelayMs: 0
        };

        try {
            await writeFile(
                filePath,
                '{"name":"Room1","resourceType":"GMRoom","layers":[{"name":"Background","resourceType":"GMRBackgroundLayer","colour":1,}],}',
                "utf8"
            );
            await primeRoomResource(filePath, context, roomResources);

            await writeFile(
                filePath,
                '{"name":"Room1","resourceType":"GMRoom","layers":[{"name":"Background","resourceType":"GMRBackgroundLayer","colour":2,}],}',
                "utf8"
            );
            await handleResourceFileChange(filePath, context, roomResources, { verbose: false, quiet: true });

            assert.deepStrictEqual(patches, [
                {
                    kind: "resource",
                    id: "resource/room/Room1",
                    revision: (patches[0] as { revision: string }).revision,
                    resourceType: "GMRoom",
                    resourceName: "Room1",
                    layerUpdates: [
                        {
                            layerName: "Background",
                            layerType: "GMRBackgroundLayer",
                            properties: { colour: 2 }
                        }
                    ],
                    metadata: {
                        sourcePath: filePath,
                        sourceHash: context.fileContentHashes.get(filePath),
                        timestamp: (patches[0] as { metadata: { timestamp: number } }).metadata.timestamp
                    }
                }
            ]);
            assert.ok((patches[0] as { revision?: string }).revision);
            assert.strictEqual(context.totalPatchCount, 1);
            assert.strictEqual(context.resourcePatches.size, 1);
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
