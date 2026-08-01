import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { GmlSemanticBridge } from "../src/modules/refactor/semantic-bridge.js";

type ScriptResourceDescriptor = {
    name: string;
    resourcePath: string;
};

async function createScriptResourceMetadataFixture(): Promise<{
    projectIndex: Record<string, unknown>;
    projectRoot: string;
    scriptResources: Array<ScriptResourceDescriptor>;
}> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-semantic-bridge-cache-"));
    const manifestPath = "project.yyp";
    const scriptNames = ["bad_name_alpha", "bad_name_beta", "bad_name_gamma"];
    const identifiers: Record<string, Record<string, unknown>> = {};
    const resources: Record<
        string,
        {
            assetReferences: Array<{ propertyPath: string; targetPath: string }>;
            name: string;
            path: string;
            resourceType: string;
        }
    > = {};
    const scriptResources: Array<ScriptResourceDescriptor> = [];

    for (const [index, scriptName] of scriptNames.entries()) {
        const resourcePath = `scripts/${scriptName}/${scriptName}.yy`;
        const absoluteResourcePath = path.join(projectRoot, resourcePath);
        await mkdir(path.dirname(absoluteResourcePath), { recursive: true });
        await writeFile(
            absoluteResourcePath,
            JSON.stringify(
                {
                    name: scriptName,
                    resourceType: "GMScript",
                    resourcePath
                },
                null,
                2
            ),
            "utf8"
        );

        identifiers[`script:${scriptName}`] = {
            identifierId: `script:${scriptName}`,
            name: scriptName,
            resourcePath,
            declarations: [
                {
                    filePath: `scripts/${scriptName}.gml`,
                    name: scriptName,
                    start: { index: 9 },
                    end: { index: 9 + scriptName.length - 1 }
                }
            ]
        };
        resources[resourcePath] = {
            assetReferences: [],
            name: scriptName,
            path: resourcePath,
            resourceType: "GMScript"
        };
        scriptResources.push({ name: scriptName, resourcePath });

        const absoluteSourcePath = path.join(projectRoot, `scripts/${scriptName}.gml`);
        await writeFile(absoluteSourcePath, `function ${scriptName}() {\n    return ${index};\n}\n`, "utf8");
    }

    const manifestAbsolutePath = path.join(projectRoot, manifestPath);
    await writeFile(
        manifestAbsolutePath,
        JSON.stringify(
            {
                resources: scriptResources.map(({ name, resourcePath }) => ({
                    id: {
                        name,
                        path: resourcePath
                    }
                }))
            },
            null,
            2
        ),
        "utf8"
    );

    resources[manifestPath] = {
        assetReferences: scriptResources.map(({ resourcePath }, index) => ({
            propertyPath: `resources.${index}.id`,
            targetPath: resourcePath
        })),
        name: "project",
        path: manifestPath,
        resourceType: "GMProject"
    };

    return {
        projectIndex: {
            identifiers: {
                scripts: identifiers
            },
            resources
        },
        projectRoot,
        scriptResources
    };
}

void test("GmlSemanticBridge isolates cached metadata documents between repeated resource rename plans", async () => {
    const fixture = await createScriptResourceMetadataFixture();
    const semantic = new GmlSemanticBridge(fixture.projectIndex, fixture.projectRoot);

    try {
        const primaryResource = fixture.scriptResources[0];
        const firstRenameEdits = semantic.getAdditionalSymbolEdits(
            `gml/scripts/${primaryResource.name}`,
            "good_name_one"
        );
        const secondRenameEdits = semantic.getAdditionalSymbolEdits(
            `gml/scripts/${primaryResource.name}`,
            "good_name_two"
        );

        assert.ok(firstRenameEdits, `Expected additional edits for ${primaryResource.name}`);
        assert.ok(secondRenameEdits, `Expected repeated additional edits for ${primaryResource.name}`);

        const firstManifestEdit = firstRenameEdits.metadataEdits.find(
            (metadataEdit) => metadataEdit.path === "project.yyp"
        );
        const secondManifestEdit = secondRenameEdits.metadataEdits.find(
            (metadataEdit) => metadataEdit.path === "project.yyp"
        );
        const firstResourceEdit = firstRenameEdits.metadataEdits.find(
            (metadataEdit) => metadataEdit.path === primaryResource.resourcePath
        );
        const secondResourceEdit = secondRenameEdits.metadataEdits.find(
            (metadataEdit) => metadataEdit.path === primaryResource.resourcePath
        );

        assert.ok(firstManifestEdit, "Expected the first manifest metadata edit to be included");
        assert.ok(secondManifestEdit, "Expected the second manifest metadata edit to be included");
        assert.ok(firstResourceEdit, "Expected the first resource metadata edit to be included");
        assert.ok(secondResourceEdit, "Expected the second resource metadata edit to be included");
        assert.match(firstManifestEdit.content, /"name"\s*:\s*"good_name_one"/);
        assert.doesNotMatch(firstManifestEdit.content, /"name"\s*:\s*"good_name_two"/);
        assert.match(secondManifestEdit.content, /"name"\s*:\s*"good_name_two"/);
        assert.doesNotMatch(secondManifestEdit.content, /"name"\s*:\s*"good_name_one"/);
        assert.match(firstResourceEdit.content, /"name"\s*:\s*"good_name_one"/);
        assert.match(secondResourceEdit.content, /"name"\s*:\s*"good_name_two"/);
    } finally {
        await rm(fixture.projectRoot, { recursive: true, force: true });
    }
});
