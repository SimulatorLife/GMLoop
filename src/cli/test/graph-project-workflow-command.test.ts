import assert from "node:assert/strict";
import test from "node:test";

import { __graphCommandTest__ } from "../src/commands/graph/index.js";

const { createGraphVisualizationWorkflowArguments } = __graphCommandTest__;

void test("graph project workflow buttons map to isolated CLI commands", () => {
    const projectRoot = "/tmp/project";

    assert.deepEqual(createGraphVisualizationWorkflowArguments("fix", projectRoot), [
        "fix",
        "--write",
        "--path",
        projectRoot
    ]);
    assert.deepEqual(createGraphVisualizationWorkflowArguments("format", projectRoot), [
        "format",
        "--write",
        "--path",
        projectRoot,
        "--on-parse-error",
        "skip"
    ]);
    assert.deepEqual(createGraphVisualizationWorkflowArguments("lint", projectRoot), [
        "lint",
        projectRoot,
        "--write",
        "--path",
        projectRoot,
        "--project-strict"
    ]);
    assert.deepEqual(createGraphVisualizationWorkflowArguments("refactor", projectRoot), [
        "refactor",
        "codemod",
        projectRoot,
        "--write",
        "--path",
        projectRoot
    ]);
});
