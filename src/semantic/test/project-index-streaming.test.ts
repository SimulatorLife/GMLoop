import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectIndex } from "../src/project-index/index.js";
import { createTempProjectWorkspace } from "./test-project-helpers.js";

type ProjectIndexSnapshot = {
    identifiers: Record<string, unknown>;
    metrics?: {
        counters?: Record<string, number>;
    };
};

async function createStreamingFixture(): Promise<{ projectRoot: string; cleanup: () => Promise<void> }> {
    const { projectRoot, writeProjectFile, cleanup } = await createTempProjectWorkspace("project-index-streaming-");

    await writeProjectFile("StreamingProject.yyp", JSON.stringify({ name: "StreamingProject" }));

    await writeProjectFile(
        "scripts/streaming_script/streaming_script.yy",
        JSON.stringify({ resourceType: "GMScript", name: "streaming_script" })
    );

    await writeProjectFile(
        "scripts/streaming_script/streaming_script.gml",
        [
            "#macro STREAMING_MACRO 1",
            "globalvar stream_global;",
            "function streaming_script() {",
            "    var i = 0;",
            "    i += STREAMING_MACRO;",
            "    i += STREAMING_MACRO;",
            "    i += STREAMING_MACRO;",
            "    stream_global = i;",
            "    stream_global = stream_global + STREAMING_MACRO;",
            "    return i;",
            "}",
            ""
        ].join("\n")
    );

    return {
        projectRoot,
        cleanup: async () => {
            await cleanup();
        }
    };
}

void test("buildProjectIndex streaming sink matches in-memory identifier snapshot", async () => {
    const fixture = await createStreamingFixture();

    try {
        const baseline = (await buildProjectIndex(fixture.projectRoot)) as ProjectIndexSnapshot;
        const streaming = (await buildProjectIndex(fixture.projectRoot, undefined, {
            identifierSink: {
                enabled: true,
                flushThreshold: 2,
                retainedEntriesPerKey: 1,
                readCacheMaxEntries: 1
            }
        })) as ProjectIndexSnapshot;

        assert.deepEqual(streaming.identifiers, baseline.identifiers);
    } finally {
        await fixture.cleanup();
    }
});

void test("buildProjectIndex streaming sink records spill telemetry counters", async () => {
    const fixture = await createStreamingFixture();

    try {
        const streaming = (await buildProjectIndex(fixture.projectRoot, undefined, {
            identifierSink: {
                enabled: true,
                flushThreshold: 2,
                retainedEntriesPerKey: 1,
                readCacheMaxEntries: 1
            }
        })) as ProjectIndexSnapshot;

        const counters = streaming.metrics?.counters ?? {};
        assert.ok((counters["identifiers.appended"] ?? 0) > 0);
        assert.ok((counters["identifiers.spilled"] ?? 0) > 0);
    } finally {
        await fixture.cleanup();
    }
});
