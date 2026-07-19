import assert from "node:assert/strict";
import test from "node:test";

import { GraphIndexProgressParticipant } from "../src/app/components/graph-index-progress-participant.js";
import type { GraphVisualizationGraphIndexProgress } from "../src/graph/types.js";

const originalFetch = globalThis.fetch;
const originalLocation = globalThis.location;

test.afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalLocation === undefined) {
        Reflect.deleteProperty(globalThis, "location");
    } else {
        Object.defineProperty(globalThis, "location", { configurable: true, value: originalLocation });
    }
});

void test("graph-index progress participant attaches to a running build and reloads after publication", async () => {
    const progressSnapshots: GraphVisualizationGraphIndexProgress[] = [];
    let reloadCount = 0;
    const responses = [
        {
            current: 2,
            isRunning: true,
            logLines: ["Parsing GML files... (2/4)"],
            ok: true,
            stage: "gml-parse",
            status: "running",
            summary: null,
            total: 4
        },
        {
            current: 4,
            isRunning: false,
            logLines: ["Parsing GML files... (4/4)"],
            ok: true,
            stage: "gml-parse",
            status: "success",
            summary: null,
            total: 4
        }
    ];
    globalThis.fetch = async () =>
        Response.json(
            responses.shift() ?? {
                current: 4,
                isRunning: false,
                logLines: ["Parsing GML files... (4/4)"],
                ok: true,
                stage: "gml-parse",
                status: "success",
                summary: null,
                total: 4
            }
        );
    Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: {
            href: "http://127.0.0.1:3000/graph",
            reload: () => {
                reloadCount++;
            }
        }
    });

    const participant = new GraphIndexProgressParticipant({
        callbacks: {
            canPoll: () => true,
            onPollError: (error) => {
                throw error;
            },
            onProgress: (progress) => {
                progressSnapshots.push(progress);
            }
        },
        pollIntervalMs: 1
    });

    participant.connect();
    await new Promise((resolve) => setTimeout(resolve, 20));
    participant.disconnect();

    assert.equal(progressSnapshots[0]?.isRunning, true);
    assert.equal(progressSnapshots.at(-1)?.status, "success");
    assert.equal(reloadCount, 1);
});
