import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
    clearIdentifierCaseDryRunContexts,
    setIdentifierCaseDryRunContext
} from "../src/identifier-case/identifier-case-helpers.js";
import { prepareIdentifierCasePlan } from "../src/identifier-case/plan-service.js";
import { buildProjectIndex } from "../src/project-index/index.js";
import { createAssetCollisionProject, createAssetRenameProject } from "./identifier-case-asset-helpers.js";
import { getFormat } from "./identifier-case-test-helpers.js";
import { createTempProjectWorkspace } from "./test-project-helpers.js";

async function createAssetReservedProject() {
    const { projectRoot, writeProjectFile } = await createTempProjectWorkspace("gml-asset-reserved-");

    await writeProjectFile(
        "MyGame.yyp",
        `${JSON.stringify(
            {
                name: "MyGame",
                resourceType: "GMProject",
                resources: [
                    {
                        id: {
                            name: "MoveContactSolid",
                            path: "scripts/move_contact/MoveContactSolid.yy"
                        }
                    }
                ]
            },
            null,
            4
        )}\n`
    );

    await writeProjectFile(
        "scripts/move_contact/MoveContactSolid.yy",
        `${JSON.stringify(
            {
                resourceType: "GMScript",
                name: "MoveContactSolid",
                resourcePath: "scripts/move_contact/MoveContactSolid.yy"
            },
            null,
            4
        )}\n`
    );

    const source = "function MoveContactSolid() {\n    return 3;\n}\n";
    const scriptPath = await writeProjectFile("scripts/move_contact/MoveContactSolid.gml", source);

    const projectIndex = await buildProjectIndex(projectRoot);

    return {
        projectRoot,
        projectIndex,
        scriptPath
    };
}

void describe("asset rename execution", () => {
    void it("does not rename script assets during formatter execution", async () => {
        const { projectRoot, projectIndex, scriptSource, scriptPath } = await createAssetRenameProject();

        try {
            clearIdentifierCaseDryRunContexts();
            setIdentifierCaseDryRunContext({
                filepath: scriptPath,
                projectIndex,
                dryRun: false
            });

            const diagnostics = [];
            const formatOptions = {
                filepath: scriptPath,
                gmlIdentifierCase: "off",
                gmlIdentifierCaseAssets: "pascal",
                gmlIdentifierCaseAcknowledgeAssetRenames: true,
                __identifierCaseProjectIndex: projectIndex,
                __identifierCaseDryRun: false,
                diagnostics
            };

            const Format = await getFormat();
            await Format.format(scriptSource, formatOptions);

            assert.strictEqual(diagnostics.length, 0);

            const originalYyPath = path.join(projectRoot, "scripts/demo_script/demo_script.yy");
            const originalGmlPath = path.join(projectRoot, "scripts/demo_script/demo_script.gml");
            const originalYyExists = await fileExists(originalYyPath);
            const originalGmlExists = await fileExists(originalGmlPath);
            assert.ok(originalYyExists);
            assert.ok(originalGmlExists);
        } finally {
            clearIdentifierCaseDryRunContexts();
            await fs.rm(projectRoot, { recursive: true, force: true });
        }
    });
});

void describe("asset rename conflict detection", () => {
    void it("aborts renames when converted names collide with existing assets", async () => {
        const { projectRoot, projectIndex, scriptPath } = await createAssetCollisionProject();

        try {
            const options: any = {
                filepath: scriptPath,
                gmlIdentifierCase: "off",
                gmlIdentifierCaseAssets: "pascal",
                gmlIdentifierCaseAcknowledgeAssetRenames: true,
                __identifierCaseProjectIndex: projectIndex,
                __identifierCaseDryRun: false,
                identifierCaseFs: {
                    renameSync() {
                        assert.fail("renameSync should not be called when conflicts are present");
                    }
                },
                diagnostics: []
            };

            await prepareIdentifierCasePlan(options);

            const conflicts = options.__identifierCaseConflicts ?? [];
            assert.ok(conflicts.length > 0, "Expected collisions to be reported");
            assert.ok(
                conflicts.some((conflict) => conflict.code === "collision"),
                "Expected collision conflict code"
            );
            assert.ok(
                conflicts.some((conflict) => conflict.message.includes("collides with existing asset")),
                "Expected conflict message to reference existing assets"
            );
            assert.ok(
                conflicts.some((conflict) =>
                    conflict.suggestions.some((suggestion) => suggestion.includes("gmlIdentifierCaseIgnore"))
                ),
                "Expected suggestion to reference ignore patterns"
            );
            assert.ok(
                conflicts.some((conflict) =>
                    conflict.suggestions.some((suggestion) => suggestion.includes("gmlIdentifierCaseAssets"))
                ),
                "Expected suggestion to mention scope toggle"
            );
            assert.notStrictEqual(
                options.__identifierCaseAssetRenamesApplied,
                true,
                "Expected asset renames to be aborted"
            );
            assert.strictEqual(
                options.__identifierCaseAssetRenameResult,
                undefined,
                "Expected rename executor not to run"
            );
        } finally {
            await fs.rm(projectRoot, { recursive: true, force: true });
        }
    });

    void it("detects reserved-word conflicts before renaming assets", async () => {
        const { projectRoot, projectIndex, scriptPath } = await createAssetReservedProject();

        try {
            const options: any = {
                filepath: scriptPath,
                gmlIdentifierCase: "off",
                gmlIdentifierCaseAssets: "snake-lower",
                gmlIdentifierCaseAcknowledgeAssetRenames: true,
                __identifierCaseProjectIndex: projectIndex,
                __identifierCaseDryRun: false,
                diagnostics: []
            };

            await prepareIdentifierCasePlan(options);

            const conflicts = options.__identifierCaseConflicts ?? [];
            assert.ok(conflicts.length > 0, "Expected reserved conflict to be reported");
            assert.ok(
                conflicts.some((conflict) => conflict.code === "reserved"),
                "Expected reserved conflict code"
            );
            assert.ok(
                conflicts.some((conflict) => conflict.message.includes("conflicts with reserved identifier")),
                "Expected reserved-word guidance"
            );
            assert.ok(
                conflicts.some((conflict) =>
                    conflict.suggestions.some((suggestion) => suggestion.includes("gmlIdentifierCaseIgnore"))
                ),
                "Expected ignore suggestion"
            );
            assert.ok(
                conflicts.some((conflict) =>
                    conflict.suggestions.some((suggestion) => suggestion.includes("gmlIdentifierCaseAssets"))
                ),
                "Expected scope toggle suggestion"
            );
            assert.notStrictEqual(
                options.__identifierCaseAssetRenamesApplied,
                true,
                "Reserved conflicts should abort asset renames"
            );
            assert.strictEqual(
                options.__identifierCaseAssetRenameResult,
                undefined,
                "Expected rename executor not to run on reserved conflict"
            );
        } finally {
            await fs.rm(projectRoot, { recursive: true, force: true });
        }
    });
});

async function fileExists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    } catch (error) {
        if (error && error.code === "ENOENT") {
            return false;
        }
        throw error;
    }
}
