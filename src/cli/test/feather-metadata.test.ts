import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { Core } from "@gmloop/core";

import { REPO_ROOT } from "../src/shared/workspace-paths.js";

void test("feather metadata loader resolves bundled snapshot", () => {
    const expectedPath = path.resolve(REPO_ROOT, "resources", "feather-metadata.json");
    assert.equal(Core.getFeatherMetadataPath(), expectedPath);

    const metadata = Core.loadBundledFeatherMetadata();
    assert.ok(metadata && typeof metadata === "object");
    assert.ok(Array.isArray(metadata.diagnostics));
});
