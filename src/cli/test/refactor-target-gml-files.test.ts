import assert from "node:assert/strict";
import test from "node:test";

import { resolveIndexedRootTargetGmlFiles } from "../src/commands/refactor-target-gml-files.js";

void test("indexed root-target gml discovery only runs when all targets resolve to the project root", () => {
    const projectRoot = "/project";
    const projectIndex = {
        files: {
            "scripts/a.gml": {},
            "scripts/a.yy": {}
        }
    };

    assert.equal(resolveIndexedRootTargetGmlFiles(projectRoot, [projectRoot], projectIndex)?.length, 2);
    assert.equal(resolveIndexedRootTargetGmlFiles(projectRoot, ["/project/scripts"], projectIndex), null);
});
