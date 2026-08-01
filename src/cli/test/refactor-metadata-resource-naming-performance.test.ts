import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Refactor, type RefactorProjectConfig } from "@gmloop/refactor";

import { GmlSemanticBridge } from "../src/modules/refactor/semantic-bridge.js";
import { measureMedianDurationMs } from "./test-helpers/refactor-top-level-naming-performance.js";

const RESOURCE_COUNT = 240;
const PERFORMANCE_THRESHOLD_MS = 2500;

type MetadataResourceFixture = {
    projectIndex: Record<string, unknown>;
    projectRoot: string;
    sourceTexts: Map<string, string>;
};

function createScriptResourceNamingConventionConfig(): RefactorProjectConfig {
    return {
        codemods: {
            namingConvention: {
                rules: {
                    scriptResourceName: {
                        caseStyle: "camel"
                    }
                }
            }
        }
    };
}

async function createMetadataResourceFixture(): Promise<MetadataResourceFixture> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-refactor-metadata-performance-"));
    const files: Record<
        string,
        {
            declarations: Array<Record<string, unknown>>;
            references: Array<Record<string, unknown>>;
        }
    > = {};
    const resources: Record<
        string,
        {
            assetReferences: Array<{ propertyPath: string; targetPath: string }>;
            name: string;
            path: string;
            resourceType: string;
        }
    > = {};
    const scripts: Record<string, Record<string, unknown>> = {};
    const sourceTexts = new Map<string, string>();
    const usagePath = "scripts/usage.gml";
    const manifestPath = "project.yyp";
    const usageLines: Array<string> = [];
    let usageOffset = 0;

    for (let index = 0; index < RESOURCE_COUNT; index += 1) {
        const resourceName = `bad_resource_${index}`;
        const filePath = `scripts/${resourceName}/${resourceName}.gml`;
        const resourcePath = `scripts/${resourceName}/${resourceName}.yy`;
        const sourceText = `function ${resourceName}() {\n    return ${index};\n}\n`;
        const declarationStart = sourceText.indexOf(resourceName);
        const declarationEndInclusive = declarationStart + resourceName.length - 1;

        files[filePath] = {
            declarations: [{ identifierId: `script:${resourceName}`, filePath, name: resourceName }],
            references: []
        };
        scripts[`script:${resourceName}`] = {
            identifierId: `script:${resourceName}`,
            name: resourceName,
            declarations: [
                {
                    filePath,
                    name: resourceName,
                    start: { index: declarationStart },
                    end: { index: declarationEndInclusive }
                }
            ],
            references: [],
            resourcePath
        };
        resources[resourcePath] = {
            assetReferences: [],
            name: resourceName,
            path: resourcePath,
            resourceType: "GMScript"
        };
        sourceTexts.set(filePath, sourceText);
        usageLines.push(`${resourceName}();\n`);

        const absoluteResourceDirectory = path.join(projectRoot, path.dirname(resourcePath));
        await mkdir(absoluteResourceDirectory, { recursive: true });
        await writeFile(path.join(projectRoot, filePath), sourceText, "utf8");
        await writeFile(
            path.join(projectRoot, resourcePath),
            JSON.stringify(
                {
                    name: resourceName,
                    resourceType: "GMScript",
                    resourcePath
                },
                null,
                2
            ),
            "utf8"
        );
    }

    const usageSource = usageLines.join("");
    sourceTexts.set(usagePath, usageSource);
    files[usagePath] = {
        declarations: [],
        references: []
    };
    await mkdir(path.join(projectRoot, "scripts"), { recursive: true });
    await writeFile(path.join(projectRoot, usagePath), usageSource, "utf8");

    for (let index = 0; index < RESOURCE_COUNT; index += 1) {
        const resourceName = `bad_resource_${index}`;
        const referenceEndInclusive = usageOffset + resourceName.length - 1;
        (scripts[`script:${resourceName}`].references as Array<Record<string, unknown>>).push({
            targetName: resourceName,
            name: resourceName,
            filePath: usagePath,
            start: { index: usageOffset },
            end: { index: referenceEndInclusive }
        });
        usageOffset += `${resourceName}();\n`.length;
    }

    resources[manifestPath] = {
        assetReferences: Array.from({ length: RESOURCE_COUNT }, (_, index) => ({
            propertyPath: `resources.${index}.id`,
            targetPath: `scripts/bad_resource_${index}/bad_resource_${index}.yy`
        })),
        name: "project",
        path: manifestPath,
        resourceType: "GMProject"
    };
    await writeFile(
        path.join(projectRoot, manifestPath),
        JSON.stringify(
            {
                resources: Array.from({ length: RESOURCE_COUNT }, (_, index) => ({
                    id: {
                        name: `bad_resource_${index}`,
                        path: `scripts/bad_resource_${index}/bad_resource_${index}.yy`
                    }
                }))
            },
            null,
            2
        ),
        "utf8"
    );

    return {
        projectIndex: {
            identifiers: {
                scripts
            },
            files,
            resources
        },
        projectRoot,
        sourceTexts
    };
}

void test("refactor naming codemod keeps metadata-backed script resource renames within the threshold", async () => {
    const fixture = await createMetadataResourceFixture();

    try {
        const executeStressRun = async () => {
            const semantic = new GmlSemanticBridge(fixture.projectIndex, fixture.projectRoot);
            const engine = new Refactor.RefactorEngine({ semantic });

            return engine.executeConfiguredCodemods({
                projectRoot: fixture.projectRoot,
                targetPaths: [fixture.projectRoot],
                gmlFilePaths: [...fixture.sourceTexts.keys()],
                config: createScriptResourceNamingConventionConfig(),
                readFile: async (filePath) => fixture.sourceTexts.get(filePath) ?? "",
                dryRun: true,
                onlyCodemods: ["namingConvention"]
            });
        };

        await executeStressRun();
        const { durationMs, result } = await measureMedianDurationMs(3, executeStressRun);
        const rewrittenManifest = result.appliedFiles.get("project.yyp");

        assert.equal(result.summaries.length, 1);
        assert.equal(result.summaries[0]?.id, "namingConvention");
        assert.equal(result.summaries[0]?.changed, true);
        assert.ok(result.appliedFiles.size >= RESOURCE_COUNT * 2 + 2);
        assert.equal(typeof rewrittenManifest, "string");
        assert.match(rewrittenManifest, /"name"\s*:\s*"badResource0"/);
        assert.ok(
            durationMs <= PERFORMANCE_THRESHOLD_MS,
            `Expected metadata-backed script resource codemod runtime under ${PERFORMANCE_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
        );
    } finally {
        await rm(fixture.projectRoot, { recursive: true, force: true });
    }
});
