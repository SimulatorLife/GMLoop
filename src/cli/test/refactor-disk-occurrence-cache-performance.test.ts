import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { GmlSemanticBridge } from "../src/modules/refactor/semantic-bridge.js";

const RESOURCE_COUNT = 180;
const EVENT_FILE_COUNT = 90;
const MAX_LOOKUP_RUNTIME_MS = 7000;

function createDiskOccurrenceCacheFixture(): {
    projectIndex: Record<string, unknown>;
    projectRoot: string;
} {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gml-disk-occurrence-cache-"));
    const resources: Record<
        string,
        { assetReferences: Array<unknown>; name: string; path: string; resourceType: string }
    > = {};
    const files: Record<string, { references: Array<unknown> }> = {};
    const resourceNames = Array.from({ length: RESOURCE_COUNT }, (_, index) => `o_resource_${index}`);
    const eventDirectory = path.join(projectRoot, "objects", "oSystem");
    fs.mkdirSync(eventDirectory, { recursive: true });

    for (let index = 0; index < RESOURCE_COUNT; index += 1) {
        const resourceName = resourceNames[index];
        const resourcePath = `objects/${resourceName}/${resourceName}.yy`;
        resources[resourcePath] = {
            name: resourceName,
            path: resourcePath,
            resourceType: "GMObject",
            assetReferences: []
        };
    }

    for (let fileIndex = 0; fileIndex < EVENT_FILE_COUNT; fileIndex += 1) {
        const eventPath = `objects/oSystem/Step_${fileIndex}.gml`;
        const sourceText = resourceNames.map((resourceName) => `instance_exists(${resourceName});`).join("\n");
        fs.writeFileSync(path.join(projectRoot, eventPath), `${sourceText}\n`, "utf8");
        files[eventPath] = {
            references: []
        };
    }

    return {
        projectRoot,
        projectIndex: {
            identifiers: {},
            resources,
            files
        }
    };
}

void test("GmlSemanticBridge caches disk identifier scans across many resource rename occurrence lookups", () => {
    const fixture = createDiskOccurrenceCacheFixture();
    const semantic = new GmlSemanticBridge(fixture.projectIndex, fixture.projectRoot);
    const instrumentedSemantic = semantic as unknown as {
        appendDiskOccurrencesForFile: (filePath: string, index: Map<string, Array<Record<string, unknown>>>) => void;
    };
    const originalAppendDiskOccurrencesForFile =
        instrumentedSemantic.appendDiskOccurrencesForFile.bind(instrumentedSemantic);
    let appendDiskOccurrencesForFileCallCount = 0;

    instrumentedSemantic.appendDiskOccurrencesForFile = (filePath, index) => {
        appendDiskOccurrencesForFileCallCount += 1;
        originalAppendDiskOccurrencesForFile(filePath, index);
    };

    try {
        const startTime = performance.now();
        for (let index = 0; index < RESOURCE_COUNT; index += 1) {
            const resourceName = `o_resource_${index}`;
            const symbolId = `gml/objects/${resourceName}`;
            const occurrences = semantic.getSymbolOccurrences(resourceName, symbolId);
            assert.ok(
                occurrences.length > EVENT_FILE_COUNT,
                `Expected disk-backed symbol occurrences for ${resourceName} to include event-file hits`
            );
        }
        const durationMs = performance.now() - startTime;

        assert.equal(
            appendDiskOccurrencesForFileCallCount,
            EVENT_FILE_COUNT,
            `Expected one disk scan per GML file while caching all identifier groups, received ${appendDiskOccurrencesForFileCallCount}`
        );
        assert.ok(
            durationMs <= MAX_LOOKUP_RUNTIME_MS,
            `Expected cached disk occurrence lookups to finish under ${MAX_LOOKUP_RUNTIME_MS}ms, received ${durationMs.toFixed(2)}ms`
        );
    } finally {
        fs.rmSync(fixture.projectRoot, { recursive: true, force: true });
    }
});
