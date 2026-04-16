import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveFixtureDirectoryFromModuleUrl } from "../src/runner/resolve-fixture-directory-from-module-url.js";

void test("resolveFixtureDirectoryFromModuleUrl uses the source layout outside dist", () => {
    const resolved = resolveFixtureDirectoryFromModuleUrl({
        moduleUrl: "file:///workspace/GMLoop/src/format/test/fixture-suite-definition.ts",
        sourceRelativeSegments: ["fixtures"],
        distRelativeSegments: ["..", "..", "test", "fixtures"]
    });

    assert.equal(resolved, path.resolve("/workspace/GMLoop/src/format/test", "fixtures"));
});

void test("resolveFixtureDirectoryFromModuleUrl switches to the dist layout when compiled tests run", () => {
    const resolved = resolveFixtureDirectoryFromModuleUrl({
        moduleUrl: "file:///workspace/GMLoop/src/refactor/dist/test/fixture-suite-definition.js",
        sourceRelativeSegments: ["fixtures"],
        distRelativeSegments: ["..", "..", "test", "fixtures"]
    });

    assert.equal(resolved, path.resolve("/workspace/GMLoop/src/refactor/dist/test", "..", "..", "test", "fixtures"));
});

void test("resolveFixtureDirectoryFromModuleUrl supports custom fixture nesting for aggregate integration suites", () => {
    const resolved = resolveFixtureDirectoryFromModuleUrl({
        moduleUrl: "file:///workspace/GMLoop/test/dist/cross-module-integration.test.js",
        sourceRelativeSegments: ["fixtures", "integration"],
        distRelativeSegments: ["..", "fixtures", "integration"]
    });

    assert.equal(resolved, path.resolve("/workspace/GMLoop/test/dist", "..", "fixtures", "integration"));
});
