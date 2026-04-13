import assert from "node:assert/strict";
import test from "node:test";

import { Refactor, type RefactorProjectConfig } from "@gmloop/refactor";

import { GmlSemanticBridge } from "../src/modules/refactor/semantic-bridge.js";
import { measureMedianDurationMs } from "./test-helpers/refactor-top-level-naming-performance.js";

const RESOURCE_COUNT = 2000;
const PERFORMANCE_THRESHOLD_MS = 1200;

type ScriptResourceFixture = {
    projectIndex: Record<string, unknown>;
    projectRoot: string;
    sourceTexts: Map<string, string>;
};

function createFunctionNamingConventionConfig(): RefactorProjectConfig {
    return {
        codemods: {
            namingConvention: {
                rules: {
                    function: {
                        caseStyle: "camel"
                    }
                }
            }
        }
    };
}

function createScriptResourceFixture(): ScriptResourceFixture {
    const projectRoot = "/project";
    const files: Record<
        string,
        { declarations: Array<Record<string, unknown>>; references: Array<Record<string, unknown>> }
    > = {};
    const resources: Record<string, { name: string; path: string; resourceType: string }> = {};
    const scripts: Record<string, Record<string, unknown>> = {};
    const sourceTexts = new Map<string, string>();
    const usagePath = "scripts/usage.gml";
    const usageLines: Array<string> = [];
    let usageOffset = 0;

    for (let index = 0; index < RESOURCE_COUNT; index += 1) {
        const resourceName = `script_asset_${index}`;
        const currentName = `bad_name_${index}`;
        const filePath = `scripts/${resourceName}.gml`;
        const resourcePath = `scripts/${resourceName}/${resourceName}.yy`;
        const sourceText =
            `function ${resourceName}() {\n    return ${index};\n}\n` +
            `function ${currentName}() {\n    return ${index + 1};\n}\n`;
        const resourceDeclarationStart = sourceText.indexOf(resourceName);
        const resourceDeclarationEndInclusive = resourceDeclarationStart + resourceName.length - 1;
        const declarationStart = sourceText.indexOf(currentName);
        const declarationEndInclusive = declarationStart + currentName.length - 1;

        sourceTexts.set(filePath, sourceText);
        files[filePath] = {
            declarations: [{ name: currentName, identifierId: `script:${currentName}`, filePath }],
            references: []
        };
        scripts[`script:${resourceName}`] = {
            identifierId: `script:${resourceName}`,
            name: resourceName,
            declarations: [
                {
                    name: resourceName,
                    filePath,
                    start: { index: resourceDeclarationStart },
                    end: { index: resourceDeclarationEndInclusive }
                },
                {
                    name: currentName,
                    filePath,
                    start: { index: declarationStart },
                    end: { index: declarationEndInclusive }
                }
            ],
            references: [],
            resourcePath
        };
        resources[resourcePath] = {
            name: resourceName,
            path: resourcePath,
            resourceType: "GMScript"
        };
        usageLines.push(`${currentName}();\n`);
    }

    const usageSource = usageLines.join("");
    sourceTexts.set(usagePath, usageSource);
    files[usagePath] = {
        declarations: [],
        references: []
    };

    for (let index = 0; index < RESOURCE_COUNT; index += 1) {
        const currentName = `bad_name_${index}`;
        const referenceEndInclusive = usageOffset + currentName.length - 1;
        (scripts[`script:script_asset_${index}`].references as Array<Record<string, unknown>>).push({
            targetName: currentName,
            name: currentName,
            filePath: usagePath,
            start: { index: usageOffset },
            end: { index: referenceEndInclusive }
        });
        usageOffset += `${currentName}();\n`.length;
    }

    return {
        projectIndex: {
            identifiers: { scripts },
            files,
            resources
        },
        projectRoot,
        sourceTexts
    };
}

void test("refactor naming codemod keeps script-backed function scans within the indexed threshold", async () => {
    const fixture = createScriptResourceFixture();

    const executeStressRun = async () => {
        const semantic = new GmlSemanticBridge(fixture.projectIndex, fixture.projectRoot);
        const instrumentedSemantic = semantic as unknown as {
            getScriptCallableDeclarationsForResource: (resourcePath: string) => ReadonlyArray<Record<string, unknown>>;
        };
        const originalGetScriptCallableDeclarationsForResource =
            instrumentedSemantic.getScriptCallableDeclarationsForResource.bind(instrumentedSemantic);
        let getScriptCallableDeclarationsForResourceCallCount = 0;

        instrumentedSemantic.getScriptCallableDeclarationsForResource = (resourcePath) => {
            getScriptCallableDeclarationsForResourceCallCount += 1;
            return originalGetScriptCallableDeclarationsForResource(resourcePath);
        };

        const engine = new Refactor.RefactorEngine({ semantic });
        const result = await engine.executeConfiguredCodemods({
            projectRoot: fixture.projectRoot,
            targetPaths: [fixture.projectRoot],
            gmlFilePaths: [...fixture.sourceTexts.keys()],
            config: createFunctionNamingConventionConfig(),
            readFile: async (filePath) => fixture.sourceTexts.get(filePath) ?? "",
            dryRun: true,
            onlyCodemods: ["namingConvention"]
        });

        return {
            getScriptCallableDeclarationsForResourceCallCount,
            result
        };
    };

    await executeStressRun();
    const { durationMs, result } = await measureMedianDurationMs(3, executeStressRun);
    const rewrittenUsageFile = result.result.appliedFiles.get("scripts/usage.gml");

    assert.equal(result.result.summaries.length, 1);
    assert.equal(result.result.summaries[0]?.id, "namingConvention");
    assert.equal(result.result.summaries[0]?.changed, true);
    assert.equal(result.result.appliedFiles.size, RESOURCE_COUNT + 1);
    assert.ok(
        result.getScriptCallableDeclarationsForResourceCallCount >= RESOURCE_COUNT,
        `Expected indexed script-resource declaration lookups during collection and planning, received ${result.getScriptCallableDeclarationsForResourceCallCount}`
    );
    assert.ok(typeof rewrittenUsageFile === "string");
    assert.match(rewrittenUsageFile, /\bbadName0\(\);/);
    assert.ok(
        durationMs <= PERFORMANCE_THRESHOLD_MS,
        `Expected script-resource naming codemod runtime under ${PERFORMANCE_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
    );
});
