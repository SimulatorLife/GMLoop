import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Refactor } from "@gmloop/refactor";

import { GmlSemanticBridge } from "../src/modules/refactor/semantic-bridge.js";
import { measureMedianDurationMs } from "./test-helpers/refactor-top-level-naming-performance.js";

const OBJECT_RESOURCE_COUNT = 40;
const USAGE_FILE_COUNT = 40;
const PERFORMANCE_THRESHOLD_MS = 700;

type ObjectResourceFallbackFixture = {
    projectIndex: Record<string, unknown>;
    projectRoot: string;
    sourceTexts: Map<string, string>;
};

async function createObjectResourceFallbackFixture(): Promise<ObjectResourceFallbackFixture> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-refactor-object-scan-"));
    const files: Record<
        string,
        { declarations: Array<Record<string, unknown>>; references: Array<Record<string, unknown>> }
    > = {};
    const resources: Record<string, { name: string; path: string; resourceType: string }> = {};
    const objects: Record<string, Record<string, unknown>> = {};
    const sourceTexts = new Map<string, string>();

    for (let index = 0; index < OBJECT_RESOURCE_COUNT; index += 1) {
        const objectName = `bad_object_${index}`;
        const resourcePath = `objects/${objectName}/${objectName}.yy`;
        const eventPath = `objects/${objectName}/Create_0.gml`;
        const eventSource = `value = ${index};\n`;

        resources[resourcePath] = {
            name: objectName,
            path: resourcePath,
            resourceType: "GMObject"
        };
        objects[`object:${objectName}`] = {
            identifierId: `object:${objectName}`,
            name: objectName,
            declarations: [
                {
                    name: objectName,
                    filePath: resourcePath,
                    start: { index: 0 },
                    end: { index: objectName.length - 1 }
                }
            ],
            references: []
        };
        files[eventPath] = {
            declarations: [],
            references: []
        };
        sourceTexts.set(eventPath, eventSource);

        await mkdir(path.join(projectRoot, "objects", objectName), { recursive: true });
        await writeFile(
            path.join(projectRoot, resourcePath),
            JSON.stringify({ name: objectName, resourceType: "GMObject" }, null, 2),
            "utf8"
        );
        await writeFile(path.join(projectRoot, eventPath), eventSource, "utf8");
    }

    for (let fileIndex = 0; fileIndex < USAGE_FILE_COUNT; fileIndex += 1) {
        const filePath = `scripts/use_${fileIndex}.gml`;
        const sourceText = Array.from(
            { length: OBJECT_RESOURCE_COUNT },
            (_, resourceIndex) => `instance_create_layer(0, 0, "Instances", bad_object_${resourceIndex});\n`
        ).join("");

        files[filePath] = {
            declarations: [],
            references: []
        };
        sourceTexts.set(filePath, sourceText);

        await mkdir(path.join(projectRoot, "scripts"), { recursive: true });
        await writeFile(path.join(projectRoot, filePath), sourceText, "utf8");
    }

    return {
        projectIndex: {
            identifiers: { objects },
            files,
            resources
        },
        projectRoot,
        sourceTexts
    };
}

void test("refactor naming codemod reuses cached fallback identifier indexes for resource renames", async () => {
    const fixture = await createObjectResourceFallbackFixture();

    try {
        const executeStressRun = async () => {
            const semantic = new GmlSemanticBridge(fixture.projectIndex, fixture.projectRoot);
            const engine = new Refactor.RefactorEngine({ semantic });
            const result = await engine.executeConfiguredCodemods({
                projectRoot: fixture.projectRoot,
                targetPaths: [fixture.projectRoot],
                gmlFilePaths: [...fixture.sourceTexts.keys()],
                config: {
                    codemods: {
                        namingConvention: {
                            rules: {
                                objectResourceName: {
                                    caseStyle: "camel"
                                }
                            }
                        }
                    }
                },
                readFile: async (filePath) => fixture.sourceTexts.get(filePath) ?? "",
                dryRun: true,
                onlyCodemods: ["namingConvention"]
            });

            return {
                indexedFileCount: (
                    semantic as unknown as {
                        diskIdentifierOccurrenceIndexesByFilePath: Map<string, unknown>;
                    }
                ).diskIdentifierOccurrenceIndexesByFilePath.size,
                result
            };
        };

        await executeStressRun();
        const { durationMs, result } = await measureMedianDurationMs(3, executeStressRun);
        const rewrittenUsageFile = result.result.appliedFiles.get("scripts/use_0.gml");
        const expectedIndexedFileCount = fixture.sourceTexts.size;

        assert.equal(result.result.summaries.length, 1);
        assert.equal(result.result.summaries[0]?.id, "namingConvention");
        assert.equal(result.result.summaries[0]?.changed, true);
        assert.ok(typeof rewrittenUsageFile === "string");
        assert.match(rewrittenUsageFile, /\bbadObject/u);
        assert.doesNotMatch(rewrittenUsageFile, /\bbad_object_0\b/u);
        assert.equal(
            result.indexedFileCount,
            expectedIndexedFileCount,
            `Expected one fallback identifier index per source file, received ${result.indexedFileCount}`
        );
        assert.ok(
            durationMs <= PERFORMANCE_THRESHOLD_MS,
            `Expected resource fallback occurrence gathering under ${PERFORMANCE_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
        );
    } finally {
        await rm(fixture.projectRoot, { recursive: true, force: true });
    }
});
