import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
    createSyntheticScriptProjectWorkspace,
    createSyntheticScriptSource,
    createTempProjectWorkspace,
    recordValues
} from "./test-project-helpers.js";

void test("createTempProjectWorkspace writes nested project files and cleans them up", async () => {
    const workspace = await createTempProjectWorkspace("semantic-test-workspace-");
    const filePath = await workspace.writeProjectFile("scripts/demo/demo.gml", "return 1;\n");

    assert.equal(path.dirname(filePath).endsWith(path.join("scripts", "demo")), true);
    assert.equal(await fs.readFile(filePath, "utf8"), "return 1;\n");

    await workspace.cleanup();

    await assert.rejects(async () => fs.access(workspace.projectRoot));
});

void test("recordValues returns record values in insertion order", () => {
    assert.deepEqual(recordValues({ alpha: 1, beta: 2, gamma: 3 }), [1, 2, 3]);
});

void test("createSyntheticScriptProjectWorkspace writes deterministic script resources", async () => {
    const workspace = await createSyntheticScriptProjectWorkspace({
        prefix: "semantic-synthetic-project-",
        projectName: "SyntheticProject",
        scriptCount: 3,
        statementsPerScript: 2
    });

    try {
        assert.equal(workspace.scriptFilePaths.length, 3);
        assert.deepEqual(workspace.scriptNames, [
            "synthetic_script_0000",
            "synthetic_script_0001",
            "synthetic_script_0002"
        ]);

        const initialSource = await fs.readFile(workspace.scriptFilePaths[1], "utf8");
        assert.equal(initialSource, createSyntheticScriptSource(1, 2, 0));
        assert.match(initialSource, /synthetic_script_0000\(input_value\)/u);

        await workspace.writeSyntheticScriptRevision(1, 2);
        const revisedSource = await fs.readFile(workspace.scriptFilePaths[1], "utf8");
        assert.equal(revisedSource, createSyntheticScriptSource(1, 2, 2));
        assert.match(revisedSource, /var revision_marker_2 = accumulator/u);
        assert.match(revisedSource, /synthetic_revision_probe_2\(revision_marker_2\)/u);

        const manifest = JSON.parse(await fs.readFile(workspace.manifestPath, "utf8")) as {
            name: string;
            resources: ReadonlyArray<{ id: { name: string; path: string } }>;
        };
        assert.equal(manifest.name, "SyntheticProject");
        assert.equal(manifest.resources.length, 3);
        assert.deepEqual(manifest.resources[2], {
            id: {
                name: "synthetic_script_0002",
                path: "scripts/synthetic_script_0002/synthetic_script_0002.yy"
            }
        });
    } finally {
        await workspace.cleanup();
    }
});
