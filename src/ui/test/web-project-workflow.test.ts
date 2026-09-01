import assert from "node:assert/strict";
import test from "node:test";

import { PROJECT_WORKFLOWS } from "../src/graph/types.js";
import { __test__ as webTestExports } from "../src/web/index.js";

void test("web project workflow requests preserve the selected workflow", () => {
    for (const workflow of PROJECT_WORKFLOWS) {
        assert.equal(webTestExports.createProjectWorkflowRequestBody(workflow), JSON.stringify({ workflow }));
    }
});
