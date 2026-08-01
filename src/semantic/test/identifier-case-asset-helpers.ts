import { buildProjectIndex } from "../src/project-index/index.js";
import { createTempProjectWorkspace } from "./test-project-helpers.js";

export async function createAssetRenameProject() {
    const { projectRoot, writeProjectFile } = await createTempProjectWorkspace("gml-asset-rename-");

    await writeProjectFile(
        "MyGame.yyp",
        `${JSON.stringify(
            {
                name: "MyGame",
                resourceType: "GMProject",
                resources: [
                    {
                        id: {
                            name: "demo_script",
                            path: "scripts/demo_script/demo_script.yy"
                        }
                    }
                ]
            },
            null,
            4
        )}\n`
    );

    await writeProjectFile(
        "scripts/demo_script/demo_script.yy",
        `${JSON.stringify(
            {
                resourceType: "GMScript",
                name: "demo_script",
                resourcePath: "scripts/demo_script/demo_script.yy"
            },
            null,
            4
        )}\n`
    );

    const source = "function demo_script() {\n    return 42;\n}\n";
    const scriptPath = await writeProjectFile("scripts/demo_script/demo_script.gml", source);

    await writeProjectFile(
        "objects/obj_controller/obj_controller.yy",
        `${JSON.stringify(
            {
                resourceType: "GMObject",
                name: "obj_controller",
                scriptExecute: {
                    path: "scripts/demo_script/demo_script.yy",
                    name: "demo_script"
                }
            },
            null,
            4
        )}\n`
    );

    const projectIndex = await buildProjectIndex(projectRoot);

    return {
        projectRoot,
        projectIndex,
        scriptSource: source,
        scriptPath
    };
}

export async function createAssetCollisionProject() {
    const { projectRoot, writeProjectFile } = await createTempProjectWorkspace("gml-asset-collision-");

    await writeProjectFile(
        "MyGame.yyp",
        `${JSON.stringify(
            {
                name: "MyGame",
                resourceType: "GMProject",
                resources: [
                    {
                        id: {
                            name: "demo_script",
                            path: "scripts/demo_script/demo_script.yy"
                        }
                    },
                    {
                        id: {
                            name: "DemoScript",
                            path: "scripts/demo_script/DemoScriptExisting.yy"
                        }
                    }
                ]
            },
            null,
            4
        )}\n`
    );

    await writeProjectFile(
        "scripts/demo_script/demo_script.yy",
        `${JSON.stringify(
            {
                resourceType: "GMScript",
                name: "demo_script",
                resourcePath: "scripts/demo_script/demo_script.yy"
            },
            null,
            4
        )}\n`
    );

    await writeProjectFile(
        "scripts/demo_script/DemoScriptExisting.yy",
        `${JSON.stringify(
            {
                resourceType: "GMScript",
                name: "DemoScript",
                resourcePath: "scripts/demo_script/DemoScriptExisting.yy"
            },
            null,
            4
        )}\n`
    );

    const primarySource = "function demo_script() {\n    return 1;\n}\n";
    const secondarySource = "function DemoScript() {\n    return 2;\n}\n";
    const primaryPath = await writeProjectFile("scripts/demo_script/demo_script.gml", primarySource);
    await writeProjectFile("scripts/demo_script/DemoScriptExisting.gml", secondarySource);

    const projectIndex = await buildProjectIndex(projectRoot);

    return {
        projectRoot,
        projectIndex,
        scriptSource: primarySource,
        scriptPath: primaryPath
    };
}
