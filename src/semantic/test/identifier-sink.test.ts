import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import test from "node:test";

import { TempFileIdentifierSink } from "../src/project-index/identifier-sink.js";

void test("TempFileIdentifierSink isolates spill files for keys with matching sanitized prefixes", () => {
    const sink = new TempFileIdentifierSink({
        enabled: true,
        flushThreshold: 2,
        retainedEntriesPerKey: 1,
        readCacheMaxEntries: 2
    });

    try {
        sink.append({ collection: "scripts", key: "script/a-b", role: "references", payload: { value: "a-1" } });
        sink.append({ collection: "scripts", key: "script/a-b", role: "references", payload: { value: "a-2" } });

        sink.append({ collection: "scripts", key: "script/a?b", role: "references", payload: { value: "b-1" } });
        sink.append({ collection: "scripts", key: "script/a?b", role: "references", payload: { value: "b-2" } });

        assert.deepEqual(sink.readAll("scripts", "script/a-b", "references"), [{ value: "a-1" }, { value: "a-2" }]);
        assert.deepEqual(sink.readAll("scripts", "script/a?b", "references"), [{ value: "b-1" }, { value: "b-2" }]);

        const stats = sink.getStats();
        assert.equal(stats.spillFiles, 2);
        assert.ok(stats.recordsSpilled >= 2);
    } finally {
        sink.dispose();
    }
});

void test("TempFileIdentifierSink returns retained in-memory entries when spill file is externally removed", async () => {
    const sink = new TempFileIdentifierSink({
        enabled: true,
        flushThreshold: 2,
        retainedEntriesPerKey: 1,
        readCacheMaxEntries: 2
    });

    try {
        sink.append({ collection: "scripts", key: "script/corruption", role: "references", payload: { value: "v-1" } });
        sink.append({ collection: "scripts", key: "script/corruption", role: "references", payload: { value: "v-2" } });

        const spillPath = (
            sink as unknown as {
                filePathByKey: Map<string, string>;
            }
        ).filePathByKey
            .values()
            .next().value;
        assert.equal(typeof spillPath, "string");

        await rm(spillPath, { force: true });

        // With spill data unavailable, the sink should safely return only retained tail entries.
        assert.deepEqual(sink.readAll("scripts", "script/corruption", "references"), [{ value: "v-2" }]);
    } finally {
        sink.dispose();
    }
});

void test("TempFileIdentifierSink ignores reads after dispose", async () => {
    const sink = new TempFileIdentifierSink({
        enabled: true,
        flushThreshold: 2,
        retainedEntriesPerKey: 1,
        readCacheMaxEntries: 2
    });

    sink.append({ collection: "scripts", key: "script/disposed", role: "references", payload: { value: "v-1" } });
    sink.append({ collection: "scripts", key: "script/disposed", role: "references", payload: { value: "v-2" } });
    sink.dispose();

    assert.deepEqual(sink.readAll("scripts", "script/disposed", "references"), []);

    // Ensure append remains a no-op post-dispose and does not throw.
    sink.append({ collection: "scripts", key: "script/disposed", role: "references", payload: { value: "v-3" } });
    assert.deepEqual(sink.readAll("scripts", "script/disposed", "references"), []);

    // Writing to the previous spill path should not affect the disposed sink view.
    const spillPath = (
        sink as unknown as {
            filePathByKey: Map<string, string>;
        }
    ).filePathByKey
        .values()
        .next().value;
    if (typeof spillPath === "string") {
        await writeFile(spillPath, '{"value":"unexpected"}\n', "utf8");
        assert.deepEqual(sink.readAll("scripts", "script/disposed", "references"), []);
    }
});

void test("TempFileIdentifierSink treats corrupted spill payloads as cache misses", async () => {
    const sink = new TempFileIdentifierSink({
        enabled: true,
        flushThreshold: 2,
        retainedEntriesPerKey: 1,
        readCacheMaxEntries: 2
    });

    try {
        sink.append({
            collection: "scripts",
            key: "script/corrupt-json",
            role: "references",
            payload: { value: "v-1" }
        });
        sink.append({
            collection: "scripts",
            key: "script/corrupt-json",
            role: "references",
            payload: { value: "v-2" }
        });

        const spillPath = (
            sink as unknown as {
                filePathByKey: Map<string, string>;
            }
        ).filePathByKey
            .values()
            .next().value;
        assert.equal(typeof spillPath, "string");

        await writeFile(spillPath, "{not-json}\n", "utf8");

        assert.deepEqual(sink.readAll("scripts", "script/corrupt-json", "references"), [{ value: "v-2" }]);
        // Subsequent reads should remain stable after the bad spill mapping was dropped.
        assert.deepEqual(sink.readAll("scripts", "script/corrupt-json", "references"), [{ value: "v-2" }]);
    } finally {
        sink.dispose();
    }
});

void test("TempFileIdentifierSink reads remaining good records when some JSONL lines are malformed", async () => {
    const sink = new TempFileIdentifierSink({
        enabled: true,
        flushThreshold: 4,
        retainedEntriesPerKey: 1,
        readCacheMaxEntries: 4
    });

    try {
        sink.append({
            collection: "scripts",
            key: "script/partially-corrupt",
            role: "references",
            payload: { value: "good-1" }
        });
        sink.append({
            collection: "scripts",
            key: "script/partially-corrupt",
            role: "references",
            payload: { value: "good-2" }
        });
        sink.append({
            collection: "scripts",
            key: "script/partially-corrupt",
            role: "references",
            payload: { value: "good-3" }
        });
        sink.append({
            collection: "scripts",
            key: "script/partially-corrupt",
            role: "references",
            payload: { value: "good-4" }
        });

        const spillPath = (
            sink as unknown as {
                filePathByKey: Map<string, string>;
            }
        ).filePathByKey
            .values()
            .next().value;
        assert.equal(typeof spillPath, "string");

        // Overwrite with a mixed file: good line, then malformed line(s), then more good lines.
        // The per-line JSON.parse guard ensures that a single bad line does not abort
        // the entire read, so remaining valid records are still returned.
        await writeFile(spillPath, '{"value":"recovered-1"}\n{"broken JSON here"}\n{"value":"recovered-2"}\n');

        assert.deepEqual(sink.readAll("scripts", "script/partially-corrupt", "references"), [
            { value: "recovered-1" },
            { value: "recovered-2" },
            { value: "good-4" }
        ]);
    } finally {
        sink.dispose();
    }
});
